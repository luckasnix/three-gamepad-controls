import {
  Camera,
  Group,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Quaternion,
  Vector3,
} from "three";
import {
  TransformControls,
  type TransformControlsMode,
} from "three/addons/controls/TransformControls.js";
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
  GamepadTransformControls,
  type GamepadTransformControlsOptions,
} from "./gamepad-transform-controls.ts";

type TransformAxis = NonNullable<TransformControls["axis"]>;

type RuntimeTransformControls = TransformControls & {
  minX: number;
  object: Object3D | undefined;
};

type TransformControlsFixtureOptions = {
  attach?: boolean;
  camera?: Camera;
  object?: Object3D;
};

const createTransformControls = (options?: TransformControlsFixtureOptions) => {
  const camera = options?.camera ?? new PerspectiveCamera(60, 2, 0.1, 1000);
  const object = options?.object ?? new Object3D();

  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  object.updateMatrixWorld();

  const controls = new TransformControls(camera, null);

  if (options?.attach !== false) {
    controls.attach(object);
  }

  const change = vi.fn();
  const mouseDown = vi.fn();
  const mouseUp = vi.fn();
  const objectChange = vi.fn();

  controls.addEventListener("change", change);
  controls.addEventListener("mouseDown", mouseDown);
  controls.addEventListener("mouseUp", mouseUp);
  controls.addEventListener("objectChange", objectChange);

  return {
    camera,
    change,
    controls: controls as RuntimeTransformControls,
    mouseDown,
    mouseUp,
    object,
    objectChange,
    reset: vi.spyOn(controls, "reset"),
  };
};

type TransformControlsFixture = ReturnType<typeof createTransformControls>;

const DEFAULT_BUTTONS = {
  axisComposite: 13,
  axisNext: 5,
  axisPrevious: 4,
  axisX: 15,
  axisY: 12,
  axisZ: 14,
  reset: 9,
  rotate: 1,
  scale: 2,
  toggleSpace: 3,
  translate: 0,
} as const;

let controlsInstances: GamepadTransformControls[];
let polling: GamepadPollingFixture;
let timestamp: number;

const createControls = (
  transformControls: TransformControls,
  options?: Partial<GamepadTransformControlsOptions>,
): GamepadTransformControls => {
  const controls = new GamepadTransformControls(transformControls, options);

  controlsInstances.push(controls);

  return controls;
};

const updateInput = (
  controls: GamepadTransformControls,
  options?: {
    axes?: readonly number[];
    buttons?: GamepadButton[];
    deltaTime?: number;
  },
): void => {
  timestamp += 1;
  polling.gamepads[0] = createGamepad(0, {
    axes: options?.axes,
    buttons: options?.buttons,
    timestamp,
  });
  controls.update(options?.deltaTime ?? 0.1);
};

const pressButton = (
  controls: GamepadTransformControls,
  button: number,
): void => {
  updateInput(controls);
  updateInput(controls, {
    buttons: createGamepadButtons([button, true]),
  });
};

const selectMode = (
  controls: GamepadTransformControls,
  mode: TransformControlsMode,
): void => {
  const button = {
    rotate: DEFAULT_BUTTONS.rotate,
    scale: DEFAULT_BUTTONS.scale,
    translate: DEFAULT_BUTTONS.translate,
  }[mode];

  pressButton(controls, button);
};

const selectAxis = (
  controls: GamepadTransformControls,
  mode: TransformControlsMode,
  axis: TransformAxis,
): void => {
  selectMode(controls, mode);

  if (axis === "X" || axis === "Y" || axis === "Z") {
    pressButton(
      controls,
      {
        X: DEFAULT_BUTTONS.axisX,
        Y: DEFAULT_BUTTONS.axisY,
        Z: DEFAULT_BUTTONS.axisZ,
      }[axis],
    );
    return;
  }

  const compositePresses = {
    E: 1,
    XY: 1,
    XYZ: mode === "translate" ? 4 : 1,
    XYZE: 2,
    XZ: 3,
    YZ: 2,
  }[axis];

  for (let index = 0; index < compositePresses; index += 1) {
    pressButton(controls, DEFAULT_BUTTONS.axisComposite);
  }
};

const expectTransformEvents = (
  transformFixture: TransformControlsFixture,
): void => {
  expect(transformFixture.mouseDown).toHaveBeenCalledOnce();
  expect(transformFixture.change).toHaveBeenCalled();
  expect(transformFixture.objectChange).toHaveBeenCalled();
};

gamepadTest.beforeEach(({ gamepadPolling }) => {
  controlsInstances = [];
  polling = gamepadPolling;
  timestamp = 0;
});

gamepadTest.afterEach(() => {
  for (const controls of controlsInstances) {
    controls.dispose();
  }
});

describe("GamepadTransformControls construction", () => {
  gamepadTest("forwards gamepad selection options to the base controls", () => {
    const transformFixture = createTransformControls();

    expect(() =>
      createControls(transformFixture.controls, { gamepadIndex: -1 }),
    ).toThrow("gamepadIndex must be an integer");
  });

  gamepadTest(
    "merges partial stick bindings over the transform-specific axes",
    () => {
      const transformFixture = createTransformControls();
      const transform = vi.fn((_value: Readonly<GamepadStick>) => ({
        x: 0,
        y: 0,
      }));
      const controls = createControls(transformFixture.controls, {
        transformStick: {
          xAxis: 4,
          pipeline: gamepadStickPipeline().transform(transform),
        },
      });

      updateInput(controls, {
        axes: [0, -0.25, 0, 0, 0.5],
      });

      expect(transform).toHaveBeenCalledExactlyOnceWith({
        x: 0.5,
        y: -0.25,
      });
      expect(transformFixture.object.position).toEqual(new Vector3());
    },
  );
});

describe("GamepadTransformControls mode and axis selection", () => {
  gamepadTest("selects each mode and restores its remembered axis", () => {
    const transformFixture = createTransformControls();
    const controls = createControls(transformFixture.controls);

    updateInput(controls);
    pressButton(controls, DEFAULT_BUTTONS.axisY);
    expect(transformFixture.controls.axis).toBe("Y");

    selectMode(controls, "rotate");
    pressButton(controls, DEFAULT_BUTTONS.axisZ);
    expect(transformFixture.controls.mode).toBe("rotate");
    expect(transformFixture.controls.axis).toBe("Z");

    selectMode(controls, "scale");
    expect(transformFixture.controls.mode).toBe("scale");
    expect(transformFixture.controls.axis).toBe("X");

    selectMode(controls, "translate");
    expect(transformFixture.controls.mode).toBe("translate");
    expect(transformFixture.controls.axis).toBe("Y");

    selectMode(controls, "rotate");
    expect(transformFixture.controls.axis).toBe("Z");
  });

  gamepadTest("toggles between world and local transform space", () => {
    const transformFixture = createTransformControls();
    const controls = createControls(transformFixture.controls);

    updateInput(controls);
    pressButton(controls, DEFAULT_BUTTONS.toggleSpace);
    expect(transformFixture.controls.space).toBe("local");

    pressButton(controls, DEFAULT_BUTTONS.toggleSpace);
    expect(transformFixture.controls.space).toBe("world");
  });

  gamepadTest("cycles composite axes independently in every mode", () => {
    const transformFixture = createTransformControls();
    const controls = createControls(transformFixture.controls);

    updateInput(controls);

    for (const axis of ["XY", "YZ", "XZ", "XYZ", "XY"] as const) {
      pressButton(controls, DEFAULT_BUTTONS.axisComposite);
      expect(transformFixture.controls.axis).toBe(axis);
    }

    selectMode(controls, "rotate");
    for (const axis of ["E", "XYZE", "E"] as const) {
      pressButton(controls, DEFAULT_BUTTONS.axisComposite);
      expect(transformFixture.controls.axis).toBe(axis);
    }

    selectMode(controls, "scale");
    pressButton(controls, DEFAULT_BUTTONS.axisComposite);
    expect(transformFixture.controls.axis).toBe("XYZ");
    pressButton(controls, DEFAULT_BUTTONS.axisComposite);
    expect(transformFixture.controls.axis).toBe("XYZ");
  });

  gamepadTest(
    "cycles all visible axes in both directions with wrapping",
    () => {
      const transformFixture = createTransformControls();
      const controls = createControls(transformFixture.controls);

      updateInput(controls);
      pressButton(controls, DEFAULT_BUTTONS.axisPrevious);
      expect(transformFixture.controls.axis).toBe("XYZ");

      pressButton(controls, DEFAULT_BUTTONS.axisNext);
      expect(transformFixture.controls.axis).toBe("X");
      pressButton(controls, DEFAULT_BUTTONS.axisNext);
      expect(transformFixture.controls.axis).toBe("Y");
    },
  );

  gamepadTest(
    "skips hidden axes and clears the selection when none remain",
    () => {
      const transformFixture = createTransformControls();
      const controls = createControls(transformFixture.controls);

      updateInput(controls);
      transformFixture.controls.showX = false;
      updateInput(controls);
      expect(transformFixture.controls.axis).toBe("Y");

      pressButton(controls, DEFAULT_BUTTONS.axisX);
      expect(transformFixture.controls.axis).toBe("Y");

      transformFixture.controls.showY = false;
      transformFixture.controls.showZ = false;
      updateInput(controls);
      expect(transformFixture.controls.axis).toBeNull();

      pressButton(controls, DEFAULT_BUTTONS.axisNext);
      expect(transformFixture.controls.axis).toBeNull();

      transformFixture.controls.showX = true;
      updateInput(controls, {
        buttons: createGamepadButtons([DEFAULT_BUTTONS.axisPrevious, true]),
      });
      expect(transformFixture.controls.axis).toBe("X");
    },
  );

  gamepadTest("skips hidden planes while cycling composite axes", () => {
    const transformFixture = createTransformControls();
    const controls = createControls(transformFixture.controls);

    transformFixture.controls.showXY = false;
    updateInput(controls);
    pressButton(controls, DEFAULT_BUTTONS.axisComposite);
    expect(transformFixture.controls.axis).toBe("YZ");

    transformFixture.controls.showYZ = false;
    pressButton(controls, DEFAULT_BUTTONS.axisComposite);
    expect(transformFixture.controls.axis).toBe("XZ");

    transformFixture.controls.showXZ = false;
    pressButton(controls, DEFAULT_BUTTONS.axisComposite);
    expect(transformFixture.controls.axis).toBe("XYZ");
  });

  gamepadTest("applies custom button bindings", () => {
    const transformFixture = createTransformControls();
    const controls = createControls(transformFixture.controls, {
      buttonAxisY: 6,
      buttonRotate: 7,
      buttonToggleSpace: 8,
    });

    updateInput(controls);
    pressButton(controls, 7);
    pressButton(controls, 6);
    pressButton(controls, 8);

    expect(transformFixture.controls.mode).toBe("rotate");
    expect(transformFixture.controls.axis).toBe("Y");
    expect(transformFixture.controls.space).toBe("local");
  });
});

describe("GamepadTransformControls interaction lifecycle", () => {
  gamepadTest(
    "dispatches native-style events from stick press to release",
    () => {
      const transformFixture = createTransformControls();
      const controls = createControls(transformFixture.controls);

      updateInput(controls);
      updateInput(controls, { axes: [1, 0] });

      expect(transformFixture.controls.dragging).toBe(true);
      expectTransformEvents(transformFixture);
      expect(transformFixture.mouseDown).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "translate", type: "mouseDown" }),
      );

      updateInput(controls);

      expect(transformFixture.controls.dragging).toBe(false);
      expect(transformFixture.controls.axis).toBe("X");
      expect(transformFixture.mouseUp).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ mode: "translate", type: "mouseUp" }),
      );
    },
  );

  gamepadTest("resets an active transformation to its captured start", () => {
    const transformFixture = createTransformControls();
    const controls = createControls(transformFixture.controls);

    updateInput(controls);
    updateInput(controls, { axes: [1, 0] });
    expect(transformFixture.object.position.x).toBeGreaterThan(0);

    updateInput(controls, {
      axes: [1, 0],
      buttons: createGamepadButtons([DEFAULT_BUTTONS.reset, true]),
      deltaTime: 0,
    });

    expect(transformFixture.reset).toHaveBeenCalledOnce();
    expect(transformFixture.object.position).toEqual(new Vector3());
    expect(transformFixture.controls.dragging).toBe(true);
  });

  gamepadTest("ignores reset while no transformation is active", () => {
    const transformFixture = createTransformControls();
    const controls = createControls(transformFixture.controls);

    updateInput(controls);
    pressButton(controls, DEFAULT_BUTTONS.reset);

    expect(transformFixture.reset).not.toHaveBeenCalled();
  });

  gamepadTest(
    "ends an active transformation when controls are disabled",
    () => {
      const transformFixture = createTransformControls();
      const controls = createControls(transformFixture.controls);

      updateInput(controls);
      updateInput(controls, { axes: [1, 0] });
      transformFixture.controls.enabled = false;
      updateInput(controls, { axes: [1, 0] });

      expect(transformFixture.controls.dragging).toBe(false);
      expect(transformFixture.controls.axis).toBeNull();
      expect(transformFixture.mouseUp).toHaveBeenCalledOnce();
    },
  );

  gamepadTest(
    "ends an active transformation when the object is detached",
    () => {
      const transformFixture = createTransformControls();
      const controls = createControls(transformFixture.controls);

      updateInput(controls);
      updateInput(controls, { axes: [1, 0] });
      transformFixture.controls.detach();
      updateInput(controls, { axes: [1, 0] });

      expect(transformFixture.controls.dragging).toBe(false);
      expect(transformFixture.controls.axis).toBeNull();
      expect(transformFixture.mouseUp).toHaveBeenCalledOnce();
    },
  );

  gamepadTest("ends an active transformation on gamepad disconnection", () => {
    const transformFixture = createTransformControls();
    const controls = createControls(transformFixture.controls);

    updateInput(controls);
    updateInput(controls, { axes: [1, 0] });
    polling.setGamepads([]);
    controls.update(0.1);

    expect(transformFixture.controls.dragging).toBe(false);
    expect(transformFixture.controls.axis).toBeNull();
    expect(transformFixture.mouseUp).toHaveBeenCalledOnce();
  });

  gamepadTest("ends an active transformation on disposal", () => {
    const transformFixture = createTransformControls();
    const controls = createControls(transformFixture.controls);

    updateInput(controls);
    updateInput(controls, { axes: [1, 0] });
    controls.dispose();

    expect(transformFixture.controls.dragging).toBe(false);
    expect(transformFixture.controls.axis).toBeNull();
    expect(transformFixture.mouseUp).toHaveBeenCalledOnce();
  });
});

describe("GamepadTransformControls translation", () => {
  gamepadTest.each([
    ["X", [1, 0], [true, false, false]],
    ["Y", [0, -1], [false, true, false]],
    ["Z", [1, 0], [false, false, true]],
    ["XY", [1, -1], [true, true, false]],
    ["YZ", [0, -1], [false, true, true]],
    ["XZ", [1, 0], [true, false, true]],
    ["XYZ", [1, -1], [true, true, false]],
  ] as const)(
    "translates along the %s selection",
    (axis, axes, changedComponents) => {
      const transformFixture = createTransformControls();
      const controls = createControls(transformFixture.controls);

      updateInput(controls);
      selectAxis(controls, "translate", axis);
      updateInput(controls, { axes });

      const position = transformFixture.object.position;
      expect(position.x !== 0).toBe(changedComponents[0]);
      expect(position.y !== 0).toBe(changedComponents[1]);
      expect(position.z !== 0).toBe(changedComponents[2]);
      expectTransformEvents(transformFixture);
    },
  );

  gamepadTest("uses local object orientation for local translation", () => {
    const transformFixture = createTransformControls();
    transformFixture.object.rotateZ(Math.PI / 2);
    transformFixture.object.updateMatrixWorld();
    transformFixture.controls.setSpace("local");
    const controls = createControls(transformFixture.controls);

    updateInput(controls);
    updateInput(controls, { axes: [0, -1] });

    expect(transformFixture.object.position.x).toBeCloseTo(0);
    expect(transformFixture.object.position.y).toBeGreaterThan(0);
  });

  gamepadTest("applies translation snapping and position bounds", () => {
    const transformFixture = createTransformControls();
    transformFixture.controls.translationSnap = 2;
    transformFixture.controls.minX = -1;
    transformFixture.controls.maxX = 3;
    const controls = createControls(transformFixture.controls, {
      translateSpeed: 10,
    });

    updateInput(controls);
    updateInput(controls, { axes: [1, 0] });

    expect(transformFixture.object.position.x).toBe(3);
  });

  gamepadTest("keeps continuous translation when snap is not positive", () => {
    const transformFixture = createTransformControls();
    transformFixture.controls.translationSnap = 0;
    const controls = createControls(transformFixture.controls, {
      translateSpeed: 0.1,
    });

    updateInput(controls);
    updateInput(controls, { axes: [1, 0] });

    expect(transformFixture.object.position.x).toBeGreaterThan(0);
    expect(transformFixture.object.position.x).not.toBe(
      Math.round(transformFixture.object.position.x),
    );
  });

  gamepadTest("snaps selected components in local transform space", () => {
    const transformFixture = createTransformControls();
    transformFixture.object.rotateZ(Math.PI / 4);
    transformFixture.object.updateMatrixWorld();
    transformFixture.controls.translationSnap = 1;
    transformFixture.controls.setSpace("local");
    const inverseStartQuaternion = transformFixture.object.quaternion
      .clone()
      .invert();
    const controls = createControls(transformFixture.controls);

    updateInput(controls);
    selectAxis(controls, "translate", "YZ");
    updateInput(controls, { axes: [1, -1] });

    const localPosition = transformFixture.object.position
      .clone()
      .applyQuaternion(inverseStartQuaternion);
    expect(localPosition.y).toBeCloseTo(Math.round(localPosition.y));
    expect(localPosition.z).toBeCloseTo(Math.round(localPosition.z));
  });

  gamepadTest(
    "does not dispatch changes for input perpendicular to the axis",
    () => {
      const transformFixture = createTransformControls();
      const controls = createControls(transformFixture.controls);

      updateInput(controls);
      updateInput(controls, { axes: [0, 1] });

      expect(transformFixture.controls.dragging).toBe(true);
      expect(transformFixture.object.position).toEqual(new Vector3());
      expect(transformFixture.objectChange).not.toHaveBeenCalled();
    },
  );

  gamepadTest("converts translation through a transformed parent", () => {
    const parent = new Group();
    const object = new Object3D();
    parent.position.set(3, 4, 5);
    parent.rotation.z = Math.PI / 2;
    parent.scale.set(2, 3, 4);
    parent.add(object);
    parent.updateMatrixWorld(true);
    const transformFixture = createTransformControls({ object });
    transformFixture.controls.translationSnap = 1;
    const controls = createControls(transformFixture.controls);

    updateInput(controls);
    updateInput(controls, { axes: [1, 0] });

    expect(object.position.length()).toBeGreaterThan(0);
    const worldPosition = object.getWorldPosition(new Vector3());
    expect(worldPosition.x).toBe(Math.round(worldPosition.x));
  });

  gamepadTest("handles zero parent scale without non-finite movement", () => {
    const parent = new Group();
    const object = new Object3D();
    parent.scale.set(0, 0, 0);
    parent.add(object);
    parent.updateMatrixWorld(true);
    const transformFixture = createTransformControls({ object });
    const controls = createControls(transformFixture.controls);

    updateInput(controls);
    selectAxis(controls, "translate", "XYZ");
    updateInput(controls, { axes: [1, -1] });

    expect(object.position.toArray().every(Number.isFinite)).toBe(true);
  });

  gamepadTest.each([
    new OrthographicCamera(-4, 4, 3, -3, 0.1, 100),
    new Camera(),
  ])("translates with a %s", (camera) => {
    const transformFixture = createTransformControls({ camera });
    const controls = createControls(transformFixture.controls);

    updateInput(controls);
    updateInput(controls, { axes: [1, 0] });

    expect(transformFixture.object.position.x).toBeGreaterThan(0);
  });
});

describe("GamepadTransformControls rotation", () => {
  gamepadTest.each([
    ["X", [0, 1]],
    ["Y", [1, 0]],
    ["Z", [1, 0]],
    ["E", [1, 0]],
    ["XYZE", [1, -0.5]],
  ] as const)("rotates around the %s selection", (axis, axes) => {
    const transformFixture = createTransformControls();
    const controls = createControls(transformFixture.controls);

    updateInput(controls);
    selectAxis(controls, "rotate", axis);
    updateInput(controls, { axes });

    expect(transformFixture.object.quaternion.equals(new Quaternion())).toBe(
      false,
    );
    expectTransformEvents(transformFixture);
  });

  gamepadTest("applies local rotation with snapping", () => {
    const transformFixture = createTransformControls();
    transformFixture.object.rotateZ(Math.PI / 4);
    transformFixture.object.updateMatrixWorld();
    transformFixture.controls.rotationSnap = Math.PI / 2;
    transformFixture.controls.setSpace("local");
    const initialQuaternion = transformFixture.object.quaternion.clone();
    const controls = createControls(transformFixture.controls, {
      rotateSpeed: 2,
    });

    updateInput(controls);
    selectAxis(controls, "rotate", "X");
    updateInput(controls, { axes: [0, 1], deltaTime: 0.3 });

    expect(transformFixture.object.quaternion.equals(initialQuaternion)).toBe(
      false,
    );
  });

  gamepadTest("rotates correctly under a transformed parent", () => {
    const parent = new Group();
    const object = new Object3D();
    parent.rotation.set(0.25, -0.5, 0.75);
    parent.add(object);
    parent.updateMatrixWorld(true);
    const transformFixture = createTransformControls({ object });
    const controls = createControls(transformFixture.controls);

    updateInput(controls);
    selectAxis(controls, "rotate", "E");
    updateInput(controls, { axes: [1, 0] });

    expect(object.quaternion.equals(new Quaternion())).toBe(false);
  });

  gamepadTest("keeps unsnapped rotation when snap is not positive", () => {
    const transformFixture = createTransformControls();
    transformFixture.controls.rotationSnap = 0;
    const controls = createControls(transformFixture.controls, {
      rotateSpeed: 0.1,
    });

    updateInput(controls);
    selectAxis(controls, "rotate", "Z");
    updateInput(controls, { axes: [1, 0] });

    expect(transformFixture.object.quaternion.z).not.toBe(0);
  });
});

describe("GamepadTransformControls scale", () => {
  gamepadTest.each([
    ["X", [1, 0], [true, false, false]],
    ["Y", [0, -1], [false, true, false]],
    ["Z", [1, 0], [false, false, true]],
    ["XYZ", [1, 0], [true, true, true]],
  ] as const)(
    "scales along the %s selection",
    (axis, axes, changedComponents) => {
      const transformFixture = createTransformControls();
      const controls = createControls(transformFixture.controls);

      updateInput(controls);
      selectAxis(controls, "scale", axis);
      updateInput(controls, { axes });

      const scale = transformFixture.object.scale;
      expect(scale.x !== 1).toBe(changedComponents[0]);
      expect(scale.y !== 1).toBe(changedComponents[1]);
      expect(scale.z !== 1).toBe(changedComponents[2]);
      expectTransformEvents(transformFixture);
    },
  );

  gamepadTest("applies scale snapping without collapsing to zero", () => {
    const transformFixture = createTransformControls();
    transformFixture.object.scale.set(0.1, 1, 1);
    transformFixture.object.updateMatrixWorld();
    transformFixture.controls.scaleSnap = 0.5;
    const controls = createControls(transformFixture.controls, {
      scaleSpeed: 0.1,
    });

    updateInput(controls);
    selectAxis(controls, "scale", "X");
    updateInput(controls, { axes: [-1, 0] });

    expect(transformFixture.object.scale.x).toBe(0.5);
  });

  gamepadTest("keeps continuous scale when snap is not positive", () => {
    const transformFixture = createTransformControls();
    transformFixture.controls.scaleSnap = 0;
    const controls = createControls(transformFixture.controls, {
      scaleSpeed: 0.25,
    });

    updateInput(controls);
    selectAxis(controls, "scale", "X");
    updateInput(controls, { axes: [1, 0] });

    expect(transformFixture.object.scale.x).toBeCloseTo(Math.exp(0.025));
  });

  gamepadTest("snaps every component during uniform scale", () => {
    const transformFixture = createTransformControls();
    transformFixture.object.scale.setScalar(0.7);
    transformFixture.object.updateMatrixWorld();
    transformFixture.controls.scaleSnap = 0.5;
    const controls = createControls(transformFixture.controls);

    updateInput(controls);
    selectAxis(controls, "scale", "XYZ");
    updateInput(controls, { axes: [1, 0] });

    expect(transformFixture.object.scale).toEqual(new Vector3(1, 1, 1));
  });

  gamepadTest("snaps a selected scale axis other than X", () => {
    const transformFixture = createTransformControls();
    transformFixture.object.scale.set(1, 0.7, 1);
    transformFixture.object.updateMatrixWorld();
    transformFixture.controls.scaleSnap = 0.5;
    const controls = createControls(transformFixture.controls);

    updateInput(controls);
    selectAxis(controls, "scale", "Y");
    updateInput(controls, { axes: [0, -1] });

    expect(transformFixture.object.scale).toEqual(new Vector3(1, 1, 1));
  });

  gamepadTest(
    "does not dispatch changes for zero projected scale input",
    () => {
      const transformFixture = createTransformControls();
      const controls = createControls(transformFixture.controls);

      updateInput(controls);
      selectAxis(controls, "scale", "X");
      updateInput(controls, { axes: [0, 1] });

      expect(transformFixture.controls.dragging).toBe(true);
      expect(transformFixture.object.scale).toEqual(new Vector3(1, 1, 1));
      expect(transformFixture.objectChange).not.toHaveBeenCalled();
    },
  );

  gamepadTest("ignores non-finite scale factors", () => {
    const transformFixture = createTransformControls();
    const controls = createControls(transformFixture.controls, {
      scaleSpeed: Number.POSITIVE_INFINITY,
    });

    updateInput(controls);
    selectAxis(controls, "scale", "XYZ");
    updateInput(controls, { axes: [1, 0] });

    expect(transformFixture.object.scale).toEqual(new Vector3(1, 1, 1));
    expect(transformFixture.objectChange).not.toHaveBeenCalled();
  });
});
