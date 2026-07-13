# Haptic Feedback

`GamepadInput` and every `Gamepad*Controls` wrapper can request vibration effects from the active gamepad through the Web Gamepad API's [`Gamepad.vibrationActuator`](https://www.w3.org/TR/gamepad/#dom-gamepad-vibrationactuator).

Haptic feedback has limited availability and depends on the browser, operating system, connection type, and controller. The library uses only `vibrationActuator`; it does not fall back to the older experimental `hapticActuators` property.

## Availability

Both [`GamepadInput`](./gamepad-input.md) and [`GamepadControls`](./gamepad-controls.md) expose `vibrationSupported`. It is `true` when an active gamepad provides a callable `vibrationActuator.playEffect()` method.

This property does not guarantee that a particular effect type is supported. For example, an actuator may support `"dual-rumble"` but not `"trigger-rumble"`. Call `playVibrationEffect()` and use its result as the final capability check.

## Effects

`playVibrationEffect(type, parameters?)` accepts the Web Gamepad API types `GamepadHapticEffectType` and `GamepadEffectParameters`.

The supported effect types defined by the current specification are:

| Effect | Description |
| --- | --- |
| `"dual-rumble"` | Uses low- and high-frequency vibration for the whole gamepad. |
| `"trigger-rumble"` | Adds localized left- and right-trigger vibration when supported. |

Effect parameters are optional and default to `0`:

| Parameter | Range | Description |
| --- | --- | --- |
| `duration` | Non-negative milliseconds | Effect duration. |
| `startDelay` | Non-negative milliseconds | Delay before playback starts. |
| `strongMagnitude` | `0` to `1` | Low-frequency vibration intensity. |
| `weakMagnitude` | `0` to `1` | High-frequency vibration intensity. |
| `leftTrigger` | `0` to `1` | Left-trigger intensity for `"trigger-rumble"`. |
| `rightTrigger` | `0` to `1` | Right-trigger intensity for `"trigger-rumble"`. |

A new effect may preempt an effect that is already playing. The promise resolves to `"complete"` when playback finishes or `"preempted"` when the effect is stopped or replaced.

Call `resetVibration()` to stop the active effect. It returns the same `Promise<GamepadHapticsResult | null>` shape as `playVibrationEffect()` and safely resolves to `null` when reset is unavailable or cannot currently run.

## Graceful degradation

The return type of `playVibrationEffect()` is `Promise<GamepadHapticsResult | null>`. It resolves to `null` and does not vibrate when:

- no gamepad is active;
- `vibrationActuator` or `playEffect()` is unavailable;
- the actuator does not support the requested effect; or
- the document is hidden, inactive, or otherwise temporarily unable to play
  the effect.

These cases do not throw and do not require a capability branch. Invalid effect parameters and unexpected failures remain rejected so programming errors are not mistaken for missing hardware support.

## Usage

### `GamepadInput`

```ts
import { GamepadInput } from "three-gamepad-controls";

const gamepadInput = new GamepadInput();

gamepadInput.addEventListener("connected", () => {
  setHapticsAvailable(gamepadInput.vibrationSupported);
});

async function playCollisionFeedback() {
  const result = await gamepadInput.playVibrationEffect("dual-rumble", {
    startDelay: 0,
    duration: 200,
    strongMagnitude: 1,
    weakMagnitude: 0.5,
  });

  if (result === null) {
    // Continue normally without haptic feedback.
  }
}

async function stopCollisionFeedback() {
  await gamepadInput.resetVibration();
}
```

### `GamepadControls`

All concrete controls inherit the haptic feedback API from `GamepadControls`:

```ts
import { GamepadOrbitControls } from "three-gamepad-controls";

const gamepadOrbitControls = new GamepadOrbitControls(orbitControls);

gamepadOrbitControls.addEventListener("connected", async () => {
  await gamepadOrbitControls.playVibrationEffect("dual-rumble", {
    duration: 120,
    strongMagnitude: 0.6,
    weakMagnitude: 0.25,
  });
});
```

Vibration methods are explicit output operations. Calling `update()` refreshes the active gamepad but does not automatically play or stop effects.
