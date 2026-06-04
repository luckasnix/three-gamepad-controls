# GamepadPointerLockControls

A ready-to-use `GamepadControls` subclass that maps gamepad inputs to [Three.js](https://threejs.org) `PointerLockControls` — camera movement and look — all driven by analog sticks.

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
| `moveSpeed` | `number` | `5.0` | Camera movement speed in world units per second at full stick deflection. |
| `lookSpeed` | `number` | `1.0` | Multiplier on look rotation speed (combined with `PointerLockControls.pointerSpeed`). |
| `deadzone` | `number` | `0.1` | Axis dead zone threshold in the range `[0, 1]`. |
| `axisMoveForward` | `number` | `1` | Axis index for forward / backward movement (left stick Y). |
| `axisMoveRight` | `number` | `0` | Axis index for left / right strafe movement (left stick X). |
| `axisLookX` | `number` | `2` | Axis index for horizontal look — yaw (right stick X). |
| `axisLookY` | `number` | `3` | Axis index for vertical look — pitch (right stick Y). |

## Properties

Inherits all properties from [`GamepadControls`](./gamepad-controls.md#properties).

## Events

Inherits all events from [`GamepadControls`](./gamepad-controls.md#events).

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

gamepadPointerLockControls.addEventListener("connected", (event) => {
  console.log("Gamepad connected:", event.gamepad.id);
});

const timer = new Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  gamepadPointerLockControls.update(delta);
  renderer.render(scene, camera);
});

// When done:
gamepadPointerLockControls.dispose();
```
