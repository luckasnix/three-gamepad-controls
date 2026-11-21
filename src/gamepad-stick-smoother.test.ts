import { describe, expect, test } from "vitest";

import { GamepadStickSmoother } from "./gamepad-stick-smoother.ts";

describe("GamepadStickSmoother", () => {
  const halfLifeSeconds = 0.05;
  const right = Object.freeze({ x: 1, y: 0 });
  const rest = { x: 0, y: 0 };

  test("covers half the remaining distance each half-life, starting at rest", () => {
    const smoother = new GamepadStickSmoother({ halfLifeSeconds });
    expect(smoother.update(right, 0)).toEqual(rest);
    expect(smoother.update(right, 0.05)).toEqual({ x: 0.5, y: 0 });
    expect(smoother.update(right, 0.05)).toEqual({ x: 0.75, y: 0 });
  });

  test.each([30, 60, 120])("reaches 75%% after 100 ms at %i Hz", (hz) => {
    const smoother = new GamepadStickSmoother({ halfLifeSeconds });
    let result = rest;
    for (let frame = 0; frame < hz / 10; frame++) {
      result = smoother.update(right, 1 / hz);
    }
    expect(result.x).toBeCloseTo(0.75, 14);
    expect(result.y).toBe(0);
  });

  test("smooths diagonals, direction changes and a single neutral axis", () => {
    const smoother = new GamepadStickSmoother({ halfLifeSeconds });
    expect(smoother.update({ x: 4, y: -2 }, 0.05)).toEqual({ x: 2, y: -1 });
    expect(smoother.update({ x: -4, y: 0 }, 0.05)).toEqual({ x: -1, y: -0.5 });
    expect(smoother.update({ x: 0, y: 0.02 }, 0.05)).toEqual({
      x: -0.5,
      y: -0.24,
    });
  });

  test("holds on zero time, stops on release and restarts from rest", () => {
    const smoother = new GamepadStickSmoother({ halfLifeSeconds });
    const first = smoother.update(right, 0.05);
    expect(smoother.update(rest, 0)).toEqual(first);
    expect(smoother.update({ x: -0, y: -0 }, 0.01)).toStrictEqual(rest);
    expect(smoother.update(right, 0.05)).toEqual(first);
    smoother.reset();
    smoother.reset();
    expect(smoother.update(right, 0)).toEqual(rest);
    expect(smoother.update(right, 0.05)).toEqual(first);
  });

  test("responds to very short intervals and reaches the target over long intervals", () => {
    const smoother = new GamepadStickSmoother({ halfLifeSeconds: 1 });
    const short = smoother.update(right, 1e-20);
    expect(short.x / 1e-20).toBeCloseTo(Math.LN2, 14);
    const target = { x: -3, y: 1e-30 };
    expect(smoother.update(target, 1000)).toEqual(target);
  });

  test("interpolates between opposite finite extremes without overflowing", () => {
    const smoother = new GamepadStickSmoother({
      halfLifeSeconds: Number.MIN_VALUE,
    });
    const extreme = { x: Number.MAX_VALUE, y: -Number.MAX_VALUE };
    expect(smoother.update(extreme, 1)).toEqual(extreme);
    expect(
      smoother.update({ x: -extreme.x, y: -extreme.y }, Number.MIN_VALUE),
    ).toEqual(rest);
  });

  test("isolates returned snapshots and each player's history", () => {
    const first = new GamepadStickSmoother({ halfLifeSeconds });
    const second = new GamepadStickSmoother({ halfLifeSeconds });
    const sample = first.update(right, 0.05);
    const paused = first.update(rest, 0);
    expect(paused).not.toBe(sample);
    sample.x = -10;
    sample.y = 10;
    expect(second.update(right, 0.05)).toEqual({ x: 0.5, y: 0 });
    second.reset();
    expect(first.update(right, 0.05)).toEqual({ x: 0.75, y: 0 });
    expect(paused).toEqual({ x: 0.5, y: 0 });
    expect(sample).toEqual({ x: -10, y: 10 });
  });

  test.each([0, -1, Number.NaN, Infinity, -Infinity])(
    "rejects half-life %s",
    (value) => {
      expect(
        () => new GamepadStickSmoother({ halfLifeSeconds: value }),
      ).toThrow(RangeError);
    },
  );

  test.each([undefined, {}, { halfLifeSeconds: "0.05" }])(
    "rejects missing or non-numeric configuration from JavaScript: %o",
    (options) => {
      expect(() => Reflect.construct(GamepadStickSmoother, [options])).toThrow(
        RangeError,
      );
    },
  );

  test.each([
    { target: rest, delta: -1 },
    { target: rest, delta: Number.NaN },
    { target: rest, delta: Infinity },
    { target: rest, delta: -Infinity },
    { target: { x: Number.NaN, y: 0 }, delta: 0 },
    { target: { x: -Infinity, y: 0 }, delta: 0.05 },
    { target: { x: 1, y: Infinity }, delta: 0.05 },
  ])(
    "rejects an invalid update %o before changing history",
    ({ target, delta }) => {
      const smoother = new GamepadStickSmoother({ halfLifeSeconds });
      smoother.update(right, 0.05);
      expect(() => smoother.update(target, delta)).toThrow(RangeError);
      expect(smoother.update(right, 0.05)).toEqual({ x: 0.75, y: 0 });
    },
  );
});
