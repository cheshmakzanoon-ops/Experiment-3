import { CubeCamera, type PerspectiveCamera } from 'three';
import { detailDistance } from './view-detail.ts';

/** Three's cube faces intentionally use a signed -90 degree projection to
 * orient their render target. Its optical extent is 90 degrees. Adapt only
 * that exact internal camera contract; invalid ordinary/user lenses still fail.
 * No camera projection, reflection orientation or main-view LOD is changed. */
export function cameraDetailDistance(distance: number, camera: PerspectiveCamera): number {
  const fov =
    camera.parent instanceof CubeCamera && camera.fov === -90 && camera.aspect === 1
      ? 90
      : camera.fov;
  return detailDistance(distance, fov, camera.aspect);
}
