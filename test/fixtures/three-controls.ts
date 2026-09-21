import {
  BoxGeometry,
  type BufferGeometry,
  type Event,
  type EventDispatcher,
  Line,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Points,
  Scene,
} from "three";

import type {
  GamepadFrameEntry,
  GamepadPollingFixture,
} from "./gamepad-browser.ts";

type CleanupPhase = "wrapper" | "listener" | "native" | "resource" | "dom";

const cleanupOrder: CleanupPhase[] = [
  "wrapper",
  "listener",
  "native",
  "resource",
  "dom",
];

/** Register dispose with Vitest onCleanup BEFORE constructing test resources. */
export const createCleanup = () => {
  const callbacks = new Map<CleanupPhase, (() => void)[]>();

  return {
    add(phase: CleanupPhase, callback: () => void): void {
      const group = callbacks.get(phase) ?? [];
      group.push(callback);
      callbacks.set(phase, group);
    },
    /** Drains once, and releases remaining resources even if a disposer throws. */
    dispose(): void {
      const errors: unknown[] = [];
      for (const phase of cleanupOrder) {
        const group = callbacks.get(phase) ?? [];
        callbacks.delete(phase);
        for (const callback of group.reverse()) {
          try {
            callback();
          } catch (error) {
            errors.push(error);
          }
        }
      }
      if (errors.length)
        throw new AggregateError(errors, "Fixture cleanup failed");
    },
  };
};

export type Cleanup = ReturnType<typeof createCleanup>;

/** Only use for resources owned by the test and not disposed by native controls. */
export const disposeObjectResources = (root: Object3D): void => {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  root.traverse((object) => {
    if (
      object instanceof Mesh ||
      object instanceof Line ||
      object instanceof Points
    ) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        materials.add(material);
      }
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  root.removeFromParent();
};

export const createThreeEnvironment = (
  cleanup: Cleanup,
  projection: "perspective" | "orthographic" = "perspective",
) => {
  const element = document.createElement("div");
  cleanup.add("dom", () => element.remove());
  element.style.cssText =
    "position:fixed;left:0;top:0;width:800px;height:600px;";
  document.body.append(element);
  const scene = new Scene();
  const camera =
    projection === "perspective"
      ? new PerspectiveCamera(60, 4 / 3, 0.1, 1000)
      : new OrthographicCamera(-8, 8, 6, -6, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  const geometry = new BoxGeometry(2, 2, 2);
  cleanup.add("resource", () => geometry.dispose());
  const material = new MeshBasicMaterial();
  cleanup.add("resource", () => material.dispose());
  const mesh = new Mesh(geometry, material);
  scene.add(mesh);
  cleanup.add("resource", () => scene.clear());
  const syncMatrices = (): void => {
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    // Also updates TransformControls' helper when it is attached to the scene.
    scene.updateMatrixWorld(true);
  };
  syncMatrices();

  return {
    element,
    scene,
    camera,
    mesh,
    syncMatrices,
  };
};

/** Capture selected event data, never the mutable Three.js event object itself. */
export const collectEvents = <
  T extends object,
  K extends Extract<keyof T, string>,
  D,
>(
  cleanup: Cleanup,
  dispatcher: EventDispatcher<T>,
  types: readonly K[],
  source: string,
  snapshot: (event: T[K] & Event<K, EventDispatcher<T>>) => D,
) => {
  const records: { type: K; source: string; data: D }[] = [];
  for (const type of types) {
    const listener = (event: T[K] & Event<K, EventDispatcher<T>>): void => {
      records.push({
        type: event.type,
        source,
        data: structuredClone(snapshot(event)),
      });
    };
    dispatcher.addEventListener(type, listener);
    cleanup.add("listener", () =>
      dispatcher.removeEventListener(type, listener),
    );
  }

  return records;
};

/** Native callback is explicit: Arcball/Drag/Transform/PointerLock omit it. */
export const createFrameDriver =
  (
    polling: GamepadPollingFixture,
    syncMatrices: () => void,
    wrapper: { update(delta: number): void },
    updateNative?: (delta: number) => void,
  ) =>
  (entries: readonly GamepadFrameEntry[], delta = 1 / 60): void => {
    polling.publishFrame(...entries);
    syncMatrices();
    wrapper.update(delta);
    updateNative?.(delta);
    syncMatrices();
  };
