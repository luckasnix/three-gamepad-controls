type RuntimeGamepad = Omit<Gamepad, "vibrationActuator"> & {
  // Browsers without haptic support may omit the specification property.
  readonly vibrationActuator?: RuntimeGamepadHapticActuator | null;
};

type RuntimeGamepadHapticActuator = {
  // Runtime feature checks are required because browser support is incomplete.
  playEffect?: GamepadHapticActuator["playEffect"];
  reset?: GamepadHapticActuator["reset"];
};

/**
 * Returns the primary vibration actuator exposed by a gamepad at runtime.
 *
 * The DOM types follow the specification and declare `vibrationActuator` as
 * always present, while browsers without haptic support may omit it entirely.
 * Access failures are treated as lack of support.
 *
 * @param gamepad - Active gamepad snapshot, or `null`.
 * @returns The runtime actuator, or `null` when unavailable.
 */
const getGamepadVibrationActuator = (
  gamepad: Gamepad | null,
): RuntimeGamepadHapticActuator | null => {
  if (gamepad === null) {
    return null;
  }

  try {
    return (gamepad as RuntimeGamepad).vibrationActuator ?? null;
  } catch {
    return null;
  }
};

/**
 * Identifies environmental haptics failures that should degrade to a no-op.
 *
 * `NotSupportedError` means the actuator cannot play the requested effect.
 * `InvalidStateError` means the document cannot currently issue the effect,
 * such as while it is hidden. Parameter errors intentionally remain visible.
 *
 * @param error - Rejection reason returned by the browser.
 * @returns Whether the failure should be ignored as unavailable haptics.
 */
const isIgnorableHapticsError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return false;
  }

  const { name } = error;

  return name === "NotSupportedError" || name === "InvalidStateError";
};

/**
 * Returns whether the active gamepad exposes the current vibration API.
 *
 * This detects actuator and method availability, not support for a particular
 * haptic effect type.
 *
 * @param gamepad - Active gamepad snapshot, or `null`.
 * @returns `true` when `vibrationActuator.playEffect` is callable.
 */
export const isGamepadVibrationSupported = (
  gamepad: Gamepad | null,
): boolean => {
  const actuator = getGamepadVibrationActuator(gamepad);

  return typeof actuator?.playEffect === "function";
};

/**
 * Plays a haptic effect through the current primary vibration actuator.
 *
 * Unsupported or temporarily unavailable haptics resolve to `null`. Invalid
 * parameters and other unexpected failures remain rejected.
 *
 * @param gamepad - Active gamepad snapshot, or `null`.
 * @param type - Haptic effect type to play.
 * @param parameters - Optional parameters describing the effect.
 * @returns The browser result, or `null` when the effect is ignored.
 */
export const playGamepadVibrationEffect = async (
  gamepad: Gamepad | null,
  type: GamepadHapticEffectType,
  parameters?: GamepadEffectParameters,
): Promise<GamepadHapticsResult | null> => {
  const actuator = getGamepadVibrationActuator(gamepad);

  if (typeof actuator?.playEffect !== "function") {
    return null;
  }

  try {
    return await actuator.playEffect(type, parameters);
  } catch (error) {
    if (isIgnorableHapticsError(error)) {
      return null;
    }
    throw error;
  }
};

/**
 * Stops the active effect on the current primary vibration actuator.
 *
 * Unsupported or temporarily unavailable haptics resolve to `null`.
 * Unexpected failures remain rejected.
 *
 * @param gamepad - Active gamepad snapshot, or `null`.
 * @returns The browser result, or `null` when reset is ignored.
 */
export const resetGamepadVibration = async (
  gamepad: Gamepad | null,
): Promise<GamepadHapticsResult | null> => {
  const actuator = getGamepadVibrationActuator(gamepad);

  if (typeof actuator?.reset !== "function") {
    return null;
  }

  try {
    return await actuator.reset();
  } catch (error) {
    if (isIgnorableHapticsError(error)) {
      return null;
    }
    throw error;
  }
};
