import { Euler, PerspectiveCamera, Quaternion } from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { describe, expect, vi } from "vitest";

import { createGamepad } from "../test/fixtures/gamepad.ts";
import {
  dispatchGamepadEvent,
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
  limitGamepadStickMagnitude,
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
  gamepadTest.each([0, -1, NaN, Infinity])(
    "rejects a smoothing half-life of %s before installing listeners",
    (lookSmoothingHalfLife) => {
      const native = createPointerLockControls();
      const addListener = vi.spyOn(window, "addEventListener");
      expect(() => createControls(native, { lookSmoothingHalfLife })).toThrow(
        RangeError,
      );
      expect(addListener).not.toHaveBeenCalled();
    },
  );

  gamepadTest("forwards gamepad selection options to the base controls", () => {
    const pointerLockControls = createPointerLockControls();
    expect(() =>
      createControls(pointerLockControls, { gamepadIndex: -1 }),
    ).toThrow("gamepadIndex must be an integer");
  });

  gamepadTest.each([undefined, 0.05])(
    "reads each configured stick once with smoothing half-life %s",
    (lookSmoothingHalfLife) => {
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
        lookSmoothingHalfLife,
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

describe("GamepadPointerLockControls look smoothing", () => {
  const halfLife = 0.05;
  const frameAngle = halfLife * Math.PI;
  const held = { axes: [1, 0, 1, 0] };

  gamepadTest.each([
    { options: {}, first: 1, second: 1 },
    { options: { lookSmoothingHalfLife: halfLife }, first: 0.5, second: 0.75 },
  ])(
    "applies the expected turn rate for $options",
    ({ options, first, second }) => {
      const native = createPointerLockControls();
      const controls = createControls(native, { ...options, moveSpeed: 1 });
      const change = vi.fn();
      native.addEventListener("change", change);
      polling.publishFrame([0, held]);
      controls.update(halfLife);
      expect(native.object.rotation.y).toBeCloseTo(-frameAngle * first, 10);
      expect(native.object.position.x).toBeCloseTo(halfLife, 10);

      polling.publishFrame([0]);
      controls.update(0);
      polling.publishFrame([0, { ...held, id: "new snapshot" }]);
      controls.update(halfLife);
      const yaw = -frameAngle * (first + second);
      expect(native.object.rotation.y).toBeCloseTo(yaw, 10);
      polling.publishFrame([0]);
      controls.update(halfLife);
      expect(native.object.rotation.y).toBeCloseTo(yaw, 10);
      expect(change).toHaveBeenCalledTimes(2);
      polling.publishFrame([0, held]);
      controls.update(halfLife);
      expect(native.object.rotation.y).toBeCloseTo(
        yaw - frameAngle * first,
        10,
      );
    },
  );

  gamepadTest(
    "rejects invalid time or processed look before applying either action",
    () => {
      const native = createPointerLockControls();
      const transform = vi.fn((stick: Readonly<GamepadStick>) => stick);
      const controls = createControls(native, {
        lookSmoothingHalfLife: halfLife,
        lookStick: { pipeline: gamepadStickPipeline().transform(transform) },
      });
      polling.publishFrame([0, held]);
      controls.update(halfLife);
      const position = native.object.position.clone();
      const orientation = native.object.quaternion.toArray();
      const change = vi.fn();
      native.addEventListener("change", change);
      for (const invalidTime of [-1, Infinity, NaN]) {
        expect(() => controls.update(invalidTime)).toThrow(RangeError);
      }
      transform.mockReturnValueOnce({ x: NaN, y: 1 });
      expect(() => controls.update(halfLife)).toThrow(RangeError);
      expect(native.object.position).toEqual(position);
      expect(native.object.quaternion.toArray()).toEqual(orientation);
      expect(change).not.toHaveBeenCalled();
      controls.update(halfLife);
      expect(native.object.rotation.y).toBeCloseTo(-1.25 * frameAngle, 10);
    },
  );

  gamepadTest.each(["wrapper", "native"])(
    "holds the turn rate while %s controls are paused",
    (owner) => {
      const native = createPointerLockControls();
      const controls = createControls(native, {
        lookSmoothingHalfLife: halfLife,
      });
      polling.publishFrame([0, held]);
      controls.update(halfLife);
      const paused = owner === "native" ? native : controls;
      paused.enabled = false;
      polling.publishFrame([0]);
      controls.update(10);
      expect(native.object.rotation.y).toBeCloseTo(-0.5 * frameAngle, 10);
      paused.enabled = true;
      polling.publishFrame([0, held]);
      controls.update(halfLife);
      expect(native.object.rotation.y).toBeCloseTo(-1.25 * frameAngle, 10);
    },
  );

  gamepadTest.each([
    ["moveStick", "disconnect and reconnect"],
    ["lookStick", "disconnect and reconnect"],
    ["moveStick", "pause wrapper"],
    ["lookStick", "disable native"],
    ["lookStick", "replace camera"],
    ["lookStick", "dispose"],
  ] as const)(
    "discards the entire frame when %s triggers %s",
    (binding, action) => {
      const native = createPointerLockControls();
      const camera = native.object;
      const transform = vi.fn((stick: Readonly<GamepadStick>) => stick);
      const controls = createControls(native, {
        lookSmoothingHalfLife: halfLife,
        [binding]: { pipeline: gamepadStickPipeline().transform(transform) },
      });
      polling.publishFrame([0, held]);
      controls.update(halfLife);
      const position = camera.position.clone();
      const orientation = camera.quaternion.toArray();
      const change = vi.fn();
      native.addEventListener("change", change);
      transform.mockImplementationOnce((stick) => {
        switch (action) {
          case "disconnect and reconnect": {
            const pad = polling.gamepads[0] as Gamepad;
            dispatchGamepadEvent("gamepaddisconnected", pad);
            dispatchGamepadEvent("gamepadconnected", pad);
            break;
          }
          case "pause wrapper":
            controls.enabled = false;
            break;
          case "disable native":
            native.enabled = false;
            break;
          case "replace camera":
            native.object = new PerspectiveCamera();
            break;
          case "dispose":
            controls.dispose();
            break;
        }
        return stick;
      });
      controls.update(halfLife);
      expect(change).not.toHaveBeenCalled();
      expect(camera.position).toEqual(position);
      expect(camera.quaternion.toArray()).toEqual(orientation);
      if (action === "dispose") {
        expect(controls.gamepad).toBeNull();
        return;
      }
      controls.enabled = true;
      native.enabled = true;
      const previousYaw = native.object.rotation.y;
      if (action === "replace camera") {
        expect(previousYaw).toBe(0);
        expect(native.object.position.length()).toBe(0);
      }
      controls.update(halfLife);
      const resumedRate =
        action === "pause wrapper" || action === "disable native" ? 0.75 : 0.5;
      expect(native.object.rotation.y - previousYaw).toBeCloseTo(
        -resumedRate * frameAngle,
        10,
      );
    },
  );

  gamepadTest.each(["polling", "event during pause"])(
    "restarts from rest after loss observed by %s",
    (loss) => {
      const native = createPointerLockControls();
      const options = { lookSmoothingHalfLife: halfLife };
      const controls = createControls(native, options);
      polling.publishFrame([0, held]);
      controls.update(halfLife);
      controls.update(halfLife);
      const previousYaw = native.object.rotation.y;
      polling.publishFrame();
      if (loss === "polling") {
        controls.update(halfLife);
      } else {
        controls.enabled = false;
        dispatchGamepadEvent("gamepaddisconnected", createGamepad(0));
        controls.enabled = true;
      }
      expect(controls.gamepad).toBeNull();
      const freshNative = createPointerLockControls();
      const freshControls = createControls(freshNative, options);
      polling.publishFrame([0, held]);
      controls.update(halfLife);
      freshControls.update(halfLife);
      expect(native.object.rotation.y - previousYaw).toBeCloseTo(
        freshNative.object.rotation.y,
        10,
      );
    },
  );

  gamepadTest(
    "a disconnected listener can adopt a replacement with fresh look history",
    () => {
      const native = createPointerLockControls();
      const controls = createControls(native, {
        lookSmoothingHalfLife: halfLife,
      });
      polling.publishFrame([0, held]);
      controls.update(halfLife);
      const previousYaw = native.object.rotation.y;
      controls.addEventListener("disconnected", () => {
        polling.publishFrame([0, { ...held, id: "replacement" }]);
        controls.update(halfLife);
      });
      dispatchGamepadEvent("gamepaddisconnected", createGamepad(0));
      expect(controls.gamepad?.id).toBe("replacement");
      expect(native.object.rotation.y - previousYaw).toBeCloseTo(
        -0.5 * frameAngle,
        10,
      );
      controls.update(halfLife);
      expect(native.object.rotation.y - previousYaw).toBeCloseTo(
        -1.25 * frameAngle,
        10,
      );
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

  gamepadTest.each([
    { axes: [1, -1, 0, 0], distance: 1, x: Math.SQRT1_2, z: -Math.SQRT1_2 },
    { axes: [0, -0.5, 0, 0], distance: 0.5, x: 0, z: -0.5 },
  ])(
    "moves $distance units with a magnitude-limited movement binding",
    ({ axes, distance, x, z }) => {
      const pointerLockControls = createPointerLockControls();
      const controls = createControls(pointerLockControls, {
        moveSpeed: 1,
        moveStick: {
          pipeline: gamepadStickPipeline()
            .deadzone(0.15)
            .transform(limitGamepadStickMagnitude),
        },
      });
      polling.gamepads[0] = createGamepad(0, { axes });
      controls.update(1);
      const position = pointerLockControls.object.position;
      expect(position.length()).toBeCloseTo(distance);
      expect(position.x).toBeCloseTo(x);
      expect(position.y).toBe(0);
      expect(position.z).toBeCloseTo(z);
    },
  );
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
