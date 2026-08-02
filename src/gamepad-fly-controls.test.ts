import { PerspectiveCamera, Quaternion, Vector3 } from "three";
import { FlyControls } from "three/addons/controls/FlyControls.js";
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
  GamepadFlyControls,
  type GamepadFlyControlsOptions,
} from "./gamepad-fly-controls.ts";
import {
  type GamepadStick,
  gamepadStickPipeline,
} from "./gamepad-stick-processing.ts";

const createFlyControls = (): FlyControls => {
  const controls = new FlyControls(new PerspectiveCamera());

  controls.movementSpeed = 4;
  controls.rollSpeed = 2;

  return controls;
};

const expectQuaternionToBeCloseTo = (
  actual: Quaternion,
  expected: Quaternion,
): void => {
  expect(actual.angleTo(expected)).toBeCloseTo(0);
};

let controlsInstances: GamepadFlyControls[];
let polling: GamepadPollingFixture;

const createControls = (
  flyControls: FlyControls,
  options?: Partial<GamepadFlyControlsOptions>,
): GamepadFlyControls => {
  const controls = new GamepadFlyControls(flyControls, options);

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

describe("GamepadFlyControls construction", () => {
  gamepadTest("forwards gamepad selection options to the base controls", () => {
    const flyControls = createFlyControls();

    expect(() => createControls(flyControls, { gamepadIndex: -1 })).toThrow(
      "gamepadIndex must be an integer",
    );
  });

  gamepadTest(
    "merges partial stick bindings and applies their pipelines",
    () => {
      const flyControls = createFlyControls();
      const moveTransform = vi.fn((value: Readonly<GamepadStick>) => ({
        x: value.x,
        y: value.y,
      }));
      const lookTransform = vi.fn((value: Readonly<GamepadStick>) => ({
        x: value.x,
        y: value.y,
      }));
      const controls = createControls(flyControls, {
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

describe("GamepadFlyControls input gating", () => {
  gamepadTest("ignores stick and button input within their dead zones", () => {
    const flyControls = createFlyControls();
    const translateX = vi.spyOn(flyControls.object, "translateX");
    const translateY = vi.spyOn(flyControls.object, "translateY");
    const translateZ = vi.spyOn(flyControls.object, "translateZ");
    const multiply = vi.spyOn(flyControls.object.quaternion, "multiply");
    const controls = createControls(flyControls);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0.05, -0.05, 0.05, -0.05],
      buttons: createGamepadButtons([6, false, 0.1], [7, false, 0.1]),
    });

    controls.update(0.25);

    expect(translateX).not.toHaveBeenCalled();
    expect(translateY).not.toHaveBeenCalled();
    expect(translateZ).not.toHaveBeenCalled();
    expect(multiply).not.toHaveBeenCalled();
  });
});

describe("GamepadFlyControls movement", () => {
  gamepadTest(
    "scales default stick and trigger movement by time and movement speed",
    () => {
      const flyControls = createFlyControls();
      const controls = createControls(flyControls, { moveSpeed: 1.5 });
      polling.gamepads[0] = createGamepad(0, {
        axes: [0.5, -0.75, 0, 0],
        buttons: createGamepadButtons([6, false, 0.6], [7, false, 0.2]),
      });

      controls.update(0.25);

      expect(flyControls.object.position.x).toBeCloseTo(0.75);
      expect(flyControls.object.position.y).toBeCloseTo(0.6);
      expect(flyControls.object.position.z).toBeCloseTo(-1.125);
    },
  );

  gamepadTest(
    "uses remapped vertical movement buttons and the configured dead zone",
    () => {
      const flyControls = createFlyControls();
      const controls = createControls(flyControls, {
        buttonDeadzone: 0.4,
        buttonMoveUp: 1,
        buttonMoveDown: 2,
      });
      polling.gamepads[0] = createGamepad(0, {
        buttons: createGamepadButtons([1, false, 0.4], [2, false, 0.6]),
      });

      controls.update(0.5);

      expect(flyControls.object.position.y).toBeCloseTo(-1.2);
    },
  );
});

describe("GamepadFlyControls rotation", () => {
  gamepadTest.each([
    {
      expectedPitch: 0.5,
      expectedYaw: 0,
      lookX: 0,
      lookY: -0.5,
      name: "pitches up when the look stick moves up",
    },
    {
      expectedPitch: -0.5,
      expectedYaw: 0,
      lookX: 0,
      lookY: 0.5,
      name: "pitches down when the look stick moves down",
    },
    {
      expectedPitch: 0,
      expectedYaw: -0.5,
      lookX: 0.5,
      lookY: 0,
      name: "yaws right when the look stick moves right",
    },
    {
      expectedPitch: 0,
      expectedYaw: 0.5,
      lookX: -0.5,
      lookY: 0,
      name: "yaws left when the look stick moves left",
    },
  ])("$name", ({ expectedPitch, expectedYaw, lookX, lookY }) => {
    const flyControls = createFlyControls();
    flyControls.rollSpeed = 1;
    const controls = createControls(flyControls);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0, 0, lookX, lookY],
    });

    controls.update(0.2);

    expectQuaternionToBeCloseTo(
      flyControls.object.quaternion,
      new Quaternion(expectedPitch * 0.2, expectedYaw * 0.2, 0, 1).normalize(),
    );
  });

  gamepadTest(
    "scales and composes pitch, yaw, and roll over the current orientation",
    () => {
      const flyControls = createFlyControls();
      const initialQuaternion = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0),
        Math.PI / 4,
      );
      flyControls.object.quaternion.copy(initialQuaternion);
      const controls = createControls(flyControls, { rotateSpeed: 0.75 });
      polling.gamepads[0] = createGamepad(0, {
        axes: [0, 0, 0.25, -0.5],
        buttons: createGamepadButtons([4, true]),
      });

      controls.update(0.2);

      const expectedDelta = new Quaternion(0.15, -0.075, 0.3, 1).normalize();
      expectQuaternionToBeCloseTo(
        flyControls.object.quaternion,
        initialQuaternion.clone().multiply(expectedDelta),
      );
    },
  );

  gamepadTest("uses remapped roll buttons", () => {
    const flyControls = createFlyControls();
    const controls = createControls(flyControls, {
      buttonRollLeft: 1,
      buttonRollRight: 2,
      rotateSpeed: 0.5,
    });
    polling.gamepads[0] = createGamepad(0, {
      buttons: createGamepadButtons([2, true]),
    });

    controls.update(0.25);

    expectQuaternionToBeCloseTo(
      flyControls.object.quaternion,
      new Quaternion(0, 0, -0.25, 1).normalize(),
    );
  });

  gamepadTest("cancels opposing roll buttons", () => {
    const flyControls = createFlyControls();
    const multiply = vi.spyOn(flyControls.object.quaternion, "multiply");
    const controls = createControls(flyControls);
    polling.gamepads[0] = createGamepad(0, {
      buttons: createGamepadButtons([4, true], [5, true]),
    });

    controls.update(0.25);

    expect(multiply).not.toHaveBeenCalled();
    expectQuaternionToBeCloseTo(
      flyControls.object.quaternion,
      new Quaternion(),
    );
  });
});
