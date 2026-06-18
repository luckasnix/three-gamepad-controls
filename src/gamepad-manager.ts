/**
 * Result returned after polling the current gamepad state.
 *
 * At most one transition is reported per update: either `connected` or
 * `disconnected`. The `gamepad` field always reflects the active snapshot
 * after the transition has been applied.
 */
export type GamepadManagerUpdateResult = {
  /**
   * Fresh active gamepad snapshot, or `null` when no gamepad is active.
   */
  gamepad: Gamepad | null;

  /**
   * Gamepad discovered during this update, or `null` when none connected.
   */
  connected: Gamepad | null;

  /**
   * Previously active gamepad that was lost during this update, or `null`.
   */
  disconnected: Gamepad | null;
};

const EMPTY_UPDATE_RESULT: GamepadManagerUpdateResult = {
  gamepad: null,
  connected: null,
  disconnected: null,
};

/**
 * Internal input core that owns active gamepad polling and snapshot refresh.
 *
 * This class intentionally tracks only one active gamepad. Higher-level
 * multi-gamepad selection should be built on top of this lifecycle in a
 * later phase.
 *
 * @internal
 */
export class GamepadManager {
  /**
   * The active gamepad snapshot, or `null` when none is active.
   */
  public activeGamepad: Gamepad | null = null;

  /**
   * Accepts a gamepad as active when no active gamepad exists.
   *
   * Additional connected gamepads are ignored so the current controls keep
   * using the first active device by default.
   *
   * @param gamepad - Gamepad snapshot to activate.
   * @returns `true` when the gamepad became active, otherwise `false`.
   */
  public connect(gamepad: Gamepad): boolean {
    if (this.activeGamepad !== null || !gamepad.connected) {
      return false;
    }

    this.activeGamepad = gamepad;
    return true;
  }

  /**
   * Clears the active gamepad when it matches the disconnecting gamepad index.
   *
   * @param gamepad - Gamepad snapshot that disconnected.
   * @returns The previously active gamepad when it was cleared, otherwise `null`.
   */
  public disconnect(gamepad: Gamepad): Gamepad | null {
    if (this.activeGamepad?.index !== gamepad.index) {
      return null;
    }

    const disconnectedGamepad = this.activeGamepad;
    this.activeGamepad = null;
    return disconnectedGamepad;
  }

  /**
   * Polls the Gamepad API and refreshes the active gamepad snapshot.
   *
   * The browser exposes gamepad state as snapshots, so polling must replace
   * the stored reference before controls read axes or buttons.
   *
   * @returns The active gamepad and any connect/disconnect transition found.
   */
  public update(): GamepadManagerUpdateResult {
    if (this.activeGamepad === null) {
      const connectedGamepad = this.#getFirstConnectedGamepad();

      if (connectedGamepad === null) {
        return EMPTY_UPDATE_RESULT;
      }

      this.activeGamepad = connectedGamepad;
      return {
        gamepad: connectedGamepad,
        connected: connectedGamepad,
        disconnected: null,
      };
    }

    const previousGamepad = this.activeGamepad;
    const nextGamepad = this.#getGamepadByIndex(previousGamepad.index);

    if (nextGamepad === null) {
      this.activeGamepad = null;
      return {
        gamepad: null,
        connected: null,
        disconnected: previousGamepad,
      };
    }

    this.activeGamepad = nextGamepad;
    return {
      gamepad: nextGamepad,
      connected: null,
      disconnected: null,
    };
  }

  /**
   * Reads the latest connected gamepad snapshot at a known index.
   *
   * @param index - Browser-assigned gamepad index to refresh.
   * @returns A connected gamepad snapshot, or `null` if it is gone.
   */
  #getGamepadByIndex(index: number): Gamepad | null {
    const gamepad = navigator.getGamepads()[index] ?? null;
    return gamepad?.connected === true ? gamepad : null;
  }

  /**
   * Finds the first currently connected gamepad snapshot.
   *
   * @returns The first connected gamepad snapshot, or `null` if none exist.
   */
  #getFirstConnectedGamepad(): Gamepad | null {
    for (const gamepad of navigator.getGamepads()) {
      if (gamepad?.connected === true) {
        return gamepad;
      }
    }

    return null;
  }
}
