# GamepadControls

Abstract base class for all [Three.js](https://threejs.org) gamepad control wrappers.

`GamepadControls` delegates the [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) lifecycle and per-frame input state to [`GamepadInput`](./gamepad-input.md). Subclasses only need to map the active input state to the wrapped Three.js control.

It extends Three.js `EventDispatcher` to stay idiomatic with the rest of the Three.js controls ecosystem.

## Properties

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | When `false`, all input processing is paused. |
| `gamepad` | `Gamepad \| null` | `null` | The currently active gamepad, or `null` if not connected. By default, this is the first gamepad that connects. |

## Methods

### `update(deltaTime)`

Advances the controller by one frame. Call this inside your render loop **before** the underlying Three.js control's own `update()`.

`update()` delegates polling to the internal `GamepadInput`, refreshes the active gamepad snapshot, and then calls `onUpdate(deltaTime)` when a gamepad is available.

| Parameter | Type | Description |
| --- | --- | --- |
| `deltaTime` | `number` | Time elapsed since the last frame, in **seconds**. |

### `dispose()`

Removes all gamepad input listeners attached by this controller. Call this when the controller is no longer needed to prevent memory leaks. After `dispose()`, `update()` becomes a no-op regardless of whether a gamepad is connected.

## Events

| Event | Extra fields | Description |
| --- | --- | --- |
| `connected` | `gamepad: Gamepad` | Fired when a gamepad connects and becomes active. |
| `disconnected` | `gamepad: Gamepad` | Fired when the active gamepad disconnects. |

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
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  GAMEPAD_AXIS,
  GAMEPAD_BUTTON,
  GamepadControls,
} from "three-gamepad-controls";

class CustomGamepadOrbitControls extends GamepadControls {
  readonly #controls: OrbitControls;

  constructor(controls: OrbitControls) {
    super();
    this.#controls = controls;
  }

  protected override onUpdate(deltaTime: number): void {
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
const gamepadOrbitControls = new CustomGamepadOrbitControls(orbitControls);

gamepadOrbitControls.addEventListener("connected", (event) => {
  console.log("Gamepad ready:", event.gamepad.id);
});

const timer = new Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  gamepadOrbitControls.update(delta);
  orbitControls.update(delta);
  renderer.render(scene, camera);
});

// When done:
gamepadOrbitControls.dispose();
```
