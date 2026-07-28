/**
 * Geometry used when processing two-dimensional stick values.
 *
 * Axial processing transforms each component independently. Radial processing
 * transforms vector magnitude while preserving direction.
 */
export type GamepadStickProcessingMode = "axial" | "radial";

/**
 * Built-in response curve applied to stick components or magnitude.
 */
export type GamepadResponseCurve = "linear" | "quadratic" | "cubic";

/**
 * Two-dimensional gamepad stick value.
 */
export type GamepadStick = {
  /**
   * Horizontal stick component.
   */
  x: number;

  /**
   * Vertical stick component.
   */
  y: number;
};

/**
 * Pure, stateless transformation applied to a gamepad stick.
 *
 * Implementations must not mutate `value`. Stateful processing such as
 * smoothing belongs in a separate lifecycle-aware abstraction.
 */
export type GamepadStickProcessor = {
  /**
   * Transforms one stick value.
   *
   * @param value - Input value from the previous processor.
   * @returns Processed stick value.
   */
  process(value: Readonly<GamepadStick>): GamepadStick;
};

/**
 * Ordered, reusable sequence of stateless stick processors.
 */
export type GamepadStickPipeline = GamepadStickProcessor & {
  /**
   * Processors in execution order.
   */
  readonly processors: readonly GamepadStickProcessor[];
};

/**
 * Options for {@link createGamepadDeadzoneProcessor}.
 */
export type GamepadDeadzoneProcessorOptions = {
  /**
   * Dead zone threshold.
   * @default 0.1
   */
  threshold?: number;

  /**
   * Whether to process each component or the vector magnitude.
   * @default "axial"
   */
  mode?: GamepadStickProcessingMode;

  /**
   * Whether to remap values outside the dead zone to the full output range.
   * @default false
   */
  rescale?: boolean;
};

/**
 * Options for {@link createGamepadResponseCurveProcessor}.
 */
export type GamepadResponseCurveProcessorOptions = {
  /**
   * Curve used to transform values in the normalized input range.
   */
  curve: GamepadResponseCurve;

  /**
   * Whether to process each component or the vector magnitude.
   */
  mode: GamepadStickProcessingMode;
};

/**
 * Options for {@link createGamepadInversionProcessor}.
 */
export type GamepadInversionProcessorOptions = {
  /**
   * Whether to invert the horizontal component.
   * @default false
   */
  invertX?: boolean;

  /**
   * Whether to invert the vertical component.
   * @default false
   */
  invertY?: boolean;
};

/**
 * Partial binding for a two-dimensional stick action.
 *
 * Omitted fields inherit the action-specific defaults.
 */
export type GamepadStickBindingOptions = {
  /**
   * Axis index used as the horizontal component.
   */
  xAxis?: number;

  /**
   * Axis index used as the vertical component.
   */
  yAxis?: number;

  /**
   * Stateless processing pipeline for this action.
   */
  pipeline?: GamepadStickPipeline;
};

/**
 * Fully resolved binding used when reading a two-dimensional stick action.
 */
export type GamepadStickBinding = Required<GamepadStickBindingOptions>;

const DEFAULT_DEADZONE_PROCESSOR_OPTIONS: Required<GamepadDeadzoneProcessorOptions> =
  {
    threshold: 0.1,
    mode: "axial",
    rescale: false,
  };

const DEFAULT_INVERSION_PROCESSOR_OPTIONS: Required<GamepadInversionProcessorOptions> =
  {
    invertX: false,
    invertY: false,
  };

/**
 * Returns a canonical stick result and preserves the original value when
 * processing produced no change.
 *
 * @param source - Original stick value.
 * @param x - Processed horizontal component.
 * @param y - Processed vertical component.
 * @returns Canonical processed stick value.
 */
const createGamepadStickResult = (
  source: Readonly<GamepadStick>,
  x: number,
  y: number,
): GamepadStick => {
  const canonicalX = x === 0 ? 0 : x;
  const canonicalY = y === 0 ? 0 : y;

  if (
    canonicalX === source.x &&
    canonicalY === source.y &&
    !Object.is(source.x, -0) &&
    !Object.is(source.y, -0)
  ) {
    return source as GamepadStick;
  }

  return {
    x: canonicalX,
    y: canonicalY,
  };
};

/**
 * Transforms the magnitude of a signed scalar while preserving its sign.
 *
 * @param value - Signed scalar value.
 * @param mapMagnitude - Magnitude transformation.
 * @returns Transformed signed value.
 */
const mapGamepadSignedMagnitude = (
  value: number,
  mapMagnitude: (magnitude: number) => number,
): number => {
  if (value === 0) {
    return 0;
  }

  return Math.sign(value) * mapMagnitude(Math.abs(value));
};

/**
 * Transforms stick magnitude while preserving vector direction.
 *
 * @param value - Stick value to transform.
 * @param mapMagnitude - Magnitude transformation.
 * @returns Stick with transformed magnitude.
 */
const mapGamepadStickMagnitude = (
  value: Readonly<GamepadStick>,
  mapMagnitude: (magnitude: number) => number,
): GamepadStick => {
  const magnitude = Math.hypot(value.x, value.y);

  if (magnitude === 0) {
    return createGamepadStickResult(value, 0, 0);
  }

  const mappedMagnitude = mapMagnitude(magnitude);

  if (mappedMagnitude === magnitude) {
    return createGamepadStickResult(value, value.x, value.y);
  }

  if (mappedMagnitude === 0) {
    return createGamepadStickResult(value, 0, 0);
  }

  const scale = mappedMagnitude / magnitude;

  return createGamepadStickResult(value, value.x * scale, value.y * scale);
};

/**
 * Applies a dead zone and remaps the remaining magnitude to `[0, 1]`.
 *
 * @param magnitude - Non-negative input magnitude.
 * @param threshold - Dead zone size.
 * @returns Rescaled magnitude, or `0` when inside a fully closed dead zone.
 */
const rescaleGamepadDeadzoneMagnitude = (
  magnitude: number,
  threshold: number,
): number => {
  if (magnitude <= threshold || threshold >= 1) {
    return 0;
  }

  return Math.min((magnitude - threshold) / (1 - threshold), 1);
};

/**
 * Applies a built-in curve to a normalized magnitude.
 *
 * Magnitudes above `1` remain unchanged so response curves do not implicitly
 * clamp or normalize custom processor output.
 *
 * @param magnitude - Non-negative component or vector magnitude.
 * @param curve - Curve to apply.
 * @returns Curved magnitude.
 */
const applyGamepadResponseCurve = (
  magnitude: number,
  curve: GamepadResponseCurve,
): number => {
  if (magnitude > 1) {
    return magnitude;
  }

  switch (curve) {
    case "linear":
      return magnitude;
    case "quadratic":
      return magnitude ** 2;
    case "cubic":
      return magnitude ** 3;
  }
};

/**
 * Creates an ordered pipeline from stateless stick processors.
 *
 * The processor list is copied once. Processor errors are not caught, and a
 * processor's result is passed directly to the next processor.
 *
 * @param processors - Processors in execution order.
 * @returns Reusable stick pipeline.
 */
export const createGamepadStickPipeline = (
  ...processors: readonly GamepadStickProcessor[]
): GamepadStickPipeline => {
  const pipelineProcessors = Object.freeze([...processors]);

  return Object.freeze({
    processors: pipelineProcessors,
    process(value: Readonly<GamepadStick>): GamepadStick {
      let processed: Readonly<GamepadStick> = value;

      for (const processor of pipelineProcessors) {
        processed = processor.process(processed);
      }

      return processed as GamepadStick;
    },
  });
};

/**
 * Creates an axial or radial dead zone processor.
 *
 * @param options - Optional dead zone configuration.
 * @returns Stateless dead zone processor.
 */
export const createGamepadDeadzoneProcessor = (
  options?: GamepadDeadzoneProcessorOptions,
): GamepadStickProcessor => {
  const { threshold, mode, rescale } = {
    ...DEFAULT_DEADZONE_PROCESSOR_OPTIONS,
    ...options,
  };
  const mapMagnitude = (magnitude: number): number => {
    if (magnitude < threshold) {
      return 0;
    }

    return rescale
      ? rescaleGamepadDeadzoneMagnitude(magnitude, threshold)
      : magnitude;
  };

  return Object.freeze({
    process(value: Readonly<GamepadStick>): GamepadStick {
      if (mode === "axial") {
        return createGamepadStickResult(
          value,
          mapGamepadSignedMagnitude(value.x, mapMagnitude),
          mapGamepadSignedMagnitude(value.y, mapMagnitude),
        );
      }

      return mapGamepadStickMagnitude(value, mapMagnitude);
    },
  });
};

/**
 * Creates an axial or radial response curve processor.
 *
 * @param options - Response curve configuration.
 * @returns Stateless response curve processor.
 */
export const createGamepadResponseCurveProcessor = (
  options: GamepadResponseCurveProcessorOptions,
): GamepadStickProcessor => {
  const { curve, mode } = options;
  const mapMagnitude = (magnitude: number): number =>
    applyGamepadResponseCurve(magnitude, curve);

  return Object.freeze({
    process(value: Readonly<GamepadStick>): GamepadStick {
      if (mode === "axial") {
        return createGamepadStickResult(
          value,
          mapGamepadSignedMagnitude(value.x, mapMagnitude),
          mapGamepadSignedMagnitude(value.y, mapMagnitude),
        );
      }

      return mapGamepadStickMagnitude(value, mapMagnitude);
    },
  });
};

/**
 * Creates a processor that independently inverts stick components.
 *
 * @param options - Optional inversion configuration.
 * @returns Stateless inversion processor.
 */
export const createGamepadInversionProcessor = (
  options?: GamepadInversionProcessorOptions,
): GamepadStickProcessor => {
  const { invertX, invertY } = {
    ...DEFAULT_INVERSION_PROCESSOR_OPTIONS,
    ...options,
  };

  return Object.freeze({
    process(value: Readonly<GamepadStick>): GamepadStick {
      if (!invertX && !invertY) {
        return createGamepadStickResult(value, value.x, value.y);
      }

      const x = value.x === 0 ? 0 : invertX ? -value.x : value.x;
      const y = value.y === 0 ? 0 : invertY ? -value.y : value.y;

      return createGamepadStickResult(value, x, y);
    },
  });
};

/**
 * Historical stick processing used when no custom pipeline is supplied.
 */
export const DEFAULT_GAMEPAD_STICK_PIPELINE = createGamepadStickPipeline(
  createGamepadDeadzoneProcessor(),
);

/**
 * Resolves a partial stick binding over an action-specific default.
 *
 * @param defaults - Complete default binding.
 * @param options - Optional binding overrides.
 * @returns Complete resolved binding.
 */
export const resolveGamepadStickBinding = (
  defaults: GamepadStickBinding,
  options?: GamepadStickBindingOptions,
): GamepadStickBinding => {
  return {
    xAxis: options?.xAxis ?? defaults.xAxis,
    yAxis: options?.yAxis ?? defaults.yAxis,
    pipeline: options?.pipeline ?? defaults.pipeline,
  };
};
