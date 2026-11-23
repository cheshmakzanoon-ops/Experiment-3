import type { PerspectiveCamera, Vector3 } from 'three';

/** Finest GP opponent detail the current image can resolve. The 2.24 m
 * envelope covers either prototype and its tucked rider in any orientation.
 * Its near surface keeps an oblique bike sharp at the edge of the frame. */
export function gpOpponentDetail(
  camera: PerspectiveCamera,
  position: Vector3,
  bufferHeight: number,
  previous: number,
): 0 | 1 | 2 {
  const view = camera.matrixWorldInverse.elements;
  const depth = -(view[2] * position.x + view[6] * position.y + view[10] * position.z + view[14]);
  const radius = 1.12;
  const pixels =
    (bufferHeight * camera.projectionMatrix.elements[5] * radius) /
    Math.max(Math.abs(depth) - radius, camera.near);
  // The full model resolves separate brake, wheel and rider hardware. The
  // middle model keeps articulated suspension, silhouette and printed kit.
  if (pixels >= (previous === 0 ? 78 : 92)) return 0;
  if (pixels >= (previous === 2 ? 22 : 17)) return 1;
  return 2;
}
