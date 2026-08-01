/**
 * Customizations for a Gamepad test fixture.
 *
 * Properties not provided receive valid defaults.
 */
export type GamepadFixtureOptions = {
  axes?: readonly number[];
  buttons?: readonly GamepadButton[];
  connected?: boolean;
  hapticActuators?: readonly GamepadHapticActuator[];
  id?: string;
  mapping?: GamepadMappingType;
  timestamp?: number;
  vibrationActuator?: GamepadHapticActuator;
};

/**
 * Creates a GamepadButton fixture with consistent pressed, touched, and value
 * state.
 */
export const createGamepadButton = (
  pressed = false,
  value = pressed ? 1 : 0,
): GamepadButton => ({
  pressed,
  touched: pressed || value !== 0,
  value,
});

/**
 * Indexed button state used to build a sparse Gamepad button list.
 */
export type GamepadButtonFixtureEntry = readonly [
  index: number,
  pressed: boolean,
  value?: number,
];

/**
 * Creates a sparse Gamepad button list from indexed button states.
 */
export const createGamepadButtons = (
  ...entries: GamepadButtonFixtureEntry[]
): GamepadButton[] => {
  const buttons: GamepadButton[] = [];

  for (const [index, pressed, value] of entries) {
    buttons[index] = createGamepadButton(pressed, value);
  }

  return buttons;
};

/**
 * Creates a haptic actuator whose operations succeed by default.
 *
 * Individual methods can be overridden with spies or alternative behavior.
 */
export const createGamepadHapticActuator = (
  overrides?: Partial<GamepadHapticActuator>,
): GamepadHapticActuator => ({
  playEffect: () => Promise.resolve("complete"),
  pulse: () => Promise.resolve(true),
  reset: () => Promise.resolve("complete"),
  ...overrides,
});

/**
 * Creates a shallowly frozen Gamepad fixture with valid default properties.
 */
export const createGamepad = (
  index: number,
  options?: GamepadFixtureOptions,
): Gamepad => {
  const gamepad: Gamepad = {
    axes: options?.axes ?? [],
    buttons: options?.buttons ?? [],
    connected: options?.connected ?? true,
    hapticActuators: options?.hapticActuators ?? [],
    id: options?.id ?? `gamepad-${index}`,
    index,
    mapping: options?.mapping ?? "standard",
    timestamp: options?.timestamp ?? 0,
    vibrationActuator:
      options?.vibrationActuator ?? createGamepadHapticActuator(),
  };

  return Object.freeze(gamepad);
};
