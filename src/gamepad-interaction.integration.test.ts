import {
  type EventDispatcher,
  Line,
  type Matrix4,
  type Object3D,
  Quaternion,
  type Vector3,
} from "three";
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

import {
  createGamepad,
  createGamepadButtons,
} from "../test/fixtures/gamepad.ts";
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
 * @param configureOrbit - Optional native setup before installing an Orbit/Map wrapper.
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
  configureOrbit?: (native: OrbitControls) => void,
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
    configureOrbit?.(native);
  }
  if (native instanceof TrackballControls) {
    native.staticMoving = true;
  }
  if (native instanceof ArcballControls) {
    native.enableAnimations = false;
    for (const child of [...scene.children]) {
      if (child !== environment.mesh) {
        cleanup.add("resource", () => disposeObjectResources(child));
      }
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
    if (native instanceof OrbitControls) {
      native.update(delta);
    }
    if (native instanceof TrackballControls) {
      native.update();
    }
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

type ArcballGeometry = ArcballControls & {
  target: Vector3;
  _gizmos: Object3D;
  _tbRadius: number;
  _state: unknown;
  onSinglePanStart(
    event: { clientX: number; clientY: number },
    operation: string,
  ): void;
  applyTransformMatrix(transformation: {
    camera: Matrix4 | null;
    gizmos: Matrix4 | null;
  }): void;
  onDoubleTap(event: { clientX: number; clientY: number }): void;
};

/** Reads geometry without repairing the camera projection under test. */
const arcballGeometry = (scenario: ReturnType<typeof createScenario>) => {
  const { camera } = scenario;
  const native = scenario.native as ArcballGeometry;
  camera.updateMatrixWorld(true);
  native._gizmos.updateMatrixWorld(true);
  return {
    near: camera.near,
    far: camera.far,
    zoom: camera.zoom,
    projection: camera.projectionMatrix.toArray(),
    inverse: camera.projectionMatrixInverse.toArray(),
    position: camera.position.toArray(),
    quaternion: camera.quaternion.toArray(),
    up: camera.up.toArray(),
    matrix: camera.matrix.toArray(),
    world: camera.matrixWorld.toArray(),
    target: native.target.toArray(),
    gizmos: native._gizmos.matrix.toArray(),
    gizmosWorld: native._gizmos.matrixWorld.toArray(),
    gizmoVertices: native._gizmos.children.flatMap((child) =>
      child instanceof Line
        ? Array.from<number>(child.geometry.getAttribute("position").array)
        : [],
    ),
    radius: native._tbRadius,
  };
};

/** Compares native results with numerical tolerance, including quaternion sign. */
const expectArcballGeometry = (
  actual: ReturnType<typeof arcballGeometry>,
  expected: ReturnType<typeof arcballGeometry>,
) => {
  for (const key of ["near", "far", "zoom", "radius"] as const) {
    expect(actual[key], key).toBeCloseTo(expected[key], 9);
  }
  expect(
    new Quaternion()
      .fromArray(actual.quaternion)
      .angleTo(new Quaternion().fromArray(expected.quaternion)),
  ).toBeLessThan(1e-7);
  for (const key of [
    "projection",
    "inverse",
    "position",
    "up",
    "matrix",
    "world",
    "target",
    "gizmos",
    "gizmosWorld",
    "gizmoVertices",
  ] as const) {
    actual[key].forEach((value, index) => {
      expect(value, `${key}[${index}]`).toBeCloseTo(expected[key][index], 9);
    });
  }
};

interactionTest(
  "Arcball clipping matches native wheel zoom-out before rendering",
  ({ cleanup, gamepadPolling }) => {
    const actual = createScenario("arcball", cleanup);
    const reference = createScenario("arcball", cleanup);
    (actual.native as ArcballControls).adjustNearFar = true;
    (reference.native as ArcballControls).adjustNearFar = true;
    const changes = collectEvents(
      cleanup,
      actual.dispatcher,
      ["change"],
      "actual",
      () => arcballGeometry(actual),
    );
    reference.element.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: 125,
        cancelable: true,
      }),
    );
    gamepadPolling.publishFrame([
      3,
      {
        buttons: createGamepadButtons([6, false, 1]),
      },
    ]);
    actual.wrapper.update(1 / 8);
    const expected = arcballGeometry(reference);
    expect(expected.near).toBeGreaterThan(0.1);
    expectArcballGeometry(arcballGeometry(actual), expected);
    expect(changes).toHaveLength(1);
    expectArcballGeometry(changes[0].data, expected);
  },
);

for (const projection of ["perspective", "orthographic"] as const) {
  for (const adjustNearFar of [true, false]) {
    interactionTest(
      `Arcball clipping ${projection} adjust=${adjustNearFar} matches wheel, focus and subsequent rotations`,
      ({ cleanup, gamepadPolling }) => {
        const actual = createScenario("arcball", cleanup, 3, projection);
        const reference = createScenario("arcball", cleanup, 0, projection);
        const native = actual.native as ArcballGeometry;
        const referenceNative = reference.native as ArcballGeometry;
        native.adjustNearFar = referenceNative.adjustNearFar = adjustNearFar;
        const originalApply = native.applyTransformMatrix;
        const changes = collectEvents(
          cleanup,
          actual.dispatcher,
          ["change"],
          "actual",
          () => arcballGeometry(actual),
        );
        const compare = () => {
          const expected = arcballGeometry(reference);
          expectArcballGeometry(arcballGeometry(actual), expected);
          expectArcballGeometry(changes[changes.length - 1].data, expected);
          expect(native.applyTransformMatrix).toBe(originalApply);
          expect(Object.hasOwn(native, "applyTransformMatrix")).toBe(false);
          const projected = actual.camera.clone();
          projected.updateProjectionMatrix();
          expect(
            actual.camera.projectionMatrix.equals(projected.projectionMatrix),
          ).toBe(true);
          expect(
            actual.camera.projectionMatrixInverse.equals(
              projected.projectionMatrixInverse,
            ),
          ).toBe(true);
        };
        for (const amount of [-1, 0.5, -0.75, 1]) {
          reference.element.dispatchEvent(
            new WheelEvent("wheel", {
              deltaY: -125 * amount,
              cancelable: true,
            }),
          );
          gamepadPolling.publishFrame([
            3,
            {
              buttons: createGamepadButtons([
                amount > 0 ? 7 : 6,
                false,
                Math.abs(amount),
              ]),
            },
          ]);
          actual.wrapper.update(1 / 8);
          compare();
        }
        // Focus a real center-ray hit beyond the original target, then restore
        // clipping through focus with adjustment disabled and zoom still enabled.
        for (const adjust of [adjustNearFar, !adjustNearFar, false]) {
          native.adjustNearFar = referenceNative.adjustNearFar = adjust;
          for (const scenario of [actual, reference]) {
            scenario.mesh.position.z -= 3;
            scenario.scene.updateMatrixWorld(true);
          }
          gamepadPolling.publishFrame([3]);
          actual.wrapper.update(1 / 8);
          referenceNative.onDoubleTap({ clientX: 400, clientY: 300 });
          gamepadPolling.publishFrame([
            3,
            { buttons: createGamepadButtons([0, true]) },
          ]);
          actual.wrapper.update(1 / 8);
          compare();
        }
        expect(actual.camera.near).toBe(0.1);
        expect(actual.camera.far).toBe(1000);
        // Identical gamepad rotations must remain coherent after either native
        // or gamepad scaling/focus history, including the view-axis up vector.
        for (const input of [
          { axes: [0.4, -0.3, 0, 0] },
          { buttons: createGamepadButtons([4, false, 0.6]) },
        ]) {
          gamepadPolling.publishFrame([0, input], [3, input]);
          reference.wrapper.update(1 / 8);
          actual.wrapper.update(1 / 8);
          compare();
        }
      },
    );
  }

  interactionTest(
    `Arcball clipping ${projection} preserves native distance and zoom clamps`,
    ({ cleanup, gamepadPolling }) => {
      const actual = createScenario("arcball", cleanup, 3, projection);
      const reference = createScenario("arcball", cleanup, 0, projection);
      for (const scenario of [actual, reference]) {
        const native = scenario.native as ArcballControls;
        native.adjustNearFar = true;
        native.minDistance = 9;
        native.maxDistance = 11;
        native.minZoom = 0.9;
        native.maxZoom = 1.1;
      }
      for (const amount of [-1, -1, 1, 1, 1]) {
        reference.element.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: -125 * amount * 4,
            cancelable: true,
          }),
        );
        gamepadPolling.publishFrame([
          3,
          {
            buttons: createGamepadButtons([amount > 0 ? 7 : 6, false, 1]),
          },
        ]);
        actual.wrapper.update(0.5);
        expectArcballGeometry(
          arcballGeometry(actual),
          arcballGeometry(reference),
        );
      }
      expect(actual.types()).toEqual(["start", ...Array(5).fill("change")]);
      gamepadPolling.publishFrame([3]);
      actual.wrapper.update(0.5);
      expect(actual.types().at(-1)).toBe("end");
    },
  );

  for (const hit of [true, false]) {
    interactionTest(
      `Arcball clipping ${projection} focus with zoom disabled and hit=${hit}`,
      ({ cleanup, gamepadPolling }) => {
        const actual = createScenario("arcball", cleanup, 3, projection);
        const reference = createScenario("arcball", cleanup, 0, projection);
        for (const scenario of [actual, reference]) {
          const native = scenario.native as ArcballControls;
          native.adjustNearFar = true;
          scenario.element.dispatchEvent(
            new WheelEvent("wheel", { deltaY: 125 }),
          );
          // Disabling adjustment alone must not restore clipping. Native focus
          // without zoom only translates; it does not apply scale side effects.
          native.adjustNearFar = false;
          native.enableZoom = false;
          scenario.mesh.position.set(hit ? 0 : 100, 0, -3);
          scenario.scene.updateMatrixWorld(true);
          scenario.events.length = 0;
        }
        const before = arcballGeometry(actual);
        gamepadPolling.publishFrame([3]);
        actual.wrapper.update(0.1);
        (reference.native as ArcballGeometry).onDoubleTap({
          clientX: 400,
          clientY: 300,
        });
        gamepadPolling.publishFrame([
          3,
          { buttons: createGamepadButtons([0, true]) },
        ]);
        actual.wrapper.update(0.1);
        const after = arcballGeometry(actual);
        expectArcballGeometry(after, arcballGeometry(reference));
        expect(after.near).toBe(before.near);
        expect(after.far).toBe(before.far);
        expect(actual.types()).toEqual(hit ? ["start", "change", "end"] : []);
      },
    );
  }
}

interactionTest(
  "Arcball clipping applies once without borrowing an existing native zoom state",
  ({ cleanup, gamepadPolling }) => {
    const actual = createScenario("arcball", cleanup);
    const reference = createScenario("arcball", cleanup);
    const native = actual.native as ArcballGeometry;
    native.adjustNearFar = true;
    (reference.native as ArcballControls).adjustNearFar = true;
    native.onSinglePanStart({ clientX: 400, clientY: 300 }, "ZOOM");
    const state = native._state;
    const projectionUpdate = vi.spyOn(actual.camera, "updateProjectionMatrix");
    const originalApply = vi.spyOn(native, "applyTransformMatrix");
    gamepadPolling.publishFrame([3]);
    actual.wrapper.update(0.125);
    for (const button of [6, 0]) {
      projectionUpdate.mockClear();
      if (button === 6) {
        reference.element.dispatchEvent(
          new WheelEvent("wheel", { deltaY: 125 }),
        );
      } else {
        (reference.native as ArcballGeometry).onDoubleTap({
          clientX: 400,
          clientY: 300,
        });
      }
      gamepadPolling.publishFrame([
        3,
        { buttons: createGamepadButtons([button, true]) },
      ]);
      actual.wrapper.update(0.125);
      expectArcballGeometry(
        arcballGeometry(actual),
        arcballGeometry(reference),
      );
      expect(projectionUpdate).toHaveBeenCalledOnce();
      expect(originalApply).not.toHaveBeenCalled();
      expect(native.applyTransformMatrix).toBe(originalApply);
      expect(native._state).toBe(state);
    }
  },
);

interactionTest.for([false, true])(
  "Arcball clipping stays independent across slots 0/3 with reverse=%s",
  (reverse, { cleanup, gamepadPolling }) => {
    const first = createScenario("arcball", cleanup, 0, "perspective");
    const second = createScenario("arcball", cleanup, 3, "orthographic");
    const references = [
      createScenario("arcball", cleanup, 0, "perspective"),
      createScenario("arcball", cleanup, 3, "orthographic"),
    ];
    const scenarios = [first, second];
    const order = reverse ? [second, first] : scenarios;
    for (const [index, scenario] of scenarios.entries()) {
      const native = scenario.native as ArcballGeometry;
      const reference = references[index].native as ArcballGeometry;
      native.adjustNearFar = reference.adjustNearFar = index === 0;
      native.scaleFactor = reference.scaleFactor = index === 0 ? 1.5 : 2;
    }
    gamepadPolling.publishFrame([0], [3]);
    for (const scenario of order) {
      scenario.wrapper.update(0.125);
    }
    for (const input of [
      { buttons: createGamepadButtons([6, false, 1]) },
      { buttons: createGamepadButtons([0, true]) },
    ]) {
      gamepadPolling.publishFrame([0, input], [3, input]);
      for (const scenario of order) {
        const other = scenario === first ? second : first;
        const beforeOther = arcballGeometry(other);
        scenario.wrapper.update(0.125);
        expectArcballGeometry(arcballGeometry(other), beforeOther);
      }
      for (const [index, reference] of references.entries()) {
        if (input.buttons[0]?.pressed) {
          (reference.native as ArcballGeometry).onDoubleTap({
            clientX: 400,
            clientY: 300,
          });
        } else {
          reference.element.dispatchEvent(
            new WheelEvent("wheel", { deltaY: 125 }),
          );
        }
        expectArcballGeometry(
          arcballGeometry(scenarios[index]),
          arcballGeometry(reference),
        );
        expect(
          Object.hasOwn(scenarios[index].native, "applyTransformMatrix"),
        ).toBe(false);
      }
    }
    first.wrapper.dispose();
    const beforeFirst = arcballGeometry(first);
    gamepadPolling.publishFrame([
      3,
      { buttons: createGamepadButtons([7, false, 1]) },
    ]);
    second.wrapper.update(0.125);
    references[1].element.dispatchEvent(
      new WheelEvent("wheel", { deltaY: -125 }),
    );
    expectArcballGeometry(
      arcballGeometry(second),
      arcballGeometry(references[1]),
    );
    expectArcballGeometry(arcballGeometry(first), beforeFirst);
  },
);

interactionTest.for([
  "pause",
  "disable",
  "event",
  "polling",
  "dispose",
] as const)(
  "Arcball clipping retains geometry on %s and leaves native wheel usable",
  (reason, { cleanup, gamepadPolling }) => {
    const scenario = createScenario("arcball", cleanup);
    const reference = createScenario("arcball", cleanup);
    const native = scenario.native as ArcballGeometry;
    native.adjustNearFar = true;
    (reference.native as ArcballControls).adjustNearFar = true;
    const originalApply = native.applyTransformMatrix;
    gamepadPolling.publishFrame([
      3,
      { buttons: createGamepadButtons([6, false, 1]) },
    ]);
    scenario.wrapper.update(0.125);
    reference.element.dispatchEvent(new WheelEvent("wheel", { deltaY: 125 }));
    const before = arcballGeometry(scenario);
    if (reason === "pause") {
      scenario.wrapper.enabled = false;
    } else if (reason === "disable") {
      native.enabled = false;
    } else if (reason === "event") {
      dispatchGamepadEvent(
        "gamepaddisconnected",
        gamepadPolling.gamepads[3] as Gamepad,
      );
      gamepadPolling.publishFrame();
    } else if (reason === "polling") {
      gamepadPolling.publishFrame();
    } else {
      scenario.wrapper.dispose();
    }
    scenario.wrapper.update(0.125);
    expectArcballGeometry(arcballGeometry(scenario), before);
    expect(scenario.types()).toEqual(
      reason === "pause" ? ["start", "change"] : ["start", "change", "end"],
    );
    native.enabled = true;
    scenario.wrapper.enabled = true;
    gamepadPolling.publishFrame([3]);
    scenario.wrapper.update(0.125);
    expect(scenario.types()).toEqual(["start", "change", "end"]);
    scenario.wrapper.dispose();
    expect(native.applyTransformMatrix).toBe(originalApply);
    for (const target of [scenario, reference]) {
      target.element.dispatchEvent(new WheelEvent("wheel", { deltaY: -125 }));
    }
    expectArcballGeometry(
      arcballGeometry(scenario),
      arcballGeometry(reference),
    );
  },
);

interactionTest(
  "Arcball clipping uses configuration changed by start and publishes complete geometry at change",
  ({ cleanup, gamepadPolling }) => {
    const actual = createScenario("arcball", cleanup);
    const reference = createScenario("arcball", cleanup);
    for (const scenario of [actual, reference]) {
      (scenario.native as ArcballControls).adjustNearFar = true;
      scenario.element.dispatchEvent(new WheelEvent("wheel", { deltaY: 125 }));
    }
    const native = actual.native as ArcballControls;
    const onStart = () => {
      native.adjustNearFar = false;
    };
    native.addEventListener("start", onStart);
    cleanup.add("listener", () => native.removeEventListener("start", onStart));
    const changes = collectEvents(
      cleanup,
      actual.dispatcher,
      ["change"],
      "actual",
      () => arcballGeometry(actual),
    );
    (reference.native as ArcballControls).adjustNearFar = false;
    reference.element.dispatchEvent(new WheelEvent("wheel", { deltaY: 125 }));
    gamepadPolling.publishFrame([
      3,
      { buttons: createGamepadButtons([6, false, 1]) },
    ]);
    actual.wrapper.update(0.125);
    expect(changes).toHaveLength(1);
    expectArcballGeometry(changes[0].data, arcballGeometry(reference));
    expect(native.adjustNearFar).toBe(false);
  },
);

/** Narrows the real Orbit/Map scenario for automatic-rotation regressions. */
const createOrbitScenario = (
  kind: "orbit" | "map",
  cleanup: Cleanup,
  index = 3,
  projection: "perspective" | "orthographic" = "perspective",
  options: Partial<GamepadOrbitControlsOptions> = {},
  configureNative?: (native: OrbitControls) => void,
) => {
  const scenario = createScenario(
    kind,
    cleanup,
    index,
    projection,
    options,
    configureNative,
  );
  return {
    ...scenario,
    native: scenario.native as OrbitControls,
    wrapper: scenario.wrapper as GamepadOrbitControls,
  };
};

type OrbitScenario = ReturnType<typeof createOrbitScenario>;

type OrbitNative = OrbitControls & {
  _getAutoRotationAngle(delta: number | null): number;
};

const orbitActionInput = (kind: "orbit" | "map", action = "rotate") =>
  action === "zoom"
    ? { buttons: createGamepadButtons([7, false, 0.4]) }
    : {
        axes:
          (action === "rotate") === (kind === "orbit")
            ? [0.4, 0.2, 0, 0]
            : [0, 0, 0.4, 0.2],
      };

/** Compares destinations, including the native target and camera projection. */
const expectOrbitDestination = (
  actual: OrbitScenario,
  expected: OrbitScenario,
) => {
  actual.syncMatrices();
  expected.syncMatrices();
  expect(
    actual.camera.position.distanceTo(expected.camera.position),
  ).toBeLessThan(1e-8);
  expect(
    actual.camera.quaternion.angleTo(expected.camera.quaternion),
  ).toBeLessThan(1e-7);
  expect(actual.native.target.distanceTo(expected.native.target)).toBeLessThan(
    1e-8,
  );
  expect(actual.camera.zoom).toBeCloseTo(expected.camera.zoom, 10);
  expect(actual.camera.projectionMatrix.elements).toEqual(
    expected.camera.projectionMatrix.elements,
  );
  expect(actual.types()).toEqual(expected.types());
};

for (const kind of ["orbit", "map"] as const) {
  for (const projection of ["perspective", "orthographic"] as const) {
    interactionTest.for([false, true])(
      `${kind} ${projection} suspends autoRotate throughout the frame with damping %s`,
      (damping, { cleanup, gamepadPolling }) => {
        const actual = createOrbitScenario(kind, cleanup, 0, projection);
        const reference = createOrbitScenario(kind, cleanup, 3, projection);
        for (const scenario of [actual, reference]) {
          scenario.native.autoRotate = true;
          scenario.native.enableDamping = damping;
          scenario.native.dampingFactor = 0.2;
        }
        const rotateX = kind === "map" ? [0, 0, 0.4, 0] : [0.4, 0, 0, 0];
        const rotateY = kind === "map" ? [0, 0, 0, 0.4] : [0, 0.4, 0, 0];
        const pan = kind === "map" ? [0.3, 0.2, 0, 0] : [0, 0, 0.3, 0.2];
        const activeFrames = [
          { axes: rotateX },
          { axes: rotateY },
          { axes: pan },
          { buttons: createGamepadButtons([7, false, 0.4]) },
          { buttons: createGamepadButtons([6, false, 0.4]) },
          {
            axes: [0.3, 0.2, 0.4, 0.2],
            buttons: createGamepadButtons([7, false, 0.4], [6, false, 0.2]),
          },
        ];
        gamepadPolling.publishFrame([0], [3]);
        actual.update();
        reference.update();
        expectOrbitDestination(actual, reference);
        for (const input of activeFrames) {
          reference.native.autoRotate = false;
          gamepadPolling.publishFrame([0, input], [3, input]);
          actual.wrapper.update(0.1);
          reference.wrapper.update(0.1);
          expectOrbitDestination(actual, reference);
          for (const delta of [undefined, null, 0, 0.1]) {
            actual.native.update(delta);
            reference.native.update(delta);
            expectOrbitDestination(actual, reference);
          }
          expect(actual.native.autoRotate).toBe(true);
        }
        const before = actual.camera.quaternion.clone();
        reference.native.autoRotate = true;
        gamepadPolling.publishFrame([0], [3]);
        actual.update();
        reference.update();
        expectOrbitDestination(actual, reference);
        expect(actual.camera.quaternion.angleTo(before)).toBeGreaterThan(1e-5);
        expect(actual.types().filter((type) => type === "start")).toHaveLength(
          1,
        );
        expect(actual.types().filter((type) => type === "end")).toHaveLength(1);
      },
    );
  }

  for (const action of ["rotate", "pan", "zoom"] as const) {
    interactionTest.for(["permission", "native gain", "wrapper gain"] as const)(
      `${kind} autoRotate ignores blocked ${action} intent: %s`,
      (block, { cleanup, gamepadPolling }) => {
        const speed = `${action}Speed` as const;
        const permission =
          action === "rotate"
            ? "enableRotate"
            : action === "pan"
              ? "enablePan"
              : "enableZoom";
        const actual = createOrbitScenario(kind, cleanup, 0, "perspective", {
          [speed]: block === "wrapper gain" ? 0 : 1,
        });
        const reference = createOrbitScenario(kind, cleanup, 3);
        actual.native.autoRotate = reference.native.autoRotate = true;
        if (block === "permission") {
          actual.native[permission] = false;
        }
        if (block === "native gain") {
          actual.native[speed] = 0;
        }
        gamepadPolling.publishFrame([0, orbitActionInput(kind, action)], [3]);
        actual.update();
        reference.update();
        expectOrbitDestination(actual, reference);
        expect(actual.types()).toEqual(["change"]);
      },
    );
  }

  interactionTest.for(["deadzone", "pipeline", "zero delta"] as const)(
    `${kind} autoRotate ignores ineffective input: %s`,
    (block, { cleanup, gamepadPolling }) => {
      const actual = createOrbitScenario(kind, cleanup, 0, "perspective", {
        rotateStick:
          block === "pipeline"
            ? {
                pipeline: gamepadStickPipeline().transform(() => ({
                  x: 0,
                  y: 0,
                })),
              }
            : {},
      });
      const reference = createOrbitScenario(kind, cleanup, 3);
      actual.native.autoRotate = reference.native.autoRotate = true;
      const input =
        block === "deadzone"
          ? {
              axes: [0.01, 0.01, 0.01, 0.01],
              buttons: createGamepadButtons([6, false, 0.1], [7, false, 0.09]),
            }
          : orbitActionInput(kind);
      gamepadPolling.publishFrame([0, input], [3]);
      actual.wrapper.update(block === "zero delta" ? 0 : 0.1);
      reference.wrapper.update(0.1);
      actual.native.update(0.1);
      reference.native.update(0.1);
      expectOrbitDestination(actual, reference);
      expect(actual.types()).toEqual(["change"]);
    },
  );

  interactionTest.for(["perspective", "orthographic"] as const)(
    `${kind} autoRotate remains suspended at a %s dolly limit`,
    (projection, { cleanup, gamepadPolling }) => {
      const actual = createOrbitScenario(kind, cleanup, 0, projection);
      const reference = createOrbitScenario(kind, cleanup, 3, projection);
      actual.native.autoRotate = true;
      for (const scenario of [actual, reference]) {
        scenario.native.minDistance = scenario.native.maxDistance = 10;
        scenario.native.minZoom = scenario.native.maxZoom = 1;
      }
      for (let frame = 0; frame < 2; frame++) {
        const input = orbitActionInput(kind, "zoom");
        gamepadPolling.publishFrame([0, input], [3, input]);
        actual.update();
        reference.update();
        expectOrbitDestination(actual, reference);
        expect(actual.types()).toEqual(["start"]);
      }
      reference.native.autoRotate = true;
      gamepadPolling.publishFrame([0], [3]);
      actual.update();
      reference.update();
      expectOrbitDestination(actual, reference);
      expect(actual.types()).toEqual(["start", "end", "change"]);
    },
  );

  interactionTest.for([
    "pause without update",
    "pause with update",
    "native disable",
    "disconnect event",
    "disconnect polling",
    "dispose",
    "permission",
    "gain",
  ] as const)(
    `${kind} releases autoRotate suppression on %s`,
    (action, { cleanup, gamepadPolling }) => {
      const actual = createOrbitScenario(kind, cleanup, 0);
      const reference = createOrbitScenario(kind, cleanup, 3);
      actual.native.autoRotate = true;
      const input = orbitActionInput(kind);
      gamepadPolling.publishFrame([0, input], [3, input]);
      actual.wrapper.update(0.1);
      reference.wrapper.update(0.1);
      expectOrbitDestination(actual, reference);
      reference.native.autoRotate = true;
      for (const scenario of [actual, reference]) {
        if (action.startsWith("pause")) {
          scenario.wrapper.enabled = false;
          if (action === "pause with update") {
            scenario.wrapper.update(0.1);
          }
        } else if (action === "native disable") {
          scenario.native.enabled = false;
        } else if (action === "disconnect event") {
          dispatchGamepadEvent(
            "gamepaddisconnected",
            scenario.wrapper.gamepad as Gamepad,
          );
        } else if (action === "dispose") {
          scenario.wrapper.dispose();
          scenario.wrapper.dispose();
        } else if (action === "permission") {
          scenario.native.enableRotate = false;
        } else if (action === "gain") {
          scenario.native.rotateSpeed = 0;
        }
      }
      if (action === "disconnect polling") {
        gamepadPolling.publishFrame();
        actual.wrapper.update(0.1);
        reference.wrapper.update(0.1);
      }
      const before = actual.camera.quaternion.clone();
      actual.native.update(0.1);
      reference.native.update(0.1);
      expectOrbitDestination(actual, reference);
      expect(actual.camera.quaternion.angleTo(before)).toBeGreaterThan(0.01);
      if (action.startsWith("pause")) {
        expect(actual.types().filter((type) => type === "end")).toHaveLength(0);
      }
      for (const scenario of [actual, reference]) {
        scenario.wrapper.enabled = true;
        scenario.native.enabled = true;
        scenario.native.enableRotate = true;
        scenario.native.rotateSpeed = 1;
      }
      gamepadPolling.publishFrame([0], [3]);
      actual.update();
      reference.update();
      expectOrbitDestination(actual, reference);
      expect(actual.types().filter((type) => type === "end")).toHaveLength(1);
    },
  );

  for (const event of ["start", "change"] as const) {
    interactionTest.for([
      "pause",
      "disable",
      "forbid",
      "zero",
      "disconnect",
      "dispose",
      "reenter",
    ] as const)(
      `${kind} revalidates autoRotate after ${event} requests %s`,
      (action, { cleanup, gamepadPolling }) => {
        const actual = createOrbitScenario(kind, cleanup, 0);
        const reference = createOrbitScenario(kind, cleanup, 3);
        actual.native.autoRotate = true;
        for (const scenario of [actual, reference]) {
          const listener = vi.fn(() => {
            scenario.native.removeEventListener(event, listener);
            if (action === "reenter") {
              scenario.wrapper.update(0.1);
              expect(scenario.native.update(0.1)).toBe(false);
              return;
            }
            scenario.native.autoRotate = true;
            if (action === "pause") {
              scenario.wrapper.enabled = false;
            }
            if (action === "disable") {
              scenario.native.enabled = false;
            }
            if (action === "forbid") {
              scenario.native.enableRotate = false;
            }
            if (action === "zero") {
              scenario.native.rotateSpeed = 0;
            }
            if (action === "disconnect") {
              dispatchGamepadEvent(
                "gamepaddisconnected",
                scenario.wrapper.gamepad as Gamepad,
              );
            }
            if (action === "dispose") {
              scenario.wrapper.dispose();
            }
          });
          scenario.native.addEventListener(event, listener);
          cleanup.add("listener", () =>
            scenario.native.removeEventListener(event, listener),
          );
        }
        const input = orbitActionInput(kind);
        gamepadPolling.publishFrame([0, input], [3, input]);
        actual.update();
        reference.update();
        expectOrbitDestination(actual, reference);
        expect(gamepadPolling.getGamepads).toHaveBeenCalledTimes(2);
        expect(actual.native.autoRotate).toBe(true);
      },
    );
  }

  interactionTest.for(["reenter", "dispose", "throw"] as const)(
    `${kind} releases autoRotate before an end listener requests %s`,
    (action, { cleanup, gamepadPolling }) => {
      const scenario = createOrbitScenario(kind, cleanup);
      scenario.native.autoRotate = true;
      gamepadPolling.publishFrame([3, orbitActionInput(kind)]);
      scenario.update();
      const before = scenario.camera.quaternion.clone();
      const listener = () => {
        scenario.wrapper.update(0.1);
        if (action === "dispose") {
          scenario.wrapper.dispose();
        }
        if (action === "throw") {
          throw new Error("end failure");
        }
        expect(scenario.native.update(0.1)).toBe(true);
      };
      scenario.native.addEventListener("end", listener);
      cleanup.add("listener", () =>
        scenario.native.removeEventListener("end", listener),
      );
      gamepadPolling.publishFrame([3]);
      if (action === "throw") {
        expect(() => scenario.wrapper.dispose()).toThrow("end failure");
        scenario.wrapper.dispose();
        expect(Object.hasOwn(scenario.native, "update")).toBe(false);
        scenario.native.update(0.1);
      } else {
        scenario.update();
      }
      expect(scenario.camera.quaternion.angleTo(before)).toBeGreaterThan(0.01);
      expect(scenario.types().filter((type) => type === "end")).toHaveLength(1);
    },
  );

  interactionTest.for([false, true])(
    `${kind} preserves autoRotate=%s and speed changes inside change callbacks`,
    (value, { cleanup, gamepadPolling }) => {
      const scenario = createOrbitScenario(kind, cleanup);
      scenario.native.autoRotate = true;
      const descriptor = Object.getOwnPropertyDescriptor(
        scenario.native,
        "autoRotate",
      );
      const listener = () => {
        expect(scenario.native.autoRotate).toBe(true);
        scenario.native.autoRotate = value;
        scenario.native.autoRotateSpeed = 5;
        scenario.native.removeEventListener("change", listener);
      };
      scenario.native.addEventListener("change", listener);
      cleanup.add("listener", () =>
        scenario.native.removeEventListener("change", listener),
      );
      gamepadPolling.publishFrame([3, orbitActionInput(kind)]);
      scenario.wrapper.update(0.1);
      const after = scenario.camera.quaternion.clone();
      scenario.native.update(0.1);
      expect(scenario.camera.quaternion.angleTo(after)).toBeLessThan(1e-7);
      expect(scenario.native.autoRotate).toBe(value);
      expect(scenario.native.autoRotateSpeed).toBe(5);
      expect(
        Object.getOwnPropertyDescriptor(scenario.native, "autoRotate"),
      ).toEqual({
        ...descriptor,
        value,
      });
      gamepadPolling.publishFrame([3]);
      scenario.update();
      expect(scenario.camera.quaternion.angleTo(after)).toBeCloseTo(
        value ? ((Math.PI * 2) / 60) * 5 * 0.1 : 0,
        7,
      );
    },
  );

  for (const projection of ["perspective", "orthographic"] as const) {
    interactionTest.for([false, true])(
      `${kind} ${projection} preserves pointer gating with screenSpacePanning=%s`,
      (screenSpacePanning, { cleanup, gamepadPolling }) => {
        const actual = createOrbitScenario(kind, cleanup, 0, projection);
        const reference = createOrbitScenario(kind, cleanup, 3, projection);
        for (const scenario of [actual, reference]) {
          scenario.camera.position.set(0, 10, 10);
          scenario.native.update();
          scenario.events.length = 0;
          scenario.native.autoRotate = true;
          scenario.native.screenSpacePanning = screenSpacePanning;
          vi.spyOn(scenario.element, "setPointerCapture").mockImplementation(
            () => {},
          );
          vi.spyOn(
            scenario.element,
            "releasePointerCapture",
          ).mockImplementation(() => {});
          scenario.element.dispatchEvent(
            new PointerEvent("pointerdown", {
              pointerId: 1,
              pointerType: "mouse",
              button: 0,
              clientX: 200,
              clientY: 200,
              bubbles: true,
            }),
          );
        }
        cleanup.add("listener", () =>
          document.dispatchEvent(
            new PointerEvent("pointerup", {
              pointerId: 1,
              pointerType: "mouse",
              button: 0,
            }),
          ),
        );
        const input = orbitActionInput(kind);
        gamepadPolling.publishFrame([0, input], [3, input]);
        actual.update();
        reference.update();
        expectOrbitDestination(actual, reference);
        document.dispatchEvent(
          new PointerEvent("pointermove", {
            pointerId: 1,
            pointerType: "mouse",
            button: 0,
            clientX: 240,
            clientY: 220,
          }),
        );
        expectOrbitDestination(actual, reference);
        gamepadPolling.publishFrame([0], [3]);
        actual.update();
        reference.update();
        const held = actual.camera.quaternion.clone();
        const heldAzimuth = actual.native.getAzimuthalAngle();
        actual.native.update(0.1);
        reference.native.update(0.1);
        expect(actual.camera.quaternion.angleTo(held)).toBeLessThan(1e-7);
        expectOrbitDestination(actual, reference);
        document.dispatchEvent(
          new PointerEvent("pointerup", {
            pointerId: 1,
            pointerType: "mouse",
            button: 0,
          }),
        );
        actual.update();
        reference.update();
        expectOrbitDestination(actual, reference);
        expect(
          Math.abs(actual.native.getAzimuthalAngle() - heldAzimuth),
        ).toBeGreaterThan(0.01);
      },
    );
  }
}

interactionTest.for([false, true])(
  "Orbit/Map isolate autoRotate in slots 0/3 with reversed order %s",
  (reverse, { cleanup, gamepadPolling }) => {
    const actual = [
      createOrbitScenario("orbit", cleanup, 0),
      createOrbitScenario("map", cleanup, 3),
    ];
    const reference = [
      createOrbitScenario("orbit", cleanup, 0),
      createOrbitScenario("map", cleanup, 3),
    ];
    for (const scenario of actual) {
      scenario.native.autoRotate = true;
    }
    const order = reverse ? [1, 0] : [0, 1];
    for (const active of [
      [true, false],
      [false, true],
      [true, true],
      [false, false],
    ]) {
      gamepadPolling.publishFrame(
        [0, active[0] ? orbitActionInput("orbit") : {}],
        [3, active[1] ? orbitActionInput("map", "pan") : {}],
      );
      for (const index of order) {
        reference[index].native.autoRotate = !active[index];
        actual[index].wrapper.update(0.1);
        reference[index].wrapper.update(0.1);
      }
      for (const index of order) {
        actual[index].native.update(0.1);
        reference[index].native.update(0.1);
        expectOrbitDestination(actual[index], reference[index]);
      }
    }
    actual[0].wrapper.dispose();
    reference[0].wrapper.dispose();
    reference[0].native.autoRotate = true;
    gamepadPolling.publishFrame([0], [3, orbitActionInput("map", "pan")]);
    reference[1].native.autoRotate = false;
    for (const index of order) {
      actual[index].update();
      reference[index].update();
      expectOrbitDestination(actual[index], reference[index]);
    }
  },
);

interactionTest.for([false, true])(
  "Orbit restores inherited/owned native adapters, own descriptors: %s",
  (own, { cleanup, gamepadPolling }) => {
    let updateDescriptor: PropertyDescriptor | undefined;
    let angleDescriptor: PropertyDescriptor | undefined;
    const originalAngle = (OrbitControls.prototype as OrbitNative)
      ._getAutoRotationAngle;
    let retainedAngle = originalAngle;
    const scenario = createOrbitScenario(
      "orbit",
      cleanup,
      3,
      "perspective",
      {},
      (native) => {
        native.autoRotate = true;
        if (own) {
          const originalUpdate = native.update;
          Object.defineProperty(native, "update", {
            configurable: true,
            enumerable: false,
            writable: true,
            value: function (this: OrbitControls, delta?: number | null) {
              return originalUpdate.call(this, delta);
            },
          });
          Object.defineProperty(native, "_getAutoRotationAngle", {
            configurable: true,
            enumerable: true,
            writable: true,
            value: originalAngle,
          });
        }
        updateDescriptor = Object.getOwnPropertyDescriptor(native, "update");
        angleDescriptor = Object.getOwnPropertyDescriptor(
          native,
          "_getAutoRotationAngle",
        );
      },
    );
    const native = scenario.native as OrbitNative;
    const listener = () => {
      retainedAngle = native._getAutoRotationAngle;
      expect(retainedAngle.call(native, 0.1)).toBe(0);
    };
    native.addEventListener("change", listener);
    cleanup.add("listener", () =>
      native.removeEventListener("change", listener),
    );
    gamepadPolling.publishFrame([3, { axes: [0.4, 0, 0, 0] }]);
    scenario.wrapper.update(0.1);
    native.removeEventListener("change", listener);
    expect(
      Object.getOwnPropertyDescriptor(native, "_getAutoRotationAngle"),
    ).toEqual(angleDescriptor);
    expect(retainedAngle.call(native, 0.1)).toBeCloseTo(
      originalAngle.call(native, 0.1),
    );
    const retainedUpdate = native.update;
    expect(native.update(0.1)).toBe(false);
    scenario.wrapper.dispose();
    expect(Object.getOwnPropertyDescriptor(native, "update")).toEqual(
      updateDescriptor,
    );
    expect(retainedUpdate(0.1)).toBe(true);
    const polls = gamepadPolling.getGamepads.mock.calls.length;
    scenario.wrapper.enabled = true;
    scenario.wrapper.update(0.1);
    expect(gamepadPolling.getGamepads).toHaveBeenCalledTimes(polls);
  },
);

interactionTest(
  "Orbit preserves a later native update replacement on disposal",
  ({ cleanup, gamepadPolling }) => {
    const scenario = createOrbitScenario("orbit", cleanup);
    scenario.native.autoRotate = true;
    gamepadPolling.publishFrame([3, orbitActionInput("orbit")]);
    scenario.wrapper.update(0.1);
    const replacement = vi.fn(scenario.native.update);
    scenario.native.update = replacement;
    scenario.wrapper.dispose();
    expect(scenario.native.update).toBe(replacement);
    expect(scenario.native.update(0.1)).toBe(true);
    expect(replacement).toHaveBeenCalledExactlyOnceWith(0.1);
  },
);

interactionTest.for([
  "replace",
  "delete",
  "configurable",
  "enumerable",
  "writable",
] as const)(
  "Orbit preserves a later automatic-angle descriptor change: %s",
  (change, { cleanup, gamepadPolling }) => {
    const scenario = createOrbitScenario("orbit", cleanup);
    const native = scenario.native as OrbitNative;
    native.autoRotate = true;
    const original = native._getAutoRotationAngle;
    let retained = original;
    let expected: PropertyDescriptor | undefined;
    const listener = () => {
      native.removeEventListener("change", listener);
      retained = native._getAutoRotationAngle;
      if (change === "delete") {
        Reflect.deleteProperty(native, "_getAutoRotationAngle");
      } else if (change === "replace") {
        native._getAutoRotationAngle = original;
      } else {
        Object.defineProperty(native, "_getAutoRotationAngle", {
          [change]: change === "enumerable",
        });
      }
      expected = Object.getOwnPropertyDescriptor(
        native,
        "_getAutoRotationAngle",
      );
    };
    native.addEventListener("change", listener);
    cleanup.add("listener", () =>
      native.removeEventListener("change", listener),
    );
    gamepadPolling.publishFrame([3, { axes: [0.4, 0, 0, 0] }]);
    scenario.wrapper.update(0.1);
    expect(
      Object.getOwnPropertyDescriptor(native, "_getAutoRotationAngle"),
    ).toEqual(expected);
    expect(retained.call(native, 0.1)).toBeCloseTo(original.call(native, 0.1));
    const before = scenario.camera.quaternion.clone();
    gamepadPolling.publishFrame([3]);
    scenario.update();
    expect(scenario.camera.quaternion.angleTo(before)).toBeGreaterThan(0.01);
  },
);

interactionTest(
  "Orbit revalidates a pause during the native autoRotate getter",
  ({ cleanup, gamepadPolling }) => {
    const scenario = createOrbitScenario("orbit", cleanup);
    Object.defineProperty(scenario.native, "autoRotate", {
      configurable: true,
      get: () => {
        scenario.wrapper.enabled = false;
        return true;
      },
    });
    gamepadPolling.publishFrame([3, { axes: [0.4, 0, 0, 0] }]);
    scenario.wrapper.update(0.1);
    expect(scenario.native.getAzimuthalAngle()).toBeCloseTo(
      -0.4 * 0.1 * Math.PI -
        ((Math.PI * 2) / 60 / 60) * scenario.native.autoRotateSpeed,
      10,
    );
    expect(scenario.types()).toEqual(["start", "change"]);
    expect(Object.hasOwn(scenario.native, "_getAutoRotationAngle")).toBe(false);
  },
);

interactionTest(
  "Orbit preserves a nonconfigurable autoRotate setting",
  ({ cleanup, gamepadPolling }) => {
    const scenario = createOrbitScenario(
      "orbit",
      cleanup,
      3,
      "perspective",
      {},
      (native) => {
        Object.defineProperty(native, "autoRotate", {
          configurable: false,
          enumerable: true,
          writable: false,
          value: true,
        });
      },
    );
    const descriptor = Object.getOwnPropertyDescriptor(
      scenario.native,
      "autoRotate",
    );
    gamepadPolling.publishFrame([3, orbitActionInput("orbit")]);
    scenario.wrapper.update(0.1);
    const after = scenario.camera.quaternion.clone();
    expect(scenario.native.update(0.1)).toBe(false);
    expect(scenario.camera.quaternion.angleTo(after)).toBeLessThan(1e-7);
    scenario.wrapper.dispose();
    expect(scenario.native.update(0.1)).toBe(true);
    expect(
      Object.getOwnPropertyDescriptor(scenario.native, "autoRotate"),
    ).toEqual(descriptor);
  },
);

interactionTest.for(["start", "internal change", "external change"] as const)(
  "Orbit clears autoRotate suppression after a throwing %s listener",
  (stage, { cleanup, gamepadPolling }) => {
    const scenario = createOrbitScenario("orbit", cleanup);
    scenario.native.autoRotate = true;
    scenario.native.enableDamping = stage === "external change";
    scenario.native.dampingFactor = 0.2;
    const event = stage === "start" ? "start" : "change";
    const fail = () => {
      throw new Error("listener failure");
    };
    cleanup.add("listener", () =>
      scenario.native.removeEventListener(event, fail),
    );
    gamepadPolling.publishFrame([3, orbitActionInput("orbit")]);
    if (stage === "external change") {
      scenario.wrapper.update(0.1);
      scenario.native.addEventListener(event, fail);
      expect(() => scenario.native.update(0.1)).toThrow("listener failure");
    } else {
      scenario.native.addEventListener(event, fail);
      expect(() => scenario.wrapper.update(0.1)).toThrow("listener failure");
    }
    scenario.native.removeEventListener(event, fail);
    expect(Object.hasOwn(scenario.native, "_getAutoRotationAngle")).toBe(false);
    const before = scenario.camera.quaternion.clone();
    expect(scenario.native.update(0.1)).toBe(true);
    expect(scenario.camera.quaternion.angleTo(before)).toBeGreaterThan(1e-5);
    gamepadPolling.publishFrame([3]);
    scenario.update();
    expect(scenario.types().filter((type) => type === "end")).toHaveLength(1);
  },
);

for (const stage of [
  "pipeline",
  "start",
  "change",
  "between updates",
] as const) {
  interactionTest.for(["gamepad", "camera"] as const)(
    `Orbit invalidates autoRotate intent when the %s changes during ${stage}`,
    (destination, { cleanup, gamepadPolling }) => {
      let scenario: OrbitScenario;
      const invalidate = () => {
        if (destination === "gamepad") {
          scenario.wrapper.gamepad = createGamepad(3);
        } else {
          scenario.native.object = scenario.camera.clone();
        }
      };
      scenario = createOrbitScenario("orbit", cleanup, 3, "perspective", {
        rotateStick:
          stage === "pipeline"
            ? {
                pipeline: gamepadStickPipeline().transform((value) => {
                  invalidate();
                  return value;
                }),
              }
            : {},
      });
      scenario.native.autoRotate = true;
      if (stage === "start" || stage === "change") {
        const listener = () => {
          scenario.native.removeEventListener(stage, listener);
          invalidate();
        };
        scenario.native.addEventListener(stage, listener);
        cleanup.add("listener", () =>
          scenario.native.removeEventListener(stage, listener),
        );
      }
      gamepadPolling.publishFrame([3, orbitActionInput("orbit")]);
      scenario.wrapper.update(0.1);
      if (stage === "between updates") {
        invalidate();
      }
      const before = scenario.native.object.quaternion.clone();
      scenario.native.update(0.1);
      expect(scenario.native.object.quaternion.angleTo(before)).toBeGreaterThan(
        0.01,
      );
      expect(scenario.types().filter((type) => type === "start")).toHaveLength(
        stage === "pipeline" ? 0 : 1,
      );
    },
  );
}

for (const kind of ["orbit", "map"] as const) {
  interactionTest.for(["pause", "event loss", "poll loss"] as const)(
    `${kind} rearms autoRotate suppression after %s`,
    (transition, { cleanup, gamepadPolling }) => {
      const actual = createOrbitScenario(kind, cleanup, 0);
      const reference = createOrbitScenario(kind, cleanup, 3);
      actual.native.autoRotate = true;
      const input = orbitActionInput(kind);
      gamepadPolling.publishFrame([0, input], [3, input]);
      actual.update();
      reference.update();
      expectOrbitDestination(actual, reference);
      reference.native.autoRotate = true;
      if (transition === "pause") {
        actual.wrapper.enabled = reference.wrapper.enabled = false;
        actual.wrapper.update(0.1);
        reference.wrapper.update(0.1);
      } else if (transition === "event loss") {
        for (const scenario of [actual, reference]) {
          dispatchGamepadEvent(
            "gamepaddisconnected",
            scenario.wrapper.gamepad as Gamepad,
          );
        }
      } else {
        gamepadPolling.publishFrame();
        actual.wrapper.update(0.1);
        reference.wrapper.update(0.1);
      }
      actual.native.update(0.1);
      reference.native.update(0.1);
      expectOrbitDestination(actual, reference);
      actual.wrapper.enabled = reference.wrapper.enabled = true;
      if (transition !== "pause") {
        gamepadPolling.publishFrame([0], [3]);
        actual.update();
        reference.update();
        expectOrbitDestination(actual, reference);
      }
      reference.native.autoRotate = false;
      gamepadPolling.publishFrame([0, input], [3, input]);
      actual.update();
      reference.update();
      expectOrbitDestination(actual, reference);
      expect(actual.types().filter((type) => type === "start")).toHaveLength(
        transition === "pause" ? 1 : 2,
      );
      expect(actual.types().filter((type) => type === "end")).toHaveLength(
        transition === "pause" ? 0 : 1,
      );
    },
  );

  interactionTest(
    `${kind} retains autoRotate suppression for other actions after a change callback`,
    ({ cleanup, gamepadPolling }) => {
      const actual = createOrbitScenario(kind, cleanup, 0);
      const reference = createOrbitScenario(kind, cleanup, 3);
      actual.native.autoRotate = true;
      for (const scenario of [actual, reference]) {
        const listener = () => {
          scenario.native.enableRotate = false;
        };
        scenario.native.addEventListener("change", listener);
        cleanup.add("listener", () =>
          scenario.native.removeEventListener("change", listener),
        );
      }
      const input = {
        axes: [0.4, 0.2, 0.3, 0.2],
        buttons: createGamepadButtons([7, false, 0.4]),
      };
      gamepadPolling.publishFrame([0, input], [3, input]);
      actual.update();
      reference.update();
      expectOrbitDestination(actual, reference);
      expect(actual.native.target.length()).toBeGreaterThan(0.1);
      expect(
        actual.camera.position.distanceTo(actual.native.target),
      ).toBeLessThan(10);
      for (const scenario of [actual, reference]) {
        scenario.native.panSpeed = scenario.native.zoomSpeed = 0;
      }
      reference.native.autoRotate = true;
      actual.native.update(0.1);
      reference.native.update(0.1);
      expectOrbitDestination(actual, reference);
    },
  );

  interactionTest(
    `${kind} respects autoRotate and speed assignments between wrapper and native updates`,
    ({ cleanup, gamepadPolling }) => {
      const actual = createOrbitScenario(kind, cleanup, 0);
      const reference = createOrbitScenario(kind, cleanup, 3);
      actual.native.autoRotate = true;
      const input = orbitActionInput(kind);
      gamepadPolling.publishFrame([0, input], [3, input]);
      actual.wrapper.update(0.1);
      reference.wrapper.update(0.1);
      for (const value of [false, true, false, true]) {
        actual.native.autoRotate = value;
        actual.native.autoRotateSpeed = reference.native.autoRotateSpeed = 5;
        actual.native.update(0.1);
        reference.native.update(0.1);
        expectOrbitDestination(actual, reference);
        expect(actual.native.autoRotate).toBe(value);
      }
      actual.native.autoRotate = false;
      gamepadPolling.publishFrame([0], [3]);
      actual.update();
      reference.update();
      expectOrbitDestination(actual, reference);
      const before = actual.native.getAzimuthalAngle();
      actual.native.autoRotate = reference.native.autoRotate = true;
      actual.native.update(0.1);
      reference.native.update(0.1);
      expectOrbitDestination(actual, reference);
      expect(before - actual.native.getAzimuthalAngle()).toBeCloseTo(
        ((Math.PI * 2) / 60) * 5 * 0.1,
        10,
      );
    },
  );
}

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
  if (scenario.native instanceof TrackballControls) {
    scenario.native.noRotate = true;
  } else {
    (scenario.native as OrbitControls | ArcballControls).enableRotate = false;
  }
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
      if (reason === "poll") {
        gamepadPolling.publishFrame();
      }
      if (reason === "disable") {
        scenario.native.enabled = false;
      }
      if (reason === "forbid") {
        forbidRotation(scenario);
      }
      if (reason === "zero") {
        (
          scenario.native as OrbitControls | TrackballControls | ArcballControls
        ).rotateSpeed = 0;
      }
      if (reason === "dispose") {
        scenario.wrapper.dispose();
      }
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
        if (action === "disable") {
          scenario.native.enabled = false;
        }
        if (action === "forbid") {
          forbidRotation(scenario);
        }
        if (action === "zero") {
          (
            scenario.native as
              | OrbitControls
              | TrackballControls
              | ArcballControls
          ).rotateSpeed = 0;
        }
        if (action === "pause") {
          scenario.wrapper.enabled = false;
        }
        if (action === "dispose") {
          scenario.wrapper.dispose();
        }
        if (action === "disconnect") {
          dispatchGamepadEvent(
            "gamepaddisconnected",
            scenario.wrapper.gamepad as Gamepad,
          );
        }
        if (action === "reenter") {
          scenario.wrapper.update(0.1);
        }
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
    } else {
      (scenario.native as TrackballControls).staticMoving = false;
    }
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
    if (caseName === "zeroNative") {
      native.pointerSpeed = 0;
    }
    if (caseName === "translation") {
      axes = [0.5, -0.5, 0, 0];
    }
    if (caseName === "tiny") {
      axes = [0, 0, 0.5, 0];
    }
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
      if (loss === "event") {
        dispatchGamepadEvent(
          "gamepaddisconnected",
          scenario.wrapper.gamepad as Gamepad,
        );
      }
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
    for (const child of [...environment.scene.children]) {
      if (child !== environment.mesh) {
        cleanup.add("resource", () => disposeObjectResources(child));
      }
    }
    const wrapper = new GamepadArcballControls(native, {
      gamepadIndex: 3,
      [property]: 0,
    });
    cleanup.add("wrapper", () => wrapper.dispose());
    const types: string[] = [];
    for (const type of ["start", "change", "end"] as const) {
      native.addEventListener(type, () => types.push(type));
    }
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
