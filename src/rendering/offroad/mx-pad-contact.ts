import * as T from 'three';
import type { Track } from '../../simulation/track.ts';
import { mxFurnitureGround } from './mx-ground-pose.ts';

// The perimeter of the lower stitched seam on the authored 0.68 × 2.10 m pad.
const HALF_WIDTH = 0.326;
const HALF_LENGTH = 1.034;
const HEM_Y = -0.277;
const MAX_STROKE = 0.16;

/** A foam pad can twist at its hem while its crown retains its shape. Six
 * measured contacts span its two long sides. Construct these displacements
 * once on the shared cage, including the change to its authored normals. */
export function prepareMxPadContact(geometry: T.BufferGeometry) {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = [];
  geometry.morphAttributes.normal = [];
  for (const side of [-1, 1]) {
    for (const end of [-1, 0, 1]) {
      const offsets = new Float32Array(position.count * 3);
      const normals = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i) / HALF_WIDTH;
        const z = position.getZ(i) / HALF_LENGTH;
        const across = (1 + side * x) / 2;
        // Quadratic interpolation through the front, centre and rear of each seam.
        const along = end === 0 ? 1 - z * z : (z * (z + end)) / 2;
        const slopeZ = (end === 0 ? -2 * z : z + end / 2) / HALF_LENGTH;
        const rise = T.MathUtils.clamp((position.getY(i) - HEM_Y) / 0.45, 0, 1);
        const skirt = 1 - rise * rise * (3 - 2 * rise);
        const h = MAX_STROKE * across * along;
        const dx = (MAX_STROKE * skirt * side * along) / (2 * HALF_WIDTH);
        const dy = (-h * 6 * rise * (1 - rise)) / 0.45;
        const dz = MAX_STROKE * skirt * across * slopeZ;
        offsets[i * 3 + 1] = h * skirt;
        // Inverse-transpose of (x, y + h, z), up to uniform normalization.
        // These deltas add exactly when several contacts deform the same vertex.
        normals[i * 3] = dy * normal.getX(i) - dx * normal.getY(i);
        normals[i * 3 + 2] = dy * normal.getZ(i) - dz * normal.getY(i);
      }
      geometry.morphAttributes.position.push(new T.BufferAttribute(offsets, 3));
      geometry.morphAttributes.normal.push(new T.BufferAttribute(normals, 3));
    }
  }
  // Each weight can be negative as well as positive. Bound the actual
  // quadratic basis at each vertex; the top of the pad stays at its moulded height.
  const bounds = new T.Box3();
  const point = new T.Vector3();
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    let stroke = 0;
    for (const target of geometry.morphAttributes.position) stroke += Math.abs(target.getY(i));
    point.y -= stroke;
    bounds.expandByPoint(point);
    point.y += 2 * stroke;
    bounds.expandByPoint(point);
  }
  geometry.boundingBox = bounds;
  geometry.boundingSphere = bounds.getBoundingSphere(new T.Sphere());
}

/** Fit the lower seam to the same dirt displayed below the rigid placement.
 * Work in the pad's normal direction, so a banked pad keeps its thickness.
 * Each instance uploads six weights once, shared by colour and shadow passes. */
export function fitMxPadContact(
  track: Track,
  mesh: T.InstancedMesh,
  matrices: readonly T.Matrix4[],
) {
  const probe = new T.Mesh(mesh.geometry, mesh.material);
  const weights = probe.morphTargetInfluences!;
  const point = new T.Vector3();
  matrices.forEach((matrix, i) => {
    mesh.setMatrixAt(i, matrix);
    let j = 0;
    for (const side of [-1, 1]) {
      for (const end of [-1, 0, 1]) {
        point.set(side * HALF_WIDTH, HEM_Y, end * HALF_LENGTH).applyMatrix4(matrix);
        const gap = mxFurnitureGround(track, point.x, point.z) - 0.012 - point.y;
        // Signed distance to the locally fitted terrain plane.
        weights[j++] = T.MathUtils.clamp((gap * matrix.elements[5]) / MAX_STROKE, -1, 1);
      }
    }
    mesh.setMorphAt(i, probe);
  });
  mesh.morphTexture!.needsUpdate = true;
}
