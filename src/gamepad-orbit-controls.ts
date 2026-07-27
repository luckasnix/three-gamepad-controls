import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

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
 * Configuration for {@link GamepadOrbitControls}.
 *
 * Every property has a sensible default, so you only need to pass the properties you want to override.
 */
export type GamepadOrbitControlsOptions = GamepadControlsOptions & {
  /**
   * Multiplier on orbit rotation speed.
   * @default 1.0
   */
  rotateSpeed: number;

  /**
   * Multiplier on pan speed.
   * @default 1.0
   */
  panSpeed: number;

  /**
   * Multiplier on zoom (dolly) speed.
   * @default 1.0
   */
  zoomSpeed: number;

  /**
   * Stick binding used for orbit rotation.
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
   * @default 7 — Right trigger
   */
  buttonDollyIn: number;

  /**
   * Button index for zooming **out** (analog trigger value used for proportional zoom).
   * @default 6 — Left trigger
   */
  buttonDollyOut: number;
};

type ResolvedGamepadOrbitControlsOptions = Omit<
  GamepadOrbitControlsOptions,
  "rotateStick" | "panStick"
> & {
  rotateStick: GamepadStickBinding;
  panStick: GamepadStickBinding;
};

// Default options merged in the constructor when no explicit configuration is provided.
const DEFAULT_ORBIT_OPTIONS: ResolvedGamepadOrbitControlsOptions = {
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
  buttonDollyIn: GAMEPAD_BUTTON.RightTrigger,
  buttonDollyOut: GAMEPAD_BUTTON.LeftTrigger,
};

/**
 * Adds gamepad support to Three.js `OrbitControls`.
 *
 * Call `update()` inside the render loop **before** `OrbitControls.update()`.
 * Bindings and speeds are configurable via {@link GamepadOrbitControlsOptions}.
 */
export class GamepadOrbitControls extends GamepadControls {
  readonly #controls: OrbitControls;
  readonly #options: ResolvedGamepadOrbitControlsOptions;

  /**
   * @param controls - A Three.js `OrbitControls` instance.
   * @param options - Optional overrides for the default behavior.
   *                  Any property not provided falls back to its default value.
   */
  constructor(
    controls: OrbitControls,
    options?: Partial<GamepadOrbitControlsOptions>,
  ) {
    super(options);
    this.#controls = controls;
    this.#options = {
      ...DEFAULT_ORBIT_OPTIONS,
      ...options,
      rotateStick: resolveGamepadStickBinding(
        DEFAULT_ORBIT_OPTIONS.rotateStick,
        options?.rotateStick,
      ),
      panStick: resolveGamepadStickBinding(
        DEFAULT_ORBIT_OPTIONS.panStick,
        options?.panStick,
      ),
    };
  }

  /**
   * Maps the current gamepad state to `OrbitControls` rotation, pan, and dolly.
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
      buttonDollyIn,
      buttonDollyOut,
    } = this.#options;
    const input = this.gamepadInput;

    // Rotation (left stick by default).
    // Axes are normalized to [-1, 1]. Multiply by π so a full stick push
    // covers half a rotation per second at rotateSpeed 1.
    const rotate = input.stick(
      rotateStick.xAxis,
      rotateStick.yAxis,
      rotateStick.pipeline,
    );

    if (rotate.x !== 0) {
      this.#controls.rotateLeft(rotate.x * rotateSpeed * deltaTime * Math.PI);
    }
    if (rotate.y !== 0) {
      this.#controls.rotateUp(rotate.y * rotateSpeed * deltaTime * Math.PI);
    }

    // Pan (right stick by default).
    // `pan()` expects screen-space pixel deltas. 500 px/s at full deflection
    // feels comfortable at typical viewport sizes; tune via `panSpeed`.
    const pan = input.stick(panStick.xAxis, panStick.yAxis, panStick.pipeline);

    if (pan.x !== 0 || pan.y !== 0) {
      this.#controls.pan(
        pan.x * panSpeed * deltaTime * 500,
        pan.y * panSpeed * deltaTime * 500,
      );
    }

    // Dolly and zoom (triggers by default).
    // Triggers return an analog value in [0, 1] via `button.value`.
    // OrbitControls uses a scale below 1 to zoom in and above 1 to zoom out.
    // Passing the same below-1 scale to dollyIn/dollyOut maps the triggers to
    // their semantic actions across perspective and orthographic cameras.
    const triggerIn = input.buttonValue(buttonDollyIn);
    const triggerOut = input.buttonValue(buttonDollyOut);

    if (triggerIn > buttonDeadzone) {
      this.#controls.dollyIn(1 / (1 + zoomSpeed * triggerIn * deltaTime));
    }
    if (triggerOut > buttonDeadzone) {
      this.#controls.dollyOut(1 / (1 + zoomSpeed * triggerOut * deltaTime));
    }
  }
}
