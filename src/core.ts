/**
 * Button indices for the W3C Standard Gamepad mapping.
 * @see https://www.w3.org/TR/gamepad/#dfn-standard-gamepad
 */
export const GAMEPAD_BUTTON = {
  South: 0,
  East: 1,
  West: 2,
  North: 3,
  LeftShoulder: 4,
  RightShoulder: 5,
  LeftTrigger: 6,
  RightTrigger: 7,
  Select: 8,
  Start: 9,
  LeftStick: 10,
  RightStick: 11,
  DPadUp: 12,
  DPadDown: 13,
  DPadLeft: 14,
  DPadRight: 15,
  Home: 16,
} as const;

/**
 * Axis indices for the W3C Standard Gamepad mapping.
 * @see https://www.w3.org/TR/gamepad/#dfn-standard-gamepad
 */
export const GAMEPAD_AXIS = {
  LeftX: 0,
  LeftY: 1,
  RightX: 2,
  RightY: 3,
} as const;

/**
 * Union type of all valid {@link GAMEPAD_BUTTON} keys.
 */
export type GamepadButtonKey = keyof typeof GAMEPAD_BUTTON;

/**
 * Union type of all valid {@link GAMEPAD_BUTTON} values.
 */
export type GamepadButtonValue =
  (typeof GAMEPAD_BUTTON)[keyof typeof GAMEPAD_BUTTON];

/**
 * Union type of all valid {@link GAMEPAD_AXIS} keys.
 */
export type GamepadAxisKey = keyof typeof GAMEPAD_AXIS;

/**
 * Union type of all valid {@link GAMEPAD_AXIS} values.
 */
export type GamepadAxisValue = (typeof GAMEPAD_AXIS)[keyof typeof GAMEPAD_AXIS];
