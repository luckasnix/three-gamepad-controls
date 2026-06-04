import type { MapControls } from "three/addons/controls/MapControls.js";

import { GAMEPAD_AXIS } from "./core.ts";
import {
  GamepadOrbitControls,
  type GamepadOrbitControlsOptions,
} from "./gamepad-orbit-controls.ts";

/**
 * Axis overrides for {@link GamepadMapControls}: left stick pans, right stick orbits.
 */
const DEFAULT_MAP_OPTIONS: Partial<GamepadOrbitControlsOptions> = {
  axisPanX: GAMEPAD_AXIS.LeftX,
  axisPanY: GAMEPAD_AXIS.LeftY,
  axisRotateX: GAMEPAD_AXIS.RightX,
  axisRotateY: GAMEPAD_AXIS.RightY,
};

/**
 * Adds gamepad support to Three.js `MapControls`.
 *
 * Pan is the primary action (left stick by default), matching `MapControls`'
 * mouse conventions. All options from {@link GamepadOrbitControlsOptions} are available.
 *
 * Call `update()` inside the render loop **before** `MapControls.update()`.
 */
export class GamepadMapControls extends GamepadOrbitControls {
  /**
   * @param controls - A Three.js `MapControls` instance.
   * @param options - Optional overrides for the default behavior.
   *                  Any property not provided falls back to its default value.
   */
  constructor(
    controls: MapControls,
    options?: Partial<GamepadOrbitControlsOptions>,
  ) {
    super(controls, {
      ...DEFAULT_MAP_OPTIONS,
      ...options,
    });
  }
}
