import { describe, expect, test, vi } from "vitest";
import {
  createGamepad,
  createGamepadHapticActuator,
} from "../test/fixtures/gamepad.ts";
import {
  isGamepadVibrationSupported,
  playGamepadVibrationEffect,
  resetGamepadVibration,
} from "./gamepad-haptics.ts";

type RuntimeGamepadHapticActuator = Partial<
  Pick<GamepadHapticActuator, "playEffect" | "reset">
>;

const createRuntimeGamepad = (
  vibrationActuator?: RuntimeGamepadHapticActuator | null,
): Gamepad =>
  ({
    ...createGamepad(0),
    vibrationActuator,
  }) as unknown as Gamepad;

const createGamepadWithThrowingActuatorGetter = (): Gamepad => {
  const gamepad = { ...createGamepad(0) };

  Object.defineProperty(gamepad, "vibrationActuator", {
    get: () => {
      throw new Error("Access to the actuator is blocked.");
    },
  });

  return gamepad;
};

describe("isGamepadVibrationSupported", () => {
  test("returns false when there is no gamepad", () => {
    expect(isGamepadVibrationSupported(null)).toBe(false);
  });

  test.each([
    ["is missing", undefined],
    ["is null", null],
    ["does not expose playEffect", {}],
  ] as const)(
    "returns false when the vibration actuator %s",
    (_label, vibrationActuator) => {
      expect(
        isGamepadVibrationSupported(createRuntimeGamepad(vibrationActuator)),
      ).toBe(false);
    },
  );

  test("returns false when reading the actuator throws", () => {
    expect(
      isGamepadVibrationSupported(createGamepadWithThrowingActuatorGetter()),
    ).toBe(false);
  });

  test("returns true when the actuator exposes playEffect", () => {
    expect(isGamepadVibrationSupported(createGamepad(0))).toBe(true);
  });
});

describe("playGamepadVibrationEffect", () => {
  test.each([
    ["there is no gamepad", null],
    ["the actuator is missing", createRuntimeGamepad()],
    [
      "playEffect is missing",
      createRuntimeGamepad({
        reset: () => Promise.resolve("complete"),
      }),
    ],
  ])("returns null when %s", async (_label, gamepad) => {
    await expect(
      playGamepadVibrationEffect(gamepad, "dual-rumble"),
    ).resolves.toBeNull();
  });

  test("plays the requested effect and returns its result", async () => {
    const parameters: GamepadEffectParameters = {
      duration: 100,
      strongMagnitude: 0.75,
      weakMagnitude: 0.25,
    };
    const playEffect = vi
      .fn<GamepadHapticActuator["playEffect"]>()
      .mockResolvedValue("complete");
    const gamepad = createGamepad(0, {
      vibrationActuator: createGamepadHapticActuator({ playEffect }),
    });

    await expect(
      playGamepadVibrationEffect(gamepad, "dual-rumble", parameters),
    ).resolves.toBe("complete");
    expect(playEffect).toHaveBeenCalledOnce();
    expect(playEffect).toHaveBeenCalledWith("dual-rumble", parameters);
  });

  test("forwards an omitted parameters argument as undefined", async () => {
    const playEffect = vi
      .fn<GamepadHapticActuator["playEffect"]>()
      .mockResolvedValue("preempted");
    const gamepad = createGamepad(0, {
      vibrationActuator: createGamepadHapticActuator({ playEffect }),
    });

    await expect(
      playGamepadVibrationEffect(gamepad, "dual-rumble"),
    ).resolves.toBe("preempted");
    expect(playEffect).toHaveBeenCalledWith("dual-rumble", undefined);
  });

  test.each(["NotSupportedError", "InvalidStateError"])(
    "returns null for the ignorable %s",
    async (name) => {
      const playEffect = vi
        .fn<GamepadHapticActuator["playEffect"]>()
        .mockRejectedValue(new DOMException("Effect rejected.", name));
      const gamepad = createGamepad(0, {
        vibrationActuator: createGamepadHapticActuator({ playEffect }),
      });

      await expect(
        playGamepadVibrationEffect(gamepad, "dual-rumble"),
      ).resolves.toBeNull();
    },
  );

  test.each([
    ["a primitive", "Effect rejected."],
    ["null", null],
    ["an object without a name", {}],
    ["an error with another name", { name: "AbortError" }],
  ])("rethrows %s", async (_label, error) => {
    const playEffect = vi
      .fn<GamepadHapticActuator["playEffect"]>()
      .mockRejectedValue(error);
    const gamepad = createGamepad(0, {
      vibrationActuator: createGamepadHapticActuator({ playEffect }),
    });

    await expect(
      playGamepadVibrationEffect(gamepad, "dual-rumble"),
    ).rejects.toBe(error);
  });
});

describe("resetGamepadVibration", () => {
  test.each([
    ["there is no gamepad", null],
    ["the actuator is missing", createRuntimeGamepad()],
    [
      "reset is missing",
      createRuntimeGamepad({
        playEffect: () => Promise.resolve("complete"),
      }),
    ],
  ])("returns null when %s", async (_label, gamepad) => {
    await expect(resetGamepadVibration(gamepad)).resolves.toBeNull();
  });

  test("resets vibration and returns the actuator result", async () => {
    const reset = vi
      .fn<GamepadHapticActuator["reset"]>()
      .mockResolvedValue("preempted");
    const gamepad = createGamepad(0, {
      vibrationActuator: createGamepadHapticActuator({ reset }),
    });

    await expect(resetGamepadVibration(gamepad)).resolves.toBe("preempted");
    expect(reset).toHaveBeenCalledOnce();
    expect(reset).toHaveBeenCalledWith();
  });

  test("returns null for an ignorable actuator error", async () => {
    const reset = vi
      .fn<GamepadHapticActuator["reset"]>()
      .mockRejectedValue(
        new DOMException("Reset rejected.", "InvalidStateError"),
      );
    const gamepad = createGamepad(0, {
      vibrationActuator: createGamepadHapticActuator({ reset }),
    });

    await expect(resetGamepadVibration(gamepad)).resolves.toBeNull();
  });

  test("rethrows an unexpected actuator error", async () => {
    const error = new Error("Reset failed.");
    const reset = vi
      .fn<GamepadHapticActuator["reset"]>()
      .mockRejectedValue(error);
    const gamepad = createGamepad(0, {
      vibrationActuator: createGamepadHapticActuator({ reset }),
    });

    await expect(resetGamepadVibration(gamepad)).rejects.toBe(error);
  });
});
