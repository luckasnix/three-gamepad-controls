import { EventDispatcher } from "three";

import { getFirstConnectedGamepad, getGamepadByIndex } from "./utils.ts";

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
    gamepad: Gamepad;
  };

  /**
   * Fired when the active gamepad is disconnected.
   */
  disconnected: {
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

  // Bound handler references kept so they can be removed in `dispose()`.
  readonly #onGamepadConnected: (event: GamepadEvent) => void;
  readonly #onGamepadDisconnected: (event: GamepadEvent) => void;

  constructor() {
    super();

    this.#onGamepadConnected = (event: GamepadEvent) => {
      this.onGamepadConnected(event.gamepad);
    };

    this.#onGamepadDisconnected = (event: GamepadEvent) => {
      this.onGamepadDisconnected(event.gamepad);
    };

    window.addEventListener("gamepadconnected", this.#onGamepadConnected);
    window.addEventListener("gamepaddisconnected", this.#onGamepadDisconnected);
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

    // Always fetch a fresh snapshot. The Web Gamepad API does not push updates.
    if (this.gamepad === null) {
      const connectedGamepad = getFirstConnectedGamepad();

      if (connectedGamepad !== null) {
        this.onGamepadConnected(connectedGamepad);
      }
    } else {
      const previousGamepad = this.gamepad;
      const nextGamepad = getGamepadByIndex(previousGamepad.index);

      if (nextGamepad === null) {
        this.onGamepadDisconnected(previousGamepad);
        return;
      }

      this.gamepad = nextGamepad;
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
    if (this.gamepad !== null) {
      return;
    }

    this.gamepad = gamepad;
    this.dispatchEvent({
      type: "connected",
      gamepad,
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
    if (this.gamepad?.index !== gamepad.index) {
      return;
    }

    const disconnected = this.gamepad;
    this.gamepad = null;
    this.dispatchEvent({
      type: "disconnected",
      gamepad: disconnected,
    });
  }
}
