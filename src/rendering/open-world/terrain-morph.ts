import type { TileMeshData } from '../../workers/open-world-protocol.ts';

/** Sample the same a-d triangle split as the physics and rendered heightfield.
 * Bilinear interpolation would bend a child away from its parent's triangles
 * before the transition had even begun. */
function sample(
  values: Float32Array,
  width: number,
  stride: number,
  x: number,
  z: number,
  component: number,
) {
  const i = Math.min(width - 2, Math.max(0, Math.floor(x))),
    j = Math.min(width - 2, Math.max(0, Math.floor(z))),
    u = x - i,
    v = z - j,
    a = (j * width + i) * stride + component,
    b = a + stride,
    c = a + width * stride,
    d = c + stride;
  return u >= v
    ? values[a] * (1 - u) + values[b] * (u - v) + values[d] * v
    : values[a] * (1 - v) + values[c] * (v - u) + values[d] * u;
}

/** Absolute native morph target, including skirt vertices. Position and normal
 * targets are consumed by Three's standard visible and depth/shadow shaders.
 * The two material masks use the same influence in the terrain material. */
export function terrainParentMorph(
  positions: Float32Array,
  normals: Float32Array,
  child: TileMeshData,
  parent: TileMeshData,
  childRes: number,
  parentRes: number,
  quadrantX: number,
  quadrantZ: number,
) {
  const position = positions.slice(),
    normal = normals.slice(),
    count = positions.length / 3,
    splat = new Float32Array(count * 4),
    shade = new Float32Array(count * 4),
    side = childRes + 1,
    base = side * side;
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++) {
      const v = j * side + i,
        x = (quadrantX + i / childRes) * parentRes * 0.5,
        z = (quadrantZ + j / childRes) * parentRes * 0.5,
        h = sample(parent.heights, parentRes + 1, 1, x, z, 0),
        // Preserve the fully carved road bed/shoulder instead of letting a
        // lower-resolution ancestor raise terrain through the road ribbon.
        road = Math.min(1, Math.max(0, child.shade[v * 4])),
        pin = road * road;
      position[v * 3 + 1] = h + (child.heights[v] - h) * pin;
      let length = 0;
      for (let c = 0; c < 3; c++) {
        const coarse = sample(parent.normals, parentRes + 1, 3, x, z, c);
        const value = coarse + (normals[v * 3 + c] - coarse) * pin;
        normal[v * 3 + c] = value;
        length += value * value;
      }
      length = Math.sqrt(length);
      if (length > 1e-8) for (let c = 0; c < 3; c++) normal[v * 3 + c] /= length;
      else normal[v * 3 + 1] = 1;
      for (let c = 0; c < 4; c++) {
        const coarseSplat = sample(parent.splat, parentRes + 1, 4, x, z, c),
          coarseShade = sample(parent.shade, parentRes + 1, 4, x, z, c);
        splat[v * 4 + c] = coarseSplat + (child.splat[v * 4 + c] - coarseSplat) * pin;
        shade[v * 4 + c] = coarseShade + (child.shade[v * 4 + c] - coarseShade) * pin;
      }
    }
  const edges = [
    (k: number) => k,
    (k: number) => childRes * side + k,
    (k: number) => k * side,
    (k: number) => k * side + childRes,
  ];
  edges.forEach((edge, e) => {
    for (let k = 0; k < side; k++) {
      const from = edge(k),
        to = base + e * side + k,
        drop = positions[from * 3 + 1] - positions[to * 3 + 1];
      position[to * 3 + 1] = position[from * 3 + 1] - drop;
      for (let c = 0; c < 3; c++) normal[to * 3 + c] = normal[from * 3 + c];
      for (let c = 0; c < 4; c++) {
        splat[to * 4 + c] = splat[from * 4 + c];
        shade[to * 4 + c] = shade[from * 4 + c];
      }
    }
  });
  return { position, normal, splat, shade };
}
