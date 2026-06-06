# GamepadDragControls

A ready-to-use `GamepadControls` subclass that maps gamepad inputs to [Three.js](https://threejs.org) `DragControls` - hover, grab/drop, drag, and rotate - using the center of the viewport as a logical reticle.

Built on top of `GamepadControls`, it inherits the full [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) lifecycle (connect/disconnect events, per-frame polling, and `dispose()`), so you only need to instantiate it and drop `update()` into your render loop.

Unlike mouse-driven `DragControls`, this wrapper does not render or move a cursor. It raycasts from NDC `(0, 0)`, emits native `DragControls` events from the wrapped instance, and uses a pega/solta flow: press the select button once to grab the centered object, then press it again to drop.

All bindings and speed multipliers are configurable via the `options` parameter.

## Default Bindings

| Input | Action |
| --- | --- |
| South face button | Grab / drop the object under the center reticle |
| Left stick X / Left stick Y | Drag selected object in camera view space |
| Right stick X / Right stick Y | Rotate selected object in camera view space |

Every binding is remappable via the `options` parameter.

No visual reticle is rendered by the library. Draw your own center marker in the application if users need a visible target.

## Constructor

`new GamepadDragControls(controls, options?)`

| Parameter | Type | Description |
| --- | --- | --- |
| `controls` | `DragControls` | __Required.__ The Three.js `DragControls` instance to wrap. |
| `options` | `Partial<GamepadDragControlsOptions>` | Optional configuration. Any property not provided falls back to its default. |

### `options`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `dragSpeed` | `number` | `1.0` | Screen-relative translation speed multiplier. |
| `rotateSpeed` | `number` | `1.0` | Multiplier on `DragControls.rotateSpeed` for rotation. |
| `deadzone` | `number` | `0.1` | Axis dead zone threshold in the range `[0, 1]`. |
| `axisDragX` | `number` | `0` | Axis index for horizontal dragging (left stick X). |
| `axisDragY` | `number` | `1` | Axis index for vertical dragging (left stick Y). |
| `axisRotateX` | `number` | `2` | Axis index for horizontal rotation (right stick X). |
| `axisRotateY` | `number` | `3` | Axis index for vertical rotation (right stick Y). |
| `buttonSelect` | `number` | `0` | Button index for grab / drop (south face button). |

Gamepad input respects `DragControls.enabled`, `objects`, `recursive`, `transformGroup`, `raycaster`, and `rotateSpeed`. When `transformGroup` is `true`, selection resolves to the outermost group in the intersected object's parent chain, matching native `DragControls`.

## Properties

Inherits all properties from [`GamepadControls`](./gamepad-controls.md#properties).

## Events

Inherits all events from [`GamepadControls`](./gamepad-controls.md#events).

The wrapped `DragControls` instance continues to dispatch its native events:

| Event | Description |
| --- | --- |
| `hoveron` | Fired when the center reticle ray moves onto a draggable object. |
| `hoveroff` | Fired when the center reticle ray moves off the current hovered object. |
| `dragstart` | Fired when a gamepad press grabs an object. |
| `drag` | Fired once per frame when gamepad input moves or rotates the selected object. |
| `dragend` | Fired when a gamepad press drops an object, when the wrapped controls are disabled, or when the gamepad disconnects. |

If you use the same sticks for camera navigation and dragging, pause the camera gamepad control on `dragstart` and re-enable it on `dragend`.

## Types

| Type | Description |
| --- | --- |
| `GamepadDragControlsOptions` | Type of the `options` parameter accepted by the `GamepadDragControls` constructor. |

## Usage

```ts
import { Timer } from "three";
import { DragControls } from "three/addons/controls/DragControls.js";
import { GamepadDragControls } from "three-gamepad-controls";

const dragControls = new DragControls(objects, camera, renderer.domElement);
const gamepadDragControls = new GamepadDragControls(dragControls);

dragControls.addEventListener("dragstart", (event) => {
  console.log("Grabbed:", event.object.name);
  // Pause any camera gamepad controls that share these sticks.
});

dragControls.addEventListener("dragend", () => {
  // Re-enable shared camera gamepad controls here.
});

const timer = new Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  gamepadDragControls.update(delta);
  renderer.render(scene, camera);
});

// When done:
gamepadDragControls.dispose();
```
