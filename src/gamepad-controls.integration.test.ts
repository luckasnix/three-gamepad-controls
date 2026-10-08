import {
  type Controls,
  EventDispatcher,
  Group,
  MathUtils,
  type Object3D,
  PerspectiveCamera,
  Plane,
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

const createFirstPersonMovementScenario = (
  cleanup: Cleanup,
  {
    lat,
    lon,
    roll = 0,
    height = 0,
  }: {
    lat: number;
    lon: number;
    roll?: number;
    height?: number;
  },
) => {
  const environment = createThreeEnvironment(cleanup);
  const { camera, element } = environment;
  camera.position.y = height;
  camera.lookAt(
    new Vector3()
      .setFromSphericalCoords(
        1,
        MathUtils.degToRad(90 - lat),
        MathUtils.degToRad(lon),
      )
      .add(camera.position),
  );
  camera.rotateZ(MathUtils.degToRad(roll));
  const controls = new FirstPersonControls(camera, element);
  cleanup.add("native", () => controls.dispose());
  controls.movementSpeed = 4;
  controls.dampingFactor = 1;
  controls.autoForward = false;
  environment.syncMatrices();
  return {
    ...environment,
    controls,
  };
};

// Read the native reference before constructing the gamepad control, because
// FirstPersonControls subscribes to keyboard events on the shared window.
const readFirstPersonKeyboardMovement = (
  controls: FirstPersonControls,
  code: string | readonly string[],
): Vector3 => {
  const position = controls.object.position.clone();
  const codes = typeof code === "string" ? [code] : code;
  for (const code of codes) {
    window.dispatchEvent(new KeyboardEvent("keydown", { code }));
  }
  try {
    controls.update(0.25);
  } finally {
    for (const code of codes) {
      window.dispatchEvent(new KeyboardEvent("keyup", { code }));
    }
  }
  const displacement = controls.object.position.clone().sub(position);
  controls.dispose();
  return displacement;
};

describe("FirstPerson movement frame", () => {
  const actions = [
    {
      name: "forward",
      code: "KeyW",
      input: (strength: number) => ({ axes: [0, -strength, 0, 0] }),
    },
    {
      name: "backward",
      code: "KeyS",
      input: (strength: number) => ({ axes: [0, strength, 0, 0] }),
    },
    {
      name: "left",
      code: "KeyA",
      input: (strength: number) => ({ axes: [-strength, 0, 0, 0] }),
    },
    {
      name: "right",
      code: "KeyD",
      input: (strength: number) => ({ axes: [strength, 0, 0, 0] }),
    },
    {
      name: "up",
      code: "KeyR",
      input: (strength: number) => ({
        buttons: createGamepadButtons([6, false, strength]),
      }),
    },
    {
      name: "down",
      code: "KeyF",
      input: (strength: number) => ({
        buttons: createGamepadButtons([7, false, strength]),
      }),
    },
  ];
  const orientations = [
    { lat: 45, lon: 180, roll: 0 },
    { lat: -45, lon: 90, roll: 30 },
    { lat: 85, lon: 225, roll: 0 },
    { lat: -85, lon: -45, roll: -30 },
  ];
  const cases = orientations.flatMap((orientation) =>
    actions.map((action) => ({ ...orientation, ...action })),
  );

  integrationTest.for(cases)(
    "FirstPerson $name at pitch $lat, yaw $lon and roll $roll matches keyboard movement",
    ({ lat, lon, roll, code, input }, { cleanup, gamepadPolling }) => {
      const reference = createFirstPersonMovementScenario(cleanup, {
        lat,
        lon,
        roll,
      });
      const keyboardMovement = readFirstPersonKeyboardMovement(
        reference.controls,
        code,
      );
      const actual = createFirstPersonMovementScenario(cleanup, {
        lat,
        lon,
        roll,
      });
      const initialQuaternion = actual.camera.quaternion.clone();
      const wrapper = new GamepadFirstPersonControls(actual.controls);
      cleanup.add("wrapper", () => wrapper.dispose());
      const frame = createFrameDriver(
        gamepadPolling,
        actual.syncMatrices,
        wrapper,
        (dt) => actual.controls.update(dt),
      );
      frame([[0]], 0.25);
      for (const strength of [0.25, 0.5, 1]) {
        // The native neutral update removes roll; restore the initial pose
        // before movement to prove that roll cannot tilt the gamepad axes.
        actual.camera.quaternion.copy(initialQuaternion);
        const position = actual.camera.position.clone();
        frame([[0, input(strength)]], 0.25);
        expect(
          actual.camera.position
            .clone()
            .sub(position)
            .distanceTo(keyboardMovement.clone().multiplyScalar(strength)),
        ).toBeLessThan(1e-8);
        expect(
          actual.camera.quaternion.angleTo(reference.camera.quaternion),
        ).toBeLessThan(1e-7);
      }
      const final = pose(actual.camera);
      frame([[0]], 0.25);
      expectPose(actual.camera, final);
    },
  );

  const combinedActions = [
    {
      name: "forward and right",
      codes: ["KeyW", "KeyD"],
      x: 1,
      y: -1,
      climb: 0,
    },
    { name: "forward and up", codes: ["KeyW", "KeyR"], x: 0, y: -1, climb: 1 },
    {
      name: "forward, right and up",
      codes: ["KeyW", "KeyD", "KeyR"],
      x: 1,
      y: -1,
      climb: 1,
    },
    {
      name: "backward, left and down",
      codes: ["KeyS", "KeyA", "KeyF"],
      x: -1,
      y: 1,
      climb: -1,
    },
  ];
  integrationTest.for(
    orientations.flatMap((orientation) =>
      combinedActions.map((action) => ({ ...orientation, ...action })),
    ),
  )(
    "FirstPerson combined $name at pitch $lat, yaw $lon and roll $roll matches normalized keyboard movement",
    ({ lat, lon, roll, codes, x, y, climb }, { cleanup, gamepadPolling }) => {
      const reference = createFirstPersonMovementScenario(cleanup, {
        lat,
        lon,
        roll,
      });
      const keyboardMovement = readFirstPersonKeyboardMovement(
        reference.controls,
        codes,
      );
      const actual = createFirstPersonMovementScenario(cleanup, {
        lat,
        lon,
        roll,
      });
      const initialQuaternion = actual.camera.quaternion.clone();
      const wrapper = new GamepadFirstPersonControls(actual.controls);
      cleanup.add("wrapper", () => wrapper.dispose());
      const frame = createFrameDriver(
        gamepadPolling,
        actual.syncMatrices,
        wrapper,
        (dt) => actual.controls.update(dt),
      );
      frame([[0]], 0.25);
      actual.camera.quaternion.copy(initialQuaternion);
      const position = actual.camera.position.clone();
      frame(
        [
          [
            0,
            {
              axes: [x, y, 0, 0],
              buttons: createGamepadButtons(
                [6, false, Math.max(climb, 0)],
                [7, false, Math.max(-climb, 0)],
              ),
            },
          ],
        ],
        0.25,
      );
      expect(
        actual.camera.position
          .clone()
          .sub(position)
          .distanceTo(keyboardMovement),
      ).toBeLessThan(1e-8);
      expect(
        actual.camera.quaternion.angleTo(reference.camera.quaternion),
      ).toBeLessThan(1e-7);
      const final = pose(actual.camera);
      frame([[0]], 0.25);
      expectPose(actual.camera, final);
    },
  );

  integrationTest(
    "FirstPerson normalizes only gamepad movement and keeps native keyboard input additive",
    ({ cleanup, gamepadPolling }) => {
      const orientation = { lat: 45, lon: 135 };
      const keyboardReference = createFirstPersonMovementScenario(
        cleanup,
        orientation,
      );
      const keyboardMovement = readFirstPersonKeyboardMovement(
        keyboardReference.controls,
        "KeyW",
      );
      const gamepadReference = createFirstPersonMovementScenario(
        cleanup,
        orientation,
      );
      const gamepadMovement = readFirstPersonKeyboardMovement(
        gamepadReference.controls,
        ["KeyW", "KeyD", "KeyR"],
      );
      const actual = createFirstPersonMovementScenario(cleanup, orientation);
      const wrapper = new GamepadFirstPersonControls(actual.controls, {
        moveSpeed: 2,
      });
      cleanup.add("wrapper", () => wrapper.dispose());
      const frame = createFrameDriver(
        gamepadPolling,
        actual.syncMatrices,
        wrapper,
        (dt) => actual.controls.update(dt),
      );
      frame([[0]], 0.25);
      const expectedPosition = actual.camera.position
        .clone()
        .add(gamepadMovement.multiplyScalar(2))
        .add(keyboardMovement);
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
      try {
        frame(
          [
            [
              0,
              {
                axes: [1, -1, 0, 0],
                buttons: createGamepadButtons([6, false, 1]),
              },
            ],
          ],
          0.25,
        );
        expect(
          actual.camera.position.distanceTo(expectedPosition),
        ).toBeLessThan(1e-8);
        for (const state of ["neutral", "pause", "dispose"] as const) {
          if (state === "pause") {
            wrapper.enabled = false;
          } else if (state === "dispose") {
            wrapper.dispose();
          }
          frame([[0]], 0.25);
          expectedPosition.add(keyboardMovement);
          expect(
            actual.camera.position.distanceTo(expectedPosition),
          ).toBeLessThan(1e-8);
        }
      } finally {
        window.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
      }
      const final = pose(actual.camera);
      frame([[0]], 0.25);
      expectPose(actual.camera, final);
    },
  );

  integrationTest.for([false, true])(
    "FirstPerson isolates normalized movement and lifecycle with reversed update order %s",
    (reverse, { cleanup, gamepadPolling }) => {
      const a = createFirstPersonMovementScenario(cleanup, {
        lat: 45,
        lon: 180,
      });
      const b = createFirstPersonMovementScenario(cleanup, {
        lat: -45,
        lon: 180,
      });
      const wrapperA = new GamepadFirstPersonControls(a.controls, {
        gamepadIndex: 0,
      });
      cleanup.add("wrapper", () => wrapperA.dispose());
      const wrapperB = new GamepadFirstPersonControls(b.controls, {
        gamepadIndex: 3,
        moveSpeed: 2,
      });
      cleanup.add("wrapper", () => wrapperB.dispose());
      const order = reverse
        ? ([
            [b, wrapperB],
            [a, wrapperA],
          ] as const)
        : ([
            [a, wrapperA],
            [b, wrapperB],
          ] as const);
      const frame = (
        inputA: GamepadFixtureOptions = {},
        inputB: GamepadFixtureOptions = {},
      ): void => {
        gamepadPolling.publishFrame([0, inputA], [3, inputB]);
        a.syncMatrices();
        b.syncMatrices();
        for (const [scenario, wrapper] of order) {
          wrapper.update(0.25);
          scenario.controls.update(0.25);
          scenario.syncMatrices();
        }
      };
      frame();
      const inputA = {
        axes: [1, -1, 0, 0],
        buttons: createGamepadButtons([6, false, 1]),
      };
      const inputB = {
        axes: [-1, 1, 0, 0],
        buttons: createGamepadButtons([7, false, 1]),
      };
      const displacementA = new Vector3(1, 1, -1).multiplyScalar(
        1 / Math.sqrt(3),
      );
      const displacementB = new Vector3(-1, -1, 1).multiplyScalar(
        2 / Math.sqrt(3),
      );
      const expectedA = a.camera.position.clone().add(displacementA);
      const expectedB = b.camera.position.clone().add(displacementB);
      frame(inputA, inputB);
      expect(a.camera.position.distanceTo(expectedA)).toBeLessThan(1e-8);
      expect(b.camera.position.distanceTo(expectedB)).toBeLessThan(1e-8);
      for (const state of [
        "pause",
        "native disabled",
        "loss",
        "dispose",
      ] as const) {
        if (state === "pause") {
          wrapperA.enabled = false;
        } else if (state === "native disabled") {
          wrapperA.enabled = true;
          a.controls.enabled = false;
        } else if (state === "loss") {
          a.controls.enabled = true;
        } else {
          wrapperA.dispose();
        }
        frame(state === "loss" ? { connected: false } : inputA, inputB);
        expectedB.add(displacementB);
        expect(a.camera.position.distanceTo(expectedA)).toBeLessThan(1e-8);
        expect(b.camera.position.distanceTo(expectedB)).toBeLessThan(1e-8);
      }
    },
  );

  integrationTest.for([-1, 3, 7])(
    "FirstPerson uses the initial clamped height %i for forward speed before climbing",
    (height, { cleanup, gamepadPolling }) => {
      const createScenario = () => {
        const scenario = createFirstPersonMovementScenario(cleanup, {
          lat: 45,
          lon: 135,
          height,
        });
        scenario.controls.heightSpeed = true;
        scenario.controls.heightMin = 1;
        scenario.controls.heightMax = 5;
        scenario.controls.heightCoef = 3;
        return scenario;
      };
      const reference = createScenario();
      const keyboardMovement = readFirstPersonKeyboardMovement(
        reference.controls,
        "KeyW",
      );
      const actual = createScenario();
      const position = actual.camera.position.clone();
      const wrapper = new GamepadFirstPersonControls(actual.controls, {
        moveSpeed: 2,
      });
      cleanup.add("wrapper", () => wrapper.dispose());
      const frame = createFrameDriver(
        gamepadPolling,
        actual.syncMatrices,
        wrapper,
        (dt) => actual.controls.update(dt),
      );
      frame([[0]], 0.25);
      frame(
        [
          [
            0,
            {
              axes: [0, -0.5, 0, 0],
              buttons: createGamepadButtons([6, false, 1]),
            },
          ],
        ],
        0.25,
      );
      expect(
        actual.camera.position
          .clone()
          .sub(position)
          .distanceTo(
            keyboardMovement
              .add(new Vector3(0, 2, 0))
              .multiplyScalar(1 / Math.sqrt(1.25)),
          ),
      ).toBeLessThan(1e-8);
    },
  );

  integrationTest(
    "FirstPerson movement uses the yaw before look input across frames and then stops",
    ({ cleanup, gamepadPolling }) => {
      const actual = createFirstPersonMovementScenario(cleanup, {
        lat: 45,
        lon: 180,
      });
      const wrapper = new GamepadFirstPersonControls(actual.controls);
      cleanup.add("wrapper", () => wrapper.dispose());
      const frame = createFrameDriver(
        gamepadPolling,
        actual.syncMatrices,
        wrapper,
        (dt) => actual.controls.update(dt),
      );
      frame([[0]], 0.1);
      for (let index = 0; index < 3; index += 1) {
        const expectedPosition = actual.camera
          .getWorldDirection(new Vector3())
          .setY(0)
          .normalize()
          .multiplyScalar(0.2)
          .add(actual.camera.position);
        const quaternion = actual.camera.quaternion.clone();
        frame([[0, { axes: [0, -0.5, 0.5, 0.25] }]], 0.1);
        expect(
          actual.camera.position.distanceTo(expectedPosition),
        ).toBeLessThan(1e-8);
        expect(actual.camera.quaternion.angleTo(quaternion)).toBeGreaterThan(0);
      }
      const final = pose(actual.camera);
      frame([[0]], 0.1);
      expectPose(actual.camera, final);
    },
  );
});

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

type ProjectionOptions = {
  projection?: "perspective" | "orthographic";
  aspect?: number;
  zoom?: number;
  crop?: boolean;
  parent?: "translated" | "rotated";
  axis?: TransformControls["axis"];
  index?: number;
};

const createProjectionScenario = (
  kind: "drag" | "transform",
  cleanup: Cleanup,
  polling: GamepadPollingFixture,
  options: ProjectionOptions = {},
) => {
  const environment = createThreeEnvironment(cleanup, options.projection);
  const { camera, mesh, scene, element } = environment;
  const aspect = options.aspect ?? 16 / 9;
  if (camera instanceof PerspectiveCamera) {
    camera.aspect = aspect;
  } else {
    camera.left = -6 * aspect;
    camera.right = 6 * aspect;
  }
  camera.zoom = options.zoom ?? 1;
  if (options.crop) {
    // An off-center window with different horizontal and vertical crop ratios.
    camera.setViewOffset(1600, 1600 / aspect, 150, 75, 800, 600 / aspect);
  }
  camera.updateProjectionMatrix();
  const cameraParent = new Group();
  if (options.parent) {
    cameraParent.position.set(3, -2, 1);
    if (options.parent === "rotated") {
      cameraParent.rotation.set(0.2, 0.4, 0.6);
    }
    cameraParent.add(camera);
    scene.add(cameraParent);
  }
  camera.updateWorldMatrix(true, false);
  const centerRay = new Raycaster();
  centerRay.setFromCamera(new Vector2(), camera);
  const plane = new Plane().setFromNormalAndCoplanarPoint(
    camera.getWorldDirection(new Vector3()),
    new Vector3(0, 0, -10).applyMatrix4(camera.matrixWorld),
  );
  expect(centerRay.ray.intersectPlane(plane, mesh.position)).not.toBeNull();
  const origin = mesh.position.clone();
  const events: string[] = [];
  const onStart = () => events.push("start");
  const onMove = () => events.push("move");
  const onEnd = () => events.push("end");
  const index = options.index ?? 0;
  let native: DragControls | TransformControls;
  let wrapper: GamepadDragControls | GamepadTransformControls;
  if (kind === "drag") {
    const controls = new DragControls([mesh], camera, element);
    cleanup.add("native", () => controls.dispose());
    controls.addEventListener("dragstart", onStart);
    controls.addEventListener("drag", onMove);
    controls.addEventListener("dragend", onEnd);
    cleanup.add("listener", () => {
      controls.removeEventListener("dragstart", onStart);
      controls.removeEventListener("drag", onMove);
      controls.removeEventListener("dragend", onEnd);
    });
    native = controls;
    wrapper = new GamepadDragControls(controls, { gamepadIndex: index });
  } else {
    const controls = new TransformControls(camera, element);
    cleanup.add("native", () => controls.dispose());
    controls.attach(mesh);
    controls.axis = options.axis ?? "XYZ";
    const helper = controls.getHelper();
    scene.add(helper);
    cleanup.add("resource", () => helper.removeFromParent());
    controls.addEventListener("mouseDown", onStart);
    controls.addEventListener("objectChange", onMove);
    controls.addEventListener("mouseUp", onEnd);
    cleanup.add("listener", () => {
      controls.removeEventListener("mouseDown", onStart);
      controls.removeEventListener("objectChange", onMove);
      controls.removeEventListener("mouseUp", onEnd);
    });
    native = controls;
    wrapper = new GamepadTransformControls(controls, { gamepadIndex: index });
  }
  cleanup.add("wrapper", () => wrapper.dispose());
  const syncMatrices = () => {
    camera.updateWorldMatrix(true, false);
    scene.updateMatrixWorld(true);
  };
  syncMatrices();
  const frame = createFrameDriver(polling, syncMatrices, wrapper);
  const step = (input: GamepadFixtureOptions = {}, dt = 0.02) =>
    frame([[index, input]], dt);
  const projectedPosition = () =>
    mesh.getWorldPosition(new Vector3()).project(camera);
  const move = (axes: readonly number[]) => {
    const before = projectedPosition();
    step({ axes });
    return projectedPosition().sub(before);
  };
  const acquire = () => {
    step();
    if (kind === "drag") {
      step({ buttons: createGamepadButtons([0, true]) });
      expect(events).toEqual(["start"]);
    }
  };
  return {
    camera,
    cameraParent,
    mesh,
    origin,
    native,
    wrapper,
    events,
    step,
    move,
    acquire,
    projectedPosition,
    syncMatrices,
  };
};

describe("effective camera projection", () => {
  const profiles = [
    { name: "perspective square", aspect: 1 },
    { name: "perspective landscape", aspect: 16 / 9 },
    { name: "perspective portrait", aspect: 3 / 4 },
    { name: "perspective crop", aspect: 16 / 9, crop: true },
    { name: "orthographic square", projection: "orthographic", aspect: 1 },
    {
      name: "orthographic crop",
      projection: "orthographic",
      crop: true,
    },
    { name: "rotated parent", crop: true, parent: "rotated" },
    {
      name: "translated parent",
      projection: "orthographic",
      aspect: 3 / 4,
      crop: true,
      parent: "translated",
    },
  ] as const;
  const inputs = [
    { name: "horizontal", axes: [0.5, 0] },
    { name: "vertical", axes: [0, -0.5] },
    { name: "diagonal", axes: [0.4, -0.3] },
  ] as const;

  for (const kind of ["drag", "transform"] as const) {
    integrationTest(
      `${kind} refreshes a camera parent's matrices before movement`,
      ({ cleanup, gamepadPolling }) => {
        const scenario = createProjectionScenario(
          kind,
          cleanup,
          gamepadPolling,
          {
            parent: "translated",
          },
        );
        scenario.acquire();
        scenario.move([0.5, 0]);
        const before = scenario.mesh.position.clone();
        scenario.cameraParent.rotation.z = Math.PI / 2;
        // Bypass the frame driver's matrix sync to exercise wrapper refresh.
        gamepadPolling.publishFrame([0, { axes: [0.5, 0] }]);
        scenario.wrapper.update(0.02);
        const displacement = scenario.mesh.position.clone().sub(before);
        expect(displacement.x).toBeCloseTo(0, 10);
        expect(displacement.y).toBeGreaterThan(0.1);
        expect(displacement.z).toBeCloseTo(0, 10);
      },
    );

    integrationTest(
      `${kind} uses a projection changed by its start callback in the same frame`,
      ({ cleanup, gamepadPolling }) => {
        const scenario = createProjectionScenario(
          kind,
          cleanup,
          gamepadPolling,
        );
        const zoom = () => {
          scenario.camera.zoom = 2;
          scenario.camera.updateProjectionMatrix();
        };
        if (scenario.native instanceof DragControls) {
          scenario.native.addEventListener("dragstart", zoom);
          cleanup.add("listener", () =>
            (scenario.native as DragControls).removeEventListener(
              "dragstart",
              zoom,
            ),
          );
        } else {
          scenario.native.addEventListener("mouseDown", zoom);
          cleanup.add("listener", () =>
            (scenario.native as TransformControls).removeEventListener(
              "mouseDown",
              zoom,
            ),
          );
        }
        scenario.acquire();
        // Transform acquires during this move; the origin is at NDC (0, 0).
        const displacement = scenario.move([0.5, -0.5]);
        expect(displacement.x).toBeCloseTo(0.02, 10);
        expect(displacement.y).toBeCloseTo(0.02, 10);
        expect(scenario.events).toEqual(["start", "move"]);
      },
    );

    integrationTest(
      `${kind} follows projection matrices published by the application`,
      ({ cleanup, gamepadPolling }) => {
        const scenario = createProjectionScenario(
          kind,
          cleanup,
          gamepadPolling,
          {
            projection: "orthographic",
          },
        );
        scenario.acquire();
        const original = scenario.move([0.5, -0.5]);
        scenario.camera.zoom = 2;
        const unpublished = scenario.move([0.5, -0.5]);
        expect(unpublished.distanceTo(original)).toBeLessThan(1e-10);
        scenario.camera.updateProjectionMatrix();
        const published = scenario.move([0.5, -0.5]);
        expect(published.distanceTo(original)).toBeLessThan(1e-10);
        expect(scenario.events).toEqual(["start", "move", "move", "move"]);
      },
    );

    for (const profile of profiles) {
      for (const input of inputs) {
        integrationTest(
          `${kind} preserves screen speed with ${profile.name} zoom and ${input.name} input`,
          ({ cleanup, gamepadPolling }) => {
            const deltas = [1, 2].map((zoom) => {
              const scenario = createProjectionScenario(
                kind,
                cleanup,
                gamepadPolling,
                { ...profile, zoom },
              );
              scenario.acquire();
              const displacement = scenario.move(input.axes);
              expect(scenario.events).toEqual(["start", "move"]);
              expect(displacement.x).toBeCloseTo(input.axes[0] * 0.04, 10);
              expect(displacement.y).toBeCloseTo(-input.axes[1] * 0.04, 10);
              expect(displacement.z).toBeCloseTo(0, 10);
              scenario.wrapper.dispose();
              return displacement;
            });
            expect(deltas[1].distanceTo(deltas[0])).toBeLessThan(1e-10);
          },
        );
      }
    }

    integrationTest(
      `${kind} preserves screen speed away from the reticle during zoom changes`,
      ({ cleanup, gamepadPolling }) => {
        const scenario = createProjectionScenario(
          kind,
          cleanup,
          gamepadPolling,
          {
            crop: true,
            parent: "rotated",
          },
        );
        scenario.acquire();
        scenario.move([0.5, -0.5]);
        const offCenter = scenario.projectedPosition();
        expect(Math.hypot(offCenter.x, offCenter.y)).toBeGreaterThan(0.01);
        const worldBefore = scenario.mesh.getWorldPosition(new Vector3());
        const first = scenario.move([0.5, -0.25]);
        const worldDelta = scenario.mesh
          .getWorldPosition(new Vector3())
          .sub(worldBefore);
        scenario.camera.zoom = 2;
        scenario.camera.updateProjectionMatrix();
        const unchanged = scenario.mesh.position.clone();
        scenario.step({ axes: [0.5, -0.25] }, 0);
        expect(scenario.mesh.position.distanceTo(unchanged)).toBeLessThan(
          1e-10,
        );
        const secondWorldBefore = scenario.mesh.getWorldPosition(new Vector3());
        const second = scenario.move([0.5, -0.25]);
        expect(second.distanceTo(first)).toBeLessThan(1e-10);
        expect(
          scenario.mesh
            .getWorldPosition(new Vector3())
            .sub(secondWorldBefore)
            .distanceTo(worldDelta.multiplyScalar(0.5)),
        ).toBeLessThan(1e-10);
        expect(
          scenario.events.filter((event) => event === "start"),
        ).toHaveLength(1);
        expect(scenario.events).not.toContain("end");
        if (scenario.native instanceof TransformControls) {
          scenario.step(
            { axes: [0.5, -0.25], buttons: createGamepadButtons([9, true]) },
            0,
          );
          expect(
            scenario.mesh.position.distanceTo(scenario.origin),
          ).toBeLessThan(1e-10);
          expect(scenario.native.dragging).toBe(true);
          expect(
            scenario.events.filter((event) => event === "start"),
          ).toHaveLength(1);
        }
      },
    );
  }

  for (const axis of ["X", "Y", "XY"] as const) {
    for (const projection of ["perspective", "orthographic"] as const) {
      integrationTest(
        `Transform preserves ${axis} gain with ${projection} zoom and asymmetric crop`,
        ({ cleanup, gamepadPolling }) => {
          const deltas = [1, 2].map((zoom) => {
            const scenario = createProjectionScenario(
              "transform",
              cleanup,
              gamepadPolling,
              { projection, axis, zoom, crop: true },
            );
            scenario.acquire();
            const displacement = scenario.move([0.4, -0.3]);
            expect(displacement.length()).toBeGreaterThan(0.001);
            expect(displacement.x !== 0).toBe(axis.includes("X"));
            expect(displacement.y !== 0).toBe(axis.includes("Y"));
            expect(displacement.z).toBeCloseTo(0, 10);
            scenario.wrapper.dispose();
            return displacement;
          });
          expect(deltas[1].distanceTo(deltas[0])).toBeLessThan(1e-10);
        },
      );
    }
  }

  integrationTest(
    "Transform scales depth-axis movement without promising linear projected displacement",
    ({ cleanup, gamepadPolling }) => {
      const worldDeltas = [1, 2].map((zoom) => {
        const scenario = createProjectionScenario(
          "transform",
          cleanup,
          gamepadPolling,
          {
            axis: "Z",
            crop: true,
            zoom,
          },
        );
        scenario.acquire();
        const before = scenario.mesh.position.clone();
        scenario.move([0.5, 0]);
        const displacement = scenario.mesh.position.clone().sub(before);
        expect(displacement.x).toBeCloseTo(0, 10);
        expect(displacement.y).toBeCloseTo(0, 10);
        expect(displacement.z).toBeGreaterThan(0);
        scenario.wrapper.dispose();
        return displacement;
      });
      expect(
        worldDeltas[1].distanceTo(worldDeltas[0].multiplyScalar(0.5)),
      ).toBeLessThan(1e-10);
    },
  );

  integrationTest(
    "Transform retains snapping, bounds and reset while zoom changes",
    ({ cleanup, gamepadPolling }) => {
      const scenario = createProjectionScenario(
        "transform",
        cleanup,
        gamepadPolling,
        {
          axis: "X",
        },
      );
      const native = scenario.native as TransformControls;
      native.translationSnap = 0.1;
      native.maxX = 0.3;
      scenario.acquire();
      scenario.move([0.5, 0]);
      expect(scenario.mesh.position.x).toBeCloseTo(0.2, 10);
      scenario.camera.zoom = 2;
      scenario.camera.updateProjectionMatrix();
      for (let frame = 0; frame < 5; frame += 1) {
        scenario.move([0.5, 0]);
        expect(scenario.mesh.position.x).toBeLessThanOrEqual(native.maxX);
      }
      expect(scenario.mesh.position.x).toBe(0.3);
      scenario.step(
        { axes: [0.5, 0], buttons: createGamepadButtons([9, true]) },
        0,
      );
      expect(scenario.mesh.position.distanceTo(scenario.origin)).toBeLessThan(
        1e-10,
      );
      expect(scenario.events.filter((event) => event === "start")).toHaveLength(
        1,
      );
      expect(native.dragging).toBe(true);
    },
  );

  integrationTest(
    "Drag emits one movement event for simultaneous drag and rotation after zoom",
    ({ cleanup, gamepadPolling }) => {
      const scenario = createProjectionScenario(
        "drag",
        cleanup,
        gamepadPolling,
        {
          zoom: 2,
          crop: true,
          parent: "rotated",
        },
      );
      scenario.acquire();
      const before = scenario.projectedPosition();
      scenario.step({ axes: [0.5, -0.5, 0.5, 0] });
      const displacement = scenario.projectedPosition().sub(before);
      expect(displacement.x).toBeCloseTo(0.02, 10);
      expect(displacement.y).toBeCloseTo(0.02, 10);
      const nativeRotation = new Quaternion().setFromAxisAngle(
        new Vector3(0, 1, 0).applyQuaternion(scenario.camera.quaternion),
        0.01 * Math.PI,
      );
      expect(scenario.mesh.quaternion.angleTo(nativeRotation)).toBeLessThan(
        1e-7,
      );
      expect(scenario.events).toEqual(["start", "move"]);
    },
  );

  for (const kinds of [
    ["drag", "drag"],
    ["transform", "transform"],
    ["drag", "transform"],
  ] as const) {
    for (const reversed of [false, true]) {
      integrationTest(
        `${kinds.join("/")} isolates projections and lifecycle in slots 0/3 (reversed: ${reversed})`,
        ({ cleanup, gamepadPolling }) => {
          const first = createProjectionScenario(
            kinds[0],
            cleanup,
            gamepadPolling,
            {
              index: 0,
              crop: true,
              parent: "rotated",
            },
          );
          const second = createProjectionScenario(
            kinds[1],
            cleanup,
            gamepadPolling,
            {
              index: 3,
              projection: "orthographic",
              zoom: 3,
              aspect: 3 / 4,
              crop: true,
              parent: "translated",
            },
          );
          const scenarios = reversed ? [second, first] : [first, second];
          const step = (
            input0: GamepadFixtureOptions = {},
            input3: GamepadFixtureOptions = {},
          ) => {
            gamepadPolling.publishFrame([0, input0], [3, input3]);
            for (const scenario of scenarios) {
              scenario.syncMatrices();
              scenario.wrapper.update(0.02);
              scenario.syncMatrices();
            }
          };
          step();
          step(
            {
              buttons:
                kinds[0] === "drag" ? createGamepadButtons([0, true]) : [],
            },
            {
              buttons:
                kinds[1] === "drag" ? createGamepadButtons([0, true]) : [],
            },
          );
          const move = () => {
            const before = [
              first.projectedPosition(),
              second.projectedPosition(),
            ];
            step({ axes: [0.4, -0.3] }, { axes: [0, -0.5] });
            return [
              first.projectedPosition().sub(before[0]),
              second.projectedPosition().sub(before[1]),
            ];
          };
          const original = move();
          first.camera.zoom = 2;
          first.camera.updateProjectionMatrix();
          const updated = move();
          for (let index = 0; index < 2; index += 1) {
            expect(updated[index].distanceTo(original[index])).toBeLessThan(
              1e-10,
            );
          }
          expect(second.camera.zoom).toBe(3);
          expect(original[0].x).toBeCloseTo(0.016, 10);
          expect(original[0].y).toBeCloseTo(0.012, 10);
          expect(original[1].x).toBeCloseTo(0, 10);
          expect(original[1].y).toBeCloseTo(0.02, 10);
          expect(first.events).toEqual(["start", "move", "move"]);
          expect(second.events).toEqual(["start", "move", "move"]);
          first.wrapper.dispose();
          const released = first.mesh.position.clone();
          const before = second.projectedPosition();
          step({ axes: [0.4, -0.3] }, { axes: [0, -0.5] });
          expect(first.mesh.position.distanceTo(released)).toBeLessThan(1e-10);
          expect(first.events).toEqual(["start", "move", "move", "end"]);
          expect(
            second.projectedPosition().sub(before).distanceTo(original[1]),
          ).toBeLessThan(1e-10);
          expect(second.events).toEqual(["start", "move", "move", "move"]);
        },
      );
    }
  }
});

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
