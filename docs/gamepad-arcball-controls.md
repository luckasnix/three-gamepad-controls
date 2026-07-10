# GamepadArcballControls

A ready-to-use `GamepadControls` subclass that maps gamepad inputs to [Three.js](https://threejs.org) `ArcballControls` - rotation, pan, zoom, z-rotation, and center focus - all driven by analog sticks, triggers, shoulders, and a face button.

Built on top of `GamepadControls`, it inherits the full [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) lifecycle (connect/disconnect events, per-frame polling, and `dispose()`), so you call `gamepadArcballControls.update(delta)` in your render loop.

Unlike [`GamepadTrackballControls`](./gamepad-trackball-controls.md), this wrapper uses Arcball's own transformation helpers and preserves Arcball-specific behavior: focus on the center hit point, z-rotation around the camera view axis, gizmo-aware state, camera distance limits, orthographic zoom limits, and center-based inspection. The wrapped `arcballControls.update()` is only needed after manual camera or target changes, matching native `ArcballControls`.

All bindings and speed multipliers are configurable via the `options` parameter.

## Default Bindings

| Input | Action |
| --- | --- |
| Left stick | Rotate around the Arcball center |
| Right stick | Pan camera and Arcball center |
| Right trigger (analog) | Zoom in |
| Left trigger (analog) | Zoom out |
| Left shoulder / Right shoulder | Z-rotate around the camera view axis |
| South face button | Focus the center hit point |

Every binding is remappable via the `options` parameter.

Center focus uses the wrapped `ArcballControls.scene` raycaster path. It only runs when `scene`, `enablePan`, and `enableFocus` are available and an object is hit at the center of the view.

## Constructor

`new GamepadArcballControls(controls, options?)`

| Parameter | Type | Description |
| --- | --- | --- |
| `controls` | `ArcballControls` | __Required.__ The Three.js `ArcballControls` instance to wrap. |
| `options` | `Partial<GamepadArcballControlsOptions>` | Optional configuration. Any property not provided falls back to its default. |

### `options`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `gamepadIndex` | `number` | `undefined` | Browser-assigned reusable slot (`0` to `2147483647`). When omitted, selects the connected gamepad with the lowest index; an explicit slot never falls back. Invalid values throw `RangeError`; a replacement may later reuse the same slot. |
| `rotateSpeed` | `number` | `1.0` | Multiplier on `ArcballControls.rotateSpeed` for rotation. |
| `panSpeed` | `number` | `1.0` | Multiplier on panning speed. |
| `zoomSpeed` | `number` | `1.0` | Multiplier on zooming speed. |
| `zRotateSpeed` | `number` | `1.0` | Multiplier on z-rotation speed. |
| `deadzone` | `number` | `0.1` | Axis dead zone threshold in the range `[0, 1]`. |
| `axisRotateX` | `number` | `0` | Axis index for horizontal rotation (left stick X). |
| `axisRotateY` | `number` | `1` | Axis index for vertical rotation (left stick Y). |
| `axisPanX` | `number` | `2` | Axis index for horizontal pan (right stick X). |
| `axisPanY` | `number` | `3` | Axis index for vertical pan (right stick Y). |
| `buttonZoomIn` | `number` | `7` | Button index for zoom in - analog trigger value (right trigger). |
| `buttonZoomOut` | `number` | `6` | Button index for zoom out - analog trigger value (left trigger). |
| `buttonZRotateLeft` | `number` | `4` | Button index for counterclockwise z-rotation (left shoulder). |
| `buttonZRotateRight` | `number` | `5` | Button index for clockwise z-rotation (right shoulder). |
| `buttonFocus` | `number` | `0` | Button index for focusing the center hit point (south face button). |

Gamepad input respects `enabled`, `enableRotate`, `enablePan`, `enableZoom`, `enableFocus`, camera distance limits, and orthographic zoom limits because the wrapper applies Arcball's own runtime transformations.

## Properties

Inherits all properties from [`GamepadControls`](./gamepad-controls.md#properties).

## Events

Inherits all events from [`GamepadControls`](./gamepad-controls.md#events).

The wrapped `ArcballControls` instance continues to dispatch its native `start`, `change`, and `end` events when gamepad input transforms the camera.

## Types

| Type | Description |
| --- | --- |
| `GamepadArcballControlsOptions` | Type of the `options` parameter accepted by the `GamepadArcballControls` constructor. |

## Usage

```ts
import { Timer } from "three";
import { ArcballControls } from "three/addons/controls/ArcballControls.js";
import { GamepadArcballControls } from "three-gamepad-controls";

const arcballControls = new ArcballControls(
  camera,
  renderer.domElement,
  scene,
);
const gamepadArcballControls = new GamepadArcballControls(arcballControls);

arcballControls.addEventListener("change", () => {
  renderer.render(scene, camera);
});

gamepadArcballControls.addEventListener("connected", (event) => {
  console.log("Gamepad connected:", event.gamepad.id);
});

const timer = new Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  // Read gamepad input and apply Arcball transforms.
  gamepadArcballControls.update(delta);
  renderer.render(scene, camera);
});

// Synchronize ArcballControls after manual camera or target changes.
arcballControls.update();

// Clean up when the controls are no longer needed.
renderer.setAnimationLoop(null);
gamepadArcballControls.dispose();
arcballControls.dispose();
timer.dispose();
```
