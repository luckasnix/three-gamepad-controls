import type { Vector2 } from "three";
import type { TrackballControls } from "three/addons/controls/TrackballControls.js";

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
   * Stick binding used for trackball rotation.
   * @default Left stick with the default stick pipeline
   */
  rotateStick: GamepadStickBindingOptions;

  /**
   * Stick binding used for panning.
   * @default Right stick with the default stick pipeline
   */
  panStick: GamepadStickBindingOptions;

  /**
   * Dead zone threshold for analog trigger values.
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
};

type ResolvedGamepadTrackballControlsOptions = Omit<
  GamepadTrackballControlsOptions,
  "rotateStick" | "panStick"
> & {
  rotateStick: GamepadStickBinding;
  panStick: GamepadStickBinding;
};

// Default options merged in the constructor when no explicit configuration is provided.
const DEFAULT_TRACKBALL_OPTIONS: ResolvedGamepadTrackballControlsOptions = {
  rotateSpeed: 1.0,
  panSpeed: 1.0,
  zoomSpeed: 1.0,
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
  readonly #options: ResolvedGamepadTrackballControlsOptions;

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
      rotateStick: resolveGamepadStickBinding(
        DEFAULT_TRACKBALL_OPTIONS.rotateStick,
        options?.rotateStick,
      ),
      panStick: resolveGamepadStickBinding(
        DEFAULT_TRACKBALL_OPTIONS.panStick,
        options?.panStick,
      ),
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
      rotateStick,
      panStick,
      buttonDeadzone,
      buttonZoomIn,
      buttonZoomOut,
    } = this.#options;

    this.#queueRotation(deltaTime, rotateSpeed, rotateStick);
    this.#queuePan(deltaTime, panSpeed, panStick);
    this.#queueZoom(
      deltaTime,
      zoomSpeed,
      buttonDeadzone,
      buttonZoomIn,
      buttonZoomOut,
    );
  }

  /**
   * Queues rotation input into TrackballControls' normalized move state.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param rotateSpeed - User-configured rotation speed multiplier.
   * @param rotateStick - Resolved stick binding for rotation.
   */
  #queueRotation(
    deltaTime: number,
    rotateSpeed: number,
    rotateStick: GamepadStickBinding,
  ): void {
    const controls = this.#controls;

    if (controls.noRotate) {
      controls._movePrev.copy(controls._moveCurr);
      controls._lastAngle = 0;
      return;
    }

    const input = this.gamepadInput;
    const rotate = input.stick(
      rotateStick.xAxis,
      rotateStick.yAxis,
      rotateStick.pipeline,
    );

    if (rotate.x === 0 && rotate.y === 0) {
      return;
    }

    // TrackballControls consumes normalized pointer deltas. Scale a full stick
    // push to half a virtual trackball turn per second at rotateSpeed 1.
    const scale = rotateSpeed * deltaTime * Math.PI;
    controls._moveCurr.x += rotate.x * scale;
    controls._moveCurr.y += -rotate.y * scale;
  }

  /**
   * Queues pan input into TrackballControls' normalized pan state.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param panSpeed - User-configured pan speed multiplier.
   * @param panStick - Resolved stick binding for panning.
   */
  #queuePan(
    deltaTime: number,
    panSpeed: number,
    panStick: GamepadStickBinding,
  ): void {
    const controls = this.#controls;

    if (controls.noPan) {
      controls._panStart.copy(controls._panEnd);
      return;
    }

    const input = this.gamepadInput;
    const pan = input.stick(panStick.xAxis, panStick.yAxis, panStick.pipeline);

    if (pan.x === 0 && pan.y === 0) {
      return;
    }

    const scale = panSpeed * deltaTime * this.#getInputDampingFactor();
    controls._panEnd.x += pan.x * scale;
    controls._panEnd.y += pan.y * scale;
  }

  /**
   * Queues trigger zoom input into TrackballControls' normalized zoom state.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param zoomSpeed - User-configured zoom speed multiplier.
   * @param buttonDeadzone - Trigger dead zone threshold.
   * @param buttonZoomIn - Button index for zooming in.
   * @param buttonZoomOut - Button index for zooming out.
   */
  #queueZoom(
    deltaTime: number,
    zoomSpeed: number,
    buttonDeadzone: number,
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

    if (triggerIn <= buttonDeadzone && triggerOut <= buttonDeadzone) {
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
