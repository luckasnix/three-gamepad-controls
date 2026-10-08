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
| `gamepadIndex` | `number` | `undefined` | Browser-assigned reusable slot ([`MIN_GAMEPAD_INDEX`](./core.md#min_gamepad_index) to [`MAX_GAMEPAD_INDEX`](./core.md#max_gamepad_index)). When omitted, adopts the lowest connected index and keeps that slot until its loss is observed, even if a lower index connects later; an explicit slot never falls back. Invalid values throw `RangeError`; a replacement may later reuse the same slot. |
| `translateSpeed` | `number` | `1.0` | Translation gain: effective viewport widths/heights per second for `XYZ`, or their mean in world units per second for constrained axes. |
| `rotateSpeed` | `number` | `1.0` | Rotation speed multiplier. |
| `scaleSpeed` | `number` | `1.0` | Scale speed multiplier. |
| `transformStick` | `GamepadStickBindingOptions` | Left stick + default pipeline | Axes and stateless pipeline for transform input. |
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

The wrapper remembers one active axis per mode:

| Mode | Axes |
| --- | --- |
| `translate` | `X`, `Y`, `Z`, `XY`, `YZ`, `XZ`, `XYZ` |
| `rotate` | `X`, `Y`, `Z`, `E`, `XYZE` |
| `scale` | `X`, `Y`, `Z`, `XYZ` |

Axis selection respects `showX`, `showY`, `showZ`, `showXY`, `showYZ`, and `showXZ`. A neutral update without an owned interaction leaves the native axis, dragging state, and snapshots untouched. When acquiring an interaction, an explicit button selection takes priority, followed by a valid native `axis`, the remembered axis for the mode, and the first allowed axis. If none is available, acquisition clears the axis and does not start a drag. Axis cycles begin from the valid native selection; mode buttons explicitly restore that mode's remembered selection, with a fallback if necessary.

When the processed transform stick becomes nonzero, a native-style transform interaction starts: `controls.dragging` becomes `true` and the wrapped instance emits `mouseDown`. Returning a zero vector from the pipeline emits `mouseUp` once and sets `controls.dragging` back to `false`, while preserving the selected axis highlight.

`transformStick` accepts optional `xAxis`, `yAxis`, and `pipeline` fields and merges them independently with the action default. Mode, axis, space, and reset buttons are not processed by the stick pipeline. See [Stick Processing](./gamepad-stick-processing.md).

Gamepad transforms respect `TransformControls.enabled`, `mode`, the acquired axis, `space`, `translationSnap`, `rotationSnap`, `scaleSnap`, and translation min/max bounds. The wrapper maintains unsnapped internal accumulators, so small stick movements are not lost while snap settings are active.

### Translation and projection

Translation uses the effective dimensions of the current camera projection. Perspective dimensions are measured at the object's camera-space depth and include zoom, aspect ratio, and `setViewOffset()` crops; orthographic dimensions are independent of depth. The crop's position is not added to the object's accumulated translation. Camera world matrices, including parents, are refreshed before movement.

For `XYZ`, `translateSpeed: 1` moves one viewport width or height per second at full processed input on the corresponding screen axis. Constrained axes and planes preserve their existing gain: the mean of the effective viewport width and height in world units per second, multiplied by `translateSpeed` and the processed input along each permitted direction. Their projected response therefore also depends on aspect ratio and axis orientation. Movement that changes depth is not guaranteed to produce a linear finite screen displacement; snapping and bounds can further constrain the result.

The application must call `updateProjectionMatrix()` after directly changing projection properties. Dimensions are read on every movement update, so a zoom change adjusts world-space speed without starting a new segment, recapturing reset origin, or discarding accumulated input.

```ts
camera.zoom = 2;
camera.updateProjectionMatrix();
```

### Interaction lifecycle

Native disable blocks mode, space, axis, reset, and transformation commands before they are applied. Polling continues, so a button held through the blocked period requires a new press to execute its command. An owned gamepad interaction ends once when native disable is observed. See [Native input permissions](./gamepad-controls.md#native-input-permissions) for pause and observation timing.

While a native pointer drag is active, the wrapper does not acquire a transformation or apply gamepad buttons. Polling still consumes button transitions, so held buttons are not replayed after the drag. If a nonzero processed stick is observed during the pointer drag, the wrapper requires a zero vector before acquiring another transformation. That neutral observation may occur during the pointer drag or after it ends.

Each owned interaction is divided into segments identified by object, mode, space, and axis. Changing mode, space, or axis through buttons or external setters ends the previous segment and starts a new one if the stick remains active. The old `mouseUp` carries the old mode, and the next `mouseDown` uses the new mode. Each new segment captures its own reset origin once. An axis becoming disallowed also ends its segment before a fallback can be acquired.

Changing the attached object or calling `detach()` during an owned interaction ends the previous segment and requires neutral input before acquiring the next object. The new object never receives the previous object's reset snapshot or accumulated movement. Calling `attach()` with the same object without an observed detach does not create a new segment.

Context changes are observed at the next enabled wrapper update and after synchronous callbacks during an update. A callback that changes context stops the remaining commands and movement for that update; reacquisition waits until a later update and respects the neutral requirement. Changes entirely reversed between observations are not guaranteed to be detected. Pausing the wrapper preserves its session until updates resume; disconnection events and disposal still end an owned interaction.

Disconnection, disposal, or native disable does not clear an unrelated pointer interaction or external selection. A native `mouseDown` listener distinguishes pointer acquisition from gamepad acquisition, including pointer takeover during cleanup, and is removed on disposal. Cleanup releases ownership before notifying listeners, emits an end only for a published start, and preserves selection or a new pointer drag established by callbacks. This does not provide general arbitration for multiple wrappers editing the same native control or object.

`buttonReset` restores the object to the state captured at the start of the current owned segment and clears its accumulated movement without changing that origin. It has no effect without an owned segment. If context and permissions remain valid, the current frame's stick delta is applied after reset; a neutral stick or zero delta time allows observing the exact reset pose.

If you use the same sticks for camera navigation and object transforms, pause the camera gamepad control on `mouseDown` and re-enable it on `mouseUp`.

## Properties

Inherits all properties from [`GamepadControls`](./gamepad-controls.md#properties).

## Events

Inherits all events from [`GamepadControls`](./gamepad-controls.md#events).

The wrapped `TransformControls` instance continues to dispatch its native events:

| Event | Description |
| --- | --- |
| `mouseDown` | Fired once when a gamepad segment starts; `mode` identifies that segment. |
| `mouseUp` | Fired once per published segment on neutral input, context change, native disable, gamepad loss, or disposal; `mode` identifies the segment being ended. |
| `change` | Fired when properties or object transforms change. |
| `objectChange` | Fired after an effective gamepad transform if its preceding `change` callback leaves the context and permissions valid; native reset also emits this event. |
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

const gamepadTransformControls = new GamepadTransformControls(
  transformControls,
);
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
