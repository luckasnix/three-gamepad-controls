import { Matrix4, type Object3D, Quaternion, Vector2, Vector3 } from "three";
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
import { getCameraViewSize } from "./three-utils.ts";

/**
 * Configuration for {@link GamepadTransformControls}.
 *
 * Every property has a sensible default, so you only need to pass the properties you want to override.
 */
export type GamepadTransformControlsOptions = GamepadControlsOptions & {
  /**
   * Screen-relative translation speed multiplier. `XYZ` uses effective viewport
   * width and height per second; constrained axes use their mean in world units
   * per second. Both are multiplied by the processed stick input.
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

type TranslateAxis = "X" | "Y" | "Z" | "XY" | "YZ" | "XZ" | "XYZ";

type RotateAxis = "X" | "Y" | "Z" | "E" | "XYZE";

type ScaleAxis = "X" | "Y" | "Z" | "XYZ";

type TransformAxis = TranslateAxis | RotateAxis | ScaleAxis;

type AxisLetter = "X" | "Y" | "Z";

type TransformSpace = "world" | "local";

type TransformContext = {
  object: Object3D | undefined;
  mode: TransformControlsMode;
  space: TransformSpace;
  axis: TransformControls["axis"];
  dragging: boolean;
  pointerRevision: number;
};

type TransformSegment = TransformContext & {
  object: Object3D;
  axis: TransformAxis;
  started: boolean;
};

type RuntimeTransformControls = TransformControls & {
  // Object currently attached to TransformControls.
  object: Object3D | undefined;

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
  readonly #cameraSpacePosition: Vector3;
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
  #segment: TransformSegment | null = null;
  #updating = false;
  #ending = false;
  #disposed = false;
  #interrupted = false;
  #needsNeutral = false;
  #pointerRevision = 0;
  readonly #mouseDownEvent = {
    type: "mouseDown" as const,
    mode: "translate" as TransformControlsMode,
  };
  readonly #onNativeMouseDown: (event: {
    type: "mouseDown";
    mode: TransformControlsMode;
  }) => void;
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
    this.#cameraSpacePosition = new Vector3();
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
    this.#onNativeMouseDown = (event) => {
      if (event !== this.#mouseDownEvent) {
        this.#pointerRevision += 1;
      }
    };
    controls.addEventListener("mouseDown", this.#onNativeMouseDown);
  }

  /**
   * Maps the current gamepad state to `TransformControls` mode, axis,
   * translate, rotate, scale, and reset behavior.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  protected override onUpdate(deltaTime: number): void {
    if (this.#updating || this.#ending) {
      return;
    }
    this.#updating = true;
    this.#interrupted = false;
    try {
      this.#updateTransform(deltaTime);
    } finally {
      this.#updating = false;
    }
  }

  /**
   * Processes one frame of selection, reset, and movement while respecting
   * segment ownership and the neutral input required before reacquisition.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  #updateTransform(deltaTime: number): void {
    const controls = this.#controls;
    const { transformStick } = this.#options;
    const transform = this.gamepadInput.stick(
      transformStick.xAxis,
      transformStick.yAxis,
      transformStick.pipeline,
    );
    const neutral = transform.x === 0 && transform.y === 0;
    this.#reconcileSegment();
    if (neutral) {
      this.#needsNeutral = false;
    }
    if (!this.#canApplyInput()) {
      return;
    }

    // A native pointer drag is not a gamepad session.
    if (controls.dragging && this.#segment === null) {
      this.#needsNeutral = !neutral;
      return;
    }

    const startedButtons = this.#getStartedButtons();
    this.#handleModeAndAxisButtons(startedButtons);
    if (!this.#canApplyInput()) {
      return;
    }
    if (startedButtons.has(this.#options.buttonReset)) {
      this.#resetActiveTransform();
    }
    if (!this.#canApplyInput()) {
      return;
    }
    const object = controls.object;
    if (object === undefined) {
      this.#endTransform(true);
      return;
    }
    if (neutral) {
      this.#endTransform(false);
      return;
    }
    if (this.#needsNeutral) {
      return;
    }
    const axis = this.#resolveAxis();
    this.#setActiveAxis(axis);
    if (!this.#canApplyInput()) {
      return;
    }
    if (axis === null) {
      return;
    }
    if (this.#segment === null) {
      this.#startTransform(object, axis);
    }
    if (!this.#canApplyInput()) {
      return;
    }
    const segment = this.#segment as TransformSegment;
    if (!segment.started) {
      segment.started = true;
      const context = this.#readContext();
      this.#mouseDownEvent.mode = segment.mode;
      controls.dispatchEvent(this.#mouseDownEvent);
      this.#afterCallback(context);
    }
    if (!this.#canApplyInput()) {
      return;
    }
    if (
      this.#applyCurrentTransform(
        object,
        axis,
        deltaTime,
        transform.x,
        transform.y,
      )
    ) {
      const context = this.#readContext();
      controls.dispatchEvent({ type: "change" });
      if (!this.#afterCallback(context)) {
        return;
      }
      controls.dispatchEvent({ type: "objectChange" });
      this.#afterCallback(context);
    }
  }

  /**
   * Disables gamepad updates and ends only this wrapper's active transform.
   */
  public override dispose(): void {
    super.dispose();
    this.#disposed = true;
    // A reentrant disposal must keep observing pointer starts until the outer
    // cleanup has finished all of its callbacks and conditional writes.
    if (this.#ending) {
      return;
    }
    try {
      this.#endTransform(true);
    } finally {
      this.#controls.removeEventListener("mouseDown", this.#onNativeMouseDown);
    }
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
   * Checks whether this update can continue applying gamepad input.
   * Native disable ends the owned segment; a wrapper pause retains it.
   *
   * @returns `true` when input remains enabled, a gamepad is available,
   *          and no callback has interrupted this update.
   */
  #canApplyInput(): boolean {
    if (!this.#controls.enabled) {
      this.#endTransform(true);
      return false;
    }
    return !this.#interrupted && this.enabled && this.gamepad !== null;
  }

  /**
   * Captures the native context and pointer acquisition revision without
   * modifying the control or copying the attached object's transform.
   *
   * @returns A context snapshot for segment and callback validation.
   */
  #readContext(): TransformContext {
    const { object, mode, space, axis, dragging } = this.#controls;
    return {
      object,
      mode,
      space,
      axis,
      dragging,
      pointerRevision: this.#pointerRevision,
    };
  }

  /**
   * Compares the current native context and pointer revision with a snapshot.
   *
   * @param context - Expected object, selection, dragging state, and pointer revision.
   * @returns `true` when every captured context field still matches.
   */
  #matchesContext(context: TransformContext): boolean {
    const controls = this.#controls;
    return (
      controls.object === context.object &&
      controls.mode === context.mode &&
      controls.space === context.space &&
      controls.axis === context.axis &&
      controls.dragging === context.dragging &&
      this.#pointerRevision === context.pointerRevision
    );
  }

  /**
   * Ends the owned segment when its context changes or its axis is disallowed.
   * A change of attached object also requires neutral input before reacquisition.
   */
  #reconcileSegment(): void {
    const segment = this.#segment;
    if (segment === null) {
      return;
    }
    if (
      !this.#matchesContext(segment) ||
      !this.#isAxisAllowed(segment.mode, segment.axis)
    ) {
      if (this.#controls.object !== segment.object) {
        this.#needsNeutral = true;
      }
      this.#endTransform(false);
    }
  }

  /**
   * Revalidates context, segment ownership, and permissions after synchronous
   * callbacks, interrupting this update if its context or segment was invalidated.
   *
   * @param context - Context expected after the operation that invoked callbacks.
   * @returns `true` when this update may continue applying gamepad input.
   */
  #afterCallback(context: TransformContext): boolean {
    const segment = this.#segment;
    if (!this.#matchesContext(context)) {
      this.#interrupted = true;
      if (this.#controls.object !== context.object) {
        this.#needsNeutral = true;
      }
    }
    this.#reconcileSegment();
    if (segment !== null && this.#segment !== segment) {
      this.#interrupted = true;
    }
    return this.#canApplyInput();
  }

  /**
   * Writes a native property and revalidates the context after its synchronous
   * notifications, accounting for the intended property change.
   *
   * @param key - Native selection or dragging property to update.
   * @param value - Value to assign to the selected property.
   */
  #writeProperty<K extends "axis" | "dragging">(
    key: K,
    value: TransformContext[K],
  ): void {
    const context = { ...this.#readContext(), [key]: value };
    const controls: Pick<TransformContext, "axis" | "dragging"> =
      this.#controls;
    controls[key] = value;
    this.#afterCallback(context);
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
    if (startedButtons.has(buttonTranslate) && this.#canApplyInput()) {
      this.#setMode("translate");
    }
    if (startedButtons.has(buttonRotate) && this.#canApplyInput()) {
      this.#setMode("rotate");
    }
    if (startedButtons.has(buttonScale) && this.#canApplyInput()) {
      this.#setMode("scale");
    }
    if (startedButtons.has(buttonToggleSpace) && this.#canApplyInput()) {
      this.#toggleSpace();
    }
    if (startedButtons.has(buttonAxisX) && this.#canApplyInput()) {
      this.#selectAxis("X");
    }
    if (startedButtons.has(buttonAxisY) && this.#canApplyInput()) {
      this.#selectAxis("Y");
    }
    if (startedButtons.has(buttonAxisZ) && this.#canApplyInput()) {
      this.#selectAxis("Z");
    }
    if (startedButtons.has(buttonAxisComposite) && this.#canApplyInput()) {
      this.#cycleCompositeAxis();
    }
    if (startedButtons.has(buttonAxisPrevious) && this.#canApplyInput()) {
      this.#cycleAxis(-1);
    }
    if (startedButtons.has(buttonAxisNext) && this.#canApplyInput()) {
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
    if (!this.#canApplyInput()) {
      return;
    }
    const context = { ...this.#readContext(), mode };
    this.#controls.setMode(mode);
    if (this.#afterCallback(context)) {
      // A mode button explicitly selects that mode's remembered axis.
      this.#setActiveAxis(this.#resolveAxis(null));
    }
  }

  /**
   * Ends the owned segment and toggles between local and world transform space
   * if input remains permitted after the end notification.
   */
  #toggleSpace(): void {
    const nextSpace = this.#controls.space === "world" ? "local" : "world";
    this.#endTransform(false);
    if (!this.#canApplyInput()) {
      return;
    }
    const context: TransformContext = {
      ...this.#readContext(),
      space: nextSpace,
    };
    this.#controls.setSpace(nextSpace);
    this.#afterCallback(context);
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
    if (!this.#canApplyInput()) {
      return;
    }
    this.#setActiveAxis(axis);
  }

  /**
   * Selects the next visible composite axis available in the current mode.
   */
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
    this.#endTransform(false);
    if (!this.#canApplyInput()) {
      return;
    }
    if (axes.length === 0) {
      this.#setActiveAxis(null);
      return;
    }
    const current = this.#resolveAxis();

    // A nonempty candidate list guarantees a valid fallback in this mode.
    const currentIndex = axes.indexOf(current as TransformAxis);
    const nextIndex =
      currentIndex === -1
        ? 0
        : (currentIndex + direction + axes.length) % axes.length;

    this.#setActiveAxis(axes[nextIndex]);
  }

  /**
   * Resolves selection without writing to the native control or axis memory.
   *
   * @param nativeAxis - Preferred native axis, defaulting to the current selection.
   *                     Pass `null` to use mode memory before the first allowed axis.
   * @returns The active valid axis, or `null` when no axis is available.
   */
  #resolveAxis(nativeAxis = this.#controls.axis): TransformAxis | null {
    const mode = this.#controls.mode;
    if (nativeAxis !== null && this.#isAxisAllowed(mode, nativeAxis)) {
      return nativeAxis;
    }
    const current = this.#activeAxisByMode[mode];
    const validAxes = this.#getValidAxes(mode);
    const nextAxis =
      current !== null && validAxes.includes(current)
        ? current
        : (validAxes[0] ?? null);
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
      this.#writeProperty("axis", axis);
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
   * Captures a segment's transform origin and claims dragging ownership before
   * notifying native property listeners. The update publishes `mouseDown` later.
   *
   * @param object - Object attached to TransformControls for this update.
   * @param axis - Valid axis acquired for the new segment.
   */
  #startTransform(object: Object3D, axis: TransformAxis): void {
    this.#captureTransformStart(object);
    // Establish ownership before the observable setter; publishing starts later.
    this.#segment = {
      ...this.#readContext(),
      object,
      axis,
      dragging: true,
      started: false,
    };
    this.#writeProperty("dragging", true);
  }

  /**
   * Releases the owned segment and ends its published interaction once,
   * preserving pointer ownership and context changes made by callbacks.
   *
   * @param clearAxis - Whether to clear the highlighted axis if ownership
   *                    and context still permit it after end notifications.
   */
  #endTransform(clearAxis: boolean): void {
    const segment = this.#segment;
    if (segment === null) {
      return;
    }
    const controls = this.#controls;
    const context = this.#readContext();
    this.#segment = null;
    this.#ending = true;
    try {
      // Keep native mouseUp ordering but release ownership before notification.
      if (segment.started) {
        controls.dispatchEvent({ type: "mouseUp", mode: segment.mode });
      }
      const unchanged = this.#matchesContext(context);
      if (!unchanged) {
        this.#interrupted = true;
        if (controls.object !== context.object) {
          this.#needsNeutral = true;
        }
      }
      // Object/mode changes do not transfer our dragging flag. A listener that
      // already released it owns any subsequent changes from that setter.
      const ownsDragging = this.#pointerRevision === segment.pointerRevision;
      if (ownsDragging && controls.dragging === context.dragging) {
        this.#writeProperty("dragging", false);
      }
      if (
        clearAxis &&
        ownsDragging &&
        unchanged &&
        this.#matchesContext({ ...context, dragging: false }) &&
        controls.axis === segment.axis
      ) {
        this.#setActiveAxis(null);
      }
    } finally {
      this.#ending = false;
      if (this.#disposed) {
        controls.removeEventListener("mouseDown", this.#onNativeMouseDown);
      }
    }
  }

  /**
   * Restores the owned segment's transform origin through native reset and
   * resets its accumulators if callbacks leave the same segment active.
   */
  #resetActiveTransform(): void {
    const segment = this.#segment;
    if (segment === null) {
      return;
    }
    const context = this.#readContext();
    this.#controls.reset();
    this.#afterCallback(context);
    if (this.#segment !== segment) {
      return;
    }
    this.#accumulatedPosition.copy(segment.object.position);
    this.#accumulatedScale.copy(segment.object.scale);
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
   * @param object - Object attached to TransformControls for this update.
   * @param axis - Valid axis selected for the active mode.
   * @param deltaTime - Seconds since the last frame.
   * @param transformX - Horizontal transform input after dead zone processing.
   * @param transformY - Vertical transform input after dead zone processing.
   * @returns `true` when the attached object changed.
   */
  #applyCurrentTransform(
    object: Object3D,
    axis: TransformAxis,
    deltaTime: number,
    transformX: number,
    transformY: number,
  ): boolean {
    switch (this.#controls.mode) {
      case "translate":
        return this.#applyTranslate(
          object,
          axis as TranslateAxis,
          deltaTime,
          transformX,
          transformY,
        );
      case "rotate":
        return this.#applyRotate(
          object,
          axis as RotateAxis,
          deltaTime,
          transformX,
          transformY,
        );
      case "scale":
        return this.#applyScale(
          object,
          axis as ScaleAxis,
          deltaTime,
          transformX,
          transformY,
        );
    }
  }

  /**
   * Applies translation in the selected axis, plane, or screen-facing plane.
   *
   * @param object - Object attached to TransformControls for this update.
   * @param axis - Valid translation axis selected for this update.
   * @param deltaTime - Seconds since the last frame.
   * @param transformX - Horizontal transform input after dead zone processing.
   * @param transformY - Vertical transform input after dead zone processing.
   * @returns `true` when the attached object moved.
   */
  #applyTranslate(
    object: Object3D,
    axis: TranslateAxis,
    deltaTime: number,
    transformX: number,
    transformY: number,
  ): boolean {
    const controls = this.#controls;
    this.#updateCameraState(object);
    this.#worldDelta.set(0, 0, 0);
    const scale = axis === "XYZ" ? "world" : controls.space;
    const speed =
      axis === "XYZ"
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
   * @param object - Object attached to TransformControls for this update.
   * @param axis - Valid rotation axis selected for this update.
   * @param deltaTime - Seconds since the last frame.
   * @param transformX - Horizontal transform input after dead zone processing.
   * @param transformY - Vertical transform input after dead zone processing.
   * @returns `true` when the attached object rotated.
   */
  #applyRotate(
    object: Object3D,
    axis: RotateAxis,
    deltaTime: number,
    transformX: number,
    transformY: number,
  ): boolean {
    const controls = this.#controls;
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
    } else {
      const space = controls.space;
      this.#getTransformAxisWorld(axis, space, this.#axisWorld);
      input = this.#getRotationAxisInput(
        this.#axisWorld,
        transformX,
        transformY,
      );
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
   * @param object - Object attached to TransformControls for this update.
   * @param axis - Valid scale axis selected for this update.
   * @param deltaTime - Seconds since the last frame.
   * @param transformX - Horizontal transform input after dead zone processing.
   * @param transformY - Vertical transform input after dead zone processing.
   * @returns `true` when the attached object scaled.
   */
  #applyScale(
    object: Object3D,
    axis: ScaleAxis,
    deltaTime: number,
    transformX: number,
    transformY: number,
  ): boolean {
    const controls = this.#controls;
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
    axis: AxisLetter,
    transformX: number,
    transformY: number,
  ): number {
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
    camera.updateWorldMatrix(true, false);
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
    getCameraViewSize(
      camera,
      this.#worldPosition,
      this.#viewSize,
      this.#cameraSpacePosition,
    );
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
    target.divide(this.#parentScale);
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
}
