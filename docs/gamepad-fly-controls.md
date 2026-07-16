# GamepadFlyControls

A ready-to-use `GamepadControls` subclass that maps gamepad inputs to [Three.js FlyControls](https://threejs.org/docs/#FlyControls) — full 6DOF movement and rotation — all driven by analog sticks, triggers, and shoulder buttons.

Built on top of `GamepadControls`, it inherits the full [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) lifecycle (connect/disconnect events, per-frame polling, and `dispose()`), so you only need to instantiate it and drop `update()` into your render loop. Gamepad input is additive with keyboard/mouse input — both sources work simultaneously.

All bindings and speeds are configurable via the `options` parameter.

## Default Bindings

| Input | Action |
| --- | --- |
| Left stick | Move forward / backward / strafe |
| Left trigger (analog) | Move up |
| Right trigger (analog) | Move down |
| Right stick | Look (yaw and pitch) |
| Left shoulder | Roll left |
| Right shoulder | Roll right |

Every binding is remappable via the `options` parameter.

## Constructor

`new GamepadFlyControls(controls, options?)`

| Parameter | Type | Description |
| --- | --- | --- |
| `controls` | `FlyControls` | __Required.__ The Three.js `FlyControls` instance to wrap. |
| `options` | `Partial<GamepadFlyControlsOptions>` | Optional configuration. Any property not provided falls back to its default. |

### `options`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `gamepadIndex` | `number` | `undefined` | Browser-assigned reusable slot ([`MIN_GAMEPAD_INDEX`](./core.md#min_gamepad_index) to [`MAX_GAMEPAD_INDEX`](./core.md#max_gamepad_index)). When omitted, selects the connected gamepad with the lowest index; an explicit slot never falls back. Invalid values throw `RangeError`; a replacement may later reuse the same slot. |
| `moveSpeed` | `number` | `1.0` | Multiplier on `FlyControls.movementSpeed` for translation. |
| `rotateSpeed` | `number` | `1.0` | Multiplier on `FlyControls.rollSpeed` for rotation. |
| `deadzone` | `number` | `0.1` | Axis dead zone threshold in the range `[0, 1]`. |
| `axisMoveForward` | `number` | `1` | Axis index for forward / backward movement (left stick Y). |
| `axisMoveRight` | `number` | `0` | Axis index for left / right strafe movement (left stick X). |
| `axisLookX` | `number` | `2` | Axis index for horizontal look — yaw (right stick X). |
| `axisLookY` | `number` | `3` | Axis index for vertical look — pitch (right stick Y). |
| `buttonRollLeft` | `number` | `4` | Button index for roll left (left shoulder). |
| `buttonRollRight` | `number` | `5` | Button index for roll right (right shoulder). |
| `buttonMoveUp` | `number` | `6` | Button index for move up — analog trigger value (left trigger). |
| `buttonMoveDown` | `number` | `7` | Button index for move down — analog trigger value (right trigger). |

`moveSpeed` and `rotateSpeed` multiply `FlyControls`' own `movementSpeed` and `rollSpeed`, so adjusting those properties affects both input sources at once. Use the options to fine-tune the gamepad feel independently.

## Properties

Inherits all properties from [`GamepadControls`](./gamepad-controls.md#properties).

## Events

Inherits all events from [`GamepadControls`](./gamepad-controls.md#events).

## Types

| Type | Description |
| --- | --- |
| `GamepadFlyControlsOptions` | Type of the `options` parameter accepted by the `GamepadFlyControls` constructor. |

## Usage

```ts
import { Timer } from "three";
import { FlyControls } from "three/addons/controls/FlyControls.js";
import { GamepadFlyControls } from "three-gamepad-controls";

const flyControls = new FlyControls(camera, renderer.domElement);
flyControls.movementSpeed = 10;
flyControls.rollSpeed = Math.PI / 6;
const gamepadFlyControls = new GamepadFlyControls(flyControls);

gamepadFlyControls.addEventListener("connected", (event) => {
  console.log("Gamepad connected:", event.gamepad.id);
});

const timer = new Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  // Apply gamepad translation and rotation first.
  gamepadFlyControls.update(delta);
  // Then let FlyControls apply keyboard and mouse input.
  flyControls.update(delta);
  renderer.render(scene, camera);
});

// Clean up when the controls are no longer needed.
renderer.setAnimationLoop(null);
gamepadFlyControls.dispose();
flyControls.dispose();
timer.dispose();
```
