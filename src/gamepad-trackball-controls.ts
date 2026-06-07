import type { Vector2 } from "three";
import type { TrackballControls } from "three/addons/controls/TrackballControls.js";

import { GAMEPAD_AXIS, GAMEPAD_BUTTON } from "./core.ts";
import { GamepadControls } from "./gamepad-controls.ts";

/**
 * Configuration for {@link GamepadTrackballControls}.
 *
 * Every property has a sensible default, so you only need to pass the properties you want to override.
 */
export type GamepadTrackballControlsOptions = {
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

/**
 * Default options merged in the constructor when no explicit configuration is provided.
 */
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
  _lastAngle: number;
  _movePrev: Vector2;
  _moveCurr: Vector2;
  _zoomStart: Vector2;
  _zoomEnd: Vector2;
  _panStart: Vector2;
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
    super();
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
   * @param gamepad - Fresh gamepad snapshot provided by the base class.
   */
  protected override onUpdate(deltaTime: number, gamepad: Gamepad): void {
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
      gamepad,
      rotateSpeed,
      deadzone,
      axisRotateX,
      axisRotateY,
    );
    this.#queuePan(deltaTime, gamepad, panSpeed, deadzone, axisPanX, axisPanY);
    this.#queueZoom(
      deltaTime,
      gamepad,
      zoomSpeed,
      deadzone,
      buttonZoomIn,
      buttonZoomOut,
    );
  }

  #queueRotation(
    deltaTime: number,
    gamepad: Gamepad,
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

    const rotX = this.#applyDeadzone(gamepad.axes[axisRotateX] ?? 0, deadzone);
    const rotY = this.#applyDeadzone(gamepad.axes[axisRotateY] ?? 0, deadzone);

    if (rotX === 0 && rotY === 0) {
      return;
    }

    // TrackballControls consumes normalized pointer deltas. Scale a full stick
    // push to half a virtual trackball turn per second at rotateSpeed 1.
    const scale = rotateSpeed * deltaTime * Math.PI;
    controls._moveCurr.x += rotX * scale;
    controls._moveCurr.y += -rotY * scale;
  }

  #queuePan(
    deltaTime: number,
    gamepad: Gamepad,
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

    const panX = this.#applyDeadzone(gamepad.axes[axisPanX] ?? 0, deadzone);
    const panY = this.#applyDeadzone(gamepad.axes[axisPanY] ?? 0, deadzone);

    if (panX === 0 && panY === 0) {
      return;
    }

    const scale = panSpeed * deltaTime;
    controls._panEnd.x += panX * scale;
    controls._panEnd.y += panY * scale;
  }

  #queueZoom(
    deltaTime: number,
    gamepad: Gamepad,
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

    const triggerIn = gamepad.buttons[buttonZoomIn]?.value ?? 0;
    const triggerOut = gamepad.buttons[buttonZoomOut]?.value ?? 0;

    if (triggerIn <= deadzone && triggerOut <= deadzone) {
      return;
    }

    controls._zoomEnd.y += (triggerOut - triggerIn) * zoomSpeed * deltaTime;
  }

  /**
   * Returns `value` unchanged, or `0` if below the dead zone `threshold`.
   *
   * @param value - Raw axis or trigger value, typically in `[-1, 1]`.
   * @param threshold - Dead zone size; values below this magnitude are zeroed.
   */
  #applyDeadzone(value: number, threshold: number): number {
    return Math.abs(value) < threshold ? 0 : value;
  }
}
