import {
  type Camera,
  Matrix4,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  Quaternion,
  Vector2,
  Vector3,
} from "three";
import type {
  TransformControls,
  TransformControlsMode,
} from "three/addons/controls/TransformControls.js";

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
 * Configuration for {@link GamepadTransformControls}.
 *
 * Every property has a sensible default, so you only need to pass the properties you want to override.
 */
export type GamepadTransformControlsOptions = GamepadControlsOptions & {
  /**
   * Screen-relative translation speed multiplier.
   * @default 1.0
   */
  translateSpeed: number;

  /**
   * Rotation speed multiplier.
   * @default 1.0
   */
  rotateSpeed: number;

  /**
   * Scale speed multiplier.
   * @default 1.0
   */
  scaleSpeed: number;

  /**
   * Stick binding used for translation, rotation, and scaling.
   * @default Left stick with the default stick pipeline
   */
  transformStick: GamepadStickBindingOptions;

  /**
   * Button index for selecting translate mode.
   * @default 0 - South face button
   */
  buttonTranslate: number;

  /**
   * Button index for selecting rotate mode.
   * @default 1 - East face button
   */
  buttonRotate: number;

  /**
   * Button index for selecting scale mode.
   * @default 2 - West face button
   */
  buttonScale: number;

  /**
   * Button index for toggling world/local space.
   * @default 3 - North face button
   */
  buttonToggleSpace: number;

  /**
   * Button index for selecting the X axis.
   * @default 15 - D-pad right
   */
  buttonAxisX: number;

  /**
   * Button index for selecting the Y axis.
   * @default 12 - D-pad up
   */
  buttonAxisY: number;

  /**
   * Button index for selecting the Z axis.
   * @default 14 - D-pad left
   */
  buttonAxisZ: number;

  /**
   * Button index for cycling composite axes in the active mode.
   * @default 13 - D-pad down
   */
  buttonAxisComposite: number;

  /**
   * Button index for selecting the previous valid axis.
   * @default 4 - Left shoulder
   */
  buttonAxisPrevious: number;

  /**
   * Button index for selecting the next valid axis.
   * @default 5 - Right shoulder
   */
  buttonAxisNext: number;

  /**
   * Button index for resetting the active transform.
   * @default 9 - Start button
   */
  buttonReset: number;
};

type ResolvedGamepadTransformControlsOptions = Omit<
  GamepadTransformControlsOptions,
  "transformStick"
> & {
  transformStick: GamepadStickBinding;
};

// Default options merged in the constructor when no explicit configuration is provided.
const DEFAULT_TRANSFORM_OPTIONS: ResolvedGamepadTransformControlsOptions = {
  translateSpeed: 1.0,
  rotateSpeed: 1.0,
  scaleSpeed: 1.0,
  transformStick: {
    xAxis: GAMEPAD_AXIS.LeftX,
    yAxis: GAMEPAD_AXIS.LeftY,
    pipeline: DEFAULT_GAMEPAD_STICK_PIPELINE,
  },
  buttonTranslate: GAMEPAD_BUTTON.South,
  buttonRotate: GAMEPAD_BUTTON.East,
  buttonScale: GAMEPAD_BUTTON.West,
  buttonToggleSpace: GAMEPAD_BUTTON.North,
  buttonAxisX: GAMEPAD_BUTTON.DPadRight,
  buttonAxisY: GAMEPAD_BUTTON.DPadUp,
  buttonAxisZ: GAMEPAD_BUTTON.DPadLeft,
  buttonAxisComposite: GAMEPAD_BUTTON.DPadDown,
  buttonAxisPrevious: GAMEPAD_BUTTON.LeftShoulder,
  buttonAxisNext: GAMEPAD_BUTTON.RightShoulder,
  buttonReset: GAMEPAD_BUTTON.Start,
};

type TransformAxis =
  | "X"
  | "Y"
  | "Z"
  | "E"
  | "XY"
  | "YZ"
  | "XZ"
  | "XYZ"
  | "XYZE";

type AxisLetter = "X" | "Y" | "Z";
type TransformSpace = "world" | "local";

type RuntimeTransformControls = TransformControls & {
  // Object currently attached to TransformControls.
  object: Object3D | undefined;

  // Active TransformControls axis or plane.
  axis: TransformAxis | null;

  // Minimum allowed local X position.
  minX: number;

  // Maximum allowed local X position.
  maxX: number;

  // Minimum allowed local Y position.
  minY: number;

  // Maximum allowed local Y position.
  maxY: number;

  // Minimum allowed local Z position.
  minZ: number;

  // Maximum allowed local Z position.
  maxZ: number;

  // Internal start position captured by TransformControls during a drag.
  _positionStart: Vector3;

  // Internal start quaternion captured by TransformControls during a drag.
  _quaternionStart: Quaternion;

  // Internal start scale captured by TransformControls during a drag.
  _scaleStart: Vector3;

  // Internal pointer start point used by TransformControls.
  pointStart: Vector3;

  // Internal pointer end point used by TransformControls.
  pointEnd: Vector3;
};

const MODE_AXES: Record<TransformControlsMode, readonly TransformAxis[]> = {
  translate: ["X", "Y", "Z", "XY", "YZ", "XZ", "XYZ"],
  rotate: ["X", "Y", "Z", "E", "XYZE"],
  scale: ["X", "Y", "Z", "XYZ"],
};

const COMPOSITE_AXES: Record<TransformControlsMode, readonly TransformAxis[]> =
  {
    translate: ["XY", "YZ", "XZ", "XYZ"],
    rotate: ["E", "XYZE"],
    scale: ["XYZ"],
  };

const PROJECTED_AXIS_EPSILON = 0.001;

/**
 * Adds gamepad support to Three.js `TransformControls`.
 *
 * Modes and axes are selected explicitly with buttons. Moving the transform
 * stick starts a native-style transform interaction, and releasing it ends
 * the interaction while keeping the active axis highlighted.
 */
export class GamepadTransformControls extends GamepadControls {
  readonly #controls: RuntimeTransformControls;
  readonly #options: ResolvedGamepadTransformControlsOptions;

  readonly #activeAxisByMode: Record<
    TransformControlsMode,
    TransformAxis | null
  >;

  readonly #viewSize: Vector2;
  readonly #parentInverse: Matrix4;
  readonly #cameraWorldPosition: Vector3;
  readonly #cameraForward: Vector3;
  readonly #cameraRight: Vector3;
  readonly #cameraUp: Vector3;
  readonly #eye: Vector3;
  readonly #axisWorld: Vector3;
  readonly #axisWorld2: Vector3;
  readonly #axisLocal: Vector3;
  readonly #worldDelta: Vector3;
  readonly #localDelta: Vector3;
  readonly #worldPositionStart: Vector3;
  readonly #worldPosition: Vector3;
  readonly #positionStart: Vector3;
  readonly #accumulatedPosition: Vector3;
  readonly #snappedPosition: Vector3;
  readonly #parentPosition: Vector3;
  readonly #parentScale: Vector3;
  readonly #scaleStart: Vector3;
  readonly #accumulatedScale: Vector3;
  readonly #snappedScale: Vector3;
  readonly #worldQuaternionStart: Quaternion;
  readonly #quaternionStart: Quaternion;
  readonly #parentQuaternion: Quaternion;
  readonly #parentQuaternionInv: Quaternion;
  readonly #rotationQuaternion: Quaternion;
  readonly #rotationQuaternion2: Quaternion;
  readonly #tempQuaternion: Quaternion;

  #isTransforming = false;
  #rotationAmount = 0;
  #freeRotationX = 0;
  #freeRotationY = 0;

  /**
   * @param controls - A Three.js `TransformControls` instance.
   * @param options - Optional overrides for the default behavior.
   *                  Any property not provided falls back to its default value.
   */
  constructor(
    controls: TransformControls,
    options?: Partial<GamepadTransformControlsOptions>,
  ) {
    super(options);
    this.#controls = controls as RuntimeTransformControls;
    this.#options = {
      ...DEFAULT_TRANSFORM_OPTIONS,
      ...options,
      transformStick: resolveGamepadStickBinding(
        DEFAULT_TRANSFORM_OPTIONS.transformStick,
        options?.transformStick,
      ),
    };

    this.#activeAxisByMode = {
      translate: "X",
      rotate: "X",
      scale: "X",
    };

    this.#viewSize = new Vector2();
    this.#parentInverse = new Matrix4();
    this.#cameraWorldPosition = new Vector3();
    this.#cameraForward = new Vector3();
    this.#cameraRight = new Vector3();
    this.#cameraUp = new Vector3();
    this.#eye = new Vector3();
    this.#axisWorld = new Vector3();
    this.#axisWorld2 = new Vector3();
    this.#axisLocal = new Vector3();
    this.#worldDelta = new Vector3();
    this.#localDelta = new Vector3();
    this.#worldPositionStart = new Vector3();
    this.#worldPosition = new Vector3();
    this.#positionStart = new Vector3();
    this.#accumulatedPosition = new Vector3();
    this.#snappedPosition = new Vector3();
    this.#parentPosition = new Vector3();
    this.#parentScale = new Vector3(1, 1, 1);
    this.#scaleStart = new Vector3();
    this.#accumulatedScale = new Vector3();
    this.#snappedScale = new Vector3();
    this.#worldQuaternionStart = new Quaternion();
    this.#quaternionStart = new Quaternion();
    this.#parentQuaternion = new Quaternion();
    this.#parentQuaternionInv = new Quaternion();
    this.#rotationQuaternion = new Quaternion();
    this.#rotationQuaternion2 = new Quaternion();
    this.#tempQuaternion = new Quaternion();
  }

  /**
   * Maps the current gamepad state to `TransformControls` mode, axis,
   * translate, rotate, scale, and reset behavior.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  protected override onUpdate(deltaTime: number): void {
    const startedButtons = this.#getStartedButtons();

    this.#handleModeAndAxisButtons(startedButtons);

    if (startedButtons.has(this.#options.buttonReset)) {
      this.#resetActiveTransform();
    }

    const controls = this.#controls;

    if (!controls.enabled || controls.object === undefined) {
      this.#endTransform(true);
      return;
    }

    const axis = this.#ensureValidAxis();

    if (axis === null) {
      this.#endTransform(true);
      return;
    }

    const { transformStick } = this.#options;
    const transform = this.gamepadInput.stick(
      transformStick.xAxis,
      transformStick.yAxis,
      transformStick.pipeline,
    );

    if (transform.x === 0 && transform.y === 0) {
      this.#endTransform(false);
      return;
    }

    if (!this.#isTransforming && !this.#startTransform()) {
      return;
    }

    if (this.#applyCurrentTransform(deltaTime, transform.x, transform.y)) {
      controls.dispatchEvent({ type: "change" });
      controls.dispatchEvent({ type: "objectChange" });
    }
  }

  /**
   * Ends any active transform before disposing the gamepad lifecycle listeners.
   */
  public override dispose(): void {
    this.#endTransform(true);
    super.dispose();
  }

  /**
   * Ends any active transform if the active gamepad disconnects mid-drag.
   *
   * @param gamepad - The gamepad that just disconnected.
   */
  protected override onGamepadDisconnected(gamepad: Gamepad): void {
    this.#endTransform(true);
    super.onGamepadDisconnected(gamepad);
  }

  /**
   * Applies mode, space, and axis button transitions from the current frame.
   *
   * @param startedButtons - Button indices that transitioned to pressed.
   */
  #handleModeAndAxisButtons(startedButtons: Set<number>): void {
    const {
      buttonTranslate,
      buttonRotate,
      buttonScale,
      buttonToggleSpace,
      buttonAxisX,
      buttonAxisY,
      buttonAxisZ,
      buttonAxisComposite,
      buttonAxisPrevious,
      buttonAxisNext,
    } = this.#options;

    if (startedButtons.has(buttonTranslate)) {
      this.#setMode("translate");
    }

    if (startedButtons.has(buttonRotate)) {
      this.#setMode("rotate");
    }

    if (startedButtons.has(buttonScale)) {
      this.#setMode("scale");
    }

    if (startedButtons.has(buttonToggleSpace)) {
      this.#toggleSpace();
    }

    if (startedButtons.has(buttonAxisX)) {
      this.#selectAxis("X");
    }

    if (startedButtons.has(buttonAxisY)) {
      this.#selectAxis("Y");
    }

    if (startedButtons.has(buttonAxisZ)) {
      this.#selectAxis("Z");
    }

    if (startedButtons.has(buttonAxisComposite)) {
      this.#cycleCompositeAxis();
    }

    if (startedButtons.has(buttonAxisPrevious)) {
      this.#cycleAxis(-1);
    }

    if (startedButtons.has(buttonAxisNext)) {
      this.#cycleAxis(1);
    }
  }

  /**
   * Switches TransformControls mode and refreshes the active axis.
   *
   * @param mode - TransformControls mode to activate.
   */
  #setMode(mode: TransformControlsMode): void {
    if (this.#controls.mode === mode) {
      return;
    }

    this.#endTransform(false);
    this.#controls.setMode(mode);
    this.#ensureValidAxis();
  }

  // Toggles TransformControls between local and world transform space.
  #toggleSpace(): void {
    const nextSpace = this.#controls.space === "world" ? "local" : "world";
    this.#endTransform(false);
    this.#controls.setSpace(nextSpace);
  }

  /**
   * Selects an explicit axis when it is valid for the current mode.
   *
   * @param axis - Axis requested by the gamepad button mapping.
   */
  #selectAxis(axis: TransformAxis): void {
    if (!this.#isAxisAllowed(this.#controls.mode, axis)) {
      return;
    }

    this.#endTransform(false);
    this.#activeAxisByMode[this.#controls.mode] = axis;
    this.#ensureValidAxis();
  }

  // Cycles through composite axes available in the current mode.
  #cycleCompositeAxis(): void {
    const validAxes = this.#getVisibleAxes(COMPOSITE_AXES[this.#controls.mode]);

    this.#cycleThroughAxes(validAxes, 1);
  }

  /**
   * Cycles through all valid axes for the current mode.
   *
   * @param direction - `1` for next axis, `-1` for previous axis.
   */
  #cycleAxis(direction: -1 | 1): void {
    this.#cycleThroughAxes(this.#getValidAxes(this.#controls.mode), direction);
  }

  /**
   * Moves the active axis through a candidate axis list.
   *
   * @param axes - Candidate axes to cycle through.
   * @param direction - `1` for next axis, `-1` for previous axis.
   */
  #cycleThroughAxes(axes: readonly TransformAxis[], direction: -1 | 1): void {
    if (axes.length === 0) {
      this.#setActiveAxis(null);
      return;
    }

    this.#endTransform(false);

    const current = this.#activeAxisByMode[this.#controls.mode];
    const currentIndex = current === null ? -1 : axes.indexOf(current);
    const nextIndex =
      currentIndex === -1
        ? 0
        : (currentIndex + direction + axes.length) % axes.length;

    this.#activeAxisByMode[this.#controls.mode] = axes[nextIndex] ?? null;
    this.#ensureValidAxis();
  }

  /**
   * Ensures the highlighted TransformControls axis is valid and visible.
   *
   * @returns The active valid axis, or `null` when no axis is available.
   */
  #ensureValidAxis(): TransformAxis | null {
    const mode = this.#controls.mode;
    const current = this.#activeAxisByMode[mode];
    const validAxes = this.#getValidAxes(mode);
    const nextAxis =
      current !== null && validAxes.includes(current)
        ? current
        : (validAxes[0] ?? null);

    this.#activeAxisByMode[mode] = nextAxis;

    if (this.#controls.axis !== nextAxis) {
      this.#controls.axis = nextAxis;
    }

    return nextAxis;
  }

  /**
   * Updates both the remembered axis for the current mode and the control axis.
   *
   * @param axis - Axis to activate, or `null` to clear selection.
   */
  #setActiveAxis(axis: TransformAxis | null): void {
    this.#activeAxisByMode[this.#controls.mode] = axis;

    if (this.#controls.axis !== axis) {
      this.#controls.axis = axis;
    }
  }

  /**
   * Returns all visible axes supported by a TransformControls mode.
   *
   * @param mode - Mode whose axes should be inspected.
   * @returns Visible axes for the mode.
   */
  #getValidAxes(mode: TransformControlsMode): readonly TransformAxis[] {
    return this.#getVisibleAxes(MODE_AXES[mode]);
  }

  /**
   * Filters a list of axes to those enabled by TransformControls visibility flags.
   *
   * @param axes - Axes to inspect.
   * @returns Axes whose component visibility flags are enabled.
   */
  #getVisibleAxes(axes: readonly TransformAxis[]): readonly TransformAxis[] {
    const visibleAxes: TransformAxis[] = [];

    for (const axis of axes) {
      if (this.#isAxisVisible(axis)) {
        visibleAxes.push(axis);
      }
    }

    return visibleAxes;
  }

  /**
   * Checks whether an axis can be used in a mode and is currently visible.
   *
   * @param mode - TransformControls mode to validate against.
   * @param axis - Axis to validate.
   * @returns `true` when the axis is supported and visible.
   */
  #isAxisAllowed(mode: TransformControlsMode, axis: TransformAxis): boolean {
    return MODE_AXES[mode].includes(axis) && this.#isAxisVisible(axis);
  }

  /**
   * Reads TransformControls visibility flags for an axis or plane.
   *
   * @param axis - Axis whose visibility should be checked.
   * @returns `true` when all components required by the axis are visible.
   */
  #isAxisVisible(axis: TransformAxis): boolean {
    const controls = this.#controls;

    switch (axis) {
      case "X":
        return controls.showX;
      case "Y":
        return controls.showY;
      case "Z":
        return controls.showZ;
      case "XY":
        return controls.showX && controls.showY && controls.showXY;
      case "YZ":
        return controls.showY && controls.showZ && controls.showYZ;
      case "XZ":
        return controls.showX && controls.showZ && controls.showXZ;
      case "XYZ":
      case "XYZE":
        return controls.showX && controls.showY && controls.showZ;
      case "E":
        return true;
    }
  }

  /**
   * Starts a TransformControls drag interaction for the active object and axis.
   *
   * @returns `true` when a transform interaction was started.
   */
  #startTransform(): boolean {
    const controls = this.#controls;
    const object = controls.object;

    if (object === undefined || controls.axis === null) {
      return false;
    }

    this.#captureTransformStart(object);
    controls.dragging = true;
    this.#isTransforming = true;
    controls.dispatchEvent({
      type: "mouseDown",
      mode: controls.mode,
    });

    return true;
  }

  /**
   * Ends an active TransformControls drag interaction.
   *
   * @param clearAxis - Whether to clear the highlighted axis after ending.
   */
  #endTransform(clearAxis: boolean): void {
    const controls = this.#controls;

    if (this.#isTransforming) {
      this.#isTransforming = false;
      controls.dispatchEvent({
        type: "mouseUp",
        mode: controls.mode,
      });
      controls.dragging = false;
    }

    if (clearAxis) {
      this.#setActiveAxis(null);
    }
  }

  // Resets the active object to TransformControls' captured drag start state.
  #resetActiveTransform(): void {
    const object = this.#controls.object;

    if (!this.#isTransforming || object === undefined) {
      return;
    }

    this.#controls.reset();
    this.#accumulatedPosition.copy(object.position);
    this.#accumulatedScale.copy(object.scale);
    this.#rotationAmount = 0;
    this.#freeRotationX = 0;
    this.#freeRotationY = 0;
  }

  /**
   * Captures object and control state needed to apply gamepad transforms.
   *
   * @param object - Object attached to TransformControls.
   */
  #captureTransformStart(object: Object3D): void {
    object.updateWorldMatrix(true, false);
    object.parent?.updateWorldMatrix(true, false);

    this.#positionStart.copy(object.position);
    this.#quaternionStart.copy(object.quaternion);
    this.#scaleStart.copy(object.scale);
    this.#accumulatedPosition.copy(object.position);
    this.#accumulatedScale.copy(object.scale);

    object.matrixWorld.decompose(
      this.#worldPositionStart,
      this.#worldQuaternionStart,
      this.#snappedScale,
    );

    this.#captureParentTransform(object);

    this.#controls._positionStart.copy(this.#positionStart);
    this.#controls._quaternionStart.copy(this.#quaternionStart);
    this.#controls._scaleStart.copy(this.#scaleStart);
    this.#controls.pointStart.set(0, 0, 0);
    this.#controls.pointEnd.set(0, 0, 0);

    this.#rotationAmount = 0;
    this.#freeRotationX = 0;
    this.#freeRotationY = 0;
  }

  /**
   * Captures the attached object's parent world transform for local conversions.
   *
   * @param object - Object attached to TransformControls.
   */
  #captureParentTransform(object: Object3D): void {
    if (object.parent === null) {
      this.#parentPosition.set(0, 0, 0);
      this.#parentQuaternion.identity();
      this.#parentQuaternionInv.identity();
      this.#parentScale.set(1, 1, 1);
      return;
    }

    object.parent.updateWorldMatrix(true, false);
    object.parent.matrixWorld.decompose(
      this.#parentPosition,
      this.#parentQuaternion,
      this.#parentScale,
    );
    this.#parentQuaternionInv.copy(this.#parentQuaternion).invert();
  }

  /**
   * Dispatches the current stick input to the active TransformControls mode.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param transformX - Horizontal transform input after dead zone processing.
   * @param transformY - Vertical transform input after dead zone processing.
   * @returns `true` when the attached object changed.
   */
  #applyCurrentTransform(
    deltaTime: number,
    transformX: number,
    transformY: number,
  ): boolean {
    switch (this.#controls.mode) {
      case "translate":
        return this.#applyTranslate(deltaTime, transformX, transformY);
      case "rotate":
        return this.#applyRotate(deltaTime, transformX, transformY);
      case "scale":
        return this.#applyScale(deltaTime, transformX, transformY);
    }
  }

  /**
   * Applies translation in the selected axis, plane, or screen-facing plane.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param transformX - Horizontal transform input after dead zone processing.
   * @param transformY - Vertical transform input after dead zone processing.
   * @returns `true` when the attached object moved.
   */
  #applyTranslate(
    deltaTime: number,
    transformX: number,
    transformY: number,
  ): boolean {
    const controls = this.#controls;
    const object = controls.object;
    const axis = controls.axis;

    if (object === undefined || axis === null) {
      return false;
    }

    this.#updateCameraState(object);
    this.#worldDelta.set(0, 0, 0);

    const scale = controls.axis === "XYZ" ? "world" : controls.space;
    const speed =
      controls.axis === "XYZ"
        ? this.#options.translateSpeed * deltaTime
        : ((this.#viewSize.x + this.#viewSize.y) / 2) *
          this.#options.translateSpeed *
          deltaTime;

    if (axis === "XYZ") {
      this.#worldDelta.addScaledVector(
        this.#cameraRight,
        transformX * this.#viewSize.x * speed,
      );
      this.#worldDelta.addScaledVector(
        this.#cameraUp,
        -transformY * this.#viewSize.y * speed,
      );
    } else {
      this.#addAxisTranslation(axis, scale, transformX, transformY, speed);
    }

    if (this.#worldDelta.lengthSq() === 0) {
      return false;
    }

    this.#worldDeltaToLocalDelta(this.#worldDelta, this.#localDelta);
    this.#accumulatedPosition.add(this.#localDelta);
    this.#applyAccumulatedPosition(object, axis, scale);

    return true;
  }

  /**
   * Accumulates a world-space translation delta along selected axis letters.
   *
   * @param axis - Transform axis or plane currently selected.
   * @param space - Transform space used to resolve axis directions.
   * @param transformX - Horizontal transform input after dead zone processing.
   * @param transformY - Vertical transform input after dead zone processing.
   * @param distance - World-space distance scale for the frame.
   */
  #addAxisTranslation(
    axis: TransformAxis,
    space: TransformSpace,
    transformX: number,
    transformY: number,
    distance: number,
  ): void {
    for (const letter of ["X", "Y", "Z"] as const) {
      if (!axis.includes(letter)) {
        continue;
      }

      this.#getTransformAxisWorld(letter, space, this.#axisWorld);
      this.#worldDelta.addScaledVector(
        this.#axisWorld,
        this.#getProjectedAxisInput(
          this.#axisWorld,
          transformX,
          transformY,
          this.#getDominantInput(transformX, -transformY),
        ) * distance,
      );
    }
  }

  /**
   * Applies accumulated translation with snapping and bounds.
   *
   * @param object - Object attached to TransformControls.
   * @param axis - Transform axis or plane currently selected.
   * @param space - Transform space used for snapping.
   */
  #applyAccumulatedPosition(
    object: Object3D,
    axis: TransformAxis,
    space: TransformSpace,
  ): void {
    this.#snappedPosition.copy(this.#accumulatedPosition);

    if (this.#controls.translationSnap !== null) {
      this.#snapPosition(object, axis, space, this.#controls.translationSnap);
    }

    this.#snappedPosition.x = Math.max(
      this.#controls.minX,
      Math.min(this.#controls.maxX, this.#snappedPosition.x),
    );
    this.#snappedPosition.y = Math.max(
      this.#controls.minY,
      Math.min(this.#controls.maxY, this.#snappedPosition.y),
    );
    this.#snappedPosition.z = Math.max(
      this.#controls.minZ,
      Math.min(this.#controls.maxZ, this.#snappedPosition.z),
    );

    object.position.copy(this.#snappedPosition);
    object.updateMatrixWorld();
  }

  /**
   * Snaps the pending position in world or local transform space.
   *
   * @param object - Object attached to TransformControls.
   * @param axis - Axis letters that should be snapped.
   * @param space - Transform space used for snapping.
   * @param snap - Snap interval.
   */
  #snapPosition(
    object: Object3D,
    axis: TransformAxis,
    space: TransformSpace,
    snap: number,
  ): void {
    if (snap <= 0) {
      return;
    }

    if (space === "world") {
      this.#localPositionToWorld(object, this.#snappedPosition);

      for (const letter of ["X", "Y", "Z"] as const) {
        if (axis.includes(letter)) {
          this.#setVectorComponent(
            this.#worldPosition,
            letter,
            this.#snapValue(
              this.#getVectorComponent(this.#worldPosition, letter),
              snap,
            ),
          );
        }
      }

      this.#worldPositionToLocal(object, this.#worldPosition);
      return;
    }

    this.#tempQuaternion.copy(this.#quaternionStart).invert();
    this.#snappedPosition.applyQuaternion(this.#tempQuaternion);

    for (const letter of ["X", "Y", "Z"] as const) {
      if (axis.includes(letter)) {
        this.#setVectorComponent(
          this.#snappedPosition,
          letter,
          this.#snapValue(
            this.#getVectorComponent(this.#snappedPosition, letter),
            snap,
          ),
        );
      }
    }

    this.#snappedPosition.applyQuaternion(this.#quaternionStart);
  }

  /**
   * Applies rotation for the selected axis or free-rotation mode.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param transformX - Horizontal transform input after dead zone processing.
   * @param transformY - Vertical transform input after dead zone processing.
   * @returns `true` when the attached object rotated.
   */
  #applyRotate(
    deltaTime: number,
    transformX: number,
    transformY: number,
  ): boolean {
    const controls = this.#controls;
    const object = controls.object;
    const axis = controls.axis;

    if (object === undefined || axis === null) {
      return false;
    }

    this.#updateCameraState(object);

    const angleScale = this.#options.rotateSpeed * deltaTime * Math.PI;

    if (axis === "XYZE") {
      this.#freeRotationX += transformX * angleScale;
      this.#freeRotationY += -transformY * angleScale;
      this.#applyFreeRotation(object);

      return true;
    }

    let input: number;

    if (axis === "E") {
      this.#axisWorld.copy(this.#cameraForward).normalize();
      input = this.#getDominantInput(transformX, -transformY);
    } else if (axis === "X" || axis === "Y" || axis === "Z") {
      const space = controls.space;
      this.#getTransformAxisWorld(axis, space, this.#axisWorld);
      input = this.#getRotationAxisInput(
        this.#axisWorld,
        transformX,
        transformY,
      );
    } else {
      return false;
    }

    this.#rotationAmount += input * angleScale;
    const angle = this.#snapRotation(this.#rotationAmount);

    if (axis !== "E" && controls.space === "local") {
      this.#setUnitAxis(axis, this.#axisLocal);
      this.#rotationQuaternion.setFromAxisAngle(this.#axisLocal, angle);
      object.quaternion
        .copy(this.#quaternionStart)
        .multiply(this.#rotationQuaternion)
        .normalize();
    } else {
      this.#applyWorldRotation(object, this.#axisWorld, angle);
    }

    object.updateMatrixWorld();

    return true;
  }

  /**
   * Applies a rotation around a world-space axis while preserving local parent space.
   *
   * @param object - Object attached to TransformControls.
   * @param worldAxis - World-space axis to rotate around.
   * @param angle - Rotation amount in radians from the drag start.
   */
  #applyWorldRotation(
    object: Object3D,
    worldAxis: Vector3,
    angle: number,
  ): void {
    this.#axisLocal
      .copy(worldAxis)
      .applyQuaternion(this.#parentQuaternionInv)
      .normalize();
    this.#rotationQuaternion.setFromAxisAngle(this.#axisLocal, angle);
    object.quaternion
      .copy(this.#rotationQuaternion)
      .multiply(this.#quaternionStart)
      .normalize();
  }

  /**
   * Applies screen-relative free rotation from accumulated stick input.
   *
   * @param object - Object attached to TransformControls.
   */
  #applyFreeRotation(object: Object3D): void {
    const angleX = this.#snapRotation(this.#freeRotationX);
    const angleY = this.#snapRotation(this.#freeRotationY);

    this.#axisWorld.copy(this.#cameraUp).normalize();
    this.#axisWorld2.copy(this.#cameraRight).normalize();

    this.#axisLocal
      .copy(this.#axisWorld)
      .applyQuaternion(this.#parentQuaternionInv)
      .normalize();
    this.#rotationQuaternion.setFromAxisAngle(this.#axisLocal, angleX);

    this.#axisLocal
      .copy(this.#axisWorld2)
      .applyQuaternion(this.#parentQuaternionInv)
      .normalize();
    this.#rotationQuaternion2.setFromAxisAngle(this.#axisLocal, angleY);

    object.quaternion
      .copy(this.#rotationQuaternion2)
      .multiply(this.#rotationQuaternion)
      .multiply(this.#quaternionStart)
      .normalize();
    object.updateMatrixWorld();
  }

  /**
   * Applies scale along the selected axis or uniformly across all axes.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param transformX - Horizontal transform input after dead zone processing.
   * @param transformY - Vertical transform input after dead zone processing.
   * @returns `true` when the attached object scaled.
   */
  #applyScale(
    deltaTime: number,
    transformX: number,
    transformY: number,
  ): boolean {
    const controls = this.#controls;
    const object = controls.object;
    const axis = controls.axis;

    if (object === undefined || axis === null) {
      return false;
    }

    this.#updateCameraState(object);

    const input =
      axis === "XYZ"
        ? this.#getDominantInput(transformX, -transformY)
        : this.#getProjectedScaleInput(axis, transformX, transformY);
    const factor = Math.exp(input * this.#options.scaleSpeed * deltaTime);

    if (!Number.isFinite(factor) || factor === 1) {
      return false;
    }

    if (axis.includes("X")) {
      this.#accumulatedScale.x *= factor;
    }

    if (axis.includes("Y")) {
      this.#accumulatedScale.y *= factor;
    }

    if (axis.includes("Z")) {
      this.#accumulatedScale.z *= factor;
    }

    this.#snappedScale.copy(this.#accumulatedScale);

    if (controls.scaleSnap !== null && controls.scaleSnap > 0) {
      if (axis.includes("X")) {
        this.#snappedScale.x = this.#snapScale(
          this.#snappedScale.x,
          controls.scaleSnap,
        );
      }

      if (axis.includes("Y")) {
        this.#snappedScale.y = this.#snapScale(
          this.#snappedScale.y,
          controls.scaleSnap,
        );
      }

      if (axis.includes("Z")) {
        this.#snappedScale.z = this.#snapScale(
          this.#snappedScale.z,
          controls.scaleSnap,
        );
      }
    }

    object.scale.copy(this.#snappedScale);
    object.updateMatrixWorld();

    return true;
  }

  /**
   * Projects stick input onto the selected scale axis.
   *
   * @param axis - Transform axis or plane currently selected.
   * @param transformX - Horizontal transform input after dead zone processing.
   * @param transformY - Vertical transform input after dead zone processing.
   * @returns Signed scale input for the current frame.
   */
  #getProjectedScaleInput(
    axis: TransformAxis,
    transformX: number,
    transformY: number,
  ): number {
    if (axis !== "X" && axis !== "Y" && axis !== "Z") {
      return this.#getDominantInput(transformX, -transformY);
    }

    this.#getTransformAxisWorld(axis, "local", this.#axisWorld);

    return this.#getProjectedAxisInput(
      this.#axisWorld,
      transformX,
      transformY,
      this.#getDominantInput(transformX, -transformY),
    );
  }

  /**
   * Refreshes camera vectors, object world position, and viewport scale.
   *
   * @param object - Object attached to TransformControls.
   */
  #updateCameraState(object: Object3D): void {
    const camera = this.#controls.camera;

    camera.updateMatrixWorld();
    object.updateWorldMatrix(true, false);

    this.#cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    this.#cameraUp.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    camera.getWorldDirection(this.#cameraForward).normalize();
    camera.getWorldPosition(this.#cameraWorldPosition);
    this.#worldPosition.setFromMatrixPosition(object.matrixWorld);
    this.#eye
      .copy(this.#cameraWorldPosition)
      .sub(this.#worldPosition)
      .normalize();

    this.#updateViewSizeAtObjectDepth(camera);
  }

  /**
   * Computes world-space viewport size at the attached object's depth.
   *
   * @param camera - TransformControls camera.
   */
  #updateViewSizeAtObjectDepth(camera: Camera): void {
    if (this.#isOrthographicCamera(camera)) {
      this.#viewSize.set(
        Math.abs(camera.right - camera.left) / camera.zoom,
        Math.abs(camera.top - camera.bottom) / camera.zoom,
      );
      return;
    }

    if (this.#isPerspectiveCamera(camera)) {
      const depth = Math.max(
        Number.EPSILON,
        this.#worldPosition
          .subVectors(this.#worldPosition, this.#cameraWorldPosition)
          .dot(this.#cameraForward),
      );
      const height = 2 * Math.tan((camera.fov * Math.PI) / 360) * depth;
      this.#viewSize.set(height * camera.aspect, height);
      return;
    }

    this.#viewSize.set(1, 1);
  }

  /**
   * Resolves a transform axis letter to a normalized world-space direction.
   *
   * @param axis - Axis letter to resolve.
   * @param space - Transform space used to orient the axis.
   * @param target - Vector that receives the axis direction.
   * @returns The normalized target vector.
   */
  #getTransformAxisWorld(
    axis: AxisLetter,
    space: TransformSpace,
    target: Vector3,
  ): Vector3 {
    this.#setUnitAxis(axis, target);

    if (space === "local") {
      target.applyQuaternion(this.#worldQuaternionStart);
    }

    return target.normalize();
  }

  /**
   * Projects stick input onto the screen-space tangent of a rotation axis.
   *
   * @param axisWorld - Rotation axis in world space.
   * @param transformX - Horizontal transform input after dead zone processing.
   * @param transformY - Vertical transform input after dead zone processing.
   * @returns Signed rotation input for the current frame.
   */
  #getRotationAxisInput(
    axisWorld: Vector3,
    transformX: number,
    transformY: number,
  ): number {
    this.#axisWorld2.crossVectors(axisWorld, this.#eye);

    if (this.#axisWorld2.lengthSq() < PROJECTED_AXIS_EPSILON) {
      return this.#getDominantInput(transformX, -transformY);
    }

    return this.#getProjectedAxisInput(
      this.#axisWorld2.normalize(),
      transformX,
      transformY,
      this.#getDominantInput(transformX, -transformY),
    );
  }

  /**
   * Projects two-axis stick input onto a world axis as seen by the camera.
   *
   * @param axisWorld - World-space axis to project onto the screen.
   * @param transformX - Horizontal transform input after dead zone processing.
   * @param transformY - Vertical transform input after dead zone processing.
   * @param fallback - Value to use when the axis has no stable screen projection.
   * @returns Signed input along the projected axis.
   */
  #getProjectedAxisInput(
    axisWorld: Vector3,
    transformX: number,
    transformY: number,
    fallback: number,
  ): number {
    const screenX = axisWorld.dot(this.#cameraRight);
    const screenY = -axisWorld.dot(this.#cameraUp);
    const length = Math.hypot(screenX, screenY);

    if (length < PROJECTED_AXIS_EPSILON) {
      return fallback;
    }

    return (transformX * screenX + transformY * screenY) / length;
  }

  /**
   * Converts a world-space movement delta into the object's parent-local space.
   *
   * @param worldDelta - World-space delta to convert.
   * @param target - Vector that receives the local delta.
   * @returns The target vector containing the local delta.
   */
  #worldDeltaToLocalDelta(worldDelta: Vector3, target: Vector3): Vector3 {
    target.copy(worldDelta).applyQuaternion(this.#parentQuaternionInv);
    this.#divideByParentScale(target);

    return target;
  }

  /**
   * Converts a local position to world space into the reusable world position.
   *
   * @param object - Object whose parent space contains the local position.
   * @param localPosition - Local position to convert.
   */
  #localPositionToWorld(object: Object3D, localPosition: Vector3): void {
    if (object.parent === null) {
      this.#worldPosition.copy(localPosition);
      return;
    }

    object.parent.updateWorldMatrix(true, false);
    this.#worldPosition
      .copy(localPosition)
      .applyMatrix4(object.parent.matrixWorld);
  }

  /**
   * Converts a world position to object parent-local space into snapped position.
   *
   * @param object - Object whose parent space should receive the result.
   * @param worldPosition - World-space position to convert.
   */
  #worldPositionToLocal(object: Object3D, worldPosition: Vector3): void {
    if (object.parent === null) {
      this.#snappedPosition.copy(worldPosition);
      return;
    }

    object.parent.updateWorldMatrix(true, false);
    this.#parentInverse.copy(object.parent.matrixWorld).invert();
    this.#snappedPosition.copy(worldPosition).applyMatrix4(this.#parentInverse);
  }

  /**
   * Removes captured parent scale from a local-space delta.
   *
   * @param target - Vector to adjust in place.
   */
  #divideByParentScale(target: Vector3): void {
    target.x = this.#parentScale.x === 0 ? 0 : target.x / this.#parentScale.x;
    target.y = this.#parentScale.y === 0 ? 0 : target.y / this.#parentScale.y;
    target.z = this.#parentScale.z === 0 ? 0 : target.z / this.#parentScale.z;
  }

  /**
   * Writes a unit axis vector into a target vector.
   *
   * @param axis - Axis letter to write.
   * @param target - Vector that receives the unit axis.
   * @returns The target vector.
   */
  #setUnitAxis(axis: AxisLetter, target: Vector3): Vector3 {
    switch (axis) {
      case "X":
        return target.set(1, 0, 0);
      case "Y":
        return target.set(0, 1, 0);
      case "Z":
        return target.set(0, 0, 1);
    }
  }

  /**
   * Reads one component from a vector by axis letter.
   *
   * @param vector - Vector to inspect.
   * @param axis - Component axis to read.
   * @returns The selected component value.
   */
  #getVectorComponent(vector: Vector3, axis: AxisLetter): number {
    switch (axis) {
      case "X":
        return vector.x;
      case "Y":
        return vector.y;
      case "Z":
        return vector.z;
    }
  }

  /**
   * Writes one component on a vector by axis letter.
   *
   * @param vector - Vector to modify.
   * @param axis - Component axis to write.
   * @param value - Component value to assign.
   */
  #setVectorComponent(vector: Vector3, axis: AxisLetter, value: number): void {
    switch (axis) {
      case "X":
        vector.x = value;
        return;
      case "Y":
        vector.y = value;
        return;
      case "Z":
        vector.z = value;
        return;
    }
  }

  /**
   * Applies TransformControls rotation snapping to an angle.
   *
   * @param value - Angle in radians.
   * @returns Snapped angle, or the original angle when snapping is disabled.
   */
  #snapRotation(value: number): number {
    const snap = this.#controls.rotationSnap;

    return snap === null || snap <= 0 ? value : this.#snapValue(value, snap);
  }

  /**
   * Snaps a numeric value to the nearest interval.
   *
   * @param value - Value to snap.
   * @param snap - Snap interval.
   * @returns Value rounded to the nearest snap interval.
   */
  #snapValue(value: number, snap: number): number {
    return Math.round(value / snap) * snap;
  }

  /**
   * Snaps a scale component while avoiding zero scale.
   *
   * @param value - Scale component to snap.
   * @param snap - Snap interval.
   * @returns Snapped scale component.
   */
  #snapScale(value: number, snap: number): number {
    return this.#snapValue(value, snap) || snap;
  }

  /**
   * Chooses the larger-magnitude stick component for ambiguous transforms.
   *
   * @param inputX - Horizontal input component.
   * @param inputY - Vertical input component.
   * @returns The input component with the larger absolute magnitude.
   */
  #getDominantInput(inputX: number, inputY: number): number {
    return Math.abs(inputX) >= Math.abs(inputY) ? inputX : inputY;
  }

  /**
   * Returns configured button indices that were newly pressed this frame.
   *
   * @returns Button indices that transitioned to pressed.
   */
  #getStartedButtons(): Set<number> {
    const startedButtons = new Set<number>();
    const input = this.gamepadInput;
    const buttons = [
      this.#options.buttonTranslate,
      this.#options.buttonRotate,
      this.#options.buttonScale,
      this.#options.buttonToggleSpace,
      this.#options.buttonAxisX,
      this.#options.buttonAxisY,
      this.#options.buttonAxisZ,
      this.#options.buttonAxisComposite,
      this.#options.buttonAxisPrevious,
      this.#options.buttonAxisNext,
      this.#options.buttonReset,
    ];

    for (const button of buttons) {
      if (input.wasPressed(button)) {
        startedButtons.add(button);
      }
    }

    return startedButtons;
  }

  /**
   * Narrows a Three.js camera to `PerspectiveCamera`.
   *
   * @param camera - Camera to inspect.
   * @returns `true` when the camera is perspective.
   */
  #isPerspectiveCamera(camera: Camera): camera is PerspectiveCamera {
    return (camera as PerspectiveCamera).isPerspectiveCamera === true;
  }

  /**
   * Narrows a Three.js camera to `OrthographicCamera`.
   *
   * @param camera - Camera to inspect.
   * @returns `true` when the camera is orthographic.
   */
  #isOrthographicCamera(camera: Camera): camera is OrthographicCamera {
    return (camera as OrthographicCamera).isOrthographicCamera === true;
  }
}
