import { MeshoptEncoder } from 'meshoptimizer';

/** Build-time only. Invert the encoder's vertex remap so the existing immutable
 * vertex streams, skin weights, morphs and glTF associations remain untouched.
 * Call after MeshoptEncoder.ready. Transparent primitives must not use this. */
export function orderOpaqueTriangles(indices: Uint32Array, vertices: number): Uint32Array {
  if (
    !Number.isInteger(vertices) ||
    vertices < 1 ||
    vertices > 4000000 ||
    !indices.length ||
    indices.length % 3 ||
    indices.some((index) => index >= vertices)
  )
    throw new Error('Invalid triangle cache input');
  const result = indices.slice();
  const [remap, unique] = MeshoptEncoder.reorderMesh(result, true, false);
  const inverse = new Uint32Array(unique);
  for (let original = 0; original < remap.length; original++) {
    const reordered = remap[original];
    if (reordered !== 0xffffffff) inverse[reordered] = original;
  }
  for (let i = 0; i < result.length; i++) result[i] = inverse[result[i]];
  return result;
}

/** A reproducible locality diagnostic, NOT GPU timings or device FPS. */
export function fifoVertexMisses(indices: Uint32Array, vertices: number, size = 16): number {
  const last = new Uint32Array(vertices);
  let stamp = size + 1,
    misses = 0;
  for (const index of indices) {
    if (stamp - last[index] > size) {
      last[index] = stamp++;
      misses++;
    }
  }
  return misses;
}
