import {
  type Controls,
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
// Runtime helpers omitted or declared as DOM events by @types/three r186.
type TransformWithSnapshots = TransformControls & { pointStart: Vector3 };
type ArcballWithFocus = ArcballControls & {
  focus(point: Vector3, size: number): void;
};
const transformPointer = (y: number, button: number): PointerEvent =>
  ({ x: 0, y, button }) as PointerEvent;
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
  let nativeControls: Controls | undefined;
  const native = <T extends Controls>(controls: T): T => {
    nativeControls = controls;
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
      for (const root of gizmos) {
        cleanup.add("resource", () => disposeObjectResources(root));
      }
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
    if (kind === "drag") {
      step({ buttons: createGamepadButtons([0, true]) });
    }
    if (kind === "transform") {
      step({ buttons: createGamepadButtons([15, true]) });
    }
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

  if (nativeControls === undefined) {
    throw new Error("Missing native control");
  }

  return {
    ...environment,
    nativeControls,
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

describe("native input permissions", () => {
  for (const kind of ["orbit", "map"] as const) {
    integrationTest.for(["enableRotate", "enablePan", "enableZoom"] as const)(
      `${kind}: gates %s independently`,
      (flag, { cleanup, gamepadPolling }) => {
        const actual = createScenario(kind, cleanup, gamepadPolling);
        const reference = createScenario(kind, cleanup, gamepadPolling);
        const controls = actual.nativeControls as OrbitControls;
        const referenceControls = reference.nativeControls as OrbitControls;
        controls[flag] = false;
        const axes = [0.4, -0.3, 0.2, -0.1];
        const buttons = createGamepadButtons([7, true, 0.6]);
        actual.step({ axes, buttons });
        const allowedAxes = [...axes];
        if (flag !== "enableZoom") {
          const offset =
            (flag === "enableRotate") === (kind === "orbit") ? 0 : 2;
          allowedAxes[offset] = 0;
          allowedAxes[offset + 1] = 0;
        }
        reference.step({
          axes: allowedAxes,
          buttons: flag === "enableZoom" ? [] : buttons,
        });
        expectPose(actual.camera, pose(reference.camera));
        expect(
          controls.target.distanceTo(referenceControls.target),
        ).toBeLessThan(1e-8);
        expect(actual.camera.zoom).toBe(reference.camera.zoom);
        controls[flag] = true;
        actual.step({ axes, buttons });
        reference.step({ axes, buttons });
        expectPose(actual.camera, pose(reference.camera));
      },
    );
  }

  integrationTest.for([1, 2, 3, 4])(
    "Orbit stops subsequent operations when change %i disables the native control",
    (stopAt, { cleanup, gamepadPolling }) => {
      const scenario = createScenario("orbit", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as OrbitControls;
      let changes = 0;
      let stoppedPose = scenario.initial;
      const listener = () => {
        changes++;
        if (changes === stopAt) {
          controls.enabled = false;
          stoppedPose = pose(scenario.camera);
        }
      };
      controls.addEventListener("change", listener);
      cleanup.add("listener", () =>
        controls.removeEventListener("change", listener),
      );
      scenario.step({
        axes: [0.4, -0.3, 0.2, -0.1],
        buttons: createGamepadButtons([6, true, 0.4], [7, true, 0.8]),
      });
      expect(changes).toBe(stopAt);
      expectPose(scenario.camera, stoppedPose);
    },
  );

  integrationTest.for(["pause", "dispose"] as const)(
    "Orbit stops subsequent operations when a change listener requests %s",
    (action, { cleanup, gamepadPolling }) => {
      const scenario = createScenario("orbit", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as OrbitControls;
      let changes = 0;
      const listener = () => {
        changes++;
        if (action === "pause") {
          scenario.wrapper.enabled = false;
        } else {
          scenario.wrapper.dispose();
        }
      };
      controls.addEventListener("change", listener);
      cleanup.add("listener", () =>
        controls.removeEventListener("change", listener),
      );
      scenario.step({
        axes: [0.4, -0.3, 0.2, -0.1],
        buttons: createGamepadButtons([7, true]),
      });
      expect(changes).toBe(1);
    },
  );

  integrationTest(
    "Orbit rechecks action permissions after change without blocking other actions",
    ({ cleanup, gamepadPolling }) => {
      const scenario = createScenario("orbit", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as OrbitControls;
      const rotateUp = vi.spyOn(controls, "rotateUp");
      const pan = vi.spyOn(controls, "pan");
      const listener = () => {
        controls.enableRotate = false;
        controls.enableZoom = false;
      };
      controls.addEventListener("change", listener);
      cleanup.add("listener", () =>
        controls.removeEventListener("change", listener),
      );
      scenario.step({
        axes: [0.4, -0.3, 0.2, -0.1],
        buttons: createGamepadButtons([7, true]),
      });
      expect(rotateUp).not.toHaveBeenCalled();
      expect(pan).toHaveBeenCalledOnce();
      expect(controls.target.length()).toBeGreaterThan(0);
      expect(controls.getDistance()).toBeCloseTo(10);
    },
  );

  integrationTest(
    "Trackball preserves native wheel input while zoom is blocked and after re-enabling",
    ({ cleanup, gamepadPolling }) => {
      const actual = createScenario("trackball", cleanup, gamepadPolling);
      const reference = createScenario("trackball", cleanup, gamepadPolling);
      const controls = actual.nativeControls as TrackballControls;
      const referenceControls = reference.nativeControls as TrackballControls;
      reference.wrapper.dispose();
      for (const scenario of [actual, reference]) {
        const native = scenario.nativeControls as TrackballControls;
        native.staticMoving = false;
        scenario.element.dispatchEvent(
          new WheelEvent("wheel", { deltaY: 100, cancelable: true }),
        );
        native.noZoom = true;
      }
      actual.step({ buttons: createGamepadButtons([7, true, 0.8]) });
      referenceControls.update();
      expectPose(actual.camera, pose(reference.camera));
      controls.noZoom = false;
      referenceControls.noZoom = false;
      for (let i = 0; i < 4; i++) {
        actual.step();
        referenceControls.update();
        expectPose(actual.camera, pose(reference.camera));
      }
      expect(
        actual.camera.position.distanceTo(actual.initial.position),
      ).toBeGreaterThan(0.01);
    },
  );

  integrationTest.for(["native disabled", "disconnect", "dispose"] as const)(
    "Transform preserves a pointer drag during %s without owning a session",
    (action, { cleanup, gamepadPolling }) => {
      const scenario = createScenario("transform", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as TransformWithSnapshots;
      controls.axis = "Y";
      scenario.syncMatrices();
      controls.pointerDown(transformPointer(0, 0));
      expect(controls.dragging).toBe(true);
      const start = controls.pointStart.clone();
      const up = vi.fn();
      controls.addEventListener("mouseUp", up);
      cleanup.add("listener", () =>
        controls.removeEventListener("mouseUp", up),
      );
      if (action === "native disabled") {
        controls.enabled = false;
        scenario.step({
          axes: [0.5, 0, 0, 0],
          buttons: createGamepadButtons([1, true], [3, true], [9, true]),
        });
      } else if (action === "disconnect") {
        dispatchGamepadEvent("gamepaddisconnected", createGamepad(3));
      } else {
        scenario.wrapper.dispose();
      }
      expect(controls.axis).toBe("Y");
      expect(controls.mode).toBe("translate");
      expect(controls.space).toBe("world");
      expect(controls.dragging).toBe(true);
      expect(controls.pointStart).toEqual(start);
      expect(up).not.toHaveBeenCalled();
      controls.enabled = true;
      controls.pointerMove(transformPointer(0.2, -1));
      expect(scenario.mesh.position.y).toBeGreaterThan(0);
      expect(scenario.mesh.position.x).toBe(0);
      controls.pointerUp(transformPointer(0.2, 0));
    },
  );

  integrationTest.for(["disable", "pause", "dispose"] as const)(
    "Transform stops before movement when mouseDown requests %s",
    (action, { cleanup, gamepadPolling }) => {
      const scenario = createScenario("transform", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as TransformControls;
      const events: string[] = [];
      const down = () => {
        events.push("down");
        if (action === "disable") {
          controls.enabled = false;
        } else if (action === "pause") {
          scenario.wrapper.enabled = false;
        } else {
          scenario.wrapper.dispose();
        }
      };
      const up = () => events.push("up");
      controls.addEventListener("mouseDown", down);
      controls.addEventListener("mouseUp", up);
      cleanup.add("listener", () => {
        controls.removeEventListener("mouseDown", down);
        controls.removeEventListener("mouseUp", up);
      });
      scenario.step(scenario.active);
      expectPose(scenario.mesh, scenario.initial);
      expect(events).toEqual(action === "pause" ? ["down"] : ["down", "up"]);
      scenario.wrapper.dispose();
      expect(events).toEqual(["down", "up"]);
    },
  );

  integrationTest.for(["transform", "drag", "arcball"] as const)(
    "%s consumes blocked button presses without replay after re-enabling",
    (kind, { cleanup, gamepadPolling }) => {
      const scenario = createScenario(kind, cleanup, gamepadPolling);
      const controls = scenario.nativeControls;
      const button = kind === "transform" ? 1 : 0;
      const observed =
        kind === "transform"
          ? vi.spyOn(controls as TransformControls, "setMode")
          : kind === "arcball"
            ? vi.spyOn(controls as ArcballWithFocus, "focus")
            : vi.spyOn(controls as DragControls, "dispatchEvent");
      controls.enabled = false;
      const input = { buttons: createGamepadButtons([button, true]) };
      scenario.step(input);
      controls.enabled = true;
      observed.mockClear();
      scenario.step(input);
      if (kind === "drag") {
        expect(
          observed.mock.calls.some(
            ([event]) =>
              typeof event === "object" &&
              event !== null &&
              "type" in event &&
              event.type === "dragstart",
          ),
        ).toBe(false);
      } else {
        expect(observed).not.toHaveBeenCalled();
      }
      scenario.step();
      observed.mockClear();
      scenario.step(input);
      expect(observed).toHaveBeenCalled();
    },
  );

  integrationTest.for(["disable", "pause", "dispose"] as const)(
    "Arcball revalidates input after start requests %s",
    (action, { cleanup, gamepadPolling }) => {
      const scenario = createScenario("arcball", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as ArcballControls;
      const events: string[] = [];
      const start = () => {
        events.push("start");
        if (action === "disable") {
          controls.enabled = false;
        } else if (action === "pause") {
          scenario.wrapper.enabled = false;
        } else {
          scenario.wrapper.dispose();
        }
      };
      const end = () => events.push("end");
      controls.addEventListener("start", start);
      controls.addEventListener("end", end);
      cleanup.add("listener", () => {
        controls.removeEventListener("start", start);
        controls.removeEventListener("end", end);
      });
      scenario.step(scenario.active);
      expectPose(scenario.camera, scenario.initial);
      expect(events).toEqual(action === "pause" ? ["start"] : ["start", "end"]);
      scenario.wrapper.dispose();
      scenario.wrapper.dispose();
      expect(events).toEqual(["start", "end"]);
    },
  );

  integrationTest.for(["event", "polling", "dispose"] as const)(
    "Arcball ends an owned interaction once on %s",
    (action, { cleanup, gamepadPolling }) => {
      const scenario = createScenario("arcball", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as ArcballControls;
      const events: string[] = [];
      const start = () => events.push("start");
      const end = () => {
        events.push("end");
        scenario.wrapper.dispose();
      };
      controls.addEventListener("start", start);
      controls.addEventListener("end", end);
      cleanup.add("listener", () => {
        controls.removeEventListener("start", start);
        controls.removeEventListener("end", end);
      });
      scenario.step(scenario.active);
      if (action === "event") {
        scenario.wrapper.enabled = false;
        dispatchGamepadEvent("gamepaddisconnected", createGamepad(3));
      } else if (action === "polling") {
        gamepadPolling.publishFrame();
        scenario.wrapper.update(delta);
      } else {
        scenario.wrapper.dispose();
      }
      scenario.wrapper.dispose();
      expect(events).toEqual(["start", "end"]);
    },
  );

  integrationTest.for(["disable", "pause", "dispose"] as const)(
    "Drag does not acquire a selection after hoveron requests %s",
    (action, { cleanup, gamepadPolling }) => {
      const scenario = createScenario("drag", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as DragControls;
      // Clear the hover established by the neutral adoption frame.
      scenario.mesh.position.x = 100;
      scenario.step();
      scenario.mesh.position.x = 0;
      const stop = () => {
        if (action === "disable") {
          controls.enabled = false;
        } else if (action === "pause") {
          scenario.wrapper.enabled = false;
        } else {
          scenario.wrapper.dispose();
        }
      };
      const start = vi.fn();
      controls.addEventListener("hoveron", stop);
      controls.addEventListener("dragstart", start);
      cleanup.add("listener", () => {
        controls.removeEventListener("hoveron", stop);
        controls.removeEventListener("dragstart", start);
      });
      scenario.step({ buttons: createGamepadButtons([0, true]) });
      expect(start).not.toHaveBeenCalled();
      expectPose(scenario.mesh, scenario.initial);
    },
  );
});

describe("permission transitions and native state", () => {
  integrationTest.for([
    "mouseUp",
    "dragging-changed",
    "reentrant-dispose",
  ] as const)(
    "Transform preserves pointer acquisition from a %s listener during cleanup",
    (trigger, { cleanup, gamepadPolling }) => {
      const event = trigger === "reentrant-dispose" ? "mouseUp" : trigger;
      const scenario = createScenario("transform", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as TransformControls;
      scenario.step(scenario.active);
      const takeOver = () => {
        controls.removeEventListener(event, takeOver);
        if (trigger === "reentrant-dispose") {
          scenario.wrapper.dispose();
        }
        controls.dragging = false;
        controls.axis = "Y";
        scenario.syncMatrices();
        controls.pointerDown(transformPointer(0, 0));
      };
      controls.addEventListener(event, takeOver);
      cleanup.add("listener", () =>
        controls.removeEventListener(event, takeOver),
      );
      scenario.wrapper.dispose();
      expect(controls.axis).toBe("Y");
      expect(controls.dragging).toBe(true);
      const before = pose(scenario.mesh);
      controls.pointerMove(transformPointer(0.2, -1));
      expect(scenario.mesh.position.y).toBeGreaterThan(before.position.y);
      expect(scenario.mesh.position.x).toBeCloseTo(before.position.x);
      controls.pointerUp(transformPointer(0.2, 0));
    },
  );

  integrationTest(
    "Transform can acquire after observing neutral input during a pointer drag",
    ({ cleanup, gamepadPolling }) => {
      const scenario = createScenario("transform", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as TransformControls;
      controls.axis = "Y";
      scenario.syncMatrices();
      controls.pointerDown(transformPointer(0, 0));
      scenario.step(scenario.active);
      scenario.step();
      controls.pointerUp(transformPointer(0, 0));
      scenario.step(scenario.active);
      expect(controls.dragging).toBe(true);
      expect(scenario.mesh.position.x).toBeGreaterThan(0);
    },
  );

  integrationTest(
    "Arcball focus joins continuous movement and reconnection starts a new session",
    ({ cleanup, gamepadPolling }) => {
      const scenario = createScenario("arcball", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as ArcballWithFocus;
      const focus = vi.spyOn(controls, "focus");
      const events: string[] = [];
      for (const type of ["start", "end"] as const) {
        const listener = () => events.push(type);
        controls.addEventListener(type, listener);
        cleanup.add("listener", () =>
          controls.removeEventListener(type, listener),
        );
      }
      scenario.step(scenario.active);
      scenario.step({
        ...scenario.active,
        buttons: createGamepadButtons([0, true]),
      });
      expect(focus).toHaveBeenCalledOnce();
      expect(events).toEqual(["start"]);
      dispatchGamepadEvent("gamepaddisconnected", createGamepad(3));
      expect(events).toEqual(["start", "end"]);
      scenario.step(scenario.active);
      scenario.step();
      expect(events).toEqual(["start", "end", "start", "end"]);
    },
  );

  integrationTest.for(["fly", "firstPerson"] as const)(
    "%s preserves keyboard movement across wrapper pause and native disable",
    (kind, { cleanup, gamepadPolling }) => {
      const actual = createScenario(kind, cleanup, gamepadPolling);
      const reference = createScenario(kind, cleanup, gamepadPolling);
      reference.wrapper.dispose();
      actual.wrapper.enabled = false;
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
      actual.step({ axes: [1, 1, 1, 1] });
      reference.step();
      expectPose(actual.camera, pose(reference.camera));
      expect(actual.camera.position.z).toBeLessThan(10);
      actual.wrapper.enabled = true;
      actual.nativeControls.enabled = false;
      reference.nativeControls.enabled = false;
      actual.step({ axes: [1, 1, 1, 1] });
      reference.step();
      expectPose(actual.camera, pose(reference.camera));
      actual.nativeControls.enabled = true;
      reference.nativeControls.enabled = true;
      actual.step();
      reference.step();
      expectPose(actual.camera, pose(reference.camera));
      window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
    },
  );

  integrationTest(
    "Orbit native damping survives blocked gamepad input",
    ({ cleanup, gamepadPolling }) => {
      const actual = createScenario("orbit", cleanup, gamepadPolling);
      const reference = createScenario("orbit", cleanup, gamepadPolling);
      reference.wrapper.dispose();
      for (const scenario of [actual, reference]) {
        const controls = scenario.nativeControls as OrbitControls;
        controls.enableDamping = true;
        controls.listenToKeyEvents(scenario.element);
        scenario.element.dispatchEvent(
          new KeyboardEvent("keydown", { code: "ArrowLeft", cancelable: true }),
        );
        controls.enabled = false;
      }
      const start = pose(actual.camera);
      for (let i = 0; i < 4; i++) {
        actual.step({
          axes: [0.6, 0.5, 0.4, 0.3],
          buttons: createGamepadButtons([7, true]),
        });
        reference.step();
        expectPose(actual.camera, pose(reference.camera));
      }
      expect(actual.camera.position.distanceTo(start.position)).toBeGreaterThan(
        0.01,
      );
    },
  );

  integrationTest.for(["noRotate", "noPan"] as const)(
    "Trackball preserves pointer state across %s without gamepad cleanup",
    (flag, { cleanup, gamepadPolling }) => {
      const actual = createScenario("trackball", cleanup, gamepadPolling);
      const reference = createScenario("trackball", cleanup, gamepadPolling);
      reference.wrapper.dispose();
      for (const scenario of [actual, reference]) {
        // Call Three.js' real mouse handlers with native event objects. The
        // pointer capture layer requires a hardware pointer and is irrelevant
        // to producing the native deltas and damping history under comparison.
        const controls = scenario.nativeControls as TrackballControls & {
          _onMouseDown(event: MouseEvent): void;
          _onMouseMove(event: MouseEvent): void;
          _onMouseUp(): void;
        };
        controls.staticMoving = false;
        controls._onMouseDown(
          new MouseEvent("mousedown", {
            button: flag === "noRotate" ? 0 : 2,
            clientX: 400,
            clientY: 300,
          }),
        );
        controls._onMouseMove(
          new MouseEvent("mousemove", { clientX: 460, clientY: 320 }),
        );
        controls.update();
        controls._onMouseUp();
        controls[flag] = true;
      }
      const start = pose(actual.camera);
      actual.step();
      reference.step();
      expectPose(actual.camera, pose(reference.camera));
      (actual.nativeControls as TrackballControls)[flag] = false;
      (reference.nativeControls as TrackballControls)[flag] = false;
      for (let i = 0; i < 4; i++) {
        actual.step();
        reference.step();
        expectPose(actual.camera, pose(reference.camera));
      }
      expect(actual.camera.position.distanceTo(start.position)).toBeGreaterThan(
        0.01,
      );
    },
  );

  integrationTest(
    "Transform ignores gamepad buttons and movement throughout a native pointer drag",
    ({ cleanup, gamepadPolling }) => {
      const scenario = createScenario("transform", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as TransformControls;
      controls.axis = "Y";
      scenario.syncMatrices();
      controls.pointerDown(transformPointer(0, 0));
      scenario.step({
        axes: [0.5, 0, 0, 0],
        buttons: createGamepadButtons([1, true], [3, true], [9, true]),
      });
      expect(controls.axis).toBe("Y");
      expect(controls.mode).toBe("translate");
      expect(controls.space).toBe("world");
      expectPose(scenario.mesh, scenario.initial);
      controls.pointerMove(transformPointer(0.2, -1));
      expect(scenario.mesh.position.y).toBeGreaterThan(0);
      controls.pointerUp(transformPointer(0.2, 0));
      const afterPointer = pose(scenario.mesh);
      scenario.step({
        axes: [0.5, 0, 0, 0],
        buttons: createGamepadButtons([1, true], [3, true], [9, true]),
      });
      expectPose(scenario.mesh, afterPointer);
      expect(controls.dragging).toBe(false);
      expect(controls.mode).toBe("translate");
      expect(controls.space).toBe("world");
      scenario.step();
      scenario.step(scenario.active);
      expect(controls.dragging).toBe(true);
      expect(
        scenario.mesh.position.distanceTo(afterPointer.position),
      ).toBeGreaterThan(0);
    },
  );

  integrationTest(
    "Transform stops later buttons and axis writes when a mode listener disables input",
    ({ cleanup, gamepadPolling }) => {
      const scenario = createScenario("transform", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as TransformControls;
      controls.axis = "Y";
      const stop = () => {
        controls.enabled = false;
      };
      controls.addEventListener("mode-changed", stop);
      cleanup.add("listener", () =>
        controls.removeEventListener("mode-changed", stop),
      );
      scenario.step({
        axes: [0.5, 0, 0, 0],
        buttons: createGamepadButtons(
          [1, true],
          [2, true],
          [3, true],
          [15, true],
        ),
      });
      expect(controls.mode).toBe("rotate");
      expect(controls.space).toBe("world");
      expect(controls.axis).toBe("Y");
      expectPose(scenario.mesh, scenario.initial);
    },
  );

  integrationTest.for(["axis-changed", "dragging-changed"] as const)(
    "Transform stops acquisition when %s disables input before mouseDown",
    (event, { cleanup, gamepadPolling }) => {
      const scenario = createScenario("transform", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as TransformControls;
      controls.axis = null;
      const events: string[] = [];
      const stop = () => {
        controls.enabled = false;
      };
      const down = () => events.push("down");
      const up = () => events.push("up");
      controls.addEventListener(event, stop);
      controls.addEventListener("mouseDown", down);
      controls.addEventListener("mouseUp", up);
      cleanup.add("listener", () => {
        controls.removeEventListener(event, stop);
        controls.removeEventListener("mouseDown", down);
        controls.removeEventListener("mouseUp", up);
      });
      scenario.step(scenario.active);
      expectPose(scenario.mesh, scenario.initial);
      expect(controls.dragging).toBe(false);
      expect(events).toEqual([]);
    },
  );

  integrationTest.for([3, 12, 2])(
    "Transform requires a fresh press for button %i observed while disabled",
    (button, { cleanup, gamepadPolling }) => {
      const scenario = createScenario("transform", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as TransformControls;
      const selection = () => ({
        mode: controls.mode,
        space: controls.space,
        axis: controls.axis,
      });
      const initial = selection();
      const input = { buttons: createGamepadButtons([button, true]) };
      controls.enabled = false;
      scenario.step(input);
      expect(selection()).toEqual(initial);
      controls.enabled = true;
      scenario.step(input);
      expect(selection()).toEqual(initial);
      scenario.step();
      scenario.step(input);
      expect(selection()).not.toEqual(initial);
    },
  );

  integrationTest(
    "Transform does not reset an owned transformation while native input is disabled",
    ({ cleanup, gamepadPolling }) => {
      const scenario = createScenario("transform", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as TransformControls;
      scenario.step(scenario.active);
      const before = pose(scenario.mesh);
      expect(before.position.x).toBeGreaterThan(0);
      controls.enabled = false;
      const reset = vi.spyOn(controls, "reset");
      scenario.step({ buttons: createGamepadButtons([9, true]) });
      expect(reset).not.toHaveBeenCalled();
      expectPose(scenario.mesh, before);
      expect(controls.dragging).toBe(false);
      controls.enabled = true;
      scenario.step({ buttons: createGamepadButtons([9, true]) });
      expect(reset).not.toHaveBeenCalled();
    },
  );

  integrationTest(
    "Transform pause in dragging-changed defers mouseDown until resume",
    ({ cleanup, gamepadPolling }) => {
      const scenario = createScenario("transform", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as TransformControls;
      const pause = () => {
        scenario.wrapper.enabled = false;
      };
      const down = vi.fn();
      controls.addEventListener("dragging-changed", pause);
      controls.addEventListener("mouseDown", down);
      cleanup.add("listener", () => {
        controls.removeEventListener("dragging-changed", pause);
        controls.removeEventListener("mouseDown", down);
      });
      scenario.step(scenario.active);
      expect(down).not.toHaveBeenCalled();
      expectPose(scenario.mesh, scenario.initial);
      expect(controls.dragging).toBe(true);
      scenario.wrapper.enabled = true;
      scenario.step(scenario.active);
      expect(down).toHaveBeenCalledOnce();
      expectPose(scenario.mesh, scenario.expected);
    },
  );

  integrationTest(
    "Transform stops movement when reset notifies a disabling listener",
    ({ cleanup, gamepadPolling }) => {
      const scenario = createScenario("transform", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as TransformControls;
      scenario.step(scenario.active);
      expect(scenario.mesh.position.x).toBeGreaterThan(0);
      const stop = () => {
        controls.enabled = false;
      };
      controls.addEventListener("objectChange", stop);
      cleanup.add("listener", () =>
        controls.removeEventListener("objectChange", stop),
      );
      scenario.step({
        ...scenario.active,
        buttons: createGamepadButtons([9, true]),
      });
      expectPose(scenario.mesh, scenario.initial);
      expect(controls.dragging).toBe(false);
    },
  );

  integrationTest.for([1, 3, 12, 5])(
    "Transform does not apply button %i after mouseUp disables input",
    (button, { cleanup, gamepadPolling }) => {
      const scenario = createScenario("transform", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as TransformControls;
      scenario.step(scenario.active);
      const before = pose(scenario.mesh);
      const stop = () => {
        controls.enabled = false;
      };
      controls.addEventListener("mouseUp", stop);
      cleanup.add("listener", () =>
        controls.removeEventListener("mouseUp", stop),
      );
      scenario.step({
        ...scenario.active,
        buttons: createGamepadButtons([button, true]),
      });
      expect(controls.mode).toBe("translate");
      expect(controls.space).toBe("world");
      expect(controls.axis).toBe("X");
      expect(controls.dragging).toBe(false);
      expectPose(scenario.mesh, before);
    },
  );

  integrationTest.for(["transform", "drag", "arcball"] as const)(
    "%s observes native disable on resume and cleans up once",
    (kind, { cleanup, gamepadPolling }) => {
      const scenario = createScenario(kind, cleanup, gamepadPolling);
      scenario.prepareAction();
      scenario.step(scenario.active);
      const controls = scenario.nativeControls as Controls<{
        [type: string]: object;
      }>;
      const dispatch = vi.spyOn(controls, "dispatchEvent");
      const before = pose(scenario.object);
      scenario.wrapper.enabled = false;
      controls.enabled = false;
      dispatch.mockClear();
      scenario.step(scenario.active);
      expect(dispatch).not.toHaveBeenCalled();
      expectPose(scenario.object, before);
      scenario.wrapper.enabled = true;
      scenario.step(scenario.active);
      scenario.step(scenario.active);
      scenario.wrapper.dispose();
      const endType =
        kind === "transform" ? "mouseUp" : kind === "drag" ? "dragend" : "end";
      expect(
        dispatch.mock.calls.filter(([event]) => event.type === endType),
      ).toHaveLength(1);
      expectPose(scenario.object, before);
    },
  );

  integrationTest.for([
    "enableRotate",
    "enablePan",
    "enableZoom",
    "enableFocus",
  ] as const)(
    "Arcball respects %s changed in its start listener",
    (flag, { cleanup, gamepadPolling }) => {
      const scenario = createScenario("arcball", cleanup, gamepadPolling);
      const controls = scenario.nativeControls as ArcballWithFocus & {
        rotate(axis: Vector3, angle: number): unknown;
        pan(a: Vector3, b: Vector3): unknown;
        scale(size: number, point: Vector3): unknown;
        zRotate(point: Vector3, angle: number): unknown;
      };
      const method =
        flag === "enableRotate"
          ? "rotate"
          : flag === "enablePan"
            ? "pan"
            : flag === "enableZoom"
              ? "scale"
              : "focus";
      const operation = vi.spyOn(controls, method);
      const roll = vi.spyOn(controls, "zRotate");
      const stop = () => {
        controls[flag] = false;
      };
      controls.addEventListener("start", stop);
      cleanup.add("listener", () =>
        controls.removeEventListener("start", stop),
      );
      scenario.step({
        axes: [0.3, 0.2, 0.2, -0.1],
        buttons: createGamepadButtons([0, true], [4, true], [7, true, 0.6]),
      });
      expect(operation).not.toHaveBeenCalled();
      if (flag === "enableRotate") {
        expect(roll).not.toHaveBeenCalled();
      }
    },
  );
});

for (const kind of kinds) {
  describe(`${kind}: real Three.js contract`, () => {
    integrationTest(
      "blocks new native-disabled input while continuing to poll",
      ({ cleanup, gamepadPolling }) => {
        const scenario = createScenario(kind, cleanup, gamepadPolling);
        scenario.nativeControls.enabled = false;
        gamepadPolling.getGamepads.mockClear();
        scenario.step({
          axes: [0.5, -0.4, 0.3, -0.2],
          buttons: createGamepadButtons(
            [0, true],
            [1, true],
            [3, true],
            [6, true, 0.4],
            [7, true, 0.8],
          ),
        });
        expectPose(scenario.object, scenario.initial);
        expect(gamepadPolling.getGamepads).toHaveBeenCalledOnce();
        expect(scenario.wrapper.gamepad).toBe(gamepadPolling.gamepads[3]);
        if (scenario.nativeControls instanceof TransformControls) {
          expect(scenario.nativeControls.mode).toBe("translate");
          expect(scenario.nativeControls.space).toBe("world");
        }
      },
    );

    if (kind !== "drag") {
      integrationTest(
        "resumes held analog input without accumulating blocked frames",
        ({ cleanup, gamepadPolling }) => {
          const scenario = createScenario(kind, cleanup, gamepadPolling);
          scenario.nativeControls.enabled = false;
          for (let i = 0; i < 3; i++) {
            scenario.step(scenario.active);
          }
          expectPose(scenario.object, scenario.initial);
          scenario.nativeControls.enabled = true;
          scenario.step(scenario.active);
          expectPose(scenario.object, scenario.expected);
        },
      );
    }

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
        if (!scenario.focusRaycaster) {
          throw new Error("Missing Arcball raycaster");
        }
        const intersect = vi.spyOn(scenario.focusRaycaster, "intersectObjects");
        const controls = scenario.nativeControls as ArcballControls;
        const events: string[] = [];
        for (const type of ["start", "change", "end"] as const) {
          const listener = () => events.push(type);
          controls.addEventListener(type, listener);
          cleanup.add("listener", () =>
            controls.removeEventListener(type, listener),
          );
        }
        if (!hit) {
          scenario.mesh.position.x = 20;
        }
        scenario.step({ buttons: createGamepadButtons([0, true]) });
        expect(events).toEqual(hit ? ["start", "change", "end"] : []);
        expect(intersect).toHaveBeenCalledOnce();
        const result = intersect.mock.results[0];
        if (result.type !== "return") {
          throw new Error("Raycast did not return");
        }
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
