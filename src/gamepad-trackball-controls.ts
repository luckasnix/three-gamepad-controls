import type { Vector2 } from "three";
import type { TrackballControls } from "three/addons/controls/TrackballControls.js";

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

/**
 * Configuration for {@link GamepadTrackballControls}.
 *
 * Every property has a sensible default, so you only need to pass the properties you want to override.
 */
export type GamepadTrackballControlsOptions = GamepadControlsOptions & {
  /**
   * Multiplier on `TrackballControls.rotateSpeed` for rotation.
   * @default 1.0
   */
  rotateSpeed: number;

  /**
   * Multiplier on `TrackballControls.panSpeed` for panning.
   * @default 1.0
   */
  panSpeed: number;

  /**
   * Multiplier on `TrackballControls.zoomSpeed` for zooming.
   * @default 1.0
   */
  zoomSpeed: number;

  /**
   * Stick binding used for trackball rotation.
   * @default Left stick with the default stick pipeline
   */
  rotateStick: GamepadStickBindingOptions;

  /**
   * Stick binding used for panning.
   * @default Right stick with the default stick pipeline
   */
  panStick: GamepadStickBindingOptions;

  /**
   * Each analog trigger must be strictly above this threshold before subtraction.
   * @default 0.1
   */
  buttonDeadzone: number;

  /**
   * Button index for zooming **in** (analog trigger value used for proportional zoom).
   * @default 7 - Right trigger
   */
  buttonZoomIn: number;

  /**
   * Button index for zooming **out** (analog trigger value used for proportional zoom).
   * @default 6 - Left trigger
   */
  buttonZoomOut: number;
};

type ResolvedGamepadTrackballControlsOptions = Omit<
  GamepadTrackballControlsOptions,
  "rotateStick" | "panStick"
> & {
  rotateStick: GamepadStickBinding;
  panStick: GamepadStickBinding;
};

/**
 * Rotation, pan, and signed zoom components used to resolve one input frame.
 * Before acceptance, values are processed sticks and filtered zoom-out minus
 * zoom-in triggers; after acceptance, they are native pointer-coordinate deltas.
 */
type TrackballInput = {
  rotateX: number;
  rotateY: number;
  panX: number;
  panY: number;
  zoom: number;
};

// Default options merged in the constructor when no explicit configuration is provided.
const DEFAULT_TRACKBALL_OPTIONS: ResolvedGamepadTrackballControlsOptions = {
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
  buttonZoomIn: GAMEPAD_BUTTON.RightTrigger,
  buttonZoomOut: GAMEPAD_BUTTON.LeftTrigger,
};

type TrackballControlsWithInput = TrackballControls & {
  // Current normalized pointer position used for rotation.
  _moveCurr: Vector2;

  // Current normalized pointer position used for zoom damping.
  _zoomEnd: Vector2;

  // Current normalized pointer position used for pan damping.
  _panEnd: Vector2;
};

/**
 * Adds gamepad support to Three.js `TrackballControls`.
 *
 * Call `update()` inside the render loop **before** `TrackballControls.update()`.
 * Bindings and speed multipliers are configurable via {@link GamepadTrackballControlsOptions}.
 * The wrapper dispatches balanced gamepad `start` and `end` events on the native
 * controls; the native update applies speeds and damping and dispatches `change`.
 */
export class GamepadTrackballControls extends GamepadControls {
  readonly #controls: TrackballControlsWithInput;
  readonly #options: ResolvedGamepadTrackballControlsOptions;
  /** Whether this wrapper owns an active gamepad interaction. */
  #interacting = false;
  /** Blocks recursive updates while a frame is being processed. */
  #updating = false;
  /** Blocks recursive updates while the owned interaction is ending. */
  #ending = false;

  /**
   * @param controls - A Three.js `TrackballControls` instance.
   * @param options - Optional overrides for the default behavior.
   *                  Any property not provided falls back to its default value.
   */
  constructor(
    controls: TrackballControls,
    options?: Partial<GamepadTrackballControlsOptions>,
  ) {
    super(options);
    this.#controls = controls as TrackballControlsWithInput;
    this.#options = {
      ...DEFAULT_TRACKBALL_OPTIONS,
      ...options,
      rotateStick: resolveGamepadStickBinding(
        DEFAULT_TRACKBALL_OPTIONS.rotateStick,
        options?.rotateStick,
      ),
      panStick: resolveGamepadStickBinding(
        DEFAULT_TRACKBALL_OPTIONS.panStick,
        options?.panStick,
      ),
    };
  }

  /**
   * Polls the gamepad and queues input, ignoring updates from synchronous listeners.
   * Pausing through `enabled` retains the owned interaction until input resumes,
   * the gamepad disconnects, or the wrapper is disposed.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  public override update(deltaTime: number): void {
    if (this.#updating || this.#ending) return;
    this.#updating = true;
    try {
      super.update(deltaTime);
    } finally {
      this.#updating = false;
    }
  }

  /**
   * Reads each binding once, manages the gamepad session, and adds accepted deltas
   * to native pointer vectors. Revalidates permissions after the `start` event.
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
      buttonZoomIn,
      buttonZoomOut,
    } = this.#options;
    const input = this.gamepadInput;
    const rotate = input.stick(
      rotateStick.xAxis,
      rotateStick.yAxis,
      rotateStick.pipeline,
    );
    const pan = input.stick(panStick.xAxis, panStick.yAxis, panStick.pipeline);
    const triggerIn = input.buttonValue(buttonZoomIn);
    const triggerOut = input.buttonValue(buttonZoomOut);
    const zoom =
      (triggerOut > buttonDeadzone ? triggerOut : 0) -
      (triggerIn > buttonDeadzone ? triggerIn : 0);
    const frame: TrackballInput = {
      rotateX: rotate.x,
      rotateY: rotate.y,
      panX: pan.x,
      panY: pan.y,
      zoom,
    };
    let actions = this.#acceptActions(frame, deltaTime);
    if (actions === null) return;
    if (!this.#interacting) {
      this.#interacting = true;
      this.#controls.dispatchEvent({ type: "start" });
      actions = this.#acceptActions(frame, deltaTime);
      if (actions === null) return;
    }
    // Native speeds are consumed by Trackball itself. Only gate on them here;
    // scaling the queued deltas by those speeds would apply them twice.
    const controls = this.#controls;
    controls._moveCurr.x += actions.rotateX;
    controls._moveCurr.y -= actions.rotateY;
    controls._panEnd.x += actions.panX;
    controls._panEnd.y += actions.panY;
    controls._zoomEnd.y += actions.zoom;
  }

  /**
   * Removes gamepad listeners and ends only this wrapper's active interaction.
   * Repeated calls are safe; native pointer vectors and damping are preserved.
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
   * Resolves a cached frame against current permissions, wrapper speeds, and damping.
   * Native speeds only gate acceptance here; Trackball applies them during its update.
   * Native disable or lack of actionable input ends the owned session; a wrapper
   * pause stops application while retaining it. Geometric limits do not erase intent.
   *
   * @param input - Already processed sticks and independently filtered trigger difference.
   * @param delta - Frame duration in seconds.
   * @returns Accepted pointer-coordinate deltas, or `null` when application must stop.
   */
  #acceptActions(input: TrackballInput, delta: number): TrackballInput | null {
    const controls = this.#controls;

    if (!controls.enabled) {
      this.#endInteraction();
      return null;
    }

    if (!this.enabled || this.gamepad === null) return null;

    const damping = controls.staticMoving ? 1 : controls.dynamicDampingFactor;
    const rotate =
      !controls.noRotate && controls.rotateSpeed !== 0
        ? this.#options.rotateSpeed * delta * Math.PI
        : 0;
    const pan =
      !controls.noPan && controls.panSpeed !== 0
        ? this.#options.panSpeed * delta * damping
        : 0;
    const zoom =
      !controls.noZoom && controls.zoomSpeed !== 0
        ? this.#options.zoomSpeed * delta * damping
        : 0;
    const actions: TrackballInput = {
      rotateX: input.rotateX * rotate,
      rotateY: input.rotateY * rotate,
      panX: input.panX * pan,
      panY: input.panY * pan,
      zoom: input.zoom * zoom,
    };

    if (!Object.values(actions).some((value) => value !== 0)) {
      this.#endInteraction();
      return null;
    }

    return actions;
  }

  /**
   * Releases session ownership before dispatching the native `end` event once.
   * Blocks recursive updates during finalization without clearing native pointer vectors.
   */
  #endInteraction(): void {
    if (!this.#interacting) return;
    this.#interacting = false;
    this.#ending = true;
    try {
      this.#controls.dispatchEvent({ type: "end" });
    } finally {
      this.#ending = false;
    }
  }
}
