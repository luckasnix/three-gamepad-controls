import { test, vi } from "vitest";

import { createGamepad, type GamepadFixtureOptions } from "./gamepad.ts";

export type GamepadFrameEntry = readonly [number, GamepadFixtureOptions?];

/**
 * Installs a controllable Gamepad API polling stub for a test.
 */
export const createGamepadPollingFixture = () => {
  const gamepads: (Gamepad | null)[] = [];
  const getGamepads = vi
    .spyOn(navigator, "getGamepads")
    .mockImplementation(() => gamepads as Gamepad[]);
  const setGamepads = (nextGamepads: readonly (Gamepad | null)[]): void => {
    gamepads.splice(0, gamepads.length, ...nextGamepads);
  };
  let frame = 0;
  /** Publishes fresh snapshots at their real slots, including explicit holes. */
  const publishFrame = (...entries: GamepadFrameEntry[]): void => {
    frame += 1;
    const next: (Gamepad | null)[] = [];
    for (const [index, options] of entries) {
      if (!Number.isInteger(index) || index < 0 || index > 2 ** 31 - 1) {
        throw new RangeError("Invalid gamepad fixture index");
      }
      if (next[index]) throw new Error("Duplicate gamepad fixture index");
      while (next.length <= index) next.push(null);
      next[index] = createGamepad(index, {
        ...options,
        timestamp: options?.timestamp ?? frame,
        axes: [...(options?.axes ?? [0, 0, 0, 0])],
        buttons: Array.from(options?.buttons ?? [], (button) =>
          button ? { ...button } : { pressed: false, touched: false, value: 0 },
        ),
      });
    }
    setGamepads(next);
  };

  return {
    gamepads,
    getGamepads,
    setGamepads,
    publishFrame,
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
      polling.getGamepads.mockRestore();
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
