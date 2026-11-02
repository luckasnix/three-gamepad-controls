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
| `gamepadIndex` | `number` | `undefined` | Browser-assigned reusable slot ([`MIN_GAMEPAD_INDEX`](./core.md#min_gamepad_index) to [`MAX_GAMEPAD_INDEX`](./core.md#max_gamepad_index)). When omitted, adopts the lowest connected index and keeps that slot until its loss is observed, even if a lower index connects later; an explicit slot never falls back. Invalid values throw `RangeError`; a replacement may later reuse the same slot. |
| `rotateSpeed` | `number` | `1.0` | Multiplier on `OrbitControls.rotateSpeed`. |
| `panSpeed` | `number` | `1.0` | Multiplier on `OrbitControls.panSpeed`. |
| `zoomSpeed` | `number` | `1.0` | Multiplier on `OrbitControls.zoomSpeed`. |
| `rotateStick` | `GamepadStickBindingOptions` | Left stick + default pipeline | Axes and stateless pipeline for orbit rotation. |
| `panStick` | `GamepadStickBindingOptions` | Right stick + default pipeline | Axes and stateless pipeline for panning. |
| `buttonDeadzone` | `number` | `0.1` | Dead zone threshold for analog dolly triggers. |
| `buttonDollyIn` | `number` | `7` | Button index for zoom in — analog trigger value (right trigger). |
| `buttonDollyOut` | `number` | `6` | Button index for zoom out — analog trigger value (left trigger). |

The effective speed for each action is its native speed multiplied by the wrapper option. A zero native speed or multiplier blocks that action without opening or retaining a session by itself. Values 2 × 0.5 produce the same response as 1 × 1.

Each stick binding accepts optional `xAxis`, `yAxis`, and `pipeline` fields and merges them independently with the action default. Stick pipelines do not process the dolly triggers; configure their scalar threshold with `buttonDeadzone`. See [Stick Processing](./gamepad-stick-processing.md).

## Properties

Inherits all properties from [`GamepadControls`](./gamepad-controls.md#properties).

Gamepad input respects `OrbitControls.enabled`, `enableRotate`, `enablePan`, and `enableZoom`. Blocking one action leaves the others available. Native `change` listeners can change permissions during an update; subsequent gamepad operations use the new values. See [Native input permissions](./gamepad-controls.md#native-input-permissions) for polling, pause, and residual motion.

## Automatic rotation and input composition

Accepted gamepad rotation, pan, or dolly suspends the automatic contribution of `autoRotate`. The processed action must be permitted and have a nonzero effective speed and frame delta. Reaching a geometric limit still counts as intent; dead-zone input, a pipeline returning zero, blocked actions, zero gains, and residual damping alone do not suspend automation.

Call `gamepadOrbitControls.update(delta)` **before** `orbitControls.update(delta)` every frame. Suspension covers the synchronous updates inside public Orbit operations and every subsequent native update until the next wrapper update or invalidation. The next neutral wrapper update releases it, even while native damping continues. Existing residual motion is preserved; suspension prevents new automatic rotation rather than stopping the camera instantly.

`autoRotate` and `autoRotateSpeed` remain unchanged and readable throughout input processing. Application assignments, including those made in synchronous `start`, `change`, or `end` listeners, remain effective. Permissions and gains are revalidated without rereading stick pipelines. The native control still decides when pointer activity permits automatic rotation; gamepad input never fabricates or resets pointer state.

Pausing the wrapper releases suppression on the next wrapper or native update while retaining the gamepad session. Observed native disable, loss of actionable input, a changed gamepad snapshot or camera destination, disconnection, disposal, and failed updates also release suppression. Polling-only disconnection remains unobserved while the wrapper is paused, as in the base lifecycle.

The update adaptation belongs only to the wrapped instance. `dispose()` is terminal and idempotent, restores the native update when still owned, and preserves later application replacements. It does not dispose the native control. Sharing a native control or camera between wrappers requires application coordination.

## Events

Inherits all events from [`GamepadControls`](./gamepad-controls.md#events).

The wrapper dispatches `start` and `end` on the wrapped native control. A session starts before the first permitted, nonzero gamepad delta and ends once on neutral input, loss of the last actionable input, observed native disable, gamepad disconnection (event or polling), or wrapper disposal. Changing from rotation to pan or zoom keeps the same session. Reaching a geometric limit does not end a held, otherwise actionable input.

Native updates remain responsible for `change`. Damping can therefore produce `change` after `end`, without a new `start`. Pausing only the wrapper retains its session; neutral input or native disabling is observed on resume. Browser disconnection events and disposal still end a paused session.

Permissions are checked again after synchronous listeners. Recursive wrapper updates during input application, native updates, or session finalization are ignored; recursive native updates return `false`. Finalization releases only the wrapper's own session and preserves native pointer state and residual motion.

Mouse and gamepad events can interleave on the same native instance, with no additional source field in their payloads. The balanced pair belongs to the gamepad session; it is not an aggregate activity counter or arbitration between input sources.

Orbit public operations can emit multiple native `change` notifications in one update when several actions run. The wrapper does not synthesize additional `change` events.

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
// Optional: pauses automatically while accepted gamepad input is applied.
orbitControls.autoRotate = true;
const gamepadOrbitControls = new GamepadOrbitControls(orbitControls);

gamepadOrbitControls.addEventListener("connected", (event) => {
  console.log("Gamepad connected:", event.gamepad.id);
});

const timer = new Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();
  // Apply gamepad input through OrbitControls' public operations.
  gamepadOrbitControls.update(delta);
  // Continue the native damping and automatic movement update.
  orbitControls.update(delta);
  renderer.render(scene, camera);
});

// Clean up when the controls are no longer needed.
renderer.setAnimationLoop(null);
gamepadOrbitControls.dispose();
orbitControls.dispose();
timer.dispose();
```
