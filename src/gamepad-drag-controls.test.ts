import {
  Camera,
  Group,
  type Intersection,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Vector2,
  Vector3,
} from "three";
import type { DragControls } from "three/addons/controls/DragControls.js";
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
  GamepadDragControls,
  type GamepadDragControlsOptions,
} from "./gamepad-drag-controls.ts";
import { gamepadStickPipeline } from "./gamepad-stick-processing.ts";

const createPerspectiveCamera = (): PerspectiveCamera => {
  const camera = new PerspectiveCamera(60, 2, 0.1, 100);

  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  return camera;
};

const createIntersection = (object: Object3D): Intersection =>
  ({
    distance: 1,
    object,
    point: new Vector3(),
  }) as Intersection;

const createDragControls = (camera: Camera = createPerspectiveCamera()) => {
  const hits: Intersection[] = [];
  const targetLengths: number[] = [];
  const objects: Object3D[] = [];
  const setFromCamera = vi.fn<(coordinates: Vector2, camera: Camera) => void>();
  const intersectObjects = vi.fn<
    (
      objects: Object3D[],
      recursive: boolean,
      target: Intersection[],
    ) => Intersection[]
  >((_objects, _recursive, target) => {
    targetLengths.push(target.length);
    target.push(...hits);

    return target;
  });

  return {
    controls: {
      dispatchEvent:
        vi.fn<(event: { type: string; object: Object3D }) => void>(),
      enabled: true,
      object: camera,
      objects,
      raycaster: {
        intersectObjects,
        setFromCamera,
      },
      recursive: true,
      rotateSpeed: 2,
      transformGroup: false,
    },
    intersectObjects,
    setFromCamera,
    setHits(...nextHits: Object3D[]): void {
      hits.splice(0, hits.length, ...nextHits.map(createIntersection));
    },
    targetLengths,
  };
};

type DragControlsFixture = ReturnType<typeof createDragControls>;

let controlsInstances: GamepadDragControls[];
let polling: GamepadPollingFixture;

const createControls = (
  dragControls: DragControlsFixture["controls"],
  options?: Partial<GamepadDragControlsOptions>,
): GamepadDragControls => {
  const controls = new GamepadDragControls(
    dragControls as unknown as DragControls,
    options,
  );

  controlsInstances.push(controls);

  return controls;
};

const eventTypes = (dragControls: DragControlsFixture["controls"]): string[] =>
  dragControls.dispatchEvent.mock.calls.map(([event]) => event.type);

const grabObject = (
  controls: GamepadDragControls,
  dragFixture: DragControlsFixture,
  object: Object3D,
  buttonSelect = 0,
): void => {
  dragFixture.setHits(object);
  polling.gamepads[0] = createGamepad(0, { timestamp: 1 });
  controls.update(0.1);
  polling.gamepads[0] = createGamepad(0, {
    buttons: createGamepadButtons([buttonSelect, true]),
    timestamp: 2,
  });
  controls.update(0.1);
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

describe("GamepadDragControls construction and options", () => {
  gamepadTest("forwards gamepad selection options to the base controls", () => {
    const { controls: dragControls } = createDragControls();

    expect(() => createControls(dragControls, { gamepadIndex: -1 })).toThrow(
      "gamepadIndex must be an integer",
    );
  });

  gamepadTest(
    "merges partial stick bindings and uses a remapped select button",
    () => {
      const dragFixture = createDragControls();
      const object = new Object3D();
      const dragTransform = vi.fn(() => ({ x: 0.5, y: 0 }));
      const rotateTransform = vi.fn(() => ({ x: 0.25, y: 0 }));
      const rotateOnWorldAxis = vi.spyOn(object, "rotateOnWorldAxis");
      const controls = createControls(dragFixture.controls, {
        buttonSelect: 9,
        dragStick: {
          xAxis: 4,
          pipeline: gamepadStickPipeline().transform(dragTransform),
        },
        rotateStick: {
          yAxis: 5,
          pipeline: gamepadStickPipeline().transform(rotateTransform),
        },
      });
      grabObject(controls, dragFixture, object, 9);
      dragFixture.controls.dispatchEvent.mockClear();
      polling.gamepads[0] = createGamepad(0, {
        axes: [0, -0.3, 0.4, 0, 0.6, -0.5],
        timestamp: 3,
      });

      controls.update(0.1);

      expect(dragTransform).toHaveBeenCalledExactlyOnceWith({
        x: 0.6,
        y: -0.3,
      });
      expect(rotateTransform).toHaveBeenCalledExactlyOnceWith({
        x: 0.4,
        y: -0.5,
      });
      expect(rotateOnWorldAxis).toHaveBeenCalledOnce();
      expect(eventTypes(dragFixture.controls)).toEqual(["drag"]);
    },
  );
});

describe("GamepadDragControls hover and selection", () => {
  gamepadTest("tracks hover changes from the viewport center ray", () => {
    const dragFixture = createDragControls();
    const firstObject = new Object3D();
    const secondObject = new Object3D();
    dragFixture.controls.objects.push(firstObject, secondObject);
    const controls = createControls(dragFixture.controls);
    polling.gamepads[0] = createGamepad(0);
    dragFixture.setHits(firstObject);

    controls.update(0.1);
    controls.update(0.1);
    dragFixture.setHits(secondObject);
    controls.update(0.1);
    dragFixture.setHits();
    controls.update(0.1);

    expect(dragFixture.setFromCamera).toHaveBeenCalledWith(
      new Vector2(0, 0),
      dragFixture.controls.object,
    );
    expect(dragFixture.intersectObjects).toHaveBeenCalledWith(
      dragFixture.controls.objects,
      true,
      expect.any(Array),
    );
    expect(dragFixture.targetLengths).toEqual([0, 0, 0, 0]);
    expect(dragFixture.controls.dispatchEvent.mock.calls).toEqual([
      [{ type: "hoveron", object: firstObject }],
      [{ type: "hoveroff", object: firstObject }],
      [{ type: "hoveron", object: secondObject }],
      [{ type: "hoveroff", object: secondObject }],
    ]);
  });

  gamepadTest("ignores a select press when the reticle hits nothing", () => {
    const dragFixture = createDragControls();
    const controls = createControls(dragFixture.controls);
    polling.gamepads[0] = createGamepad(0, { timestamp: 1 });
    controls.update(0.1);
    polling.gamepads[0] = createGamepad(0, {
      buttons: createGamepadButtons([0, true]),
      timestamp: 2,
    });

    controls.update(0.1);

    expect(eventTypes(dragFixture.controls)).toEqual([]);
  });

  gamepadTest("uses consecutive select presses to grab and drop", () => {
    const dragFixture = createDragControls();
    const object = new Object3D();
    const controls = createControls(dragFixture.controls);
    grabObject(controls, dragFixture, object);
    const raycastCallsAfterGrab =
      dragFixture.intersectObjects.mock.calls.length;

    polling.gamepads[0] = createGamepad(0, { timestamp: 3 });
    controls.update(0.1);
    polling.gamepads[0] = createGamepad(0, {
      buttons: createGamepadButtons([0, true]),
      timestamp: 4,
    });
    controls.update(0.1);

    expect(eventTypes(dragFixture.controls)).toEqual([
      "hoveron",
      "dragstart",
      "dragend",
    ]);
    expect(dragFixture.intersectObjects).toHaveBeenCalledTimes(
      raycastCallsAfterGrab,
    );
  });

  gamepadTest("selects the outermost group when requested", () => {
    const dragFixture = createDragControls();
    const outerGroup = new Group();
    const innerGroup = new Group();
    const object = new Object3D();
    outerGroup.add(innerGroup);
    innerGroup.add(object);
    dragFixture.controls.transformGroup = true;
    const controls = createControls(dragFixture.controls);

    grabObject(controls, dragFixture, object);

    expect(dragFixture.controls.dispatchEvent).toHaveBeenLastCalledWith({
      type: "dragstart",
      object: outerGroup,
    });
  });

  gamepadTest("falls back to the hit object when no group exists", () => {
    const dragFixture = createDragControls();
    const parent = new Object3D();
    const object = new Object3D();
    parent.add(object);
    dragFixture.controls.transformGroup = true;
    const controls = createControls(dragFixture.controls);

    grabObject(controls, dragFixture, object);

    expect(dragFixture.controls.dispatchEvent).toHaveBeenLastCalledWith({
      type: "dragstart",
      object,
    });
  });
});

describe("GamepadDragControls dragging", () => {
  gamepadTest("drags a root object in a perspective camera plane", () => {
    const dragFixture = createDragControls();
    const camera = dragFixture.controls.object as PerspectiveCamera;
    const object = new Object3D();
    const controls = createControls(dragFixture.controls, { dragSpeed: 2 });
    grabObject(controls, dragFixture, object);
    dragFixture.controls.dispatchEvent.mockClear();
    polling.gamepads[0] = createGamepad(0, {
      axes: [0.5, -0.25, 0, 0],
      timestamp: 3,
    });

    controls.update(0.5);

    const height = 2 * Math.tan((camera.fov * Math.PI) / 360) * 10;
    expect(object.position.x).toBeCloseTo(0.5 * height * camera.aspect);
    expect(object.position.y).toBeCloseTo(0.25 * height);
    expect(object.position.z).toBeCloseTo(0);
    expect(dragFixture.controls.dispatchEvent).toHaveBeenCalledExactlyOnceWith({
      type: "drag",
      object,
    });
  });

  gamepadTest(
    "converts orthographic world movement into parent-local position",
    () => {
      const camera = new OrthographicCamera(-2, 2, 3, -3, 0.1, 100);
      camera.position.set(0, 0, 10);
      camera.lookAt(0, 0, 0);
      camera.zoom = 2;
      camera.updateMatrixWorld();
      const dragFixture = createDragControls(camera);
      const parent = new Object3D();
      const object = new Object3D();
      parent.position.set(10, 5, 0);
      object.position.set(1, 1, 0);
      parent.add(object);
      parent.updateMatrixWorld(true);
      const controls = createControls(dragFixture.controls, { dragSpeed: 2 });
      grabObject(controls, dragFixture, object);
      dragFixture.controls.dispatchEvent.mockClear();
      polling.gamepads[0] = createGamepad(0, {
        axes: [0.5, 0.5, 0, 0],
        timestamp: 3,
      });

      controls.update(0.5);

      expect(object.position.x).toBeCloseTo(2);
      expect(object.position.y).toBeCloseTo(-0.5);
      expect(object.position.z).toBeCloseTo(0);
      expect(eventTypes(dragFixture.controls)).toEqual(["drag"]);
    },
  );

  gamepadTest("uses a unit viewport for an unknown camera type", () => {
    const camera = new Camera();
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const dragFixture = createDragControls(camera);
    const object = new Object3D();
    const controls = createControls(dragFixture.controls);
    grabObject(controls, dragFixture, object);
    dragFixture.controls.dispatchEvent.mockClear();
    polling.gamepads[0] = createGamepad(0, {
      axes: [1, -1, 0, 0],
      timestamp: 3,
    });

    controls.update(0.5);

    expect(object.position).toEqual(new Vector3(0.5, 0.5, 0));
    expect(eventTypes(dragFixture.controls)).toEqual(["drag"]);
  });

  gamepadTest(
    "does not dispatch drag while the selected object is idle",
    () => {
      const dragFixture = createDragControls();
      const object = new Object3D();
      const controls = createControls(dragFixture.controls);
      grabObject(controls, dragFixture, object);
      dragFixture.controls.dispatchEvent.mockClear();
      polling.gamepads[0] = createGamepad(0, { timestamp: 3 });

      controls.update(0.1);

      expect(eventTypes(dragFixture.controls)).toEqual([]);
    },
  );
});

describe("GamepadDragControls rotation", () => {
  gamepadTest("rotates around camera-relative world axes", () => {
    const dragFixture = createDragControls();
    const object = new Object3D();
    const rotateOnWorldAxis = vi.spyOn(object, "rotateOnWorldAxis");
    const controls = createControls(dragFixture.controls, { rotateSpeed: 3 });
    grabObject(controls, dragFixture, object);
    dragFixture.controls.dispatchEvent.mockClear();
    polling.gamepads[0] = createGamepad(0, {
      axes: [0, 0, 0.5, 0],
      timestamp: 3,
    });

    controls.update(0.1);
    polling.gamepads[0] = createGamepad(0, {
      axes: [0, 0, 0, -0.25],
      timestamp: 4,
    });
    controls.update(0.1);

    const [horizontalAxis, horizontalAngle] = rotateOnWorldAxis.mock.calls[0];
    const [verticalAxis, verticalAngle] = rotateOnWorldAxis.mock.calls[1];
    expect(horizontalAxis).toEqual(new Vector3(0, 1, 0));
    expect(horizontalAngle).toBeCloseTo(0.3 * Math.PI);
    expect(verticalAxis).toEqual(new Vector3(1, 0, 0));
    expect(verticalAngle).toBeCloseTo(-0.15 * Math.PI);
    expect(eventTypes(dragFixture.controls)).toEqual(["drag", "drag"]);
  });
});

describe("GamepadDragControls cleanup", () => {
  gamepadTest("releases selection and hover when disabled", () => {
    const dragFixture = createDragControls();
    const object = new Object3D();
    const controls = createControls(dragFixture.controls);
    grabObject(controls, dragFixture, object);
    dragFixture.controls.dispatchEvent.mockClear();
    dragFixture.controls.enabled = false;

    controls.update(0.1);
    controls.update(0.1);

    expect(dragFixture.controls.dispatchEvent.mock.calls).toEqual([
      [{ type: "dragend", object }],
      [{ type: "hoveroff", object }],
    ]);
  });

  gamepadTest("releases selection and hover on gamepad disconnection", () => {
    const dragFixture = createDragControls();
    const object = new Object3D();
    const controls = createControls(dragFixture.controls);
    grabObject(controls, dragFixture, object);
    dragFixture.controls.dispatchEvent.mockClear();
    polling.gamepads[0] = null;

    controls.update(0.1);

    expect(dragFixture.controls.dispatchEvent.mock.calls).toEqual([
      [{ type: "dragend", object }],
      [{ type: "hoveroff", object }],
    ]);
  });

  gamepadTest("releases selection and hover when disposed", () => {
    const dragFixture = createDragControls();
    const object = new Object3D();
    const controls = createControls(dragFixture.controls);
    grabObject(controls, dragFixture, object);
    dragFixture.controls.dispatchEvent.mockClear();

    controls.dispose();

    expect(dragFixture.controls.dispatchEvent.mock.calls).toEqual([
      [{ type: "dragend", object }],
      [{ type: "hoveroff", object }],
    ]);
    expect(controls.enabled).toBe(false);
    expect(controls.gamepad).toBeNull();
  });
});
