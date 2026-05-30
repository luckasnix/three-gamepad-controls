# GamepadOrbitControls

A ready-to-use `GamepadControls` subclass that maps gamepad inputs to [Three.js](https://threejs.org) `OrbitControls` — orbit, pan, and dolly — all driven by analog sticks and triggers.

Built on top of `GamepadControls`, it inherits the full [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) lifecycle (connect/disconnect events, per-frame polling, and `dispose()`), so you only need to instantiate it and drop `update()` into your render loop.

All bindings and speed multipliers are configurable via the `options` parameter.

## Default Bindings

| Input | Action |
| --- | --- |
| Left stick X / Left stick Y | Orbit (rotate around target) |
| Right stick X / Right stick Y | Pan (translate camera + target) |
| Left trigger (analog) | Zoom in (dolly in) |
| Right trigger (analog) | Zoom out (dolly out) |

Every binding is remappable via the `options` parameter.

## Constructor

`new GamepadOrbitControls(controls, options?)`

| Parameter | Type | Description |
| --- | --- | --- |
| `controls` | `OrbitControls` | __Required.__ The Three.js `OrbitControls` instance to wrap. |
| `options` | `Partial<GamepadOrbitControlsOptions>` | Any property not provided falls back to its default. |

### `options`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `rotateSpeed` | `number` | `1.0` | Multiplier on orbit rotation speed. |
| `panSpeed` | `number` | `1.0` | Multiplier on pan speed. |
| `zoomSpeed` | `number` | `1.0` | Multiplier on zoom (dolly) speed. |
| `deadzone` | `number` | `0.1` | Axis dead zone threshold in the range `[0, 1]`. |
| `axisRotateX` | `number` | `0` | Axis index for horizontal orbit (left stick X). |
| `axisRotateY` | `number` | `1` | Axis index for vertical orbit (left stick Y). |
| `axisPanX` | `number` | `2` | Axis index for horizontal pan (right stick X). |
| `axisPanY` | `number` | `3` | Axis index for vertical pan (right stick Y). |
| `buttonDollyIn` | `number` | `6` | Button index for zoom in — analog trigger value (left trigger). |
| `buttonDollyOut` | `number` | `7` | Button index for zoom out — analog trigger value (right trigger). |

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
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Timer, WebGPURenderer } from "three/webgpu";
import { GamepadOrbitControls } from "three-gamepad-controls";

const renderer = new WebGPURenderer();

const orbitControls = new OrbitControls(camera, renderer.domElement);
const gamepadOrbitControls = new GamepadOrbitControls(orbitControls);

gamepadOrbitControls.addEventListener("connected", (event) => {
  console.log("Gamepad connected:", event.gamepad.id);
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
