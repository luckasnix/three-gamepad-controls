/**
 * Dead zone processing mode for two-dimensional stick reads.
 */
export type GamepadDeadzoneMode = "axial" | "radial";

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
  mode?: GamepadDeadzoneMode;

  /**
   * Whether to remap values outside the dead zone to the full output range.
   * @default false
   */
  rescale?: boolean;
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
 * Applies an axial dead zone to one component.
 *
 * @param value - Signed component value.
 * @param threshold - Dead zone size.
 * @param rescale - Whether to remap the remaining magnitude.
 * @returns Processed signed component.
 */
const applyGamepadAxialDeadzone = (
  value: number,
  threshold: number,
  rescale: boolean,
): number => {
  if (value === 0) {
    return 0;
  }

  const magnitude = Math.abs(value);

  if (magnitude < threshold) {
    return 0;
  }

  if (!rescale) {
    return value;
  }

  const rescaledMagnitude = rescaleGamepadDeadzoneMagnitude(
    magnitude,
    threshold,
  );

  if (rescaledMagnitude === 0) {
    return 0;
  }

  return Math.sign(value) * rescaledMagnitude;
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

  return Object.freeze({
    process(value: Readonly<GamepadStick>): GamepadStick {
      if (mode === "axial") {
        const x = applyGamepadAxialDeadzone(value.x, threshold, rescale);
        const y = applyGamepadAxialDeadzone(value.y, threshold, rescale);

        if (
          x === value.x &&
          y === value.y &&
          !Object.is(value.x, -0) &&
          !Object.is(value.y, -0)
        ) {
          return value as GamepadStick;
        }

        return {
          x,
          y,
        };
      }

      const magnitude = Math.hypot(value.x, value.y);

      if (magnitude < threshold) {
        if (
          value.x === 0 &&
          value.y === 0 &&
          !Object.is(value.x, -0) &&
          !Object.is(value.y, -0)
        ) {
          return value as GamepadStick;
        }

        return {
          x: 0,
          y: 0,
        };
      }

      if (!rescale) {
        if (!Object.is(value.x, -0) && !Object.is(value.y, -0)) {
          return value as GamepadStick;
        }

        return {
          x: value.x === 0 ? 0 : value.x,
          y: value.y === 0 ? 0 : value.y,
        };
      }

      const rescaledMagnitude = rescaleGamepadDeadzoneMagnitude(
        magnitude,
        threshold,
      );

      if (rescaledMagnitude === 0 || magnitude === 0) {
        if (
          value.x === 0 &&
          value.y === 0 &&
          !Object.is(value.x, -0) &&
          !Object.is(value.y, -0)
        ) {
          return value as GamepadStick;
        }

        return {
          x: 0,
          y: 0,
        };
      }

      const scale = rescaledMagnitude / magnitude;
      const x = value.x === 0 ? 0 : value.x * scale;
      const y = value.y === 0 ? 0 : value.y * scale;

      if (
        x === value.x &&
        y === value.y &&
        !Object.is(value.x, -0) &&
        !Object.is(value.y, -0)
      ) {
        return value as GamepadStick;
      }

      return {
        x,
        y,
      };
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
        if (!Object.is(value.x, -0) && !Object.is(value.y, -0)) {
          return value as GamepadStick;
        }

        return {
          x: value.x === 0 ? 0 : value.x,
          y: value.y === 0 ? 0 : value.y,
        };
      }

      const x = value.x === 0 ? 0 : invertX ? -value.x : value.x;
      const y = value.y === 0 ? 0 : invertY ? -value.y : value.y;

      if (
        x === value.x &&
        y === value.y &&
        !Object.is(value.x, -0) &&
        !Object.is(value.y, -0)
      ) {
        return value as GamepadStick;
      }

      return {
        x,
        y,
      };
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
