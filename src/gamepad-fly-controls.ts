import { type Object3D, Quaternion, type Vector3 } from "three";
import type { FlyControls } from "three/addons/controls/FlyControls.js";

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
   * Dead zone threshold for analog button values.
   * @default 0.1
   */
  buttonDeadzone: number;

  /**
   * Movement stick axes and processing pipeline.
   */
  moveStick: GamepadStickBindingOptions;

  /**
   * Camera-look stick axes and processing pipeline.
   */
  lookStick: GamepadStickBindingOptions;

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

type ResolvedGamepadFlyControlsOptions = Omit<
  GamepadFlyControlsOptions,
  "moveStick" | "lookStick"
> & {
  moveStick: GamepadStickBinding;
  lookStick: GamepadStickBinding;
};

// Movement state exposed at runtime but omitted from the native declarations.
type FlyControlsWithMovement = FlyControls & {
  _moveState: {
    forward: number;
    back: number;
  };
  _moveVector: Vector3;
};

// Default options merged in the constructor when no explicit configuration is provided.
const DEFAULT_FLY_OPTIONS: ResolvedGamepadFlyControlsOptions = {
  moveSpeed: 1.0,
  rotateSpeed: 1.0,
  buttonDeadzone: 0.1,
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
  buttonRollLeft: GAMEPAD_BUTTON.LeftShoulder,
  buttonRollRight: GAMEPAD_BUTTON.RightShoulder,
  buttonMoveUp: GAMEPAD_BUTTON.LeftTrigger,
  buttonMoveDown: GAMEPAD_BUTTON.RightTrigger,
};

/**
 * Adds full 6DOF gamepad support to Three.js `FlyControls`.
 *
 * Gamepad input is additive with keyboard/mouse input — call both
 * `gamepadControls.update(delta)` before `controls.update(delta)` each frame.
 * Applied backward translation suppresses only auto-forward for the next native
 * update. Neutral or blocked input leaves native automation and manual input intact.
 * Bindings and speeds are configurable via {@link GamepadFlyControlsOptions}.
 */
export class GamepadFlyControls extends GamepadControls {
  readonly #controls: FlyControlsWithMovement;
  readonly #options: ResolvedGamepadFlyControlsOptions;
  readonly #originalUpdate: FlyControls["update"];
  readonly #originalUpdateDescriptor: PropertyDescriptor | undefined;
  readonly #nativeUpdate: FlyControls["update"];
  #backwardObject: Object3D | null = null;
  #backwardGamepad: Gamepad | null = null;
  #updating = false;
  #nativeUpdating = false;
  #disposed = false;

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
    this.#controls = controls as FlyControlsWithMovement;
    this.#options = {
      ...DEFAULT_FLY_OPTIONS,
      ...options,
      moveStick: resolveGamepadStickBinding(
        DEFAULT_FLY_OPTIONS.moveStick,
        options?.moveStick,
      ),
      lookStick: resolveGamepadStickBinding(
        DEFAULT_FLY_OPTIONS.lookStick,
        options?.lookStick,
      ),
    };
    this.#tmpQuaternion = new Quaternion();
    this.#originalUpdate = controls.update;
    this.#originalUpdateDescriptor = Object.getOwnPropertyDescriptor(
      controls,
      "update",
    );
    this.#nativeUpdate = (deltaTime) => this.#updateNative(deltaTime);
    controls.update = this.#nativeUpdate;
  }

  /**
   * Starts a fresh input frame, dropping any unconsumed auto-forward suppression.
   * Recursive updates from pipelines or native change listeners are ignored.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  public override update(deltaTime: number): void {
    if (this.#updating || this.#nativeUpdating || this.#disposed) {
      return;
    }
    this.#clearBackwardInput();
    this.#updating = true;
    try {
      super.update(deltaTime);
    } finally {
      this.#updating = false;
    }
  }

  /**
   * Disables input and releases this instance's update adapter. Later application
   * replacements are preserved; the native control remains owned by the caller.
   */
  public override dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#clearBackwardInput();
    super.dispose();
    if (this.#controls.update === this.#nativeUpdate) {
      if (this.#originalUpdateDescriptor === undefined) {
        Reflect.deleteProperty(this.#controls, "update");
      } else {
        Object.defineProperty(
          this.#controls,
          "update",
          this.#originalUpdateDescriptor,
        );
      }
    }
  }

  /** Releases pending suppression before notifying disconnection listeners. */
  protected override onGamepadDisconnected(gamepad: Gamepad): void {
    this.#clearBackwardInput();
    super.onGamepadDisconnected(gamepad);
  }

  /** Clears the destination and snapshot that received backward translation. */
  #clearBackwardInput(): void {
    this.#backwardObject = null;
    this.#backwardGamepad = null;
  }

  /** Revalidates the frame after a user-supplied stick pipeline returns. */
  #canApplyInput(gamepad: Gamepad | null, object: Object3D | null): boolean {
    return (
      !this.#disposed &&
      this.enabled &&
      this.#controls.enabled &&
      this.gamepadInput.gamepad === gamepad &&
      this.#controls.object === object
    );
  }

  /**
   * Consumes one applied backward frame before the original native update.
   * Only longitudinal automation is omitted; native movement, rotation, and
   * change publication remain in the original method. Conditional cleanup uses
   * current configuration and manual state, including changes made by listeners.
   */
  #updateNative(deltaTime: number): void {
    if (this.#nativeUpdating) {
      return;
    }
    const controls = this.#controls;
    const gamepad = this.#backwardGamepad;
    const object = this.#backwardObject;
    this.#clearBackwardInput();
    this.#nativeUpdating = true;
    try {
      if (
        gamepad === null ||
        deltaTime === 0 ||
        !this.#canApplyInput(gamepad, object)
      ) {
        this.#originalUpdate.call(controls, deltaTime);
        return;
      }
      const vector = controls._moveVector;
      const manualZ =
        controls._moveState.back - (controls._moveState.forward ? 1 : 0);
      vector.z = manualZ;
      try {
        this.#originalUpdate.call(controls, deltaTime);
      } finally {
        if (controls._moveVector === vector && vector.z === manualZ) {
          const { forward, back } = controls._moveState;
          vector.z =
            back - (forward || (controls.autoForward && !back) ? 1 : 0);
        }
      }
    } finally {
      this.#nativeUpdating = false;
    }
  }

  /**
   * Maps the current gamepad state to `FlyControls` translation and rotation.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  protected override onUpdate(deltaTime: number): void {
    if (!this.#controls.enabled) {
      return;
    }
    const {
      moveSpeed,
      rotateSpeed,
      buttonDeadzone,
      moveStick,
      lookStick,
      buttonRollLeft,
      buttonRollRight,
      buttonMoveUp,
      buttonMoveDown,
    } = this.#options;
    const input = this.gamepadInput;
    const gamepad = input.gamepad;
    const object = this.#controls.object;
    const move = input.stick(
      moveStick.xAxis,
      moveStick.yAxis,
      moveStick.pipeline,
    );
    if (!this.#canApplyInput(gamepad, object)) {
      return;
    }
    const look = input.stick(
      lookStick.xAxis,
      lookStick.yAxis,
      lookStick.pipeline,
    );
    if (!this.#canApplyInput(gamepad, object)) {
      return;
    }

    // Translation.
    // Scale matches FlyControls' internal: delta * movementSpeed.
    const moveMult = deltaTime * this.#controls.movementSpeed * moveSpeed;

    // Forward / backward — left stick Y.
    // Stick up produces a negative axis value; translateZ(-n) moves the camera
    // forward along its local -Z axis, so the raw axis value maps directly.
    const fwd = move.y;
    if (fwd !== 0) {
      const displacement = fwd * moveMult;
      object.translateZ(displacement);
      if (displacement > 0) {
        this.#backwardObject = object;
        this.#backwardGamepad = gamepad;
      }
    }

    // Strafe left / right — left stick X.
    // Positive axis value (stick right) → translateX positive → move right.
    const strafe = move.x;
    if (strafe !== 0) {
      this.#controls.object.translateX(strafe * moveMult);
    }

    // Move up / down — analog triggers (button value in [0, 1]).
    const up = input.buttonValue(buttonMoveUp);
    const down = input.buttonValue(buttonMoveDown);

    if (up > buttonDeadzone) {
      this.#controls.object.translateY(up * moveMult);
    }
    if (down > buttonDeadzone) {
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
    const pitch = -look.y;

    // Yaw — right stick X. Stick right (positive axis) turns the camera right.
    // Negate so that a positive axis value produces a negative yaw (right turn).
    const yaw = -look.x;

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
