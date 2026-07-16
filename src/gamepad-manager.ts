import { MAX_GAMEPAD_INDEX, MIN_GAMEPAD_INDEX } from "./core.ts";

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

// Internal options for active gamepad selection.
export type GamepadManagerOptions = {
  // Browser-assigned gamepad index to use, or `undefined` for the first available gamepad.
  gamepadIndex?: number;
};

type GamepadSelection =
  | {
      // Selects the connected gamepad with the lowest browser-assigned index.
      type: "first-available";
    }
  | {
      // Selects one browser-assigned gamepad index.
      type: "index";

      // Browser-assigned gamepad index.
      index: number;
    };

const EMPTY_UPDATE_RESULT: GamepadManagerUpdateResult = {
  gamepad: null,
  connected: null,
  disconnected: null,
};

/**
 * Internal input core that owns active gamepad polling and snapshot refresh.
 *
 * Each manager instance tracks one active gamepad, optionally selected by its
 * browser-assigned `Gamepad.index`.
 *
 * @internal
 */
export class GamepadManager {
  // The active gamepad snapshot, or `null` when none is active.
  public activeGamepad: Gamepad | null = null;

  // Prevents a connection event from replacing a gamepad before the next poll
  // has observed the disconnected state.
  #connectionDeferredUntilUpdate = false;
  readonly #selection: GamepadSelection;

  /**
   * Creates an active-gamepad manager.
   *
   * @param options - Optional active gamepad selection options.
   * @throws {RangeError} When `gamepadIndex` is outside the valid Web IDL
   * `long` range for a gamepad index.
   */
  constructor(options?: GamepadManagerOptions) {
    this.#selection = this.#resolveSelection(options?.gamepadIndex);
  }

  /**
   * Uses a connection event to resolve and activate the configured gamepad.
   *
   * In first-available mode, the event is only a signal to inspect the complete
   * Gamepad API state. The connected gamepad with the lowest index is adopted,
   * which may differ from the gamepad carried by the event.
   * Connection events are deferred after losing an active gamepad so its
   * replacement can only be adopted by the next {@link update}.
   *
   * @param gamepad - Gamepad snapshot carried by the connection event.
   * @returns The gamepad that became active, or `null` when none was adopted.
   */
  public connect(gamepad: Gamepad): Gamepad | null {
    if (
      this.activeGamepad !== null ||
      this.#connectionDeferredUntilUpdate ||
      !gamepad.connected ||
      !this.#matchesSelection(gamepad)
    ) {
      return null;
    }

    const selectedGamepad = this.#getSelectableGamepad();

    if (selectedGamepad === null) {
      return null;
    }

    this.activeGamepad = selectedGamepad;
    return selectedGamepad;
  }

  /**
   * Clears the active gamepad when its browser-assigned index matches the
   * disconnecting gamepad.
   *
   * Gamepad API snapshots are not guaranteed to preserve JavaScript object
   * identity between events and polls, so the active device is correlated by
   * its logical slot. A matching disconnection defers any replacement until
   * the next update.
   *
   * @param gamepad - Gamepad snapshot that disconnected.
   * @returns The previously active gamepad when it was cleared, otherwise `null`.
   */
  public disconnect(gamepad: Gamepad): Gamepad | null {
    if (
      this.activeGamepad === null ||
      this.activeGamepad.index !== gamepad.index
    ) {
      return null;
    }

    const disconnectedGamepad = this.activeGamepad;
    this.activeGamepad = null;
    this.#connectionDeferredUntilUpdate = true;
    return disconnectedGamepad;
  }

  /**
   * Polls the Gamepad API and refreshes the active gamepad snapshot.
   *
   * Polling re-resolves the browser slot so a disconnected device, a reused
   * index, or an updated active device is observed before controls read input.
   *
   * @returns The active gamepad and any connect/disconnect transition found.
   */
  public update(): GamepadManagerUpdateResult {
    if (this.activeGamepad === null) {
      this.#connectionDeferredUntilUpdate = false;
      const connectedGamepad = this.#getSelectableGamepad();

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
      this.#connectionDeferredUntilUpdate = true;
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
   * Finds the connected gamepad matching the configured selection.
   *
   * @returns A selectable gamepad snapshot, or `null` if none is available.
   */
  #getSelectableGamepad(): Gamepad | null {
    if (this.#selection.type === "index") {
      return this.#getGamepadByIndex(this.#selection.index);
    }

    return this.#getFirstAvailableGamepad();
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
   * Finds the connected gamepad with the lowest browser-assigned index.
   *
   * The array is normally sparse and ordered by index, but comparing the
   * reported indices keeps the selection deterministic for API mocks as well.
   *
   * @returns The lowest-index connected gamepad, or `null` if none exist.
   */
  #getFirstAvailableGamepad(): Gamepad | null {
    let firstAvailableGamepad: Gamepad | null = null;

    for (const gamepad of navigator.getGamepads()) {
      if (
        gamepad?.connected === true &&
        (firstAvailableGamepad === null ||
          gamepad.index < firstAvailableGamepad.index)
      ) {
        firstAvailableGamepad = gamepad;
      }
    }

    return firstAvailableGamepad;
  }

  /**
   * Checks whether a connection event is relevant to this manager.
   *
   * @param gamepad - Gamepad snapshot carried by the event.
   * @returns `true` when the event may trigger configured selection.
   */
  #matchesSelection(gamepad: Gamepad): boolean {
    if (this.#selection.type === "index") {
      return gamepad.index === this.#selection.index;
    }

    return true;
  }

  /**
   * Resolves a public index option to an immutable internal selection mode.
   *
   * @param gamepadIndex - Browser-assigned gamepad index option.
   * @returns Internal active-gamepad selection mode.
   * @throws {RangeError} When the explicit index is not an integer in the
   * inclusive range [{@link MIN_GAMEPAD_INDEX}, {@link MAX_GAMEPAD_INDEX}].
   */
  #resolveSelection(gamepadIndex: number | undefined): GamepadSelection {
    if (gamepadIndex === undefined) {
      return { type: "first-available" };
    }

    if (
      !Number.isInteger(gamepadIndex) ||
      gamepadIndex < MIN_GAMEPAD_INDEX ||
      gamepadIndex > MAX_GAMEPAD_INDEX
    ) {
      throw new RangeError(
        `gamepadIndex must be an integer between ${MIN_GAMEPAD_INDEX} and ${MAX_GAMEPAD_INDEX}.`,
      );
    }

    return {
      type: "index",
      index: gamepadIndex,
    };
  }
}
