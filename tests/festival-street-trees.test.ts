import { expect, it } from 'vitest';
import { trackPoint } from '../src/simulation/track.ts';
import { streetTrees } from '../src/simulation/open-world/street-trees.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import {
  regionStructures,
  StructureGrid,
  TREE_SPECIES,
  TREE_STRIDE,
  treesForTile,
} from '../src/simulation/open-world/placement.ts';
import { TILE_SIZE } from '../src/simulation/open-world/terrain-tiles.ts';
import { addStreetTreeGrate } from '../src/rendering/open-world/festival-footway.ts';
import { buildTileData, TILE_TREE_STRIDE } from '../src/rendering/open-world/tile-data.ts';

it('keeps street tree wells on their paved band, clear of the carriageway and frontages', () => {
  const world = openWorld(),
    plan = streetTrees(world.network),
    p = trackPoint();
  const structures = new StructureGrid(regionStructures(world));
  expect(plan.sites.length).toBeGreaterThan(100);
  for (const site of plan.sites) {
    expect(plan.rootHeight(site.x, site.z)).toBe(site.y);
    expect(structures.blocks(site.x, site.z, 0.84)).toBe(false);
    const lateral = world.network.nearest(site.x, site.z, p);
    const edge = world.network.edges[world.network.edgeOf[world.network.lastSegment]];
    expect(edge.roadClass).toBe('town');
    expect(Math.abs(lateral) - edge.spec.halfWidth).toBeCloseTo(1.04, 2);
    let corners = 0;
    addStreetTreeGrate(
      {
        vertex(x, y, z, _u, _v, nx, ny, nz) {
          expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);
          expect(ny).toBeGreaterThan(0.98);
          expect((x - site.x) * nx + (y - site.y - 0.006) * ny + (z - site.z) * nz).toBeCloseTo(
            0,
            6,
          );
          return corners++;
        },
        quad() {},
      },
      site,
    );
    expect(corners).toBe(4);
  }
});

it('streams precisely the collision-backed avenue trees even with optional plants at zero density', () => {
  const world = openWorld(),
    grid = new StructureGrid(regionStructures(world)),
    plan = streetTrees(world.network);
  const { x, z } = plan.sites[0],
    ix = Math.floor(x / TILE_SIZE),
    iz = Math.floor(z / TILE_SIZE);
  const expected = plan.inTile(ix, iz);
  const physics = treesForTile(world, ix, iz, grid, 1);
  const tile = buildTileData(world, grid, {
    type: 'tile',
    id: 1,
    x0: ix * TILE_SIZE,
    z0: iz * TILE_SIZE,
    size: TILE_SIZE,
    res: 16,
    trees: 0,
    colliders: true,
  });
  const rows = (data: Float32Array, stride: number) =>
    Array.from({ length: data.length / stride }, (_, i) =>
      Array.from(data.subarray(i * stride, (i + 1) * stride)),
    ).filter((row) => row[3] === TREE_SPECIES.STREET);
  expect(rows(physics, TREE_STRIDE).length).toBe(expected.length);
  expect(rows(tile.trees, TILE_TREE_STRIDE)).toEqual(
    rows(physics, TREE_STRIDE).map((row, i) => [...row, Math.fround(expected[i].y)]),
  );
});
