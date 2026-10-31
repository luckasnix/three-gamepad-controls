import { MathUtils, PerspectiveCamera, Spherical, Vector3 } from "three";
import { FirstPersonControls } from "three/addons/controls/FirstPersonControls.js";
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
  GamepadFirstPersonControls,
  type GamepadFirstPersonControlsOptions,
} from "./gamepad-first-person-controls.ts";
import { GamepadInput } from "./gamepad-input.ts";
import {
  type GamepadStick,
  gamepadStickPipeline,
} from "./gamepad-stick-processing.ts";

type FirstPersonControlsWithOrientation = FirstPersonControls & {
  _lat: number;
  _lon: number;
};

const createFirstPersonControls = (): FirstPersonControlsWithOrientation => {
  const controls = new FirstPersonControls(
    new PerspectiveCamera(),
  ) as FirstPersonControlsWithOrientation;
  controls.movementSpeed = 4;
  controls.lookSpeed = 0.005;
  return controls;
};

const expectVectorToBeCloseTo = (actual: Vector3, expected: Vector3): void => {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
  expect(actual.z).toBeCloseTo(expected.z);
};

const directionFromOrientation = (lat: number, lon: number): Vector3 =>
  new Vector3().setFromSphericalCoords(
    1,
    MathUtils.degToRad(90 - lat),
    MathUtils.degToRad(lon),
  );

let controlsInstances: GamepadFirstPersonControls[];
let polling: GamepadPollingFixture;

const createControls = (
  firstPersonControls: FirstPersonControls,
  options?: Partial<GamepadFirstPersonControlsOptions>,
): GamepadFirstPersonControls => {
  const controls = new GamepadFirstPersonControls(firstPersonControls, options);
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

describe("GamepadFirstPersonControls construction", () => {
  gamepadTest("forwards gamepad selection options to the base controls", () => {
    const firstPersonControls = createFirstPersonControls();
    expect(() =>
      createControls(firstPersonControls, { gamepadIndex: -1 }),
    ).toThrow("gamepadIndex must be an integer");
  });

  gamepadTest(
    "merges partial stick bindings and applies their pipelines",
    () => {
      const firstPersonControls = createFirstPersonControls();
      const moveTransform = vi.fn((value: Readonly<GamepadStick>) => ({
        x: value.x,
        y: value.y,
      }));
      const lookTransform = vi.fn((value: Readonly<GamepadStick>) => ({
        x: value.x,
        y: value.y,
      }));
      const controls = createControls(firstPersonControls, {
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

describe("GamepadFirstPersonControls input gating", () => {
  gamepadTest("ignores stick and button input within their dead zones", () => {
    const firstPersonControls = createFirstPersonControls();
    const position = firstPersonControls.object.position.clone();
    const quaternion = firstPersonControls.object.quaternion.clone();
    const controls = createControls(firstPersonControls);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0.05, -0.05, 0.05, -0.05],
      buttons: createGamepadButtons([6, false, 0.1], [7, false, 0.1]),
    });
    controls.update(0.25);
    expectVectorToBeCloseTo(firstPersonControls.object.position, position);
    expect(
      firstPersonControls.object.quaternion.angleTo(quaternion),
    ).toBeCloseTo(0);
  });
});

describe("GamepadFirstPersonControls movement", () => {
  gamepadTest(
    "limits combined forward and climb movement to unit magnitude",
    () => {
      const firstPersonControls = createFirstPersonControls();
      firstPersonControls.movementSpeed = 1;
      const controls = createControls(firstPersonControls);
      polling.gamepads[0] = createGamepad(0, {
        axes: [0, -1, 0, 0],
        buttons: createGamepadButtons([6, false, 1]),
      });
      controls.update(1);
      expect(firstPersonControls.object.position.length()).toBeCloseTo(1);
      expectVectorToBeCloseTo(
        firstPersonControls.object.position,
        new Vector3(0, Math.SQRT1_2, -Math.SQRT1_2),
      );
    },
  );

  gamepadTest.each([
    { x: 1, y: -1, climb: 0, expected: [Math.SQRT1_2, 0, -Math.SQRT1_2] },
    { x: -1, y: 1, climb: 0, expected: [-Math.SQRT1_2, 0, Math.SQRT1_2] },
    { x: -1, y: 0, climb: -1, expected: [-Math.SQRT1_2, -Math.SQRT1_2, 0] },
    {
      x: 1,
      y: -1,
      climb: 1,
      expected: [1 / Math.sqrt(3), 1 / Math.sqrt(3), -1 / Math.sqrt(3)],
    },
    {
      x: -1,
      y: 1,
      climb: -1,
      expected: [-1 / Math.sqrt(3), -1 / Math.sqrt(3), 1 / Math.sqrt(3)],
    },
  ])(
    "limits movement ($x, $y) with climb $climb while preserving direction",
    ({ x, y, climb, expected }) => {
      const firstPersonControls = createFirstPersonControls();
      firstPersonControls.movementSpeed = 1;
      const controls = createControls(firstPersonControls);
      polling.gamepads[0] = createGamepad(0, {
        axes: [x, y, 0, 0],
        buttons: createGamepadButtons(
          [6, false, Math.max(climb, 0)],
          [7, false, Math.max(-climb, 0)],
        ),
      });
      controls.update(1);
      expect(firstPersonControls.object.position.length()).toBeCloseTo(1);
      expectVectorToBeCloseTo(
        firstPersonControls.object.position,
        new Vector3().fromArray(expected),
      );
    },
  );

  gamepadTest.each([
    { x: 0.25, y: -0.25, climb: 0.25 },
    { x: 0.5, y: -0.5, climb: -0.5 },
    { x: 0.6, y: -0.8, climb: 0 },
  ])(
    "preserves movement ($x, $y) with climb $climb at or below unit magnitude",
    ({ x, y, climb }) => {
      const firstPersonControls = createFirstPersonControls();
      firstPersonControls.movementSpeed = 1;
      const controls = createControls(firstPersonControls);
      polling.gamepads[0] = createGamepad(0, {
        axes: [x, y, 0, 0],
        buttons: createGamepadButtons(
          [6, false, Math.max(climb, 0)],
          [7, false, Math.max(-climb, 0)],
        ),
      });
      controls.update(1);
      expectVectorToBeCloseTo(
        firstPersonControls.object.position,
        new Vector3(x, climb, y),
      );
    },
  );

  gamepadTest.each([
    { up: 1, down: 1, climb: 0 },
    { up: 0.6, down: 0.05, climb: 0.6 },
    { up: 0.05, down: 0.6, climb: -0.6 },
    { up: 0.6, down: 0.1, climb: 0.6 },
    { up: 0.1, down: 0.6, climb: -0.6 },
  ])(
    "filters triggers $up/$down before combining them with stick movement",
    ({ up, down, climb }) => {
      const firstPersonControls = createFirstPersonControls();
      firstPersonControls.movementSpeed = 1;
      const controls = createControls(firstPersonControls);
      polling.gamepads[0] = createGamepad(0, {
        axes: [0, -0.8, 0, 0],
        buttons: createGamepadButtons([6, false, up], [7, false, down]),
      });
      controls.update(1);
      expectVectorToBeCloseTo(
        firstPersonControls.object.position,
        new Vector3(0, climb, -0.8),
      );
    },
  );

  gamepadTest(
    "normalizes remapped processed movement without mutating or rereading its inputs",
    () => {
      const firstPersonControls = createFirstPersonControls();
      firstPersonControls.movementSpeed = 2;
      const processed = Object.freeze({ x: 2, y: -2 });
      const transform = vi.fn((_value: Readonly<GamepadStick>) => processed);
      const controls = createControls(firstPersonControls, {
        moveSpeed: 3,
        moveStick: {
          xAxis: 4,
          yAxis: 5,
          pipeline: gamepadStickPipeline().transform(transform),
        },
        buttonMoveUp: 1,
        buttonMoveDown: 2,
      });
      const buttons = createGamepadButtons([1, false, 1], [2, false, 0]);
      const buttonValue = vi.spyOn(GamepadInput.prototype, "buttonValue");
      polling.gamepads[0] = createGamepad(0, {
        axes: [1, 1, 0, 0, 0.25, -0.5],
        buttons,
      });
      controls.update(0.5);
      expectVectorToBeCloseTo(
        firstPersonControls.object.position,
        new Vector3(2, 1, -2),
      );
      expect(transform).toHaveBeenCalledExactlyOnceWith({ x: 0.25, y: -0.5 });
      expect(buttonValue).toHaveBeenCalledTimes(2);
      expect(buttonValue).toHaveBeenNthCalledWith(1, 1);
      expect(buttonValue).toHaveBeenNthCalledWith(2, 2);
      expect(processed).toEqual({ x: 2, y: -2 });
    },
  );

  gamepadTest(
    "scales default stick and trigger movement by time and movement speed",
    () => {
      const firstPersonControls = createFirstPersonControls();
      const controls = createControls(firstPersonControls, {
        moveSpeed: 1.5,
      });
      polling.gamepads[0] = createGamepad(0, {
        axes: [0.5, -0.75, 0, 0],
        buttons: createGamepadButtons([6, false, 0.6], [7, false, 0.2]),
      });
      controls.update(0.25);
      expect(firstPersonControls.object.position.x).toBeCloseTo(0.75);
      expect(firstPersonControls.object.position.y).toBeCloseTo(0.6);
      expect(firstPersonControls.object.position.z).toBeCloseTo(-1.125);
    },
  );

  gamepadTest(
    "uses remapped vertical movement buttons and the configured dead zone",
    () => {
      const firstPersonControls = createFirstPersonControls();
      firstPersonControls.lookAt(new Vector3(1, 1, -1));
      const controls = createControls(firstPersonControls, {
        buttonDeadzone: 0.4,
        buttonMoveUp: 1,
        buttonMoveDown: 2,
      });
      polling.gamepads[0] = createGamepad(0, {
        buttons: createGamepadButtons([1, false, 0.4], [2, false, 0.6]),
      });
      controls.update(0.5);
      expectVectorToBeCloseTo(
        firstPersonControls.object.position,
        new Vector3(0, -1.2, 0),
      );
    },
  );

  gamepadTest("cancels equal opposing triggers with a tilted camera", () => {
    const firstPersonControls = createFirstPersonControls();
    firstPersonControls.lookAt(new Vector3(1, 1, -1));
    const position = firstPersonControls.object.position.clone();
    const controls = createControls(firstPersonControls);
    polling.gamepads[0] = createGamepad(0, {
      buttons: createGamepadButtons([6, false, 0.75], [7, false, 0.75]),
    });
    controls.update(0.5);
    expectVectorToBeCloseTo(firstPersonControls.object.position, position);
  });

  gamepadTest.each([
    {
      axis: -0.5,
      expectedZ: -2.5,
      name: "adds the height speed factor to forward movement",
    },
    {
      axis: 0.5,
      expectedZ: 1,
      name: "does not add the height speed factor to backward movement",
    },
  ])("$name", ({ axis, expectedZ }) => {
    const firstPersonControls = createFirstPersonControls();
    firstPersonControls.heightSpeed = true;
    firstPersonControls.heightMin = 1;
    firstPersonControls.heightMax = 5;
    firstPersonControls.heightCoef = 3;
    firstPersonControls.object.position.y = 3;
    const controls = createControls(firstPersonControls, { moveSpeed: 2 });
    polling.gamepads[0] = createGamepad(0, {
      axes: [0, axis, 0, 0],
    });
    controls.update(0.25);
    expect(firstPersonControls.object.position.z).toBeCloseTo(expectedZ);
  });
});

describe("GamepadFirstPersonControls frame ownership", () => {
  for (const binding of ["moveStick", "lookStick"] as const) {
    gamepadTest.each([
      "pause",
      "native disable",
      "dispose",
      "replace object",
      "disconnect",
    ] as const)(`revalidates %s from the ${binding} pipeline`, (action) => {
      const native = createFirstPersonControls();
      native.autoForward = true;
      native.dampingFactor = 1;
      const initialObject = native.object;
      const quaternion = initialObject.quaternion.clone();
      let wrapper: GamepadFirstPersonControls;
      const transform = vi.fn((value: Readonly<GamepadStick>) => {
        if (action === "pause") {
          wrapper.enabled = false;
        } else if (action === "native disable") {
          native.enabled = false;
        } else if (action === "dispose") {
          wrapper.dispose();
          wrapper.enabled = true;
        } else if (action === "replace object") {
          native.object = new PerspectiveCamera();
        } else {
          dispatchGamepadEvent(
            "gamepaddisconnected",
            wrapper.gamepad as Gamepad,
          );
        }
        return value;
      });
      wrapper = createControls(native, {
        [binding]: { pipeline: gamepadStickPipeline().transform(transform) },
      });
      polling.publishFrame([0, { axes: [0.5, 0.5, 0.5, 0.5] }]);
      wrapper.update(0.25);
      expect(transform).toHaveBeenCalledOnce();
      expect(initialObject.position.length()).toBe(0);
      expect(native.object.position.length()).toBe(0);
      expect(initialObject.quaternion.angleTo(quaternion)).toBeLessThan(1e-7);
      native.enabled = true;
      native.update(0.25);
      expect(native.object.position.z).toBeCloseTo(-1);
    });
  }

  gamepadTest(
    "ignores recursive wrapper and native updates from a pipeline",
    () => {
      const native = createFirstPersonControls();
      native.autoForward = true;
      native.dampingFactor = 1;
      let wrapper: GamepadFirstPersonControls;
      const transform = vi.fn((value: Readonly<GamepadStick>) => {
        wrapper.update(0.25);
        native.update(0.25);
        return value;
      });
      wrapper = createControls(native, {
        moveStick: { pipeline: gamepadStickPipeline().transform(transform) },
      });
      polling.publishFrame([0, { axes: [0, 0.5, 0, 0] }]);
      wrapper.update(0.25);
      native.update(0.25);
      expect(transform).toHaveBeenCalledOnce();
      expect(native.object.position.z).toBeCloseTo(0.5);
    },
  );

  gamepadTest.each(["moveStick", "lookStick"] as const)(
    "clears pending input and recovers after %s throws",
    (binding) => {
      const native = createFirstPersonControls();
      native.autoForward = true;
      native.dampingFactor = 1;
      const failure = new Error("Pipeline failed");
      const transform = vi.fn((value: Readonly<GamepadStick>) => value);
      const wrapper = createControls(native, {
        [binding]: { pipeline: gamepadStickPipeline().transform(transform) },
      });
      polling.publishFrame([0, { axes: [0, 0.5, 0, 0] }]);
      wrapper.update(0.25);
      transform.mockImplementationOnce(() => {
        throw failure;
      });
      expect(() => wrapper.update(0.25)).toThrow(failure);
      native.update(0.25);
      expect(native.object.position.z).toBeCloseTo(-0.5);
      wrapper.update(0.25);
      native.update(0.25);
      expect(native.object.position.z).toBeCloseTo(0);
    },
  );
});

describe("GamepadFirstPersonControls native adapter ownership", () => {
  gamepadTest(
    "restores inherited update and ignores reuse after disposal",
    () => {
      const native = createFirstPersonControls();
      const original = native.update;
      const wrapper = createControls(native);
      expect(native.update).not.toBe(original);
      wrapper.dispose();
      wrapper.dispose();
      expect(native.update).toBe(original);
      expect(Object.hasOwn(native, "update")).toBe(false);
      wrapper.enabled = true;
      polling.publishFrame([0, { axes: [0, 1, 0, 0] }]);
      polling.getGamepads.mockClear();
      wrapper.update(0.25);
      expect(polling.getGamepads).not.toHaveBeenCalled();
      expect(native.object.position.length()).toBe(0);
    },
  );

  gamepadTest(
    "delegates with native this and restores the original own descriptor",
    () => {
      const native = createFirstPersonControls();
      const original = native.update;
      const update = vi.fn(function (this: FirstPersonControls, dt: number) {
        expect(this).toBe(native);
        original.call(this, dt);
      });
      Object.defineProperty(native, "update", {
        value: update,
        configurable: true,
        writable: true,
        enumerable: false,
      });
      const descriptor = Object.getOwnPropertyDescriptor(native, "update");
      const wrapper = createControls(native);
      native.update(0.25);
      wrapper.dispose();
      expect(update).toHaveBeenCalledExactlyOnceWith(0.25);
      expect(Object.getOwnPropertyDescriptor(native, "update")).toEqual(
        descriptor,
      );
    },
  );

  gamepadTest.each([
    "false",
    "true",
    "redefine",
    "delete",
    "replace setter",
    "lock descriptor",
    "change enumerability",
    "replace update",
    "dispose",
    "throw",
    "recursive",
  ] as const)(
    "preserves application changes during native update: %s",
    (action) => {
      const native = createFirstPersonControls();
      native.autoForward = true;
      native.dampingFactor = 1;
      const original = native.update;
      const replacement = vi.fn((dt: number) => original.call(native, dt));
      const failure = new Error("Native update failed");
      const descriptor = Object.getOwnPropertyDescriptor(native, "autoForward");
      let wrapper: GamepadFirstPersonControls;
      let first = true;
      native.update = function (dt) {
        original.call(this, dt);
        if (!first) {
          return;
        }
        first = false;
        if (action === "false" || action === "true") {
          this.autoForward = action === "true";
          expect(this.autoForward).toBe(false);
        } else if (action === "redefine") {
          Object.defineProperty(this, "autoForward", {
            value: false,
            configurable: true,
            writable: false,
            enumerable: false,
          });
        } else if (action === "delete") {
          Reflect.deleteProperty(this, "autoForward");
        } else if (action === "replace setter") {
          Object.defineProperty(this, "autoForward", { set: undefined });
        } else if (action === "lock descriptor") {
          Object.defineProperty(this, "autoForward", { configurable: false });
        } else if (action === "change enumerability") {
          Object.defineProperty(this, "autoForward", { enumerable: false });
        } else if (action === "replace update") {
          this.update = replacement;
        } else if (action === "dispose") {
          wrapper.dispose();
        } else if (action === "throw") {
          throw failure;
        } else {
          wrapper.update(dt);
          this.update(dt);
        }
      };
      const ownUpdate = native.update;
      wrapper = createControls(native);
      polling.publishFrame([0, { axes: [0, 0.5, 0, 0] }]);
      wrapper.update(0.25);
      if (action === "throw") {
        expect(() => native.update(0.25)).toThrow(failure);
      } else {
        native.update(0.25);
      }
      expect(native.object.position.z).toBeCloseTo(0.5);
      const auto = !["false", "redefine", "delete"].includes(action);
      if (action === "redefine") {
        expect(Object.getOwnPropertyDescriptor(native, "autoForward")).toEqual({
          value: false,
          writable: false,
          configurable: true,
          enumerable: false,
        });
      } else if (action === "delete") {
        expect(Object.hasOwn(native, "autoForward")).toBe(false);
      } else if (action === "replace setter") {
        expect(
          Object.getOwnPropertyDescriptor(native, "autoForward")?.set,
        ).toBeUndefined();
      } else if (action === "lock descriptor") {
        expect(
          Object.getOwnPropertyDescriptor(native, "autoForward")?.configurable,
        ).toBe(false);
        expect(native.autoForward).toBe(true);
      } else if (action === "change enumerability") {
        expect(
          Object.getOwnPropertyDescriptor(native, "autoForward")?.enumerable,
        ).toBe(false);
        expect(native.autoForward).toBe(true);
      } else {
        expect(Object.getOwnPropertyDescriptor(native, "autoForward")).toEqual({
          ...descriptor,
          value: auto,
        });
      }
      native.update(0.25);
      expect(native.object.position.z).toBeCloseTo(auto ? -0.5 : 0.5);
      wrapper.dispose();
      expect(native.update).toBe(
        action === "replace update" ? replacement : ownUpdate,
      );
    },
  );

  gamepadTest(
    "revalidates suppression when the original update pauses the wrapper",
    () => {
      const native = createFirstPersonControls();
      native.autoForward = true;
      native.dampingFactor = 1;
      const original = native.update;
      let wrapper: GamepadFirstPersonControls;
      native.update = function (dt) {
        wrapper.enabled = false;
        original.call(this, dt);
      };
      wrapper = createControls(native);
      polling.publishFrame([0, { axes: [0, 0.5, 0, 0] }]);
      wrapper.update(0.25);
      native.update(0.25);
      expect(native.object.position.z).toBeCloseTo(-0.5);
      expect(native.autoForward).toBe(true);
    },
  );

  gamepadTest.each([false, true])(
    "restores missing autoForward property with assignment=%s",
    (assign) => {
      const native = createFirstPersonControls();
      native.dampingFactor = 1;
      Reflect.deleteProperty(native, "autoForward");
      const original = native.update;
      native.update = function (dt) {
        if (assign) {
          this.autoForward = true;
        }
        original.call(this, dt);
      };
      const wrapper = createControls(native);
      polling.publishFrame([0, { axes: [0, 0.5, 0, 0] }]);
      wrapper.update(0.25);
      native.update(0.25);
      expect(native.object.position.z).toBeCloseTo(0.5);
      expect(Object.hasOwn(native, "autoForward")).toBe(assign);
      expect(native.autoForward).toBe(assign ? true : undefined);
    },
  );

  gamepadTest(
    "preserves an application's accessor and forwards false writes with native this",
    () => {
      const native = createFirstPersonControls();
      native.dampingFactor = 1;
      let value = true;
      const get = () => value;
      const set = vi.fn(function (this: FirstPersonControls, next: boolean) {
        expect(this).toBe(native);
        value = next;
      });
      Object.defineProperty(native, "autoForward", {
        get,
        set,
        enumerable: false,
        configurable: true,
      });
      const descriptor = Object.getOwnPropertyDescriptor(native, "autoForward");
      const original = native.update;
      native.update = function (dt) {
        original.call(this, dt);
        this.autoForward = false;
      };
      const wrapper = createControls(native);
      polling.publishFrame([0, { axes: [0, 0.5, 0, 0] }]);
      wrapper.update(0.25);
      native.update(0.25);
      expect(native.object.position.z).toBeCloseTo(0.5);
      expect(set).toHaveBeenCalledExactlyOnceWith(false);
      expect(native.autoForward).toBe(false);
      expect(Object.getOwnPropertyDescriptor(native, "autoForward")).toEqual(
        descriptor,
      );
    },
  );
});

describe("GamepadFirstPersonControls look", () => {
  gamepadTest(
    "scales look input and keeps native FirstPersonControls orientation in sync",
    () => {
      const firstPersonControls = createFirstPersonControls();
      firstPersonControls.lookSpeed = 0.01;
      const controls = createControls(firstPersonControls, { lookSpeed: 2 });
      polling.gamepads[0] = createGamepad(0, {
        axes: [0, 0, 0.25, -0.25],
      });
      controls.update(0.25);
      expect(firstPersonControls._lat).toBeCloseTo(45);
      expect(firstPersonControls._lon).toBeCloseTo(135);
      expectVectorToBeCloseTo(
        firstPersonControls.object.getWorldDirection(new Vector3()),
        directionFromOrientation(45, 135),
      );
      const gamepadQuaternion = firstPersonControls.object.quaternion.clone();
      firstPersonControls.update(0.25);
      expect(
        firstPersonControls.object.quaternion.angleTo(gamepadQuaternion),
      ).toBeCloseTo(0);
    },
  );

  gamepadTest("respects the native lookVertical setting", () => {
    const firstPersonControls = createFirstPersonControls();
    firstPersonControls.lookVertical = false;
    firstPersonControls._lat = 20;
    const controls = createControls(firstPersonControls);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0, 0, 0.5, -0.5],
    });
    controls.update(0.1);
    expect(firstPersonControls._lat).toBe(20);
    expect(firstPersonControls._lon).toBeCloseTo(171);
    expectVectorToBeCloseTo(
      firstPersonControls.object.getWorldDirection(new Vector3()),
      directionFromOrientation(20, 171),
    );
  });

  gamepadTest.each([
    { expectedLat: 85, lookY: -1, startLat: 80 },
    { expectedLat: -85, lookY: 1, startLat: -80 },
  ])(
    "clamps latitude from $startLat degrees to $expectedLat degrees",
    ({ expectedLat, lookY, startLat }) => {
      const firstPersonControls = createFirstPersonControls();
      firstPersonControls._lat = startLat;
      const controls = createControls(firstPersonControls);
      polling.gamepads[0] = createGamepad(0, {
        axes: [0, 0, 0, lookY],
      });
      controls.update(0.5);
      expect(firstPersonControls._lat).toBe(expectedLat);
    },
  );

  gamepadTest("applies the native constrained vertical range", () => {
    const firstPersonControls = createFirstPersonControls();
    firstPersonControls.constrainVertical = true;
    firstPersonControls.verticalMin = Math.PI / 4;
    firstPersonControls.verticalMax = (3 * Math.PI) / 4;
    const controls = createControls(firstPersonControls);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0, 0, 0, 0.5],
    });
    controls.update(0.1);
    expect(firstPersonControls._lat).toBeCloseTo(-18);
    expectVectorToBeCloseTo(
      firstPersonControls.object.getWorldDirection(new Vector3()),
      new Vector3().setFromSphericalCoords(1, MathUtils.degToRad(99), Math.PI),
    );
  });

  gamepadTest("handles a collapsed constrained vertical range", () => {
    const firstPersonControls = createFirstPersonControls();
    firstPersonControls.constrainVertical = true;
    firstPersonControls.verticalMin = Math.PI / 3;
    firstPersonControls.verticalMax = Math.PI / 3;
    const controls = createControls(firstPersonControls);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0, 0, 0, 0.5],
    });
    controls.update(0.1);
    expect(firstPersonControls._lat).toBeCloseTo(-9);
    expectVectorToBeCloseTo(
      firstPersonControls.object.getWorldDirection(new Vector3()),
      new Vector3().setFromSphericalCoords(1, Math.PI / 3, Math.PI),
    );
  });

  gamepadTest(
    "derives orientation from the camera when native angles are unavailable",
    () => {
      const firstPersonControls = createFirstPersonControls();
      firstPersonControls.lookAt(new Vector3(1, 1, -1));
      const initialDirection = firstPersonControls.object.getWorldDirection(
        new Vector3(),
      );
      const initialSpherical = new Spherical().setFromVector3(initialDirection);
      const initialLat = 90 - MathUtils.radToDeg(initialSpherical.phi);
      const initialLon = MathUtils.radToDeg(initialSpherical.theta);
      firstPersonControls._lat = Number.NaN;
      firstPersonControls._lon = Number.NaN;
      const controls = createControls(firstPersonControls);
      polling.gamepads[0] = createGamepad(0, {
        axes: [0, -0.5, 0.25, -0.25],
      });
      controls.update(0.1);
      expectVectorToBeCloseTo(
        firstPersonControls.object.position,
        initialDirection.clone().setY(0).normalize().multiplyScalar(0.2),
      );
      const expectedLat = initialLat + 4.5;
      const expectedLon = initialLon - 4.5;
      expect(firstPersonControls._lat).toBeCloseTo(expectedLat);
      expect(firstPersonControls._lon).toBeCloseTo(expectedLon);
      expectVectorToBeCloseTo(
        firstPersonControls.object.getWorldDirection(new Vector3()),
        directionFromOrientation(expectedLat, expectedLon),
      );
    },
  );
});
