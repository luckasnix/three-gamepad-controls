/**
 * Returns `value` unchanged, or `0` if below the dead zone `threshold`.
 *
 * @param value - Raw axis or trigger value, typically in `[-1, 1]`.
 * @param threshold - Dead zone size; values below this magnitude are zeroed.
 * @returns The original value when outside the dead zone, otherwise `0`.
 */
export const applyGamepadDeadzone = (
  value: number,
  threshold: number,
): number => {
  return Math.abs(value) < threshold ? 0 : value;
};

/**
 * Returns whether a gamepad button is currently pressed.
 *
 * Missing buttons are treated as not pressed.
 *
 * @param gamepad - Gamepad snapshot to read from.
 * @param button - Button index to inspect.
 * @returns `true` when the button exists and is pressed, otherwise `false`.
 */
export const getGamepadButtonPressed = (
  gamepad: Gamepad,
  button: number,
): boolean => {
  return gamepad.buttons[button]?.pressed ?? false;
};

/**
 * Returns the analog value for a gamepad button.
 *
 * Some digital buttons may report `pressed` without a meaningful non-zero
 * `value`, so pressed buttons fall back to `1`.
 *
 * @param gamepad - Gamepad snapshot to read from.
 * @param button - Button index to inspect.
 * @returns The button value, `1` for pressed digital buttons, or `0` when unavailable.
 */
export const getGamepadButtonValue = (
  gamepad: Gamepad,
  button: number,
): number => {
  const gamepadButton = gamepad.buttons[button];

  if (gamepadButton === undefined) {
    return 0;
  }

  if (gamepadButton.value !== 0) {
    return gamepadButton.value;
  }

  return gamepadButton.pressed ? 1 : 0;
};

/**
 * Returns a fresh connected gamepad snapshot by index.
 *
 * @param index - Gamepad index to look up.
 * @returns The connected gamepad snapshot at the index, or `null` when unavailable.
 */
export const getGamepadByIndex = (index: number): Gamepad | null => {
  const gamepad = navigator.getGamepads()[index] ?? null;
  return gamepad?.connected === true ? gamepad : null;
};

/**
 * Returns the first currently connected gamepad snapshot.
 *
 * @returns The first connected gamepad snapshot, or `null` when none are connected.
 */
export const getFirstConnectedGamepad = (): Gamepad | null => {
  for (const gamepad of navigator.getGamepads()) {
    if (gamepad?.connected === true) {
      return gamepad;
    }
  }

  return null;
};
