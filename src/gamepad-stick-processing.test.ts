import { describe, expect, test, vi } from "vitest";

import {
  DEFAULT_GAMEPAD_STICK_PIPELINE,
  type GamepadStick,
  type GamepadStickProcessor,
  gamepadStickPipeline,
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

describe("GamepadStickPipeline.curve", () => {
  test.each([
    { curve: "linear", expected: 0.5 },
    { curve: "quadratic", expected: 0.25 },
    { curve: "cubic", expected: 0.125 },
  ] as const)(
    "applies the $curve curve independently in axial mode",
    ({ curve, expected }) => {
      const pipeline = gamepadStickPipeline().curve(curve);

      expect(pipeline.process({ x: 0.5, y: -0.5 })).toEqual({
        x: expected,
        y: -expected,
      });
    },
  );

  test("does not clamp axial magnitudes above one", () => {
    const input = Object.freeze({ x: 1.5, y: -2 });
    const pipeline = gamepadStickPipeline({ mode: "radial" }).curve(
      "quadratic",
      {
        mode: "axial",
      },
    );

    expect(pipeline.process(input)).toBe(input);
  });

  test("curves radial magnitude while preserving direction", () => {
    const pipeline = gamepadStickPipeline({ mode: "radial" }).curve(
      "quadratic",
    );
    const result = pipeline.process({ x: 0.3, y: 0.4 });

    expect(result.x).toBeCloseTo(0.15);
    expect(result.y).toBeCloseTo(0.2);
  });

  test("keeps a neutral radial value unchanged", () => {
    const input = Object.freeze({ x: 0, y: 0 });
    const pipeline = gamepadStickPipeline({ mode: "radial" }).curve("cubic");

    expect(pipeline.process(input)).toBe(input);
  });

  test("does not clamp radial magnitudes above one", () => {
    const input = Object.freeze({ x: 1.2, y: 1.6 });
    const pipeline = gamepadStickPipeline({ mode: "radial" }).curve("cubic");

    expect(pipeline.process(input)).toBe(input);
  });

  test("returns a frozen pipeline and leaves its source unchanged", () => {
    const input = Object.freeze({ x: 0.5, y: -0.5 });
    const source = gamepadStickPipeline();
    const pipeline = source.curve("quadratic");

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
