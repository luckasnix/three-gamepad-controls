import { EventDispatcher } from "three";

import {
  GamepadInput,
  type GamepadInputEventMap,
  type GamepadInputOptions,
} from "./gamepad-input.ts";

// `EventDispatcher` listeners add `type` and `target` to the event-specific
// fields in `GamepadInputEventMap`, keeping this private bridge fully typed.
type GamepadInputConnectedEvent = GamepadInputEventMap["connected"] & {
  readonly type: "connected";
  readonly target: GamepadInput;
};

// Private equivalent of `GamepadInputConnectedEvent` for disconnection events.
type GamepadInputDisconnectedEvent = GamepadInputEventMap["disconnected"] & {
  readonly type: "disconnected";
  readonly target: GamepadInput;
};

/**
 * Event map for {@link GamepadControls}.
 *
 * Each key is an event name, and its value is the extra data included in the event object
 * alongside the standard `type` and `target` fields.
 */
export type GamepadControlsEventMap = {
  /**
   * Fired when a gamepad is connected and set as the active gamepad.
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
 * Shared configuration for Three.js gamepad control wrappers.
 */
export type GamepadControlsOptions = Pick<GamepadInputOptions, "gamepadIndex">;

/**
 * Abstract base class for Three.js gamepad controls.
 *
 * Delegates gamepad connection lifecycle and input polling to {@link GamepadInput}
 * so subclasses can focus on mapping input to the wrapped Three.js control.
 */
export abstract class GamepadControls extends EventDispatcher<GamepadControlsEventMap> {
  /**
   * When `false`, all input processing is paused.
   * @default true
   */
  public enabled = true;

  /**
   * The currently active gamepad, or `null` if no gamepad is connected.
   */
  public gamepad: Gamepad | null = null;

  readonly #gamepadInput: GamepadInput;

  // Bound input connection listener kept so it can be removed in `dispose()`.
  readonly #onGamepadConnected: (event: GamepadInputConnectedEvent) => void;

  // Bound input disconnection listener kept so it can be removed in `dispose()`.
  readonly #onGamepadDisconnected: (
    event: GamepadInputDisconnectedEvent,
  ) => void;

  /**
   * Creates the base input reader and attaches lifecycle listeners.
   *
   * @param options - Shared gamepad selection options.
   * @throws {RangeError} When `gamepadIndex` is not an integer in the inclusive
   * range `[0, 2147483647]`.
   */
  constructor(options?: GamepadControlsOptions) {
    super();

    this.#gamepadInput = new GamepadInput(options);

    this.#onGamepadConnected = this.#handleGamepadConnected.bind(this);
    this.#onGamepadDisconnected = this.#handleGamepadDisconnected.bind(this);

    this.#gamepadInput.addEventListener("connected", this.#onGamepadConnected);
    this.#gamepadInput.addEventListener(
      "disconnected",
      this.#onGamepadDisconnected,
    );
  }

  /**
   * Low-level gamepad input reader used by subclasses.
   *
   * @returns The shared input reader for the active gamepad.
   */
  protected get gamepadInput(): GamepadInput {
    return this.#gamepadInput;
  }

  /**
   * Forwards an input connection event to the overridable lifecycle hook.
   *
   * @param event - Input event containing the connected gamepad snapshot.
   */
  #handleGamepadConnected(event: GamepadInputConnectedEvent): void {
    this.gamepad = this.#gamepadInput.gamepad;
    this.onGamepadConnected(event.gamepad);
  }

  /**
   * Forwards an input disconnection event to the overridable lifecycle hook.
   *
   * @param event - Input event containing the disconnected gamepad snapshot.
   */
  #handleGamepadDisconnected(event: GamepadInputDisconnectedEvent): void {
    this.gamepad = this.#gamepadInput.gamepad;
    this.onGamepadDisconnected(event.gamepad);
  }

  /**
   * Advances the controller by one frame. Call this inside your render loop.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  public update(deltaTime: number): void {
    if (!this.enabled) {
      return;
    }

    this.#gamepadInput.update();
    this.gamepad = this.#gamepadInput.gamepad;

    if (this.gamepad === null) {
      return;
    }

    this.onUpdate(deltaTime);
  }

  /**
   * Removes all event listeners attached by this controller. Call when no longer needed.
   */
  public dispose(): void {
    this.#gamepadInput.removeEventListener(
      "connected",
      this.#onGamepadConnected,
    );
    this.#gamepadInput.removeEventListener(
      "disconnected",
      this.#onGamepadDisconnected,
    );
    this.#gamepadInput.dispose();
    this.gamepad = null;
    this.enabled = false;
  }

  /**
   * Called every frame when a gamepad is available and `enabled` is `true`.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  protected abstract onUpdate(deltaTime: number): void;

  /**
   * Called when a gamepad becomes active through the shared input reader.
   *
   * The default dispatches a `connected` event.
   *
   * @param gamepad - The gamepad that became active.
   */
  protected onGamepadConnected(gamepad: Gamepad): void {
    this.dispatchEvent({
      type: "connected",
      gamepad,
    });
  }

  /**
   * Called when the active gamepad disconnects or is replaced through the
   * shared input reader.
   *
   * The default dispatches a `disconnected` event.
   *
   * @param gamepad - The gamepad that was active before disconnection.
   */
  protected onGamepadDisconnected(gamepad: Gamepad): void {
    this.dispatchEvent({
      type: "disconnected",
      gamepad,
    });
  }
}
