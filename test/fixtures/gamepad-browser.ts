import { test, vi } from "vitest";

/**
 * Installs a controllable Gamepad API polling stub for a test.
 */
export const createGamepadPollingFixture = () => {
  const gamepads: (Gamepad | null)[] = [];
  const getGamepads = vi.fn(() => gamepads as Gamepad[]);
  const setGamepads = (nextGamepads: readonly (Gamepad | null)[]): void => {
    gamepads.splice(0, gamepads.length, ...nextGamepads);
  };

  vi.stubGlobal("navigator", { getGamepads });

  return {
    gamepads,
    getGamepads,
    setGamepads,
  };
};

export type GamepadPollingFixture = ReturnType<
  typeof createGamepadPollingFixture
>;

/**
 * Vitest instance extended with an isolated Gamepad API polling fixture.
 */
export const gamepadTest = test.extend(
  "gamepadPolling",
  ({ task: _task }, { onCleanup }) => {
    const polling = createGamepadPollingFixture();

    onCleanup(() => {
      vi.unstubAllGlobals();
    });

    return polling;
  },
);

/**
 * Dispatches a browser Gamepad event carrying the supplied snapshot.
 */
export const dispatchGamepadEvent = (
  type: "gamepadconnected" | "gamepaddisconnected",
  gamepad: Gamepad,
): void => {
  const event = new Event(type);

  Object.defineProperty(event, "gamepad", {
    value: gamepad,
  });
  window.dispatchEvent(event);
};
