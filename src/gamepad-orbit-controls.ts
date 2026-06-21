import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { GAMEPAD_AXIS, GAMEPAD_BUTTON } from "./core.ts";
import { GamepadControls } from "./gamepad-controls.ts";

/**
 * Configuration for {@link GamepadOrbitControls}.
 *
 * Every property has a sensible default, so you only need to pass the properties you want to override.
 */
export type GamepadOrbitControlsOptions = {
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
   * Axis dead zone threshold in the range `[0, 1]`.
   * @default 0.1
   */
  deadzone: number;

  /**
   * Axis index for **horizontal** orbit rotation.
   * @default 0 — Left stick X
   */
  axisRotateX: number;

  /**
   * Axis index for **vertical** orbit rotation.
   * @default 1 — Left stick Y
   */
  axisRotateY: number;

  /**
   * Axis index for **horizontal** panning.
   * @default 2 — Right stick X
   */
  axisPanX: number;

  /**
   * Axis index for **vertical** panning.
   * @default 3 — Right stick Y
   */
  axisPanY: number;

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

/**
 * Default options merged in the constructor when no explicit configuration is provided.
 */
const DEFAULT_ORBIT_OPTIONS: GamepadOrbitControlsOptions = {
  rotateSpeed: 1.0,
  panSpeed: 1.0,
  zoomSpeed: 1.0,
  deadzone: 0.1,
  axisRotateX: GAMEPAD_AXIS.LeftX,
  axisRotateY: GAMEPAD_AXIS.LeftY,
  axisPanX: GAMEPAD_AXIS.RightX,
  axisPanY: GAMEPAD_AXIS.RightY,
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
  readonly #options: GamepadOrbitControlsOptions;

  /**
   * @param controls - A Three.js `OrbitControls` instance.
   * @param options - Optional overrides for the default behavior.
   *                  Any property not provided falls back to its default value.
   */
  constructor(
    controls: OrbitControls,
    options?: Partial<GamepadOrbitControlsOptions>,
  ) {
    super();
    this.#controls = controls;
    this.#options = {
      ...DEFAULT_ORBIT_OPTIONS,
      ...options,
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
      deadzone,
      axisRotateX,
      axisRotateY,
      axisPanX,
      axisPanY,
      buttonDollyIn,
      buttonDollyOut,
    } = this.#options;
    const input = this.gamepadInput;

    // --- Rotation (left stick by default) ------------------------------------
    // Axes are normalized to [-1, 1]. Multiply by π so a full stick push
    // covers half a rotation per second at rotateSpeed 1.
    const rotX = input.axis(axisRotateX, { deadzone });
    const rotY = input.axis(axisRotateY, { deadzone });

    if (rotX !== 0) {
      this.#controls.rotateLeft(rotX * rotateSpeed * deltaTime * Math.PI);
    }
    if (rotY !== 0) {
      this.#controls.rotateUp(rotY * rotateSpeed * deltaTime * Math.PI);
    }

    // --- Pan (right stick by default) ----------------------------------------
    // `pan()` expects screen-space pixel deltas. 500 px/s at full deflection
    // feels comfortable at typical viewport sizes; tune via `panSpeed`.
    const panX = input.axis(axisPanX, { deadzone });
    const panY = input.axis(axisPanY, { deadzone });

    if (panX !== 0 || panY !== 0) {
      this.#controls.pan(
        panX * panSpeed * deltaTime * 500,
        panY * panSpeed * deltaTime * 500,
      );
    }

    // --- Dolly / zoom (triggers by default) ----------------------------------
    // Triggers return an analog value in [0, 1] via `button.value`.
    // OrbitControls uses a scale below 1 to zoom in and above 1 to zoom out.
    // Passing the same below-1 scale to dollyIn/dollyOut maps the triggers to
    // their semantic actions across perspective and orthographic cameras.
    const triggerIn = input.buttonValue(buttonDollyIn);
    const triggerOut = input.buttonValue(buttonDollyOut);

    if (triggerIn > deadzone) {
      this.#controls.dollyIn(1 / (1 + zoomSpeed * triggerIn * deltaTime));
    }
    if (triggerOut > deadzone) {
      this.#controls.dollyOut(1 / (1 + zoomSpeed * triggerOut * deltaTime));
    }
  }
}
