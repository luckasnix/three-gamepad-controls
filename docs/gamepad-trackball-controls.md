# GamepadTrackballControls

A ready-to-use `GamepadControls` subclass that maps gamepad inputs to [Three.js](https://threejs.org) `TrackballControls` - rotation, pan, and zoom - all driven by analog sticks and triggers.

Built on top of `GamepadControls`, it inherits the full [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) lifecycle (connect/disconnect events, per-frame polling, and `dispose()`), so you only need to instantiate it and drop `update()` into your render loop.

Compared to [`GamepadOrbitControls`](./gamepad-orbit-controls.md), trackball rotation does not preserve a constant camera `up` vector. This matches `TrackballControls` behavior and allows free rotation over the top and bottom poles without flipping the camera upright.

All bindings and speed multipliers are configurable via the `options` parameter.

## Default Bindings

| Input | Action |
| --- | --- |
| Left stick | Rotate around target |
| Right stick | Pan (translate camera + target) |
| Right trigger (analog) | Zoom in |
| Left trigger (analog) | Zoom out |

Every binding is remappable via the `options` parameter.

## Constructor

`new GamepadTrackballControls(controls, options?)`

| Parameter | Type | Description |
| --- | --- | --- |
| `controls` | `TrackballControls` | __Required.__ The Three.js `TrackballControls` instance to wrap. |
| `options` | `Partial<GamepadTrackballControlsOptions>` | Optional configuration. Any property not provided falls back to its default. |

### `options`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `rotateSpeed` | `number` | `1.0` | Multiplier on `TrackballControls.rotateSpeed` for rotation. |
| `panSpeed` | `number` | `1.0` | Multiplier on `TrackballControls.panSpeed` for panning. |
| `zoomSpeed` | `number` | `1.0` | Multiplier on `TrackballControls.zoomSpeed` for zooming. |
| `deadzone` | `number` | `0.1` | Axis dead zone threshold in the range `[0, 1]`. |
| `axisRotateX` | `number` | `0` | Axis index for horizontal rotation (left stick X). |
| `axisRotateY` | `number` | `1` | Axis index for vertical rotation (left stick Y). |
| `axisPanX` | `number` | `2` | Axis index for horizontal pan (right stick X). |
| `axisPanY` | `number` | `3` | Axis index for vertical pan (right stick Y). |
| `buttonZoomIn` | `number` | `7` | Button index for zoom in - analog trigger value (right trigger). |
| `buttonZoomOut` | `number` | `6` | Button index for zoom out - analog trigger value (left trigger). |

`rotateSpeed`, `panSpeed`, and `zoomSpeed` multiply `TrackballControls`' own speed properties, so adjusting those properties affects both input sources at once. Gamepad input respects `noRotate`, `noPan`, `noZoom`, `staticMoving`, `dynamicDampingFactor`, camera distance limits, and orthographic zoom limits because the native `TrackballControls.update()` still applies the queued movement.

When `staticMoving` is `false`, queued gamepad pan and zoom input is scaled by `dynamicDampingFactor`. `TrackballControls` applies the remaining queued delta over multiple frames, so this compensation prevents damping from multiplying the total gamepad movement. The damping factor still controls how long the inertial tail lasts; setting `staticMoving` to `true` continues to consume each queued delta immediately.

## Properties

Inherits all properties from [`GamepadControls`](./gamepad-controls.md#properties).

## Events

Inherits all events from [`GamepadControls`](./gamepad-controls.md#events).

## Types

| Type | Description |
| --- | --- |
| `GamepadTrackballControlsOptions` | Type of the `options` parameter accepted by the `GamepadTrackballControls` constructor. |

## Usage

```ts
import { Timer } from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { GamepadTrackballControls } from "three-gamepad-controls";

const trackballControls = new TrackballControls(camera, renderer.domElement);
const gamepadTrackballControls = new GamepadTrackballControls(
  trackballControls,
);

gamepadTrackballControls.addEventListener("connected", (event) => {
  console.log("Gamepad connected:", event.gamepad.id);
});

const timer = new Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  gamepadTrackballControls.update(delta); // 1. read gamepad -> queue deltas
  trackballControls.update();             // 2. apply damping + flush queued deltas
  renderer.render(scene, camera);
});

// When done:
gamepadTrackballControls.dispose();
```
