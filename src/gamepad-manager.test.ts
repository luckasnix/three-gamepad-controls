import { beforeEach, describe, expect, test, vi } from "vitest";

import { createGamepad } from "../test/fixtures/gamepad.ts";
import { MAX_GAMEPAD_INDEX, MIN_GAMEPAD_INDEX } from "./core.ts";
import { GamepadManager } from "./gamepad-manager.ts";

let polledGamepads: (Gamepad | null)[];

beforeEach(() => {
  polledGamepads = [];
  vi.stubGlobal("navigator", {
    getGamepads: vi.fn(() => polledGamepads as Gamepad[]),
  });
});

describe("GamepadManager construction", () => {
  test.each([
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    -1,
    0.5,
    MAX_GAMEPAD_INDEX + 1,
  ])("rejects the invalid gamepad index $gamepadIndex", (gamepadIndex) => {
    expect(() => new GamepadManager({ gamepadIndex })).toThrow(
      new RangeError(
        `gamepadIndex must be an integer between ${MIN_GAMEPAD_INDEX} and ${MAX_GAMEPAD_INDEX}.`,
      ),
    );
  });

  test.each([MIN_GAMEPAD_INDEX, MAX_GAMEPAD_INDEX])(
    "accepts the boundary gamepad index %i",
    (gamepadIndex) => {
      expect(() => new GamepadManager({ gamepadIndex })).not.toThrow();
    },
  );

  test("starts without an active gamepad", () => {
    expect(new GamepadManager().activeGamepad).toBeNull();
  });
});

describe("GamepadManager.connect", () => {
  test("selects the connected gamepad with the lowest reported index", () => {
    const highIndexGamepad = createGamepad(5);
    const lowIndexGamepad = createGamepad(2);
    const higherIndexGamepad = createGamepad(7);
    const disconnectedGamepad = createGamepad(1, { connected: false });
    polledGamepads = [
      highIndexGamepad,
      null,
      disconnectedGamepad,
      lowIndexGamepad,
      higherIndexGamepad,
    ];
    const manager = new GamepadManager();

    expect(manager.connect(createGamepad(9))).toBe(lowIndexGamepad);
    expect(manager.activeGamepad).toBe(lowIndexGamepad);
  });

  test("returns null when polling finds no selectable gamepad", () => {
    polledGamepads = [null, createGamepad(1, { connected: false })];
    const manager = new GamepadManager();

    expect(manager.connect(createGamepad(2))).toBeNull();
    expect(manager.activeGamepad).toBeNull();
  });

  test("ignores a connection event for a disconnected gamepad", () => {
    polledGamepads = [createGamepad(0)];
    const manager = new GamepadManager();

    expect(manager.connect(createGamepad(0, { connected: false }))).toBeNull();
    expect(manager.activeGamepad).toBeNull();
  });

  test("does not replace an active gamepad", () => {
    const activeGamepad = createGamepad(0);
    const replacementGamepad = createGamepad(1);
    polledGamepads = [activeGamepad];
    const manager = new GamepadManager();
    manager.connect(activeGamepad);
    polledGamepads = [replacementGamepad];

    expect(manager.connect(replacementGamepad)).toBeNull();
    expect(manager.activeGamepad).toBe(activeGamepad);
  });

  test("uses only connection events matching an explicit index", () => {
    const eventGamepad = createGamepad(2, { timestamp: 1 });
    const polledGamepad = createGamepad(2, { timestamp: 2 });
    polledGamepads[2] = polledGamepad;
    const manager = new GamepadManager({ gamepadIndex: 2 });

    expect(manager.connect(createGamepad(1))).toBeNull();
    expect(manager.connect(eventGamepad)).toBe(polledGamepad);
    expect(manager.activeGamepad).toBe(polledGamepad);
  });

  test("requires the explicitly selected slot to be connected", () => {
    const eventGamepad = createGamepad(2);
    polledGamepads[2] = createGamepad(2, { connected: false });
    const manager = new GamepadManager({ gamepadIndex: 2 });

    expect(manager.connect(eventGamepad)).toBeNull();
    expect(manager.activeGamepad).toBeNull();
  });
});

describe("GamepadManager.disconnect", () => {
  test("ignores disconnection when no gamepad is active", () => {
    const manager = new GamepadManager();

    expect(manager.disconnect(createGamepad(0))).toBeNull();
  });

  test("ignores a disconnection from a different slot", () => {
    const activeGamepad = createGamepad(1);
    const manager = new GamepadManager();
    manager.activeGamepad = activeGamepad;

    expect(manager.disconnect(createGamepad(2))).toBeNull();
    expect(manager.activeGamepad).toBe(activeGamepad);
  });

  test("disconnects a matching slot by index and defers its replacement", () => {
    const activeGamepad = createGamepad(1, { timestamp: 1 });
    const disconnectEventGamepad = createGamepad(1, {
      connected: false,
      timestamp: 2,
    });
    const replacementGamepad = createGamepad(1, { timestamp: 3 });
    const manager = new GamepadManager();
    manager.activeGamepad = activeGamepad;

    expect(manager.disconnect(disconnectEventGamepad)).toBe(activeGamepad);
    expect(manager.activeGamepad).toBeNull();

    polledGamepads[1] = replacementGamepad;

    expect(manager.connect(replacementGamepad)).toBeNull();
    expect(manager.update()).toEqual({
      gamepad: replacementGamepad,
      connected: replacementGamepad,
      disconnected: null,
    });
  });
});

describe("GamepadManager.update", () => {
  test("returns an empty result when no selectable gamepad exists", () => {
    polledGamepads = [null, createGamepad(1, { connected: false })];
    const manager = new GamepadManager();

    expect(manager.update()).toEqual({
      gamepad: null,
      connected: null,
      disconnected: null,
    });
    expect(manager.activeGamepad).toBeNull();
  });

  test("reports a newly selected first-available gamepad", () => {
    const gamepad = createGamepad(3);
    polledGamepads = [gamepad];
    const manager = new GamepadManager();

    expect(manager.update()).toEqual({
      gamepad,
      connected: gamepad,
      disconnected: null,
    });
    expect(manager.activeGamepad).toBe(gamepad);
  });

  test("ignores other slots while waiting for an explicit index", () => {
    const otherGamepad = createGamepad(0);
    const selectedGamepad = createGamepad(2);
    polledGamepads = [otherGamepad];
    const manager = new GamepadManager({ gamepadIndex: 2 });

    expect(manager.update()).toEqual({
      gamepad: null,
      connected: null,
      disconnected: null,
    });

    polledGamepads[2] = selectedGamepad;

    expect(manager.update()).toEqual({
      gamepad: selectedGamepad,
      connected: selectedGamepad,
      disconnected: null,
    });
  });

  test("refreshes an active slot without reporting a transition", () => {
    const previousGamepad = createGamepad(1, {
      id: "previous",
      timestamp: 1,
    });
    const refreshedGamepad = createGamepad(1, {
      id: "replacement",
      timestamp: 2,
    });
    polledGamepads[1] = refreshedGamepad;
    const manager = new GamepadManager();
    manager.activeGamepad = previousGamepad;

    expect(manager.update()).toEqual({
      gamepad: refreshedGamepad,
      connected: null,
      disconnected: null,
    });
    expect(manager.activeGamepad).toBe(refreshedGamepad);
  });

  test("reports an active gamepad that disappears during polling", () => {
    const activeGamepad = createGamepad(1);
    polledGamepads[1] = createGamepad(1, { connected: false });
    const manager = new GamepadManager();
    manager.activeGamepad = activeGamepad;

    expect(manager.update()).toEqual({
      gamepad: null,
      connected: null,
      disconnected: activeGamepad,
    });
    expect(manager.activeGamepad).toBeNull();
  });
});
