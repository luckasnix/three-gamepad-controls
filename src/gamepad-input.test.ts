import { describe, expect, vi } from "vitest";

import {
  createGamepad,
  createGamepadButton,
  createGamepadHapticActuator,
} from "../test/fixtures/gamepad.ts";
import {
  dispatchGamepadEvent,
  type GamepadPollingFixture,
  gamepadTest,
} from "../test/fixtures/gamepad-browser.ts";
import {
  collectEvents,
  createCleanup,
} from "../test/fixtures/three-controls.ts";
import { MAX_GAMEPAD_INDEX, MIN_GAMEPAD_INDEX } from "./core.ts";
import {
  GamepadInput,
  type GamepadInputEventMap,
  type GamepadInputOptions,
} from "./gamepad-input.ts";
import {
  type GamepadStick,
  gamepadStickPipeline,
} from "./gamepad-stick-processing.ts";

let inputs: GamepadInput[];
let polling: GamepadPollingFixture;
let cleanup: ReturnType<typeof createCleanup>;

const observeInput = (input: GamepadInput) =>
  collectEvents<
    GamepadInputEventMap,
    keyof GamepadInputEventMap,
    { index: number; targetMatches: boolean }
  >(cleanup, input, ["connected", "disconnected"], "input", (event) => ({
    index: event.gamepad.index,
    targetMatches: event.target === input,
  }));

const inputEvent = (type: keyof GamepadInputEventMap, index: number) => ({
  type,
  source: "input",
  data: { index, targetMatches: true },
});

const createInput = (options?: Partial<GamepadInputOptions>): GamepadInput => {
  const input = new GamepadInput(options);

  inputs.push(input);

  return input;
};

gamepadTest.beforeEach(({ gamepadPolling }) => {
  inputs = [];
  cleanup = createCleanup();
  polling = gamepadPolling;
});

gamepadTest.afterEach(() => {
  for (const input of inputs) {
    input.dispose();
  }
  cleanup.dispose();
});

describe("GamepadInput construction", () => {
  gamepadTest("starts enabled with neutral disconnected state", () => {
    const input = createInput();

    expect(input.enabled).toBe(true);
    expect(input.gamepad).toBeNull();
    expect(input.rawGamepad).toBeNull();
    expect(input.connected).toBe(false);
    expect(input.mapping).toBeNull();
    expect(input.vibrationSupported).toBe(false);
    expect(input.isPressed(0)).toBe(false);
    expect(input.wasPressed(0)).toBe(false);
    expect(input.wasReleased(0)).toBe(false);
    expect(input.buttonValue(0)).toBe(0);
    expect(input.axis(0)).toBe(0);
    expect(input.stick(0, 1)).toEqual({ x: 0, y: 0 });
  });

  gamepadTest.each([
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    -1,
    0.5,
    MAX_GAMEPAD_INDEX + 1,
  ])("rejects the invalid gamepad index $gamepadIndex", (gamepadIndex) => {
    expect(() => createInput({ gamepadIndex })).toThrow(
      new RangeError(
        `gamepadIndex must be an integer between ${MIN_GAMEPAD_INDEX} and ${MAX_GAMEPAD_INDEX}.`,
      ),
    );
  });
});

describe("GamepadInput polling lifecycle", () => {
  gamepadTest(
    "adopts a polled gamepad and seeds held buttons without a transition",
    () => {
      const gamepad = createGamepad(0, {
        axes: [0.25, -0.5],
        buttons: [createGamepadButton(true, 0)],
        mapping: "",
      });
      const connectedGamepads: Gamepad[] = [];
      const input = createInput();
      input.addEventListener("connected", ({ gamepad: connectedGamepad }) => {
        connectedGamepads.push(connectedGamepad);
      });
      polling.gamepads[0] = gamepad;
      input.update();

      expect(connectedGamepads).toEqual([gamepad]);
      expect(input.gamepad).toBe(gamepad);
      expect(input.rawGamepad).toBe(gamepad);
      expect(input.connected).toBe(true);
      expect(input.mapping).toBe("");
      expect(input.vibrationSupported).toBe(true);
      expect(input.isPressed(0)).toBe(true);
      expect(input.wasPressed(0)).toBe(false);
    },
  );

  gamepadTest(
    "tracks button press and release transitions for one frame",
    () => {
      const initialGamepad = createGamepad(0, {
        buttons: [createGamepadButton(false), createGamepadButton(true)],
        timestamp: 1,
      });
      const refreshedGamepad = createGamepad(0, {
        buttons: [createGamepadButton(true), createGamepadButton(false)],
        timestamp: 2,
      });
      const input = createInput();
      polling.gamepads[0] = initialGamepad;
      input.update();
      polling.gamepads[0] = refreshedGamepad;
      input.update();

      expect(input.isPressed(0)).toBe(true);
      expect(input.isPressed(1)).toBe(false);
      expect(input.wasPressed(0)).toBe(true);
      expect(input.wasReleased(1)).toBe(true);

      input.update();

      expect(input.wasPressed(0)).toBe(false);
      expect(input.wasReleased(1)).toBe(false);
    },
  );

  gamepadTest(
    "clears state and emits disconnection when polling loses the active slot",
    () => {
      const gamepad = createGamepad(0, {
        buttons: [createGamepadButton(true)],
      });
      const disconnectedGamepads: Gamepad[] = [];
      const input = createInput();
      input.addEventListener(
        "disconnected",
        ({ gamepad: disconnectedGamepad }) => {
          disconnectedGamepads.push(disconnectedGamepad);
        },
      );
      polling.gamepads[0] = gamepad;
      input.update();
      polling.gamepads[0] = null;
      input.update();

      expect(disconnectedGamepads).toEqual([gamepad]);
      expect(input.gamepad).toBeNull();
      expect(input.connected).toBe(false);
      expect(input.isPressed(0)).toBe(false);
      expect(input.wasReleased(0)).toBe(false);
    },
  );

  gamepadTest(
    "does not poll while disabled and resumes when re-enabled",
    () => {
      const gamepad = createGamepad(0);
      const input = createInput();
      polling.gamepads[0] = gamepad;
      input.enabled = false;
      input.update();

      expect(polling.getGamepads).not.toHaveBeenCalled();
      expect(input.gamepad).toBeNull();

      input.enabled = true;
      input.update();

      expect(polling.getGamepads).toHaveBeenCalledOnce();
      expect(input.gamepad).toBe(gamepad);
    },
  );

  gamepadTest("keeps neutral state when polling finds no gamepad", () => {
    const input = createInput();
    input.update();

    expect(polling.getGamepads).toHaveBeenCalledOnce();
    expect(input.gamepad).toBeNull();
    expect(input.stick(0, 1)).toEqual({ x: 0, y: 0 });
  });
});

describe("GamepadInput browser events", () => {
  gamepadTest(
    "uses a connection event to adopt the latest selected snapshot",
    () => {
      const eventGamepad = createGamepad(2, { timestamp: 1 });
      const selectedGamepad = createGamepad(2, {
        buttons: [createGamepadButton(true)],
        timestamp: 2,
      });
      const connectedGamepads: Gamepad[] = [];
      const input = createInput({ gamepadIndex: 2 });
      input.addEventListener("connected", ({ gamepad }) => {
        connectedGamepads.push(gamepad);
      });
      polling.gamepads[2] = selectedGamepad;
      dispatchGamepadEvent("gamepadconnected", createGamepad(1));
      dispatchGamepadEvent("gamepadconnected", eventGamepad);

      expect(connectedGamepads).toEqual([selectedGamepad]);
      expect(input.gamepad).toBe(selectedGamepad);
      expect(input.isPressed(0)).toBe(true);
      expect(input.wasPressed(0)).toBe(false);
    },
  );

  gamepadTest(
    "ignores unrelated disconnections and clears an active matching slot",
    () => {
      const activeGamepad = createGamepad(1, {
        buttons: [createGamepadButton(true)],
      });
      const disconnectedGamepads: Gamepad[] = [];
      const input = createInput();
      input.addEventListener("disconnected", ({ gamepad }) => {
        disconnectedGamepads.push(gamepad);
      });
      polling.gamepads[1] = activeGamepad;
      input.update();
      dispatchGamepadEvent(
        "gamepaddisconnected",
        createGamepad(0, { connected: false }),
      );
      dispatchGamepadEvent(
        "gamepaddisconnected",
        createGamepad(1, { connected: false }),
      );

      expect(disconnectedGamepads).toEqual([activeGamepad]);
      expect(input.gamepad).toBeNull();
      expect(input.isPressed(0)).toBe(false);
      expect(input.wasReleased(0)).toBe(false);
    },
  );
});

describe("GamepadInput value reads", () => {
  gamepadTest("treats sparse button entries as not pressed", () => {
    const buttons = Array<GamepadButton>(2);
    buttons[1] = createGamepadButton(true);
    const input = createInput();
    polling.gamepads[0] = createGamepad(0, { buttons });
    input.update();

    expect(input.isPressed(0)).toBe(false);
    expect(input.buttonValue(0)).toBe(0);
    expect(input.isPressed(1)).toBe(true);
  });

  gamepadTest("reads digital, analog, and missing button values", () => {
    const gamepad = createGamepad(0, {
      buttons: [
        createGamepadButton(false),
        createGamepadButton(true, 0),
        createGamepadButton(false, 0.6),
        createGamepadButton(true, 0.8),
      ],
    });
    const input = createInput();
    polling.gamepads[0] = gamepad;
    input.update();

    expect(input.buttonValue(0)).toBe(0);
    expect(input.buttonValue(1)).toBe(1);
    expect(input.buttonValue(2)).toBe(0.6);
    expect(input.buttonValue(3)).toBe(0.8);
    expect(input.buttonValue(99)).toBe(0);
  });

  gamepadTest("applies default, instance, and per-read axis dead zones", () => {
    const gamepad = createGamepad(0, {
      axes: [0.09, -0.1, 0.3],
    });
    const defaultInput = createInput();
    const configuredInput = createInput({ axisDeadzone: 0.25 });
    polling.gamepads[0] = gamepad;
    defaultInput.update();
    configuredInput.update();

    expect(defaultInput.axis(0)).toBe(0);
    expect(defaultInput.axis(1)).toBe(-0.1);
    expect(defaultInput.axis(2, { deadzone: 0.4 })).toBe(0);
    expect(defaultInput.axis(2, { deadzone: 0.2 })).toBe(0.3);
    expect(defaultInput.axis(99)).toBe(0);
    expect(configuredInput.axis(1)).toBe(0);
    expect(configuredInput.axis(2)).toBe(0.3);
  });

  gamepadTest(
    "uses the configured stick pipeline and allows a per-read override",
    () => {
      const configuredTransform = vi.fn((value: Readonly<GamepadStick>) => ({
        x: value.x * 2,
        y: value.y * 2,
      }));
      const overrideTransform = vi.fn((value: Readonly<GamepadStick>) => ({
        x: value.y,
        y: value.x,
      }));
      const configuredPipeline =
        gamepadStickPipeline().transform(configuredTransform);
      const overridePipeline =
        gamepadStickPipeline().transform(overrideTransform);
      const input = createInput({ stickPipeline: configuredPipeline });
      polling.gamepads[0] = createGamepad(0, { axes: [0.25, -0.5] });
      input.update();

      expect(input.stick(0, 1)).toEqual({ x: 0.5, y: -1 });
      expect(configuredTransform).toHaveBeenCalledExactlyOnceWith({
        x: 0.25,
        y: -0.5,
      });

      expect(input.stick(0, 1, overridePipeline)).toEqual({
        x: -0.5,
        y: 0.25,
      });
      expect(overrideTransform).toHaveBeenCalledExactlyOnceWith({
        x: 0.25,
        y: -0.5,
      });
    },
  );
});

describe("GamepadInput haptics", () => {
  gamepadTest(
    "plays and resets vibration through the active gamepad",
    async () => {
      const parameters: GamepadEffectParameters = {
        duration: 100,
        strongMagnitude: 0.75,
        weakMagnitude: 0.25,
      };
      const playEffect = vi
        .fn<GamepadHapticActuator["playEffect"]>()
        .mockResolvedValue("complete");
      const reset = vi
        .fn<GamepadHapticActuator["reset"]>()
        .mockResolvedValue("preempted");
      const gamepad = createGamepad(0, {
        vibrationActuator: createGamepadHapticActuator({ playEffect, reset }),
      });
      const input = createInput();
      polling.gamepads[0] = gamepad;
      input.update();

      await expect(
        input.playVibrationEffect("dual-rumble", parameters),
      ).resolves.toBe("complete");
      await expect(input.resetVibration()).resolves.toBe("preempted");
      expect(playEffect).toHaveBeenCalledExactlyOnceWith(
        "dual-rumble",
        parameters,
      );
      expect(reset).toHaveBeenCalledOnce();
    },
  );

  gamepadTest(
    "treats vibration without an active gamepad as a no-op",
    async () => {
      const input = createInput();

      await expect(
        input.playVibrationEffect("dual-rumble"),
      ).resolves.toBeNull();
      await expect(input.resetVibration()).resolves.toBeNull();
    },
  );
});

describe("GamepadInput.dispose", () => {
  gamepadTest(
    "clears state, disables polling, and removes browser listeners",
    () => {
      const activeGamepad = createGamepad(0, {
        buttons: [createGamepadButton(true)],
      });
      const replacementGamepad = createGamepad(1);
      const input = createInput();
      polling.gamepads[0] = activeGamepad;
      input.update();
      polling.getGamepads.mockClear();
      input.dispose();
      polling.gamepads[0] = null;
      polling.gamepads[1] = replacementGamepad;
      dispatchGamepadEvent("gamepadconnected", replacementGamepad);
      input.update();

      expect(input.enabled).toBe(false);
      expect(input.gamepad).toBeNull();
      expect(input.connected).toBe(false);
      expect(input.isPressed(0)).toBe(false);
      expect(input.wasReleased(0)).toBe(false);
      expect(polling.getGamepads).not.toHaveBeenCalled();
    },
  );
});

describe("GamepadInput slot lifecycle contract", () => {
  for (const order of ["event-first", "poll-first"] as const) {
    gamepadTest(
      `deduplicates ${order} loss and seeds held buttons on readoption`,
      () => {
        const input = createInput();
        const events = observeInput(input);
        polling.publishFrame([3, { buttons: [createGamepadButton(true)] }]);
        input.update();
        polling.publishFrame(
          [0],
          [3, { buttons: [createGamepadButton(true)] }],
        );
        dispatchGamepadEvent("gamepadconnected", createGamepad(0));
        input.update();

        expect(input.gamepad?.index).toBe(3);
        expect(events).toEqual([inputEvent("connected", 3)]);

        polling.publishFrame([0, { buttons: [createGamepadButton(true)] }]);
        const lost = createGamepad(3, { connected: false });
        if (order === "event-first") {
          dispatchGamepadEvent("gamepaddisconnected", lost);
        } else {
          input.update();
        }
        dispatchGamepadEvent("gamepaddisconnected", lost);
        dispatchGamepadEvent("gamepadconnected", createGamepad(0));

        expect(input.gamepad).toBeNull();
        expect(input.isPressed(0)).toBe(false);
        expect(input.wasReleased(0)).toBe(false);
        expect(events).toEqual([
          inputEvent("connected", 3),
          inputEvent("disconnected", 3),
        ]);

        input.update();

        expect(input.gamepad?.index).toBe(0);
        expect(input.isPressed(0)).toBe(true);
        expect(input.wasPressed(0)).toBe(false);
        expect(events).toEqual([
          inputEvent("connected", 3),
          inputEvent("disconnected", 3),
          inputEvent("connected", 0),
        ]);

        input.update();

        expect(events).toHaveLength(3);
      },
    );
  }

  gamepadTest(
    "refreshes values across new references, IDs and timestamps without readoption",
    () => {
      const input = createInput({ gamepadIndex: 3 });
      const events = observeInput(input);
      polling.publishFrame(
        [0],
        [3, { id: "before", buttons: [createGamepadButton(false)] }],
      );
      input.update();
      const previous = input.gamepad;
      polling.publishFrame(
        [0],
        [
          3,
          {
            id: "after",
            timestamp: 42,
            axes: [0.75, -0.5],
            buttons: [createGamepadButton(true, 0.8)],
          },
        ],
      );
      dispatchGamepadEvent("gamepadconnected", createGamepad(3));
      input.update();

      expect(input.gamepad).not.toBe(previous);
      expect(input.gamepad).toBe(polling.gamepads[3]);
      expect(input.gamepad?.id).toBe("after");
      expect(input.axis(0)).toBe(0.75);
      expect(input.buttonValue(0)).toBe(0.8);
      expect(input.wasPressed(0)).toBe(true);
      expect(events).toEqual([inputEvent("connected", 3)]);
    },
  );

  gamepadTest(
    "readopts the same explicit slot with held buttons after an observed loss",
    () => {
      const input = createInput({ gamepadIndex: 3 });
      const events = observeInput(input);
      polling.publishFrame([0], [3]);
      input.update();
      polling.publishFrame([0], [3, { connected: false }]);
      input.update();
      input.update();

      expect(input.gamepad).toBeNull();

      polling.publishFrame([0], [3, { buttons: [createGamepadButton(true)] }]);
      input.update();

      expect(input.isPressed(0)).toBe(true);
      expect(input.wasPressed(0)).toBe(false);
      expect(events).toEqual([
        inputEvent("connected", 3),
        inputEvent("disconnected", 3),
        inputEvent("connected", 3),
      ]);
    },
  );
});

describe("GamepadInput pause and resume contract", () => {
  for (const scenario of [
    {
      name: "complete unseen click",
      before: false,
      during: true,
      after: false,
      pressed: false,
      released: false,
    },
    {
      name: "held new press",
      before: false,
      during: true,
      after: true,
      pressed: true,
      released: false,
    },
    {
      name: "release",
      before: true,
      during: false,
      after: false,
      pressed: false,
      released: true,
    },
  ]) {
    gamepadTest(
      `compares the last observed snapshot on resume: ${scenario.name}`,
      () => {
        const input = createInput();
        polling.publishFrame([
          3,
          { axes: [0.5], buttons: [createGamepadButton(scenario.before)] },
        ]);
        input.update();
        const previous = input.gamepad;
        input.enabled = false;
        polling.getGamepads.mockClear();
        polling.publishFrame([
          3,
          { buttons: [createGamepadButton(scenario.during)] },
        ]);
        input.update();
        polling.publishFrame([
          3,
          { buttons: [createGamepadButton(scenario.after)] },
        ]);
        input.update();

        expect(polling.getGamepads).not.toHaveBeenCalled();
        expect(input.gamepad).toBe(previous);
        expect(input.axis(0)).toBe(0.5);
        expect(input.isPressed(0)).toBe(scenario.before);

        input.enabled = true;
        input.update();

        expect(input.isPressed(0)).toBe(scenario.after);
        expect(input.wasPressed(0)).toBe(scenario.pressed);
        expect(input.wasReleased(0)).toBe(scenario.released);

        input.update();

        expect(input.wasPressed(0)).toBe(false);
        expect(input.wasReleased(0)).toBe(false);
      },
    );
  }

  gamepadTest(
    "keeps transition flags until another observation, then clears them without replay",
    () => {
      const input = createInput();
      polling.publishFrame([3]);
      input.update();
      polling.publishFrame([3, { buttons: [createGamepadButton(true)] }]);
      input.update();
      input.enabled = false;
      input.update();

      expect(input.wasPressed(0)).toBe(true);

      input.enabled = true;
      input.update();

      expect(input.isPressed(0)).toBe(true);
      expect(input.wasPressed(0)).toBe(false);
    },
  );

  gamepadTest(
    "observes polling-only loss on resume and adopts only on the following update",
    () => {
      const input = createInput();
      const events = observeInput(input);
      polling.publishFrame([3, { buttons: [createGamepadButton(true)] }]);
      input.update();
      input.enabled = false;
      polling.publishFrame([0]);
      polling.getGamepads.mockClear();
      input.update();

      expect(polling.getGamepads).not.toHaveBeenCalled();
      expect(input.connected).toBe(true);
      expect(events).toEqual([inputEvent("connected", 3)]);

      input.enabled = true;
      input.update();

      expect(input.gamepad).toBeNull();
      expect(input.wasReleased(0)).toBe(false);
      expect(events).toEqual([
        inputEvent("connected", 3),
        inputEvent("disconnected", 3),
      ]);

      input.update();

      expect(events).toEqual([
        inputEvent("connected", 3),
        inputEvent("disconnected", 3),
        inputEvent("connected", 0),
      ]);
    },
  );

  gamepadTest(
    "handles browser events while paused but defers readoption until resume",
    () => {
      const input = createInput();
      const events = observeInput(input);
      input.enabled = false;
      polling.publishFrame([3, { buttons: [createGamepadButton(true)] }], [0]);
      dispatchGamepadEvent("gamepadconnected", createGamepad(3));

      expect(input.gamepad?.index).toBe(0);
      expect(polling.getGamepads).toHaveBeenCalledOnce();

      polling.publishFrame([3, { buttons: [createGamepadButton(true)] }]);
      dispatchGamepadEvent(
        "gamepaddisconnected",
        createGamepad(0, { connected: false }),
      );
      dispatchGamepadEvent("gamepadconnected", createGamepad(3));
      input.update();

      expect(input.gamepad).toBeNull();
      expect(polling.getGamepads).toHaveBeenCalledOnce();

      input.enabled = true;
      input.update();

      expect(input.isPressed(0)).toBe(true);
      expect(input.wasPressed(0)).toBe(false);
      expect(events).toEqual([
        inputEvent("connected", 0),
        inputEvent("disconnected", 0),
        inputEvent("connected", 3),
      ]);
    },
  );
});

describe("GamepadInput instance isolation", () => {
  gamepadTest(
    "clears both automatic inputs on shared loss but resumes their adoption independently",
    () => {
      const first = createInput();
      const second = createInput();
      const firstEvents = observeInput(first);
      const secondEvents = observeInput(second);
      polling.publishFrame([3]);
      first.update();
      second.update();
      second.enabled = false;
      polling.publishFrame([0, { buttons: [createGamepadButton(true)] }]);
      dispatchGamepadEvent(
        "gamepaddisconnected",
        createGamepad(3, { connected: false }),
      );

      expect(first.gamepad).toBeNull();
      expect(second.gamepad).toBeNull();

      first.update();
      dispatchGamepadEvent("gamepadconnected", createGamepad(0));
      second.update();

      expect(first.gamepad?.index).toBe(0);
      expect(second.gamepad).toBeNull();
      expect(firstEvents).toEqual([
        inputEvent("connected", 3),
        inputEvent("disconnected", 3),
        inputEvent("connected", 0),
      ]);
      expect(secondEvents).toEqual([
        inputEvent("connected", 3),
        inputEvent("disconnected", 3),
      ]);

      second.enabled = true;
      second.update();

      expect(second.isPressed(0)).toBe(true);
      expect(second.wasPressed(0)).toBe(false);
      expect(secondEvents).toEqual(firstEvents);
    },
  );

  for (const automatic of [false, true]) {
    gamepadTest(
      `isolates updates and disposal for ${automatic ? "automatic shared" : "explicit separate"} slots`,
      () => {
        const first = createInput(automatic ? undefined : { gamepadIndex: 0 });
        const second = createInput(automatic ? undefined : { gamepadIndex: 3 });
        const firstEvents = observeInput(first);
        const secondEvents = observeInput(second);
        const secondSlot = automatic ? 0 : 3;
        polling.publishFrame([3], [0]);
        dispatchGamepadEvent("gamepadconnected", createGamepad(3));
        dispatchGamepadEvent("gamepadconnected", createGamepad(0));

        expect(first.gamepad?.index).toBe(0);
        expect(second.gamepad?.index).toBe(secondSlot);

        polling.publishFrame(
          [0, { buttons: [createGamepadButton(true)] }],
          [3, { buttons: [createGamepadButton(true)] }],
        );
        first.update();

        expect(first.wasPressed(0)).toBe(true);
        expect(second.isPressed(0)).toBe(false);

        second.update();
        first.update();

        expect(first.wasPressed(0)).toBe(false);
        expect(second.wasPressed(0)).toBe(true);

        dispatchGamepadEvent(
          "gamepaddisconnected",
          createGamepad(2, { connected: false }),
        );

        expect(second.isPressed(0)).toBe(true);

        first.dispose();
        first.dispose();

        expect(first.enabled).toBe(false);
        expect(first.gamepad).toBeNull();
        expect(first.isPressed(0)).toBe(false);
        expect(first.wasReleased(0)).toBe(false);
        expect(firstEvents).toEqual([inputEvent("connected", 0)]);
        expect(second.isPressed(0)).toBe(true);

        polling.publishFrame();
        const lost = createGamepad(secondSlot, { connected: false });
        dispatchGamepadEvent("gamepaddisconnected", lost);
        dispatchGamepadEvent("gamepaddisconnected", lost);
        second.update();

        expect(second.wasReleased(0)).toBe(false);
        polling.publishFrame([
          secondSlot,
          { buttons: [createGamepadButton(true)] },
        ]);

        dispatchGamepadEvent("gamepadconnected", createGamepad(secondSlot));
        second.update();

        expect(second.isPressed(0)).toBe(true);
        expect(second.wasPressed(0)).toBe(false);
        expect(secondEvents).toEqual([
          inputEvent("connected", secondSlot),
          inputEvent("disconnected", secondSlot),
          inputEvent("connected", secondSlot),
        ]);
        expect(firstEvents).toEqual([inputEvent("connected", 0)]);

        polling.getGamepads.mockClear();
        first.update();

        expect(polling.getGamepads).not.toHaveBeenCalled();
      },
    );
  }

  gamepadTest(
    "losing slot 3 leaves slot 0 button state and lifecycle untouched",
    () => {
      const first = createInput({ gamepadIndex: 0 });
      const second = createInput({ gamepadIndex: 3 });
      const events = observeInput(first);
      polling.publishFrame([0], [3]);
      first.update();
      second.update();
      polling.publishFrame([0, { buttons: [createGamepadButton(true)] }]);
      first.update();
      const active = first.gamepad;
      dispatchGamepadEvent(
        "gamepaddisconnected",
        createGamepad(3, { connected: false }),
      );
      second.update();

      expect(second.gamepad).toBeNull();
      expect(first.gamepad).toBe(active);
      expect(first.wasPressed(0)).toBe(true);
      expect(events).toEqual([inputEvent("connected", 0)]);
    },
  );

  gamepadTest(
    "shares a built-in pipeline without retaining another input's history",
    () => {
      const pipeline = gamepadStickPipeline()
        .deadzone(0.1)
        .responseCurve("cubic")
        .invert("y");
      const first = createInput({ gamepadIndex: 0, stickPipeline: pipeline });
      const second = createInput({ gamepadIndex: 3, stickPipeline: pipeline });
      polling.publishFrame(
        [0, { axes: [0.5, -0.5] }],
        [3, { axes: [0.05, 1] }],
      );
      first.update();
      second.update();

      expect(first.stick(0, 1)).toEqual({ x: 0.125, y: 0.125 });
      expect(second.stick(0, 1)).toEqual({ x: 0, y: -1 });
      expect(first.stick(0, 1)).toEqual({ x: 0.125, y: 0.125 });

      second.dispose();
      polling.publishFrame([0, { axes: [-0.5, 0.5] }]);
      first.update();

      expect(first.stick(0, 1)).toEqual({ x: -0.125, y: -0.125 });
    },
  );
});
