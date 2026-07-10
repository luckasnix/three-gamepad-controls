import { MathUtils, Spherical, Vector3 } from "three";
import type { FirstPersonControls } from "three/addons/controls/FirstPersonControls.js";

import { GAMEPAD_AXIS, GAMEPAD_BUTTON } from "./core.ts";
import {
  GamepadControls,
  type GamepadControlsOptions,
} from "./gamepad-controls.ts";

/**
 * Configuration for {@link GamepadFirstPersonControls}.
 *
 * Every property has a sensible default, so you only need to pass the properties you want to override.
 */
export type GamepadFirstPersonControlsOptions = GamepadControlsOptions & {
  /**
   * Multiplier on `FirstPersonControls.movementSpeed` for translation.
   * @default 1.0
   */
  moveSpeed: number;

  /**
   * Multiplier on `FirstPersonControls.lookSpeed` for camera look.
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
   * @default 1 - Left stick Y
   */
  axisMoveForward: number;

  /**
   * Axis index for **right / left** strafe movement.
   * @default 0 - Left stick X
   */
  axisMoveRight: number;

  /**
   * Axis index for **horizontal** camera look (yaw).
   * @default 2 - Right stick X
   */
  axisLookX: number;

  /**
   * Axis index for **vertical** camera look (pitch).
   * @default 3 - Right stick Y
   */
  axisLookY: number;

  /**
   * Button index for **moving up** (analog trigger value used for proportional speed).
   * @default 6 - Left trigger
   */
  buttonMoveUp: number;

  /**
   * Button index for **moving down** (analog trigger value used for proportional speed).
   * @default 7 - Right trigger
   */
  buttonMoveDown: number;
};

// Default options merged in the constructor when no explicit configuration is provided.
const DEFAULT_FIRST_PERSON_OPTIONS: GamepadFirstPersonControlsOptions = {
  moveSpeed: 1.0,
  lookSpeed: 1.0,
  deadzone: 0.1,
  axisMoveForward: GAMEPAD_AXIS.LeftY,
  axisMoveRight: GAMEPAD_AXIS.LeftX,
  axisLookX: GAMEPAD_AXIS.RightX,
  axisLookY: GAMEPAD_AXIS.RightY,
  buttonMoveUp: GAMEPAD_BUTTON.LeftTrigger,
  buttonMoveDown: GAMEPAD_BUTTON.RightTrigger,
};

// Converts normalized stick input to degree deltas while preserving the
// pixel-based scale used by FirstPersonControls.lookSpeed.
const LOOK_SPEED_SCALE = 36000;

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
 * Bindings and speeds are configurable via {@link GamepadFirstPersonControlsOptions}.
 */
export class GamepadFirstPersonControls extends GamepadControls {
  readonly #controls: FirstPersonControlsWithOrientation;
  readonly #options: GamepadFirstPersonControlsOptions;

  // Pre-allocated to avoid per-frame GC pressure.
  readonly #lookDirection: Vector3;
  readonly #spherical: Spherical;
  readonly #targetPosition: Vector3;

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
    };
    this.#lookDirection = new Vector3();
    this.#spherical = new Spherical();
    this.#targetPosition = new Vector3();
  }

  /**
   * Maps the current gamepad state to `FirstPersonControls` translation and look.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  protected override onUpdate(deltaTime: number): void {
    const {
      moveSpeed,
      lookSpeed,
      deadzone,
      axisMoveForward,
      axisMoveRight,
      axisLookX,
      axisLookY,
      buttonMoveUp,
      buttonMoveDown,
    } = this.#options;

    this.#applyMovement(
      deltaTime,
      moveSpeed,
      deadzone,
      axisMoveForward,
      axisMoveRight,
      buttonMoveUp,
      buttonMoveDown,
    );

    this.#applyLook(deltaTime, lookSpeed, deadzone, axisLookX, axisLookY);
  }

  /**
   * Applies local translation input to FirstPersonControls' object.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param moveSpeed - User-configured movement speed multiplier.
   * @param deadzone - Axis and trigger dead zone threshold.
   * @param axisMoveForward - Axis index for forward and backward movement.
   * @param axisMoveRight - Axis index for right and left strafe movement.
   * @param buttonMoveUp - Button index for upward movement.
   * @param buttonMoveDown - Button index for downward movement.
   */
  #applyMovement(
    deltaTime: number,
    moveSpeed: number,
    deadzone: number,
    axisMoveForward: number,
    axisMoveRight: number,
    buttonMoveUp: number,
    buttonMoveDown: number,
  ): void {
    const controls = this.#controls;
    const input = this.gamepadInput;
    const moveMult = deltaTime * controls.movementSpeed * moveSpeed;

    // Forward / backward - left stick Y.
    // Stick up produces a negative axis value, which maps directly to local -Z.
    const forward = input.axis(axisMoveForward, { deadzone });
    if (forward !== 0) {
      let distance = forward * moveMult;

      if (forward < 0 && controls.heightSpeed) {
        const y = MathUtils.clamp(
          controls.object.position.y,
          controls.heightMin,
          controls.heightMax,
        );
        const heightDelta = y - controls.heightMin;
        distance -=
          -forward * deltaTime * heightDelta * controls.heightCoef * moveSpeed;
      }

      controls.object.translateZ(distance);
    }

    // Strafe left / right - left stick X.
    // Positive axis value (stick right) -> translateX positive -> move right.
    const strafe = input.axis(axisMoveRight, { deadzone });
    if (strafe !== 0) {
      controls.object.translateX(strafe * moveMult);
    }

    // Move up / down - analog triggers (button value in [0, 1]).
    const up = input.buttonValue(buttonMoveUp);
    const down = input.buttonValue(buttonMoveDown);

    if (up > deadzone) {
      controls.object.translateY(up * moveMult);
    }
    if (down > deadzone) {
      controls.object.translateY(-down * moveMult);
    }
  }

  /**
   * Applies camera look input while keeping FirstPersonControls state in sync.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param lookSpeed - User-configured look speed multiplier.
   * @param deadzone - Axis dead zone threshold.
   * @param axisLookX - Axis index for yaw input.
   * @param axisLookY - Axis index for pitch input.
   */
  #applyLook(
    deltaTime: number,
    lookSpeed: number,
    deadzone: number,
    axisLookX: number,
    axisLookY: number,
  ): void {
    const input = this.gamepadInput;
    const lookX = input.axis(axisLookX, { deadzone });
    const lookY = input.axis(axisLookY, { deadzone });

    if (lookX === 0 && lookY === 0) {
      return;
    }

    const controls = this.#controls;
    const actualLookSpeed =
      controls.lookSpeed * lookSpeed * deltaTime * LOOK_SPEED_SCALE;

    const orientation = this.#getOrientation();
    let { lat, lon } = orientation;

    let verticalLookRatio = 1;
    const verticalRange = controls.verticalMax - controls.verticalMin;

    if (controls.constrainVertical && verticalRange !== 0) {
      verticalLookRatio = Math.PI / verticalRange;
    }

    lon -= lookX * actualLookSpeed;
    if (controls.lookVertical) {
      lat -= lookY * actualLookSpeed * verticalLookRatio;
    }

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
      return {
        lat: _lat,
        lon: _lon,
      };
    }

    this.#lookDirection
      .set(0, 0, -1)
      .applyQuaternion(this.#controls.object.quaternion);
    this.#spherical.setFromVector3(this.#lookDirection);

    return {
      lat: 90 - MathUtils.radToDeg(this.#spherical.phi),
      lon: MathUtils.radToDeg(this.#spherical.theta),
    };
  }
}
