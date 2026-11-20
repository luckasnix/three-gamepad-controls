/** Absolute pressure thresholds for a gamepad button action. */
export type GamepadButtonHysteresisOptions = {
  /** Pressure at or above which a released action becomes pressed. */
  pressPoint: number;
  /** Pressure at or below which a pressed action becomes released. */
  releasePoint: number;
};

/**
 * Tracks a button action with separate thresholds for pressing and releasing.
 * Create one instance per action and player.
 */
export class GamepadButtonHysteresis {
  readonly #pressPoint: number;
  readonly #releasePoint: number;
  #pressed: boolean | undefined;
  #previousPressed = false;

  /**
   * @param options - Absolute press and release thresholds.
   * @throws {RangeError} Unless both thresholds are finite and
   * `0 <= releasePoint < pressPoint <= 1`.
   */
  constructor(options: GamepadButtonHysteresisOptions) {
    const pressPoint = options?.pressPoint;
    const releasePoint = options?.releasePoint;
    if (
      !Number.isFinite(pressPoint) ||
      !Number.isFinite(releasePoint) ||
      releasePoint < 0 ||
      releasePoint >= pressPoint ||
      pressPoint > 1
    ) {
      throw new RangeError(
        "Button thresholds must be finite and satisfy 0 <= releasePoint < pressPoint <= 1",
      );
    }
    this.#pressPoint = pressPoint;
    this.#releasePoint = releasePoint;
  }

  /** Whether the action is currently pressed. */
  public get isPressed(): boolean {
    return this.#pressed ?? false;
  }

  /** Whether the latest observation changed the action to pressed. */
  public get wasPressed(): boolean {
    return this.#pressed === true && !this.#previousPressed;
  }

  /** Whether the latest observation changed the action to released. */
  public get wasReleased(): boolean {
    return this.#pressed === false && this.#previousPressed;
  }

  /**
   * Records a new pressure observation. The first sample sets the initial
   * state without a transition. Each later sample replaces the previous
   * transition, even when the pressure is unchanged.
   * @param value - Absolute button pressure between 0 and 1.
   * @throws {RangeError} When the pressure is non-finite or outside [0, 1].
   */
  public update(value: number): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(
        "Button pressure must be finite and between 0 and 1",
      );
    }
    const pressed = this.#pressed
      ? value > this.#releasePoint
      : value >= this.#pressPoint;
    this.#previousPressed = this.#pressed ?? pressed;
    this.#pressed = pressed;
  }

  /** Clears the current observation and both transition flags. */
  public reset(): void {
    this.#pressed = undefined;
    this.#previousPressed = false;
  }
}
