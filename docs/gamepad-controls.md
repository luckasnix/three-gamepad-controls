# GamepadControls

Abstract base class for all [Three.js](https://threejs.org) gamepad control wrappers.

`GamepadControls` delegates the [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) lifecycle and per-frame input state to [`GamepadInput`](./gamepad-input.md). Subclasses only need to map the active input state to the wrapped Three.js control.

It extends Three.js `EventDispatcher` to stay idiomatic with the rest of the Three.js controls ecosystem.

## Constructor

Subclasses pass selection options to `super(options?)`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `gamepadIndex` | `number` | `undefined` | Browser-assigned gamepad slot to select. When omitted, adopts the lowest connected index and keeps that slot until its loss is observed, even if a lower index connects later. |

`gamepadIndex` must be an integer from [`MIN_GAMEPAD_INDEX`](./core.md#min_gamepad_index) through [`MAX_GAMEPAD_INDEX`](./core.md#max_gamepad_index); any other value throws a `RangeError`. Selecting an explicit slot disables automatic fallback. See [Multiple Gamepads](./multiple-gamepads.md) for slot reuse, lifecycle, and examples using multiple controls.

`GamepadControlsOptions` intentionally exposes only gamepad selection. Ready-made subclasses associate [stateless stick pipelines](./gamepad-stick-processing.md) with named actions such as `moveStick`, `lookStick`, or `panStick` in their own option types.

## Stick action bindings

Ready-made wrappers group the axes and pipeline for each two-dimensional action. Every stick binding accepts optional `xAxis`, `yAxis`, and `pipeline` fields; omitted fields inherit that action's defaults.

```ts
const gamepadControls = new GamepadOrbitControls(orbitControls, {
  rotateStick: {
    pipeline: lookPipeline,
  },
  panStick: {
    xAxis: GAMEPAD_AXIS.LeftX,
    yAxis: GAMEPAD_AXIS.LeftY,
  },
});
```

Each field is resolved independently. Overriding only `pipeline` keeps both default axes, while overriding only `xAxis` keeps the default Y axis and pipeline. A supplied pipeline replaces the complete action default rather than merging processor lists.

| Wrapper | Stick actions |
| --- | --- |
| `GamepadFirstPersonControls` | `moveStick`, `lookStick` |
| `GamepadFlyControls` | `moveStick`, `lookStick` |
| `GamepadPointerLockControls` | `moveStick`, `lookStick` |
| `GamepadOrbitControls` | `rotateStick`, `panStick` |
| `GamepadMapControls` | `rotateStick`, `panStick` |
| `GamepadTrackballControls` | `rotateStick`, `panStick` |
| `GamepadArcballControls` | `rotateStick`, `panStick` |
| `GamepadDragControls` | `dragStick`, `rotateStick` |
| `GamepadTransformControls` | `transformStick` |

Map controls preserve their special defaults: the left stick pans and the right stick rotates.

Pipelines are not applied to triggers, digital buttons, scalar zoom, vertical movement, or Z rotation. Wrappers that consume analog buttons or triggers expose `buttonDeadzone` separately.

## Properties

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | When `false`, `update()` pauses polling and subclass input application. State and browser connection/disconnection listeners are retained. |
| `gamepad` | `Gamepad \| null` | `null` | The active snapshot, or `null` if none has been adopted. Automatic selection retains its adopted slot until an observed loss. |
| `vibrationSupported` | `boolean` | `false` | Whether the active gamepad exposes the current vibration API. |

## Methods

### `update(deltaTime)`

Advances the controller by one frame. Call this inside your render loop. When the wrapped Three.js control has a per-frame `update()` method, call this first and then call the native method. See the individual wrapper documentation: `ArcballControls` does not need a per-frame native update, and `PointerLockControls` has no `update()` method.

`update()` delegates polling to the internal `GamepadInput`, refreshes the active gamepad snapshot, and then calls `onUpdate(deltaTime)` when a gamepad is available.

Setting the wrapper's `enabled` to `false` makes this method return without polling or calling `onUpdate()`. The assignment itself does not reset or cancel an interaction. Browser events can still adopt or disconnect a gamepad and invoke lifecycle hooks while paused; a connection event may poll. A loss visible only through polling is detected when updates resume.

On resume, buttons compare against the last observed state. A newly held press can produce `wasPressed`, but complete clicks between observations are not replayed. Adoption after an observed loss seeds held buttons without a press transition. The native control's `enabled` is independent: the base continues polling while the wrapper is enabled, and subclasses handle native permissions and their own interaction cleanup. See [Pause, resume, and disposal](./multiple-gamepads.md#pause-resume-and-disposal).

| Parameter | Type | Description |
| --- | --- | --- |
| `deltaTime` | `number` | Time elapsed since the last frame, in **seconds**. |

### `dispose()`

Removes all gamepad input listeners attached by this controller. Call this when the controller is no longer needed to prevent memory leaks. After `dispose()`, `update()` becomes a no-op regardless of whether a gamepad is connected.

Disposal clears state and disables the wrapper without fabricating `disconnected`. Repeated disposal is safe and leaves other instances alone. Reuse after disposal is unsupported; create a new wrapper when needed.

This method does not dispose the wrapped Three.js control. The application owns
that instance and must call its own `dispose()` separately.

### `playVibrationEffect(type, parameters?)`

Delegates a haptic effect to the active gamepad's primary vibration actuator. It returns a `Promise<GamepadHapticsResult | null>` and resolves to `null` when vibration is unavailable or temporarily cannot be played.

### `resetVibration()`

Stops the active vibration effect. It returns a `Promise<GamepadHapticsResult | null>` and resolves to `null` when no supported actuator is available.

These methods are inherited by every `Gamepad*Controls` wrapper. See [Haptic Feedback](./haptic-feedback.md) for effect parameters, graceful degradation behavior, and examples.

## Events

| Event | Extra fields | Description |
| --- | --- | --- |
| `connected` | `gamepad: Gamepad` | Fired when a gamepad is adopted as active. |
| `disconnected` | `gamepad: Gamepad` | Fired on a browser disconnection event for the active slot or when polling observes that slot missing or disconnected. The payload is the previously active snapshot. |

New snapshots, IDs, or timestamps in a continuously connected slot do not signal reconnection. Physical replacement detection requires an observed loss. Adoption after loss waits until a subsequent update. See [Observed connection lifecycle](./multiple-gamepads.md#observed-connection-lifecycle).

## Hooks

### `gamepadInput`

Protected getter that exposes the shared `GamepadInput` used by the control wrapper. Use it inside subclasses to read buttons, button transitions, axes, sticks, and analog button values without polling the browser directly.

### `onUpdate(deltaTime)`

**Abstract.** Called every frame when a gamepad is available and `enabled` is `true`. This is the only method subclasses are required to implement.

Prefer reading input through `this.gamepadInput` inside this hook. Use `this.gamepad` only when you need raw snapshot access.

Custom subclasses that expose partial stick bindings can use [`resolveGamepadStickBinding()`](./gamepad-stick-processing.md#action-bindings) to apply the same merge semantics as the ready-made wrappers.

| Parameter | Type | Description |
| --- | --- | --- |
| `deltaTime` | `number` | Seconds since the last frame. |

### `onGamepadConnected(gamepad)`

Called when `GamepadInput` adopts a gamepad as active. The default implementation dispatches `connected`.

| Parameter | Type | Description |
| --- | --- | --- |
| `gamepad` | `Gamepad` | The gamepad that became active. |

### `onGamepadDisconnected(gamepad)`

Called when the active gamepad disconnects. The default implementation dispatches `disconnected`.

This hook also runs for browser disconnection events while the wrapper is paused. Subclasses can use it to clean up interactions they own. Pausing by assignment alone does not invoke this hook.

| Parameter | Type | Description |
| --- | --- | --- |
| `gamepad` | `Gamepad` | The gamepad that was active before disconnection. |

## Usage

Extend `GamepadControls` and implement `onUpdate(deltaTime)`:

```ts
import { Timer } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  GAMEPAD_AXIS,
  GAMEPAD_BUTTON,
  gamepadStickPipeline,
  GamepadControls,
  type GamepadControlsOptions,
} from "three-gamepad-controls";

const rotatePipeline = gamepadStickPipeline({ mode: "radial" }).deadzone();

class CustomGamepadOrbitControls extends GamepadControls {
  readonly #controls: OrbitControls;

  constructor(controls: OrbitControls, options?: GamepadControlsOptions) {
    super(options);
    this.#controls = controls;
  }

  protected override onUpdate(deltaTime: number): void {
    // `GamepadControls.update()` has already refreshed this input for the frame.
    const rotate = this.gamepadInput.stick(
      GAMEPAD_AXIS.LeftX,
      GAMEPAD_AXIS.LeftY,
      rotatePipeline,
    );
    const dollyIn = this.gamepadInput.buttonValue(GAMEPAD_BUTTON.RightTrigger);

    if (rotate.x !== 0) {
      this.#controls.rotateLeft(rotate.x * deltaTime * Math.PI);
    }

    if (dollyIn > 0.1) {
      this.#controls.dollyIn(1 / (1 + dollyIn * deltaTime));
    }
  }
}

const orbitControls = new OrbitControls(camera, renderer.domElement);
const gamepadOrbitControls = new CustomGamepadOrbitControls(orbitControls, {
  gamepadIndex: 0,
});

gamepadOrbitControls.addEventListener("connected", (event) => {
  console.log("Gamepad ready:", event.gamepad.id);
});

const timer = new Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  // Queue gamepad changes before the native control applies them.
  gamepadOrbitControls.update(delta);
  // Apply damping and native pointer input after the gamepad changes.
  orbitControls.update(delta);
  renderer.render(scene, camera);
});

// Clean up when the controls are no longer needed.
renderer.setAnimationLoop(null);
gamepadOrbitControls.dispose();
orbitControls.dispose();
timer.dispose();
```
