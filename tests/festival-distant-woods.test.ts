import * as T from 'three';
import { expect, it, vi } from 'vitest';
import { buildTileData, TILE_TREE_STRIDE } from '../src/rendering/open-world/tile-data.ts';
import { Vegetation } from '../src/rendering/open-world/vegetation.ts';
import {
  StructureGrid,
  regionStructures,
  TREE_SPECIES,
  TREE_STRIDE,
  treesForTile,
} from '../src/simulation/open-world/placement.ts';
import { gridHeight, TILE_SIZE } from '../src/simulation/open-world/terrain-tiles.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';

vi.mock('../src/rendering/landscape.ts', async (original) => ({
  ...(await original<typeof import('../src/rendering/landscape.ts')>()),
  foliageAtlas: () => new T.DataTexture(new Uint8Array([60, 82, 41, 255]), 1, 1),
}));

it('uses an exact subset of the close forest and submits a single rooted draw across a kilometre of hillside', () => {
  const world = openWorld(),
    structures = new StructureGrid(regionStructures(world));
  const x0 = -4096,
    z0 = 2048,
    size = TILE_SIZE * 4,
    res = 32,
    step = size / res;
  const data = buildTileData(world, structures, {
    type: 'tile',
    id: 1,
    x0,
    z0,
    size,
    res,
    trees: 0.175,
  });
  const near = new Set<string>();
  for (let dz = 0; dz < 4; dz++)
    for (let dx = 0; dx < 4; dx++) {
      const trees = treesForTile(world, x0 / TILE_SIZE + dx, z0 / TILE_SIZE + dz, structures, 0.7);
      for (let i = 0; i < trees.length; i += TREE_STRIDE)
        near.add(trees[i] + ',' + trees[i + 1] + ',' + trees[i + 2]);
    }
  const count = data.trees.length / TILE_TREE_STRIDE;
  expect(count).toBeGreaterThan(30);
  expect(count).toBeLessThan(near.size / 2);
  for (let i = 0; i < data.trees.length; i += TILE_TREE_STRIDE) {
    const t = data.trees;
    expect(near.has(t[i] + ',' + t[i + 1] + ',' + t[i + 2])).toBe(true);
    expect(t[i + 3]).not.toBe(TREE_SPECIES.SHRUB);
    expect(t[i + 6]).toBeCloseTo(
      gridHeight(data.heights, res + 1, (t[i] - x0) / step, (t[i + 1] - z0) / step, step),
      3,
    );
  }
  const vegetation = new Vegetation();
  vegetation.sync(new Map([[1, { data, level: 2 }]]));
  const meshes: T.InstancedMesh[] = [];
  vegetation.root.traverse((n) => {
    if (n instanceof T.InstancedMesh) meshes.push(n);
  });
  expect(meshes).toHaveLength(1);
  expect(meshes[0].count).toBe(count);
  expect(meshes[0].castShadow).toBe(false);
  expect(meshes[0].geometry.index!.count / 3).toBeLessThanOrEqual(12);
  vegetation.dispose();
});
