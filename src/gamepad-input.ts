import { EventDispatcher } from "three";

import {
  isGamepadVibrationSupported,
  playGamepadVibrationEffect,
  resetGamepadVibration,
} from "./gamepad-haptics.ts";
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
   * Fired when the active gamepad is disconnected or replaced in its slot.
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

  /**
   * Browser-assigned gamepad slot to use.
   *
   * When omitted, the connected gamepad with the lowest index is selected.
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

/**
 * Options for two-dimensional stick reads.
 */
export type GamepadStickOptions = GamepadAxisOptions & {
  /**
   * Dead zone shape for this read.
   *
   * `"axial"` processes each axis independently, while `"radial"` processes
   * the stick magnitude.
   * @default "axial"
   */
  deadzoneMode?: "axial" | "radial";

  /**
   * Whether to remap values outside the dead zone to the full output range.
   * @default false
   */
  rescale?: boolean;
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
  // Whether to copy current button state into previous state after syncing.
  seedPrevious: boolean;
};

const DEFAULT_GAMEPAD_INPUT_OPTIONS: GamepadInputOptions = {
  deadzone: 0.1,
};

/**
 * Applies a dead zone and remaps the remaining magnitude to `[0, 1]`.
 *
 * @param magnitude - Non-negative input magnitude.
 * @param threshold - Dead zone size.
 * @returns Rescaled magnitude, or `0` when inside a fully closed dead zone.
 */
const rescaleGamepadDeadzoneMagnitude = (
  magnitude: number,
  threshold: number,
): number => {
  if (magnitude <= threshold || threshold >= 1) {
    return 0;
  }

  return Math.min((magnitude - threshold) / (1 - threshold), 1);
};

/**
 * Applies an axial dead zone, optionally rescaling the remaining range.
 *
 * @param value - Raw axis value.
 * @param threshold - Dead zone size.
 * @param rescale - Whether to remap the remaining magnitude to `[0, 1]`.
 * @returns Processed signed axis value.
 */
const applyGamepadAxialDeadzone = (
  value: number,
  threshold: number,
  rescale: boolean,
): number => {
  const magnitude = Math.abs(value);

  if (magnitude < threshold) {
    return 0;
  }

  if (!rescale) {
    return value;
  }

  return (
    Math.sign(value) * rescaleGamepadDeadzoneMagnitude(magnitude, threshold)
  );
};

/**
 * Returns the stick unchanged, or centered if its magnitude is below the dead
 * zone `threshold`.
 *
 * @param x - Raw horizontal stick value.
 * @param y - Raw vertical stick value.
 * @param threshold - Radial dead zone size.
 * @param rescale - Whether to remap the remaining magnitude to `[0, 1]`.
 * @returns The processed stick, or `{ x: 0, y: 0 }` inside the dead zone.
 */
const applyGamepadRadialDeadzone = (
  x: number,
  y: number,
  threshold: number,
  rescale: boolean,
): GamepadStick => {
  const magnitude = Math.hypot(x, y);

  if (magnitude < threshold) {
    return {
      x: 0,
      y: 0,
    };
  }

  if (rescale) {
    const rescaledMagnitude = rescaleGamepadDeadzoneMagnitude(
      magnitude,
      threshold,
    );

    if (rescaledMagnitude === 0 || magnitude === 0) {
      return {
        x: 0,
        y: 0,
      };
    }

    const scale = rescaledMagnitude / magnitude;

    return {
      x: x * scale,
      y: y * scale,
    };
  }

  return {
    x,
    y,
  };
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

    return applyGamepadAxialDeadzone(value, this.#getDeadzone(options), false);
  }

  /**
   * Returns a two-axis stick after dead zone processing.
   *
   * @param xAxis - Horizontal axis index.
   * @param yAxis - Vertical axis index.
   * @param options - Optional per-read stick options.
   * @returns Object containing processed `x` and `y` values.
   */
  public stick(
    xAxis: number,
    yAxis: number,
    options?: GamepadStickOptions,
  ): GamepadStick {
    const rescale = options?.rescale ?? false;
    const threshold = this.#getDeadzone(options);
    const x = this.#gamepad?.axes[xAxis] ?? 0;
    const y = this.#gamepad?.axes[yAxis] ?? 0;

    if (options?.deadzoneMode === "radial") {
      return applyGamepadRadialDeadzone(x, y, threshold, rescale);
    }

    return {
      x: applyGamepadAxialDeadzone(x, threshold, rescale),
      y: applyGamepadAxialDeadzone(y, threshold, rescale),
    };
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
   * Resolves the dead zone for a single axis or stick read.
   *
   * @param options - Optional per-read axis options.
   * @returns The per-read dead zone when provided, otherwise the instance default.
   */
  #getDeadzone(options: GamepadAxisOptions | undefined): number {
    return options?.deadzone ?? this.#options.deadzone;
  }
}
