import { EventDispatcher } from "three";

import { GamepadManager } from "./gamepad-manager.ts";

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
   * Fired when the active gamepad is disconnected.
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
   * Default axis dead zone threshold in the range `[0, 1]`.
   * @default 0.1
   */
  deadzone: number;
};

/**
 * Options for axis and stick reads.
 */
export type GamepadAxisOptions = {
  /**
   * Axis dead zone threshold for this read.
   */
  deadzone?: number;
};

/**
 * Two-dimensional stick input after dead zone processing.
 */
export type GamepadStick = {
  /**
   * Horizontal stick value.
   */
  x: number;

  /**
   * Vertical stick value.
   */
  y: number;
};

type SyncButtonStateOptions = {
  /**
   * Whether to copy current button state into previous state after syncing.
   */
  seedPrevious: boolean;
};

const DEFAULT_GAMEPAD_INPUT_OPTIONS: GamepadInputOptions = {
  deadzone: 0.1,
};

/**
 * Returns `value` unchanged, or `0` if below the dead zone `threshold`.
 *
 * Kept private to this module because `GamepadInput` is the only public API
 * that currently exposes processed axis values.
 *
 * @param value - Raw axis or trigger value, typically in `[-1, 1]`.
 * @param threshold - Dead zone size; values below this magnitude are zeroed.
 * @returns The original value when outside the dead zone, otherwise `0`.
 */
const applyGamepadDeadzone = (value: number, threshold: number): number => {
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
   * When `false`, input polling is paused.
   * @default true
   */
  public enabled = true;

  readonly #manager: GamepadManager;
  readonly #options: GamepadInputOptions;
  readonly #pressedButtons: Set<number>;
  readonly #previousPressedButtons: Set<number>;

  /**
   * Bound browser connection listener kept so it can be removed in {@link dispose}.
   */
  readonly #onGamepadConnected: (event: GamepadEvent) => void;

  /**
   * Bound browser disconnection listener kept so it can be removed in {@link dispose}.
   */
  readonly #onGamepadDisconnected: (event: GamepadEvent) => void;

  #gamepad: Gamepad | null = null;

  /**
   * Creates a gamepad input reader.
   *
   * @param options - Optional overrides for the default input behavior.
   */
  constructor(options?: Partial<GamepadInputOptions>) {
    super();

    this.#manager = new GamepadManager();
    this.#options = {
      ...DEFAULT_GAMEPAD_INPUT_OPTIONS,
      ...options,
    };
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
   * Polls the gamepad and refreshes current and previous button state.
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
   * Removes all window-level event listeners attached by this input reader.
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
   * Returns whether a button was pressed during the latest update.
   *
   * @param button - Button index to inspect.
   * @returns `true` only on the frame where the button transitions to pressed.
   */
  public wasPressed(button: number): boolean {
    return (
      this.#pressedButtons.has(button) &&
      !this.#previousPressedButtons.has(button)
    );
  }

  /**
   * Returns whether a button was released during the latest update.
   *
   * @param button - Button index to inspect.
   * @returns `true` only on the frame where the button transitions to released.
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
    return applyGamepadDeadzone(value, this.#getDeadzone(options));
  }

  /**
   * Returns a two-axis stick after dead zone processing.
   *
   * @param xAxis - Horizontal axis index.
   * @param yAxis - Vertical axis index.
   * @param options - Optional per-read axis options.
   * @returns Object containing processed `x` and `y` values.
   */
  public stick(
    xAxis: number,
    yAxis: number,
    options?: GamepadAxisOptions,
  ): GamepadStick {
    return {
      x: this.axis(xAxis, options),
      y: this.axis(yAxis, options),
    };
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
    if (!this.#manager.connect(gamepad)) {
      return;
    }

    this.#gamepad = this.#manager.activeGamepad;
    this.#syncButtonState({ seedPrevious: true });
    this.dispatchEvent({
      type: "connected",
      gamepad,
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

  /**
   * Clears all stored button state.
   */
  #clearButtonState(): void {
    this.#pressedButtons.clear();
    this.#previousPressedButtons.clear();
  }

  /**
   * Resolves the dead zone for a single axis or stick read.
   *
   * @param options - Optional per-read axis options.
   * @returns The per-read dead zone when provided, otherwise the instance default.
   */
  #getDeadzone(options: GamepadAxisOptions | undefined): number {
    return options?.deadzone ?? this.#options.deadzone;
  }
}
