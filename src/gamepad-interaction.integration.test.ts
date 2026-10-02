import { type EventDispatcher, Quaternion } from "three";
import { ArcballControls } from "three/addons/controls/ArcballControls.js";
import { MapControls } from "three/addons/controls/MapControls.js";
import {
  OrbitControls,
  type OrbitControlsEventMap,
} from "three/addons/controls/OrbitControls.js";
import {
  PointerLockControls,
  type PointerLockControlsEventMap,
} from "three/addons/controls/PointerLockControls.js";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { expect, vi } from "vitest";

import { createGamepadButtons } from "../test/fixtures/gamepad.ts";
import {
  dispatchGamepadEvent,
  gamepadTest,
} from "../test/fixtures/gamepad-browser.ts";
import {
  type Cleanup,
  collectEvents,
  createCleanup,
  createThreeEnvironment,
  disposeObjectResources,
} from "../test/fixtures/three-controls.ts";
import { GamepadArcballControls } from "./gamepad-arcball-controls.ts";
import { GamepadMapControls } from "./gamepad-map-controls.ts";
import {
  GamepadOrbitControls,
  type GamepadOrbitControlsOptions,
} from "./gamepad-orbit-controls.ts";
import {
  GamepadPointerLockControls,
  type GamepadPointerLockControlsOptions,
} from "./gamepad-pointer-lock-controls.ts";
import { gamepadStickPipeline } from "./gamepad-stick-processing.ts";
import { GamepadTrackballControls } from "./gamepad-trackball-controls.ts";

const interactionTest = gamepadTest.extend(
  "cleanup",
  ({ gamepadPolling: _polling }, { onCleanup }) => {
    const cleanup = createCleanup();
    onCleanup(() => cleanup.dispose());
    return cleanup;
  },
);
const sessionKinds = ["orbit", "map", "trackball", "arcball"] as const;
type Kind = (typeof sessionKinds)[number] | "pointerLock";
type InteractionEvents = OrbitControlsEventMap & PointerLockControlsEventMap;

/**
 * Creates real Three.js controls and a wrapper with deterministic motion and event capture.
 * The returned update helper preserves wrapper-before-native ordering; snapshots
 * are supplied separately by the browser gamepad fixture.
 *
 * @param kind - Native control and wrapper pair to exercise.
 * @param cleanup - Fixture responsible for listeners, controls, and scene resources.
 * @param index - Gamepad slot selected by the wrapper.
 * @param projection - Camera projection used by the scene fixture.
 * @param options - Wrapper option overrides for this scenario.
 * @returns The scene, control pair, captured events, and frame update helpers.
 */
const createScenario = (
  kind: Kind,
  cleanup: Cleanup,
  index = 3,
  projection: "perspective" | "orthographic" = "perspective",
  options: Partial<
    GamepadOrbitControlsOptions & GamepadPointerLockControlsOptions
  > = {},
) => {
  const environment = createThreeEnvironment(cleanup, projection);
  const { camera, element, scene, syncMatrices } = environment;
  const native =
    kind === "orbit"
      ? new OrbitControls(camera, element)
      : kind === "map"
        ? new MapControls(camera, element)
        : kind === "trackball"
          ? new TrackballControls(camera, element)
          : kind === "arcball"
            ? new ArcballControls(camera, element, scene)
            : new PointerLockControls(camera, element);
  cleanup.add("native", () => native.dispose());
  if (native instanceof OrbitControls) {
    native.enableDamping = false;
    native.autoRotate = false;
  }
  if (native instanceof TrackballControls) native.staticMoving = true;
  if (native instanceof ArcballControls) {
    native.enableAnimations = false;
    for (const child of [...scene.children]) {
      if (child !== environment.mesh)
        cleanup.add("resource", () => disposeObjectResources(child));
    }
  }
  const configured = { ...options, gamepadIndex: index };
  const wrapper =
    native instanceof MapControls
      ? new GamepadMapControls(native, configured)
      : native instanceof OrbitControls
        ? new GamepadOrbitControls(native, configured)
        : native instanceof TrackballControls
          ? new GamepadTrackballControls(native, configured)
          : native instanceof ArcballControls
            ? new GamepadArcballControls(native, configured)
            : new GamepadPointerLockControls(native, configured);
  cleanup.add("wrapper", () => wrapper.dispose());
  const dispatcher = native as EventDispatcher<InteractionEvents>;
  const events = collectEvents(
    cleanup,
    dispatcher,
    ["start", "change", "end", "lock", "unlock"],
    camera.uuid,
    () => ({ quaternion: camera.quaternion.toArray() }),
  );
  const update = (delta = 0.1) => {
    syncMatrices();
    wrapper.update(delta);
    if (native instanceof OrbitControls) native.update(delta);
    if (native instanceof TrackballControls) native.update();
    syncMatrices();
  };
  const active =
    kind === "map" || kind === "pointerLock"
      ? { axes: [0, 0, 0.4, 0] }
      : { axes: [0.4, 0, 0, 0] };
  const types = () => events.map((event) => event.type);
  return {
    ...environment,
    native,
    dispatcher,
    wrapper,
    events,
    update,
    active,
    types,
    index,
  };
};

interactionTest.for(sessionKinds)(
  "%s balances continuous input and keeps native change notifications",
  (kind, { cleanup, gamepadPolling }) => {
    const scenario = createScenario(kind, cleanup);
    gamepadPolling.publishFrame([3]);
    scenario.update();
    const before = scenario.camera.quaternion.clone();
    for (let frame = 0; frame < 3; frame++) {
      gamepadPolling.publishFrame([3, scenario.active]);
      scenario.update();
    }
    gamepadPolling.publishFrame([3]);
    scenario.update();
    expect(scenario.types()).toEqual([
      "start",
      "change",
      "change",
      "change",
      "end",
    ]);
    expect(before.angleTo(scenario.camera.quaternion)).toBeGreaterThan(0.01);
    expect(
      scenario.events.every((event) => event.source === scenario.camera.uuid),
    ).toBe(true);
  },
);

interactionTest(
  "PointerLock publishes changed orientation to an unlocked listener",
  ({ cleanup, gamepadPolling }) => {
    const scenario = createScenario("pointerLock", cleanup);
    gamepadPolling.publishFrame([3]);
    scenario.update();
    gamepadPolling.publishFrame([3, scenario.active]);
    scenario.update();
    expect(scenario.types()).toEqual(["change"]);
    expect(scenario.events[0].data.quaternion).toEqual(
      scenario.camera.quaternion.toArray(),
    );
    expect((scenario.native as PointerLockControls).isLocked).toBe(false);
  },
);

interactionTest.for(["orbit", "map"] as const)(
  "%s respects native rotateSpeed zero without opening a session",
  (kind, { cleanup, gamepadPolling }) => {
    const scenario = createScenario(kind, cleanup);
    (scenario.native as OrbitControls).rotateSpeed = 0;
    const before = scenario.camera.position.clone();
    gamepadPolling.publishFrame([3, scenario.active]);
    scenario.update();
    expect(scenario.camera.position.distanceTo(before)).toBeLessThan(1e-8);
    expect(scenario.types()).toEqual([]);
  },
);

interactionTest(
  "Trackball filters opposing trigger noise before calculating zoom",
  ({ cleanup, gamepadPolling }) => {
    const actual = createScenario("trackball", cleanup, 0);
    const reference = createScenario("trackball", cleanup, 3);
    gamepadPolling.publishFrame(
      [
        0,
        { buttons: createGamepadButtons([7, false, 0.11], [6, false, 0.09]) },
      ],
      [3, { buttons: createGamepadButtons([7, false, 0.11]) }],
    );
    actual.update();
    reference.update();
    expect(
      actual.camera.position.distanceTo(reference.camera.position),
    ).toBeLessThan(1e-8);
    expect(actual.types()).toEqual(["start", "change"]);
  },
);

interactionTest(
  "Arcball panSpeed zero does not publish an empty interaction",
  ({ cleanup, gamepadPolling }) => {
    const scenario = createScenario("arcball", cleanup, 3, "perspective", {
      panSpeed: 0,
    });
    gamepadPolling.publishFrame([3, { axes: [0, 0, 0.5, 0] }]);
    scenario.update();
    expect(scenario.types()).toEqual([]);
  },
);

/**
 * Removes the native rotation permission for a session-capable control pair.
 *
 * @param scenario - Orbit, Map, Trackball, or Arcball scenario to restrict.
 */
const forbidRotation = (scenario: ReturnType<typeof createScenario>) => {
  if (scenario.native instanceof TrackballControls)
    scenario.native.noRotate = true;
  else
    (scenario.native as OrbitControls | ArcballControls).enableRotate = false;
};

for (const kind of sessionKinds) {
  interactionTest.for([
    "event",
    "poll",
    "disable",
    "forbid",
    "zero",
    "dispose",
  ] as const)(
    `${kind} ends its session once on %s`,
    (reason, { cleanup, gamepadPolling }) => {
      const scenario = createScenario(kind, cleanup);
      gamepadPolling.publishFrame([3, scenario.active]);
      scenario.update();
      expect(scenario.types()).toEqual(["start", "change"]);
      const before = scenario.camera.position.clone();
      if (reason === "event") {
        dispatchGamepadEvent(
          "gamepaddisconnected",
          scenario.wrapper.gamepad as Gamepad,
        );
        gamepadPolling.publishFrame();
      }
      if (reason === "poll") gamepadPolling.publishFrame();
      if (reason === "disable") scenario.native.enabled = false;
      if (reason === "forbid") forbidRotation(scenario);
      if (reason === "zero")
        (
          scenario.native as OrbitControls | TrackballControls | ArcballControls
        ).rotateSpeed = 0;
      if (reason === "dispose") scenario.wrapper.dispose();
      scenario.update();
      scenario.wrapper.dispose();
      scenario.wrapper.dispose();
      expect(scenario.types()).toEqual(["start", "change", "end"]);
      expect(scenario.camera.position.distanceTo(before)).toBeLessThan(1e-8);
    },
  );

  interactionTest(
    `${kind} keeps a paused session until neutral resume and handles loss while paused`,
    ({ cleanup, gamepadPolling }) => {
      const scenario = createScenario(kind, cleanup);
      gamepadPolling.publishFrame([3, scenario.active]);
      scenario.update();
      scenario.wrapper.enabled = false;
      const polls = gamepadPolling.getGamepads.mock.calls.length;
      gamepadPolling.publishFrame([3]);
      scenario.update();
      expect(gamepadPolling.getGamepads).toHaveBeenCalledTimes(polls);
      expect(scenario.types()).toEqual(["start", "change"]);
      scenario.wrapper.enabled = true;
      scenario.update();
      expect(scenario.types()).toEqual(["start", "change", "end"]);
      gamepadPolling.publishFrame([3, scenario.active]);
      scenario.update();
      scenario.wrapper.enabled = false;
      dispatchGamepadEvent(
        "gamepaddisconnected",
        scenario.wrapper.gamepad as Gamepad,
      );
      scenario.wrapper.dispose();
      expect(scenario.types()).toEqual([
        "start",
        "change",
        "end",
        "start",
        "change",
        "end",
      ]);
    },
  );

  interactionTest.for([
    "disable",
    "forbid",
    "zero",
    "pause",
    "dispose",
    "disconnect",
    "reenter",
  ] as const)(
    `${kind} revalidates a start listener requesting %s`,
    (action, { cleanup, gamepadPolling }) => {
      const scenario = createScenario(kind, cleanup);
      const before = scenario.camera.position.clone();
      const nested = vi.fn(() => {
        if (action === "disable") scenario.native.enabled = false;
        if (action === "forbid") forbidRotation(scenario);
        if (action === "zero")
          (
            scenario.native as
              | OrbitControls
              | TrackballControls
              | ArcballControls
          ).rotateSpeed = 0;
        if (action === "pause") scenario.wrapper.enabled = false;
        if (action === "dispose") scenario.wrapper.dispose();
        if (action === "disconnect")
          dispatchGamepadEvent(
            "gamepaddisconnected",
            scenario.wrapper.gamepad as Gamepad,
          );
        if (action === "reenter") scenario.wrapper.update(0.1);
      });
      scenario.dispatcher.addEventListener("start", nested);
      gamepadPolling.publishFrame([3, scenario.active]);
      scenario.update();
      expect(nested).toHaveBeenCalledOnce();
      if (action === "reenter") {
        expect(scenario.types()).toEqual(["start", "change"]);
        expect(gamepadPolling.getGamepads).toHaveBeenCalledOnce();
      } else {
        expect(scenario.camera.position.distanceTo(before)).toBeLessThan(1e-8);
        expect(scenario.types()).toEqual(
          action === "pause" ? ["start"] : ["start", "end"],
        );
      }
      scenario.wrapper.dispose();
      expect(scenario.types().filter((type) => type === "end")).toHaveLength(1);
    },
  );

  interactionTest(
    `${kind} blocks updates and repeated disposal from an end listener`,
    ({ cleanup, gamepadPolling }) => {
      const scenario = createScenario(kind, cleanup);
      gamepadPolling.publishFrame([3, scenario.active]);
      scenario.update();
      const polls = gamepadPolling.getGamepads.mock.calls.length;
      scenario.dispatcher.addEventListener("end", () => {
        scenario.wrapper.update(0.1);
        scenario.wrapper.dispose();
      });
      dispatchGamepadEvent(
        "gamepaddisconnected",
        scenario.wrapper.gamepad as Gamepad,
      );
      expect(gamepadPolling.getGamepads).toHaveBeenCalledTimes(polls);
      expect(scenario.types()).toEqual(["start", "change", "end"]);
    },
  );

  interactionTest(
    `${kind} isolates sessions for sparse slots in both update orders`,
    ({ cleanup, gamepadPolling }) => {
      const a = createScenario(kind, cleanup, 0);
      const b = createScenario(kind, cleanup, 3);
      gamepadPolling.publishFrame([0], [3]);
      b.update();
      a.update();
      gamepadPolling.publishFrame([0, a.active], [3, b.active]);
      a.update();
      b.update();
      expect(a.types()).toEqual(["start", "change"]);
      expect(b.types()).toEqual(["start", "change"]);
      a.wrapper.dispose();
      gamepadPolling.publishFrame([3, b.active]);
      b.update();
      a.update();
      expect(a.types()).toEqual(["start", "change", "end"]);
      expect(b.types()).toEqual(["start", "change", "change"]);
      expect(a.events.every((event) => event.source === a.camera.uuid)).toBe(
        true,
      );
      expect(b.events.every((event) => event.source === b.camera.uuid)).toBe(
        true,
      );
    },
  );
}

interactionTest.for(["orbit", "map", "trackball"] as const)(
  "%s separates damping changes from the end of input",
  (kind, { cleanup, gamepadPolling }) => {
    const scenario = createScenario(kind, cleanup);
    if (scenario.native instanceof OrbitControls) {
      scenario.native.enableDamping = true;
      scenario.native.dampingFactor = 0.2;
    } else (scenario.native as TrackballControls).staticMoving = false;
    gamepadPolling.publishFrame([3, scenario.active]);
    scenario.update();
    const before = scenario.camera.position.clone();
    gamepadPolling.publishFrame([3]);
    scenario.update();
    scenario.update();
    expect(scenario.types().filter((type) => type === "start")).toHaveLength(1);
    expect(scenario.types().filter((type) => type === "end")).toHaveLength(1);
    expect(scenario.types().slice(-1)).toEqual(["change"]);
    expect(scenario.camera.position.distanceTo(before)).toBeGreaterThan(1e-5);
  },
);

interactionTest.for(["orbit", "map", "trackball"] as const)(
  "%s reads each pipeline once and switches actions within a single session",
  (kind, { cleanup, gamepadPolling }) => {
    const transform = vi.fn((value: { x: number; y: number }) => value);
    const pipeline = gamepadStickPipeline().transform(transform);
    const scenario = createScenario(kind, cleanup, 3, "perspective", {
      rotateStick: { pipeline },
      panStick: { pipeline },
    });
    gamepadPolling.publishFrame([3, scenario.active]);
    scenario.update();
    expect(transform).toHaveBeenCalledTimes(2);
    const panAxes = kind === "map" ? [0.3, 0.2, 0, 0] : [0, 0, 0.3, 0.2];
    gamepadPolling.publishFrame([3, { axes: panAxes }]);
    scenario.update();
    gamepadPolling.publishFrame([3]);
    scenario.update();
    expect(scenario.types().filter((type) => type === "start")).toHaveLength(1);
    expect(scenario.types().filter((type) => type === "end")).toHaveLength(1);
  },
);

for (const kind of ["orbit", "map", "trackball"] as const) {
  for (const projection of ["perspective", "orthographic"] as const) {
    interactionTest.for(["rotate", "pan", "zoom"] as const)(
      `${kind} ${projection} combines %s speeds exactly once`,
      (action, { cleanup, gamepadPolling }) => {
        const property = `${action}Speed` as const;
        const a = createScenario(kind, cleanup, 0, projection, {
          [property]: 0.5,
        });
        const b = createScenario(kind, cleanup, 3, projection);
        (a.native as OrbitControls | TrackballControls)[property] = 2;
        (b.native as OrbitControls | TrackballControls)[property] = 1;
        const active =
          action === "rotate"
            ? a.active
            : action === "pan"
              ? { axes: kind === "map" ? [0.4, 0.2, 0, 0] : [0, 0, 0.4, 0.2] }
              : { buttons: createGamepadButtons([7, false, 0.4]) };
        gamepadPolling.publishFrame([0, active], [3, active]);
        a.update();
        b.update();
        expect(a.camera.position.distanceTo(b.camera.position)).toBeLessThan(
          1e-8,
        );
        expect(a.camera.quaternion.angleTo(b.camera.quaternion)).toBeLessThan(
          1e-7,
        );
        expect(a.camera.zoom).toBeCloseTo(b.camera.zoom, 10);
        expect(a.types()).toEqual(b.types());
        (a.native as OrbitControls | TrackballControls)[property] = 0;
        gamepadPolling.publishFrame([0, active]);
        const before = a.camera.position.clone();
        const zoomBefore = a.camera.zoom;
        a.update();
        expect(a.camera.position.distanceTo(before)).toBeLessThan(1e-8);
        expect(a.camera.zoom).toBe(zoomBefore);
        expect(a.types().slice(-1)).toEqual(["end"]);
      },
    );
  }
}

interactionTest.for(["static", "dynamic"] as const)(
  "Trackball %s filters threshold values and cancels equal triggers",
  (mode, { cleanup, gamepadPolling }) => {
    const scenario = createScenario("trackball", cleanup);
    (scenario.native as TrackballControls).staticMoving = mode === "static";
    for (const value of [0.09, 0.1, 0.5]) {
      gamepadPolling.publishFrame([
        3,
        { buttons: createGamepadButtons([6, false, value], [7, false, value]) },
      ]);
      scenario.update();
    }
    expect(scenario.types()).toEqual([]);
    gamepadPolling.publishFrame([
      3,
      { buttons: createGamepadButtons([6, false, 0.11], [7, false, 0.09]) },
    ]);
    scenario.update();
    expect(scenario.types()).toEqual(["start", "change"]);
    expect(scenario.camera.position.length()).toBeGreaterThan(10);
  },
);

interactionTest.for([
  "upper",
  "lower",
  "yaw",
  "zeroNative",
  "zeroWrapper",
  "translation",
  "tiny",
  "sign",
] as const)(
  "PointerLock only notifies changed orientation: %s",
  (caseName, { cleanup, gamepadPolling }) => {
    const scenario = createScenario("pointerLock", cleanup, 3, "perspective", {
      lookSpeed: caseName === "zeroWrapper" ? 0 : 1,
    });
    const native = scenario.native as PointerLockControls;
    let axes = [0, 0, 0, 0.5];
    if (caseName === "upper" || caseName === "lower" || caseName === "yaw") {
      native.minPolarAngle = Math.PI / 2;
      native.maxPolarAngle = Math.PI / 2;
      axes = [
        0,
        0,
        caseName === "yaw" ? 0.5 : 0,
        caseName === "lower" ? -0.5 : 0.5,
      ];
    }
    if (caseName === "zeroNative") native.pointerSpeed = 0;
    if (caseName === "translation") axes = [0.5, -0.5, 0, 0];
    if (caseName === "tiny") axes = [0, 0, 0.5, 0];
    if (caseName === "sign") {
      scenario.camera.quaternion.set(0, 0, 0, -1);
      axes = [0, 0, 0.5, 0];
    }
    scenario.dispatcher.addEventListener("change", () =>
      scenario.wrapper.update(0.1),
    );
    gamepadPolling.publishFrame([3, { axes }]);
    scenario.update(caseName === "tiny" || caseName === "sign" ? 1e-10 : 0.1);
    expect(scenario.types()).toEqual(caseName === "yaw" ? ["change"] : []);
    expect(gamepadPolling.getGamepads).toHaveBeenCalledOnce();
    if (caseName === "yaw") {
      const expected = new Quaternion().setFromAxisAngle(
        scenario.camera.up,
        -0.5 * 0.1 * Math.PI,
      );
      expect(expected.angleTo(scenario.camera.quaternion)).toBeLessThan(1e-7);
    }
  },
);

for (const kind of sessionKinds) {
  interactionTest.for(["event", "poll"] as const)(
    `${kind} reconnects with a new session after %s loss`,
    (loss, { cleanup, gamepadPolling }) => {
      const scenario = createScenario(kind, cleanup);
      gamepadPolling.publishFrame([3, scenario.active]);
      scenario.update();
      if (loss === "event")
        dispatchGamepadEvent(
          "gamepaddisconnected",
          scenario.wrapper.gamepad as Gamepad,
        );
      gamepadPolling.publishFrame();
      scenario.update();
      gamepadPolling.publishFrame([3, scenario.active]);
      scenario.update();
      gamepadPolling.publishFrame([3]);
      scenario.update();
      expect(scenario.types()).toEqual([
        "start",
        "change",
        "end",
        "start",
        "change",
        "end",
      ]);
    },
  );

  interactionTest(
    `${kind} observes native disabling during pause only on resume`,
    ({ cleanup, gamepadPolling }) => {
      const scenario = createScenario(kind, cleanup);
      gamepadPolling.publishFrame([3, scenario.active]);
      scenario.update();
      scenario.wrapper.enabled = false;
      scenario.native.enabled = false;
      scenario.update();
      expect(scenario.types()).toEqual(["start", "change"]);
      scenario.wrapper.enabled = true;
      scenario.update();
      expect(scenario.types()).toEqual(["start", "change", "end"]);
    },
  );

  interactionTest(
    `${kind} releases the update guard after a throwing start listener`,
    ({ cleanup, gamepadPolling }) => {
      const scenario = createScenario(kind, cleanup);
      const fail = () => {
        throw new Error("listener failure");
      };
      scenario.dispatcher.addEventListener("start", fail);
      gamepadPolling.publishFrame([3, scenario.active]);
      expect(() => scenario.update()).toThrow("listener failure");
      scenario.dispatcher.removeEventListener("start", fail);
      gamepadPolling.publishFrame([3]);
      scenario.update();
      expect(scenario.types()).toEqual(["start", "end"]);
    },
  );
}

interactionTest.for(["rotateX", "rotateY", "pan", "in", "out"] as const)(
  "Orbit stops immediately after a native %s change listener cancels input",
  (operation, { cleanup, gamepadPolling }) => {
    const scenario = createScenario("orbit", cleanup);
    const native = scenario.native as OrbitControls;
    const input =
      operation === "rotateX"
        ? {
            axes: [0.4, 0.4, 0.4, 0.4],
            buttons: createGamepadButtons([6, false, 0.5], [7, false, 0.5]),
          }
        : operation === "rotateY"
          ? {
              axes: [0, 0.4, 0.4, 0.4],
              buttons: createGamepadButtons([7, false, 0.5]),
            }
          : operation === "pan"
            ? {
                axes: [0, 0, 0.4, 0.4],
                buttons: createGamepadButtons([7, false, 0.5]),
              }
            : {
                buttons: createGamepadButtons([
                  operation === "in" ? 7 : 6,
                  false,
                  0.5,
                ]),
              };
    scenario.dispatcher.addEventListener("change", () => {
      native.enabled = false;
      scenario.wrapper.update(0.1);
    });
    gamepadPolling.publishFrame([3, input]);
    scenario.update();
    expect(scenario.types()).toEqual(["start", "change", "end"]);
    expect(gamepadPolling.getGamepads).toHaveBeenCalledOnce();
  },
);

interactionTest.for(["orbit", "map", "trackball"] as const)(
  "%s keeps intent active at a geometric limit without fabricating change",
  (kind, { cleanup, gamepadPolling }) => {
    const scenario = createScenario(kind, cleanup);
    const native = scenario.native as OrbitControls | TrackballControls;
    native.minDistance = 10;
    native.maxDistance = 10;
    gamepadPolling.publishFrame([
      3,
      { buttons: createGamepadButtons([7, false, 0.4]) },
    ]);
    scenario.update();
    scenario.update();
    expect(scenario.types()).toEqual(["start"]);
    gamepadPolling.publishFrame([3]);
    scenario.update();
    expect(scenario.types()).toEqual(["start", "end"]);
  },
);

interactionTest.for([
  "panSpeed",
  "zoomSpeed",
  "zRotateSpeed",
  "rotateSpeed",
] as const)(
  "Arcball %s zero does not acquire interaction",
  (property, { cleanup, gamepadPolling }) => {
    const environment = createThreeEnvironment(cleanup);
    const native = new ArcballControls(
      environment.camera,
      environment.element,
      environment.scene,
    );
    native.enableAnimations = false;
    cleanup.add("native", () => native.dispose());
    for (const child of [...environment.scene.children])
      if (child !== environment.mesh)
        cleanup.add("resource", () => disposeObjectResources(child));
    const wrapper = new GamepadArcballControls(native, {
      gamepadIndex: 3,
      [property]: 0,
    });
    cleanup.add("wrapper", () => wrapper.dispose());
    const types: string[] = [];
    for (const type of ["start", "change", "end"] as const)
      native.addEventListener(type, () => types.push(type));
    const input =
      property === "rotateSpeed"
        ? { axes: [0.5, 0.5, 0, 0] }
        : property === "panSpeed"
          ? { axes: [0, 0, 0.5, 0.5] }
          : {
              buttons: createGamepadButtons([
                property === "zoomSpeed" ? 7 : 4,
                false,
                0.5,
              ]),
            };
    gamepadPolling.publishFrame([3, input]);
    wrapper.update(0.1);
    expect(types).toEqual([]);
  },
);

interactionTest.for(["zero", "one", "infinite", "negative"] as const)(
  "Arcball invalid or neutral zoom factor %s does not acquire interaction",
  (factor, { cleanup, gamepadPolling }) => {
    const scenario = createScenario("arcball", cleanup);
    (scenario.native as ArcballControls).scaleFactor =
      factor === "zero"
        ? 0
        : factor === "one"
          ? 1
          : factor === "infinite"
            ? Number.POSITIVE_INFINITY
            : -2;
    gamepadPolling.publishFrame([
      3,
      { buttons: createGamepadButtons([7, false, 0.5]) },
    ]);
    scenario.update();
    expect(scenario.types()).toEqual([]);
  },
);

interactionTest(
  "Arcball revalidates its last permission after change without rereading bindings",
  ({ cleanup, gamepadPolling }) => {
    const scenario = createScenario("arcball", cleanup);
    scenario.dispatcher.addEventListener("change", () => {
      forbidRotation(scenario);
      scenario.wrapper.update(0.1);
    });
    gamepadPolling.publishFrame([3, scenario.active]);
    scenario.update();
    expect(scenario.types()).toEqual(["start", "change", "end"]);
    expect(gamepadPolling.getGamepads).toHaveBeenCalledOnce();
  },
);

interactionTest(
  "PointerLock isolates change notifications for opposite inputs and sparse slots",
  ({ cleanup, gamepadPolling }) => {
    const a = createScenario("pointerLock", cleanup, 0);
    const b = createScenario("pointerLock", cleanup, 3);
    gamepadPolling.publishFrame(
      [0, { axes: [0, 0, 0.5, 0] }],
      [3, { axes: [0, 0, -0.5, 0] }],
    );
    b.update();
    a.update();
    expect(a.types()).toEqual(["change"]);
    expect(b.types()).toEqual(["change"]);
    expect(a.camera.quaternion.y).toBeLessThan(0);
    expect(b.camera.quaternion.y).toBeGreaterThan(0);
    a.wrapper.dispose();
    gamepadPolling.publishFrame([3, b.active]);
    a.update();
    b.update();
    expect(a.types()).toEqual(["change"]);
    expect(b.types()).toEqual(["change", "change"]);
    expect(b.events.every((event) => event.source === b.camera.uuid)).toBe(
      true,
    );
  },
);
