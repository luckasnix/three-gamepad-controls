import { PerspectiveCamera } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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
  GamepadOrbitControls,
  type GamepadOrbitControlsOptions,
} from "./gamepad-orbit-controls.ts";
import {
  type GamepadStick,
  gamepadStickPipeline,
} from "./gamepad-stick-processing.ts";

const createOrbitControls = () => {
  const controls = new OrbitControls(new PerspectiveCamera());

  return {
    controls,
    dollyIn: vi.spyOn(controls, "dollyIn").mockImplementation(() => {}),
    dollyOut: vi.spyOn(controls, "dollyOut").mockImplementation(() => {}),
    pan: vi.spyOn(controls, "pan").mockImplementation(() => {}),
    rotateLeft: vi.spyOn(controls, "rotateLeft").mockImplementation(() => {}),
    rotateUp: vi.spyOn(controls, "rotateUp").mockImplementation(() => {}),
  };
};

type OrbitControlsFixture = ReturnType<typeof createOrbitControls>;

let controlsInstances: GamepadOrbitControls[];
let polling: GamepadPollingFixture;

const createControls = (
  orbitControls: OrbitControls,
  options?: Partial<GamepadOrbitControlsOptions>,
): GamepadOrbitControls => {
  const controls = new GamepadOrbitControls(orbitControls, options);

  controlsInstances.push(controls);

  return controls;
};

const expectOrbitActionsNotToHaveBeenCalled = (
  orbitFixture: OrbitControlsFixture,
): void => {
  expect(orbitFixture.rotateLeft).not.toHaveBeenCalled();
  expect(orbitFixture.rotateUp).not.toHaveBeenCalled();
  expect(orbitFixture.pan).not.toHaveBeenCalled();
  expect(orbitFixture.dollyIn).not.toHaveBeenCalled();
  expect(orbitFixture.dollyOut).not.toHaveBeenCalled();
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

describe("GamepadOrbitControls construction", () => {
  gamepadTest("forwards gamepad selection options to the base controls", () => {
    const orbitFixture = createOrbitControls();

    expect(() =>
      createControls(orbitFixture.controls, { gamepadIndex: -1 }),
    ).toThrow("gamepadIndex must be an integer");
  });

  gamepadTest(
    "merges partial stick bindings over the orbit-specific axes",
    () => {
      const orbitFixture = createOrbitControls();
      const rotateTransform = vi.fn((_value: Readonly<GamepadStick>) => ({
        x: 0,
        y: 0,
      }));
      const panTransform = vi.fn((_value: Readonly<GamepadStick>) => ({
        x: 0,
        y: 0,
      }));
      const controls = createControls(orbitFixture.controls, {
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
      expectOrbitActionsNotToHaveBeenCalled(orbitFixture);
    },
  );
});

describe("GamepadOrbitControls default bindings", () => {
  gamepadTest(
    "uses the left stick to rotate, right stick to pan, and triggers to dolly",
    () => {
      const orbitFixture = createOrbitControls();
      const controls = createControls(orbitFixture.controls);
      polling.gamepads[0] = createGamepad(0, {
        axes: [0.3, -0.5, 0.4, -0.2],
        buttons: createGamepadButtons([6, false, 0.2], [7, false, 0.6]),
      });

      controls.update(0.2);

      expect(orbitFixture.rotateLeft).toHaveBeenCalledOnce();
      expect(orbitFixture.rotateLeft.mock.calls[0][0]).toBeCloseTo(
        0.06 * Math.PI,
      );
      expect(orbitFixture.rotateUp).toHaveBeenCalledOnce();
      expect(orbitFixture.rotateUp.mock.calls[0][0]).toBeCloseTo(
        -0.1 * Math.PI,
      );
      expect(orbitFixture.pan).toHaveBeenCalledOnce();
      expect(orbitFixture.pan.mock.calls[0][0]).toBeCloseTo(40);
      expect(orbitFixture.pan.mock.calls[0][1]).toBeCloseTo(-20);
      expect(orbitFixture.dollyIn).toHaveBeenCalledOnce();
      expect(orbitFixture.dollyIn.mock.calls[0][0]).toBeCloseTo(1 / 1.12);
      expect(orbitFixture.dollyOut).toHaveBeenCalledOnce();
      expect(orbitFixture.dollyOut.mock.calls[0][0]).toBeCloseTo(1 / 1.04);
    },
  );

  gamepadTest("pans when only the vertical pan axis is active", () => {
    const orbitFixture = createOrbitControls();
    const controls = createControls(orbitFixture.controls);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0, 0, 0, 0.5],
    });

    controls.update(0.2);

    expect(orbitFixture.pan).toHaveBeenCalledOnce();
    expect(orbitFixture.pan.mock.calls[0][0]).toBe(0);
    expect(orbitFixture.pan.mock.calls[0][1]).toBeCloseTo(50);
    expect(orbitFixture.rotateLeft).not.toHaveBeenCalled();
    expect(orbitFixture.rotateUp).not.toHaveBeenCalled();
  });

  gamepadTest("ignores stick and trigger input within their dead zones", () => {
    const orbitFixture = createOrbitControls();
    const controls = createControls(orbitFixture.controls);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0.05, -0.05, 0.05, -0.05],
      buttons: createGamepadButtons([6, false, 0.1], [7, false, 0.1]),
    });

    controls.update(0.2);

    expectOrbitActionsNotToHaveBeenCalled(orbitFixture);
  });
});

describe("GamepadOrbitControls options", () => {
  gamepadTest("applies custom speeds, buttons, and button dead zone", () => {
    const orbitFixture = createOrbitControls();
    const controls = createControls(orbitFixture.controls, {
      buttonDeadzone: 0.4,
      buttonDollyIn: 1,
      buttonDollyOut: 2,
      panSpeed: 1.5,
      rotateSpeed: 2,
      zoomSpeed: 3,
    });
    polling.gamepads[0] = createGamepad(0, {
      axes: [0.3, -0.5, 0.4, -0.2],
      buttons: createGamepadButtons([1, false, 0.4], [2, false, 0.6]),
    });

    controls.update(0.25);

    expect(orbitFixture.rotateLeft).toHaveBeenCalledOnce();
    expect(orbitFixture.rotateLeft.mock.calls[0][0]).toBeCloseTo(
      0.15 * Math.PI,
    );
    expect(orbitFixture.rotateUp).toHaveBeenCalledOnce();
    expect(orbitFixture.rotateUp.mock.calls[0][0]).toBeCloseTo(-0.25 * Math.PI);
    expect(orbitFixture.pan).toHaveBeenCalledOnce();
    expect(orbitFixture.pan.mock.calls[0][0]).toBeCloseTo(75);
    expect(orbitFixture.pan.mock.calls[0][1]).toBeCloseTo(-37.5);
    expect(orbitFixture.dollyIn).not.toHaveBeenCalled();
    expect(orbitFixture.dollyOut).toHaveBeenCalledOnce();
    expect(orbitFixture.dollyOut.mock.calls[0][0]).toBeCloseTo(1 / 1.45);
  });
});
