# GamepadOrbitControls

A ready-to-use `GamepadControls` subclass that maps gamepad inputs to [Three.js OrbitControls](https://threejs.org/docs/#OrbitControls) — orbit, pan, and dolly — all driven by analog sticks and triggers.

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
| `gamepadIndex` | `number` | `undefined` | Browser-assigned reusable slot ([`MIN_GAMEPAD_INDEX`](./core.md#min_gamepad_index) to [`MAX_GAMEPAD_INDEX`](./core.md#max_gamepad_index)). When omitted, selects the connected gamepad with the lowest index; an explicit slot never falls back. Invalid values throw `RangeError`; a replacement may later reuse the same slot. |
| `rotateSpeed` | `number` | `1.0` | Multiplier on orbit rotation speed. |
| `panSpeed` | `number` | `1.0` | Multiplier on pan speed. |
| `zoomSpeed` | `number` | `1.0` | Multiplier on zoom (dolly) speed. |
| `rotateStick` | `GamepadStickBindingOptions` | Left stick + default pipeline | Axes and stateless pipeline for orbit rotation. |
| `panStick` | `GamepadStickBindingOptions` | Right stick + default pipeline | Axes and stateless pipeline for panning. |
| `buttonDeadzone` | `number` | `0.1` | Dead zone threshold for analog dolly triggers. |
| `buttonDollyIn` | `number` | `7` | Button index for zoom in — analog trigger value (right trigger). |
| `buttonDollyOut` | `number` | `6` | Button index for zoom out — analog trigger value (left trigger). |

Each stick binding accepts optional `xAxis`, `yAxis`, and `pipeline` fields and merges them independently with the action default. Stick pipelines do not process the dolly triggers; configure their scalar threshold with `buttonDeadzone`. See [Stick Processing](./gamepad-stick-processing.md).

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
