import {
  type Camera,
  type Intersection,
  Matrix4,
  type Object3D,
  type OrthographicCamera,
  type PerspectiveCamera,
  Vector2,
  Vector3,
} from "three";
import type { DragControls } from "three/addons/controls/DragControls.js";

import { GAMEPAD_AXIS, GAMEPAD_BUTTON } from "./core.ts";
import {
  GamepadControls,
  type GamepadControlsOptions,
} from "./gamepad-controls.ts";
import {
  DEFAULT_GAMEPAD_STICK_PIPELINE,
  type GamepadStickBinding,
  type GamepadStickBindingOptions,
  resolveGamepadStickBinding,
} from "./gamepad-stick-processing.ts";

/**
 * Configuration for {@link GamepadDragControls}.
 *
 * Every property has a sensible default, so you only need to pass the properties you want to override.
 */
export type GamepadDragControlsOptions = GamepadControlsOptions & {
  /**
   * Screen-relative translation speed multiplier.
   * @default 1.0
   */
  dragSpeed: number;

  /**
   * Multiplier on `DragControls.rotateSpeed` for rotation.
   * @default 1.0
   */
  rotateSpeed: number;

  /**
   * Stick binding used for screen-relative dragging.
   * @default Left stick with the default stick pipeline
   */
  dragStick: GamepadStickBindingOptions;

  /**
   * Stick binding used for object rotation.
   * @default Right stick with the default stick pipeline
   */
  rotateStick: GamepadStickBindingOptions;

  /**
   * Button index for grabbing and dropping the object under the center reticle.
   * @default 0 - South face button
   */
  buttonSelect: number;
};

type ResolvedGamepadDragControlsOptions = Omit<
  GamepadDragControlsOptions,
  "dragStick" | "rotateStick"
> & {
  dragStick: GamepadStickBinding;
  rotateStick: GamepadStickBinding;
};

// Default options merged in the constructor when no explicit configuration is provided.
const DEFAULT_DRAG_OPTIONS: ResolvedGamepadDragControlsOptions = {
  dragSpeed: 1.0,
  rotateSpeed: 1.0,
  dragStick: {
    xAxis: GAMEPAD_AXIS.LeftX,
    yAxis: GAMEPAD_AXIS.LeftY,
    pipeline: DEFAULT_GAMEPAD_STICK_PIPELINE,
  },
  rotateStick: {
    xAxis: GAMEPAD_AXIS.RightX,
    yAxis: GAMEPAD_AXIS.RightY,
    pipeline: DEFAULT_GAMEPAD_STICK_PIPELINE,
  },
  buttonSelect: GAMEPAD_BUTTON.South,
};

type DragControlsWithCamera = DragControls & {
  // Camera used by DragControls for raycasting.
  object: Camera;
};

type GroupLikeObject = Object3D & {
  // Runtime flag set by Three.js `Group` instances.
  isGroup?: boolean;
};

/**
 * Adds gamepad support to Three.js `DragControls`.
 *
 * The center of the viewport acts as a logical reticle. Press the select button
 * once to grab the centered object and again to drop it.
 */
export class GamepadDragControls extends GamepadControls {
  readonly #controls: DragControlsWithCamera;
  readonly #options: ResolvedGamepadDragControlsOptions;

  readonly #centerNdc: Vector2;
  readonly #intersections: Intersection[];
  readonly #parentInverse: Matrix4;
  readonly #selectedWorldPosition: Vector3;
  readonly #selectedLocalPosition: Vector3;
  readonly #cameraWorldPosition: Vector3;
  readonly #cameraForward: Vector3;
  readonly #cameraRight: Vector3;
  readonly #cameraUp: Vector3;
  readonly #cameraToSelected: Vector3;
  readonly #viewSize: Vector2;

  #hovered: Object3D | null = null;
  #selected: Object3D | null = null;

  /**
   * @param controls - A Three.js `DragControls` instance.
   * @param options - Optional overrides for the default behavior.
   *                  Any property not provided falls back to its default value.
   */
  constructor(
    controls: DragControls,
    options?: Partial<GamepadDragControlsOptions>,
  ) {
    super(options);
    this.#controls = controls as DragControlsWithCamera;
    this.#options = {
      ...DEFAULT_DRAG_OPTIONS,
      ...options,
      dragStick: resolveGamepadStickBinding(
        DEFAULT_DRAG_OPTIONS.dragStick,
        options?.dragStick,
      ),
      rotateStick: resolveGamepadStickBinding(
        DEFAULT_DRAG_OPTIONS.rotateStick,
        options?.rotateStick,
      ),
    };

    this.#centerNdc = new Vector2(0, 0);
    this.#intersections = [];
    this.#parentInverse = new Matrix4();
    this.#selectedWorldPosition = new Vector3();
    this.#selectedLocalPosition = new Vector3();
    this.#cameraWorldPosition = new Vector3();
    this.#cameraForward = new Vector3();
    this.#cameraRight = new Vector3();
    this.#cameraUp = new Vector3();
    this.#cameraToSelected = new Vector3();
    this.#viewSize = new Vector2();
  }

  /**
   * Maps the current gamepad state to `DragControls` hover, grab/drop, drag,
   * and rotate behavior.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  protected override onUpdate(deltaTime: number): void {
    const controls = this.#controls;
    const selectStarted = this.gamepadInput.wasPressed(
      this.#options.buttonSelect,
    );

    if (!controls.enabled) {
      this.#releaseSelected();
      this.#clearHover();
      return;
    }

    if (this.#selected !== null) {
      if (selectStarted) {
        this.#releaseSelected();
        return;
      }

      this.#updateSelected(deltaTime);
      return;
    }

    const hit = this.#intersectCenter();
    this.#updateHover(hit?.object ?? null);

    if (selectStarted && hit !== undefined) {
      this.#grabObject(hit.object);
    }
  }

  /**
   * Releases any selected object and removes hover state before disposing the
   * gamepad lifecycle listeners.
   */
  public override dispose(): void {
    this.#releaseSelected();
    this.#clearHover();
    super.dispose();
  }

  /**
   * Releases the selected object if the active gamepad disconnects mid-drag.
   *
   * @param gamepad - The gamepad that just disconnected.
   */
  protected override onGamepadDisconnected(gamepad: Gamepad): void {
    this.#releaseSelected();
    this.#clearHover();
    super.onGamepadDisconnected(gamepad);
  }

  /**
   * Updates the selected object from gamepad drag and rotation input.
   *
   * @param deltaTime - Seconds since the last frame.
   */
  #updateSelected(deltaTime: number): void {
    const selected = this.#selected;

    if (selected === null) {
      return;
    }

    const { dragSpeed, rotateSpeed, dragStick, rotateStick } = this.#options;
    const input = this.gamepadInput;

    const drag = input.stick(
      dragStick.xAxis,
      dragStick.yAxis,
      dragStick.pipeline,
    );
    const rotate = input.stick(
      rotateStick.xAxis,
      rotateStick.yAxis,
      rotateStick.pipeline,
    );

    const dragged = this.#applyDrag(deltaTime, drag.x, drag.y, dragSpeed);
    const rotated = this.#applyRotation(
      deltaTime,
      rotate.x,
      rotate.y,
      rotateSpeed,
    );

    if (dragged || rotated) {
      this.#controls.dispatchEvent({
        type: "drag",
        object: selected,
      });
    }
  }

  /**
   * Moves the selected object in the camera-facing plane.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param dragX - Horizontal drag input after dead zone processing.
   * @param dragY - Vertical drag input after dead zone processing.
   * @param dragSpeed - User-configured drag speed multiplier.
   * @returns `true` when the selected object moved.
   */
  #applyDrag(
    deltaTime: number,
    dragX: number,
    dragY: number,
    dragSpeed: number,
  ): boolean {
    const selected = this.#selected;

    if (selected === null || (dragX === 0 && dragY === 0)) {
      return false;
    }

    this.#updateCameraAxes();
    this.#updateViewSizeAtSelectedDepth();

    const scale = dragSpeed * deltaTime;
    this.#selectedWorldPosition.addScaledVector(
      this.#cameraRight,
      dragX * this.#viewSize.x * scale,
    );
    this.#selectedWorldPosition.addScaledVector(
      this.#cameraUp,
      -dragY * this.#viewSize.y * scale,
    );

    this.#applySelectedWorldPosition();

    return true;
  }

  /**
   * Rotates the selected object around camera-relative world axes.
   *
   * @param deltaTime - Seconds since the last frame.
   * @param rotateX - Horizontal rotation input after dead zone processing.
   * @param rotateY - Vertical rotation input after dead zone processing.
   * @param rotateSpeed - User-configured rotation speed multiplier.
   * @returns `true` when the selected object rotated.
   */
  #applyRotation(
    deltaTime: number,
    rotateX: number,
    rotateY: number,
    rotateSpeed: number,
  ): boolean {
    const selected = this.#selected;

    if (selected === null || (rotateX === 0 && rotateY === 0)) {
      return false;
    }

    this.#updateCameraAxes();

    const scale =
      this.#controls.rotateSpeed * rotateSpeed * deltaTime * Math.PI;

    if (rotateX !== 0) {
      selected.rotateOnWorldAxis(this.#cameraUp, rotateX * scale);
    }

    if (rotateY !== 0) {
      selected.rotateOnWorldAxis(this.#cameraRight, rotateY * scale);
    }

    return true;
  }

  /**
   * Raycasts from the center of the viewport into DragControls objects.
   *
   * @returns The closest center hit, or `undefined` when nothing is hit.
   */
  #intersectCenter(): Intersection | undefined {
    const controls = this.#controls;

    this.#intersections.length = 0;
    controls.raycaster.setFromCamera(this.#centerNdc, controls.object);
    controls.raycaster.intersectObjects(
      controls.objects,
      controls.recursive,
      this.#intersections,
    );

    return this.#intersections[0];
  }

  /**
   * Updates DragControls hover state for the object under the center reticle.
   *
   * @param object - Object currently under the reticle, or `null`.
   */
  #updateHover(object: Object3D | null): void {
    if (this.#hovered === object) {
      return;
    }

    this.#clearHover();

    if (object === null) {
      return;
    }

    this.#hovered = object;
    this.#controls.dispatchEvent({
      type: "hoveron",
      object,
    });
  }

  // Clears the current hover object and dispatches `hoveroff` when needed.
  #clearHover(): void {
    if (this.#hovered === null) {
      return;
    }

    const object = this.#hovered;
    this.#hovered = null;
    this.#controls.dispatchEvent({
      type: "hoveroff",
      object,
    });
  }

  /**
   * Selects an object and dispatches DragControls `dragstart`.
   *
   * @param object - Object hit by the center reticle.
   */
  #grabObject(object: Object3D): void {
    const selected = this.#getSelectedObject(object);

    selected.updateWorldMatrix(true, false);
    this.#selected = selected;
    this.#selectedWorldPosition.setFromMatrixPosition(selected.matrixWorld);

    this.#controls.dispatchEvent({
      type: "dragstart",
      object: selected,
    });
  }

  // Releases the selected object and dispatches DragControls `dragend`.
  #releaseSelected(): void {
    if (this.#selected === null) {
      return;
    }

    const selected = this.#selected;
    this.#selected = null;
    this.#controls.dispatchEvent({
      type: "dragend",
      object: selected,
    });
  }

  /**
   * Resolves which object should be dragged for a reticle hit.
   *
   * @param object - Object hit by the center reticle.
   * @returns The hit object, or its outermost group when group dragging is enabled.
   */
  #getSelectedObject(object: Object3D): Object3D {
    if (!this.#controls.transformGroup) {
      return object;
    }

    return this.#findOutermostGroup(object) ?? object;
  }

  /**
   * Finds the highest ancestor that is a Three.js `Group`.
   *
   * @param object - Object where the ancestor search starts.
   * @returns The outermost group ancestor, or `null` when none exists.
   */
  #findOutermostGroup(object: Object3D): Object3D | null {
    let group: Object3D | null = null;
    let current: Object3D | null = object;

    while (current !== null) {
      if ((current as GroupLikeObject).isGroup === true) {
        group = current;
      }

      current = current.parent;
    }

    return group;
  }

  // Writes the accumulated world-space selected position back to the object.
  #applySelectedWorldPosition(): void {
    const selected = this.#selected;

    if (selected === null) {
      return;
    }

    if (selected.parent === null) {
      selected.position.copy(this.#selectedWorldPosition);
      selected.updateMatrixWorld();
      return;
    }

    selected.parent.updateWorldMatrix(true, false);
    this.#parentInverse.copy(selected.parent.matrixWorld).invert();
    this.#selectedLocalPosition
      .copy(this.#selectedWorldPosition)
      .applyMatrix4(this.#parentInverse);
    selected.position.copy(this.#selectedLocalPosition);
    selected.updateMatrixWorld();
  }

  // Refreshes camera-relative axes used for dragging and rotation.
  #updateCameraAxes(): void {
    const camera = this.#controls.object;

    this.#cameraRight
      .set(1, 0, 0)
      .applyQuaternion(camera.quaternion)
      .normalize();
    this.#cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    camera.getWorldDirection(this.#cameraForward).normalize();
  }

  // Computes the world-space viewport size at the selected object's depth.
  #updateViewSizeAtSelectedDepth(): void {
    const camera = this.#controls.object;

    if (this.#isOrthographicCamera(camera)) {
      this.#viewSize.set(
        Math.abs(camera.right - camera.left) / camera.zoom,
        Math.abs(camera.top - camera.bottom) / camera.zoom,
      );
      return;
    }

    if (this.#isPerspectiveCamera(camera)) {
      camera.getWorldPosition(this.#cameraWorldPosition);
      const depth = Math.max(
        Number.EPSILON,
        this.#cameraToSelected
          .copy(this.#selectedWorldPosition)
          .sub(this.#cameraWorldPosition)
          .dot(this.#cameraForward),
      );
      const height = 2 * Math.tan((camera.fov * Math.PI) / 360) * depth;
      this.#viewSize.set(height * camera.aspect, height);
      return;
    }

    this.#viewSize.set(1, 1);
  }

  /**
   * Narrows a Three.js camera to `PerspectiveCamera`.
   *
   * @param camera - Camera to inspect.
   * @returns `true` when the camera is perspective.
   */
  #isPerspectiveCamera(camera: Camera): camera is PerspectiveCamera {
    return (camera as PerspectiveCamera).isPerspectiveCamera === true;
  }

  /**
   * Narrows a Three.js camera to `OrthographicCamera`.
   *
   * @param camera - Camera to inspect.
   * @returns `true` when the camera is orthographic.
   */
  #isOrthographicCamera(camera: Camera): camera is OrthographicCamera {
    return (camera as OrthographicCamera).isOrthographicCamera === true;
  }
}
