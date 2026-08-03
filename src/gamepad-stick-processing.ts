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
 * Stick component selection used by inversion processing.
 */
export type GamepadStickInversionAxis = "x" | "y" | "both";

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
 * Options for {@link gamepadStickPipeline}.
 */
export type GamepadStickPipelineOptions = {
  /**
   * Default geometry for processing methods that support axial and radial modes.
   * @default "axial"
   */
  mode?: GamepadStickProcessingMode;
};

/**
 * Options for {@link GamepadStickPipeline.deadzone}.
 */
export type GamepadDeadzoneOptions = {
  /**
   * Geometry for this dead zone, overriding the pipeline default.
   */
  mode?: GamepadStickProcessingMode;

  /**
   * Whether to remap values outside the dead zone to the full output range.
   * @default false
   */
  rescale?: boolean;
};

/**
 * Options for {@link GamepadStickPipeline.curve}.
 */
export type GamepadResponseCurveOptions = {
  /**
   * Geometry for this response curve, overriding the pipeline default.
   */
  mode?: GamepadStickProcessingMode;
};

/**
 * Ordered, reusable sequence of stateless stick processors.
 *
 * Every configuration method returns a new frozen pipeline and leaves the
 * current pipeline unchanged.
 */
export type GamepadStickPipeline = GamepadStickProcessor & {
  /**
   * Appends an axial or radial dead zone.
   *
   * @param threshold - Dead zone threshold.
   * @param options - Optional dead zone configuration.
   * @returns New pipeline containing the dead zone.
   */
  deadzone(
    threshold?: number,
    options?: GamepadDeadzoneOptions,
  ): GamepadStickPipeline;

  /**
   * Appends an axial or radial response curve.
   *
   * @param curve - Curve used to transform normalized magnitudes.
   * @param options - Optional response curve configuration.
   * @returns New pipeline containing the response curve.
   */
  curve(
    curve: GamepadResponseCurve,
    options?: GamepadResponseCurveOptions,
  ): GamepadStickPipeline;

  /**
   * Appends component inversion.
   *
   * @param axis - Component or components to invert.
   * @returns New pipeline containing the inversion.
   */
  invert(axis: GamepadStickInversionAxis): GamepadStickPipeline;

  /**
   * Appends a custom stick transformation.
   *
   * @param operation - Pure transformation applied to the current value.
   * @returns New pipeline containing the transformation.
   */
  transform(
    operation: (value: Readonly<GamepadStick>) => GamepadStick,
  ): GamepadStickPipeline;

  /**
   * Appends a reusable stick processor, including another pipeline.
   *
   * @param processor - Processor to execute next.
   * @returns New pipeline containing the processor.
   */
  pipe(processor: GamepadStickProcessor): GamepadStickPipeline;
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

const DEFAULT_GAMEPAD_STICK_PROCESSING_MODE: GamepadStickProcessingMode =
  "axial";

const DEFAULT_GAMEPAD_DEADZONE_THRESHOLD = 0.1;

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
 * Creates an axial or radial dead zone processor.
 *
 * @param threshold - Dead zone threshold.
 * @param mode - Whether to process components or vector magnitude.
 * @param rescale - Whether to remap values outside the dead zone.
 * @returns Frozen dead zone processor.
 */
const createDeadzoneProcessor = (
  threshold: number,
  mode: GamepadStickProcessingMode,
  rescale: boolean,
): GamepadStickProcessor => {
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
 * @param curve - Curve applied to normalized magnitudes.
 * @param mode - Whether to process components or vector magnitude.
 * @returns Frozen response curve processor.
 */
const createResponseCurveProcessor = (
  curve: GamepadResponseCurve,
  mode: GamepadStickProcessingMode,
): GamepadStickProcessor => {
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
 * Creates a processor that inverts selected stick components.
 *
 * @param axis - Component or components to invert.
 * @returns Frozen inversion processor.
 */
const createInversionProcessor = (
  axis: GamepadStickInversionAxis,
): GamepadStickProcessor => {
  const invertX = axis === "x" || axis === "both";
  const invertY = axis === "y" || axis === "both";

  return Object.freeze({
    process(value: Readonly<GamepadStick>): GamepadStick {
      const x = value.x === 0 ? 0 : invertX ? -value.x : value.x;
      const y = value.y === 0 ? 0 : invertY ? -value.y : value.y;

      return createGamepadStickResult(value, x, y);
    },
  });
};

/**
 * Creates a frozen custom transformation processor.
 *
 * @param operation - Transformation applied to the current pipeline value.
 * @returns Frozen custom processor.
 */
const createTransformProcessor = (
  operation: (value: Readonly<GamepadStick>) => GamepadStick,
): GamepadStickProcessor => {
  return Object.freeze({ process: operation });
};

/**
 * Creates an immutable pipeline over a private processor sequence.
 *
 * @param mode - Default processing mode for new built-in stages.
 * @param processors - Processors in execution order.
 * @returns Frozen stick pipeline.
 */
const createPipeline = (
  mode: GamepadStickProcessingMode,
  processors: readonly GamepadStickProcessor[],
): GamepadStickPipeline => {
  const pipelineProcessors = Object.freeze([...processors]);
  const append = (processor: GamepadStickProcessor): GamepadStickPipeline =>
    createPipeline(mode, [...pipelineProcessors, processor]);

  return Object.freeze({
    process(value: Readonly<GamepadStick>): GamepadStick {
      let processed: Readonly<GamepadStick> = value;

      for (const processor of pipelineProcessors) {
        processed = processor.process(processed);
      }

      return processed as GamepadStick;
    },
    deadzone(
      threshold = DEFAULT_GAMEPAD_DEADZONE_THRESHOLD,
      options?: GamepadDeadzoneOptions,
    ): GamepadStickPipeline {
      return append(
        createDeadzoneProcessor(
          threshold,
          options?.mode ?? mode,
          options?.rescale ?? false,
        ),
      );
    },
    curve(
      curve: GamepadResponseCurve,
      options?: GamepadResponseCurveOptions,
    ): GamepadStickPipeline {
      return append(createResponseCurveProcessor(curve, options?.mode ?? mode));
    },
    invert(axis: GamepadStickInversionAxis): GamepadStickPipeline {
      return append(createInversionProcessor(axis));
    },
    transform(
      operation: (value: Readonly<GamepadStick>) => GamepadStick,
    ): GamepadStickPipeline {
      return append(createTransformProcessor(operation));
    },
    pipe(processor: GamepadStickProcessor): GamepadStickPipeline {
      return append(processor);
    },
  });
};

/**
 * Creates an immutable, fluent stick processing pipeline.
 *
 * The configured mode becomes the default for dead zones and response curves.
 * Each fluent method returns a new pipeline, so intermediate pipelines remain
 * reusable. Processor errors are not caught.
 *
 * @param options - Optional pipeline defaults.
 * @returns Frozen stick pipeline.
 */
export const gamepadStickPipeline = (
  options?: GamepadStickPipelineOptions,
): GamepadStickPipeline => {
  return createPipeline(
    options?.mode ?? DEFAULT_GAMEPAD_STICK_PROCESSING_MODE,
    [],
  );
};

/**
 * Historical stick processing used when no custom pipeline is supplied.
 */
export const DEFAULT_GAMEPAD_STICK_PIPELINE = gamepadStickPipeline().deadzone();

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
