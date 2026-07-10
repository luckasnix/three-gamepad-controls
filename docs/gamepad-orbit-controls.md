# GamepadOrbitControls

A ready-to-use `GamepadControls` subclass that maps gamepad inputs to [Three.js](https://threejs.org) `OrbitControls` — orbit, pan, and dolly — all driven by analog sticks and triggers.

Built on top of `GamepadControls`, it inherits the full [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) lifecycle (connect/disconnect events, per-frame polling, and `dispose()`), so you only need to instantiate it and drop `update()` into your render loop.

All bindings and speed multipliers are configurable via the `options` parameter.

## Default Bindings

| Input | Action |
| --- | --- |
| Left stick | Orbit (rotate around target) |
| Right stick | Pan (translate camera + target) |
| Left trigger (analog) | Zoom out (dolly out) |
| Right trigger (analog) | Zoom in (dolly in) |

Every binding is remappable via the `options` parameter.

## Constructor

`new GamepadOrbitControls(controls, options?)`

| Parameter | Type | Description |
| --- | --- | --- |
| `controls` | `OrbitControls` | __Required.__ The Three.js `OrbitControls` instance to wrap. |
| `options` | `Partial<GamepadOrbitControlsOptions>` | Optional configuration. Any property not provided falls back to its default. |

### `options`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `gamepadIndex` | `number` | `undefined` | Browser-assigned reusable slot (`0` to `2147483647`). When omitted, selects the connected gamepad with the lowest index; an explicit slot never falls back. Invalid values throw `RangeError`; a replacement may later reuse the same slot. |
| `rotateSpeed` | `number` | `1.0` | Multiplier on orbit rotation speed. |
| `panSpeed` | `number` | `1.0` | Multiplier on pan speed. |
| `zoomSpeed` | `number` | `1.0` | Multiplier on zoom (dolly) speed. |
| `deadzone` | `number` | `0.1` | Axis dead zone threshold in the range `[0, 1]`. |
| `axisRotateX` | `number` | `0` | Axis index for horizontal orbit (left stick X). |
| `axisRotateY` | `number` | `1` | Axis index for vertical orbit (left stick Y). |
| `axisPanX` | `number` | `2` | Axis index for horizontal pan (right stick X). |
| `axisPanY` | `number` | `3` | Axis index for vertical pan (right stick Y). |
| `buttonDollyIn` | `number` | `7` | Button index for zoom in — analog trigger value (right trigger). |
| `buttonDollyOut` | `number` | `6` | Button index for zoom out — analog trigger value (left trigger). |

## Properties

Inherits all properties from [`GamepadControls`](./gamepad-controls.md#properties).

## Events

Inherits all events from [`GamepadControls`](./gamepad-controls.md#events).

## Types

| Type | Description |
| --- | --- |
| `GamepadOrbitControlsOptions` | Type of the `options` parameter accepted by the `GamepadOrbitControls` constructor. |

## Usage

```ts
import { Timer } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GamepadOrbitControls } from "three-gamepad-controls";

const orbitControls = new OrbitControls(camera, renderer.domElement);
const gamepadOrbitControls = new GamepadOrbitControls(orbitControls);

gamepadOrbitControls.addEventListener("connected", (event) => {
  console.log("Gamepad connected:", event.gamepad.id);
});

const timer = new Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  // Queue gamepad deltas before OrbitControls applies them.
  gamepadOrbitControls.update(delta);
  // Apply damping and flush the queued deltas.
  orbitControls.update(delta);
  renderer.render(scene, camera);
});

// Clean up when the controls are no longer needed.
renderer.setAnimationLoop(null);
gamepadOrbitControls.dispose();
orbitControls.dispose();
timer.dispose();
```
