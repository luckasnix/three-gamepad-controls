import { describe, expect, vi } from "vitest";

import {
  createGamepad,
  createGamepadHapticActuator,
} from "../test/fixtures/gamepad.ts";
import {
  dispatchGamepadEvent,
  type GamepadPollingFixture,
  gamepadTest,
} from "../test/fixtures/gamepad-browser.ts";
import { MAX_GAMEPAD_INDEX, MIN_GAMEPAD_INDEX } from "./core.ts";
import {
  GamepadControls,
  type GamepadControlsOptions,
} from "./gamepad-controls.ts";
import { GamepadInput } from "./gamepad-input.ts";

class TestGamepadControls extends GamepadControls {
  readonly connectedGamepads: Gamepad[] = [];
  readonly disconnectedGamepads: Gamepad[] = [];
  readonly updateDeltas: number[] = [];

  public get input(): GamepadInput {
    return this.gamepadInput;
  }

  protected override onUpdate(deltaTime: number): void {
    this.updateDeltas.push(deltaTime);
  }

  protected override onGamepadConnected(gamepad: Gamepad): void {
    this.connectedGamepads.push(gamepad);
    super.onGamepadConnected(gamepad);
  }

  protected override onGamepadDisconnected(gamepad: Gamepad): void {
    this.disconnectedGamepads.push(gamepad);
    super.onGamepadDisconnected(gamepad);
  }
}

let controlsInstances: TestGamepadControls[];
let polling: GamepadPollingFixture;

const createControls = (
  options?: GamepadControlsOptions,
): TestGamepadControls => {
  const controls = new TestGamepadControls(options);

  controlsInstances.push(controls);

  return controls;
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

describe("GamepadControls construction", () => {
  gamepadTest("starts enabled with neutral gamepad state", () => {
    const controls = createControls();

    expect(controls.enabled).toBe(true);
    expect(controls.gamepad).toBeNull();
    expect(controls.vibrationSupported).toBe(false);
    expect(controls.input).toBeInstanceOf(GamepadInput);
  });

  gamepadTest.each([
    Number.NaN,
    Number.NEGATIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    -1,
    0.5,
    MAX_GAMEPAD_INDEX + 1,
  ])("rejects the invalid gamepad index $gamepadIndex", (gamepadIndex) => {
    expect(() => createControls({ gamepadIndex })).toThrow(
      new RangeError(
        `gamepadIndex must be an integer between ${MIN_GAMEPAD_INDEX} and ${MAX_GAMEPAD_INDEX}.`,
      ),
    );
  });
});

describe("GamepadControls.update", () => {
  gamepadTest("does not poll or update the subclass while disabled", () => {
    const controls = createControls();
    polling.gamepads[0] = createGamepad(0);
    controls.enabled = false;

    controls.update(0.25);

    expect(polling.getGamepads).not.toHaveBeenCalled();
    expect(controls.gamepad).toBeNull();
    expect(controls.updateDeltas).toEqual([]);
  });

  gamepadTest("polls without updating the subclass when disconnected", () => {
    const controls = createControls();

    controls.update(0.25);

    expect(polling.getGamepads).toHaveBeenCalledOnce();
    expect(controls.gamepad).toBeNull();
    expect(controls.updateDeltas).toEqual([]);
  });

  gamepadTest(
    "passes the delta time and latest snapshot to the subclass",
    () => {
      const initialGamepad = createGamepad(0, { timestamp: 1 });
      const refreshedGamepad = createGamepad(0, { timestamp: 2 });
      const controls = createControls();
      polling.gamepads[0] = initialGamepad;

      controls.update(0.1);
      polling.gamepads[0] = refreshedGamepad;
      controls.update(0.2);

      expect(controls.gamepad).toBe(refreshedGamepad);
      expect(controls.updateDeltas).toEqual([0.1, 0.2]);
      expect(controls.connectedGamepads).toEqual([initialGamepad]);
    },
  );

  gamepadTest("waits for the explicitly selected gamepad slot", () => {
    const otherGamepad = createGamepad(0);
    const selectedGamepad = createGamepad(2);
    const controls = createControls({ gamepadIndex: 2 });
    polling.gamepads[0] = otherGamepad;

    controls.update(0.1);

    expect(controls.gamepad).toBeNull();
    expect(controls.updateDeltas).toEqual([]);

    polling.gamepads[2] = selectedGamepad;
    controls.update(0.2);

    expect(controls.gamepad).toBe(selectedGamepad);
    expect(controls.updateDeltas).toEqual([0.2]);
  });
});

describe("GamepadControls lifecycle events", () => {
  gamepadTest(
    "forwards connection and disconnection through hooks and events",
    () => {
      const gamepad = createGamepad(1);
      const connectedEvents: Gamepad[] = [];
      const disconnectedEvents: Gamepad[] = [];
      const controls = createControls();
      controls.addEventListener(
        "connected",
        ({ gamepad: connectedGamepad }) => {
          connectedEvents.push(connectedGamepad);
        },
      );
      controls.addEventListener(
        "disconnected",
        ({ gamepad: disconnectedGamepad }) => {
          disconnectedEvents.push(disconnectedGamepad);
        },
      );
      polling.gamepads[1] = gamepad;

      controls.update(0.1);
      polling.gamepads[1] = null;
      controls.update(0.2);

      expect(controls.connectedGamepads).toEqual([gamepad]);
      expect(controls.disconnectedGamepads).toEqual([gamepad]);
      expect(connectedEvents).toEqual([gamepad]);
      expect(disconnectedEvents).toEqual([gamepad]);
      expect(controls.gamepad).toBeNull();
      expect(controls.updateDeltas).toEqual([0.1]);
    },
  );
});

describe("GamepadControls haptics", () => {
  gamepadTest("delegates vibration effects to the active gamepad", async () => {
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
    const controls = createControls();
    polling.gamepads[0] = gamepad;
    controls.update(0.1);

    expect(controls.vibrationSupported).toBe(true);
    await expect(
      controls.playVibrationEffect("dual-rumble", parameters),
    ).resolves.toBe("complete");
    await expect(controls.resetVibration()).resolves.toBe("preempted");
    expect(playEffect).toHaveBeenCalledExactlyOnceWith(
      "dual-rumble",
      parameters,
    );
    expect(reset).toHaveBeenCalledOnce();
  });

  gamepadTest("treats vibration without a gamepad as a no-op", async () => {
    const controls = createControls();

    await expect(
      controls.playVibrationEffect("dual-rumble"),
    ).resolves.toBeNull();
    await expect(controls.resetVibration()).resolves.toBeNull();
  });
});

describe("GamepadControls.dispose", () => {
  gamepadTest(
    "clears state and detaches the underlying input lifecycle",
    () => {
      const activeGamepad = createGamepad(0);
      const replacementGamepad = createGamepad(1);
      const controls = createControls();
      polling.gamepads[0] = activeGamepad;
      controls.update(0.1);
      polling.getGamepads.mockClear();

      controls.dispose();

      expect(controls.enabled).toBe(false);
      expect(controls.gamepad).toBeNull();

      polling.setGamepads([null, replacementGamepad]);
      dispatchGamepadEvent("gamepadconnected", replacementGamepad);
      controls.enabled = true;
      controls.update(0.2);

      expect(controls.gamepad).toBeNull();
      expect(controls.connectedGamepads).toEqual([activeGamepad]);
      expect(controls.updateDeltas).toEqual([0.1]);
      expect(polling.getGamepads).not.toHaveBeenCalled();
    },
  );
});
