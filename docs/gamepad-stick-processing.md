# Gamepad Stick Processing

The library processes two-dimensional stick input with an ordered, stateless pipeline. A pipeline keeps transformations such as deadzones, response curves, and inversion independent from `GamepadInput` and lets each input action use its own processing policy.

```text
raw { x, y }
  -> stage 1
  -> stage 2
  -> ...
  -> processed { x, y }
```

Stages run exactly in the configured order. The pipeline does not reorder them, catch exceptions, clamp values, or normalize custom results.

## Creating a pipeline

Use `gamepadStickPipeline(options?)` and append processing stages with fluent methods:

```ts
import { gamepadStickPipeline } from "three-gamepad-controls";

const lookPipeline = gamepadStickPipeline({ mode: "radial" })
  .deadzone(0.12, { rescale: true })
  .responseCurve("cubic")
  .invert("y");
```

The pipeline itself implements `GamepadStickProcessor`, so it can be processed directly or passed anywhere a stick pipeline is accepted:

```ts
const look = lookPipeline.process({ x: 0.5, y: -0.25 });
```

Every fluent method returns a new frozen pipeline. Existing pipelines remain unchanged and can be reused as intermediate configurations:

```ts
const normalizedStick = gamepadStickPipeline({ mode: "radial" }).deadzone(
  0.12,
  { rescale: true },
);

const movementPipeline = normalizedStick.responseCurve("quadratic");
const lookPipeline = normalizedStick.responseCurve("cubic").invert("y");
```

An empty pipeline is an identity operation:

```ts
const rawPipeline = gamepadStickPipeline();
```

`DEFAULT_GAMEPAD_STICK_PIPELINE` is equivalent to `gamepadStickPipeline().deadzone()`. It preserves the historical axial deadzone of `0.1` without rescaling, a response curve, or inversion.

## Processing modes

`GamepadStickProcessingMode` is the shared `"axial" | "radial"` geometry used by processing stages that operate on either stick components or vector magnitude:

- `"axial"` transforms X and Y independently and can change vector direction.
- `"radial"` transforms magnitude once and preserves vector direction.

The `mode` passed to `gamepadStickPipeline()` becomes the default for every compatible stage. It defaults to `"axial"`. A stage-specific `mode` has higher precedence:

```ts
const mixedPipeline = gamepadStickPipeline({ mode: "radial" })
  .deadzone(0.12)
  .responseCurve("quadratic", { mode: "axial" });
```

The deadzone above is radial, while the response curve is axial. Inversion and custom processors do not use the pipeline mode.

The mode only determines how a compatible stage interprets the stick value. It does not create a dead zone or discard input by itself.

![Comparison of axial mode, which processes X and Y independently, and radial mode, which processes magnitude while preserving direction.](../assets/stick-processing-modes.webp "Axial and radial gamepad-stick processing modes")

## Fluent methods

### `deadzone(threshold?, options?)`

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `threshold` | `number` | `0.1` | Neutral-region threshold. |
| `options.mode` | `"axial" \| "radial"` | Pipeline mode | Processes components independently or processes vector magnitude. |
| `options.rescale` | `boolean` | `false` | Remaps the remaining component range or magnitude to start at zero. |
| `options.maxInput` | `number` | `1` when rescaling | Input magnitude that produces full output. Supplying a value requires `rescale: true`. |

Axial mode applies the threshold independently to X and Y. Radial mode compares `Math.hypot(x, y)` with the threshold and, when rescaling, preserves direction while remapping magnitude.

With rescaling enabled, magnitudes up to and including `threshold` produce zero. Between `threshold` and `maxInput`, the output magnitude is `(m - threshold) / (maxInput - threshold)`. At or above `maxInput`, the output magnitude is one. Supplying `maxInput` requires finite bounds satisfying `0 ≤ threshold < maxInput ≤ 1`. Invalid calibration throws a `RangeError` when calling `deadzone()`.

Omitting `maxInput` or passing `undefined` uses the original behavior. A rescaled threshold of `1` closes the entire range. With rescaling disabled, a magnitude exactly at the threshold passes through.

The diagram uses non-negative magnitude, so the same response applies to an axial component or to radial vector magnitude, depending on the configured mode.

![Deadzone response graphs comparing unchanged and rescaled output outside the threshold.](../assets/stick-deadzone.webp "Gamepad stick deadzone response with and without rescaling")

#### Calibrating a look stick in the browser

Read the connected stick through an empty pipeline. First release it and observe its radial magnitude at rest to choose a threshold above the drift. Then move it to the physical stop several times in each of the four cardinal directions and along each diagonal. Record the magnitudes separately. A single radial `maxInput` works best when the measured travel is similar in every direction. If the readings differ, a lower maximum makes the longer directions reach full output earlier.

```ts
import {
  GAMEPAD_AXIS,
  GamepadInput,
  gamepadStickPipeline,
} from "three-gamepad-controls";

const input = new GamepadInput();
const raw = gamepadStickPipeline({ mode: "radial" });
const calibrated = raw.deadzone(0.1, { rescale: true, maxInput: 0.9 });
const { RightX, RightY } = GAMEPAD_AXIS;

// Call once per frame while measuring the look stick.
const sampleLookStick = () => {
  input.update();
  if (input.connected) {
    const measured = input.stick(RightX, RightY, raw);
    const look = input.stick(RightX, RightY, calibrated);
    console.log(Math.hypot(measured.x, measured.y), Math.hypot(look.x, look.y));
  }
};
```

With these bounds, a raw magnitude of `0.50` produces `0.50`, and a physical stop at `0.90` produces `1`. To give the look action finer control near the center, use `calibrated.responseCurve("quadratic")` for its pipeline. The same midpoint then produces `0.25`.

### `responseCurve(curve, options?)`

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `curve` | `"linear" \| "quadratic" \| "cubic"` | Required | Transforms normalized component or magnitude values. |
| `options.mode` | `"axial" \| "radial"` | Pipeline mode | Processes components independently or processes vector magnitude. |

The built-in response curves map magnitudes in the normalized `[0, 1]` range:

| Response curve | Formula | Output at `0.5` |
| --- | --- | --- |
| `"linear"` | `m` | `0.5` |
| `"quadratic"` | `m²` | `0.25` |
| `"cubic"` | `m³` | `0.125` |

Axial mode preserves each component's sign while applying the response curve to its magnitude independently. Radial mode applies the response curve to `Math.hypot(x, y)` and scales both components by the same amount, preserving direction. Component or vector magnitudes above `1` remain unchanged.

![Response graphs for linear, quadratic, and cubic response curves showing their output at an input magnitude of 0.5.](../assets/stick-response-curves.webp "Built-in gamepad stick response curves")

### `invert(axis)`

`GamepadStickInversionAxis` is the `"x" | "y" | "both"` selection accepted by `invert()`. The selected components are negated. Inversion preserves canonical zero and does not produce `-0` for neutral components.

![Three coordinate diagrams showing how inverting X, Y, or both components reflects a gamepad stick vector.](../assets/stick-inversion.webp "Gamepad stick axis inversion")

```ts
const invertedLook = gamepadStickPipeline().invert("y");
```

### `transform(operation)`

`GamepadStickTransform` is the callback type accepted by `transform()`. Use it for a one-off pure transformation. The callback receives the current readonly stick value and must return a complete `{ x, y }` result:

```ts
const swappedAxes = gamepadStickPipeline().transform(({ x, y }) => ({
  x: y,
  y: x,
}));
```

The callback result is passed directly to the next stage. Out-of-range values and thrown errors remain the caller's responsibility.

### `pipe(processor)`

Use `pipe()` to append a reusable `GamepadStickProcessor`. Another pipeline is also a processor and can therefore be composed directly:

```ts
const normalizedStick = gamepadStickPipeline({ mode: "radial" })
  .deadzone(0.12, { rescale: true })
  .responseCurve("cubic");

const lookPipeline = gamepadStickPipeline()
  .pipe(normalizedStick)
  .transform(({ x, y }) => ({ x: y, y: x }))
  .invert("y");
```

`GamepadStickProcessor` is the low-level extension contract:

```ts
type GamepadStickProcessor = {
  process(value: Readonly<GamepadStick>): GamepadStick;
};
```

Implementations must be pure and stateless: do not mutate `value`, retain frame-to-frame state, or return partial results.

## Limiting movement magnitude

`limitGamepadStickMagnitude(value, max = 1)` caps the length of a 2D vector while preserving its direction. Values at or below the limit retain their analog intensity. With the default limit, a full diagonal has length `1` and a half-deflected cardinal direction has length `0.5`.

```ts
import {
  GamepadPointerLockControls,
  gamepadStickPipeline,
  limitGamepadStickMagnitude,
} from "three-gamepad-controls";

const limited = limitGamepadStickMagnitude({ x: 0.3, y: -0.4 }, 0.25);
// limited is approximately { x: 0.15, y: -0.20 }.

const movement = gamepadStickPipeline()
  .deadzone(0.15)
  .transform(limitGamepadStickMagnitude);

const controls = new GamepadPointerLockControls(pointerLockControls, {
  moveStick: { pipeline: movement },
});
```

The function accepts a readonly stick and a finite maximum greater than or equal to zero. A zero maximum returns `{ x: 0, y: 0 }`. A negative or non-finite maximum, or a non-finite component, throws `RangeError`. Place the limiter after any gain that should count toward the cap.

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

`resolveGamepadStickBinding(defaults, options?)` resolves each field independently with nullish fallback. An omitted or `undefined` field preserves its default, while a supplied pipeline replaces the complete default pipeline. The result always contains `xAxis`, `yAxis`, and `pipeline`.

## Stateful processing

This pipeline intentionally excludes smoothing, hysteresis, rate limiting, acceleration, and any processor whose result depends on previous frames or elapsed time. Those effects require lifecycle, reset, and timing semantics that a reusable stateless pipeline cannot provide safely. They need a separate stateful abstraction rather than a processor that silently retains state.
