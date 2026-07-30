import { describe, expect, test, vi } from "vitest";

import {
  createGamepadDeadzoneProcessor,
  createGamepadInversionProcessor,
  createGamepadResponseCurveProcessor,
  createGamepadStickPipeline,
  DEFAULT_GAMEPAD_STICK_PIPELINE,
  type GamepadStick,
  type GamepadStickProcessor,
  resolveGamepadStickBinding,
} from "./gamepad-stick-processing.ts";

describe("createGamepadStickPipeline", () => {
  test("creates a frozen identity pipeline when no processors are provided", () => {
    const value = Object.freeze({ x: 0.25, y: -0.5 });
    const pipeline = createGamepadStickPipeline();

    expect(pipeline.process(value)).toBe(value);
    expect(pipeline.processors).toEqual([]);
    expect(Object.isFrozen(pipeline)).toBe(true);
    expect(Object.isFrozen(pipeline.processors)).toBe(true);
  });

  test("copies processors and passes each result to the next processor", () => {
    const input = Object.freeze({ x: 0.25, y: -0.5 });
    const firstResult = { x: 0.5, y: -0.5 };
    const secondResult = { x: 0.5, y: 0.5 };
    const first: GamepadStickProcessor = {
      process: vi.fn(() => firstResult),
    };
    const second: GamepadStickProcessor = {
      process: vi.fn(() => secondResult),
    };
    const processors = [first, second];
    const pipeline = createGamepadStickPipeline(...processors);

    processors.reverse();

    expect(pipeline.process(input)).toBe(secondResult);
    expect(first.process).toHaveBeenCalledExactlyOnceWith(input);
    expect(second.process).toHaveBeenCalledExactlyOnceWith(firstResult);
    expect(pipeline.processors).toEqual([first, second]);
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
    const pipeline = createGamepadStickPipeline(
      failingProcessor,
      followingProcessor,
    );

    expect(() => pipeline.process({ x: 0, y: 0 })).toThrow(error);
    expect(followingProcessor.process).not.toHaveBeenCalled();
  });
});

describe("createGamepadDeadzoneProcessor", () => {
  test("uses an axial threshold of 0.1 without rescaling by default", () => {
    const input = Object.freeze({ x: 0.09, y: -0.1 });
    const processor = createGamepadDeadzoneProcessor();

    expect(processor.process(input)).toEqual({ x: 0, y: -0.1 });
    expect(input).toEqual({ x: 0.09, y: -0.1 });
  });

  test("rescales axial values from the threshold to the normalized range", () => {
    const processor = createGamepadDeadzoneProcessor({
      threshold: 0.2,
      mode: "axial",
      rescale: true,
    });
    const result = processor.process({ x: 0.2, y: -0.6 });

    expect(result.x).toBe(0);
    expect(result.y).toBeCloseTo(-0.5);
  });

  test("closes a rescaled dead zone whose threshold is at least one", () => {
    const processor = createGamepadDeadzoneProcessor({
      threshold: 1,
      mode: "axial",
      rescale: true,
    });

    expect(processor.process({ x: 1, y: 2 })).toEqual({ x: 0, y: 0 });
  });

  test("caps rescaled axial values at one", () => {
    const processor = createGamepadDeadzoneProcessor({
      threshold: 0.2,
      mode: "axial",
      rescale: true,
    });

    expect(processor.process({ x: 1.4, y: -2 })).toEqual({ x: 1, y: -1 });
  });

  test("removes radial values below the configured magnitude", () => {
    const input = Object.freeze({ x: 0.3, y: 0.4 });
    const processor = createGamepadDeadzoneProcessor({
      threshold: 0.6,
      mode: "radial",
    });

    expect(processor.process(input)).toEqual({ x: 0, y: 0 });
    expect(input).toEqual({ x: 0.3, y: 0.4 });
  });

  test("keeps a radial value exactly at an unscaled threshold", () => {
    const input = Object.freeze({ x: 0.3, y: 0.4 });
    const processor = createGamepadDeadzoneProcessor({
      threshold: 0.5,
      mode: "radial",
    });

    expect(processor.process(input)).toBe(input);
  });

  test("rescales radial magnitude while preserving direction", () => {
    const processor = createGamepadDeadzoneProcessor({
      threshold: 0.5,
      mode: "radial",
      rescale: true,
    });
    const result = processor.process({ x: 0.45, y: 0.6 });

    expect(result.x).toBeCloseTo(0.3);
    expect(result.y).toBeCloseTo(0.4);
  });

  test("keeps a neutral radial value unchanged", () => {
    const input = Object.freeze({ x: 0, y: 0 });
    const processor = createGamepadDeadzoneProcessor({
      mode: "radial",
    });

    expect(processor.process(input)).toBe(input);
  });

  test("canonicalizes negative zero without mutating the input", () => {
    const input = Object.freeze({ x: -0, y: -0 });
    const processor = createGamepadDeadzoneProcessor();
    const result = processor.process(input);

    expect(Object.is(result.x, -0)).toBe(false);
    expect(Object.is(result.y, -0)).toBe(false);
    expect(Object.is(input.x, -0)).toBe(true);
    expect(Object.is(input.y, -0)).toBe(true);
  });

  test("creates frozen processors", () => {
    expect(Object.isFrozen(createGamepadDeadzoneProcessor())).toBe(true);
  });
});

describe("createGamepadResponseCurveProcessor", () => {
  test.each([
    { curve: "linear", expected: 0.5 },
    { curve: "quadratic", expected: 0.25 },
    { curve: "cubic", expected: 0.125 },
  ] as const)(
    "applies the $curve curve independently in axial mode",
    ({ curve, expected }) => {
      const processor = createGamepadResponseCurveProcessor({
        curve,
        mode: "axial",
      });

      expect(processor.process({ x: 0.5, y: -0.5 })).toEqual({
        x: expected,
        y: -expected,
      });
    },
  );

  test("does not clamp axial magnitudes above one", () => {
    const input = Object.freeze({ x: 1.5, y: -2 });
    const processor = createGamepadResponseCurveProcessor({
      curve: "quadratic",
      mode: "axial",
    });

    expect(processor.process(input)).toBe(input);
  });

  test("curves radial magnitude while preserving direction", () => {
    const processor = createGamepadResponseCurveProcessor({
      curve: "quadratic",
      mode: "radial",
    });
    const result = processor.process({ x: 0.3, y: 0.4 });

    expect(result.x).toBeCloseTo(0.15);
    expect(result.y).toBeCloseTo(0.2);
  });

  test("keeps a neutral radial value unchanged", () => {
    const input = Object.freeze({ x: 0, y: 0 });
    const processor = createGamepadResponseCurveProcessor({
      curve: "cubic",
      mode: "radial",
    });

    expect(processor.process(input)).toBe(input);
  });

  test("does not clamp radial magnitudes above one", () => {
    const input = Object.freeze({ x: 1.2, y: 1.6 });
    const processor = createGamepadResponseCurveProcessor({
      curve: "cubic",
      mode: "radial",
    });

    expect(processor.process(input)).toBe(input);
  });

  test("creates frozen processors", () => {
    const processor = createGamepadResponseCurveProcessor({
      curve: "linear",
      mode: "axial",
    });

    expect(Object.isFrozen(processor)).toBe(true);
  });
});

describe("createGamepadInversionProcessor", () => {
  test("keeps the original value when inversion is disabled", () => {
    const input = Object.freeze({ x: 0.25, y: -0.5 });

    expect(createGamepadInversionProcessor().process(input)).toBe(input);
  });

  test.each([
    {
      options: { invertX: true },
      expected: { x: -0.25, y: -0.5 },
    },
    {
      options: { invertY: true },
      expected: { x: 0.25, y: 0.5 },
    },
    {
      options: { invertX: true, invertY: true },
      expected: { x: -0.25, y: 0.5 },
    },
  ])("supports independent component inversion", ({ options, expected }) => {
    const processor = createGamepadInversionProcessor(options);

    expect(processor.process({ x: 0.25, y: -0.5 })).toEqual(expected);
  });

  test("preserves canonical zero when inversion is enabled", () => {
    const input = Object.freeze({ x: -0, y: -0 });
    const processor = createGamepadInversionProcessor({
      invertX: true,
      invertY: true,
    });
    const result = processor.process(input);

    expect(Object.is(result.x, -0)).toBe(false);
    expect(Object.is(result.y, -0)).toBe(false);
  });

  test("creates frozen processors", () => {
    expect(Object.isFrozen(createGamepadInversionProcessor())).toBe(true);
  });
});

describe("DEFAULT_GAMEPAD_STICK_PIPELINE", () => {
  test("applies only the historical axial dead zone", () => {
    expect(DEFAULT_GAMEPAD_STICK_PIPELINE.processors).toHaveLength(1);
    expect(
      DEFAULT_GAMEPAD_STICK_PIPELINE.process({ x: 0.09, y: -0.2 }),
    ).toEqual({
      x: 0,
      y: -0.2,
    });
  });
});

describe("resolveGamepadStickBinding", () => {
  const defaultPipeline = createGamepadStickPipeline();
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
    const pipeline = createGamepadStickPipeline({
      process: (value: Readonly<GamepadStick>) => ({
        x: value.y,
        y: value.x,
      }),
    });

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
