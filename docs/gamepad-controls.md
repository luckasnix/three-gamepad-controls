# GamepadControls

Abstract base class for all [Three.js](https://threejs.org) gamepad control wrappers.

`GamepadControls` handles the full lifecycle of the [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) — listening for connect/disconnect events, polling the active gamepad each frame, and dispatching typed events — so that subclasses only need to implement the input → action mapping.

It extends Three.js `EventDispatcher` to stay idiomatic with the rest of the Three.js controls ecosystem.

## Properties

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | `boolean` | `true` | When `false`, all input processing is paused. |
| `gamepad` | `Gamepad \| null` | `null`  | The currently active gamepad, or `null` if not connected. By default, this is the first gamepad that connects. Override [`onGamepadConnected`](#ongamepadconnectedgamepad) to customize this behavior. |

## Methods

### `update(deltaTime)`

Advances the controller by one frame. Call this inside your render loop **before** the underlying Three.js control's own `update()`.

The Web Gamepad API is snapshot-based: the browser only updates gamepad state when you call `navigator.getGamepads()`, so polling here — rather than caching a stale reference — is required.

| Parameter | Type | Description |
| --- | --- | --- |
| `deltaTime` | `number` | Time elapsed since the last frame, in **seconds**. |

### `dispose()`

Removes all window-level event listeners attached by this controller. Call this when the controller is no longer needed to prevent memory leaks. After `dispose()`, `update()` becomes a no-op regardless of whether a gamepad is connected.

## Events

| Event | Extra fields | Description |
| --- | --- | --- |
| `connected`    | `gamepad: Gamepad` | Fired when a gamepad connects and becomes active. |
| `disconnected` | `gamepad: Gamepad` | Fired when the active gamepad disconnects.        |

## Hooks

### `onUpdate(deltaTime, gamepad)`

**Abstract.** Called every frame when a gamepad is available and `enabled` is `true`. This is the only method subclasses are required to implement — map `gamepad` buttons and axes to the wrapped Three.js control here.

| Parameter | Type | Description |
| --- | --- | --- |
| `deltaTime` | `number` | Seconds since the last frame. |
| `gamepad` | `Gamepad` | Fresh snapshot of the active gamepad. |

### `onGamepadConnected(gamepad)`

Called whenever any gamepad fires a `gamepadconnected` browser event. The default implementation accepts the **first** gamepad that connects, dispatches `connected`, and ignores all subsequent ones. Override this if you need different selection behavior (e.g., always use player index 0, or show a "press any button to join" UI).

| Parameter | Type | Description |
| --- | --- | --- |
| `gamepad` | `Gamepad` | The gamepad that just connected. |

### `onGamepadDisconnected(gamepad)`

Called whenever any gamepad fires a `gamepaddisconnected` browser event. The default clears `this.gamepad` and dispatches a `disconnected` event if the disconnecting gamepad was the active one. Override to add custom cleanup logic.

| Parameter | Type | Description |
| --- | --- | --- |
| `gamepad` | `Gamepad` | The gamepad that just disconnected. |

## Usage

Extend `GamepadControls` and implement `onUpdate(deltaTime, gamepad)`:

```ts
import type { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Timer } from "three";
import { GamepadControls } from "three-gamepad-controls";

class GamepadOrbitControls extends GamepadControls {
  readonly #controls: OrbitControls;

  constructor(controls: OrbitControls) {
    super();
    this.#controls = controls;
  }

  protected override onUpdate(deltaTime: number, gamepad: Gamepad): void {
    // Map buttons and axes to `this.#controls` here
  }
}

const orbitControls = new OrbitControls(camera, renderer.domElement);
const gamepadOrbitControls = new GamepadOrbitControls(orbitControls);

gamepadOrbitControls.addEventListener("connected", (event) => {
  console.log("Gamepad ready:", event.gamepad.id);
});

const timer = new Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  gamepadOrbitControls.update(delta); // 1. read gamepad → queue deltas
  orbitControls.update(delta);        // 2. apply damping + flush queued deltas
  renderer.render(scene, camera);
});

// When done:
gamepadOrbitControls.dispose();
```
