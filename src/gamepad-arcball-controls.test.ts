import {
  Matrix4,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
} from "three";
import type { ArcballControls } from "three/addons/controls/ArcballControls.js";
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
  GamepadArcballControls,
  type GamepadArcballControlsOptions,
} from "./gamepad-arcball-controls.ts";
import { gamepadStickPipeline } from "./gamepad-stick-processing.ts";

type ArcballTransformation = {
  camera: Matrix4 | null;
  gizmos: Matrix4 | null;
};

const createArcballControls = () => {
  const transformation: ArcballTransformation = {
    camera: new Matrix4().makeTranslation(1, 2, 3),
    gizmos: new Matrix4().makeScale(2, 2, 2),
  };
  const object = new PerspectiveCamera();
  const gizmos = new Object3D();

  object.position.set(0, 0, 10);
  object.lookAt(0, 0, 0);
  object.updateMatrixWorld();
  gizmos.position.set(1, 2, 3);

  return {
    transformation,
    controls: {
      enabled: true,
      enableFocus: true,
      enablePan: true,
      enableRotate: true,
      enableZoom: true,
      object,
      rotateSpeed: 2,
      scaleFactor: 2,
      scene: new Scene() as Scene | null,
      _gizmos: gizmos,
      _rotationAxis: new Vector3(),
      _tbRadius: 2,
      applyTransformMatrix:
        vi.fn<(transformation: ArcballTransformation) => void>(),
      dispatchEvent: vi.fn<(event: { type: string }) => void>(),
      focus: vi.fn<(point: Vector3, size: number, amount?: number) => void>(),
      pan: vi.fn<
        (p0: Vector3, p1: Vector3, adjust?: boolean) => ArcballTransformation
      >(() => transformation),
      rotate: vi.fn<(axis: Vector3, angle: number) => ArcballTransformation>(
        () => transformation,
      ),
      scale: vi.fn<
        (
          size: number,
          point: Vector3,
          scaleGizmos?: boolean,
        ) => ArcballTransformation | undefined
      >(() => transformation),
      unprojectOnObj: vi.fn<
        (cursor: Vector2, camera: PerspectiveCamera) => Vector3 | null
      >(() => null),
      update: vi.fn<() => void>(),
      updateMatrixState: vi.fn<() => void>(),
      zRotate: vi.fn<(point: Vector3, angle: number) => ArcballTransformation>(
        () => transformation,
      ),
    },
  };
};

type ArcballControlsFixture = ReturnType<typeof createArcballControls>;

let controlsInstances: GamepadArcballControls[];
let polling: GamepadPollingFixture;

const createControls = (
  arcball: ArcballControlsFixture["controls"],
  options?: Partial<GamepadArcballControlsOptions>,
): GamepadArcballControls => {
  const controls = new GamepadArcballControls(
    arcball as unknown as ArcballControls,
    options,
  );

  controlsInstances.push(controls);

  return controls;
};

const eventTypes = (arcball: ArcballControlsFixture["controls"]): string[] =>
  arcball.dispatchEvent.mock.calls.map(([event]) => event.type);

gamepadTest.beforeEach(({ gamepadPolling }) => {
  controlsInstances = [];
  polling = gamepadPolling;
});

gamepadTest.afterEach(() => {
  for (const controls of controlsInstances) {
    controls.dispose();
  }
});

describe("GamepadArcballControls construction", () => {
  gamepadTest("forwards gamepad selection options to the base controls", () => {
    const { controls: arcball } = createArcballControls();

    expect(() => createControls(arcball, { gamepadIndex: -1 })).toThrow(
      "gamepadIndex must be an integer",
    );
  });

  gamepadTest(
    "merges partial stick bindings and applies their pipelines",
    () => {
      const { controls: arcball } = createArcballControls();
      const rotateTransform = vi.fn(() => ({ x: 0.25, y: 0 }));
      const panTransform = vi.fn(() => ({ x: 0, y: -0.5 }));
      const controls = createControls(arcball, {
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
        axes: [0, -0.3, 0.6, 0, 0.4, -0.5],
      });

      controls.update(0.25);

      expect(rotateTransform).toHaveBeenCalledExactlyOnceWith({
        x: 0.4,
        y: -0.3,
      });
      expect(panTransform).toHaveBeenCalledExactlyOnceWith({
        x: 0.6,
        y: -0.5,
      });
      expect(arcball.rotate).toHaveBeenCalledOnce();
      expect(arcball.pan).toHaveBeenCalledOnce();
    },
  );

  gamepadTest("uses remapped action buttons", () => {
    const { controls: arcball } = createArcballControls();
    const focusPoint = new Vector3(4, 5, 6);
    arcball.unprojectOnObj.mockReturnValue(focusPoint);
    const controls = createControls(arcball, {
      buttonZoomIn: 1,
      buttonZoomOut: 2,
      buttonZRotateLeft: 3,
      buttonZRotateRight: 4,
      buttonFocus: 5,
    });
    polling.gamepads[0] = createGamepad(0, { timestamp: 1 });
    controls.update(0.1);
    polling.gamepads[0] = createGamepad(0, {
      buttons: createGamepadButtons(
        [1, false, 0.8],
        [2, false, 0.2],
        [3, false, 0.7],
        [4, false, 0.1],
        [5, true],
      ),
      timestamp: 2,
    });

    controls.update(0.1);

    expect(arcball.scale).toHaveBeenCalledOnce();
    expect(arcball.zRotate).toHaveBeenCalledOnce();
    expect(arcball.focus).toHaveBeenCalledExactlyOnceWith(
      focusPoint,
      arcball.scaleFactor,
    );
  });
});

describe("GamepadArcballControls input gating", () => {
  gamepadTest("does nothing when all inputs are neutral", () => {
    const { controls: arcball } = createArcballControls();
    const controls = createControls(arcball);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0, 0, 0, 0],
    });

    controls.update(0.1);

    expect(arcball.rotate).not.toHaveBeenCalled();
    expect(arcball.pan).not.toHaveBeenCalled();
    expect(arcball.scale).not.toHaveBeenCalled();
    expect(arcball.zRotate).not.toHaveBeenCalled();
    expect(arcball.focus).not.toHaveBeenCalled();
    expect(eventTypes(arcball)).toEqual([]);
  });

  gamepadTest("respects the wrapped controls feature flags", () => {
    const { controls: arcball } = createArcballControls();
    arcball.enableRotate = false;
    arcball.enablePan = false;
    arcball.enableZoom = false;
    const controls = createControls(arcball);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0.5, -0.5, 0.5, -0.5],
      buttons: createGamepadButtons(
        [4, true],
        [6, false, 0.25],
        [7, false, 0.75],
      ),
    });

    controls.update(0.1);

    expect(arcball.rotate).not.toHaveBeenCalled();
    expect(arcball.pan).not.toHaveBeenCalled();
    expect(arcball.scale).not.toHaveBeenCalled();
    expect(arcball.zRotate).not.toHaveBeenCalled();
    expect(eventTypes(arcball)).toEqual([]);
  });
});

describe("GamepadArcballControls rotation", () => {
  gamepadTest(
    "rotates around the camera up and right axes using configured speed",
    () => {
      const { controls: arcball, transformation } = createArcballControls();
      const controls = createControls(arcball, { rotateSpeed: 3 });
      polling.gamepads[0] = createGamepad(0, {
        axes: [0.5, -0.25, 0, 0],
      });

      controls.update(0.1);

      const [horizontalAxis, horizontalAngle] = arcball.rotate.mock.calls[0];
      const [verticalAxis, verticalAngle] = arcball.rotate.mock.calls[1];

      expect(horizontalAxis).toEqual(new Vector3(0, 1, 0));
      expect(horizontalAngle).toBeCloseTo(0.3 * Math.PI);
      expect(verticalAxis).toEqual(new Vector3(1, 0, 0));
      expect(verticalAngle).toBeCloseTo(0.15 * Math.PI);
      expect(arcball.applyTransformMatrix).toHaveBeenCalledTimes(2);
      expect(arcball.applyTransformMatrix).toHaveBeenCalledWith(transformation);
      expect(arcball.object.up.y).toBeCloseTo(Math.cos(0.15 * Math.PI));
      expect(arcball.object.up.z).toBeCloseTo(-Math.sin(0.15 * Math.PI));
      expect(arcball.update).toHaveBeenCalledOnce();
      expect(eventTypes(arcball)).toEqual(["start", "change"]);
    },
  );

  gamepadTest("ignores rotation with a degenerate axis or zero speed", () => {
    const degenerateFixture = createArcballControls();
    degenerateFixture.controls.object.up.set(0, 0, -1);
    const degenerateControls = createControls(degenerateFixture.controls);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0, 0.5, 0, 0],
    });

    degenerateControls.update(0.1);

    expect(degenerateFixture.controls.rotate).not.toHaveBeenCalled();
    expect(degenerateFixture.controls.update).not.toHaveBeenCalled();

    const zeroSpeedFixture = createArcballControls();
    const zeroSpeedControls = createControls(zeroSpeedFixture.controls, {
      rotateSpeed: 0,
    });
    polling.gamepads[0] = createGamepad(0, {
      axes: [0.5, 0, 0, 0],
      timestamp: 1,
    });

    zeroSpeedControls.update(0.1);

    expect(zeroSpeedFixture.controls.rotate).not.toHaveBeenCalled();
    expect(zeroSpeedFixture.controls.update).not.toHaveBeenCalled();
  });
});

describe("GamepadArcballControls pan and interaction events", () => {
  gamepadTest(
    "pans in trackball space and emits one interaction lifecycle",
    () => {
      const { controls: arcball } = createArcballControls();
      const controls = createControls(arcball, { panSpeed: 3 });
      polling.gamepads[0] = createGamepad(0, {
        axes: [0, 0, 0.4, -0.5],
        timestamp: 1,
      });

      controls.update(0.25);

      const [panStart, panEnd] = arcball.pan.mock.calls[0];
      expect(panStart).toEqual(new Vector3(0, 0, 0));
      expect(panEnd.x).toBeCloseTo(0.6);
      expect(panEnd.y).toBeCloseTo(-0.75);
      expect(panEnd.z).toBe(0);

      polling.gamepads[0] = createGamepad(0, {
        axes: [0, 0, 0.25, 0],
        timestamp: 2,
      });
      controls.update(0.25);

      polling.gamepads[0] = createGamepad(0, {
        axes: [0, 0, 0, 0],
        timestamp: 3,
      });
      controls.update(0.25);

      expect(arcball.pan).toHaveBeenCalledTimes(2);
      expect(arcball.update).toHaveBeenCalledTimes(2);
      expect(eventTypes(arcball)).toEqual(["start", "change", "change", "end"]);
    },
  );

  gamepadTest("ends an interaction when ArcballControls is disabled", () => {
    const { controls: arcball } = createArcballControls();
    const controls = createControls(arcball);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0.5, 0, 0, 0],
    });
    controls.update(0.1);
    arcball.rotate.mockClear();
    arcball.enabled = false;

    controls.update(0.1);

    expect(arcball.rotate).not.toHaveBeenCalled();
    expect(eventTypes(arcball)).toEqual(["start", "change", "end"]);
  });
});

describe("GamepadArcballControls zoom", () => {
  gamepadTest("zooms around the gizmo center using trigger values", () => {
    const { controls: arcball, transformation } = createArcballControls();
    const controls = createControls(arcball, { zoomSpeed: 1.5 });
    polling.gamepads[0] = createGamepad(0, {
      buttons: createGamepadButtons([6, false, 0.25], [7, false, 0.75]),
    });

    controls.update(0.25);

    const [size, point] = arcball.scale.mock.calls[0];
    expect(size).toBeCloseTo(2 ** 1.5);
    expect(point).toBe(arcball._gizmos.position);
    expect(arcball.applyTransformMatrix).toHaveBeenCalledExactlyOnceWith(
      transformation,
    );
    expect(arcball.update).toHaveBeenCalledOnce();
  });

  gamepadTest("ignores zoom inside the configured button dead zone", () => {
    const { controls: arcball } = createArcballControls();
    const controls = createControls(arcball, { buttonDeadzone: 0.2 });
    polling.gamepads[0] = createGamepad(0, {
      buttons: createGamepadButtons([7, false, 0.2]),
    });

    controls.update(0.1);

    expect(arcball.scale).not.toHaveBeenCalled();
    expect(eventTypes(arcball)).toEqual([]);
  });

  gamepadTest("ignores zoom when Arcball cannot produce a valid scale", () => {
    const invalidFactorFixture = createArcballControls();
    invalidFactorFixture.controls.scaleFactor = 0;
    const invalidFactorControls = createControls(invalidFactorFixture.controls);
    polling.gamepads[0] = createGamepad(0, {
      buttons: createGamepadButtons([7, false, 0.5]),
    });

    invalidFactorControls.update(0.1);

    expect(invalidFactorFixture.controls.scale).not.toHaveBeenCalled();

    const neutralSizeFixture = createArcballControls();
    const neutralSizeControls = createControls(neutralSizeFixture.controls, {
      zoomSpeed: 0,
    });

    neutralSizeControls.update(0.1);

    expect(neutralSizeFixture.controls.scale).not.toHaveBeenCalled();

    const nonFiniteFixture = createArcballControls();
    nonFiniteFixture.controls.scaleFactor = Number.POSITIVE_INFINITY;
    const nonFiniteControls = createControls(nonFiniteFixture.controls);

    nonFiniteControls.update(0.1);

    expect(nonFiniteFixture.controls.scale).not.toHaveBeenCalled();
  });

  gamepadTest("does not apply an unavailable Arcball scale transform", () => {
    const { controls: arcball } = createArcballControls();
    arcball.scale.mockReturnValue(undefined);
    const controls = createControls(arcball);
    polling.gamepads[0] = createGamepad(0, {
      buttons: createGamepadButtons([7, false, 0.5]),
    });

    controls.update(0.1);

    expect(arcball.scale).toHaveBeenCalledOnce();
    expect(arcball.applyTransformMatrix).not.toHaveBeenCalled();
    expect(arcball.update).not.toHaveBeenCalled();
    expect(eventTypes(arcball)).toEqual(["start"]);
  });
});

describe("GamepadArcballControls z-rotation", () => {
  gamepadTest("rotates around the camera view axis", () => {
    const { controls: arcball } = createArcballControls();
    const controls = createControls(arcball, { zRotateSpeed: 2 });
    polling.gamepads[0] = createGamepad(0, {
      buttons: createGamepadButtons([4, false, 0.8], [5, false, 0.3]),
    });

    controls.update(0.25);

    const [point, angle] = arcball.zRotate.mock.calls[0];
    expect(point).toBe(arcball._gizmos.position);
    expect(angle).toBeCloseTo(0.25 * Math.PI);
    expect(arcball._rotationAxis.x).toBeCloseTo(0);
    expect(arcball._rotationAxis.y).toBeCloseTo(0);
    expect(arcball._rotationAxis.z).toBeCloseTo(-1);
    expect(arcball.object.up.x).toBeCloseTo(Math.SQRT1_2);
    expect(arcball.object.up.y).toBeCloseTo(Math.SQRT1_2);
    expect(arcball.update).toHaveBeenCalledOnce();
  });
});

describe("GamepadArcballControls focus", () => {
  gamepadTest("focuses the object hit at the viewport center", () => {
    const { controls: arcball } = createArcballControls();
    const focusPoint = new Vector3(4, 5, 6);
    arcball.unprojectOnObj.mockReturnValue(focusPoint);
    const controls = createControls(arcball);
    polling.gamepads[0] = createGamepad(0, { timestamp: 1 });
    controls.update(0.1);
    polling.gamepads[0] = createGamepad(0, {
      buttons: createGamepadButtons([0, true]),
      timestamp: 2,
    });

    controls.update(0.1);

    expect(arcball.unprojectOnObj).toHaveBeenCalledExactlyOnceWith(
      new Vector2(0, 0),
      arcball.object,
    );
    expect(arcball.focus).toHaveBeenCalledExactlyOnceWith(
      focusPoint,
      arcball.scaleFactor,
    );
    expect(arcball.update).toHaveBeenCalledOnce();
    expect(eventTypes(arcball)).toEqual(["start", "change"]);
  });

  gamepadTest("does not focus when no object is hit", () => {
    const { controls: arcball } = createArcballControls();
    const controls = createControls(arcball);
    polling.gamepads[0] = createGamepad(0, { timestamp: 1 });
    controls.update(0.1);
    polling.gamepads[0] = createGamepad(0, {
      buttons: createGamepadButtons([0, true]),
      timestamp: 2,
    });

    controls.update(0.1);

    expect(arcball.unprojectOnObj).toHaveBeenCalledOnce();
    expect(arcball.focus).not.toHaveBeenCalled();
    expect(eventTypes(arcball)).toEqual([]);
  });

  gamepadTest("respects every Arcball focus prerequisite", () => {
    const cases: Array<(arcball: ArcballControlsFixture["controls"]) => void> =
      [
        (arcball) => {
          arcball.enabled = false;
        },
        (arcball) => {
          arcball.enablePan = false;
        },
        (arcball) => {
          arcball.enableFocus = false;
        },
        (arcball) => {
          arcball.scene = null;
        },
      ];

    for (const configure of cases) {
      const { controls: arcball } = createArcballControls();
      configure(arcball);
      const controls = createControls(arcball);
      polling.gamepads[0] = createGamepad(0, { timestamp: 1 });
      controls.update(0.1);
      polling.gamepads[0] = createGamepad(0, {
        buttons: createGamepadButtons([0, true]),
        timestamp: 2,
      });

      controls.update(0.1);

      expect(arcball.unprojectOnObj).not.toHaveBeenCalled();
      expect(arcball.focus).not.toHaveBeenCalled();
    }
  });
});
