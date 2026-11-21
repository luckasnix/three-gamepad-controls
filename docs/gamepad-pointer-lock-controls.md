# GamepadPointerLockControls

A ready-to-use `GamepadControls` subclass that maps gamepad inputs to [Three.js PointerLockControls](https://threejs.org/docs/#PointerLockControls) — camera movement and look — all driven by analog sticks.

Built on top of `GamepadControls`, it inherits the full [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) lifecycle (connect/disconnect events, per-frame polling, and `dispose()`), so you only need to instantiate it and drop `update()` into your render loop. Gamepad input works independently of pointer lock state — when the pointer is locked, mouse and gamepad look inputs are additive.

All bindings and speeds are configurable via the `options` parameter.

## Default Bindings

| Input | Action |
| --- | --- |
| Left stick | Move forward / backward / strafe |
| Right stick | Look (yaw and pitch) |

Every binding is remappable via the `options` parameter.

## Constructor

`new GamepadPointerLockControls(controls, options?)`

| Parameter | Type | Description |
| --- | --- | --- |
| `controls` | `PointerLockControls` | __Required.__ The Three.js `PointerLockControls` instance to wrap. |
| `options` | `Partial<GamepadPointerLockControlsOptions>` | Optional configuration. Any property not provided falls back to its default. |

### `options`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `gamepadIndex` | `number` | `undefined` | Browser-assigned reusable slot ([`MIN_GAMEPAD_INDEX`](./core.md#min_gamepad_index) to [`MAX_GAMEPAD_INDEX`](./core.md#max_gamepad_index)). When omitted, adopts the lowest connected index and keeps that slot until its loss is observed, even if a lower index connects later; an explicit slot never falls back. Invalid values throw `RangeError`; a replacement may later reuse the same slot. |
| `moveSpeed` | `number` | `5.0` | Camera movement speed in world units per second at full stick deflection. |
| `lookSpeed` | `number` | `1.0` | Multiplier on look rotation speed (combined with `PointerLockControls.pointerSpeed`). |
| `lookSmoothingHalfLife` | `number` | `undefined` (direct look) | Seconds for the gamepad turn rate to cover half the distance to a steady target. Must be finite and positive. |
| `moveStick` | `GamepadStickBindingOptions` | Left stick + default pipeline | Axes and stateless pipeline for movement. |
| `lookStick` | `GamepadStickBindingOptions` | Right stick + default pipeline | Axes and stateless pipeline for pitch and yaw. |

Each stick binding accepts optional `xAxis`, `yAxis`, and `pipeline` fields. They merge independently with the action default, so a pipeline can be replaced without repeating the default axes. See [Stick Processing](./gamepad-stick-processing.md).

### Smoothing gamepad look

```ts
const gamepadControls = new GamepadPointerLockControls(pointerLockControls, {
  lookSmoothingHalfLife: 0.05,
});
```

Starting from rest, hold the look stick fully right. With this 50 ms half-life, the camera reaches 50% of the requested turn rate after 50 ms and 75% after 100 ms. Returning the stick to neutral stops gamepad rotation on the first update with positive elapsed time. The filter runs after the look stick's pipeline and before look sensitivity. Movement and mouse look respond directly.

Each wrapper keeps its own look history. Pausing the wrapper or disabling the native controls holds that history. On resume, pass the elapsed time for the current frame. An observed disconnection, including a browser event during a pause, clears the history. A replacement gamepad or a new camera assigned to `pointerLockControls.object` starts from rest.

With smoothing enabled, `update(0)` holds the current turn rate. A negative or non-finite frame time or a non-finite processed look component throws `RangeError` before the camera moves. If a stick pipeline disables the controls, changes the camera, or ends the gamepad session during a read, the wrapper skips that frame.

## Properties

`PointerLockControls.enabled = false` blocks both gamepad movement and look. Gamepad input remains independent of `isLocked`; re-enabling the native control does not require pointer lock. See [Native input permissions](./gamepad-controls.md#native-input-permissions).

Inherits all properties from [`GamepadControls`](./gamepad-controls.md#properties).

## Events

Inherits all events from [`GamepadControls`](./gamepad-controls.md#events).

The wrapper dispatches at most one `change` on the native `PointerLockControls` instance after gamepad look changes the camera orientation. Listeners observe the updated quaternion, whether or not the pointer is locked. Floating-point roundoff and equivalent quaternion signs do not count as orientation changes.

Neutral input, zero look speed, and pitch blocked entirely by polar limits do not emit `change`; yaw can still change while pitch is blocked. Translation does not emit `change`, matching the native `moveForward()`/`moveRight()` methods. The wrapper never synthesizes `lock` or `unlock`.

This is a deliberate gamepad adaptation: the native mouse handler can emit `change` even at an angular limit. Mouse and gamepad notifications share the native instance and carry no additional source field. Recursive wrapper updates from its synchronous listeners are ignored.

## Types

| Type | Description |
| --- | --- |
| `GamepadPointerLockControlsOptions` | Type of the `options` parameter accepted by the `GamepadPointerLockControls` constructor. |

## Usage

```ts
import { Timer } from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { GamepadPointerLockControls } from "three-gamepad-controls";

const pointerLockControls = new PointerLockControls(
  camera,
  renderer.domElement,
);
const gamepadPointerLockControls = new GamepadPointerLockControls(
  pointerLockControls,
);

// Pointer lock must be requested from a user activation such as a click.
const requestPointerLock = () => pointerLockControls.lock();
renderer.domElement.addEventListener("click", requestPointerLock);

gamepadPointerLockControls.addEventListener("connected", (event) => {
  console.log("Gamepad connected:", event.gamepad.id);
});

const timer = new Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  // Gamepad look works whether or not the pointer is currently locked.
  gamepadPointerLockControls.update(delta);
  renderer.render(scene, camera);
});

// Clean up when the controls are no longer needed.
renderer.setAnimationLoop(null);
renderer.domElement.removeEventListener("click", requestPointerLock);
gamepadPointerLockControls.dispose();
pointerLockControls.dispose();
timer.dispose();
```
