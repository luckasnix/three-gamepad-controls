import { describe, expect, test, vi } from "vitest";

import {
  DEFAULT_GAMEPAD_STICK_PIPELINE,
  type GamepadStick,
  type GamepadStickProcessor,
  gamepadStickPipeline,
  limitGamepadStickMagnitude,
  resolveGamepadStickBinding,
} from "./gamepad-stick-processing.ts";

describe("gamepadStickPipeline", () => {
  test("creates a frozen identity pipeline without mutating fluent sources", () => {
    const value = Object.freeze({ x: 0.25, y: -0.5 });
    const pipeline = gamepadStickPipeline();
    const configuredPipeline = pipeline.deadzone();
    expect(pipeline.process(value)).toBe(value);
    expect(configuredPipeline).not.toBe(pipeline);
    expect(Object.isFrozen(pipeline)).toBe(true);
    expect(Object.isFrozen(configuredPipeline)).toBe(true);
  });

  test("passes transform results into piped reusable pipelines", () => {
    const input = Object.freeze({ x: 0.25, y: -0.5 });
    const firstResult = { x: 0.5, y: -0.5 };
    const secondResult = { x: 0.5, y: 0.5 };
    const first = vi.fn(() => firstResult);
    const second = vi.fn(() => secondResult);
    const reusablePipeline = gamepadStickPipeline().transform(second);
    const pipeline = gamepadStickPipeline()
      .transform(first)
      .pipe(reusablePipeline);
    expect(pipeline.process(input)).toBe(secondResult);
    expect(first).toHaveBeenCalledExactlyOnceWith(input);
    expect(second).toHaveBeenCalledExactlyOnceWith(firstResult);
  });

  test("propagates processor errors and stops the pipeline", () => {
    const error = new Error("processor failed");
    const failingProcessor: GamepadStickProcessor = {
      process: vi.fn(() => {
        throw error;
      }),
    };
    const followingProcessor: GamepadStickProcessor = {
      process: vi.fn((value) => ({ ...value })),
    };
    const pipeline = gamepadStickPipeline()
      .pipe(failingProcessor)
      .pipe(followingProcessor);
    expect(() => pipeline.process({ x: 0, y: 0 })).toThrow(error);
    expect(followingProcessor.process).not.toHaveBeenCalled();
  });
});

describe("limitGamepadStickMagnitude", () => {
  test("preserves partial deflection and scales to a smaller maximum", () => {
    const input = Object.freeze({ x: 0.3, y: -0.4 });
    expect(limitGamepadStickMagnitude(input)).toEqual(input);
    expect(limitGamepadStickMagnitude(input, 0.5)).toEqual(input);
    const limited = limitGamepadStickMagnitude(input, 0.25);
    expect(limited.x).toBeCloseTo(0.15, 14);
    expect(limited.y).toBeCloseTo(-0.2, 14);
  });

  test.each([1, Number.MAX_VALUE])(
    "limits a diagonal with components of size %s",
    (size) => {
      const limited = limitGamepadStickMagnitude({ x: size, y: -size });
      expect(limited.x).toBeCloseTo(Math.SQRT1_2, 14);
      expect(limited.y).toBeCloseTo(-Math.SQRT1_2, 14);
    },
  );

  test("accepts limits above one", () => {
    expect(limitGamepadStickMagnitude({ x: -3, y: 0 }, 2)).toEqual({
      x: -2,
      y: 0,
    });
  });

  test("keeps a tiny limit representable when the scale factor underflows", () => {
    expect(
      limitGamepadStickMagnitude(
        { x: -Number.MAX_VALUE, y: 0 },
        Number.MIN_VALUE,
      ),
    ).toEqual({
      x: -Number.MIN_VALUE,
      y: 0,
    });
  });

  test("preserves direction for subnormal input lengths", () => {
    const unit = Number.MIN_VALUE;
    const limited = limitGamepadStickMagnitude(
      { x: 3 * unit, y: -3 * unit },
      2 * unit,
    );
    expect(limited).toEqual({ x: unit, y: -unit });
  });

  test("returns positive zeros for neutral input, signed zeros and a zero maximum", () => {
    expect(limitGamepadStickMagnitude(Object.freeze({ x: -0, y: -0 }))).toEqual(
      { x: 0, y: 0 },
    );
    expect(limitGamepadStickMagnitude({ x: -0, y: 0.5 })).toEqual({
      x: 0,
      y: 0.5,
    });
    expect(limitGamepadStickMagnitude({ x: -1, y: 1 }, 0)).toEqual({
      x: 0,
      y: 0,
    });
  });

  test.each([-1, NaN, Infinity, -Infinity])(
    "rejects an invalid maximum of %s",
    (max) => {
      expect(() => limitGamepadStickMagnitude({ x: 0, y: 0 }, max)).toThrow(
        RangeError,
      );
    },
  );

  test.each([NaN, Infinity, -Infinity])(
    "rejects a non-finite component of %s even with a zero maximum",
    (component) => {
      expect(() =>
        limitGamepadStickMagnitude({ x: component, y: 0 }, 0),
      ).toThrow(RangeError);
      expect(() =>
        limitGamepadStickMagnitude({ x: 0, y: component }, 0),
      ).toThrow(RangeError);
    },
  );

  test("limits the magnitude at the configured position in the pipeline", () => {
    const base = gamepadStickPipeline().deadzone(0.15);
    const double = ({ x, y }: Readonly<GamepadStick>) => ({
      x: x * 2,
      y: y * 2,
    });
    const input = { x: 0.75, y: 0 };
    const doubleThenLimit = base
      .transform(double)
      .transform(limitGamepadStickMagnitude);
    const limitThenDouble = base
      .transform(limitGamepadStickMagnitude)
      .transform(double);
    expect(doubleThenLimit.process(input)).toEqual({ x: 1, y: 0 });
    expect(limitThenDouble.process(input)).toEqual({ x: 1.5, y: 0 });
  });
});

describe("GamepadStickPipeline.deadzone", () => {
  test("uses an axial threshold of 0.1 without rescaling by default", () => {
    const input = Object.freeze({ x: 0.09, y: -0.1 });
    const pipeline = gamepadStickPipeline().deadzone();
    expect(pipeline.process(input)).toEqual({ x: 0, y: -0.1 });
    expect(input).toEqual({ x: 0.09, y: -0.1 });
  });

  test("allows a method mode to override the pipeline default", () => {
    const pipeline = gamepadStickPipeline({ mode: "radial" }).deadzone(0.2, {
      mode: "axial",
      rescale: true,
    });
    const result = pipeline.process({ x: 0.2, y: -0.6 });
    expect(result.x).toBe(0);
    expect(result.y).toBeCloseTo(-0.5);
  });

  test("closes a rescaled dead zone whose threshold is at least one", () => {
    const pipeline = gamepadStickPipeline().deadzone(1, {
      rescale: true,
    });
    expect(pipeline.process({ x: 1, y: 2 })).toEqual({ x: 0, y: 0 });
  });

  test("caps rescaled axial values at one", () => {
    const pipeline = gamepadStickPipeline().deadzone(0.2, {
      rescale: true,
    });
    expect(pipeline.process({ x: 1.4, y: -2 })).toEqual({ x: 1, y: -1 });
  });

  test.each([
    [0, 0],
    [0.1, 0],
    [0.5, 0.5],
    [0.9, 1],
    [1, 1],
    [1.2, 1],
  ])("maps input %s to calibrated magnitude %s", (magnitude, expected) => {
    const calibrated = gamepadStickPipeline().deadzone(0.1, {
      rescale: true,
      maxInput: 0.9,
    });
    const result = calibrated.process({ x: magnitude, y: -magnitude });
    expect(result.x).toBeCloseTo(expected, 14);
    expect(result.y).toBeCloseTo(-expected, 14);
  });

  test("calibrates radial length before applying the response curve", () => {
    const calibrated = gamepadStickPipeline({ mode: "radial" }).deadzone(0.1, {
      rescale: true,
      maxInput: 0.9,
    });
    const diagonal = calibrated.process({ x: 0.54, y: -0.72 });
    expect(diagonal.x).toBeCloseTo(0.6, 14);
    expect(diagonal.y).toBeCloseTo(-0.8, 14);
    const look = calibrated.responseCurve("quadratic");
    expect(look.process({ x: 0.5, y: 0 }).x).toBeCloseTo(0.25, 14);
  });

  test("honors the calibrated stage's axial override and canonicalizes zero", () => {
    const calibrated = gamepadStickPipeline({ mode: "radial" }).deadzone(0.1, {
      mode: "axial",
      rescale: true,
      maxInput: 0.9,
    });
    expect(calibrated.process({ x: 0.9, y: -0.9 })).toEqual({ x: 1, y: -1 });
    expect(calibrated.process({ x: -0.1, y: -0 })).toEqual({ x: 0, y: 0 });
  });

  test("preserves radial direction across the finite calibration range", () => {
    const radial = gamepadStickPipeline({ mode: "radial" });
    const tiny = Number.MIN_VALUE;
    const full = radial.deadzone(0, { rescale: true, maxInput: tiny });
    expect(full.process({ x: tiny, y: -0 })).toEqual({ x: 1, y: 0 });
    const diagonal = full.process({
      x: Number.MAX_VALUE,
      y: -Number.MAX_VALUE,
    });
    expect(diagonal.x).toBeCloseTo(Math.SQRT1_2, 14);
    expect(diagonal.y).toBeCloseTo(-Math.SQRT1_2, 14);

    const partial = radial.deadzone(tiny, {
      rescale: true,
      maxInput: 9 * tiny,
    });
    const midpoint = partial.process({ x: 3 * tiny, y: -4 * tiny });
    expect(midpoint.x).toBeCloseTo(0.3, 14);
    expect(midpoint.y).toBeCloseTo(-0.4, 14);
  });

  test.each([
    [0.1, 0.1],
    [0.9, 0.1],
    [-0.1, 0.9],
    [0.1, 1.1],
    [NaN, 0.9],
    [-Infinity, 0.9],
    [0.1, NaN],
    [0.1, Infinity],
  ])(
    "rejects calibration bounds %s and %s at configuration",
    (threshold, maxInput) => {
      expect(() =>
        gamepadStickPipeline().deadzone(threshold, { rescale: true, maxInput }),
      ).toThrow(RangeError);
    },
  );

  test("requires rescaling when maxInput is supplied", () => {
    const pipeline = gamepadStickPipeline();
    expect(() => pipeline.deadzone(0.1, { maxInput: 0.9 })).toThrow(RangeError);
    expect(() =>
      pipeline.deadzone(0.1, { rescale: false, maxInput: 0.9 }),
    ).toThrow(RangeError);
  });

  test("treats an undefined maxInput like an omitted upper bound", () => {
    const pipeline = gamepadStickPipeline();
    const input = { x: 0.1, y: 1.2 };
    for (const [threshold, rescale] of [
      [0.1, false],
      [0.1, true],
      [1, true],
    ] as const) {
      expect(
        pipeline
          .deadzone(threshold, { rescale, maxInput: undefined })
          .process(input),
      ).toEqual(pipeline.deadzone(threshold, { rescale }).process(input));
    }
  });

  test("removes radial values below the configured magnitude", () => {
    const input = Object.freeze({ x: 0.3, y: 0.4 });
    const pipeline = gamepadStickPipeline({ mode: "radial" }).deadzone(0.6);
    expect(pipeline.process(input)).toEqual({ x: 0, y: 0 });
    expect(input).toEqual({ x: 0.3, y: 0.4 });
  });

  test("keeps a radial value exactly at an unscaled threshold", () => {
    const input = Object.freeze({ x: 0.3, y: 0.4 });
    const pipeline = gamepadStickPipeline({ mode: "radial" }).deadzone(0.5);
    expect(pipeline.process(input)).toBe(input);
  });

  test("rescales radial magnitude while preserving direction", () => {
    const pipeline = gamepadStickPipeline({ mode: "radial" }).deadzone(0.5, {
      rescale: true,
    });
    const result = pipeline.process({ x: 0.45, y: 0.6 });
    expect(result.x).toBeCloseTo(0.3);
    expect(result.y).toBeCloseTo(0.4);
  });

  test("keeps a neutral radial value unchanged", () => {
    const input = Object.freeze({ x: 0, y: 0 });
    const pipeline = gamepadStickPipeline({ mode: "radial" }).deadzone();
    expect(pipeline.process(input)).toBe(input);
  });

  test("canonicalizes negative zero without mutating the input", () => {
    const input = Object.freeze({ x: -0, y: -0 });
    const pipeline = gamepadStickPipeline().deadzone();
    const result = pipeline.process(input);
    expect(Object.is(result.x, -0)).toBe(false);
    expect(Object.is(result.y, -0)).toBe(false);
    expect(Object.is(input.x, -0)).toBe(true);
    expect(Object.is(input.y, -0)).toBe(true);
  });

  test("returns a frozen pipeline and leaves its source unchanged", () => {
    const input = Object.freeze({ x: 0.05, y: 0.2 });
    const source = gamepadStickPipeline();
    const pipeline = source.deadzone();
    expect(Object.isFrozen(pipeline)).toBe(true);
    expect(source.process(input)).toBe(input);
    expect(pipeline.process(input)).toEqual({ x: 0, y: 0.2 });
  });
});

describe("GamepadStickPipeline.responseCurve", () => {
  test.each([
    { curve: "linear", expected: 0.5 },
    { curve: "quadratic", expected: 0.25 },
    { curve: "cubic", expected: 0.125 },
  ] as const)(
    "applies the $curve response curve independently in axial mode",
    ({ curve, expected }) => {
      const pipeline = gamepadStickPipeline().responseCurve(curve);
      expect(pipeline.process({ x: 0.5, y: -0.5 })).toEqual({
        x: expected,
        y: -expected,
      });
    },
  );

  test("does not clamp axial magnitudes above one", () => {
    const input = Object.freeze({ x: 1.5, y: -2 });
    const pipeline = gamepadStickPipeline({ mode: "radial" }).responseCurve(
      "quadratic",
      {
        mode: "axial",
      },
    );
    expect(pipeline.process(input)).toBe(input);
  });

  test("applies a response curve to radial magnitude while preserving direction", () => {
    const pipeline = gamepadStickPipeline({ mode: "radial" }).responseCurve(
      "quadratic",
    );
    const result = pipeline.process({ x: 0.3, y: 0.4 });
    expect(result.x).toBeCloseTo(0.15);
    expect(result.y).toBeCloseTo(0.2);
  });

  test("keeps a neutral radial value unchanged", () => {
    const input = Object.freeze({ x: 0, y: 0 });
    const pipeline = gamepadStickPipeline({ mode: "radial" }).responseCurve(
      "cubic",
    );
    expect(pipeline.process(input)).toBe(input);
  });

  test("does not clamp radial magnitudes above one", () => {
    const input = Object.freeze({ x: 1.2, y: 1.6 });
    const pipeline = gamepadStickPipeline({ mode: "radial" }).responseCurve(
      "cubic",
    );
    expect(pipeline.process(input)).toBe(input);
  });

  test("returns a frozen pipeline and leaves its source unchanged", () => {
    const input = Object.freeze({ x: 0.5, y: -0.5 });
    const source = gamepadStickPipeline();
    const pipeline = source.responseCurve("quadratic");
    expect(Object.isFrozen(pipeline)).toBe(true);
    expect(source.process(input)).toBe(input);
    expect(pipeline.process(input)).toEqual({ x: 0.25, y: -0.25 });
  });
});

describe("GamepadStickPipeline.invert", () => {
  test("leaves the source pipeline unchanged", () => {
    const input = Object.freeze({ x: 0.25, y: -0.5 });
    const source = gamepadStickPipeline();
    const pipeline = source.invert("y");
    expect(source.process(input)).toBe(input);
    expect(pipeline.process(input)).toEqual({ x: 0.25, y: 0.5 });
  });

  test.each([
    {
      axis: "x",
      expected: { x: -0.25, y: -0.5 },
    },
    {
      axis: "y",
      expected: { x: 0.25, y: 0.5 },
    },
    {
      axis: "both",
      expected: { x: -0.25, y: 0.5 },
    },
  ] as const)(
    "supports independent component inversion",
    ({ axis, expected }) => {
      const pipeline = gamepadStickPipeline().invert(axis);
      expect(pipeline.process({ x: 0.25, y: -0.5 })).toEqual(expected);
    },
  );

  test("preserves canonical zero when inversion is enabled", () => {
    const input = Object.freeze({ x: -0, y: -0 });
    const pipeline = gamepadStickPipeline().invert("both");
    const result = pipeline.process(input);
    expect(Object.is(result.x, -0)).toBe(false);
    expect(Object.is(result.y, -0)).toBe(false);
  });

  test("returns a frozen pipeline", () => {
    expect(Object.isFrozen(gamepadStickPipeline().invert("x"))).toBe(true);
  });
});

describe("DEFAULT_GAMEPAD_STICK_PIPELINE", () => {
  test("applies only the historical axial dead zone", () => {
    expect(
      DEFAULT_GAMEPAD_STICK_PIPELINE.process({ x: 0.09, y: -0.2 }),
    ).toEqual({
      x: 0,
      y: -0.2,
    });
  });
});

describe("resolveGamepadStickBinding", () => {
  const defaultPipeline = gamepadStickPipeline();
  const defaults = {
    xAxis: 2,
    yAxis: 3,
    pipeline: defaultPipeline,
  };

  test("returns all defaults when options are omitted", () => {
    const result = resolveGamepadStickBinding(defaults);
    expect(result).toEqual(defaults);
    expect(result).not.toBe(defaults);
  });

  test("resolves each supplied override independently", () => {
    const pipeline = gamepadStickPipeline().transform(
      (value: Readonly<GamepadStick>) => ({
        x: value.y,
        y: value.x,
      }),
    );
    expect(
      resolveGamepadStickBinding(defaults, {
        xAxis: 0,
        yAxis: 1,
        pipeline,
      }),
    ).toEqual({
      xAxis: 0,
      yAxis: 1,
      pipeline,
    });
  });

  test("preserves defaults for explicitly undefined options", () => {
    expect(
      resolveGamepadStickBinding(defaults, {
        xAxis: undefined,
        yAxis: undefined,
        pipeline: undefined,
      }),
    ).toEqual(defaults);
  });
});
