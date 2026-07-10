import { Quaternion } from "three";
import type { FlyControls } from "three/addons/controls/FlyControls.js";

import { GAMEPAD_AXIS, GAMEPAD_BUTTON } from "./core.ts";
import {
  GamepadControls,
  type GamepadControlsOptions,
} from "./gamepad-controls.ts";

/**
 * Configuration for {@link GamepadFlyControls}.
 *
 * Every property has a sensible default, so you only need to pass the properties you want to override.
 */
export type GamepadFlyControlsOptions = GamepadControlsOptions & {
  /**
   * Multiplier on `FlyControls.movementSpeed` for translation.
   * @default 1.0
   */
  moveSpeed: number;

  /**
   * Multiplier on `FlyControls.rollSpeed` for rotation.
   * @default 1.0
   */
  rotateSpeed: number;

  /**
   * Axis dead zone threshold in the range `[0, 1]`.
   * @default 0.1
   */
  deadzone: number;

  /**
   * Axis index for **forward / backward** movement.
   * @default 1 — Left stick Y
   */
  axisMoveForward: number;

  /**
   * Axis index for **right / left** strafe movement.
   * @default 0 — Left stick X
   */
  axisMoveRight: number;

  /**
   * Axis index for **horizontal** camera look (yaw).
   * @default 2 — Right stick X
   */
  axisLookX: number;

  /**
   * Axis index for **vertical** camera look (pitch).
   * @default 3 — Right stick Y
   */
  axisLookY: number;

  /**
   * Button index for **rolling left**.
   * @default 4 — Left shoulder
   */
  buttonRollLeft: number;

  /**
   * Button index for **rolling right**.
   * @default 5 — Right shoulder
   */
  buttonRollRight: number;

  /**
   * Button index for **moving up** (analog trigger value used for proportional speed).
   * @default 6 — Left trigger
   */
  buttonMoveUp: number;

  /**
   * Button index for **moving down** (analog trigger value used for proportional speed).
   * @default 7 — Right trigger
   */
  buttonMoveDown: number;
};

// Default options merged in the constructor when no explicit configuration is provided.
const DEFAULT_FLY_OPTIONS: GamepadFlyControlsOptions = {
  moveSpeed: 1.0,
  rotateSpeed: 1.0,
  deadzone: 0.1,
  axisMoveForward: GAMEPAD_AXIS.LeftY,
  axisMoveRight: GAMEPAD_AXIS.LeftX,
  axisLookX: GAMEPAD_AXIS.RightX,
  axisLookY: GAMEPAD_AXIS.RightY,
  buttonRollLeft: GAMEPAD_BUTTON.LeftShoulder,
  buttonRollRight: GAMEPAD_BUTTON.RightShoulder,
  buttonMoveUp: GAMEPAD_BUTTON.LeftTrigger,
  buttonMoveDown: GAMEPAD_BUTTON.RightTrigger,
};

/**
 * Adds full 6DOF gamepad support to Three.js `FlyControls`.
 *
 * Gamepad input is additive with keyboard/mouse input — call both
 * `gamepadControls.update(delta)` and `controls.update(delta)` each frame.
 * Bindings and speeds are configurable via {@link GamepadFlyControlsOptions}.
 */
export class GamepadFlyControls extends GamepadControls {
  readonly #controls: FlyControls;
  readonly #options: GamepadFlyControlsOptions;

  // Pre-allocated to avoid per-frame GC pressure.
  readonly #tmpQuaternion: Quaternion;

  /**
   * @param controls - A Three.js `FlyControls` instance.
   * @param options - Optional overrides for the default behavior.
   *                  Any property not provided falls back to its default value.
   */
  constructor(
    controls: FlyControls,
    options?: Partial<GamepadFlyControlsOptions>,
  ) {
    super(options);
    this.#controls = controls;
    this.#options = {
      ...DEFAULT_FLY_OPTIONS,
      ...options,
    };
    this.#tmpQuaternion = new Quaternion();
  }

  /**
   * Maps the current gamepad state to `FlyControls` translation and rotation.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  protected override onUpdate(deltaTime: number): void {
    const {
      moveSpeed,
      rotateSpeed,
      deadzone,
      axisMoveForward,
      axisMoveRight,
      axisLookX,
      axisLookY,
      buttonRollLeft,
      buttonRollRight,
      buttonMoveUp,
      buttonMoveDown,
    } = this.#options;
    const input = this.gamepadInput;

    // Translation.
    // Scale matches FlyControls' internal: delta * movementSpeed.
    const moveMult = deltaTime * this.#controls.movementSpeed * moveSpeed;

    // Forward / backward — left stick Y.
    // Stick up produces a negative axis value; translateZ(-n) moves the camera
    // forward along its local -Z axis, so the raw axis value maps directly.
    const fwd = input.axis(axisMoveForward, { deadzone });
    if (fwd !== 0) {
      this.#controls.object.translateZ(fwd * moveMult);
    }

    // Strafe left / right — left stick X.
    // Positive axis value (stick right) → translateX positive → move right.
    const strafe = input.axis(axisMoveRight, { deadzone });
    if (strafe !== 0) {
      this.#controls.object.translateX(strafe * moveMult);
    }

    // Move up / down — analog triggers (button value in [0, 1]).
    const up = input.buttonValue(buttonMoveUp);
    const down = input.buttonValue(buttonMoveDown);

    if (up > deadzone) {
      this.#controls.object.translateY(up * moveMult);
    }
    if (down > deadzone) {
      this.#controls.object.translateY(-down * moveMult);
    }

    // Rotation.
    // Replicates FlyControls' internal rotation exactly:
    //   #tmpQuaternion.set(rotX * rotMult, rotY * rotMult, rotZ * rotMult, 1)
    //   .normalize()
    //   object.quaternion.multiply(#tmpQuaternion)
    // Scale matches FlyControls' rotMult: delta * rollSpeed.
    const rotMult = deltaTime * this.#controls.rollSpeed * rotateSpeed;

    // Pitch — right stick Y. Stick up (negative axis) tilts the camera up.
    // Negate so that a negative axis value produces a positive rotation (up).
    const pitch = -input.axis(axisLookY, { deadzone });

    // Yaw — right stick X. Stick right (positive axis) turns the camera right.
    // Negate so that a positive axis value produces a negative yaw (right turn).
    const yaw = -input.axis(axisLookX, { deadzone });

    // Roll — shoulder buttons (digital: 0 or 1).
    const rollLeft = input.isPressed(buttonRollLeft) ? 1 : 0;
    const rollRight = input.isPressed(buttonRollRight) ? 1 : 0;
    const roll = rollLeft - rollRight;

    if (pitch !== 0 || yaw !== 0 || roll !== 0) {
      this.#tmpQuaternion
        .set(pitch * rotMult, yaw * rotMult, roll * rotMult, 1)
        .normalize();
      this.#controls.object.quaternion.multiply(this.#tmpQuaternion);
    }
  }
}
