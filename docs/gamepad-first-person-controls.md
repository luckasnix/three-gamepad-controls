# GamepadFirstPersonControls

A ready-to-use `GamepadControls` subclass that maps gamepad inputs to [Three.js](https://threejs.org) `FirstPersonControls` - first-person movement and camera look - all driven by analog sticks and triggers.

Built on top of `GamepadControls`, it inherits the full [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) lifecycle (connect/disconnect events, per-frame polling, and `dispose()`), so you only need to instantiate it and drop `update()` into your render loop. Gamepad input is additive with keyboard/mouse input - both sources work simultaneously.

All bindings and speeds are configurable via the `options` parameter.

## Default Bindings

| Input | Action |
| --- | --- |
| Left stick | Move forward / backward / strafe |
| Left trigger (analog) | Move up |
| Right trigger (analog) | Move down |
| Right stick | Look (yaw and pitch) |

Every binding is remappable via the `options` parameter.

## Constructor

`new GamepadFirstPersonControls(controls, options?)`

| Parameter | Type | Description |
| --- | --- | --- |
| `controls` | `FirstPersonControls` | __Required.__ The Three.js `FirstPersonControls` instance to wrap. |
| `options` | `Partial<GamepadFirstPersonControlsOptions>` | Optional configuration. Any property not provided falls back to its default. |

### `options`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `gamepadIndex` | `number` | `undefined` | Browser-assigned reusable slot (`0` to `2147483647`). When omitted, selects the connected gamepad with the lowest index; an explicit slot never falls back. Invalid values throw `RangeError`; a replacement may later reuse the same slot. |
| `moveSpeed` | `number` | `1.0` | Multiplier on `FirstPersonControls.movementSpeed` for translation. |
| `lookSpeed` | `number` | `1.0` | Multiplier on `FirstPersonControls.lookSpeed` for camera look. |
| `deadzone` | `number` | `0.1` | Axis dead zone threshold in the range `[0, 1]`. |
| `axisMoveForward` | `number` | `1` | Axis index for forward / backward movement (left stick Y). |
| `axisMoveRight` | `number` | `0` | Axis index for left / right strafe movement (left stick X). |
| `axisLookX` | `number` | `2` | Axis index for horizontal look - yaw (right stick X). |
| `axisLookY` | `number` | `3` | Axis index for vertical look - pitch (right stick Y). |
| `buttonMoveUp` | `number` | `6` | Button index for move up - analog trigger value (left trigger). |
| `buttonMoveDown` | `number` | `7` | Button index for move down - analog trigger value (right trigger). |

`moveSpeed` and `lookSpeed` multiply `FirstPersonControls`' own `movementSpeed` and `lookSpeed`, so adjusting those properties affects both input sources at once. Gamepad look respects `lookVertical`, and forward movement respects `heightSpeed`, `heightCoef`, `heightMin`, and `heightMax`.

## Properties

Inherits all properties from [`GamepadControls`](./gamepad-controls.md#properties).

## Events

Inherits all events from [`GamepadControls`](./gamepad-controls.md#events).

## Types

| Type | Description |
| --- | --- |
| `GamepadFirstPersonControlsOptions` | Type of the `options` parameter accepted by the `GamepadFirstPersonControls` constructor. |

## Usage

```ts
import { Timer } from "three";
import { FirstPersonControls } from "three/addons/controls/FirstPersonControls.js";
import { GamepadFirstPersonControls } from "three-gamepad-controls";

const firstPersonControls = new FirstPersonControls(
  camera,
  renderer.domElement,
);
firstPersonControls.movementSpeed = 5;
firstPersonControls.lookSpeed = 0.005;
const gamepadFirstPersonControls = new GamepadFirstPersonControls(
  firstPersonControls,
);

gamepadFirstPersonControls.addEventListener("connected", (event) => {
  console.log("Gamepad connected:", event.gamepad.id);
});

const timer = new Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  // Apply gamepad movement and synchronize the native look state first.
  gamepadFirstPersonControls.update(delta);
  // Then let FirstPersonControls apply keyboard and mouse input.
  firstPersonControls.update(delta);
  renderer.render(scene, camera);
});

// Clean up when the controls are no longer needed.
renderer.setAnimationLoop(null);
gamepadFirstPersonControls.dispose();
firstPersonControls.dispose();
timer.dispose();
```
