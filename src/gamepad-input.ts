import { EventDispatcher } from "three";

import {
  isGamepadVibrationSupported,
  playGamepadVibrationEffect,
  resetGamepadVibration,
} from "./gamepad-haptics.ts";
import { GamepadManager } from "./gamepad-manager.ts";
import {
  DEFAULT_GAMEPAD_STICK_PIPELINE,
  type GamepadStick,
  type GamepadStickPipeline,
} from "./gamepad-stick-processing.ts";

/**
 * Event map for {@link GamepadInput}.
 */
export type GamepadInputEventMap = {
  /**
   * Fired when a gamepad is connected and becomes active.
   */
  connected: {
    /**
     * Gamepad snapshot that became active.
     */
    gamepad: Gamepad;
  };

  /**
   * Fired on a matching browser disconnection event or when polling observes
   * the active slot missing or disconnected. Continuous snapshots in the same
   * slot do not establish a physical-device identity or signal replacement.
   */
  disconnected: {
    /**
     * Gamepad snapshot that was active before disconnection.
     */
    gamepad: Gamepad;
  };
};

/**
 * Configuration for {@link GamepadInput}.
 */
export type GamepadInputOptions = {
  /**
   * Default dead zone threshold for {@link GamepadInput.axis} reads.
   * @default 0.1
   */
  axisDeadzone: number;

  /**
   * Default stateless processing pipeline for stick reads.
   * @default DEFAULT_GAMEPAD_STICK_PIPELINE
   */
  stickPipeline: GamepadStickPipeline;

  /**
   * Browser-assigned gamepad slot to use.
   *
   * When omitted, the lowest connected index is chosen at adoption and kept
   * until its loss is observed, even if a lower index subsequently connects.
   * Multiple unconfigured instances may adopt the same slot.
   * The index must be an integer from `MIN_GAMEPAD_INDEX` through
   * `MAX_GAMEPAD_INDEX`.
   * A valid but empty slot keeps this input disconnected without falling back
   * to another gamepad.
   */
  gamepadIndex?: number;
};

/**
 * Options for axis reads.
 */
export type GamepadAxisOptions = {
  /**
   * Axis dead zone threshold for this read.
   */
  deadzone?: number;
};

type SyncButtonStateOptions = {
  // Whether to copy current button state into previous state after syncing.
  seedPrevious: boolean;
};

const DEFAULT_GAMEPAD_INPUT_OPTIONS: GamepadInputOptions = {
  axisDeadzone: 0.1,
  stickPipeline: DEFAULT_GAMEPAD_STICK_PIPELINE,
};

/**
 * Applies a scalar dead zone without rescaling.
 *
 * @param value - Raw axis value.
 * @param threshold - Dead zone size.
 * @returns The original value outside the dead zone, otherwise `0`.
 */
const applyGamepadAxisDeadzone = (value: number, threshold: number): number => {
  return Math.abs(value) < threshold ? 0 : value;
};

/**
 * Returns whether a gamepad button is currently pressed.
 *
 * Missing buttons are treated as not pressed.
 *
 * @param gamepad - Gamepad snapshot to read from.
 * @param button - Button index to inspect.
 * @returns `true` when the button exists and is pressed, otherwise `false`.
 */
const getGamepadButtonPressed = (gamepad: Gamepad, button: number): boolean => {
  return gamepad.buttons[button]?.pressed ?? false;
};

/**
 * Returns the analog value for a gamepad button.
 *
 * Some digital buttons may report `pressed` without a meaningful non-zero
 * `value`, so pressed buttons fall back to `1`.
 *
 * @param gamepad - Gamepad snapshot to read from.
 * @param button - Button index to inspect.
 * @returns The button value, `1` for pressed digital buttons, or `0` when unavailable.
 */
const getGamepadButtonValue = (gamepad: Gamepad, button: number): number => {
  const gamepadButton = gamepad.buttons[button];

  if (gamepadButton === undefined) {
    return 0;
  }

  if (gamepadButton.value !== 0) {
    return gamepadButton.value;
  }

  return gamepadButton.pressed ? 1 : 0;
};

/**
 * Gamepad input state reader for gameplay, menus, and custom actions.
 *
 * Call {@link update} once per frame before reading button transitions or axes.
 */
export class GamepadInput extends EventDispatcher<GamepadInputEventMap> {
  /**
   * When `false`, polling through `update()` is paused and the last observed
   * state, including button transitions, is retained. Browser listeners remain
   * active and may adopt or disconnect a gamepad; connection events may poll.
   * @default true
   */
  public enabled = true;

  readonly #manager: GamepadManager;
  readonly #options: GamepadInputOptions;
  readonly #pressedButtons: Set<number>;
  readonly #previousPressedButtons: Set<number>;

  // Bound browser connection listener kept so it can be removed in `dispose()`.
  readonly #onGamepadConnected: (event: GamepadEvent) => void;

  // Bound browser disconnection listener kept so it can be removed in `dispose()`.
  readonly #onGamepadDisconnected: (event: GamepadEvent) => void;

  #gamepad: Gamepad | null = null;

  /**
   * Creates a gamepad input reader.
   *
   * @param options - Optional overrides for the default input behavior.
   * @throws {RangeError} When `gamepadIndex` is not an integer from
   * `MIN_GAMEPAD_INDEX` through `MAX_GAMEPAD_INDEX`.
   */
  constructor(options?: Partial<GamepadInputOptions>) {
    super();

    this.#options = {
      ...DEFAULT_GAMEPAD_INPUT_OPTIONS,
      ...options,
    };
    this.#manager = new GamepadManager({
      gamepadIndex: this.#options.gamepadIndex,
    });
    this.#pressedButtons = new Set();
    this.#previousPressedButtons = new Set();

    this.#onGamepadConnected = this.#handleGamepadConnectedEvent.bind(this);
    this.#onGamepadDisconnected =
      this.#handleGamepadDisconnectedEvent.bind(this);

    window.addEventListener("gamepadconnected", this.#onGamepadConnected);
    window.addEventListener("gamepaddisconnected", this.#onGamepadDisconnected);
  }

  /**
   * Forwards a browser connection event to the active-gamepad adoption logic.
   *
   * @param event - Browser event containing the connected gamepad snapshot.
   */
  #handleGamepadConnectedEvent(event: GamepadEvent): void {
    this.#handleGamepadConnected(event.gamepad);
  }

  /**
   * Forwards a browser disconnection event to active-gamepad cleanup.
   *
   * @param event - Browser event containing the disconnected gamepad snapshot.
   */
  #handleGamepadDisconnectedEvent(event: GamepadEvent): void {
    this.#handleGamepadDisconnected(event.gamepad);
  }

  /**
   * The currently active gamepad, or `null` if no gamepad is connected.
   *
   * @returns The active gamepad snapshot, or `null`.
   */
  public get gamepad(): Gamepad | null {
    return this.#gamepad;
  }

  /**
   * Whether a gamepad is currently active.
   *
   * @returns `true` when a gamepad is active, otherwise `false`.
   */
  public get connected(): boolean {
    return this.#gamepad !== null;
  }

  /**
   * Mapping reported by the active gamepad, or `null` when none is active.
   *
   * @returns The active gamepad mapping, or `null`.
   */
  public get mapping(): GamepadMappingType | null {
    return this.#gamepad?.mapping ?? null;
  }

  /**
   * Raw active gamepad snapshot, or `null` if no gamepad is connected.
   *
   * @returns The raw active gamepad snapshot, or `null`.
   */
  public get rawGamepad(): Gamepad | null {
    return this.#gamepad;
  }

  /**
   * Whether the active gamepad exposes a callable primary vibration actuator.
   *
   * This does not guarantee support for every {@link GamepadHapticEffectType}.
   *
   * @returns `true` when vibration effects can be requested.
   */
  public get vibrationSupported(): boolean {
    return isGamepadVibrationSupported(this.#gamepad);
  }

  /**
   * Polls the gamepad and refreshes current and previous button state.
   *
   * Resuming compares against the last observed state, without replaying clicks
   * completed during the pause. Adoption seeds held buttons without transitions.
   */
  public update(): void {
    if (!this.enabled) {
      return;
    }

    const { gamepad, connected, disconnected } = this.#manager.update();

    if (connected !== null) {
      this.#gamepad = gamepad;
      this.#syncButtonState({ seedPrevious: true });
      this.dispatchEvent({
        type: "connected",
        gamepad: connected,
      });
      return;
    }

    if (disconnected !== null) {
      this.#gamepad = null;
      this.#clearButtonState();
      this.dispatchEvent({
        type: "disconnected",
        gamepad: disconnected,
      });
      return;
    }

    this.#gamepad = gamepad;
    this.#syncButtonState({ seedPrevious: false });
  }

  /**
   * Removes this reader's window listeners, clears its state, and disables it.
   * Does not dispatch a synthetic disconnection or affect other input readers.
   * Reusing a disposed reader is unsupported; create a new instance instead.
   */
  public dispose(): void {
    window.removeEventListener("gamepadconnected", this.#onGamepadConnected);
    window.removeEventListener(
      "gamepaddisconnected",
      this.#onGamepadDisconnected,
    );
    this.#manager.activeGamepad = null;
    this.#gamepad = null;
    this.#clearButtonState();
    this.enabled = false;
  }

  /**
   * Returns whether a button is currently pressed.
   *
   * @param button - Button index to inspect.
   * @returns `true` when the button is currently pressed, otherwise `false`.
   */
  public isPressed(button: number): boolean {
    return this.#pressedButtons.has(button);
  }

  /**
   * Returns whether a button changed to pressed in the latest observed state.
   * Paused updates retain this result until the next observation or cleanup.
   *
   * @param button - Button index to inspect.
   * @returns Whether the latest observed button state transitioned to pressed.
   */
  public wasPressed(button: number): boolean {
    return (
      this.#pressedButtons.has(button) &&
      !this.#previousPressedButtons.has(button)
    );
  }

  /**
   * Returns whether a button changed to released in the latest observed state.
   * Paused updates retain this result until the next observation or cleanup.
   *
   * @param button - Button index to inspect.
   * @returns Whether the latest observed button state transitioned to released.
   */
  public wasReleased(button: number): boolean {
    return (
      !this.#pressedButtons.has(button) &&
      this.#previousPressedButtons.has(button)
    );
  }

  /**
   * Returns the current analog value for a button.
   *
   * @param button - Button index to inspect.
   * @returns The button value, `1` for pressed digital buttons, or `0`.
   */
  public buttonValue(button: number): number {
    if (this.#gamepad === null) {
      return 0;
    }

    return getGamepadButtonValue(this.#gamepad, button);
  }

  /**
   * Returns the current value of an axis after dead zone processing.
   *
   * @param axis - Axis index to inspect.
   * @param options - Optional per-read axis options.
   * @returns Axis value after dead zone processing, or `0` when unavailable.
   */
  public axis(axis: number, options?: GamepadAxisOptions): number {
    const value = this.#gamepad?.axes[axis] ?? 0;

    return applyGamepadAxisDeadzone(value, this.#getAxisDeadzone(options));
  }

  /**
   * Returns a two-axis stick after applying a stateless processing pipeline.
   *
   * @param xAxis - Horizontal axis index.
   * @param yAxis - Vertical axis index.
   * @param pipeline - Optional pipeline replacing the instance default.
   * @returns Object containing processed `x` and `y` values.
   */
  public stick(
    xAxis: number,
    yAxis: number,
    pipeline?: GamepadStickPipeline,
  ): GamepadStick {
    const x = this.#gamepad?.axes[xAxis] ?? 0;
    const y = this.#gamepad?.axes[yAxis] ?? 0;

    return (pipeline ?? this.#options.stickPipeline).process({
      x,
      y,
    });
  }

  /**
   * Plays an effect through the active gamepad's primary vibration actuator.
   *
   * Missing browser, gamepad, or effect support is treated as a safe no-op.
   * Environmental failures such as a hidden document are also ignored.
   * Invalid parameters and unexpected failures remain rejected.
   *
   * @param type - Haptic effect type to play.
   * @param parameters - Optional parameters describing the effect.
   * @returns The browser result, or `null` when the effect is ignored.
   */
  public playVibrationEffect(
    type: GamepadHapticEffectType,
    parameters?: GamepadEffectParameters,
  ): Promise<GamepadHapticsResult | null> {
    return playGamepadVibrationEffect(this.#gamepad, type, parameters);
  }

  /**
   * Stops the active effect on the gamepad's primary vibration actuator.
   *
   * Missing or temporarily unavailable haptics are treated as a safe no-op.
   * Unexpected failures remain rejected.
   *
   * @returns The browser result, or `null` when reset is ignored.
   */
  public resetVibration(): Promise<GamepadHapticsResult | null> {
    return resetGamepadVibration(this.#gamepad);
  }

  /**
   * Handles a browser connection event and adopts the gamepad when possible.
   *
   * Button state is seeded as both current and previous so an already-held
   * button does not produce a synthetic `wasPressed` transition on connect.
   *
   * @param gamepad - Browser-provided connected gamepad snapshot.
   */
  #handleGamepadConnected(gamepad: Gamepad): void {
    const connectedGamepad = this.#manager.connect(gamepad);

    if (connectedGamepad === null) {
      return;
    }

    this.#gamepad = connectedGamepad;
    this.#syncButtonState({ seedPrevious: true });
    this.dispatchEvent({
      type: "connected",
      gamepad: connectedGamepad,
    });
  }

  /**
   * Handles a browser disconnection event for the active gamepad.
   *
   * Button state is cleared instead of diffed so disconnecting a controller
   * does not produce synthetic `wasReleased` transitions.
   *
   * @param gamepad - Browser-provided disconnected gamepad snapshot.
   */
  #handleGamepadDisconnected(gamepad: Gamepad): void {
    const disconnectedGamepad = this.#manager.disconnect(gamepad);

    if (disconnectedGamepad === null) {
      return;
    }

    this.#gamepad = null;
    this.#clearButtonState();
    this.dispatchEvent({
      type: "disconnected",
      gamepad: disconnectedGamepad,
    });
  }

  /**
   * Refreshes current and previous pressed-button sets from the active snapshot.
   *
   * When `seedPrevious` is `true`, the refreshed current state is copied into
   * the previous state. This intentionally suppresses transition events on the
   * first frame after adopting a gamepad.
   *
   * @param options - Button state synchronization options.
   * @param options.seedPrevious - Whether to seed previous state from current state.
   */
  #syncButtonState({ seedPrevious }: SyncButtonStateOptions): void {
    this.#previousPressedButtons.clear();

    for (const button of this.#pressedButtons) {
      this.#previousPressedButtons.add(button);
    }

    this.#pressedButtons.clear();

    if (this.#gamepad !== null) {
      for (let index = 0; index < this.#gamepad.buttons.length; index += 1) {
        if (getGamepadButtonPressed(this.#gamepad, index)) {
          this.#pressedButtons.add(index);
        }
      }
    }

    if (!seedPrevious) {
      return;
    }

    this.#previousPressedButtons.clear();

    for (const button of this.#pressedButtons) {
      this.#previousPressedButtons.add(button);
    }
  }

  // Clears all stored button state.
  #clearButtonState(): void {
    this.#pressedButtons.clear();
    this.#previousPressedButtons.clear();
  }

  /**
   * Resolves the dead zone for a single-axis read.
   *
   * @param options - Optional per-read axis options.
   * @returns The per-read dead zone when provided, otherwise the instance default.
   */
  #getAxisDeadzone(options: GamepadAxisOptions | undefined): number {
    return options?.deadzone ?? this.#options.axisDeadzone;
  }
}
