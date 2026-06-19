# GamepadInput

Gamepad input state reader for gameplay, menus, and custom interactions.

`GamepadInput` uses the same [Web Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API) lifecycle as the [Three.js](https://threejs.org) control wrappers, but it does not wrap a Three.js control. Use it when you want direct button, axis, or stick state in your own application code.

## Constructor

```ts
const gamepadInput = new GamepadInput(options);
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `deadzone` | `number` | `0.1` | Default axis dead zone threshold. |

## Properties

| Property | Type | Description |
| --- | --- | --- |
| `enabled` | `boolean` | When `false`, input polling is paused. |
| `gamepad` | `Gamepad \| null` | The active gamepad snapshot, or `null`. |
| `connected` | `boolean` | Whether a gamepad is currently active. |
| `mapping` | `GamepadMappingType \| null` | Mapping reported by the active gamepad. |
| `rawGamepad` | `Gamepad \| null` | Alias for the active raw gamepad snapshot. |

## Methods

### `update()`

Polls the gamepad and refreshes current and previous button state. Call this once per frame before reading buttons, axes, or sticks.

### `dispose()`

Removes window-level gamepad event listeners and clears stored state.

### `isPressed(button)`

Returns whether a button is currently pressed.

### `wasPressed(button)`

Returns `true` only on the update where a button changes from released to pressed.

### `wasReleased(button)`

Returns `true` only on the update where a button changes from pressed to released. Disconnecting a gamepad clears state without producing artificial release transitions.

### `buttonValue(button)`

Returns the current analog value for a button. Digital pressed buttons fall back to `1`, and unavailable buttons return `0`.

### `axis(axis, options)`

Returns an axis value after dead zone processing. Pass `options.deadzone` to override the instance default for one read.

### `stick(xAxis, yAxis, options)`

Returns `{ x, y }` using the same dead zone behavior as `axis()`.

## Events

| Event | Extra fields | Description |
| --- | --- | --- |
| `connected` | `gamepad: Gamepad` | Fired when a gamepad connects and becomes active. |
| `disconnected` | `gamepad: Gamepad` | Fired when the active gamepad disconnects. |

## Usage

```ts
import {
  GAMEPAD_AXIS,
  GAMEPAD_BUTTON,
  GamepadInput,
} from "three-gamepad-controls";

const gamepadInput = new GamepadInput();

const update = () => {
  gamepadInput.update();

  if (gamepadInput.wasPressed(GAMEPAD_BUTTON.South)) {
    player.jump();
  }

  const move = gamepadInput.stick(GAMEPAD_AXIS.LeftX, GAMEPAD_AXIS.LeftY);
  player.move(move.x, move.y);
};

// When done:
gamepadInput.dispose();
```
