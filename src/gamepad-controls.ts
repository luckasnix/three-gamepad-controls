import { EventDispatcher } from "three";

import { GamepadManager } from "./gamepad-manager.ts";

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
 * Abstract base class for Three.js gamepad controls.
 *
 * Handles the gamepad connection lifecycle and input polling so subclasses
 * only need to implement {@link onUpdate}.
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

  readonly #manager: GamepadManager;

  /**
   * Bound browser connection listener kept so it can be removed in {@link dispose}.
   */
  readonly #onGamepadConnected: (event: GamepadEvent) => void;

  /**
   * Bound browser disconnection listener kept so it can be removed in {@link dispose}.
   */
  readonly #onGamepadDisconnected: (event: GamepadEvent) => void;

  /**
   * Creates the base gamepad lifecycle manager and attaches browser listeners.
   */
  constructor() {
    super();

    this.#manager = new GamepadManager();

    this.#onGamepadConnected = this.#handleGamepadConnectedEvent.bind(this);
    this.#onGamepadDisconnected =
      this.#handleGamepadDisconnectedEvent.bind(this);

    window.addEventListener("gamepadconnected", this.#onGamepadConnected);
    window.addEventListener("gamepaddisconnected", this.#onGamepadDisconnected);
  }

  /**
   * Forwards a browser connection event to the overridable lifecycle hook.
   *
   * @param event - Browser event containing the connected gamepad snapshot.
   */
  #handleGamepadConnectedEvent(event: GamepadEvent): void {
    this.onGamepadConnected(event.gamepad);
  }

  /**
   * Forwards a browser disconnection event to the overridable lifecycle hook.
   *
   * @param event - Browser event containing the disconnected gamepad snapshot.
   */
  #handleGamepadDisconnectedEvent(event: GamepadEvent): void {
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

    this.#manager.activeGamepad = this.gamepad;
    const { gamepad, connected, disconnected } = this.#manager.update();

    if (connected !== null) {
      this.#manager.activeGamepad = this.gamepad;
      this.onGamepadConnected(connected);
      this.#manager.activeGamepad = this.gamepad;
    } else if (disconnected !== null) {
      this.#manager.activeGamepad = this.gamepad;
      this.onGamepadDisconnected(disconnected);
      this.#manager.activeGamepad = this.gamepad;
      return;
    } else {
      this.gamepad = gamepad;
      this.#manager.activeGamepad = this.gamepad;
    }

    if (this.gamepad === null) {
      return;
    }

    this.onUpdate(deltaTime, this.gamepad);
  }

  /**
   * Removes all event listeners attached by this controller. Call when no longer needed.
   */
  public dispose(): void {
    window.removeEventListener("gamepadconnected", this.#onGamepadConnected);
    window.removeEventListener(
      "gamepaddisconnected",
      this.#onGamepadDisconnected,
    );
    this.gamepad = null;
    this.#manager.activeGamepad = null;
    this.enabled = false;
  }

  /**
   * Called every frame when a gamepad is available and `enabled` is `true`.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param gamepad - A fresh snapshot of the currently active gamepad.
   */
  protected abstract onUpdate(deltaTime: number, gamepad: Gamepad): void;

  /**
   * Called when any gamepad fires a `gamepadconnected` event.
   *
   * The default accepts the first gamepad that connects and dispatches `connected`.
   * Override to customize selection behavior.
   *
   * @param gamepad - The gamepad that just connected.
   */
  protected onGamepadConnected(gamepad: Gamepad): void {
    // Accept only the first gamepad, ignoring any additional ones.
    this.#manager.activeGamepad = this.gamepad;

    if (!this.#manager.connect(gamepad)) {
      return;
    }

    const connectedGamepad = this.#manager.activeGamepad;

    if (connectedGamepad === null) {
      return;
    }

    this.gamepad = connectedGamepad;
    this.dispatchEvent({
      type: "connected",
      gamepad: connectedGamepad,
    });
  }

  /**
   * Called when any gamepad fires a `gamepaddisconnected` event.
   *
   * The default clears `this.gamepad` and dispatches `disconnected` if the
   * disconnecting gamepad was the active one. Override to add custom cleanup.
   *
   * @param gamepad - The gamepad that just disconnected.
   */
  protected onGamepadDisconnected(gamepad: Gamepad): void {
    this.#manager.activeGamepad = this.gamepad;
    const disconnectedGamepad = this.#manager.disconnect(gamepad);

    if (disconnectedGamepad === null) {
      return;
    }

    this.gamepad = this.#manager.activeGamepad;
    this.dispatchEvent({
      type: "disconnected",
      gamepad: disconnectedGamepad,
    });
  }
}
