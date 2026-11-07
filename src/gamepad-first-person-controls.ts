import { MathUtils, type Object3D, Spherical, Vector3 } from "three";
import type { FirstPersonControls } from "three/addons/controls/FirstPersonControls.js";

import { GAMEPAD_AXIS, GAMEPAD_BUTTON } from "./core.ts";
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

/**
 * Configuration for {@link GamepadFirstPersonControls}.
 *
 * Every property has a sensible default, so you only need to pass the properties you want to override.
 */
export type GamepadFirstPersonControlsOptions = GamepadControlsOptions & {
  /**
   * Multiplier on `FirstPersonControls.movementSpeed` for translation.
   * Applied after normalizing combined stick and trigger movement.
   * @default 1.0
   */
  moveSpeed: number;

  /**
   * Multiplier on `FirstPersonControls.lookSpeed` for camera look.
   * @default 1.0
   */
  lookSpeed: number;

  /**
   * Axes and processing pipeline for yaw-based movement in the XZ plane.
   */
  moveStick: GamepadStickBindingOptions;

  /**
   * Camera-look stick axes and processing pipeline.
   */
  lookStick: GamepadStickBindingOptions;

  /**
   * Dead zone threshold for analog button values.
   * @default 0.1
   */
  buttonDeadzone: number;

  /**
   * Button index for **moving up** along Y (analog value used for proportional speed).
   * @default 6 - Left trigger
   */
  buttonMoveUp: number;

  /**
   * Button index for **moving down** along Y (analog value used for proportional speed).
   * @default 7 - Right trigger
   */
  buttonMoveDown: number;
};

type ResolvedGamepadFirstPersonControlsOptions = Omit<
  GamepadFirstPersonControlsOptions,
  "moveStick" | "lookStick"
> & {
  moveStick: GamepadStickBinding;
  lookStick: GamepadStickBinding;
};

// Default options merged in the constructor when no explicit configuration is provided.
const DEFAULT_FIRST_PERSON_OPTIONS: ResolvedGamepadFirstPersonControlsOptions =
  {
    moveSpeed: 1.0,
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
    buttonDeadzone: 0.1,
    buttonMoveUp: GAMEPAD_BUTTON.LeftTrigger,
    buttonMoveDown: GAMEPAD_BUTTON.RightTrigger,
  };

// Converts normalized stick input to degree deltas while preserving the
// pixel-based scale used by FirstPersonControls.lookSpeed.
const LOOK_SPEED_SCALE = 36000;
// Fraction of the longitudinal speed at release at which retreat ends.
const RETREAT_END_RATIO = 0.001;

type FirstPersonControlsWithOrientation = FirstPersonControls & {
  // Internal latitude angle maintained by FirstPersonControls.
  _lat: number;

  // Internal longitude angle maintained by FirstPersonControls.
  _lon: number;
};

type FirstPersonOrientation = {
  // Vertical look angle in degrees.
  lat: number;

  // Horizontal look angle in degrees.
  lon: number;
};

/**
 * Adds gamepad support to Three.js `FirstPersonControls`.
 *
 * Gamepad input is additive with keyboard/mouse input - call
 * `gamepadControls.update(delta)` before `controls.update(delta)` each frame.
 * Movement follows the native keyboard frame: yaw-based translation in XZ
 * and climbing along Y, independent of camera pitch and roll.
 * Combined gamepad movement is limited to unit magnitude before speed and
 * forward height gains, preserving smaller analog intentions unchanged.
 * The native `dampingFactor` filters translation (scene units/second) and
 * look (degrees/second) once per update. Pausing the wrapper or disabling the
 * native control freezes both. Observed gamepad loss, a new destination, or
 * disposal clears the velocities. Applied retreat suppresses the automatic
 * forward target for the next native update. On release, residual retreat
 * ends at 0.1% of the longitudinal speed at release.
 * Bindings and speeds are configurable via {@link GamepadFirstPersonControlsOptions}.
 */
export class GamepadFirstPersonControls extends GamepadControls {
  readonly #controls: FirstPersonControlsWithOrientation;
  readonly #options: ResolvedGamepadFirstPersonControlsOptions;
  readonly #originalUpdate: FirstPersonControls["update"];
  readonly #originalUpdateDescriptor: PropertyDescriptor | undefined;
  readonly #nativeUpdate: FirstPersonControls["update"];
  #backwardObject: Object3D | null = null;
  #backwardGamepad: Gamepad | null = null;
  #velocityObject: Object3D | null = null;
  // Keep longitudinal motion separate so ending retreat preserves strafe/climb.
  readonly #driveVelocity = new Vector3();
  readonly #strafeClimbVelocity = new Vector3();
  readonly #velocityTarget = new Vector3();
  #retreatEndSpeedSq = 0;
  #latVelocity = 0;
  #lonVelocity = 0;
  #updating = false;
  #nativeUpdating = false;
  #disposed = false;

  // Pre-allocated to avoid per-frame GC pressure.
  readonly #lookDirection: Vector3;
  readonly #spherical: Spherical;
  readonly #targetPosition: Vector3;
  readonly #orientation: FirstPersonOrientation = { lat: 0, lon: 0 };

  /**
   * @param controls - A Three.js `FirstPersonControls` instance.
   * @param options - Optional overrides for the default behavior.
   *                  Any property not provided falls back to its default value.
   */
  constructor(
    controls: FirstPersonControls,
    options?: Partial<GamepadFirstPersonControlsOptions>,
  ) {
    super(options);
    this.#controls = controls as FirstPersonControlsWithOrientation;
    this.#options = {
      ...DEFAULT_FIRST_PERSON_OPTIONS,
      ...options,
      moveStick: resolveGamepadStickBinding(
        DEFAULT_FIRST_PERSON_OPTIONS.moveStick,
        options?.moveStick,
      ),
      lookStick: resolveGamepadStickBinding(
        DEFAULT_FIRST_PERSON_OPTIONS.lookStick,
        options?.lookStick,
      ),
    };
    this.#lookDirection = new Vector3();
    this.#spherical = new Spherical();
    this.#targetPosition = new Vector3();
    this.#originalUpdate = controls.update;
    this.#originalUpdateDescriptor = Object.getOwnPropertyDescriptor(
      controls,
      "update",
    );
    this.#nativeUpdate = (deltaTime) => this.#updateNative(deltaTime);
    controls.update = this.#nativeUpdate;
  }

  /**
   * Starts a fresh input frame, dropping unconsumed auto-forward suppression.
   * Recursive updates are ignored; failed input frames retain no suppression.
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
    } catch (error) {
      this.#clearBackwardInput();
      throw error;
    } finally {
      this.#updating = false;
    }
  }

  /**
   * Releases this instance's update adapter without disposing the native control.
   * Later application replacements are preserved. Disposal is terminal.
   */
  public override dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#clearBackwardInput();
    this.#resetVelocities(null);
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

  /** Releases gamepad motion before notifying disconnection listeners. */
  protected override onGamepadDisconnected(gamepad: Gamepad): void {
    this.#clearBackwardInput();
    this.#resetVelocities(null);
    super.onGamepadDisconnected(gamepad);
  }

  #resetVelocities(object: Object3D | null): void {
    this.#velocityObject = object;
    this.#driveVelocity.set(0, 0, 0);
    this.#strafeClimbVelocity.set(0, 0, 0);
    this.#retreatEndSpeedSq = 0;
    this.#latVelocity = 0;
    this.#lonVelocity = 0;
  }

  /** Clears the destination and snapshot that received backward movement. */
  #clearBackwardInput(): void {
    this.#backwardObject = null;
    this.#backwardGamepad = null;
  }

  /** Revalidates ownership and permissions after synchronous callbacks. */
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
   * Consumes one backward frame. Masking only autoForward lets the original
   * update compute manual targets and damp its existing velocity unchanged.
   * A temporary setter preserves assignments, including explicit false writes;
   * conditional restoration also preserves application property replacements.
   */
  #updateNative(deltaTime: number): void {
    if (this.#nativeUpdating || this.#updating) {
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
      const descriptor = Object.getOwnPropertyDescriptor(
        controls,
        "autoForward",
      );
      let value = controls.autoForward;
      let assigned = false;
      let suppress = true;
      const enumerable = descriptor?.enumerable ?? true;
      const get = (): boolean =>
        suppress && this.#canApplyInput(gamepad, object) ? false : value;
      const set = (next: boolean): void => {
        assigned = true;
        value = next;
        descriptor?.set?.call(controls, next);
      };
      Object.defineProperty(controls, "autoForward", {
        configurable: true,
        enumerable,
        get,
        set,
      });
      try {
        this.#originalUpdate.call(controls, deltaTime);
      } finally {
        // A later descriptor change may retain our getter. Release its mask
        // even when that change means the application now owns the property.
        suppress = false;
        const current = Object.getOwnPropertyDescriptor(
          controls,
          "autoForward",
        );
        if (
          current?.get === get &&
          current.set === set &&
          current.configurable === true &&
          current.enumerable === enumerable
        ) {
          if (descriptor === undefined) {
            Reflect.deleteProperty(controls, "autoForward");
            if (assigned) {
              controls.autoForward = value;
            }
          } else {
            Object.defineProperty(
              controls,
              "autoForward",
              "value" in descriptor ? { ...descriptor, value } : descriptor,
            );
          }
        }
      }
    } finally {
      this.#nativeUpdating = false;
    }
  }

  /**
   * Maps the current gamepad state to `FirstPersonControls` translation and look.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  protected override onUpdate(deltaTime: number): void {
    if (!this.#controls.enabled) {
      return;
    }
    const {
      moveSpeed,
      lookSpeed,
      moveStick,
      lookStick,
      buttonDeadzone,
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
    if (this.#velocityObject !== object) {
      this.#resetVelocities(object);
    }
    const orientation = this.#getOrientation();
    this.#applyMovement(
      deltaTime,
      orientation.lon,
      moveSpeed,
      move,
      buttonDeadzone,
      buttonMoveUp,
      buttonMoveDown,
    );
    this.#applyLook(deltaTime, orientation, lookSpeed, look);
  }

  /**
   * Applies translation in the native keyboard frame, using yaw before look.
   * Triggers are filtered independently before the combined movement intent
   * is limited to unit magnitude. Speed and forward height gains follow this
   * normalization; height gain uses the initial Y position before climbing.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param longitude - Heading at the start of the frame, in degrees.
   * @param moveSpeed - User-configured movement speed multiplier.
   * @param move - Processed movement stick input.
   * @param buttonDeadzone - Analog button dead zone threshold.
   * @param buttonMoveUp - Button index for upward movement.
   * @param buttonMoveDown - Button index for downward movement.
   */
  #applyMovement(
    deltaTime: number,
    longitude: number,
    moveSpeed: number,
    move: Readonly<GamepadStick>,
    buttonDeadzone: number,
    buttonMoveUp: number,
    buttonMoveDown: number,
  ): void {
    const controls = this.#controls;
    const input = this.gamepadInput;
    const up = input.buttonValue(buttonMoveUp);
    const down = input.buttonValue(buttonMoveDown);
    let strafe = move.x;
    let forward = -move.y;
    let climb =
      (up > buttonDeadzone ? up : 0) - (down > buttonDeadzone ? down : 0);
    const magnitude = Math.hypot(strafe, forward, climb);
    if (magnitude > 1) {
      strafe /= magnitude;
      forward /= magnitude;
      climb /= magnitude;
    }
    const { dampingFactor, movementSpeed } = controls;
    let forwardSpeed = movementSpeed;
    if (forward > 0 && controls.heightSpeed) {
      const y = MathUtils.clamp(
        controls.object.position.y,
        controls.heightMin,
        controls.heightMax,
      );
      forwardSpeed += (y - controls.heightMin) * controls.heightCoef;
    }
    // Build targets in the native translation frame, in units per second.
    // A turn changes the new target while existing momentum keeps its direction.
    const yaw = MathUtils.degToRad(longitude);
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    const drive = forward * forwardSpeed * moveSpeed;
    const target = this.#velocityTarget.set(sinYaw * drive, 0, cosYaw * drive);
    this.#driveVelocity.lerp(target, dampingFactor);
    target
      .set(-cosYaw * strafe, climb, sinYaw * strafe)
      .multiplyScalar(movementSpeed * moveSpeed);
    this.#strafeClimbVelocity.lerp(target, dampingFactor);
    let longitudinalSpeed =
      this.#driveVelocity.x * sinYaw + this.#driveVelocity.z * cosYaw;
    if (drive !== 0) {
      this.#retreatEndSpeedSq =
        this.#driveVelocity.lengthSq() * RETREAT_END_RATIO ** 2;
    } else if (
      longitudinalSpeed < 0 &&
      this.#driveVelocity.lengthSq() <= this.#retreatEndSpeedSq
    ) {
      this.#driveVelocity.set(0, 0, 0);
      longitudinalSpeed = 0;
    }
    target.addVectors(this.#driveVelocity, this.#strafeClimbVelocity);
    controls.object.position.addScaledVector(target, deltaTime);
    if (longitudinalSpeed * deltaTime < 0) {
      this.#backwardObject = controls.object;
      this.#backwardGamepad = input.gamepad;
    }
  }

  /**
   * Applies camera look input while keeping FirstPersonControls state in sync.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param orientation - Native look angles at the start of the frame.
   * @param lookSpeed - User-configured look speed multiplier.
   * @param look - Processed camera-look stick input.
   */
  #applyLook(
    deltaTime: number,
    orientation: FirstPersonOrientation,
    lookSpeed: number,
    look: Readonly<GamepadStick>,
  ): void {
    const { x: lookX, y: lookY } = look;
    const controls = this.#controls;
    const actualLookSpeed = controls.lookSpeed * lookSpeed * LOOK_SPEED_SCALE;
    let verticalLookRatio = 1;
    const verticalRange = controls.verticalMax - controls.verticalMin;
    if (controls.constrainVertical && verticalRange !== 0) {
      verticalLookRatio = Math.PI / verticalRange;
    }
    // Angular velocities are degrees per second. As with native pointer
    // input, disabling vertical look brings its target velocity to zero.
    this.#lonVelocity = MathUtils.lerp(
      this.#lonVelocity,
      -lookX * actualLookSpeed,
      controls.dampingFactor,
    );
    this.#latVelocity = MathUtils.lerp(
      this.#latVelocity,
      controls.lookVertical ? -lookY * actualLookSpeed * verticalLookRatio : 0,
      controls.dampingFactor,
    );
    if (this.#latVelocity === 0 && this.#lonVelocity === 0) {
      return;
    }
    let { lat, lon } = orientation;
    lon += this.#lonVelocity * deltaTime;
    lat += this.#latVelocity * deltaTime;
    lat = Math.max(-85, Math.min(85, lat));
    let phi = MathUtils.degToRad(90 - lat);
    const theta = MathUtils.degToRad(lon);
    if (controls.constrainVertical) {
      phi = MathUtils.mapLinear(
        phi,
        0,
        Math.PI,
        controls.verticalMin,
        controls.verticalMax,
      );
    }
    this.#targetPosition
      .setFromSphericalCoords(1, phi, theta)
      .add(controls.object.position);
    controls.object.lookAt(this.#targetPosition);

    // FirstPersonControls stores look state internally. Keep it synchronized so
    // its own update() can add keyboard/mouse input without resetting gamepad look.
    controls._lat = lat;
    controls._lon = lon;
  }

  /**
   * Reads the current FirstPersonControls orientation, deriving it if needed.
   *
   * @returns Current latitude and longitude in degrees.
   */
  #getOrientation(): FirstPersonOrientation {
    const { _lat, _lon } = this.#controls;
    if (Number.isFinite(_lat) && Number.isFinite(_lon)) {
      this.#orientation.lat = _lat;
      this.#orientation.lon = _lon;
    } else {
      this.#lookDirection
        .set(0, 0, -1)
        .applyQuaternion(this.#controls.object.quaternion);
      this.#spherical.setFromVector3(this.#lookDirection);
      this.#orientation.lat = 90 - MathUtils.radToDeg(this.#spherical.phi);
      this.#orientation.lon = MathUtils.radToDeg(this.#spherical.theta);
    }
    return this.#orientation;
  }
}
