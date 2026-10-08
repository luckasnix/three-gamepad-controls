import type {
  Camera,
  OrthographicCamera,
  PerspectiveCamera,
  Vector2,
  Vector3,
} from "three";

/**
 * Reads the effective viewport dimensions at a world-space point.
 *
 * The caller updates camera world and projection matrices and owns both reusable
 * vectors. View offsets change dimensions, not the point's accumulated position.
 *
 * @param camera - Camera whose current projection is used.
 * @param worldPosition - World-space point, left unchanged.
 * @param target - Receives viewport width and height in world units.
 * @param cameraPosition - Scratch vector for camera-space depth.
 * @returns The target vector, or a unit viewport for an unknown camera type.
 */
export const getCameraViewSize = (
  camera: Camera,
  worldPosition: Vector3,
  target: Vector2,
  cameraPosition: Vector3,
): Vector2 => {
  if ((camera as OrthographicCamera).isOrthographicCamera === true) {
    const projection = camera.projectionMatrix.elements;
    return target.set(Math.abs(2 / projection[0]), Math.abs(2 / projection[5]));
  }
  if ((camera as PerspectiveCamera).isPerspectiveCamera === true) {
    cameraPosition.copy(worldPosition).applyMatrix4(camera.matrixWorldInverse);
    const depth = Math.max(Number.EPSILON, -cameraPosition.z);
    return (camera as PerspectiveCamera).getViewSize(depth, target);
  }
  return target.set(1, 1);
};
