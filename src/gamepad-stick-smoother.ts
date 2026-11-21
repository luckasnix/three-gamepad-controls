import type { GamepadStick } from "./gamepad-stick-processing.ts";

/** Timing for one player's stick action. */
export type GamepadStickSmootherOptions = {
  /** Seconds to cover half the remaining distance to a constant target. */
  halfLifeSeconds: number;
};

const interpolate = (from: number, to: number, weight: number): number => {
  const difference = to - from;
  if (!Number.isFinite(difference)) {
    // Opposite finite extremes can overflow when subtracted.
    return (1 - weight) * from + weight * to;
  }
  // Work from the nearer endpoint to retain precision as the weight approaches 0 or 1.
  return weight <= 0.5
    ? from + weight * difference
    : to - (1 - weight) * difference;
};

/** Smooths processed stick samples over time. Create one per action and player. */
export class GamepadStickSmoother {
  readonly #halfLifeSeconds: number;
  #x = 0;
  #y = 0;

  /** @throws {RangeError} Unless the half-life is finite and positive. */
  constructor(options: GamepadStickSmootherOptions) {
    const halfLifeSeconds = options?.halfLifeSeconds;
    if (!Number.isFinite(halfLifeSeconds) || halfLifeSeconds <= 0) {
      throw new RangeError("halfLifeSeconds must be finite and positive");
    }
    this.#halfLifeSeconds = halfLifeSeconds;
  }

  /**
   * Advances toward the target and returns an independent copy of the result.
   * A zero interval holds the current value. A neutral target with a positive
   * interval immediately returns the action to rest.
   * @param target - Processed stick value before sensitivity is applied.
   * @param deltaSeconds - Elapsed time in seconds since the last update.
   * @throws {RangeError} For non-finite components or a negative or non-finite interval.
   */
  public update(
    target: Readonly<GamepadStick>,
    deltaSeconds: number,
  ): GamepadStick {
    const { x, y } = target;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError("stick components must be finite numbers");
    }
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError("deltaSeconds must be finite and non-negative");
    }

    if (deltaSeconds > 0) {
      if (x === 0 && y === 0) {
        this.reset();
      } else {
        const weight = -Math.expm1(
          -Math.LN2 * (deltaSeconds / this.#halfLifeSeconds),
        );
        this.#x = interpolate(this.#x, x, weight);
        this.#y = interpolate(this.#y, y, weight);
      }
    }
    return { x: this.#x, y: this.#y };
  }

  /** Clears the action's history and returns both components to zero. */
  public reset(): void {
    this.#x = 0;
    this.#y = 0;
  }
}
