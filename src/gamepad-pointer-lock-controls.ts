import { Euler } from "three";
import type { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

import { GAMEPAD_AXIS } from "./core.ts";
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
 * Configuration for {@link GamepadPointerLockControls}.
 *
 * Every property has a sensible default, so you only need to pass the properties you want to override.
 */
export type GamepadPointerLockControlsOptions = GamepadControlsOptions & {
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
   * Stick binding used for horizontal and forward movement.
   * @default Left stick with the default stick pipeline
   */
  moveStick: GamepadStickBindingOptions;

  /**
   * Stick binding used for yaw and pitch.
   * @default Right stick with the default stick pipeline
   */
  lookStick: GamepadStickBindingOptions;
};

type ResolvedGamepadPointerLockControlsOptions = Omit<
  GamepadPointerLockControlsOptions,
  "moveStick" | "lookStick"
> & {
  moveStick: GamepadStickBinding;
  lookStick: GamepadStickBinding;
};

// Default options merged in the constructor when no explicit configuration is provided.
const DEFAULT_POINTER_LOCK_OPTIONS: ResolvedGamepadPointerLockControlsOptions =
  {
    moveSpeed: 5.0,
    lookSpeed: 1.0,
    moveStick: {
      xAxis: GAMEPAD_AXIS.LeftX,
      yAxis: GAMEPAD_AXIS.LeftY,
      pipeline: DEFAULT_GAMEPAD_STICK_PIPELINE,
    },
    lookStick: {
      xAxis: GAMEPAD_AXIS.RightX,
      yAxis: GAMEPAD_AXIS.RightY,
      pipeline: DEFAULT_GAMEPAD_STICK_PIPELINE,
    },
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
  readonly #options: ResolvedGamepadPointerLockControlsOptions;

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
    super(options);
    this.#controls = controls;
    this.#options = {
      ...DEFAULT_POINTER_LOCK_OPTIONS,
      ...options,
      moveStick: resolveGamepadStickBinding(
        DEFAULT_POINTER_LOCK_OPTIONS.moveStick,
        options?.moveStick,
      ),
      lookStick: resolveGamepadStickBinding(
        DEFAULT_POINTER_LOCK_OPTIONS.lookStick,
        options?.lookStick,
      ),
    };
    this.#euler = new Euler(0, 0, 0, "YXZ");
  }

  /**
   * Maps the current gamepad state to `PointerLockControls` movement and look.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  protected override onUpdate(deltaTime: number): void {
    const { moveSpeed, lookSpeed, moveStick, lookStick } = this.#options;
    const input = this.gamepadInput;

    // Movement (left stick by default).
    // Negate the forward axis: stick-up = negative Y value = move forward.
    const move = input.stick(
      moveStick.xAxis,
      moveStick.yAxis,
      moveStick.pipeline,
    );

    if (move.y !== 0) {
      this.#controls.moveForward(-move.y * moveSpeed * deltaTime);
    }
    if (move.x !== 0) {
      this.#controls.moveRight(move.x * moveSpeed * deltaTime);
    }

    // Look (right stick by default).
    // PointerLockControls has no public rotate API, so we replicate its
    // internal logic: extract the camera quaternion into a YXZ Euler, apply
    // yaw (Y) and pitch (X) deltas, clamp pitch to polar angle constraints,
    // then write the quaternion back. The #euler instance is reused to avoid
    // allocations every frame.
    const look = input.stick(
      lookStick.xAxis,
      lookStick.yAxis,
      lookStick.pipeline,
    );

    if (look.x !== 0 || look.y !== 0) {
      const camera = this.#controls.object;
      const scale =
        lookSpeed * this.#controls.pointerSpeed * deltaTime * Math.PI;

      this.#euler.setFromQuaternion(camera.quaternion);
      this.#euler.y -= look.x * scale;
      this.#euler.x -= look.y * scale;
      this.#euler.x = Math.max(
        Math.PI / 2 - this.#controls.maxPolarAngle,
        Math.min(Math.PI / 2 - this.#controls.minPolarAngle, this.#euler.x),
      );
      camera.quaternion.setFromEuler(this.#euler);
    }
  }
}
