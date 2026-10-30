import { PerspectiveCamera, Quaternion, Vector3 } from "three";
import { FlyControls } from "three/addons/controls/FlyControls.js";
import { describe, expect, vi } from "vitest";

import {
  createGamepad,
  createGamepadButtons,
} from "../test/fixtures/gamepad.ts";
import {
  dispatchGamepadEvent,
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

describe("GamepadFlyControls frame ownership", () => {
  for (const binding of ["moveStick", "lookStick"] as const) {
    gamepadTest.each([
      "pause",
      "native disable",
      "dispose",
      "replace object",
      "disconnect",
    ] as const)(`revalidates %s from the ${binding} pipeline`, (action) => {
      const fly = createFlyControls();
      const initialObject = fly.object;
      let wrapper: GamepadFlyControls;
      const transform = vi.fn((value: Readonly<GamepadStick>) => {
        if (action === "pause") {
          wrapper.enabled = false;
        } else if (action === "native disable") {
          fly.enabled = false;
        } else if (action === "dispose") {
          wrapper.dispose();
          // Disposal remains terminal even if an application reenables it.
          wrapper.enabled = true;
        } else if (action === "replace object") {
          fly.object = new PerspectiveCamera();
        } else {
          dispatchGamepadEvent(
            "gamepaddisconnected",
            wrapper.gamepad as Gamepad,
          );
        }
        return value;
      });
      wrapper = createControls(fly, {
        [binding]: { pipeline: gamepadStickPipeline().transform(transform) },
      });
      polling.publishFrame([0, { axes: [0.5, 0.5, 0.5, 0.5] }]);
      wrapper.update(0.25);
      expect(transform).toHaveBeenCalledOnce();
      expect(initialObject.position.length()).toBe(0);
      expect(fly.object.position.length()).toBe(0);
      expectQuaternionToBeCloseTo(initialObject.quaternion, new Quaternion());
    });
  }

  gamepadTest("ignores recursive wrapper updates from a pipeline", () => {
    const fly = createFlyControls();
    let wrapper: GamepadFlyControls;
    const transform = vi.fn((value: Readonly<GamepadStick>) => {
      wrapper.update(0.25);
      return value;
    });
    wrapper = createControls(fly, {
      moveStick: { pipeline: gamepadStickPipeline().transform(transform) },
    });
    polling.publishFrame([0, { axes: [0, 0.5, 0, 0] }]);
    wrapper.update(0.25);
    expect(transform).toHaveBeenCalledOnce();
    expect(fly.object.position.z).toBeCloseTo(0.5);
  });

  gamepadTest("can update again after a pipeline throws", () => {
    const fly = createFlyControls();
    const failure = new Error("Pipeline failed");
    const transform = vi
      .fn((value: Readonly<GamepadStick>) => value)
      .mockImplementationOnce(() => {
        throw failure;
      });
    const wrapper = createControls(fly, {
      moveStick: { pipeline: gamepadStickPipeline().transform(transform) },
    });
    polling.publishFrame([0, { axes: [0, 0.5, 0, 0] }]);
    expect(() => wrapper.update(0.25)).toThrow(failure);
    expect(fly.object.position.length()).toBe(0);
    wrapper.update(0.25);
    expect(fly.object.position.z).toBeCloseTo(0.5);
  });
});

describe("GamepadFlyControls native update ownership", () => {
  gamepadTest(
    "restores an inherited update and ignores reuse after disposal",
    () => {
      const fly = createFlyControls();
      const originalUpdate = fly.update;
      const wrapper = createControls(fly);
      expect(fly.update).not.toBe(originalUpdate);
      wrapper.dispose();
      wrapper.dispose();
      expect(fly.update).toBe(originalUpdate);
      expect(Object.hasOwn(fly, "update")).toBe(false);
      wrapper.enabled = true;
      polling.publishFrame([0, { axes: [0, 1, 0, 0] }]);
      polling.getGamepads.mockClear();
      wrapper.update(0.25);
      expect(polling.getGamepads).not.toHaveBeenCalled();
      expect(fly.object.position.length()).toBe(0);
    },
  );

  gamepadTest(
    "delegates with native this and restores an own descriptor",
    () => {
      const fly = createFlyControls();
      const originalUpdate = fly.update;
      const update = vi.fn(function (this: FlyControls, deltaTime: number) {
        expect(this).toBe(fly);
        originalUpdate.call(this, deltaTime);
      });
      Object.defineProperty(fly, "update", {
        value: update,
        configurable: true,
        writable: true,
        enumerable: false,
      });
      const descriptor = Object.getOwnPropertyDescriptor(fly, "update");
      const wrapper = createControls(fly);
      fly.update(0.25);
      expect(update).toHaveBeenCalledExactlyOnceWith(0.25);
      wrapper.dispose();
      expect(Object.getOwnPropertyDescriptor(fly, "update")).toEqual(
        descriptor,
      );
    },
  );

  gamepadTest("preserves a later application update replacement", () => {
    const fly = createFlyControls();
    const originalUpdate = fly.update;
    const wrapper = createControls(fly);
    const update = vi.fn((deltaTime: number) => {
      originalUpdate.call(fly, deltaTime);
    });
    fly.update = update;
    wrapper.dispose();
    expect(fly.update).toBe(update);
    fly.update(0.25);
    expect(update).toHaveBeenCalledExactlyOnceWith(0.25);
  });
});
