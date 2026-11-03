import {
  Box3,
  type Camera,
  Matrix4,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  Sphere,
  Vector2,
  Vector3,
} from "three";
import type { ArcballControls } from "three/addons/controls/ArcballControls.js";

import { GAMEPAD_AXIS, GAMEPAD_BUTTON } from "./core.ts";
import {
  GamepadControls,
  type GamepadControlsOptions,
} from "./gamepad-controls.ts";
import {
  DEFAULT_GAMEPAD_STICK_PIPELINE,
  type GamepadStickBinding,
  type GamepadStickBindingOptions,
  resolveGamepadStickBinding,
} from "./gamepad-stick-processing.ts";

/**
 * Configuration for {@link GamepadArcballControls}.
 *
 * Every property has a sensible default, so you only need to pass the properties you want to override.
 */
export type GamepadArcballControlsOptions = GamepadControlsOptions & {
  /**
   * Multiplier on `ArcballControls.rotateSpeed` for rotation.
   * @default 1.0
   */
  rotateSpeed: number;

  /**
   * Multiplier on panning speed.
   * @default 1.0
   */
  panSpeed: number;

  /**
   * Multiplier on zooming speed.
   * @default 1.0
   */
  zoomSpeed: number;

  /**
   * Multiplier on z-rotation speed.
   * @default 1.0
   */
  zRotateSpeed: number;

  /**
   * Stick binding used for arcball rotation.
   * @default Left stick with the default stick pipeline
   */
  rotateStick: GamepadStickBindingOptions;

  /**
   * Stick binding used for panning.
   * @default Right stick with the default stick pipeline
   */
  panStick: GamepadStickBindingOptions;

  /**
   * Dead zone threshold for analog button and trigger values.
   * @default 0.1
   */
  buttonDeadzone: number;

  /**
   * Button index for zooming **in** (analog trigger value used for proportional zoom).
   * @default 7 - Right trigger
   */
  buttonZoomIn: number;

  /**
   * Button index for zooming **out** (analog trigger value used for proportional zoom).
   * @default 6 - Left trigger
   */
  buttonZoomOut: number;

  /**
   * Button index for rotating counterclockwise around the camera view axis.
   * @default 4 - Left shoulder
   */
  buttonZRotateLeft: number;

  /**
   * Button index for rotating clockwise around the camera view axis.
   * @default 5 - Right shoulder
   */
  buttonZRotateRight: number;

  /**
   * Button index for focusing the point at the center of the view.
   * @default 0 - South face button
   */
  buttonFocus: number;
};

type ResolvedGamepadArcballControlsOptions = Omit<
  GamepadArcballControlsOptions,
  "rotateStick" | "panStick"
> & {
  rotateStick: GamepadStickBinding;
  panStick: GamepadStickBinding;
};

// Default options merged in the constructor when no explicit configuration is provided.
const DEFAULT_ARCBALL_OPTIONS: ResolvedGamepadArcballControlsOptions = {
  rotateSpeed: 1.0,
  panSpeed: 1.0,
  zoomSpeed: 1.0,
  zRotateSpeed: 1.0,
  rotateStick: {
    xAxis: GAMEPAD_AXIS.LeftX,
    yAxis: GAMEPAD_AXIS.LeftY,
    pipeline: DEFAULT_GAMEPAD_STICK_PIPELINE,
  },
  panStick: {
    xAxis: GAMEPAD_AXIS.RightX,
    yAxis: GAMEPAD_AXIS.RightY,
    pipeline: DEFAULT_GAMEPAD_STICK_PIPELINE,
  },
  buttonDeadzone: 0.1,
  buttonZoomIn: GAMEPAD_BUTTON.RightTrigger,
  buttonZoomOut: GAMEPAD_BUTTON.LeftTrigger,
  buttonZRotateLeft: GAMEPAD_BUTTON.LeftShoulder,
  buttonZRotateRight: GAMEPAD_BUTTON.RightShoulder,
  buttonFocus: GAMEPAD_BUTTON.South,
};

const ZOOM_NOTCHES_PER_SECOND = 8;

type ArcballTransformation = {
  // Camera matrix produced by an Arcball runtime transform.
  camera: Matrix4 | null;

  // Gizmo matrix produced by an Arcball runtime transform.
  gizmos: Matrix4 | null;
};

type ArcballControlsWithRuntimeHelpers = ArcballControls & {
  // Camera controlled by the Arcball instance.
  object: PerspectiveCamera | OrthographicCamera;

  // Internal gizmo object used as the center for scale and z-rotation.
  _gizmos: Object3D;

  // Internal reusable axis vector used by ArcballControls z-rotation.
  _rotationAxis: Vector3;

  // Internal trackball radius used to scale pan deltas.
  _tbRadius: number;

  // Native baselines, including translations temporarily used by focus().
  _cameraMatrixState: Matrix4;
  _gizmoMatrixState: Matrix4;
  _initialNear: number;
  _initialFar: number;
  _nearPos0: number;
  _farPos0: number;

  // Computes the native radius without changing pointer/animation state.
  calculateTbRadius(camera: Camera): number;

  // Refreshes ArcballControls cached camera and gizmo matrices.
  updateMatrixState(): void;

  /**
   * Applies a runtime transformation matrix returned by an Arcball helper.
   *
   * @param transformation - Camera and gizmo matrices to apply.
   */
  applyTransformMatrix(transformation: ArcballTransformation): void;

  /**
   * Builds a camera rotation transformation around a world axis.
   *
   * @param axis - Normalized world axis to rotate around.
   * @param angle - Rotation amount in radians.
   * @returns The transformation matrices to apply.
   */
  rotate(axis: Vector3, angle: number): ArcballTransformation;

  /**
   * Builds a camera pan transformation between two virtual trackball points.
   *
   * @param p0 - Start point in Arcball's virtual trackball space.
   * @param p1 - End point in Arcball's virtual trackball space.
   * @param adjust - Whether ArcballControls should adjust the pan internally.
   * @returns The transformation matrices to apply.
   */
  pan(p0: Vector3, p1: Vector3, adjust?: boolean): ArcballTransformation;

  /**
   * Builds a zoom transformation around a world-space point.
   *
   * @param size - Scale factor to apply.
   * @param point - World-space point to zoom around.
   * @param scaleGizmos - Whether ArcballControls should scale gizmos too.
   * @returns The transformation matrices to apply, or `undefined` when ignored.
   */
  scale(
    size: number,
    point: Vector3,
    scaleGizmos?: boolean,
  ): ArcballTransformation | undefined;

  /**
   * Builds a rotation transformation around the camera view axis.
   *
   * @param point - World-space center point for the z-rotation.
   * @param angle - Rotation amount in radians.
   * @returns The transformation matrices to apply.
   */
  zRotate(point: Vector3, angle: number): ArcballTransformation;

  /**
   * Focuses the Arcball camera on a world-space point.
   *
   * @param point - World-space focus target.
   * @param size - Arcball scale factor used for focus distance.
   * @param amount - Optional interpolation amount.
   */
  focus(point: Vector3, size: number, amount?: number): void;

  /**
   * Projects a normalized-device coordinate onto the controlled scene object.
   *
   * @param cursor - Normalized-device coordinate to project.
   * @param camera - Camera used for projection.
   * @returns The hit point, or `null` when the cursor does not hit an object.
   */
  unprojectOnObj(cursor: Vector2, camera: Camera): Vector3 | null;
};

/**
 * Cached processed sticks, signed button differences, and an optional world-space
 * focus point for one frame. Continuous button values are filtered during acceptance.
 */
type ArcballInput = {
  rotateX: number;
  rotateY: number;
  panX: number;
  panY: number;
  zoom: number;
  zRotation: number;
  focus: Vector3 | null;
};

/**
 * Accepted frame deltas: rotation in radians, pan in virtual trackball space,
 * a positive finite zoom factor (`1` is neutral), and an optional focus point.
 */
type ArcballActions = Omit<ArcballInput, "zoom"> & { zoomSize: number };

/**
 * Adds gamepad support to Three.js `ArcballControls`.
 *
 * Call `update()` inside the render loop to poll gamepad input and apply
 * Arcball transformations. The wrapped `ArcballControls.update()` is only
 * needed after manual camera or target changes, matching Arcball's native API.
 * Gamepad `start`, `change`, and `end` events are dispatched on the native controls.
 * The balanced session belongs to this wrapper, including isolated focus commands.
 * Zoom and focus preserve native `adjustNearFar` clipping and projection behavior,
 * including restoration of the native initial planes on the next scale operation
 * after adjustment is disabled. Focus without zoom leaves clipping unchanged.
 */
export class GamepadArcballControls extends GamepadControls {
  readonly #controls: ArcballControlsWithRuntimeHelpers;
  readonly #options: ResolvedGamepadArcballControlsOptions;
  readonly #centerNdc: Vector2;
  readonly #panStart: Vector3;
  readonly #panEnd: Vector3;
  readonly #rotationAxis: Vector3;
  readonly #cameraForward: Vector3;
  readonly #cameraRight: Vector3;
  readonly #previousUp: Vector3;
  readonly #scaleMatrix = new Matrix4();
  readonly #gizmoBounds = new Box3();
  readonly #gizmoSphere = new Sphere();

  /** Whether this wrapper owns an active gamepad interaction. */
  #wasInteracting = false;
  /** Blocks recursive updates while a frame is being processed. */
  #updating = false;
  /** Blocks recursive updates while the owned interaction is ending. */
  #ending = false;

  /**
   * @param controls - A Three.js `ArcballControls` instance.
   * @param options - Optional overrides for the default behavior.
   *                  Any property not provided falls back to its default value.
   */
  constructor(
    controls: ArcballControls,
    options?: Partial<GamepadArcballControlsOptions>,
  ) {
    super(options);
    this.#controls = controls as ArcballControlsWithRuntimeHelpers;
    this.#options = {
      ...DEFAULT_ARCBALL_OPTIONS,
      ...options,
      rotateStick: resolveGamepadStickBinding(
        DEFAULT_ARCBALL_OPTIONS.rotateStick,
        options?.rotateStick,
      ),
      panStick: resolveGamepadStickBinding(
        DEFAULT_ARCBALL_OPTIONS.panStick,
        options?.panStick,
      ),
    };
    this.#centerNdc = new Vector2(0, 0);
    this.#panStart = new Vector3();
    this.#panEnd = new Vector3();
    this.#rotationAxis = new Vector3();
    this.#cameraForward = new Vector3();
    this.#cameraRight = new Vector3();
    this.#previousUp = new Vector3();
  }

  /**
   * Polls and applies gamepad input, ignoring updates from synchronous native listeners.
   * Pausing through `enabled` retains the owned interaction until input resumes,
   * the gamepad disconnects, or the wrapper is disposed.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  public override update(deltaTime: number): void {
    if (this.#updating || this.#ending) {
      return;
    }
    this.#updating = true;
    try {
      super.update(deltaTime);
    } finally {
      this.#updating = false;
    }
  }

  /**
   * Reads each binding once and applies accepted Arcball transforms in one session.
   * Revalidates the cached frame after `start` and `change`; an isolated focus
   * command ends immediately, while continuous input keeps the session open.
   *
   * @param deltaTime - Seconds elapsed for this input frame.
   */
  protected override onUpdate(deltaTime: number): void {
    if (!this.#canApplyInput()) {
      return;
    }
    const {
      rotateStick,
      panStick,
      buttonZoomIn,
      buttonZoomOut,
      buttonZRotateLeft,
      buttonZRotateRight,
      buttonFocus,
    } = this.#options;
    const input = this.gamepadInput;
    const rotate = input.stick(
      rotateStick.xAxis,
      rotateStick.yAxis,
      rotateStick.pipeline,
    );
    const pan = input.stick(panStick.xAxis, panStick.yAxis, panStick.pipeline);
    const frame = {
      rotateX: rotate.x,
      rotateY: rotate.y,
      panX: pan.x,
      panY: pan.y,
      zoom: input.buttonValue(buttonZoomIn) - input.buttonValue(buttonZoomOut),
      zRotation:
        input.buttonValue(buttonZRotateLeft) -
        input.buttonValue(buttonZRotateRight),
      focus: this.#consumeFocusPoint(buttonFocus),
    };
    let actions = this.#acceptActions(frame, deltaTime);
    if (actions === null) {
      return;
    }
    const controls = this.#controls;
    if (!this.#wasInteracting) {
      this.#wasInteracting = true;
      controls.dispatchEvent({ type: "start" });
      actions = this.#acceptActions(frame, deltaTime);
      if (actions === null) {
        return;
      }
    }
    let changed = this.#applyRotation(actions.rotateX, actions.rotateY);
    changed = this.#applyPan(actions.panX, actions.panY) || changed;
    changed = this.#applyZoom(actions.zoomSize) || changed;
    changed = this.#applyZRotation(actions.zRotation) || changed;
    changed = this.#applyFocus(actions.focus) || changed;
    if (changed) {
      controls.update();
      controls.updateMatrixState();
      controls.dispatchEvent({ type: "change" });
    }
    // Re-read permissions after change, using the already processed input.
    // A focus command is a one-shot and never keeps a session open alone.
    actions = this.#acceptActions(frame, deltaTime);
    if (actions !== null && !this.#hasContinuousInput(actions)) {
      this.#endInteraction();
    }
  }

  /**
   * Resolves a cached frame against current permissions, gains, and zoom validity.
   * Zero deltas and invalid or neutral zoom factors do not sustain an interaction.
   * Ends the owned session when neither continuous input nor focus remains accepted.
   *
   * @param frame - Already processed input and the focus point resolved for this frame.
   * @param delta - Frame duration in seconds.
   * @returns Accepted deltas and focus, or `null` when input application must stop.
   */
  #acceptActions(frame: ArcballInput, delta: number): ArcballActions | null {
    if (!this.#canApplyInput()) {
      return null;
    }
    const controls = this.#controls;
    const options = this.#options;
    const rotate = controls.enableRotate
      ? controls.rotateSpeed * options.rotateSpeed * delta * Math.PI
      : 0;
    const pan = controls.enablePan
      ? controls._tbRadius * options.panSpeed * delta
      : 0;
    const zRotation =
      controls.enableRotate &&
      Math.abs(frame.zRotation) > options.buttonDeadzone
        ? frame.zRotation * options.zRotateSpeed * delta * Math.PI
        : 0;
    let zoomSize = 1;
    if (
      controls.enableZoom &&
      Math.abs(frame.zoom) > options.buttonDeadzone &&
      controls.scaleFactor > 0
    ) {
      const size =
        controls.scaleFactor **
        (frame.zoom * options.zoomSpeed * delta * ZOOM_NOTCHES_PER_SECOND);
      if (Number.isFinite(size) && size > 0) {
        zoomSize = size;
      }
    }
    const actions: ArcballActions = {
      rotateX: frame.rotateX * rotate,
      rotateY: frame.rotateY * rotate,
      panX: frame.panX * pan,
      panY: frame.panY * pan,
      zoomSize,
      zRotation,
      focus: controls.enablePan && controls.enableFocus ? frame.focus : null,
    };
    if (!this.#hasContinuousInput(actions) && actions.focus === null) {
      this.#endInteraction();
      return null;
    }
    return actions;
  }

  /**
   * Checks whether accepted movement can sustain a session, excluding one-shot focus.
   *
   * @param actions - Frame deltas already resolved against current permissions and gains.
   * @returns `true` when any rotation, pan, or zoom delta is non-neutral.
   */
  #hasContinuousInput(actions: ArcballActions): boolean {
    return (
      actions.rotateX !== 0 ||
      actions.rotateY !== 0 ||
      actions.panX !== 0 ||
      actions.panY !== 0 ||
      actions.zoomSize !== 1 ||
      actions.zRotation !== 0
    );
  }

  /**
   * Removes gamepad listeners and ends only this wrapper's active interaction.
   * Repeated calls are safe; the native Arcball instance is not disposed.
   */
  public override dispose(): void {
    super.dispose();
    this.#endInteraction();
  }

  /**
   * Ends the owned interaction before forwarding the active gamepad's disconnection.
   *
   * @param gamepad - The gamepad that just disconnected.
   */
  protected override onGamepadDisconnected(gamepad: Gamepad): void {
    this.#endInteraction();
    super.onGamepadDisconnected(gamepad);
  }

  /**
   * Checks whether input remains applicable after a synchronous native callback.
   * Native disable ends the owned session; a wrapper pause retains it until resume,
   * disconnection, or disposal.
   *
   * @returns `true` when the wrapper and native controls are enabled and a gamepad is available.
   */
  #canApplyInput(): boolean {
    if (!this.#controls.enabled) {
      this.#endInteraction();
      return false;
    }
    return this.enabled && this.gamepad !== null;
  }

  /**
   * Applies accepted angular deltas through native rotation helpers.
   *
   * @param rotateX - Horizontal rotation delta in radians.
   * @param rotateY - Vertical rotation delta in radians.
   * @returns `true` when at least one rotation transform was applied.
   */
  #applyRotation(rotateX: number, rotateY: number): boolean {
    const controls = this.#controls;
    let changed = false;
    if (rotateX !== 0) {
      this.#rotationAxis.copy(controls.object.up).normalize();
      changed = this.#applyRotationAroundAxis(this.#rotationAxis, rotateX);
    }
    if (rotateY !== 0) {
      controls.object.getWorldDirection(this.#cameraForward);
      this.#cameraRight
        .crossVectors(this.#cameraForward, controls.object.up)
        .normalize();
      changed =
        this.#applyRotationAroundAxis(this.#cameraRight, -rotateY) || changed;
    }
    return changed;
  }

  /**
   * Applies an Arcball rotation around a specific world axis.
   *
   * @param axis - World axis to rotate around.
   * @param angle - Rotation amount in radians.
   * @returns `true` when ArcballControls produced and applied a transform.
   */
  #applyRotationAroundAxis(axis: Vector3, angle: number): boolean {
    if (axis.lengthSq() === 0 || angle === 0) {
      return false;
    }
    const controls = this.#controls;
    controls.updateMatrixState();
    this.#previousUp.copy(controls.object.up);
    this.#applyTransform(controls.rotate(axis, angle));
    controls.object.up.copy(this.#previousUp).applyAxisAngle(axis, -angle);
    return true;
  }

  /**
   * Applies accepted pan deltas between two virtual trackball points.
   *
   * @param panX - Horizontal displacement in Arcball's virtual trackball space.
   * @param panY - Vertical displacement in Arcball's virtual trackball space.
   * @returns `true` when a nonzero pan transform was applied.
   */
  #applyPan(panX: number, panY: number): boolean {
    if (panX === 0 && panY === 0) {
      return false;
    }
    const controls = this.#controls;
    controls.updateMatrixState();
    this.#panStart.set(0, 0, 0);
    this.#panEnd.set(panX, panY, 0);
    this.#applyTransform(controls.pan(this.#panStart, this.#panEnd));
    return true;
  }

  /**
   * Applies an accepted zoom factor around the native gizmo center.
   *
   * @param size - Positive finite scale factor; `1` leaves zoom unchanged.
   * @returns `true` when the factor is non-neutral and the native helper returns a transform.
   */
  #applyZoom(size: number): boolean {
    if (size === 1) {
      return false;
    }
    const controls = this.#controls;
    controls.updateMatrixState();
    const transformation = controls.scale(size, controls._gizmos.position);
    if (transformation === undefined) {
      return false;
    }
    this.#applyScaleTransform(transformation);
    controls.updateMatrixState();
    return true;
  }

  /**
   * Applies accepted rotation around the view axis and updates the camera's up vector.
   *
   * @param angle - Rotation delta in radians.
   * @returns `true` when a nonzero rotation transform was applied.
   */
  #applyZRotation(angle: number): boolean {
    if (angle === 0) {
      return false;
    }
    const controls = this.#controls;
    controls.updateMatrixState();
    controls.object.getWorldDirection(controls._rotationAxis);
    this.#previousUp.copy(controls.object.up);
    this.#applyTransform(controls.zRotate(controls._gizmos.position, angle));
    controls.object.up
      .copy(this.#previousUp)
      .applyAxisAngle(controls._rotationAxis, angle);
    return true;
  }

  /**
   * Focuses ArcballControls on the given point when one was consumed.
   *
   * @param point - World-space focus point, or `null` when no focus is pending.
   * @returns `true` when focus was applied.
   */
  #applyFocus(point: Vector3 | null): boolean {
    if (point === null) {
      return false;
    }
    const controls = this.#controls;
    controls.updateMatrixState();
    // focus() translates its cached baselines before applying scale. Route only
    // that synchronous transform through our state-independent scale applicator.
    const descriptor = Object.getOwnPropertyDescriptor(
      controls,
      "applyTransformMatrix",
    );
    const applyScale = (transformation: ArcballTransformation): void => {
      this.#applyScaleTransform(transformation);
    };
    controls.applyTransformMatrix = applyScale;
    try {
      controls.focus(point, controls.scaleFactor);
    } finally {
      if (controls.applyTransformMatrix === applyScale) {
        if (descriptor) {
          Object.defineProperty(controls, "applyTransformMatrix", descriptor);
        } else {
          Reflect.deleteProperty(controls, "applyTransformMatrix");
        }
      }
    }
    controls.updateMatrixState();
    return true;
  }

  /**
   * Applies a transformation returned by an Arcball runtime helper.
   *
   * @param transformation - Arcball transformation matrices to apply.
   */
  #applyTransform(transformation: ArcballTransformation): void {
    this.#controls.applyTransformMatrix(transformation);
    this.#controls.updateMatrixState();
  }

  /**
   * Applies native scale matrices and geometric side effects exactly once.
   * Arcball's own applicator gates these effects on inaccessible state Symbols.
   * Reproduce its scale/focus branch without entering or borrowing pointer state;
   * native scale() and focus() still own the transformation and limit calculations.
   * Cached baselines must stay intact until focus() restores its temporary ones.
   *
   * @param transformation - Native camera and gizmo scale transformations.
   */
  #applyScaleTransform(transformation: ArcballTransformation): void {
    const controls = this.#controls;
    const camera = controls.object;
    const gizmos = controls._gizmos;
    if (transformation.camera !== null) {
      this.#scaleMatrix
        .copy(controls._cameraMatrixState)
        .premultiply(transformation.camera)
        .decompose(camera.position, camera.quaternion, camera.scale);
      camera.updateMatrix();
    }
    if (transformation.gizmos !== null) {
      this.#scaleMatrix
        .copy(controls._gizmoMatrixState)
        .premultiply(transformation.gizmos)
        .decompose(gizmos.position, gizmos.quaternion, gizmos.scale);
      gizmos.updateMatrix();
    }
    controls._tbRadius = controls.calculateTbRadius(camera);
    if (controls.adjustNearFar) {
      const distance = camera.position.distanceTo(gizmos.position);
      this.#gizmoBounds
        .setFromObject(gizmos)
        .getBoundingSphere(this.#gizmoSphere);
      const { radius, center } = this.#gizmoSphere;
      const adjustedNear = Math.max(
        controls._nearPos0,
        radius + center.length(),
      );
      const adjustedFar = Math.min(
        controls._farPos0,
        -radius + center.length(),
      );
      camera.near =
        distance - Math.min(adjustedNear, distance - controls._initialNear);
      camera.far =
        distance - Math.min(adjustedFar, distance - controls._initialFar);
      camera.updateProjectionMatrix();
    } else if (
      camera.near !== controls._initialNear ||
      camera.far !== controls._initialFar
    ) {
      camera.near = controls._initialNear;
      camera.far = controls._initialFar;
      camera.updateProjectionMatrix();
    }
  }

  /**
   * Consumes a focus-button press and resolves the viewport center hit point.
   *
   * @param buttonFocus - Button index configured for focus.
   * @returns The center hit point, or `null` when focus should not run.
   */
  #consumeFocusPoint(buttonFocus: number): Vector3 | null {
    const controls = this.#controls;
    const shouldFocus = this.gamepadInput.wasPressed(buttonFocus);
    if (
      !shouldFocus ||
      !controls.enabled ||
      !controls.enablePan ||
      !controls.enableFocus ||
      controls.scene === null
    ) {
      return null;
    }
    return controls.unprojectOnObj(this.#centerNdc, controls.object);
  }

  /**
   * Releases session ownership before dispatching the native `end` event once.
   * Blocks recursive updates during finalization, including disconnection and disposal.
   */
  #endInteraction(): void {
    if (!this.#wasInteracting) {
      return;
    }
    this.#wasInteracting = false;
    this.#ending = true;
    try {
      this.#controls.dispatchEvent({ type: "end" });
    } finally {
      this.#ending = false;
    }
  }
}
