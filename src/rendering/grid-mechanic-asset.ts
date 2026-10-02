import * as T from 'three';
import data from './grid-mechanic.geometry.json' with { type: 'json' };
import manifest from './grid-mechanic.manifest.json' with { type: 'json' };

export const GRID_MECHANIC_ASSET = Object.freeze({ ...manifest, finalArtApproved: false });

/** Original Blender-authored close-up garment; the shared 15-bone rig and all
 * wrist/boot sockets stay compatible with the retained pit crew. Owned buffers. */
export function gridMechanicGeometry() {
  const n = data.position.length / 3;
  if (data.version !== 1 || n !== manifest.vertices || data.index.length !== manifest.triangles * 3)
    throw new Error('Invalid grid mechanic topology');
  const g = new T.BufferGeometry();
  for (const [name, values, size] of [
    ['position', data.position, 3],
    ['normal', data.normal, 3],
    ['color', data.color, 3],
    ['uv', data.uv, 2],
    ['crewJoint', data.joints, 4],
    ['crewWeight', data.weights, 4],
    ['crewCloth', data.cloth, 1],
  ] as const) {
    if (values.length !== n * size || !values.every(Number.isFinite))
      throw new Error(`Invalid grid mechanic ${name}`);
    g.setAttribute(name, new T.Float32BufferAttribute(values, size));
  }
  if (data.index.some((i) => !Number.isInteger(i) || i < 0 || i >= n))
    throw new Error('Invalid mechanic indices');
  g.setIndex(data.index);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.name = 'Blender-authored grid mechanic hero';
  return g;
}
