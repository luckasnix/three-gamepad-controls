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
 * Pure custom transformation applied to a gamepad stick.
 */
export type GamepadStickTransform = (
  value: Readonly<GamepadStick>,
) => GamepadStick;

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

  /**
   * Input magnitude that reaches full output. An explicit value requires
   * `rescale: true` and finite bounds with `0 <= threshold < maxInput <= 1`.
   * @default 1
   */
  maxInput?: number;
};

/**
 * Options for {@link GamepadStickPipeline.responseCurve}.
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
   * @throws RangeError if the supplied calibration is invalid.
   */
  deadzone(
    threshold?: number,
    options?: GamepadDeadzoneOptions,
  ): GamepadStickPipeline;

  /**
   * Appends an axial or radial response curve.
   *
   * @param curve - Response curve used to transform normalized magnitudes.
   * @param options - Optional response curve configuration.
   * @returns New pipeline containing the response curve.
   */
  responseCurve(
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
  transform(operation: GamepadStickTransform): GamepadStickPipeline;

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

/** Scales both components together and canonicalizes zero in the result. */
const scaleGamepadStick = (
  value: Readonly<GamepadStick>,
  scale: number,
): GamepadStick =>
  createGamepadStickResult(value, value.x * scale, value.y * scale);

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
 * @param inputUnit - Optional calibration unit in which full travel is at most one.
 * @returns Stick with transformed magnitude.
 */
const mapGamepadStickMagnitude = (
  value: Readonly<GamepadStick>,
  mapMagnitude: (magnitude: number) => number,
  inputUnit?: number,
): GamepadStick => {
  // Beyond the calibrated range only direction matters. Keep both components
  // representable even when a custom stage supplies an extreme diagonal.
  const unit =
    inputUnit === undefined
      ? 1
      : Math.max(inputUnit, Math.abs(value.x), Math.abs(value.y));
  const x = value.x / unit;
  const y = value.y / unit;
  const magnitude = Math.hypot(x, y);
  if (magnitude === 0) {
    return createGamepadStickResult(value, 0, 0);
  }
  const mappedMagnitude = mapMagnitude(magnitude);
  if (mappedMagnitude === magnitude) {
    return createGamepadStickResult(value, x, y);
  }
  if (mappedMagnitude === 0) {
    return createGamepadStickResult(value, 0, 0);
  }
  const scale = mappedMagnitude / magnitude;
  return createGamepadStickResult(value, x * scale, y * scale);
};

/**
 * Limits stick length while preserving direction and partial deflection.
 *
 * @param value - Stick with finite components.
 * @param max - Maximum length, a finite non-negative number. Defaults to one.
 * @returns The limited stick with canonical zero components.
 * @throws RangeError if a component or the maximum is invalid.
 */
export const limitGamepadStickMagnitude = (
  value: Readonly<GamepadStick>,
  max = 1,
): GamepadStick => {
  if (!Number.isFinite(max) || max < 0) {
    throw new RangeError("max must be a finite non-negative number");
  }
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new RangeError("stick components must be finite numbers");
  }
  const largest = Math.max(Math.abs(value.x), Math.abs(value.y));
  if (largest === 0 || max === 0) {
    return createGamepadStickResult(value, 0, 0);
  }
  // Measure in units of the largest component so even extreme diagonals fit.
  const x = value.x / largest;
  const y = value.y / largest;
  const length = Math.hypot(x, y);
  const relativeMax = max / largest;
  if (relativeMax >= length) {
    return createGamepadStickResult(value, value.x, value.y);
  }
  const scale = relativeMax / length;
  // A subnormal scale can round to zero before it reaches the components.
  if (scale < 2 ** -1022) {
    return createGamepadStickResult(
      value,
      (x / length) * max,
      (y / length) * max,
    );
  }
  return scaleGamepadStick(value, scale);
};

/**
 * Applies a dead zone and remaps the remaining magnitude to `[0, 1]`.
 *
 * @param magnitude - Non-negative input magnitude.
 * @param threshold - Dead zone size.
 * @param maxInput - Input magnitude at full output.
 * @returns Rescaled magnitude, or `0` when inside a fully closed dead zone.
 */
const rescaleGamepadDeadzoneMagnitude = (
  magnitude: number,
  threshold: number,
  maxInput: number,
): number => {
  if (magnitude <= threshold || threshold >= maxInput) {
    return 0;
  }
  return Math.min((magnitude - threshold) / (maxInput - threshold), 1);
};

/**
 * Applies a built-in response curve to a normalized magnitude.
 *
 * Magnitudes above `1` remain unchanged so response curves do not implicitly
 * clamp or normalize custom processor output.
 *
 * @param magnitude - Non-negative component or vector magnitude.
 * @param curve - Response curve to apply.
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
 * @param maxInput - Optional calibration for the upper end of the input range.
 * @returns Frozen dead zone processor.
 */
const createDeadzoneProcessor = (
  threshold: number,
  mode: GamepadStickProcessingMode,
  rescale: boolean,
  maxInput?: number,
): GamepadStickProcessor => {
  if (
    maxInput !== undefined &&
    (rescale !== true ||
      !Number.isFinite(threshold) ||
      !Number.isFinite(maxInput) ||
      threshold < 0 ||
      threshold >= maxInput ||
      maxInput > 1)
  ) {
    throw new RangeError(
      "maxInput requires rescale: true and finite bounds with 0 <= threshold < maxInput <= 1",
    );
  }
  // A power-of-two unit near the calibrated maximum keeps subnormal travel
  // measurable and preserves the precision of the interval between the bounds.
  const radialUnit =
    mode === "radial" && maxInput !== undefined
      ? Math.min(1, 2 ** (Math.floor(Math.log2(maxInput)) + 1))
      : undefined;
  const unit = radialUnit ?? 1;
  const lowerBound = threshold / unit;
  const upperBound = (maxInput ?? 1) / unit;
  const mapMagnitude = (magnitude: number): number => {
    if (magnitude < lowerBound) {
      return 0;
    }
    return rescale
      ? rescaleGamepadDeadzoneMagnitude(magnitude, lowerBound, upperBound)
      : magnitude;
  };
  return Object.freeze({
    process: (value: Readonly<GamepadStick>): GamepadStick => {
      if (mode === "axial") {
        return createGamepadStickResult(
          value,
          mapGamepadSignedMagnitude(value.x, mapMagnitude),
          mapGamepadSignedMagnitude(value.y, mapMagnitude),
        );
      }
      return mapGamepadStickMagnitude(value, mapMagnitude, radialUnit);
    },
  });
};

/**
 * Creates an axial or radial response curve processor.
 *
 * @param curve - Response curve applied to normalized magnitudes.
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
    process: (value: Readonly<GamepadStick>): GamepadStick => {
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
    process: (value: Readonly<GamepadStick>): GamepadStick => {
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
  operation: GamepadStickTransform,
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
    process: (value: Readonly<GamepadStick>): GamepadStick => {
      let processed: Readonly<GamepadStick> = value;
      for (const processor of pipelineProcessors) {
        processed = processor.process(processed);
      }
      return processed as GamepadStick;
    },
    deadzone: (
      threshold = DEFAULT_GAMEPAD_DEADZONE_THRESHOLD,
      options?: GamepadDeadzoneOptions,
    ): GamepadStickPipeline =>
      append(
        createDeadzoneProcessor(
          threshold,
          options?.mode ?? mode,
          options?.rescale ?? false,
          options?.maxInput,
        ),
      ),
    responseCurve: (
      curve: GamepadResponseCurve,
      options?: GamepadResponseCurveOptions,
    ): GamepadStickPipeline =>
      append(createResponseCurveProcessor(curve, options?.mode ?? mode)),
    invert: (axis: GamepadStickInversionAxis): GamepadStickPipeline =>
      append(createInversionProcessor(axis)),
    transform: (operation: GamepadStickTransform): GamepadStickPipeline =>
      append(createTransformProcessor(operation)),
    pipe: append,
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
