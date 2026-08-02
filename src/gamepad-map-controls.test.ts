import { PerspectiveCamera } from "three";
import { MapControls } from "three/addons/controls/MapControls.js";
import { describe, expect, vi } from "vitest";

import {
  createGamepad,
  createGamepadButtons,
} from "../test/fixtures/gamepad.ts";
import {
  type GamepadPollingFixture,
  gamepadTest,
} from "../test/fixtures/gamepad-browser.ts";
import { GamepadMapControls } from "./gamepad-map-controls.ts";
import type { GamepadOrbitControlsOptions } from "./gamepad-orbit-controls.ts";
import {
  type GamepadStick,
  gamepadStickPipeline,
} from "./gamepad-stick-processing.ts";

const createMapControls = () => {
  const controls = new MapControls(new PerspectiveCamera());

  return {
    controls,
    dollyIn: vi.spyOn(controls, "dollyIn").mockImplementation(() => {}),
    dollyOut: vi.spyOn(controls, "dollyOut").mockImplementation(() => {}),
    pan: vi.spyOn(controls, "pan").mockImplementation(() => {}),
    rotateLeft: vi.spyOn(controls, "rotateLeft").mockImplementation(() => {}),
    rotateUp: vi.spyOn(controls, "rotateUp").mockImplementation(() => {}),
  };
};

type MapControlsFixture = ReturnType<typeof createMapControls>;

let controlsInstances: GamepadMapControls[];
let polling: GamepadPollingFixture;

const createControls = (
  mapControls: MapControls,
  options?: Partial<GamepadOrbitControlsOptions>,
): GamepadMapControls => {
  const controls = new GamepadMapControls(mapControls, options);

  controlsInstances.push(controls);

  return controls;
};

const expectMapActionsNotToHaveBeenCalled = (
  mapFixture: MapControlsFixture,
): void => {
  expect(mapFixture.rotateLeft).not.toHaveBeenCalled();
  expect(mapFixture.rotateUp).not.toHaveBeenCalled();
  expect(mapFixture.pan).not.toHaveBeenCalled();
  expect(mapFixture.dollyIn).not.toHaveBeenCalled();
  expect(mapFixture.dollyOut).not.toHaveBeenCalled();
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

describe("GamepadMapControls construction", () => {
  gamepadTest("forwards gamepad selection options to the base controls", () => {
    const mapFixture = createMapControls();

    expect(() =>
      createControls(mapFixture.controls, { gamepadIndex: -1 }),
    ).toThrow("gamepadIndex must be an integer");
  });

  gamepadTest(
    "merges partial stick bindings over the map-specific axes",
    () => {
      const mapFixture = createMapControls();
      const panTransform = vi.fn((_value: Readonly<GamepadStick>) => ({
        x: 0,
        y: 0,
      }));
      const rotateTransform = vi.fn((_value: Readonly<GamepadStick>) => ({
        x: 0,
        y: 0,
      }));
      const controls = createControls(mapFixture.controls, {
        panStick: {
          xAxis: 4,
          pipeline: gamepadStickPipeline().transform(panTransform),
        },
        rotateStick: {
          yAxis: 5,
          pipeline: gamepadStickPipeline().transform(rotateTransform),
        },
      });
      polling.gamepads[0] = createGamepad(0, {
        axes: [0, -0.2, 0.3, 0, 0.4, -0.5],
      });

      controls.update(0.1);

      expect(panTransform).toHaveBeenCalledExactlyOnceWith({
        x: 0.4,
        y: -0.2,
      });
      expect(rotateTransform).toHaveBeenCalledExactlyOnceWith({
        x: 0.3,
        y: -0.5,
      });
      expectMapActionsNotToHaveBeenCalled(mapFixture);
    },
  );
});

describe("GamepadMapControls default bindings", () => {
  gamepadTest(
    "uses the left stick to pan, right stick to rotate, and triggers to dolly",
    () => {
      const mapFixture = createMapControls();
      const controls = createControls(mapFixture.controls);
      polling.gamepads[0] = createGamepad(0, {
        axes: [0.4, -0.2, 0.3, -0.5],
        buttons: createGamepadButtons([6, false, 0.2], [7, false, 0.6]),
      });

      controls.update(0.2);

      expect(mapFixture.rotateLeft).toHaveBeenCalledOnce();
      expect(mapFixture.rotateLeft.mock.calls[0][0]).toBeCloseTo(
        0.06 * Math.PI,
      );
      expect(mapFixture.rotateUp).toHaveBeenCalledOnce();
      expect(mapFixture.rotateUp.mock.calls[0][0]).toBeCloseTo(-0.1 * Math.PI);
      expect(mapFixture.pan).toHaveBeenCalledOnce();
      expect(mapFixture.pan.mock.calls[0][0]).toBeCloseTo(40);
      expect(mapFixture.pan.mock.calls[0][1]).toBeCloseTo(-20);
      expect(mapFixture.dollyIn).toHaveBeenCalledOnce();
      expect(mapFixture.dollyIn.mock.calls[0][0]).toBeCloseTo(1 / 1.12);
      expect(mapFixture.dollyOut).toHaveBeenCalledOnce();
      expect(mapFixture.dollyOut.mock.calls[0][0]).toBeCloseTo(1 / 1.04);
    },
  );

  gamepadTest("ignores stick and trigger input within their dead zones", () => {
    const mapFixture = createMapControls();
    const controls = createControls(mapFixture.controls);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0.05, -0.05, 0.05, -0.05],
      buttons: createGamepadButtons([6, false, 0.1], [7, false, 0.1]),
    });

    controls.update(0.2);

    expectMapActionsNotToHaveBeenCalled(mapFixture);
  });
});

describe("GamepadMapControls options", () => {
  gamepadTest("applies custom speeds, buttons, and button dead zone", () => {
    const mapFixture = createMapControls();
    const controls = createControls(mapFixture.controls, {
      buttonDeadzone: 0.4,
      buttonDollyIn: 1,
      buttonDollyOut: 2,
      panSpeed: 1.5,
      rotateSpeed: 2,
      zoomSpeed: 3,
    });
    polling.gamepads[0] = createGamepad(0, {
      axes: [0.4, -0.2, 0.3, -0.5],
      buttons: createGamepadButtons([1, false, 0.4], [2, false, 0.6]),
    });

    controls.update(0.25);

    expect(mapFixture.rotateLeft).toHaveBeenCalledOnce();
    expect(mapFixture.rotateLeft.mock.calls[0][0]).toBeCloseTo(0.15 * Math.PI);
    expect(mapFixture.rotateUp).toHaveBeenCalledOnce();
    expect(mapFixture.rotateUp.mock.calls[0][0]).toBeCloseTo(-0.25 * Math.PI);
    expect(mapFixture.pan).toHaveBeenCalledOnce();
    expect(mapFixture.pan.mock.calls[0][0]).toBeCloseTo(75);
    expect(mapFixture.pan.mock.calls[0][1]).toBeCloseTo(-37.5);
    expect(mapFixture.dollyIn).not.toHaveBeenCalled();
    expect(mapFixture.dollyOut).toHaveBeenCalledOnce();
    expect(mapFixture.dollyOut.mock.calls[0][0]).toBeCloseTo(1 / 1.45);
  });
});
