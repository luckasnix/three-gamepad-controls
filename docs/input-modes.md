# Input Modes

## Choosing between keyboard/mouse and gamepad

The application decides which inputs drive an action. For a character or menu, you can make that choice directly with `GamepadInput`. For a Three.js control, the choice also depends on how the native control receives keyboard and pointer events.

### Gameplay with GamepadInput

Use a mode from your game's settings to decide which actions to apply each frame. In this example, `updateKeyboardMouse(delta)` is the game's existing keyboard/mouse movement and jump handler. The gamepad drives the same character through `movePlayer(x, z, delta)` and `startJump()`.

```ts
import { GAMEPAD_AXIS, GAMEPAD_BUTTON, GamepadInput } from "three-gamepad-controls";

type InputMode = "keyboard-mouse" | "gamepad" | "both";

const gamepadInput = new GamepadInput();
let inputMode: InputMode = "both";

const setInputMode = (mode: InputMode) => {
  inputMode = mode;
  gamepadInput.enabled = mode !== "keyboard-mouse";
};

// Call once per gameplay frame, with delta in seconds.
const updatePlayer = (delta: number) => {
  if (inputMode !== "gamepad") {
    updateKeyboardMouse(delta);
  }

  if (gamepadInput.enabled) {
    gamepadInput.update();
    const stick = gamepadInput.stick(GAMEPAD_AXIS.LeftX, GAMEPAD_AXIS.LeftY);
    movePlayer(stick.x, stick.y, delta);

    if (gamepadInput.wasPressed(GAMEPAD_BUTTON.South)) {
      startJump();
    }
  }
};
```

`GamepadInput.enabled` defaults to `true`. Setting it to `false` pauses polling in `update()` and retains the last observed state. For example, `wasPressed()` can still return `true` from the frame before the pause. Keep both the reads and the actions inside the enabled branch. On resume, `update()` compares the current buttons with the last observation. [Pause and resume](./multiple-gamepads.md#pause-resume-and-disposal)

If a keyboard or pointer listener applies a gameplay action immediately, check the mode inside that listener too. If your game tracks held keys or queues clicks, clear that state when switching to gamepad-only so a previous movement or jump is not applied on return.

### Switching inputs with OrbitControls

All built-in wrappers require their native Three.js control to be enabled for new gamepad actions. With `OrbitControls`, keep `orbit.enabled` set to `true` in all three modes. Switch the wrapper's `enabled` flag for gamepad input and the native DOM listeners for mouse and keyboard input. [Native input permissions](./gamepad-controls.md#native-input-permissions)

```ts
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GamepadOrbitControls } from "three-gamepad-controls";

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.listenToKeyEvents(window); // Enable native keyboard panning.
const gamepadOrbit = new GamepadOrbitControls(orbit);
let orbitMode: InputMode = "both"; // InputMode is defined above.

const setOrbitMode = (mode: InputMode) => {
  if (mode === orbitMode) return;

  gamepadOrbit.enabled = mode !== "keyboard-mouse";
  if (mode === "gamepad") {
    orbit.disconnect();
  } else if (orbitMode === "gamepad") {
    orbit.connect(renderer.domElement);
    orbit.listenToKeyEvents(window);
  }
  orbitMode = mode;
};

// In the render loop, in every mode:
gamepadOrbit.update(delta);
orbit.update(delta);
```

`orbit.disconnect()` removes OrbitControls' pointer, wheel, and keyboard listeners. When leaving gamepad-only mode, reconnect to the canvas and restore keyboard panning on its original target if your application uses it. Listeners installed by the application still follow its own mode checks. Other native controls have their own input and update behavior. [OrbitControls usage and damping](./gamepad-orbit-controls.md#usage)
