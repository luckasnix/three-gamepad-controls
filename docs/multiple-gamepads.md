# Multiple Gamepads

Each `GamepadInput` or `Gamepad*Controls` instance manages one active gamepad. Create multiple instances with different `gamepadIndex` values when gamepads should control different players or parts of a Three.js scene.

## Selecting a gamepad

When `gamepadIndex` is omitted, an instance selects the connected gamepad with the lowest index. This preserves the single-gamepad setup without extra configuration. Multiple unconfigured instances can intentionally select the same gamepad.

When `gamepadIndex` is provided, the instance waits for that exact slot and never falls back to another one. Valid indices are integers from [`MIN_GAMEPAD_INDEX`](./core.md#min_gamepad_index) through [`MAX_GAMEPAD_INDEX`](./core.md#max_gamepad_index); constructing an instance with any other value throws a `RangeError`.

[`Gamepad.index`](https://www.w3.org/TR/gamepad/#dom-gamepad-index) is a browser-assigned, reusable slot, not a persistent device identity. If another device replaces the active gamepad in the same slot, the instance reports the old device as disconnected and adopts the replacement on a later update. [`Gamepad.id`](https://www.w3.org/TR/gamepad/#dom-gamepad-id) describes the device but is not guaranteed to be unique, so neither field should be used as a permanent player or physical-device identifier.

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
