import {
  type Camera,
  type Matrix4,
  type Object3D,
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
  object: Camera;

  // Internal gizmo object used as the center for scale and z-rotation.
  _gizmos: Object3D;

  // Internal reusable axis vector used by ArcballControls z-rotation.
  _rotationAxis: Vector3;

  // Internal trackball radius used to scale pan deltas.
  _tbRadius: number;

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
 * Adds gamepad support to Three.js `ArcballControls`.
 *
 * Call `update()` inside the render loop to poll gamepad input and apply
 * Arcball transformations. The wrapped `ArcballControls.update()` is only
 * needed after manual camera or target changes, matching Arcball's native API.
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

  #wasInteracting = false;

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
   * Maps the current gamepad state to `ArcballControls` rotation, pan, zoom,
   * z-rotation, and center focus.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  protected override onUpdate(deltaTime: number): void {
    const controls = this.#controls;
    const {
      rotateSpeed,
      panSpeed,
      zoomSpeed,
      zRotateSpeed,
      rotateStick,
      panStick,
      buttonDeadzone,
      buttonZoomIn,
      buttonZoomOut,
      buttonZRotateLeft,
      buttonZRotateRight,
      buttonFocus,
    } = this.#options;
    const input = this.gamepadInput;

    const focusPoint = this.#consumeFocusPoint(buttonFocus);

    if (!controls.enabled) {
      this.#endInteraction();
      return;
    }

    let rotateX = 0;
    let rotateY = 0;
    if (controls.enableRotate) {
      const rotate = input.stick(
        rotateStick.xAxis,
        rotateStick.yAxis,
        rotateStick.pipeline,
      );
      rotateX = rotate.x;
      rotateY = rotate.y;
    }

    let panX = 0;
    let panY = 0;
    if (controls.enablePan) {
      const pan = input.stick(
        panStick.xAxis,
        panStick.yAxis,
        panStick.pipeline,
      );
      panX = pan.x;
      panY = pan.y;
    }
    const zoom = controls.enableZoom
      ? input.buttonValue(buttonZoomIn) - input.buttonValue(buttonZoomOut)
      : 0;
    const zRotation = controls.enableRotate
      ? input.buttonValue(buttonZRotateLeft) -
        input.buttonValue(buttonZRotateRight)
      : 0;

    const activeInput =
      rotateX !== 0 ||
      rotateY !== 0 ||
      panX !== 0 ||
      panY !== 0 ||
      Math.abs(zoom) > buttonDeadzone ||
      Math.abs(zRotation) > buttonDeadzone;

    if (!activeInput && focusPoint === null) {
      this.#endInteraction();
      return;
    }

    if (!this.#wasInteracting) {
      controls.dispatchEvent({ type: "start" });
    }

    let changed = false;

    changed =
      this.#applyRotation(deltaTime, rotateX, rotateY, rotateSpeed) || changed;
    changed = this.#applyPan(deltaTime, panX, panY, panSpeed) || changed;
    changed =
      this.#applyZoom(deltaTime, zoom, zoomSpeed, buttonDeadzone) || changed;
    changed =
      this.#applyZRotation(
        deltaTime,
        zRotation,
        zRotateSpeed,
        buttonDeadzone,
      ) || changed;
    changed = this.#applyFocus(focusPoint) || changed;

    if (changed) {
      controls.update();
      controls.updateMatrixState();
      controls.dispatchEvent({ type: "change" });
    }

    this.#wasInteracting = activeInput;

    if (!activeInput) {
      this.#endInteraction();
    }
  }

  /**
   * Applies gamepad stick rotation through Arcball's runtime rotation helper.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param rotateX - Horizontal rotation input after dead zone processing.
   * @param rotateY - Vertical rotation input after dead zone processing.
   * @param rotateSpeed - User-configured rotation speed multiplier.
   * @returns `true` when a rotation was applied.
   */
  #applyRotation(
    deltaTime: number,
    rotateX: number,
    rotateY: number,
    rotateSpeed: number,
  ): boolean {
    if (rotateX === 0 && rotateY === 0) {
      return false;
    }

    const controls = this.#controls;
    const amount = controls.rotateSpeed * rotateSpeed * deltaTime * Math.PI;
    let changed = false;

    if (rotateX !== 0) {
      this.#rotationAxis.copy(controls.object.up).normalize();
      changed =
        this.#applyRotationAroundAxis(this.#rotationAxis, rotateX * amount) ||
        changed;
    }

    if (rotateY !== 0) {
      controls.object.getWorldDirection(this.#cameraForward);
      this.#cameraRight
        .crossVectors(this.#cameraForward, controls.object.up)
        .normalize();
      changed =
        this.#applyRotationAroundAxis(this.#cameraRight, -rotateY * amount) ||
        changed;
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
   * Applies gamepad pan by converting stick input to Arcball trackball points.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param panX - Horizontal pan input after dead zone processing.
   * @param panY - Vertical pan input after dead zone processing.
   * @param panSpeed - User-configured pan speed multiplier.
   * @returns `true` when a pan transform was applied.
   */
  #applyPan(
    deltaTime: number,
    panX: number,
    panY: number,
    panSpeed: number,
  ): boolean {
    if (panX === 0 && panY === 0) {
      return false;
    }

    const controls = this.#controls;
    const distance = controls._tbRadius * panSpeed * deltaTime;

    controls.updateMatrixState();
    this.#panStart.set(0, 0, 0);
    this.#panEnd.set(panX * distance, panY * distance, 0);

    this.#applyTransform(controls.pan(this.#panStart, this.#panEnd));

    return true;
  }

  /**
   * Applies trigger-driven zoom around Arcball's gizmo center.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param zoom - Signed zoom input from the configured trigger pair.
   * @param zoomSpeed - User-configured zoom speed multiplier.
   * @param buttonDeadzone - Trigger dead zone threshold.
   * @returns `true` when a zoom transform was applied.
   */
  #applyZoom(
    deltaTime: number,
    zoom: number,
    zoomSpeed: number,
    buttonDeadzone: number,
  ): boolean {
    if (Math.abs(zoom) <= buttonDeadzone || this.#controls.scaleFactor <= 0) {
      return false;
    }

    const controls = this.#controls;
    const size =
      controls.scaleFactor **
      (zoom * zoomSpeed * deltaTime * ZOOM_NOTCHES_PER_SECOND);

    if (!Number.isFinite(size) || size <= 0 || size === 1) {
      return false;
    }

    controls.updateMatrixState();

    const transformation = controls.scale(size, controls._gizmos.position);

    if (transformation === undefined) {
      return false;
    }

    this.#applyTransform(transformation);

    return true;
  }

  /**
   * Applies shoulder-button rotation around the current camera view axis.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param zRotation - Signed z-rotation input from the configured buttons.
   * @param zRotateSpeed - User-configured z-rotation speed multiplier.
   * @param buttonDeadzone - Button value dead zone threshold.
   * @returns `true` when a z-rotation transform was applied.
   */
  #applyZRotation(
    deltaTime: number,
    zRotation: number,
    zRotateSpeed: number,
    buttonDeadzone: number,
  ): boolean {
    if (Math.abs(zRotation) <= buttonDeadzone) {
      return false;
    }

    const controls = this.#controls;
    const angle = zRotation * zRotateSpeed * deltaTime * Math.PI;

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
    controls.focus(point, controls.scaleFactor);
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

  // Dispatches Arcball's `end` event when an active gamepad interaction stops.
  #endInteraction(): void {
    if (!this.#wasInteracting) {
      return;
    }

    this.#controls.dispatchEvent({ type: "end" });
    this.#wasInteracting = false;
  }
}
