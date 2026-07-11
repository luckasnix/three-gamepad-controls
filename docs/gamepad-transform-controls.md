# GamepadTransformControls

A ready-to-use `GamepadControls` subclass that maps gamepad inputs to [Three.js TransformControls](https://threejs.org/docs/#TransformControls) - translate, rotate, scale, axis selection, space toggling, and reset - using explicit button-selected modes and axes.

Built on top of `GamepadControls`, it inherits the full [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) lifecycle (connect/disconnect events, per-frame polling, and `dispose()`), so you call `gamepadTransformControls.update(delta)` in your render loop.

Unlike mouse-driven `TransformControls`, this wrapper does not raycast against the gizmo picker. Buttons select the mode and active axis directly, and the wrapped `TransformControls.axis` property is updated so the native helper highlights the selected axis.

All bindings and speed multipliers are configurable via the `options` parameter.

## Default Bindings

| Input | Action |
| --- | --- |
| Left stick | Apply transform in the active mode and axis |
| South face button | Select `translate` mode |
| East face button | Select `rotate` mode |
| West face button | Select `scale` mode |
| North face button | Toggle `space` between `world` and `local` |
| D-pad right | Select `X` axis |
| D-pad up | Select `Y` axis |
| D-pad left | Select `Z` axis |
| D-pad down | Cycle composite axes for the active mode |
| Left shoulder / Right shoulder | Select previous / next valid axis |
| Start button | Reset the active transform |

Every binding is remappable via the `options` parameter.

## Constructor

`new GamepadTransformControls(controls, options?)`

| Parameter | Type | Description |
| --- | --- | --- |
| `controls` | `TransformControls` | __Required.__ The Three.js `TransformControls` instance to wrap. |
| `options` | `Partial<GamepadTransformControlsOptions>` | Optional configuration. Any property not provided falls back to its default. |

### `options`

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `gamepadIndex` | `number` | `undefined` | Browser-assigned reusable slot (`0` to `2147483647`). When omitted, selects the connected gamepad with the lowest index; an explicit slot never falls back. Invalid values throw `RangeError`; a replacement may later reuse the same slot. |
| `translateSpeed` | `number` | `1.0` | Screen-relative translation speed multiplier. |
| `rotateSpeed` | `number` | `1.0` | Rotation speed multiplier. |
| `scaleSpeed` | `number` | `1.0` | Scale speed multiplier. |
| `deadzone` | `number` | `0.1` | Axis dead zone threshold in the range `[0, 1]`. |
| `axisTransformX` | `number` | `0` | Axis index for horizontal transform input (left stick X). |
| `axisTransformY` | `number` | `1` | Axis index for vertical transform input (left stick Y). |
| `buttonTranslate` | `number` | `0` | Button index for translate mode (south face button). |
| `buttonRotate` | `number` | `1` | Button index for rotate mode (east face button). |
| `buttonScale` | `number` | `2` | Button index for scale mode (west face button). |
| `buttonToggleSpace` | `number` | `3` | Button index for toggling `world` / `local` space (north face button). |
| `buttonAxisX` | `number` | `15` | Button index for selecting X (D-pad right). |
| `buttonAxisY` | `number` | `12` | Button index for selecting Y (D-pad up). |
| `buttonAxisZ` | `number` | `14` | Button index for selecting Z (D-pad left). |
| `buttonAxisComposite` | `number` | `13` | Button index for cycling composite axes (D-pad down). |
| `buttonAxisPrevious` | `number` | `4` | Button index for selecting the previous valid axis (left shoulder). |
| `buttonAxisNext` | `number` | `5` | Button index for selecting the next valid axis (right shoulder). |
| `buttonReset` | `number` | `9` | Button index for resetting the active transform (Start button). |

## Behavior

The wrapper keeps one active axis per mode:

| Mode | Axes |
| --- | --- |
| `translate` | `X`, `Y`, `Z`, `XY`, `YZ`, `XZ`, `XYZ` |
| `rotate` | `X`, `Y`, `Z`, `E`, `XYZE` |
| `scale` | `X`, `Y`, `Z`, `XYZ` |

Axis selection respects `showX`, `showY`, `showZ`, `showXY`, `showYZ`, and `showXZ`. If the current axis becomes hidden or invalid for the selected mode, the wrapper selects the next valid axis or clears `controls.axis` when none is available.

Moving the transform stick outside the dead zone starts a native-style transform interaction: `controls.dragging` becomes `true` and the wrapped instance emits `mouseDown`. Returning the stick to neutral emits `mouseUp` once and sets `controls.dragging` back to `false`, while preserving the selected axis highlight.

Gamepad transforms respect `TransformControls.enabled`, `mode`, `axis`, `space`, `translationSnap`, `rotationSnap`, `scaleSnap`, and translation min/max bounds. The wrapper maintains unsnapped internal accumulators, so small stick movements are not lost while snap settings are active.

`buttonReset` restores the object to the state captured when the current gamepad transform interaction began. It has no effect until moving the transform stick has started that interaction.

If you use the same sticks for camera navigation and object transforms, pause the camera gamepad control on `mouseDown` and re-enable it on `mouseUp`.

## Properties

Inherits all properties from [`GamepadControls`](./gamepad-controls.md#properties).

## Events

Inherits all events from [`GamepadControls`](./gamepad-controls.md#events).

The wrapped `TransformControls` instance continues to dispatch its native events:

| Event | Description |
| --- | --- |
| `mouseDown` | Fired once when stick movement starts a transform interaction. |
| `mouseUp` | Fired once when stick movement ends, the controls are disabled, the object is detached, the gamepad disconnects, or the wrapper is disposed. |
| `change` | Fired when properties or object transforms change. |
| `objectChange` | Fired once per gamepad transform frame. |
| `*-changed` | Fired by native `TransformControls` when properties such as `axis`, `mode`, `space`, or `dragging` change. |

## Types

| Type | Description |
| --- | --- |
| `GamepadTransformControlsOptions` | Type of the `options` parameter accepted by the `GamepadTransformControls` constructor. |

## Usage

```ts
import { Timer } from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GamepadTransformControls } from "three-gamepad-controls";

const transformControls = new TransformControls(camera, renderer.domElement);
// Add the helper separately; TransformControls itself is not an Object3D.
const transformControlsHelper = transformControls.getHelper();
scene.add(transformControlsHelper);
transformControls.attach(mesh);

const gamepadTransformControls = new GamepadTransformControls(transformControls);
const timer = new Timer();

transformControls.addEventListener("mouseDown", () => {
  // Pause any camera gamepad controls that share the transform stick.
});

transformControls.addEventListener("mouseUp", () => {
  // Re-enable shared camera gamepad controls here.
});

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  // Poll input and update the selected transform.
  gamepadTransformControls.update(delta);
  renderer.render(scene, camera);
});

// Clean up when the controls are no longer needed.
renderer.setAnimationLoop(null);
gamepadTransformControls.dispose();
transformControls.detach();
scene.remove(transformControlsHelper);
transformControls.dispose();
timer.dispose();
```
