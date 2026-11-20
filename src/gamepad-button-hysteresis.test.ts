import { describe, expect, test } from "vitest";

import { GamepadButtonHysteresis } from "./gamepad-button-hysteresis.ts";

describe("GamepadButtonHysteresis", () => {
  test("holds the previous state between the two inclusive thresholds", () => {
    const detector = new GamepadButtonHysteresis({
      pressPoint: 0.6,
      releasePoint: 0.4,
    });

    for (const [sample, isPressed, wasPressed, wasReleased] of [
      [0, false, false, false],
      [0.59, false, false, false],
      [0.6, true, true, false],
      [0.58, true, false, false],
      [0.41, true, false, false],
      [0.4, false, false, true],
      [0.42, false, false, false],
    ] as const) {
      detector.update(sample);
      expect(detector).toMatchObject({ isPressed, wasPressed, wasReleased });
    }
  });

  test("allows multiple reads of each transition and clears it on a repeated sample", () => {
    const detector = new GamepadButtonHysteresis({
      pressPoint: 1,
      releasePoint: 0,
    });
    detector.update(0);
    detector.update(1);
    expect(detector.wasPressed).toBe(true);
    expect(detector.wasPressed).toBe(true);
    detector.update(1);
    expect(detector).toMatchObject({ isPressed: true, wasPressed: false });

    detector.update(0);
    expect(detector.wasReleased).toBe(true);
    expect(detector.wasReleased).toBe(true);
    detector.update(0);
    expect(detector).toMatchObject({ isPressed: false, wasReleased: false });
  });

  test("seeds held pressure silently at construction and after reset", () => {
    const detector = new GamepadButtonHysteresis({
      pressPoint: 0.6,
      releasePoint: 0.4,
    });
    const released = {
      isPressed: false,
      wasPressed: false,
      wasReleased: false,
    };
    const held = { ...released, isPressed: true };
    expect(detector).toMatchObject(released);
    detector.update(0.8);
    expect(detector).toMatchObject(held);

    detector.update(0);
    detector.update(0.8);
    expect(detector.wasPressed).toBe(true);
    detector.reset();
    expect(detector).toMatchObject(released);
    detector.reset();
    detector.update(0.8);
    expect(detector).toMatchObject(held);
  });

  test("tracks two actions on the same pressure independently", () => {
    const first = new GamepadButtonHysteresis({
      pressPoint: 0.6,
      releasePoint: 0.4,
    });
    const second = new GamepadButtonHysteresis({
      pressPoint: 0.8,
      releasePoint: 0.5,
    });
    for (const sample of [0, 0.7]) {
      first.update(sample);
      second.update(sample);
    }
    expect(first.wasPressed).toBe(true);
    expect(second.isPressed).toBe(false);

    for (const sample of [0.8, 0.5]) {
      first.update(sample);
      second.update(sample);
    }
    expect(first.isPressed).toBe(true);
    expect(first.wasReleased).toBe(false);
    expect(second.wasReleased).toBe(true);
  });

  test.each([
    { pressPoint: Number.NaN, releasePoint: 0.4 },
    { pressPoint: Number.POSITIVE_INFINITY, releasePoint: 0.4 },
    { pressPoint: 0.6, releasePoint: Number.NaN },
    { pressPoint: 0.6, releasePoint: Number.NEGATIVE_INFINITY },
    { pressPoint: 0.6, releasePoint: -0.1 },
    { pressPoint: 0.4, releasePoint: 0.4 },
    { pressPoint: 0.4, releasePoint: 0.6 },
    { pressPoint: 1.1, releasePoint: 0.4 },
  ])("rejects invalid thresholds %o", (options) => {
    expect(() => new GamepadButtonHysteresis(options)).toThrow(RangeError);
  });

  test.each([undefined, null, {}, { pressPoint: 0.6 }, { pressPoint: "0.6" }])(
    "rejects incomplete or non-numeric options from JavaScript: %o",
    (options) => {
      expect(() =>
        Reflect.construct(GamepadButtonHysteresis, [options]),
      ).toThrow(RangeError);
    },
  );

  test.each([
    -0.1,
    1.1,
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ])("rejects pressure %s without changing the observation", (sample) => {
    const detector = new GamepadButtonHysteresis({
      pressPoint: 0.6,
      releasePoint: 0.4,
    });
    expect(() => detector.update(sample)).toThrow(RangeError);
    detector.update(0.8);
    expect(detector).toMatchObject({
      isPressed: true,
      wasPressed: false,
      wasReleased: false,
    });

    detector.update(0);
    detector.update(0.8);
    expect(() => detector.update(sample)).toThrow(RangeError);
    expect(detector).toMatchObject({
      isPressed: true,
      wasPressed: true,
      wasReleased: false,
    });
  });
});
