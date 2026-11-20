import { describe, expect, it } from 'vitest';
import { terrainPatchIndex } from '../src/rendering/open-world/terrain-topology.ts';

import { buildTileData } from '../src/rendering/open-world/tile-data.ts';
import { StructureGrid } from '../src/simulation/open-world/placement.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';

function fixture(res = 16) {
  const side = res + 1,
    n = side * side,
    p = new Float32Array(n * 3),
    normals = new Float32Array(n * 3);
  const shade = new Float32Array(n * 4),
    splat = new Float32Array(n * 4),
    list: number[] = [];
  for (let z = 0; z <= res; z++)
    for (let x = 0; x <= res; x++) {
      const i = z * side + x;
      p.set([x, 1 + x * 0.0125 - z * 0.02, z], i * 3);
      normals.set([-0.0125, 1, 0.02], i * 3);
      shade[i * 4] = x * 0.01;
      if (x < res && z < res) list.push(i, i + 1 + side, i + 1, i, i + side, i + side + 1);
    }
  // Separately identifiable sentinel data stands in for the skirt.
  list.push(n, n + 1, n + 2, n + 3, n + 4, n + 5);
  return {
    res,
    side,
    full: Uint16Array.from(list),
    surface: { position: p, normal: normals, splat, shade },
  };
}
describe('Festival terrain patch detail', () => {
  it('keeps the full perimeter winding, skirts and interpolated height at every point on a planar tile', () => {
    const { res, side, full, surface } = fixture();
    const idx = terrainPatchIndex(res, full, surface);
    expect(idx.length).toBeLessThan(full.length * 0.3);
    expect(idx.slice(-6)).toEqual(full.slice(-6));
    let doubleArea = 0;
    const used = new Set<number>();
    for (let i = 0; i < idx.length - 6; i += 3) {
      const [a, b, c] = idx.subarray(i, i + 3);
      [a, b, c].forEach((v) => used.add(v));
      const ax = a % side,
        az = Math.floor(a / side),
        bx = b % side,
        bz = Math.floor(b / side),
        cx = c % side,
        cz = Math.floor(c / side);
      const area = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      expect(area).toBeGreaterThan(0);
      doubleArea += area;
      const expected = 1 + ((ax + bx + cx) / 3) * 0.0125 - ((az + bz + cz) / 3) * 0.02;
      expect(
        (surface.position[a * 3 + 1] + surface.position[b * 3 + 1] + surface.position[c * 3 + 1]) /
          3,
      ).toBeCloseTo(expected, 5);
    }
    expect(doubleArea).toBe(2 * res * res);
    for (let j = 0; j <= res; j++)
      for (const i of [j, res * side + j, j * side, j * side + res]) expect(used.has(i)).toBe(true);
  });
  it.each(['position', 'normal', 'splat', 'shade'] as const)(
    'retains a local %s discontinuity even when it exists only on the parent',
    (field) => {
      const { res, side, full, surface } = fixture(),
        parent = fixture().surface;
      const stride = field === 'position' || field === 'normal' ? 3 : 4,
        offset = field === 'position' ? 1 : 0;
      const v = side + 2;
      parent[field][v * stride + offset] += 0.08;
      for (const [fine, coarse] of [
        [surface, parent],
        [parent, surface],
      ]) {
        const idx = terrainPatchIndex(res, full, fine, coarse);
        // The four cells immediately around this spike retain their original physical diagonal.
        const faces = new Set<string>();
        for (let i = 0; i < idx.length - 6; i += 3) faces.add(idx.subarray(i, i + 3).join(','));
        for (const a of [v - side - 1, v - side, v - 1, v]) {
          expect(faces.has([a, a + side + 1, a + 1].join(','))).toBe(true);
          expect(faces.has([a, a + side, a + side + 1].join(','))).toBe(true);
        }
      }
    },
  );
});

it('classifies Port Ilse paving separately from airfield and village surfaces in the tile worker', () => {
  const world = openWorld(),
    structures = new StructureGrid([]);
  for (const [x0, z0, expected] of [
    [1100, -2500, 1],
    [2600, 1700, -1],
    [-700, 750, -0.6],
  ]) {
    const tile = buildTileData(world, structures, {
      type: 'tile',
      id: 1,
      x0,
      z0,
      size: 16,
      res: 4,
      trees: 0,
    });
    for (let i = 3; i < tile.shade.length; i += 4) expect(tile.shade[i]).toBeCloseTo(expected, 5);
  }
});
