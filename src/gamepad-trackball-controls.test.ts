import { PerspectiveCamera, Vector2 } from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { describe, expect, vi } from "vitest";

import {
  createGamepad,
  createGamepadButtons,
} from "../test/fixtures/gamepad.ts";
import {
  type GamepadPollingFixture,
  gamepadTest,
} from "../test/fixtures/gamepad-browser.ts";
import {
  type GamepadStick,
  gamepadStickPipeline,
} from "./gamepad-stick-processing.ts";
import {
  GamepadTrackballControls,
  type GamepadTrackballControlsOptions,
} from "./gamepad-trackball-controls.ts";

type TrackballControlsWithInput = TrackballControls & {
  _lastAngle: number;
  _movePrev: Vector2;
  _moveCurr: Vector2;
  _zoomStart: Vector2;
  _zoomEnd: Vector2;
  _panStart: Vector2;
  _panEnd: Vector2;
};

const createTrackballControls = (): TrackballControlsWithInput =>
  new TrackballControls(new PerspectiveCamera()) as TrackballControlsWithInput;

let controlsInstances: GamepadTrackballControls[];
let polling: GamepadPollingFixture;

const createControls = (
  trackballControls: TrackballControls,
  options?: Partial<GamepadTrackballControlsOptions>,
): GamepadTrackballControls => {
  const controls = new GamepadTrackballControls(trackballControls, options);

  controlsInstances.push(controls);

  return controls;
};

gamepadTest.beforeEach(({ gamepadPolling }) => {
  controlsInstances = [];
  polling = gamepadPolling;
});

gamepadTest.afterEach(() => {
  for (const controls of controlsInstances) {
    controls.dispose();
  }
});

describe("GamepadTrackballControls construction", () => {
  gamepadTest("forwards gamepad selection options to the base controls", () => {
    const trackballControls = createTrackballControls();

    expect(() =>
      createControls(trackballControls, { gamepadIndex: -1 }),
    ).toThrow("gamepadIndex must be an integer");
  });

  gamepadTest(
    "merges partial stick bindings and applies their pipelines",
    () => {
      const trackballControls = createTrackballControls();
      const rotateTransform = vi.fn((_value: Readonly<GamepadStick>) => ({
        x: 0,
        y: 0,
      }));
      const panTransform = vi.fn((_value: Readonly<GamepadStick>) => ({
        x: 0,
        y: 0,
      }));
      const controls = createControls(trackballControls, {
        rotateStick: {
          xAxis: 4,
          pipeline: gamepadStickPipeline().transform(rotateTransform),
        },
        panStick: {
          yAxis: 5,
          pipeline: gamepadStickPipeline().transform(panTransform),
        },
      });
      polling.gamepads[0] = createGamepad(0, {
        axes: [0, -0.2, 0.3, 0, 0.4, -0.5],
      });

      controls.update(0.1);

      expect(rotateTransform).toHaveBeenCalledExactlyOnceWith({
        x: 0.4,
        y: -0.2,
      });
      expect(panTransform).toHaveBeenCalledExactlyOnceWith({
        x: 0.3,
        y: -0.5,
      });
    },
  );
});

describe("GamepadTrackballControls input gating", () => {
  gamepadTest("ignores stick and trigger input within their dead zones", () => {
    const trackballControls = createTrackballControls();
    const controls = createControls(trackballControls);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0.05, -0.05, 0.05, -0.05],
      buttons: createGamepadButtons([6, false, 0.1], [7, false, 0.1]),
    });

    controls.update(0.2);

    expect(trackballControls._moveCurr).toEqual(new Vector2());
    expect(trackballControls._panEnd).toEqual(new Vector2());
    expect(trackballControls._zoomEnd).toEqual(new Vector2());
  });

  gamepadTest("synchronizes native state while actions are disabled", () => {
    const trackballControls = createTrackballControls();
    trackballControls.noRotate = true;
    trackballControls.noPan = true;
    trackballControls.noZoom = true;
    trackballControls._movePrev.set(-0.1, -0.2);
    trackballControls._moveCurr.set(0.3, 0.4);
    trackballControls._lastAngle = 0.7;
    trackballControls._panStart.set(-0.2, -0.3);
    trackballControls._panEnd.set(0.5, 0.6);
    trackballControls._zoomStart.set(-0.4, -0.5);
    trackballControls._zoomEnd.set(0.7, 0.8);
    const controls = createControls(trackballControls);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0.5, -0.5, 0.5, -0.5],
      buttons: createGamepadButtons([6, false, 0.8], [7, false, 0.6]),
    });

    controls.update(0.2);

    expect(trackballControls._movePrev).toEqual(trackballControls._moveCurr);
    expect(trackballControls._lastAngle).toBe(0);
    expect(trackballControls._panStart).toEqual(trackballControls._panEnd);
    expect(trackballControls._zoomStart).toEqual(trackballControls._zoomEnd);
  });
});

describe("GamepadTrackballControls queued input", () => {
  gamepadTest("queues default rotation, pan, and zoom with damping", () => {
    const trackballControls = createTrackballControls();
    const controls = createControls(trackballControls);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0.5, -0.25, 0.4, -0.2],
      buttons: createGamepadButtons([6, false, 0.2], [7, false, 0.6]),
    });

    controls.update(0.2);

    expect(trackballControls._moveCurr.x).toBeCloseTo(0.1 * Math.PI);
    expect(trackballControls._moveCurr.y).toBeCloseTo(0.05 * Math.PI);
    expect(trackballControls._panEnd.x).toBeCloseTo(0.016);
    expect(trackballControls._panEnd.y).toBeCloseTo(-0.008);
    expect(trackballControls._zoomEnd.y).toBeCloseTo(-0.016);
  });

  gamepadTest("queues input when only vertical stick axes are active", () => {
    const trackballControls = createTrackballControls();
    const controls = createControls(trackballControls);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0, 0.5, 0, -0.5],
    });

    controls.update(0.2);

    expect(trackballControls._moveCurr.x).toBe(0);
    expect(trackballControls._moveCurr.y).toBeCloseTo(-0.1 * Math.PI);
    expect(trackballControls._panEnd.x).toBe(0);
    expect(trackballControls._panEnd.y).toBeCloseTo(-0.02);
  });
});

describe("GamepadTrackballControls options", () => {
  gamepadTest(
    "applies custom speeds, buttons, dead zone, and static movement",
    () => {
      const trackballControls = createTrackballControls();
      trackballControls.staticMoving = true;
      const controls = createControls(trackballControls, {
        buttonDeadzone: 0.4,
        buttonZoomIn: 1,
        buttonZoomOut: 2,
        panSpeed: 1.5,
        rotateSpeed: 2,
        zoomSpeed: 3,
      });
      polling.gamepads[0] = createGamepad(0, {
        axes: [0.3, -0.5, 0.4, -0.2],
        buttons: createGamepadButtons([2, false, 0.6]),
      });

      controls.update(0.25);

      expect(trackballControls._moveCurr.x).toBeCloseTo(0.15 * Math.PI);
      expect(trackballControls._moveCurr.y).toBeCloseTo(0.25 * Math.PI);
      expect(trackballControls._panEnd.x).toBeCloseTo(0.15);
      expect(trackballControls._panEnd.y).toBeCloseTo(-0.075);
      expect(trackballControls._zoomEnd.y).toBeCloseTo(0.45);
    },
  );

  gamepadTest(
    "uses the remapped zoom-in button and configured button dead zone",
    () => {
      const trackballControls = createTrackballControls();
      const controls = createControls(trackballControls, {
        buttonDeadzone: 0.4,
        buttonZoomIn: 1,
      });
      polling.gamepads[0] = createGamepad(0, {
        buttons: createGamepadButtons([1, false, 0.4]),
      });

      controls.update(0.25);

      expect(trackballControls._zoomEnd).toEqual(new Vector2());
    },
  );
});
