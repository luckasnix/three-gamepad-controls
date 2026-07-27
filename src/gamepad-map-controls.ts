import type { MapControls } from "three/addons/controls/MapControls.js";

import { GAMEPAD_AXIS } from "./core.ts";
import {
  GamepadOrbitControls,
  type GamepadOrbitControlsOptions,
} from "./gamepad-orbit-controls.ts";

// Binding overrides: left stick pans and right stick orbits.
const DEFAULT_MAP_OPTIONS: Partial<GamepadOrbitControlsOptions> = {
  panStick: {
    xAxis: GAMEPAD_AXIS.LeftX,
    yAxis: GAMEPAD_AXIS.LeftY,
  },
  rotateStick: {
    xAxis: GAMEPAD_AXIS.RightX,
    yAxis: GAMEPAD_AXIS.RightY,
  },
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
      panStick: {
        ...DEFAULT_MAP_OPTIONS.panStick,
        ...options?.panStick,
      },
      rotateStick: {
        ...DEFAULT_MAP_OPTIONS.rotateStick,
        ...options?.rotateStick,
      },
    });
  }
}
