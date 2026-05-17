import type {
  STANDARD_GAMEPAD_AXIS,
  STANDARD_GAMEPAD_BUTTON,
} from "./constants";

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
