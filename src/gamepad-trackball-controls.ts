import type { Vector2 } from "three";
import type { TrackballControls } from "three/addons/controls/TrackballControls.js";

import { GAMEPAD_AXIS, GAMEPAD_BUTTON } from "./core.ts";
import {
  GamepadControls,
  type GamepadControlsOptions,
} from "./gamepad-controls.ts";

/**
 * Configuration for {@link GamepadTrackballControls}.
 *
 * Every property has a sensible default, so you only need to pass the properties you want to override.
 */
export type GamepadTrackballControlsOptions = GamepadControlsOptions & {
  /**
   * Multiplier on `TrackballControls.rotateSpeed` for rotation.
   * @default 1.0
   */
  rotateSpeed: number;

  /**
   * Multiplier on `TrackballControls.panSpeed` for panning.
   * @default 1.0
   */
  panSpeed: number;

  /**
   * Multiplier on `TrackballControls.zoomSpeed` for zooming.
   * @default 1.0
   */
  zoomSpeed: number;

  /**
   * Axis dead zone threshold in the range `[0, 1]`.
   * @default 0.1
   */
  deadzone: number;

  /**
   * Axis index for **horizontal** trackball rotation.
   * @default 0 - Left stick X
   */
  axisRotateX: number;

  /**
   * Axis index for **vertical** trackball rotation.
   * @default 1 - Left stick Y
   */
  axisRotateY: number;

  /**
   * Axis index for **horizontal** panning.
   * @default 2 - Right stick X
   */
  axisPanX: number;

  /**
   * Axis index for **vertical** panning.
   * @default 3 - Right stick Y
   */
  axisPanY: number;

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
};

// Default options merged in the constructor when no explicit configuration is provided.
const DEFAULT_TRACKBALL_OPTIONS: GamepadTrackballControlsOptions = {
  rotateSpeed: 1.0,
  panSpeed: 1.0,
  zoomSpeed: 1.0,
  deadzone: 0.1,
  axisRotateX: GAMEPAD_AXIS.LeftX,
  axisRotateY: GAMEPAD_AXIS.LeftY,
  axisPanX: GAMEPAD_AXIS.RightX,
  axisPanY: GAMEPAD_AXIS.RightY,
  buttonZoomIn: GAMEPAD_BUTTON.RightTrigger,
  buttonZoomOut: GAMEPAD_BUTTON.LeftTrigger,
};

type TrackballControlsWithInput = TrackballControls & {
  // Internal last rotation angle tracked by TrackballControls.
  _lastAngle: number;

  // Previous normalized pointer position used for rotation.
  _movePrev: Vector2;

  // Current normalized pointer position used for rotation.
  _moveCurr: Vector2;

  // Previous normalized pointer position used for zoom damping.
  _zoomStart: Vector2;

  // Current normalized pointer position used for zoom damping.
  _zoomEnd: Vector2;

  // Previous normalized pointer position used for pan damping.
  _panStart: Vector2;

  // Current normalized pointer position used for pan damping.
  _panEnd: Vector2;
};

/**
 * Adds gamepad support to Three.js `TrackballControls`.
 *
 * Call `update()` inside the render loop **before** `TrackballControls.update()`.
 * Bindings and speed multipliers are configurable via {@link GamepadTrackballControlsOptions}.
 */
export class GamepadTrackballControls extends GamepadControls {
  readonly #controls: TrackballControlsWithInput;
  readonly #options: GamepadTrackballControlsOptions;

  /**
   * @param controls - A Three.js `TrackballControls` instance.
   * @param options - Optional overrides for the default behavior.
   *                  Any property not provided falls back to its default value.
   */
  constructor(
    controls: TrackballControls,
    options?: Partial<GamepadTrackballControlsOptions>,
  ) {
    super(options);
    this.#controls = controls as TrackballControlsWithInput;
    this.#options = {
      ...DEFAULT_TRACKBALL_OPTIONS,
      ...options,
    };
  }

  /**
   * Maps the current gamepad state to `TrackballControls` rotation, pan, and zoom.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  protected override onUpdate(deltaTime: number): void {
    const {
      rotateSpeed,
      panSpeed,
      zoomSpeed,
      deadzone,
      axisRotateX,
      axisRotateY,
      axisPanX,
      axisPanY,
      buttonZoomIn,
      buttonZoomOut,
    } = this.#options;

    this.#queueRotation(
      deltaTime,
      rotateSpeed,
      deadzone,
      axisRotateX,
      axisRotateY,
    );
    this.#queuePan(deltaTime, panSpeed, deadzone, axisPanX, axisPanY);
    this.#queueZoom(
      deltaTime,
      zoomSpeed,
      deadzone,
      buttonZoomIn,
      buttonZoomOut,
    );
  }

  /**
   * Queues rotation input into TrackballControls' normalized move state.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param rotateSpeed - User-configured rotation speed multiplier.
   * @param deadzone - Axis dead zone threshold.
   * @param axisRotateX - Axis index for horizontal rotation.
   * @param axisRotateY - Axis index for vertical rotation.
   */
  #queueRotation(
    deltaTime: number,
    rotateSpeed: number,
    deadzone: number,
    axisRotateX: number,
    axisRotateY: number,
  ): void {
    const controls = this.#controls;

    if (controls.noRotate) {
      controls._movePrev.copy(controls._moveCurr);
      controls._lastAngle = 0;
      return;
    }

    const input = this.gamepadInput;
    const rotX = input.axis(axisRotateX, { deadzone });
    const rotY = input.axis(axisRotateY, { deadzone });

    if (rotX === 0 && rotY === 0) {
      return;
    }

    // TrackballControls consumes normalized pointer deltas. Scale a full stick
    // push to half a virtual trackball turn per second at rotateSpeed 1.
    const scale = rotateSpeed * deltaTime * Math.PI;
    controls._moveCurr.x += rotX * scale;
    controls._moveCurr.y += -rotY * scale;
  }

  /**
   * Queues pan input into TrackballControls' normalized pan state.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param panSpeed - User-configured pan speed multiplier.
   * @param deadzone - Axis dead zone threshold.
   * @param axisPanX - Axis index for horizontal panning.
   * @param axisPanY - Axis index for vertical panning.
   */
  #queuePan(
    deltaTime: number,
    panSpeed: number,
    deadzone: number,
    axisPanX: number,
    axisPanY: number,
  ): void {
    const controls = this.#controls;

    if (controls.noPan) {
      controls._panStart.copy(controls._panEnd);
      return;
    }

    const input = this.gamepadInput;
    const panX = input.axis(axisPanX, { deadzone });
    const panY = input.axis(axisPanY, { deadzone });

    if (panX === 0 && panY === 0) {
      return;
    }

    const scale = panSpeed * deltaTime * this.#getInputDampingFactor();
    controls._panEnd.x += panX * scale;
    controls._panEnd.y += panY * scale;
  }

  /**
   * Queues trigger zoom input into TrackballControls' normalized zoom state.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param zoomSpeed - User-configured zoom speed multiplier.
   * @param deadzone - Trigger dead zone threshold.
   * @param buttonZoomIn - Button index for zooming in.
   * @param buttonZoomOut - Button index for zooming out.
   */
  #queueZoom(
    deltaTime: number,
    zoomSpeed: number,
    deadzone: number,
    buttonZoomIn: number,
    buttonZoomOut: number,
  ): void {
    const controls = this.#controls;

    if (controls.noZoom) {
      controls._zoomStart.copy(controls._zoomEnd);
      return;
    }

    const input = this.gamepadInput;
    const triggerIn = input.buttonValue(buttonZoomIn);
    const triggerOut = input.buttonValue(buttonZoomOut);

    if (triggerIn <= deadzone && triggerOut <= deadzone) {
      return;
    }

    controls._zoomEnd.y +=
      (triggerOut - triggerIn) *
      zoomSpeed *
      deltaTime *
      this.#getInputDampingFactor();
  }

  /**
   * Compensates for TrackballControls reapplying queued pan and zoom deltas
   * while their input state catches up through damping.
   *
   * @returns Multiplier that matches TrackballControls' damping mode.
   */
  #getInputDampingFactor(): number {
    const controls = this.#controls;
    return controls.staticMoving ? 1 : controls.dynamicDampingFactor;
  }
}
