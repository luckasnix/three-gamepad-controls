# GamepadTrackballControls

A ready-to-use `GamepadControls` subclass that maps gamepad inputs to [Three.js TrackballControls](https://threejs.org/docs/#TrackballControls) - rotation, pan, and zoom - all driven by analog sticks and triggers.

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
| `gamepadIndex` | `number` | `undefined` | Browser-assigned reusable slot ([`MIN_GAMEPAD_INDEX`](./core.md#min_gamepad_index) to [`MAX_GAMEPAD_INDEX`](./core.md#max_gamepad_index)). When omitted, adopts the lowest connected index and keeps that slot until its loss is observed, even if a lower index connects later; an explicit slot never falls back. Invalid values throw `RangeError`; a replacement may later reuse the same slot. |
| `rotateSpeed` | `number` | `1.0` | Multiplier on `TrackballControls.rotateSpeed` for rotation. |
| `panSpeed` | `number` | `1.0` | Multiplier on `TrackballControls.panSpeed` for panning. |
| `zoomSpeed` | `number` | `1.0` | Multiplier on `TrackballControls.zoomSpeed` for zooming. |
| `rotateStick` | `GamepadStickBindingOptions` | Left stick + default pipeline | Axes and stateless pipeline for rotation. |
| `panStick` | `GamepadStickBindingOptions` | Right stick + default pipeline | Axes and stateless pipeline for panning. |
| `buttonDeadzone` | `number` | `0.1` | Dead zone threshold for analog zoom triggers. |
| `buttonZoomIn` | `number` | `7` | Button index for zoom in - analog trigger value (right trigger). |
| `buttonZoomOut` | `number` | `6` | Button index for zoom out - analog trigger value (left trigger). |

`rotateSpeed`, `panSpeed`, and `zoomSpeed` multiply `TrackballControls`' own speed properties, so adjusting those properties affects both input sources at once. Gamepad input respects `noRotate`, `noPan`, `noZoom`, `staticMoving`, `dynamicDampingFactor`, camera distance limits, and orthographic zoom limits because the native `TrackballControls.update()` still applies the queued movement.

Each zoom trigger is filtered independently: only values strictly above `buttonDeadzone` contribute, then zoom-out minus zoom-in determines the queued delta. A below-threshold opposing trigger cannot reduce a valid trigger, and equal valid triggers cancel. Zero native speeds or wrapper multipliers block new input for that action without clearing native damping history.

Each stick binding accepts optional `xAxis`, `yAxis`, and `pipeline` fields and merges them independently with the action default. Pipelines do not process zoom triggers; configure their scalar threshold with `buttonDeadzone`. See [Stick Processing](./gamepad-stick-processing.md).

When `staticMoving` is `false`, queued gamepad pan and zoom input is scaled by `dynamicDampingFactor`. `TrackballControls` applies the remaining queued delta over multiple frames, so this compensation prevents damping from multiplying the total gamepad movement. The damping factor still controls how long the inertial tail lasts; setting `staticMoving` to `true` continues to consume each queued delta immediately.

## Properties

`TrackballControls.enabled = false` prevents the wrapper from adding new deltas. `noRotate`, `noPan`, and `noZoom` block their respective actions without clearing native pointer vectors or damping history. On re-enabling an action, Three.js may resume previously accumulated native motion. See [Native input permissions](./gamepad-controls.md#native-input-permissions).

Inherits all properties from [`GamepadControls`](./gamepad-controls.md#properties).

## Events

Inherits all events from [`GamepadControls`](./gamepad-controls.md#events).

The wrapper dispatches `start` and `end` on the wrapped native control. A session starts before the first permitted, nonzero gamepad delta and ends once on neutral input, loss of the last actionable input, observed native disable, gamepad disconnection (event or polling), or wrapper disposal. Changing from rotation to pan or zoom keeps the same session. Reaching a geometric limit does not end a held, otherwise actionable input.

Native updates remain responsible for `change`. Damping can therefore produce `change` after `end`, without a new `start`. Pausing only the wrapper retains its session; neutral input or native disabling is observed on resume. Browser disconnection events and disposal still end a paused session.

Permissions are checked again after synchronous listeners. Recursive wrapper updates during input application or session finalization are ignored. Finalization releases only the wrapper's own session and preserves native pointer state and residual motion.

Mouse and gamepad events can interleave on the same native instance, with no additional source field in their payloads. The balanced pair belongs to the gamepad session; it is not an aggregate activity counter or arbitration between input sources.

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
  // Queue gamepad deltas before TrackballControls applies them.
  gamepadTrackballControls.update(delta);
  // Apply damping and flush the queued deltas.
  trackballControls.update();
  renderer.render(scene, camera);
});

// Clean up when the controls are no longer needed.
renderer.setAnimationLoop(null);
gamepadTrackballControls.dispose();
trackballControls.dispose();
timer.dispose();
```
