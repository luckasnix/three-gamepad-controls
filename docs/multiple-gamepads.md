# Multiple Gamepads

Each `GamepadInput` or `Gamepad*Controls` instance manages one active gamepad. Create multiple instances with different `gamepadIndex` values when gamepads should control different players or parts of a Three.js scene.

## Selecting a gamepad

When `gamepadIndex` is omitted and no gamepad is active, an instance adopts the connected gamepad with the lowest index. It keeps that slot until its loss is observed, even if a lower index connects later. For example, an instance that adopted slot `3` stays there when slot `0` appears. This preserves the single-gamepad setup without extra configuration. Multiple unconfigured instances can select the same gamepad; automatic selection does not allocate players.

When `gamepadIndex` is provided, the instance waits for that exact slot and never falls back to another one. Valid indices are integers from [`MIN_GAMEPAD_INDEX`](./core.md#min_gamepad_index) through [`MAX_GAMEPAD_INDEX`](./core.md#max_gamepad_index); constructing an instance with any other value throws a `RangeError`.

[`Gamepad.index`](https://www.w3.org/TR/gamepad/#dom-gamepad-index) is a browser-assigned, reusable slot, not a persistent device identity. An instance reports `disconnected` when it receives a browser disconnection event for its active slot or polling observes that slot missing or disconnected. Fresh snapshots in a continuously connected slot update input normally, even if their JavaScript reference, `id`, or `timestamp` changes. A physical replacement between polls without an observed disconnection cannot be reliably identified by this library. [`Gamepad.id`](https://www.w3.org/TR/gamepad/#dom-gamepad-id) describes the device but is not guaranteed to be unique, so neither field should be used as a permanent player or physical-device identifier.

## Observed connection lifecycle

Each polling update reports at most one transition. If polling loses the active slot, that update clears input and reports only `disconnected`; another available gamepad can be adopted on the next update. A matching browser disconnection event clears state immediately and defers adoption until the next enabled update, ignoring intervening connection events. With an explicit index, adoption still waits for that exact slot.

Connection events use the current polled snapshots for selection. In automatic mode, an event for slot `3` can adopt slot `0` if both are available. Events do not replace an already active slot. Unrelated disconnection events and repeated observations of a loss before readoption do not produce additional disconnections.

Adoption seeds both current and previous button state, so an already-held button does not produce `wasPressed`. Disconnection clears both states without producing `wasReleased`. Inputs keep their own button history even when they share a slot or a stateless stick pipeline.

## Pause, resume, and disposal

Setting `enabled = false` pauses polling through `update()`; on a wrapper it also pauses `onUpdate()` and gamepad input application. It preserves the last observed state and does not itself cancel an interaction. Browser listeners remain attached: disconnection events can still clear state and reach wrapper hooks, and connection events can poll and adopt a gamepad when selection permits.

A loss visible only through polling is detected when updates resume. Without a lifecycle event, getters and button-transition flags retain their last observed state while paused. On resume, button state is compared with that observation: a newly held press produces `wasPressed`, and a release produces `wasReleased`. A complete press/release between observations is not reconstructed. If resume adopts a gamepad after an observed loss, held buttons are seeded without a synthetic press.

The wrapper's pause flag is independent of the native Three.js control's `enabled` flag. Native controls retain their own update behavior, including any residual motion. Native permission checks and interaction cleanup are responsibilities of each wrapper; the shared base continues polling while its own `enabled` flag is true.

`dispose()` removes the instance's internal gamepad listeners, clears state, and disables it without emitting a synthetic `disconnected` event. Repeated disposal is safe and does not affect other instances. A disposed instance is not intended for reuse; create a new one. A wrapper does not dispose its native Three.js control. Use separate native controls and destinations per player; sharing a native control or destination requires application-level coordination.

## Usage

### Different gamepads for Three.js controls

This example assigns slot `0` to camera navigation and slot `1` to object transforms:

```ts
import { Timer } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import {
  GamepadOrbitControls,
  GamepadTransformControls,
} from "three-gamepad-controls";

const orbitControls = new OrbitControls(camera, renderer.domElement);

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.attach(cube);
// TransformControls renders its gizmo through this separate helper object.
const transformControlsHelper = transformControls.getHelper();
scene.add(transformControlsHelper);

// Pin each wrapper to a browser-assigned gamepad slot.
const cameraGamepad = new GamepadOrbitControls(orbitControls, {
  gamepadIndex: 0,
});

const objectGamepad = new GamepadTransformControls(transformControls, {
  gamepadIndex: 1,
});

const timer = new Timer();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = timer.getDelta();

  // Poll slot 0 before applying camera motion.
  cameraGamepad.update(delta);
  // Poll slot 1 independently.
  objectGamepad.update(delta);
  // Flush OrbitControls' queued input and damping.
  orbitControls.update(delta);

  renderer.render(scene, camera);
});

// Clean up when the controls are no longer needed.
renderer.setAnimationLoop(null);
cameraGamepad.dispose();
objectGamepad.dispose();
orbitControls.dispose();
transformControls.detach();
scene.remove(transformControlsHelper);
transformControls.dispose();
timer.dispose();
```

The gamepad wrappers and the wrapped Three.js controls have independent lifecycles, so dispose both when they are no longer needed. Three.js controls, including `OrbitControls` and `TransformControls`, provide `dispose()` to remove event listeners and release internal resources. See the Three.js [`Controls.dispose()`](https://threejs.org/docs/pages/Controls.html#Methods) documentation.

### Different gamepads for players

Use one [`GamepadInput`](./gamepad-input.md) per player when gamepad input drives gameplay rather than a Three.js controls wrapper. `GamepadInput` owns its internal gamepad manager, so application code does not create or coordinate a `GamepadManager` directly.

```ts
import { GamepadInput } from "three-gamepad-controls";

const player1Input = new GamepadInput({ gamepadIndex: 0 });
const player2Input = new GamepadInput({ gamepadIndex: 1 });

renderer.setAnimationLoop(() => {
  // Poll every input before consuming its current state or transitions.
  player1Input.update();
  player2Input.update();

  updatePlayer1(player1Input);
  updatePlayer2(player2Input);

  renderer.render(scene, camera);
});

// Clean up when the inputs are no longer needed.
renderer.setAnimationLoop(null);
player1Input.dispose();
player2Input.dispose();
```

Each input keeps independent button-transition state, connection events, and slot selection. See [`GamepadInput`](./gamepad-input.md) for a complete character movement example.
