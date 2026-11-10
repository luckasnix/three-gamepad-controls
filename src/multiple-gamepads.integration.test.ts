import { Object3D, Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { expect, vi } from "vitest";

import {
  createGamepadButtons,
  createGamepadHapticActuator,
} from "../test/fixtures/gamepad.ts";
import {
  createThreeEnvironment,
  integrationTest,
} from "../test/fixtures/three-controls.ts";
import {
  GAMEPAD_AXIS,
  GAMEPAD_BUTTON,
  GamepadInput,
  GamepadOrbitControls,
  GamepadTransformControls,
} from "./index.ts";

integrationTest.for(["GamepadInput", "GamepadControls"] as const)(
  "%s routes play and reset exclusively to the selected actuator",
  async (api, { cleanup, gamepadPolling }) => {
    const calls: string[] = [];
    const player = (index: number) => {
      const actuator = createGamepadHapticActuator({
        playEffect: async () => {
          calls.push(`play ${index}`);
          return "complete";
        },
        reset: async () => {
          calls.push(`reset ${index}`);
          return "preempted";
        },
      });
      let controls: GamepadInput | GamepadOrbitControls;
      if (api === "GamepadInput") {
        controls = new GamepadInput({ gamepadIndex: index });
      } else {
        const { camera, element } = createThreeEnvironment(cleanup);
        const orbit = new OrbitControls(camera, element);
        cleanup.add("native", () => orbit.dispose());
        controls = new GamepadOrbitControls(orbit, { gamepadIndex: index });
      }
      cleanup.add("wrapper", () => controls.dispose());
      return { controls, actuator };
    };
    const a = player(0);
    const b = player(3);
    gamepadPolling.publishFrame(
      [0, { vibrationActuator: a.actuator }],
      [3, { vibrationActuator: b.actuator }],
    );
    b.controls.update(0.1);
    a.controls.update(0.1);
    const expected: string[] = [];
    for (const [index, { controls }] of [
      [0, a],
      [3, b],
    ] as const) {
      await expect(
        controls.playVibrationEffect("dual-rumble", { duration: 80 }),
      ).resolves.toBe("complete");
      expected.push(`play ${index}`);
      expect(calls).toEqual(expected);
      await expect(controls.resetVibration()).resolves.toBe("preempted");
      expected.push(`reset ${index}`);
      expect(calls).toEqual(expected);
    }
  },
);

integrationTest(
  "player example routes connection events, movement and button feedback per player",
  async ({ cleanup, gamepadPolling }) => {
    const events: string[] = [];
    const subscriptions = new AbortController();
    cleanup.add("listener", () => subscriptions.abort());
    const players = [0, 3].map((index) => {
      const input = new GamepadInput({ gamepadIndex: index });
      cleanup.add("wrapper", () => input.dispose());
      for (const type of ["connected", "disconnected"] as const) {
        input.addEventListener(
          type,
          ({ detail }) => {
            events.push(`player on ${index}: ${type} ${detail.gamepad.index}`);
          },
          { signal: subscriptions.signal },
        );
      }
      const actuator = createGamepadHapticActuator();
      const play = vi.spyOn(actuator, "playEffect");
      return { input, actuator, play, object: new Object3D() };
    });
    const [a, b] = players;
    const pulse = { duration: 80, weakMagnitude: 0.4 };
    const frame = async (heldA: boolean | undefined, heldB: boolean) => {
      const slotB = {
        axes: [-0.5],
        buttons: createGamepadButtons([0, heldB]),
        vibrationActuator: b.actuator,
      };
      if (heldA === undefined) {
        gamepadPolling.publishFrame([3, slotB]);
      } else {
        gamepadPolling.publishFrame(
          [
            0,
            {
              axes: [1],
              buttons: createGamepadButtons([0, heldA]),
              vibrationActuator: a.actuator,
            },
          ],
          [3, slotB],
        );
      }
      for (const { input } of players) {
        input.update();
      }
      const feedback = [];
      for (const { object, input } of players) {
        object.position.x += input.axis(GAMEPAD_AXIS.LeftX) * 4 * 0.25;
        if (input.wasPressed(GAMEPAD_BUTTON.South)) {
          feedback.push(input.playVibrationEffect("dual-rumble", pulse));
        }
      }
      await Promise.all(feedback);
    };
    await frame(false, false);
    await frame(true, false);
    expect(a.play).toHaveBeenCalledExactlyOnceWith("dual-rumble", pulse);
    expect(b.play).not.toHaveBeenCalled();
    await frame(undefined, true);
    expect(a.object.position.x).toBe(2);
    expect(b.object.position.x).toBe(-1.5);
    expect(b.play).toHaveBeenCalledExactlyOnceWith("dual-rumble", pulse);
    await frame(true, true); // Both buttons are held, including A's at readoption.
    expect(a.play).toHaveBeenCalledTimes(1);
    expect(b.play).toHaveBeenCalledTimes(1);
    expect(a.object.position.x).toBe(3);
    expect(b.object.position.x).toBe(-2);
    await frame(false, true);
    await frame(true, true);
    expect(a.play).toHaveBeenCalledTimes(2);
    expect(b.play).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      "player on 0: connected 0",
      "player on 3: connected 3",
      "player on 0: disconnected 0",
      "player on 0: connected 0",
    ]);
    cleanup.dispose();
    gamepadPolling.getGamepads.mockClear();
    await frame(false, false);
    expect(gamepadPolling.getGamepads).not.toHaveBeenCalled();
  },
);

integrationTest(
  "navigation and editing example translates the cube in the updated camera view",
  ({ cleanup, gamepadPolling }) => {
    const { camera, mesh, element, scene, syncMatrices } =
      createThreeEnvironment(cleanup);
    const orbit = new OrbitControls(camera, element);
    orbit.enableDamping = true;
    cleanup.add("native", () => orbit.dispose());
    const transform = new TransformControls(camera, element);
    cleanup.add("native", () => transform.dispose());
    transform.attach(mesh);
    transform.axis = "XYZ";
    const helper = transform.getHelper();
    scene.add(helper);
    cleanup.add("native", () => {
      transform.detach();
      scene.remove(helper);
    });
    const navigation = new GamepadOrbitControls(orbit, { gamepadIndex: 0 });
    const editor = new GamepadTransformControls(transform, { gamepadIndex: 3 });
    cleanup.add("wrapper", () => navigation.dispose());
    cleanup.add("wrapper", () => editor.dispose());
    const start = mesh.position.clone();
    const forward = camera.quaternion.clone();
    const frame = () => {
      navigation.update(0.1);
      orbit.update(0.1);
      editor.update(0.1);
      syncMatrices();
    };

    gamepadPolling.publishFrame([0, { axes: [1, 0] }], [3]);
    frame();
    expect(camera.quaternion.angleTo(forward)).toBeGreaterThan(0.01);
    expect(mesh.position).toEqual(start);
    const previousView = camera.quaternion.clone();
    gamepadPolling.publishFrame([0, { axes: [1, 0] }], [3, { axes: [0.5, 0] }]);
    frame();
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    expect(camera.quaternion.angleTo(previousView)).toBeGreaterThan(0.01);
    const translation = mesh.position.clone().sub(start);
    expect(translation.length()).toBeGreaterThan(0.01);
    expect(translation.normalize().distanceTo(right)).toBeLessThan(1e-8);
    expect(mesh.position.clone().project(camera).x).toBeCloseTo(0.1, 10);

    const before = mesh.position.clone();
    gamepadPolling.publishFrame([3, { axes: [0.5, 0] }]);
    frame();
    expect(navigation.gamepad).toBeNull();
    expect(mesh.position.distanceTo(before)).toBeGreaterThan(0.01);
    expect(transform.dragging).toBe(true);
    cleanup.dispose();
    expect(helper.parent).toBeNull();
    expect(transform.object).toBeUndefined();
  },
);
