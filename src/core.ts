/**
 * Button indices for the W3C Standard Gamepad mapping.
 *
 * Most modern controllers (Xbox, PlayStation, Switch Pro) follow this layout
 * when connected to a browser. Use these constants instead of magic numbers
 * so your code documents itself.
 *
 * @see https://www.w3.org/TR/gamepad/#dfn-standard-gamepad
 */
export const STANDARD_GAMEPAD_BUTTON = {
  /** Bottom button in right cluster */
  South: 0,
  /** Right button in right cluster */
  East: 1,
  /** Left button in right cluster */
  West: 2,
  /** Top button in right cluster */
  North: 3,
  /** Top left front button */
  LeftShoulder: 4,
  /** Top right front button */
  RightShoulder: 5,
  /** Bottom left front button */
  LeftTrigger: 6,
  /** Bottom right front button */
  RightTrigger: 7,
  /** Left button in center cluster */
  Select: 8,
  /** Right button in center cluster */
  Start: 9,
  /** Left stick pressed button */
  LeftStick: 10,
  /** Right stick pressed button */
  RightStick: 11,
  /** Top button in left cluster */
  DPadUp: 12,
  /** Bottom button in left cluster */
  DPadDown: 13,
  /** Left button in left cluster */
  DPadLeft: 14,
  /** Right button in left cluster */
  DPadRight: 15,
  /** Center button in center cluster */
  Home: 16,
} as const;

/**
 * Axis indices for the W3C Standard Gamepad mapping.
 *
 * Each axis returns a value in the range `[-1, 1]`.
 *
 * @see https://www.w3.org/TR/gamepad/#dfn-standard-gamepad
 */
export const STANDARD_GAMEPAD_AXIS = {
  /** Horizontal axis for left stick (negative left/positive right) */
  LeftX: 0,
  /** Vertical axis for left stick (negative up/positive down) */
  LeftY: 1,
  /** Horizontal axis for right stick (negative left/positive right) */
  RightX: 2,
  /** Vertical axis for right stick (negative up/positive down) */
  RightY: 3,
} as const;

/** Union type of all valid {@link STANDARD_GAMEPAD_BUTTON} keys. */
export type StandardGamepadButtonKey = keyof typeof STANDARD_GAMEPAD_BUTTON;

/** Union type of all valid {@link STANDARD_GAMEPAD_BUTTON} values. */
export type StandardGamepadButtonValue =
  (typeof STANDARD_GAMEPAD_BUTTON)[keyof typeof STANDARD_GAMEPAD_BUTTON];

/** Union type of all valid {@link STANDARD_GAMEPAD_AXIS} keys. */
export type StandardGamepadAxisKey = keyof typeof STANDARD_GAMEPAD_AXIS;

/** Union type of all valid {@link STANDARD_GAMEPAD_AXIS} values. */
export type StandardGamepadAxisValue =
  (typeof STANDARD_GAMEPAD_AXIS)[keyof typeof STANDARD_GAMEPAD_AXIS];
