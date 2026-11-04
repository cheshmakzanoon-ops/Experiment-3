import * as T from 'three';
import type { ShowroomBox } from './menu-preview.ts';

/** The drawn extent of the showroom machine across its width (x) and length (z), in metres in the
 * machine's own frame, measured from the visible meshes. The collision box is symmetric about the
 * origin and a little off the real silhouette (an F1-style nose and wing sit about 0.2 m further
 * forward than the tail), which is enough to leave a car hard against the menu board and short of the
 * paddock rail even when the camera is aimed at the middle of the strip. A measurement outside a sane
 * band around the collision box (a stray shadow plane, a model that has not loaded yet) is ignored. */
export function measureShowroomBox(
  root: T.Object3D,
  fallback: { halfWidth: number; halfLength: number },
): ShowroomBox {
  const symmetric: ShowroomBox = {
    minX: -fallback.halfWidth,
    maxX: fallback.halfWidth,
    minZ: -fallback.halfLength,
    maxZ: fallback.halfLength,
  };
  // Measure upright and unrotated so the world box is the local box, then put the pose back.
  const pose = new T.Quaternion().copy(root.quaternion);
  const origin = new T.Vector3().copy(root.position);
  root.quaternion.identity();
  root.position.set(0, 0, 0);
  root.updateMatrixWorld(true);
  const box = new T.Box3();
  const corner = new T.Vector3();
  const visit = (object: T.Object3D) => {
    if (!object.visible) return;
    const mesh = object as T.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      const geometry = mesh.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const bounds = geometry.boundingBox;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      // Flat translucent planes are shadows and decals, not the machine.
      const flat = bounds && bounds.max.y - bounds.min.y < 0.02;
      if (bounds && !(flat && material?.transparent))
        for (const x of [bounds.min.x, bounds.max.x])
          for (const y of [bounds.min.y, bounds.max.y])
            for (const z of [bounds.min.z, bounds.max.z])
              box.expandByPoint(corner.set(x, y, z).applyMatrix4(mesh.matrixWorld));
    }
    for (const child of object.children) visit(child);
  };
  visit(root);
  root.quaternion.copy(pose);
  root.position.copy(origin);
  root.updateMatrixWorld(true);
  if (box.isEmpty()) return symmetric;
  const widthOk = (box.max.x - box.min.x) / (2 * fallback.halfWidth);
  const lengthOk = (box.max.z - box.min.z) / (2 * fallback.halfLength);
  if (!(widthOk > 0.6 && widthOk < 1.5 && lengthOk > 0.6 && lengthOk < 1.4)) return symmetric;
  return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
}
