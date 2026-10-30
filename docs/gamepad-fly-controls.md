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
| `gamepadIndex` | `number` | `undefined` | Browser-assigned reusable slot ([`MIN_GAMEPAD_INDEX`](./core.md#min_gamepad_index) to [`MAX_GAMEPAD_INDEX`](./core.md#max_gamepad_index)). When omitted, adopts the lowest connected index and keeps that slot until its loss is observed, even if a lower index connects later; an explicit slot never falls back. Invalid values throw `RangeError`; a replacement may later reuse the same slot. |
| `moveSpeed` | `number` | `1.0` | Multiplier on `FlyControls.movementSpeed` for translation. |
| `rotateSpeed` | `number` | `1.0` | Multiplier on `FlyControls.rollSpeed` for rotation. |
| `moveStick` | `GamepadStickBindingOptions` | Left stick + default pipeline | Axes and stateless pipeline for movement. |
| `lookStick` | `GamepadStickBindingOptions` | Right stick + default pipeline | Axes and stateless pipeline for pitch and yaw. |
| `buttonDeadzone` | `number` | `0.1` | Dead zone threshold for the analog movement buttons. |
| `buttonRollLeft` | `number` | `4` | Button index for roll left (left shoulder). |
| `buttonRollRight` | `number` | `5` | Button index for roll right (right shoulder). |
| `buttonMoveUp` | `number` | `6` | Button index for move up — analog trigger value (left trigger). |
| `buttonMoveDown` | `number` | `7` | Button index for move down — analog trigger value (right trigger). |

`moveSpeed` and `rotateSpeed` multiply `FlyControls`' own `movementSpeed` and `rollSpeed`, so adjusting those properties affects both input sources at once. Use the options to fine-tune the gamepad feel independently.

Each stick binding accepts optional `xAxis`, `yAxis`, and `pipeline` fields. They merge independently with the action default, so `{ moveStick: { xAxis } }` keeps the default Y axis and pipeline. Pipelines do not affect triggers, roll buttons, or vertical movement. See [Stick Processing](./gamepad-stick-processing.md).

## Properties

`FlyControls.enabled = false` blocks gamepad translation, look, and roll while the wrapper continues polling. Pausing only the wrapper leaves the native keyboard/mouse behavior independent. See [Native input permissions](./gamepad-controls.md#native-input-permissions).

Inherits all properties from [`GamepadControls`](./gamepad-controls.md#properties).

## Auto-forward and Input Composition

Call `gamepadFlyControls.update(delta)` **before** `flyControls.update(delta)` with the same frame delta. The wrapper applies gamepad movement and rotation, then the native update adds keyboard/mouse input and publishes its `change` event with the final position and orientation.

With `autoForward` enabled, an applied backward gamepad displacement suppresses only the automatic forward contribution in the next native update. Partial stick deflection produces proportional backward movement. Manual forward and backward commands still add their native contribution, so holding the forward key can oppose gamepad backward movement. The wrapper never changes `autoForward` or clears keyboard/mouse state.

Backward movement is determined after the movement pipeline and speed multipliers. Deadzone input, a pipeline that produces zero movement, zero movement gain, zero native movement speed, and zero delta do not request suppression. Strafe, vertical movement, look, and roll alone keep automatic forward movement active. The native initialization rules still apply: assigning `autoForward` alone may leave its cached movement vector unchanged until a native keyboard or pointer event refreshes it.

Suppression is consumed by one native update. Neutral input, wrapper pause (including frames that call only the native update), native disable, observed gamepad disconnection, and `dispose()` leave no pending suppression. Paused polling cannot observe a polling-only disconnection until updates resume; browser disconnection events remain active. If the native destination changes between updates, the pending suppression does not transfer to the new object.

The wrapper installs an update adapter on its native instance and restores the original method on `dispose()` if the application has not replaced it. Later application method replacements are preserved. The wrapper does not dispose the native control. Applications sharing a native control or destination must coordinate their updates. Recursive wrapper updates from pipelines or native `change` listeners, and recursive calls through the native adapter, are ignored.

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
  // Then apply native input and publish the final change event.
  flyControls.update(delta);
  renderer.render(scene, camera);
});

// Clean up when the controls are no longer needed.
renderer.setAnimationLoop(null);
gamepadFlyControls.dispose();
flyControls.dispose();
timer.dispose();
```
