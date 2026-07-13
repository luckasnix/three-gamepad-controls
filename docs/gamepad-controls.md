# GamepadControls

Abstract base class for all [Three.js](https://threejs.org) gamepad control wrappers.

`GamepadControls` delegates the [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) lifecycle and per-frame input state to [`GamepadInput`](./gamepad-input.md). Subclasses only need to map the active input state to the wrapped Three.js control.

It extends Three.js `EventDispatcher` to stay idiomatic with the rest of the Three.js controls ecosystem.

## Constructor

Subclasses pass selection options to `super(options?)`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `gamepadIndex` | `number` | `undefined` | Browser-assigned gamepad slot to select. When omitted, selects the connected gamepad with the lowest index. |

`gamepadIndex` must be an integer from `0` through `2147483647`; any other value throws a `RangeError`. Selecting an explicit slot disables automatic fallback. See [Multiple Gamepads](./multiple-gamepads.md) for slot reuse, lifecycle, and examples using multiple controls.

## Properties

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | When `false`, all input processing is paused. |
| `gamepad` | `Gamepad \| null` | `null` | The currently active gamepad, or `null` if not connected. By default, this is the connected gamepad with the lowest index. |
| `vibrationSupported` | `boolean` | `false` | Whether the active gamepad exposes the current vibration API. |

## Methods

### `update(deltaTime)`

Advances the controller by one frame. Call this inside your render loop. When the wrapped Three.js control has a per-frame `update()` method, call this first and then call the native method. See the individual wrapper documentation: `ArcballControls` does not need a per-frame native update, and `PointerLockControls` has no `update()` method.

`update()` delegates polling to the internal `GamepadInput`, refreshes the active gamepad snapshot, and then calls `onUpdate(deltaTime)` when a gamepad is available.

| Parameter | Type | Description |
| --- | --- | --- |
| `deltaTime` | `number` | Time elapsed since the last frame, in **seconds**. |

### `dispose()`

Removes all gamepad input listeners attached by this controller. Call this when the controller is no longer needed to prevent memory leaks. After `dispose()`, `update()` becomes a no-op regardless of whether a gamepad is connected.

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
| `disconnected` | `gamepad: Gamepad` | Fired when the active gamepad disconnects or is replaced in the same slot. |

## Hooks

### `gamepadInput`

Protected getter that exposes the shared `GamepadInput` used by the control wrapper. Use it inside subclasses to read buttons, button transitions, axes, sticks, and analog button values without polling the browser directly.

### `onUpdate(deltaTime)`

**Abstract.** Called every frame when a gamepad is available and `enabled` is `true`. This is the only method subclasses are required to implement.

Prefer reading input through `this.gamepadInput` inside this hook. Use `this.gamepad` only when you need raw snapshot access.

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
  GamepadControls,
  type GamepadControlsOptions,
} from "three-gamepad-controls";

class CustomGamepadOrbitControls extends GamepadControls {
  readonly #controls: OrbitControls;

  constructor(controls: OrbitControls, options?: GamepadControlsOptions) {
    super(options);
    this.#controls = controls;
  }

  protected override onUpdate(deltaTime: number): void {
    // `GamepadControls.update()` has already refreshed this input for the frame.
    const rotateX = this.gamepadInput.axis(GAMEPAD_AXIS.LeftX);
    const dollyIn = this.gamepadInput.buttonValue(GAMEPAD_BUTTON.RightTrigger);

    if (rotateX !== 0) {
      this.#controls.rotateLeft(rotateX * deltaTime * Math.PI);
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
