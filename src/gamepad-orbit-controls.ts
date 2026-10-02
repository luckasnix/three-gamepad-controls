import type { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { GAMEPAD_AXIS, GAMEPAD_BUTTON } from "./core.ts";
import {
  GamepadControls,
  type GamepadControlsOptions,
} from "./gamepad-controls.ts";
import {
  DEFAULT_GAMEPAD_STICK_PIPELINE,
  type GamepadStickBinding,
  type GamepadStickBindingOptions,
  resolveGamepadStickBinding,
} from "./gamepad-stick-processing.ts";

/** Processed stick values and individually filtered trigger values for one frame. */
type OrbitInput = {
  rotateX: number;
  rotateY: number;
  panX: number;
  panY: number;
  dollyIn: number;
  dollyOut: number;
};

/**
 * Accepted frame deltas after applying permissions and combined speed multipliers.
 * Rotation is in radians, pan is in pixels, and dolly values are dimensionless
 * amounts converted to native scale factors when applied.
 */
type OrbitActions = OrbitInput;

/**
 * Configuration for {@link GamepadOrbitControls}.
 *
 * Every property has a sensible default, so you only need to pass the properties you want to override.
 */
export type GamepadOrbitControlsOptions = GamepadControlsOptions & {
  /**
   * Multiplier on `OrbitControls.rotateSpeed`.
   * @default 1.0
   */
  rotateSpeed: number;

  /**
   * Multiplier on `OrbitControls.panSpeed`.
   * @default 1.0
   */
  panSpeed: number;

  /**
   * Multiplier on `OrbitControls.zoomSpeed`.
   * @default 1.0
   */
  zoomSpeed: number;

  /**
   * Stick binding used for orbit rotation.
   * @default Left stick with the default stick pipeline
   */
  rotateStick: GamepadStickBindingOptions;

  /**
   * Stick binding used for panning.
   * @default Right stick with the default stick pipeline
   */
  panStick: GamepadStickBindingOptions;

  /**
   * Each analog trigger must be strictly above this threshold to drive dolly.
   * @default 0.1
   */
  buttonDeadzone: number;

  /**
   * Button index for zooming **in** (analog trigger value used for proportional zoom).
   * @default 7 — Right trigger
   */
  buttonDollyIn: number;

  /**
   * Button index for zooming **out** (analog trigger value used for proportional zoom).
   * @default 6 — Left trigger
   */
  buttonDollyOut: number;
};

type ResolvedGamepadOrbitControlsOptions = Omit<
  GamepadOrbitControlsOptions,
  "rotateStick" | "panStick"
> & {
  rotateStick: GamepadStickBinding;
  panStick: GamepadStickBinding;
};

// Default options merged in the constructor when no explicit configuration is provided.
const DEFAULT_ORBIT_OPTIONS: ResolvedGamepadOrbitControlsOptions = {
  rotateSpeed: 1.0,
  panSpeed: 1.0,
  zoomSpeed: 1.0,
  rotateStick: {
    xAxis: GAMEPAD_AXIS.LeftX,
    yAxis: GAMEPAD_AXIS.LeftY,
    pipeline: DEFAULT_GAMEPAD_STICK_PIPELINE,
  },
  panStick: {
    xAxis: GAMEPAD_AXIS.RightX,
    yAxis: GAMEPAD_AXIS.RightY,
    pipeline: DEFAULT_GAMEPAD_STICK_PIPELINE,
  },
  buttonDeadzone: 0.1,
  buttonDollyIn: GAMEPAD_BUTTON.RightTrigger,
  buttonDollyOut: GAMEPAD_BUTTON.LeftTrigger,
};

/**
 * Adds gamepad support to Three.js `OrbitControls`.
 *
 * Call `update()` inside the render loop **before** `OrbitControls.update()`.
 * Bindings and speeds are configurable via {@link GamepadOrbitControlsOptions}.
 * The wrapper dispatches balanced gamepad `start` and `end` events on the native
 * controls; native operations and damping remain responsible for `change`.
 */
export class GamepadOrbitControls extends GamepadControls {
  readonly #controls: OrbitControls;
  readonly #options: ResolvedGamepadOrbitControlsOptions;
  /** Whether this wrapper owns an active gamepad interaction. */
  #interacting = false;
  /** Blocks recursive updates while a frame is being processed. */
  #updating = false;
  /** Blocks recursive updates while the owned interaction is ending. */
  #ending = false;

  /**
   * @param controls - A Three.js `OrbitControls` instance.
   * @param options - Optional overrides for the default behavior.
   *                  Any property not provided falls back to its default value.
   */
  constructor(
    controls: OrbitControls,
    options?: Partial<GamepadOrbitControlsOptions>,
  ) {
    super(options);
    this.#controls = controls;
    this.#options = {
      ...DEFAULT_ORBIT_OPTIONS,
      ...options,
      rotateStick: resolveGamepadStickBinding(
        DEFAULT_ORBIT_OPTIONS.rotateStick,
        options?.rotateStick,
      ),
      panStick: resolveGamepadStickBinding(
        DEFAULT_ORBIT_OPTIONS.panStick,
        options?.panStick,
      ),
    };
  }

  /**
   * Polls the gamepad and applies input, ignoring updates from synchronous listeners.
   * Pausing through `enabled` retains the owned interaction until input resumes,
   * the gamepad disconnects, or the wrapper is disposed.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  public override update(deltaTime: number): void {
    if (this.#updating || this.#ending) {
      return;
    }
    this.#updating = true;
    try {
      super.update(deltaTime);
    } finally {
      this.#updating = false;
    }
  }

  /**
   * Reads each binding once, manages the gamepad session, and applies native operations.
   * Revalidates the cached frame after synchronous events can change permissions.
   *
   * @param deltaTime - Seconds elapsed for this input frame.
   */
  protected override onUpdate(deltaTime: number): void {
    if (!this.#controls.enabled) {
      this.#endInteraction();
      return;
    }
    const {
      rotateStick,
      panStick,
      buttonDeadzone,
      buttonDollyIn,
      buttonDollyOut,
    } = this.#options;
    const input = this.gamepadInput;
    const rotate = input.stick(
      rotateStick.xAxis,
      rotateStick.yAxis,
      rotateStick.pipeline,
    );
    const pan = input.stick(panStick.xAxis, panStick.yAxis, panStick.pipeline);
    const triggerIn = input.buttonValue(buttonDollyIn);
    const triggerOut = input.buttonValue(buttonDollyOut);
    const frame: OrbitInput = {
      rotateX: rotate.x,
      rotateY: rotate.y,
      panX: pan.x,
      panY: pan.y,
      dollyIn: triggerIn > buttonDeadzone ? triggerIn : 0,
      dollyOut: triggerOut > buttonDeadzone ? triggerOut : 0,
    };
    let actions = this.#acceptActions(frame, deltaTime);
    if (actions === null) {
      return;
    }
    if (!this.#interacting) {
      this.#interacting = true;
      this.#controls.dispatchEvent({ type: "start" });
      actions = this.#acceptActions(frame, deltaTime);
      if (actions === null) {
        return;
      }
    }

    // Public operations update synchronously; accept the remaining actions
    // again after each operation without reading the stick pipelines again.
    const controls = this.#controls;

    if (actions.rotateX !== 0) {
      controls.rotateLeft(actions.rotateX);
      actions = this.#acceptActions(frame, deltaTime);
      if (actions === null) {
        return;
      }
    }
    if (actions.rotateY !== 0) {
      controls.rotateUp(actions.rotateY);
      actions = this.#acceptActions(frame, deltaTime);
      if (actions === null) {
        return;
      }
    }
    if (actions.panX !== 0 || actions.panY !== 0) {
      controls.pan(actions.panX, actions.panY);
      actions = this.#acceptActions(frame, deltaTime);
      if (actions === null) {
        return;
      }
    }
    if (actions.dollyIn !== 0) {
      controls.dollyIn(1 / (1 + actions.dollyIn));
      actions = this.#acceptActions(frame, deltaTime);
      if (actions === null) {
        return;
      }
    }
    if (actions.dollyOut !== 0) {
      controls.dollyOut(1 / (1 + actions.dollyOut));
      this.#acceptActions(frame, deltaTime);
    }
  }

  /**
   * Removes gamepad listeners and ends only this wrapper's active interaction.
   * Repeated calls are safe; the native controls and their damping are preserved.
   */
  public override dispose(): void {
    super.dispose();
    this.#endInteraction();
  }

  /**
   * Ends the owned interaction before forwarding the active gamepad's disconnection.
   *
   * @param gamepad - The gamepad that just disconnected.
   */
  protected override onGamepadDisconnected(gamepad: Gamepad): void {
    this.#endInteraction();
    super.onGamepadDisconnected(gamepad);
  }

  /**
   * Resolves a cached frame against current permissions and native/wrapper speeds.
   * Native disable or lack of actionable input ends the owned session; a wrapper
   * pause stops application while retaining it. Geometric limits do not erase intent.
   *
   * @param input - Already processed sticks and filtered triggers for this frame.
   * @param delta - Frame duration in seconds.
   * @returns Accepted frame deltas, or `null` when input application must stop.
   */
  #acceptActions(input: OrbitInput, delta: number): OrbitActions | null {
    const controls = this.#controls;
    if (!controls.enabled) {
      this.#endInteraction();
      return null;
    }
    if (!this.enabled || this.gamepad === null) {
      return null;
    }
    const rotate = controls.enableRotate
      ? controls.rotateSpeed * this.#options.rotateSpeed * delta * Math.PI
      : 0;
    const pan = controls.enablePan
      ? controls.panSpeed * this.#options.panSpeed * delta * 500
      : 0;
    const zoom = controls.enableZoom
      ? controls.zoomSpeed * this.#options.zoomSpeed * delta
      : 0;
    const actions: OrbitActions = {
      rotateX: input.rotateX * rotate,
      rotateY: input.rotateY * rotate,
      panX: input.panX * pan,
      panY: input.panY * pan,
      dollyIn: input.dollyIn * zoom,
      dollyOut: input.dollyOut * zoom,
    };
    if (!Object.values(actions).some((value) => value !== 0)) {
      this.#endInteraction();
      return null;
    }
    return actions;
  }

  /**
   * Releases session ownership before dispatching the native `end` event once.
   * Blocks recursive updates during finalization without clearing native input or damping.
   */
  #endInteraction(): void {
    if (!this.#interacting) {
      return;
    }
    this.#interacting = false;
    this.#ending = true;
    try {
      this.#controls.dispatchEvent({ type: "end" });
    } finally {
      this.#ending = false;
    }
  }
}
