import {
  EventDispatcher,
  type Object3D,
  Quaternion,
  Raycaster,
  Vector2,
  Vector3,
} from "three";
import { ArcballControls } from "three/addons/controls/ArcballControls.js";
import {
  DragControls,
  type DragControlsEventMap,
} from "three/addons/controls/DragControls.js";
import { FirstPersonControls } from "three/addons/controls/FirstPersonControls.js";
import { FlyControls } from "three/addons/controls/FlyControls.js";
import { MapControls } from "three/addons/controls/MapControls.js";
import {
  OrbitControls,
  type OrbitControlsEventMap,
} from "three/addons/controls/OrbitControls.js";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { describe, expect, vi } from "vitest";

import {
  createGamepad,
  createGamepadButtons,
  type GamepadFixtureOptions,
} from "../test/fixtures/gamepad.ts";
import {
  dispatchGamepadEvent,
  type GamepadPollingFixture,
  gamepadTest,
} from "../test/fixtures/gamepad-browser.ts";
import {
  type Cleanup,
  collectEvents,
  createCleanup,
  createFrameDriver,
  createThreeEnvironment,
  disposeObjectResources,
} from "../test/fixtures/three-controls.ts";
import { GamepadArcballControls } from "./gamepad-arcball-controls.ts";
import type {
  GamepadControls,
  GamepadControlsEventMap,
} from "./gamepad-controls.ts";
import { GamepadDragControls } from "./gamepad-drag-controls.ts";
import { GamepadFirstPersonControls } from "./gamepad-first-person-controls.ts";
import { GamepadFlyControls } from "./gamepad-fly-controls.ts";
import { GamepadMapControls } from "./gamepad-map-controls.ts";
import { GamepadOrbitControls } from "./gamepad-orbit-controls.ts";
import { GamepadPointerLockControls } from "./gamepad-pointer-lock-controls.ts";
import { GamepadTrackballControls } from "./gamepad-trackball-controls.ts";
import { GamepadTransformControls } from "./gamepad-transform-controls.ts";

const integrationTest = gamepadTest.extend(
  "cleanup",
  ({ gamepadPolling: _polling }, { onCleanup }) => {
    const cleanup = createCleanup();
    onCleanup(() => cleanup.dispose());

    return cleanup;
  },
);

const kinds = [
  "orbit",
  "map",
  "trackball",
  "arcball",
  "fly",
  "firstPerson",
  "pointerLock",
  "drag",
  "transform",
] as const;
type Kind = (typeof kinds)[number];
const delta = 0.1;
const strength = 0.5;

const pose = (object: Object3D) => ({
  position: object.position.clone(),
  quaternion: object.quaternion.clone(),
  scale: object.scale.clone(),
});
const expectPose = (
  object: Object3D,
  expected: ReturnType<typeof pose>,
): void => {
  expect(object.position.distanceTo(expected.position)).toBeLessThan(1e-8);
  expect(object.quaternion.angleTo(expected.quaternion)).toBeLessThan(1e-7);
  expect(object.scale.distanceTo(expected.scale)).toBeLessThan(1e-8);
};

// Construction stays here: the shared fixture does not encode wrapper semantics.
const createScenario = (
  kind: Kind,
  cleanup: Cleanup,
  polling: GamepadPollingFixture,
  projection: "perspective" | "orthographic" = "perspective",
) => {
  const environment = createThreeEnvironment(cleanup, projection);
  const { camera, element, mesh, scene, syncMatrices } = environment;
  const elementListeners = {
    add: vi.spyOn(element, "addEventListener"),
    remove: vi.spyOn(element, "removeEventListener"),
  };
  const options = { gamepadIndex: 3 };
  const native = <T extends { dispose(): void }>(controls: T): T => {
    cleanup.add("native", () => controls.dispose());
    return controls;
  };
  let wrapper: GamepadControls;
  let focusRaycaster: Raycaster | undefined;
  let nativeEvents: {
    type: string;
    source: string;
    data: { position: number[]; object?: string };
  }[] = [];
  let updateNative: ((dt: number) => void) | undefined;
  switch (kind) {
    case "orbit": {
      const controls = native(new OrbitControls(camera, element));
      controls.enableDamping = false;
      controls.autoRotate = false;
      nativeEvents = collectEvents<
        OrbitControlsEventMap,
        "change",
        { position: number[] }
      >(cleanup, controls, ["change"], camera.uuid, () => ({
        position: camera.position.toArray(),
      }));
      wrapper = new GamepadOrbitControls(controls, options);
      updateNative = (dt) => {
        controls.update(dt);
      };
      break;
    }
    case "map": {
      const controls = native(new MapControls(camera, element));
      controls.enableDamping = false;
      controls.autoRotate = false;
      wrapper = new GamepadMapControls(controls, options);
      updateNative = (dt) => {
        controls.update(dt);
      };
      break;
    }
    case "trackball": {
      const controls = native(new TrackballControls(camera, element));
      controls.staticMoving = true;
      controls.rotateSpeed = 1;
      wrapper = new GamepadTrackballControls(controls, options);
      updateNative = () => controls.update();
      break;
    }
    case "arcball": {
      const controls = native(new ArcballControls(camera, element, scene));
      // Arcball removes its gizmos but does not dispose their geometry/material.
      // Capture the added roots through the scene, without private-field access.
      const gizmos = scene.children.filter((child) => child !== mesh);
      for (const root of gizmos)
        cleanup.add("resource", () => disposeObjectResources(root));
      controls.enableAnimations = false;
      controls.rotateSpeed = 1;
      wrapper = new GamepadArcballControls(controls, options);
      focusRaycaster = controls.getRaycaster();
      break;
    }
    case "fly": {
      const controls = native(new FlyControls(camera, element));
      controls.movementSpeed = 4;
      controls.autoForward = false;
      wrapper = new GamepadFlyControls(controls, options);
      updateNative = (dt) => controls.update(dt);
      break;
    }
    case "firstPerson": {
      const controls = native(new FirstPersonControls(camera, element));
      controls.movementSpeed = 4;
      controls.autoForward = false;
      controls.dampingFactor = 1;
      wrapper = new GamepadFirstPersonControls(controls, options);
      updateNative = (dt) => controls.update(dt);
      break;
    }
    case "pointerLock": {
      const controls = native(new PointerLockControls(camera, element));
      wrapper = new GamepadPointerLockControls(controls, {
        ...options,
        moveSpeed: 4,
      });
      break;
    }
    case "drag": {
      const controls = native(new DragControls([mesh], camera, element));
      nativeEvents = collectEvents<
        DragControlsEventMap,
        "dragstart" | "drag" | "dragend",
        { position: number[]; object: string }
      >(
        cleanup,
        controls,
        ["dragstart", "drag", "dragend"],
        "drag-native",
        (event) => ({
          object: event.object.uuid,
          position: event.object.position.toArray(),
        }),
      );
      wrapper = new GamepadDragControls(controls, options);
      break;
    }
    case "transform": {
      const controls = native(new TransformControls(camera, element));
      controls.attach(mesh);
      const helper = controls.getHelper();
      scene.add(helper);
      // Native dispose owns helper GPU resources; this callback only detaches it.
      cleanup.add("resource", () => helper.removeFromParent());
      wrapper = new GamepadTransformControls(controls, options);
      break;
    }
  }
  cleanup.add("wrapper", () => wrapper.dispose());
  const events = collectEvents<
    GamepadControlsEventMap,
    "connected" | "disconnected",
    { index: number; id: string }
  >(cleanup, wrapper, ["connected", "disconnected"], kind, (event) => ({
    index: event.gamepad.index,
    id: event.gamepad.id,
  }));
  const frame = createFrameDriver(polling, syncMatrices, wrapper, updateNative);
  const step = (
    selected: GamepadFixtureOptions = {},
    other: GamepadFixtureOptions = {},
  ) =>
    frame(
      [
        [0, other],
        [3, selected],
      ],
      delta,
    );
  step();
  const object = kind === "drag" || kind === "transform" ? mesh : camera;
  const initial = pose(object);
  const prepareAction = (): void => {
    if (kind === "drag") step({ buttons: createGamepadButtons([0, true]) });
    if (kind === "transform")
      step({ buttons: createGamepadButtons([15, true]) });
  };
  const active = {
    axes: kind === "map" ? [0, 0, strength, 0] : [strength, 0, 0, 0],
  };
  const expected = pose(object);
  if (["orbit", "map", "trackball", "arcball"].includes(kind)) {
    const rotation = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      -strength * delta * Math.PI,
    );
    expected.position.applyQuaternion(rotation);
    expected.quaternion.premultiply(rotation);
  } else if (kind === "drag" || kind === "transform") {
    const height =
      projection === "perspective" ? 20 * Math.tan(Math.PI / 6) : 12;
    const width = (height * 4) / 3;
    expected.position.x +=
      strength * delta * (kind === "drag" ? width : (width + height) / 2);
  } else {
    expected.position.x += strength * delta * 4;
  }

  return {
    ...environment,
    elementListeners,
    nativeEvents,
    focusRaycaster,
    wrapper,
    events,
    object,
    initial,
    expected,
    step,
    active,
    prepareAction,
  };
};

for (const kind of kinds) {
  describe(`${kind}: real Three.js contract`, () => {
    integrationTest(
      "keeps a neutral frame geometrically unchanged",
      ({ cleanup, gamepadPolling }) => {
        const scenario = createScenario(kind, cleanup, gamepadPolling);
        scenario.step();
        expectPose(scenario.object, scenario.initial);
        expect(scenario.events).toEqual([
          {
            type: "connected",
            source: kind,
            data: { index: 3, id: "gamepad-3" },
          },
        ]);
      },
    );

    integrationTest(
      "applies one simple movement per frame",
      ({ cleanup, gamepadPolling }) => {
        const scenario = createScenario(kind, cleanup, gamepadPolling);
        scenario.prepareAction();
        scenario.step(scenario.active);
        expectPose(scenario.object, scenario.expected);
        scenario.step();
        expectPose(scenario.object, scenario.expected);
      },
    );

    integrationTest(
      "uses slot 3 even when slot 0 has conflicting input",
      ({ cleanup, gamepadPolling }) => {
        const scenario = createScenario(kind, cleanup, gamepadPolling);
        scenario.prepareAction();
        scenario.step({}, scenario.active);
        expectPose(scenario.object, scenario.initial);
        scenario.step(scenario.active, {
          axes: scenario.active.axes.map((value) => -value),
        });
        expectPose(scenario.object, scenario.expected);
        expect(scenario.wrapper.gamepad?.index).toBe(3);
        expect(gamepadPolling.gamepads[1]).toBeNull();
        expect(gamepadPolling.gamepads[2]).toBeNull();
      },
    );

    integrationTest(
      "disposes DOM and native/browser listeners without later reactions",
      ({ cleanup, gamepadPolling }) => {
        // Observe real add/remove calls on each relevant event target.
        const targets: EventTarget[] = [window, document];
        const spies = targets.map((target) => ({
          add: vi.spyOn(target, "addEventListener"),
          remove: vi.spyOn(target, "removeEventListener"),
        }));
        const scenario = createScenario(kind, cleanup, gamepadPolling);
        const wrapperEvents = vi.fn();
        scenario.wrapper.addEventListener("connected", wrapperEvents);
        scenario.wrapper.addEventListener("disconnected", wrapperEvents);
        cleanup.add("listener", () => {
          scenario.wrapper.removeEventListener("connected", wrapperEvents);
          scenario.wrapper.removeEventListener("disconnected", wrapperEvents);
        });
        const geometryDispose = vi.spyOn(scenario.mesh.geometry, "dispose");
        const materialDispose = vi.spyOn(scenario.mesh.material, "dispose");
        cleanup.dispose();
        cleanup.dispose();
        expect(scenario.element.isConnected).toBe(false);
        expect(geometryDispose).toHaveBeenCalledOnce();
        expect(materialDispose).toHaveBeenCalledOnce();
        expect(scenario.scene.children).toHaveLength(0);
        for (const { add, remove } of [...spies, scenario.elementListeners]) {
          for (const [type, listener] of add.mock.calls) {
            expect(
              remove.mock.calls.some(
                ([removedType, removedListener]) =>
                  removedType === type && removedListener === listener,
              ),
            ).toBe(true);
          }
        }
        gamepadPolling.getGamepads.mockClear();
        dispatchGamepadEvent("gamepaddisconnected", createGamepad(3));
        dispatchGamepadEvent(
          "gamepadconnected",
          createGamepad(3, scenario.active),
        );
        scenario.wrapper.update(delta);
        expect(gamepadPolling.getGamepads).not.toHaveBeenCalled();
        expect(wrapperEvents).not.toHaveBeenCalled();
        expect(scenario.wrapper.gamepad).toBeNull();
        expectPose(scenario.object, scenario.initial);
      },
    );
  });
}

for (const kind of ["drag", "transform"] as const) {
  integrationTest(
    `${kind}: moves with an orthographic camera`,
    ({ cleanup, gamepadPolling }) => {
      const scenario = createScenario(
        kind,
        cleanup,
        gamepadPolling,
        "orthographic",
      );
      scenario.prepareAction();
      scenario.step(scenario.active);
      expectPose(scenario.object, scenario.expected);
    },
  );
}

describe("real raycasts and native event snapshots", () => {
  integrationTest(
    "records Drag grab, movement and drop in order",
    ({ cleanup, gamepadPolling }) => {
      const scenario = createScenario("drag", cleanup, gamepadPolling);
      scenario.prepareAction();
      scenario.step(scenario.active);
      scenario.step({ buttons: createGamepadButtons([0, true]) });
      expect(scenario.nativeEvents).toEqual([
        {
          type: "dragstart",
          source: "drag-native",
          data: { object: scenario.mesh.uuid, position: [0, 0, 0] },
        },
        {
          type: "drag",
          source: "drag-native",
          data: {
            object: scenario.mesh.uuid,
            position: [expect.closeTo(scenario.expected.position.x, 8), 0, 0],
          },
        },
        {
          type: "dragend",
          source: "drag-native",
          data: {
            object: scenario.mesh.uuid,
            position: [expect.closeTo(scenario.expected.position.x, 8), 0, 0],
          },
        },
      ]);
    },
  );

  integrationTest(
    "retains separate snapshots of Orbit's reused change event",
    ({ cleanup, gamepadPolling }) => {
      const scenario = createScenario("orbit", cleanup, gamepadPolling);
      scenario.step(scenario.active);
      scenario.step(scenario.active);
      expect(scenario.nativeEvents).toHaveLength(2);
      expect(
        scenario.nativeEvents.map((event) => [event.type, event.source]),
      ).toEqual([
        ["change", scenario.camera.uuid],
        ["change", scenario.camera.uuid],
      ]);
      const firstPosition = new Vector3().fromArray(
        scenario.nativeEvents[0].data.position,
      );
      expect(firstPosition.distanceTo(scenario.expected.position)).toBeLessThan(
        1e-8,
      );
      const secondPosition = new Vector3().fromArray(
        scenario.nativeEvents[1].data.position,
      );
      expect(secondPosition.distanceTo(scenario.camera.position)).toBeLessThan(
        1e-8,
      );
      expect(firstPosition.distanceTo(secondPosition)).toBeGreaterThan(0.1);
    },
  );

  for (const hit of [true, false]) {
    integrationTest(
      `Arcball focus uses a real center ray (${hit ? "hit" : "miss"})`,
      ({ cleanup, gamepadPolling }) => {
        const scenario = createScenario("arcball", cleanup, gamepadPolling);
        if (!scenario.focusRaycaster)
          throw new Error("Missing Arcball raycaster");
        const intersect = vi.spyOn(scenario.focusRaycaster, "intersectObjects");
        if (!hit) scenario.mesh.position.x = 20;
        scenario.step({ buttons: createGamepadButtons([0, true]) });
        expect(intersect).toHaveBeenCalledOnce();
        const result = intersect.mock.results[0];
        if (result.type !== "return") throw new Error("Raycast did not return");
        const meshHit = result.value.find(
          (intersection) => intersection.object === scenario.mesh,
        );
        if (hit) {
          expect(meshHit?.point.distanceTo(new Vector3(0, 0, 1))).toBeLessThan(
            1e-8,
          );
          expect(
            scenario.camera.position.distanceTo(scenario.initial.position),
          ).toBeGreaterThan(1e-8);
        } else {
          expect(meshHit).toBeUndefined();
          expectPose(scenario.camera, scenario.initial);
        }
      },
    );
  }
});

describe("shared contract infrastructure", () => {
  integrationTest(
    "provides real dimensions and a mesh hit by a center ray",
    ({ cleanup }) => {
      const { camera, element, mesh } = createThreeEnvironment(cleanup);
      expect(element.clientWidth).toBe(800);
      expect(element.clientHeight).toBe(600);
      expect(element.getBoundingClientRect().width).toBe(800);
      expect(element.getBoundingClientRect().height).toBe(600);
      const raycaster = new Raycaster();
      raycaster.setFromCamera(new Vector2(), camera);
      expect(raycaster.intersectObject(mesh)[0]?.object).toBe(mesh);
    },
  );

  integrationTest(
    "publishes independent snapshots in real slots regardless of entry order",
    ({ gamepadPolling }) => {
      const options = {
        axes: [0.5, 0, 0, 0],
        buttons: createGamepadButtons([0, true]).map((button) => ({
          ...button,
        })),
      };
      gamepadPolling.publishFrame([3, options], [0]);
      const first = gamepadPolling.gamepads[3];
      expect(gamepadPolling.gamepads.map((pad) => pad?.index ?? null)).toEqual([
        0,
        null,
        null,
        3,
      ]);
      options.axes[0] = -0.5;
      options.buttons[0].value = 0;
      gamepadPolling.publishFrame([3, options]);
      const second = gamepadPolling.gamepads[3];
      expect(first).not.toBe(second);
      expect(first?.axes[0]).toBe(0.5);
      expect(first?.buttons[0].value).toBe(1);
      expect(second?.axes[0]).toBe(-0.5);
      expect(second?.timestamp).toBe(2);
      expect(gamepadPolling.gamepads[0]).toBeNull();
      gamepadPolling.publishFrame();
      expect(gamepadPolling.gamepads).toEqual([]);
    },
  );

  integrationTest(
    "rejects invalid or duplicate fixture slots",
    ({ gamepadPolling }) => {
      expect(() => gamepadPolling.publishFrame([-1])).toThrow(RangeError);
      expect(() => gamepadPolling.publishFrame([1.5])).toThrow(RangeError);
      expect(() => gamepadPolling.publishFrame([0], [0])).toThrow("Duplicate");
    },
  );

  integrationTest(
    "copies reused event data and detaches collectors",
    ({ cleanup }) => {
      const dispatcher = new EventDispatcher<{
        change: { point: Vector3; object: Object3D };
      }>();
      const { mesh } = createThreeEnvironment(cleanup);
      const event = {
        type: "change" as const,
        point: new Vector3(1, 2, 3),
        object: mesh,
      };
      const events = collectEvents(
        cleanup,
        dispatcher,
        ["change"],
        "native",
        (value) => ({
          object: value.object.uuid,
          point: value.point.toArray(),
        }),
      );
      dispatcher.dispatchEvent(event);
      event.point.x = 9;
      dispatcher.dispatchEvent(event);
      expect(events).toEqual([
        {
          type: "change",
          source: "native",
          data: { object: mesh.uuid, point: [1, 2, 3] },
        },
        {
          type: "change",
          source: "native",
          data: { object: mesh.uuid, point: [9, 2, 3] },
        },
      ]);
      cleanup.dispose();
      dispatcher.dispatchEvent(event);
      expect(events).toHaveLength(2);
    },
  );

  integrationTest(
    "updates a Transform helper after scene and object changes",
    ({ cleanup }) => {
      const { camera, element, scene, mesh, syncMatrices } =
        createThreeEnvironment(cleanup);
      // Runtime fields updated by the real helper are omitted from @types/three.
      const controls = new TransformControls(
        camera,
        element,
      ) as TransformControls & {
        worldPosition: Vector3;
        cameraPosition: Vector3;
      };
      cleanup.add("native", () => controls.dispose());
      controls.attach(mesh);
      scene.add(controls.getHelper());
      mesh.position.set(1, 2, 3);
      syncMatrices();
      expect(
        controls.worldPosition.distanceTo(mesh.getWorldPosition(new Vector3())),
      ).toBeLessThan(1e-8);
      expect(controls.cameraPosition.distanceTo(camera.position)).toBeLessThan(
        1e-8,
      );
    },
  );

  integrationTest(
    "cleans up after a controlled assertion failure",
    ({ cleanup }) => {
      const { element, mesh } = createThreeEnvironment(cleanup);
      const dispose = vi.spyOn(mesh.geometry, "dispose");
      expect(() => {
        try {
          expect(element.clientWidth).toBe(0);
        } finally {
          cleanup.dispose();
        }
      }).toThrow();
      expect(element.isConnected).toBe(false);
      expect(dispose).toHaveBeenCalledOnce();
    },
  );

  integrationTest(
    "continues ordered cleanup after a disposer fails",
    ({ cleanup }) => {
      const calls: string[] = [];
      cleanup.add("dom", () => {
        calls.push("dom");
      });
      cleanup.add("native", () => {
        calls.push("native");
      });
      cleanup.add("wrapper", () => {
        calls.push("wrapper");
        throw new Error("controlled");
      });
      cleanup.add("listener", () => {
        calls.push("listener");
      });
      expect(() => cleanup.dispose()).toThrow(AggregateError);
      expect(calls).toEqual(["wrapper", "listener", "native", "dom"]);
      cleanup.dispose();
      expect(calls).toHaveLength(4);
    },
  );
});
