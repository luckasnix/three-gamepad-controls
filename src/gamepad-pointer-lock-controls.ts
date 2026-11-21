import { Euler, Quaternion } from "three";
import type { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

import { GAMEPAD_AXIS } from "./core.ts";
import {
  GamepadControls,
  type GamepadControlsOptions,
} from "./gamepad-controls.ts";
import {
  DEFAULT_GAMEPAD_STICK_PIPELINE,
  type GamepadStick,
  type GamepadStickBinding,
  type GamepadStickBindingOptions,
  resolveGamepadStickBinding,
} from "./gamepad-stick-processing.ts";
import { GamepadStickSmoother } from "./gamepad-stick-smoother.ts";

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

  /** Seconds to cover half the remaining change in gamepad look speed. Omit for direct look. */
  lookSmoothingHalfLife?: number;

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

const createSmoothedLook = (
  camera: PointerLockControls["object"],
  halfLifeSeconds: number,
) => ({ camera, smoother: new GamepadStickSmoother({ halfLifeSeconds }) });

/**
 * Adds gamepad support to Three.js `PointerLockControls`.
 *
 * Gamepad input is fully independent of pointer lock state. When the pointer
 * IS locked, mouse and gamepad look inputs are additive.
 * Bindings and speeds are configurable via {@link GamepadPointerLockControlsOptions}.
 * Look dispatches `change` on the native controls after an actual orientation
 * change; movement does not dispatch it or alter pointer lock state.
 */
export class GamepadPointerLockControls extends GamepadControls {
  readonly #controls: PointerLockControls;
  readonly #options: ResolvedGamepadPointerLockControlsOptions;
  #smoothedLook: ReturnType<typeof createSmoothedLook> | undefined;
  // An observed loss ends a session even when a listener immediately reuses the slot.
  #inputSession = 0;

  // Pre-allocated Euler (YXZ order) to avoid per-frame GC pressure.
  readonly #euler: Euler;
  /** Reusable orientation snapshot for sign-independent angular change detection. */
  readonly #previousQuaternion = new Quaternion();
  /** Blocks recursive input application from native `change` listeners. */
  #updating = false;

  /**
   * @param controls - A Three.js `PointerLockControls` instance.
   * @param options - Optional overrides for the default behavior.
   *                  Any property not provided falls back to its default value.
   * @throws {RangeError} If a supplied look smoothing half-life is non-finite or non-positive.
   */
  constructor(
    controls: PointerLockControls,
    options?: Partial<GamepadPointerLockControlsOptions>,
  ) {
    const halfLife = options?.lookSmoothingHalfLife;
    const smoothedLook =
      halfLife === undefined
        ? undefined
        : createSmoothedLook(controls.object, halfLife);
    super(options);
    this.#controls = controls;
    this.#smoothedLook = smoothedLook;
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

  protected override onGamepadDisconnected(gamepad: Gamepad): void {
    this.#clearLookSession();
    super.onGamepadDisconnected(gamepad);
  }

  public override dispose(): void {
    this.#clearLookSession();
    super.dispose();
  }

  #clearLookSession(): void {
    this.#smoothedLook = undefined;
    this.#inputSession++;
  }

  /**
   * Polls and applies movement and look, ignoring updates from synchronous listeners.
   * Gamepad input remains independent of the native pointer lock state.
   *
   * @param deltaTime - Seconds since the last frame.
   * @throws {RangeError} With smoothing enabled, if the frame time is negative or
   * non-finite, or the processed look stick has a non-finite component.
   */
  public override update(deltaTime: number): void {
    if (this.#updating) {
      return;
    }
    this.#updating = true;
    try {
      super.update(deltaTime);
    } finally {
      this.#updating = false;
    }
  }

  /**
   * Maps the current gamepad state to `PointerLockControls` movement and look.
   * Dispatches at most one native `change` after look changes orientation by more
   * than `1e-7` radians, treating opposite quaternion signs as equivalent.
   * Translation, zero look gain, and pitch-only input held at a clamp do not
   * dispatch `change`; permitted yaw can still change orientation at a pitch limit.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  protected override onUpdate(deltaTime: number): void {
    if (!this.#controls.enabled) {
      return;
    }
    const { moveStick, lookStick, lookSmoothingHalfLife } = this.#options;
    if (lookSmoothingHalfLife === undefined) {
      this.#applyMovement(this.#readStick(moveStick), deltaTime);
      this.#applyLook(this.#readStick(lookStick), deltaTime);
      return;
    }

    const camera = this.#controls.object;
    const session = this.#inputSession;
    const move = this.#readStick(moveStick);
    if (!this.#canApplyFrame(camera, session)) {
      return;
    }
    const target = this.#readStick(lookStick);
    if (!this.#canApplyFrame(camera, session)) {
      return;
    }

    const smoothedLook =
      this.#smoothedLook?.camera === camera
        ? this.#smoothedLook
        : createSmoothedLook(camera, lookSmoothingHalfLife);
    const look = smoothedLook.smoother.update(target, deltaTime);
    this.#smoothedLook = smoothedLook;
    this.#applyMovement(move, deltaTime);
    this.#applyLook(look, deltaTime);
  }

  #readStick({ xAxis, yAxis, pipeline }: GamepadStickBinding): GamepadStick {
    return this.gamepadInput.stick(xAxis, yAxis, pipeline);
  }

  // Custom stick transforms can synchronously change the input session or its owner.
  #canApplyFrame(
    camera: PointerLockControls["object"],
    session: number,
  ): boolean {
    return (
      this.enabled &&
      this.#controls.enabled &&
      this.#controls.object === camera &&
      this.#inputSession === session
    );
  }

  #applyMovement(move: GamepadStick, deltaTime: number): void {
    const { moveSpeed } = this.#options;
    // Stick-up is negative Y and moves the camera forward.
    if (move.y !== 0) {
      this.#controls.moveForward(-move.y * moveSpeed * deltaTime);
    }
    if (move.x !== 0) {
      this.#controls.moveRight(move.x * moveSpeed * deltaTime);
    }
  }

  #applyLook(look: GamepadStick, deltaTime: number): void {
    const { lookSpeed } = this.#options;
    // PointerLockControls has no public rotate API. Apply yaw and pitch in YXZ order.
    const scale = lookSpeed * this.#controls.pointerSpeed * deltaTime * Math.PI;
    if ((look.x !== 0 || look.y !== 0) && scale !== 0) {
      const camera = this.#controls.object;
      this.#previousQuaternion.copy(camera.quaternion);
      this.#euler.setFromQuaternion(camera.quaternion);
      this.#euler.y -= look.x * scale;
      this.#euler.x -= look.y * scale;
      this.#euler.x = Math.max(
        Math.PI / 2 - this.#controls.maxPolarAngle,
        Math.min(Math.PI / 2 - this.#controls.minPolarAngle, this.#euler.x),
      );
      camera.quaternion.setFromEuler(this.#euler);
      // angleTo treats q and -q as the same orientation. 1e-7 radians
      // excludes roundoff from the Euler/quaternion conversion at clamps.
      if (this.#previousQuaternion.angleTo(camera.quaternion) > 1e-7) {
        this.#controls.dispatchEvent({ type: "change" });
      }
    }
  }
}
