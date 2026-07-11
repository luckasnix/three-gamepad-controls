# GamepadMapControls

A ready-to-use `GamepadControls` subclass that maps gamepad inputs to [Three.js MapControls](https://threejs.org/docs/#MapControls) — orbit, pan, and dolly — designed for bird's-eye map navigation where **pan is the primary action**.

Built on top of `GamepadControls`, it inherits the full [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) lifecycle (connect/disconnect events, per-frame polling, and `dispose()`), so you only need to instantiate it and drop `update()` into your render loop.

Compared to [`GamepadOrbitControls`](./gamepad-orbit-controls.md), the left and right stick assignments are swapped: left stick pans the map and right stick orbits. This matches the `MapControls` mouse conventions (`LEFT = PAN`, `RIGHT = ROTATE`). Note that `MapControls` pans in world space (orthogonal to `camera.up`) rather than screen space.

All bindings and speed multipliers are configurable via the `options` parameter.

## Default Bindings

| Input | Action |
| --- | --- |
| Left stick | Pan (translate camera + target) |
| Right stick | Orbit (rotate around target) |
| Left trigger (analog) | Zoom out (dolly out) |
| Right trigger (analog) | Zoom in (dolly in) |

Every binding is remappable via the `options` parameter.

## Constructor

`new GamepadMapControls(controls, options?)`

| Parameter | Type | Description |
| --- | --- | --- |
| `controls` | `MapControls` | __Required.__ The Three.js `MapControls` instance to wrap. |
| `options` | `Partial<GamepadOrbitControlsOptions>` | Optional configuration. Any property not provided falls back to its default. |

### `options`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `gamepadIndex` | `number` | `undefined` | Browser-assigned reusable slot (`0` to `2147483647`). When omitted, selects the connected gamepad with the lowest index; an explicit slot never falls back. Invalid values throw `RangeError`; a replacement may later reuse the same slot. |
| `rotateSpeed` | `number` | `1.0` | Multiplier on orbit rotation speed. |
| `panSpeed` | `number` | `1.0` | Multiplier on pan speed. |
| `zoomSpeed` | `number` | `1.0` | Multiplier on zoom (dolly) speed. |
| `deadzone` | `number` | `0.1` | Axis dead zone threshold in the range `[0, 1]`. |
| `axisPanX` | `number` | `0` | Axis index for horizontal pan (left stick X). |
| `axisPanY` | `number` | `1` | Axis index for vertical pan (left stick Y). |
| `axisRotateX` | `number` | `2` | Axis index for horizontal orbit (right stick X). |
| `axisRotateY` | `number` | `3` | Axis index for vertical orbit (right stick Y). |
| `buttonDollyIn` | `number` | `7` | Button index for zoom in — analog trigger value (right trigger). |
| `buttonDollyOut` | `number` | `6` | Button index for zoom out — analog trigger value (left trigger). |

## Properties

Inherits all properties from [`GamepadControls`](./gamepad-controls.md#properties).

## Events

Inherits all events from [`GamepadControls`](./gamepad-controls.md#events).

## Types

| Type | Description |
| --- | --- |
| `GamepadOrbitControlsOptions` | Type of the `options` parameter. Shared with [`GamepadOrbitControls`](./gamepad-orbit-controls.md). |

## Usage

```ts
import { Timer } from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { GamepadMapControls } from "three-gamepad-controls";

const mapControls = new MapControls(camera, renderer.domElement);
const gamepadMapControls = new GamepadMapControls(mapControls);

gamepadMapControls.addEventListener("connected", (event) => {
  console.log("Gamepad connected:", event.gamepad.id);
});

const timer = new Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  // Queue gamepad deltas before MapControls applies them.
  gamepadMapControls.update(delta);
  // Apply damping and flush the queued deltas.
  mapControls.update(delta);
  renderer.render(scene, camera);
});

// Clean up when the controls are no longer needed.
renderer.setAnimationLoop(null);
gamepadMapControls.dispose();
mapControls.dispose();
timer.dispose();
```
