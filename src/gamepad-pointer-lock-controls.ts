import { Euler } from "three";
import type { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

import { GAMEPAD_AXIS } from "./core.ts";
import { GamepadControls } from "./gamepad-controls.ts";
import { applyGamepadDeadzone } from "./utils.ts";

/**
 * Configuration for {@link GamepadPointerLockControls}.
 *
 * Every property has a sensible default, so you only need to pass the properties you want to override.
 */
export type GamepadPointerLockControlsOptions = {
  /**
   * Camera movement speed in world units per second at full stick deflection.
   * @default 5.0
   */
  moveSpeed: number;

  /**
   * Multiplier on look rotation speed (combined with `PointerLockControls.pointerSpeed`).
   * @default 1.0
   */
  lookSpeed: number;

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
};

/**
 * Default options merged in the constructor when no explicit configuration is provided.
 */
const DEFAULT_POINTER_LOCK_OPTIONS: GamepadPointerLockControlsOptions = {
  moveSpeed: 5.0,
  lookSpeed: 1.0,
  deadzone: 0.1,
  axisMoveForward: GAMEPAD_AXIS.LeftY,
  axisMoveRight: GAMEPAD_AXIS.LeftX,
  axisLookX: GAMEPAD_AXIS.RightX,
  axisLookY: GAMEPAD_AXIS.RightY,
};

/**
 * Adds gamepad support to Three.js `PointerLockControls`.
 *
 * Gamepad input is fully independent of pointer lock state. When the pointer
 * IS locked, mouse and gamepad look inputs are additive.
 * Bindings and speeds are configurable via {@link GamepadPointerLockControlsOptions}.
 */
export class GamepadPointerLockControls extends GamepadControls {
  readonly #controls: PointerLockControls;
  readonly #options: GamepadPointerLockControlsOptions;

  // Pre-allocated Euler (YXZ order) to avoid per-frame GC pressure.
  readonly #euler: Euler;

  /**
   * @param controls - A Three.js `PointerLockControls` instance.
   * @param options - Optional overrides for the default behavior.
   *                  Any property not provided falls back to its default value.
   */
  constructor(
    controls: PointerLockControls,
    options?: Partial<GamepadPointerLockControlsOptions>,
  ) {
    super();
    this.#controls = controls;
    this.#options = {
      ...DEFAULT_POINTER_LOCK_OPTIONS,
      ...options,
    };
    this.#euler = new Euler(0, 0, 0, "YXZ");
  }

  /**
   * Maps the current gamepad state to `PointerLockControls` movement and look.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param gamepad - Fresh gamepad snapshot provided by the base class.
   */
  protected override onUpdate(deltaTime: number, gamepad: Gamepad): void {
    const {
      moveSpeed,
      lookSpeed,
      deadzone,
      axisMoveForward,
      axisMoveRight,
      axisLookX,
      axisLookY,
    } = this.#options;

    // --- Movement (left stick by default) ------------------------------------
    // Negate the forward axis: stick-up = negative Y value = move forward.
    const fwd = applyGamepadDeadzone(
      gamepad.axes[axisMoveForward] ?? 0,
      deadzone,
    );
    const strafe = applyGamepadDeadzone(
      gamepad.axes[axisMoveRight] ?? 0,
      deadzone,
    );

    if (fwd !== 0) {
      this.#controls.moveForward(-fwd * moveSpeed * deltaTime);
    }
    if (strafe !== 0) {
      this.#controls.moveRight(strafe * moveSpeed * deltaTime);
    }

    // --- Look (right stick by default) ---------------------------------------
    // PointerLockControls has no public rotate API, so we replicate its
    // internal logic: extract the camera quaternion into a YXZ Euler, apply
    // yaw (Y) and pitch (X) deltas, clamp pitch to polar angle constraints,
    // then write the quaternion back. The #euler instance is reused to avoid
    // allocations every frame.
    const lookX = applyGamepadDeadzone(gamepad.axes[axisLookX] ?? 0, deadzone);
    const lookY = applyGamepadDeadzone(gamepad.axes[axisLookY] ?? 0, deadzone);

    if (lookX !== 0 || lookY !== 0) {
      const camera = this.#controls.object;
      const scale =
        lookSpeed * this.#controls.pointerSpeed * deltaTime * Math.PI;

      this.#euler.setFromQuaternion(camera.quaternion);
      this.#euler.y -= lookX * scale;
      this.#euler.x -= lookY * scale;
      this.#euler.x = Math.max(
        Math.PI / 2 - this.#controls.maxPolarAngle,
        Math.min(Math.PI / 2 - this.#controls.minPolarAngle, this.#euler.x),
      );
      camera.quaternion.setFromEuler(this.#euler);
    }
  }
}
