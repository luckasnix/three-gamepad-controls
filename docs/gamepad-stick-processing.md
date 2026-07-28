# Gamepad Stick Processing

The library processes two-dimensional stick input with an ordered, stateless pipeline. A pipeline keeps transformations such as deadzones, response curves, and inversion independent from `GamepadInput` and lets each input action use its own processing policy.

```text
raw { x, y }
  -> processor 1
  -> processor 2
  -> ...
  -> processed { x, y }
```

Processors run exactly in the order supplied. The pipeline does not reorder them, catch exceptions, clamp values, or normalize custom results.

## Processor contract

`GamepadStickProcessor` has one method:

```ts
type GamepadStickProcessor = {
  process(value: Readonly<GamepadStick>): GamepadStick;
};
```

A processor must be pure and stateless:

- Do not mutate `value`.
- Do not retain frame-to-frame input state.
- Return the same result for the same input and configuration.
- Return a complete `{ x, y }` value.

The output of one processor is passed directly to the next. Returning out-of-range values is allowed for custom processors and remains the processor author's responsibility.

This custom processor swaps the components without mutating its input:

```ts
const swapAxes: GamepadStickProcessor = {
  process(value) {
    return {
      x: value.y,
      y: value.x,
    };
  },
};
```

## Creating a pipeline

Use `createGamepadStickPipeline(...processors)`:

```ts
const lookPipeline = createGamepadStickPipeline(
  createGamepadDeadzoneProcessor({
    threshold: 0.12,
    mode: "radial",
    rescale: true,
  }),
  createGamepadResponseCurveProcessor({
    curve: "cubic",
    mode: "radial",
  }),
  createGamepadInversionProcessor({ invertY: true }),
);
```

The factory copies the processor list once, so later changes to the caller's array do not affect the pipeline. The same pipeline can be reused across input readers and actions without creating a processor array per frame.

An empty pipeline is identity:

```ts
const rawPipeline = createGamepadStickPipeline();
```

`DEFAULT_GAMEPAD_STICK_PIPELINE` contains only `createGamepadDeadzoneProcessor()` and therefore applies the historical axial deadzone of `0.1` without rescaling, a response curve, or inversion.

## Processing modes

`GamepadStickProcessingMode` is the shared `"axial" | "radial"` mode used by processors that can transform either independent components or vector magnitude:

- `"axial"` transforms X and Y independently and can change vector direction.
- `"radial"` transforms magnitude once and preserves vector direction.

Not every processor uses this mode. Inversion, for example, always selects components independently.

## Official processors

### `createGamepadDeadzoneProcessor(options?)`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `threshold` | `number` | `0.1` | Neutral-region threshold. |
| `mode` | `"axial" \| "radial"` | `"axial"` | Processes components independently or processes vector magnitude. |
| `rescale` | `boolean` | `false` | Remaps the remaining component range or magnitude to start at zero. |

Axial mode applies the threshold independently to X and Y. Radial mode compares `Math.hypot(x, y)` with the threshold and, when rescaling, preserves direction while remapping magnitude.

![Comparison showing a square axial dead zone and a circular radial dead zone within the analog stick range.](../assets/deadzone-modes.webp "Axial and radial analog-stick dead zones")

### `createGamepadResponseCurveProcessor(options)`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `curve` | `"linear" \| "quadratic" \| "cubic"` | Required | Transforms normalized component or magnitude values. |
| `mode` | `"axial" \| "radial"` | Required | Processes components independently or processes vector magnitude. |

The built-in curves map magnitudes in the normalized `[0, 1]` range:

| Curve | Formula | Output at `0.5` |
| --- | --- | --- |
| `"linear"` | `m` | `0.5` |
| `"quadratic"` | `m²` | `0.25` |
| `"cubic"` | `m³` | `0.125` |

Axial mode preserves each component's sign while curving its magnitude independently. Radial mode curves `Math.hypot(x, y)` and scales both components by the same amount, preserving direction. Component or vector magnitudes above `1` remain unchanged so the processor does not implicitly clamp or normalize output from an earlier custom processor.

### `createGamepadInversionProcessor(options?)`

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `invertX` | `boolean` | `false` | Negates the first component passed to `stick()`. |
| `invertY` | `boolean` | `false` | Negates the second component passed to `stick()`. |

Inversion is independent per component. Official processors preserve canonical zero and do not produce `-0` for neutral components.

A common order is deadzone, response curve, and then inversion. This makes the curve operate on input after the neutral region has been removed and optionally rescaled:

```ts
const preciseLookPipeline = createGamepadStickPipeline(
  createGamepadDeadzoneProcessor({
    threshold: 0.12,
    mode: "radial",
    rescale: true,
  }),
  createGamepadResponseCurveProcessor({
    curve: "cubic",
    mode: "radial",
  }),
  createGamepadInversionProcessor({ invertY: true }),
);
```

The pipeline still respects the exact configured order and does not automatically arrange these processors.

## Using a pipeline with GamepadInput

Set an instance default with `stickPipeline`:

```ts
const input = new GamepadInput({
  stickPipeline: lookPipeline,
});

const look = input.stick(GAMEPAD_AXIS.RightX, GAMEPAD_AXIS.RightY);
```

Pass a third argument to replace the instance default for one read:

```ts
const movement = input.stick(
  GAMEPAD_AXIS.LeftX,
  GAMEPAD_AXIS.LeftY,
  movementPipeline,
);
```

The per-read pipeline replaces the instance pipeline completely; it is not merged or appended. `axis()` remains a scalar API and uses `axisDeadzone`, not a stick pipeline.

## Action bindings

`GamepadStickBindingOptions` groups the axes and pipeline for a two-dimensional input action. Its `xAxis`, `yAxis`, and `pipeline` fields are optional so callers can override only the parts they need. `GamepadStickBinding` represents the corresponding fully resolved configuration.

```ts
import {
  DEFAULT_GAMEPAD_STICK_PIPELINE,
  GAMEPAD_AXIS,
  type GamepadStickBinding,
  type GamepadStickBindingOptions,
  resolveGamepadStickBinding,
} from "three-gamepad-controls";

const DEFAULT_LOOK_STICK: GamepadStickBinding = {
  xAxis: GAMEPAD_AXIS.RightX,
  yAxis: GAMEPAD_AXIS.RightY,
  pipeline: DEFAULT_GAMEPAD_STICK_PIPELINE,
};

type GameInputOptions = {
  lookStick?: GamepadStickBindingOptions;
};

const options: GameInputOptions = {
  lookStick: {
    pipeline: lookPipeline,
  },
};

const lookStick = resolveGamepadStickBinding(
  DEFAULT_LOOK_STICK,
  options.lookStick,
);

const look = input.stick(lookStick.xAxis, lookStick.yAxis, lookStick.pipeline);
```

`resolveGamepadStickBinding(defaults, options?)` resolves each field independently with nullish fallback. An omitted or `undefined` field preserves its default, while a supplied `pipeline` replaces the complete default pipeline rather than merging processor lists. The result always contains `xAxis`, `yAxis`, and `pipeline` and can be passed directly to `GamepadInput.stick()`.

## Stateful processing

This pipeline intentionally excludes smoothing, hysteresis, rate limiting, acceleration, and any processor whose result depends on previous frames or elapsed time. Those effects require lifecycle, reset, and timing semantics that a reusable stateless pipeline cannot provide safely. They will need a separate stateful abstraction rather than a processor that silently retains state.
