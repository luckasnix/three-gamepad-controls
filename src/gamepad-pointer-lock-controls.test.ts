import { Euler, PerspectiveCamera, Quaternion } from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { describe, expect, vi } from "vitest";

import { createGamepad } from "../test/fixtures/gamepad.ts";
import {
  type GamepadPollingFixture,
  gamepadTest,
} from "../test/fixtures/gamepad-browser.ts";
import {
  GamepadPointerLockControls,
  type GamepadPointerLockControlsOptions,
} from "./gamepad-pointer-lock-controls.ts";
import {
  type GamepadStick,
  gamepadStickPipeline,
} from "./gamepad-stick-processing.ts";

const createPointerLockControls = (): PointerLockControls =>
  new PointerLockControls(new PerspectiveCamera());

const expectQuaternionToBeCloseTo = (
  actual: Quaternion,
  expected: Quaternion,
): void => {
  expect(actual.angleTo(expected)).toBeCloseTo(0);
};

let controlsInstances: GamepadPointerLockControls[];
let polling: GamepadPollingFixture;

const createControls = (
  pointerLockControls: PointerLockControls,
  options?: Partial<GamepadPointerLockControlsOptions>,
): GamepadPointerLockControls => {
  const controls = new GamepadPointerLockControls(pointerLockControls, options);

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

describe("GamepadPointerLockControls construction", () => {
  gamepadTest("forwards gamepad selection options to the base controls", () => {
    const pointerLockControls = createPointerLockControls();

    expect(() =>
      createControls(pointerLockControls, { gamepadIndex: -1 }),
    ).toThrow("gamepadIndex must be an integer");
  });

  gamepadTest(
    "merges partial stick bindings and applies their pipelines",
    () => {
      const pointerLockControls = createPointerLockControls();
      const moveTransform = vi.fn((_value: Readonly<GamepadStick>) => ({
        x: 0,
        y: 0,
      }));
      const lookTransform = vi.fn((_value: Readonly<GamepadStick>) => ({
        x: 0,
        y: 0,
      }));
      const controls = createControls(pointerLockControls, {
        moveStick: {
          xAxis: 4,
          pipeline: gamepadStickPipeline().transform(moveTransform),
        },
        lookStick: {
          yAxis: 5,
          pipeline: gamepadStickPipeline().transform(lookTransform),
        },
      });
      polling.gamepads[0] = createGamepad(0, {
        axes: [0, -0.2, 0.3, 0, 0.4, -0.5],
      });

      controls.update(0.1);

      expect(moveTransform).toHaveBeenCalledExactlyOnceWith({
        x: 0.4,
        y: -0.2,
      });
      expect(lookTransform).toHaveBeenCalledExactlyOnceWith({
        x: 0.3,
        y: -0.5,
      });
    },
  );
});

describe("GamepadPointerLockControls input gating", () => {
  gamepadTest(
    "ignores movement and look input within the stick dead zones",
    () => {
      const pointerLockControls = createPointerLockControls();
      const moveForward = vi.spyOn(pointerLockControls, "moveForward");
      const moveRight = vi.spyOn(pointerLockControls, "moveRight");
      const setFromEuler = vi.spyOn(
        pointerLockControls.object.quaternion,
        "setFromEuler",
      );
      const controls = createControls(pointerLockControls);
      polling.gamepads[0] = createGamepad(0, {
        axes: [0.05, -0.05, 0.05, -0.05],
      });

      controls.update(0.25);

      expect(moveForward).not.toHaveBeenCalled();
      expect(moveRight).not.toHaveBeenCalled();
      expect(setFromEuler).not.toHaveBeenCalled();
    },
  );
});

describe("GamepadPointerLockControls movement", () => {
  gamepadTest("uses the default movement bindings and speed", () => {
    const pointerLockControls = createPointerLockControls();
    const moveForward = vi.spyOn(pointerLockControls, "moveForward");
    const moveRight = vi.spyOn(pointerLockControls, "moveRight");
    const controls = createControls(pointerLockControls);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0.5, -0.75, 0, 0],
    });

    controls.update(0.2);

    expect(moveForward).toHaveBeenCalledOnce();
    expect(moveForward.mock.calls[0][0]).toBeCloseTo(0.75);
    expect(moveRight).toHaveBeenCalledOnce();
    expect(moveRight.mock.calls[0][0]).toBeCloseTo(0.5);
    expect(pointerLockControls.object.position.x).toBeCloseTo(0.5);
    expect(pointerLockControls.object.position.z).toBeCloseTo(-0.75);
  });

  gamepadTest("applies a custom movement speed", () => {
    const pointerLockControls = createPointerLockControls();
    const controls = createControls(pointerLockControls, { moveSpeed: 2 });
    polling.gamepads[0] = createGamepad(0, {
      axes: [0, -0.5, 0, 0],
    });

    controls.update(0.25);

    expect(pointerLockControls.object.position.z).toBeCloseTo(-0.25);
  });
});

describe("GamepadPointerLockControls look", () => {
  gamepadTest(
    "adds scaled yaw and pitch to the current orientation while unlocked",
    () => {
      const pointerLockControls = createPointerLockControls();
      const initialEuler = new Euler(0.2, -0.3, 0, "YXZ");
      pointerLockControls.object.quaternion.setFromEuler(initialEuler);
      pointerLockControls.pointerSpeed = 2;
      const controls = createControls(pointerLockControls, { lookSpeed: 0.5 });
      polling.gamepads[0] = createGamepad(0, {
        axes: [0, 0, 0.25, -0.5],
      });

      controls.update(0.2);

      const scale = 0.2 * Math.PI;
      const expectedEuler = new Euler(
        initialEuler.x + 0.5 * scale,
        initialEuler.y - 0.25 * scale,
        0,
        "YXZ",
      );
      expect(pointerLockControls.isLocked).toBe(false);
      expectQuaternionToBeCloseTo(
        pointerLockControls.object.quaternion,
        new Quaternion().setFromEuler(expectedEuler),
      );
    },
  );

  gamepadTest.each([
    {
      expectedPitch: Math.PI / 6,
      lookY: -1,
      name: "clamps pitch at the upper polar limit",
    },
    {
      expectedPitch: -Math.PI / 6,
      lookY: 1,
      name: "clamps pitch at the lower polar limit",
    },
  ])("$name", ({ expectedPitch, lookY }) => {
    const pointerLockControls = createPointerLockControls();
    pointerLockControls.minPolarAngle = Math.PI / 3;
    pointerLockControls.maxPolarAngle = (2 * Math.PI) / 3;
    const controls = createControls(pointerLockControls);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0, 0, 0, lookY],
    });

    controls.update(1);

    expectQuaternionToBeCloseTo(
      pointerLockControls.object.quaternion,
      new Quaternion().setFromEuler(new Euler(expectedPitch, 0, 0, "YXZ")),
    );
  });
});
