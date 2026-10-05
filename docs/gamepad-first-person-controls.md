# GamepadFirstPersonControls

A ready-to-use `GamepadControls` subclass that maps gamepad inputs to [Three.js FirstPersonControls](https://threejs.org/docs/#FirstPersonControls) - first-person movement and camera look - all driven by analog sticks and triggers.

Built on top of `GamepadControls`, it inherits the full [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) lifecycle (connect/disconnect events, per-frame polling, and `dispose()`), so you only need to instantiate it and drop `update()` into your render loop. Gamepad input is additive with keyboard/mouse input - both sources work simultaneously.

All bindings and speeds are configurable via the `options` parameter.

## Default Bindings

| Input | Action |
| --- | --- |
| Left stick | Move forward / backward / strafe in the XZ plane |
| Left trigger (analog) | Move up along Y |
| Right trigger (analog) | Move down along Y |
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
| `gamepadIndex` | `number` | `undefined` | Browser-assigned reusable slot ([`MIN_GAMEPAD_INDEX`](./core.md#min_gamepad_index) to [`MAX_GAMEPAD_INDEX`](./core.md#max_gamepad_index)). When omitted, adopts the lowest connected index and keeps that slot until its loss is observed, even if a lower index connects later; an explicit slot never falls back. Invalid values throw `RangeError`; a replacement may later reuse the same slot. |
| `moveSpeed` | `number` | `1.0` | Multiplier on `FirstPersonControls.movementSpeed` for translation, applied after combined movement normalization. |
| `lookSpeed` | `number` | `1.0` | Multiplier on `FirstPersonControls.lookSpeed` for camera look. |
| `moveStick` | `GamepadStickBindingOptions` | Left stick + default pipeline | Axes and stateless pipeline for yaw-based movement in XZ. |
| `lookStick` | `GamepadStickBindingOptions` | Right stick + default pipeline | Axes and stateless pipeline for camera look. |
| `buttonDeadzone` | `number` | `0.1` | Dead zone threshold for the analog movement buttons. |
| `buttonMoveUp` | `number` | `6` | Button index for moving up along Y - analog trigger value (left trigger). |
| `buttonMoveDown` | `number` | `7` | Button index for moving down along Y - analog trigger value (right trigger). |

`moveSpeed` and `lookSpeed` multiply `FirstPersonControls`' own `movementSpeed` and `lookSpeed`, so adjusting those properties affects both input sources at once. Gamepad look respects `lookVertical`, and forward movement respects `heightSpeed`, `heightCoef`, `heightMin`, and `heightMax`.

Each stick binding accepts optional `xAxis`, `yAxis`, and `pipeline` fields. They merge independently with the action default, so `{ lookStick: { pipeline } }` keeps the right-stick axes. Pipelines do not affect the scalar trigger actions. See [Stick Processing](./gamepad-stick-processing.md).

## Movement and native input

Stick movement follows the native W/S/A/D keyboard frame: forward, backward, and strafe use the yaw stored by `FirstPersonControls` in the XZ plane. Triggers follow its R/F climb direction along Y. With an untransformed camera parent, these are world XZ and world Y. Camera pitch and roll do not tilt the movement axes. Like the native keyboard implementation, the wrapper adds these deltas directly to `controls.object.position`; it does not convert them through a transformed camera parent.

Each trigger must be strictly above `buttonDeadzone` before the filtered values are subtracted, so equal active triggers cancel. The wrapper then combines the processed stick's strafe and forward/backward values with the resulting climb value. When this three-component intention has magnitude greater than `1`, all components are divided by that magnitude, preserving direction. Intentions with magnitude at or below `1` retain their partial analog intensity. This normalization also applies to custom movement pipeline output and leaves the pipeline's result unchanged.

For example, full forward movement combined with full climb uses `1 / Math.sqrt(2)` for each component; full strafe, forward and climb use `1 / Math.sqrt(3)` each. With unit speeds, `heightSpeed` disabled and a one-second delta, both combinations move a total distance of `1`. Combining three values of `0.5` leaves each value at `0.5`.

`delta`, `movementSpeed`, and `moveSpeed` are applied after normalization. Forward movement also applies `heightSpeed` using the frame's initial Y position, clamped between `heightMin` and `heightMax`, before any trigger climb. This height gain uses the normalized forward value and `moveSpeed` and does not apply to backward movement, strafe, or climb. Speed and height gains can increase the final displacement beyond unit length; the unit limit applies to the input intention.

Movement is applied before gamepad look, using the yaw at the start of the frame. Keep calling `gamepadControls.update(delta)` before `controls.update(delta)`: native keyboard and pointer input remain additive, with pointer movement retaining its own direction along the full camera look vector. The wrapper normalizes only gamepad movement; it does not normalize the sum with native input or change native movement state.

Gamepad translation and look are applied immediately. The native `dampingFactor` does not currently apply to the gamepad contribution. Native `autoForward` remains a separate contribution; analog gamepad retreat does not suppress it. Configure the movement stick pipeline when a different stick response is needed; its output is still subject to the combined movement normalization above.

## Properties

`FirstPersonControls.enabled = false` blocks all new gamepad movement and look while the wrapper continues polling. Pausing only the wrapper leaves the native keyboard/mouse behavior independent. See [Native input permissions](./gamepad-controls.md#native-input-permissions).

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
