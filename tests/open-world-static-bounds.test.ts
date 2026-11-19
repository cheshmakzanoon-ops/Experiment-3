import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_TRUNK_RADIUS,
  StructureGrid,
  TREE_STRIDE,
  trunkRadius,
  type Structure,
} from '../src/simulation/open-world/placement.ts';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { StaticFootprintContact } from '../src/simulation/open-world/static-footprint.ts';
import { TILE_SIZE } from '../src/simulation/open-world/terrain-tiles.ts';
import type { Vehicle } from '../src/simulation/vehicle.ts';

type StaticOwner = {
  trees: Map<number, Float32Array>;
  treesAt(x: number, z: number): Float32Array;
  collideStatic(car: Vehicle): void;
};
const empty = new Float32Array();
function structure(x: number, z: number, hx: number, hz: number, heading = 0): Structure {
  return { kind: 'shop', x, z, hx, hz, heading, height: 5, base: 0, floors: 1, style: 0 };
}
function fixture(items: Structure[] = [], tileBudget = 4) {
  const sim = new OpenWorldSimulation({ vehicle: 'tc1', traffic: false, tileBudget });
  Object.assign(sim, { structures: items, structureGrid: new StructureGrid(items) });
  const owner = sim as unknown as StaticOwner,
    car = sim.player;
  car.body.orientation.yaw(0);
  car.forward.set(0, 0, 1);
  car.up.set(0, 1, 0);
  car.body.position.set(10, car.definition.halfExtents[1], 10);
  car.body.velocity.set(0, 0, 0);
  car.body.omega.set(0, 0, 0);
  car.impact = 0;
  return { sim, owner, car };
}
afterEach(() => vi.restoreAllMocks());

describe('finite Festival structure queries', () => {
  it('returns unique stable candidates across negative cell corners and clears its caller buffer', () => {
    const grid = new StructureGrid([
      structure(0, 0, 55, 55),
      structure(-48.1, 0, 1, 1),
      structure(48.1, 0, 1, 1),
      structure(500, 500, 1, 1),
    ]);
    const out = [123];
    expect(grid.queryBounds(-49, -1, 49, 1, out)).toBe(out);
    expect(out).toEqual([0, 1, 2]);
    expect(grid.queryBounds(499, 499, 501, 501, out)).toEqual([3]);
    // The visit counter can wrap in a long-running session without hiding
    // previously visited structures or duplicating a multi-cell structure.
    (grid as unknown as { queryId: number }).queryId = 0xffffffff;
    expect(grid.queryBounds(-49, -1, 49, 1, out)).toEqual([0, 1, 2]);
  });

  it.each([48, 0, -48])('finds a facade beyond the centre cell at x=%s only once', (edge) => {
    const wall = structure(edge + 0.8, 10, 0.3, 0.25),
      { sim, owner, car } = fixture([wall]);
    car.body.position.x = edge - 0.1;
    car.body.velocity.set(10, 0, 0);
    vi.spyOn(owner, 'treesAt').mockReturnValue(empty);
    const impulse = vi.spyOn(sim.collisions, 'impulse');
    // A negative control for the old centre-only broad phase.
    expect(sim.structureGrid.near(car.body.position.x, car.body.position.z)).toEqual([]);
    owner.collideStatic(car);
    expect(impulse).toHaveBeenCalledTimes(1);
    expect(impulse.mock.calls[0][3].x).toBe(-1);
    expect(car.impact).toBeGreaterThan(0);
    expect(car.body.velocity.x).toBeLessThan(10);
  });

  it('resolves a contained thin structure and crossing edges without sampled car points inside', () => {
    const contact = new StaticFootprintContact();
    const narrow = structure(0, 0.7, 0.1, 0.1);
    expect(contact.intersect(0, 0, 0, 1, 0.9, 2.25, narrow)).toBe(true);
    expect(contact.depth).toBeCloseTo(1, 12);
    expect(Math.hypot(contact.nx, contact.nz)).toBeCloseTo(1, 12);
    const crossed = structure(0, 0.7, 3, 0.1);
    expect(contact.intersect(0, 0, 0, 1, 0.9, 2.25, crossed)).toBe(true);
    expect(contact.depth).toBeCloseTo(1.65, 12);
    expect(contact.nz).toBe(-1);
    const { sim, owner, car } = fixture([narrow]);
    car.body.position.set(0, 0.55, 0);
    car.body.velocity.set(-10, 0, 0);
    vi.spyOn(owner, 'treesAt').mockReturnValue(empty);
    const impulse = vi.spyOn(sim.collisions, 'impulse');
    owner.collideStatic(car);
    expect(impulse).toHaveBeenCalledTimes(1);
    expect(car.impact).toBeGreaterThan(0);
    expect(car.body.position.x).toBeGreaterThan(0);
  });

  it('rejects an AABB corner outside the rotated footprint and exact grazing contact', () => {
    const contact = new StaticFootprintContact(),
      h = Math.SQRT1_2;
    expect(contact.intersect(0, 0, h, h, 0.9, 2.25, structure(1.8, -1.8, 0.1, 0.1))).toBe(false);
    expect(contact.intersect(0, 0, 0, 1, 1, 2, structure(2, 0, 1, 1))).toBe(false);
    expect(contact.intersect(0, 0, 0, 1, 1, 2, structure(1.99, 0, 1, 1))).toBe(true);
    expect(contact.depth).toBeCloseTo(0.01, 12);
  });

  it('deduplicates a large structure shared by all four queried cells', () => {
    const { sim, owner, car } = fixture([structure(0, 0, 20, 20)]);
    car.body.position.set(0, 0.55, 0);
    car.body.velocity.set(-10, 0, 0);
    vi.spyOn(owner, 'treesAt').mockReturnValue(empty);
    const contact = vi.spyOn(StaticFootprintContact.prototype, 'intersect'),
      impulse = vi.spyOn(sim.collisions, 'impulse');
    owner.collideStatic(car);
    expect(contact).toHaveBeenCalledTimes(1);
    expect(impulse).toHaveBeenCalledTimes(1);
    expect(Math.hypot(impulse.mock.calls[0][3].x, impulse.mock.calls[0][3].z)).toBeCloseTo(1, 12);
  });

  it('keeps a finite footprint and unit normal when the chassis forward axis is vertical', () => {
    const { sim, owner, car } = fixture([structure(10.8, 10, 0.3, 0.25)]);
    car.body.orientation.x = Math.SQRT1_2;
    car.body.orientation.w = Math.SQRT1_2;
    car.forward.set(0, -1, 0);
    car.body.velocity.set(10, 0, 0);
    vi.spyOn(owner, 'treesAt').mockReturnValue(empty);
    const impulse = vi.spyOn(sim.collisions, 'impulse');
    owner.collideStatic(car);
    expect(impulse).toHaveBeenCalledTimes(1);
    const normal = impulse.mock.calls[0][3];
    expect(normal.x).toBe(-1);
    expect(normal.length()).toBe(1);
    expect(car.impact).toBeGreaterThan(0);
    expect(car.body.velocity.x).toBeLessThan(10);
  });
});

describe('Festival trunk coverage at physics-tile boundaries', () => {
  it('contacts the real Solvane trunk across a tile edge from a chassis in the previous tile', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1', traffic: false }),
      owner = sim as unknown as StaticOwner,
      car = sim.player,
      trees = owner.treesAt(4 * TILE_SIZE, 10 * TILE_SIZE);
    let index = -1;
    for (let i = 0; i < trees.length; i += TREE_STRIDE)
      if (
        Math.abs(trees[i] - 1025.766357421875) < 1e-6 &&
        Math.abs(trees[i + 1] - 2571.2646484375) < 1e-6
      )
        index = i;
    expect(index).toBeGreaterThanOrEqual(0);
    const tree = trees.slice(index, index + TREE_STRIDE);
    expect(trunkRadius(tree[3], tree[2])).toBeGreaterThan(0);
    const x = 4 * TILE_SIZE - 0.05,
      y = sim.track.tiles.height(tree[0], tree[1]) + car.definition.halfExtents[1];
    car.body.orientation.yaw(Math.PI / 2);
    car.forward.set(1, 0, 0);
    car.body.position.set(x, y, tree[1]);
    car.body.velocity.set(10, 0, 0);
    car.body.omega.set(0, 0, 0);
    car.impact = 0;
    const old = owner.treesAt(x, tree[1]);
    expect(Array.from(old).includes(tree[0])).toBe(false);
    const visited = vi.spyOn(owner, 'treesAt'),
      impulse = vi.spyOn(sim.collisions, 'impulse');
    owner.collideStatic(car);
    expect(
      visited.mock.calls.map(([px, pz]) => [
        Math.floor(px / TILE_SIZE),
        Math.floor(pz / TILE_SIZE),
      ]),
    ).toEqual([
      [3, 10],
      [4, 10],
    ]);
    expect(impulse).toHaveBeenCalledTimes(1);
    expect(impulse.mock.calls[0][3].x).toBe(-1);
    expect(car.impact).toBeGreaterThan(0);
    expect(car.body.velocity.x).toBeLessThan(10);
  });

  it.each([
    [256, 256],
    [0, 0],
    [-256, -256],
    [256, -256],
  ])('visits four tiles once and contacts one corner trunk at (%s, %s)', (edgeX, edgeZ) => {
    const { sim, owner, car } = fixture(),
      tree = Float32Array.from([edgeX + 0.3, edgeZ + 0.3, 10, 0, 0, 0]),
      tx = Math.floor(tree[0] / TILE_SIZE),
      tz = Math.floor(tree[1] / TILE_SIZE);
    car.body.position.set(edgeX - 0.1, 0.55, edgeZ - 0.1);
    car.body.orientation.yaw(Math.PI / 4);
    car.forward.set(Math.SQRT1_2, 0, Math.SQRT1_2);
    const visited = vi
      .spyOn(owner, 'treesAt')
      .mockImplementation((x, z) =>
        Math.floor(x / TILE_SIZE) === tx && Math.floor(z / TILE_SIZE) === tz ? tree : empty,
      );
    vi.spyOn(sim.track.tiles, 'height').mockReturnValue(0);
    const impulse = vi.spyOn(sim.collisions, 'impulse');
    owner.collideStatic(car);
    const keys = visited.mock.calls.map(
      ([x, z]) => `${Math.floor(x / TILE_SIZE)}:${Math.floor(z / TILE_SIZE)}`,
    );
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
    expect(keys).toContain(`${tx}:${tz}`);
    expect(impulse).toHaveBeenCalledTimes(1);
  });

  it('rejects nearby broad-phase candidates before querying terrain height', () => {
    const { sim, owner, car } = fixture();
    const r = trunkRadius(0, 10),
      z = 10 + car.definition.halfExtents[2] + r + 0.1;
    expect(r + 0.1).toBeLessThan(MAX_TRUNK_RADIUS);
    vi.spyOn(owner, 'treesAt').mockReturnValue(Float32Array.from([10, z, 10, 0, 0, 0]));
    const height = vi.spyOn(sim.track.tiles, 'height'),
      impulse = vi.spyOn(sim.collisions, 'impulse');
    owner.collideStatic(car);
    expect(height).not.toHaveBeenCalled();
    expect(impulse).not.toHaveBeenCalled();
  });

  it('resolves an exactly centred trunk with a finite unit normal and dissipative impact', () => {
    const { sim, owner, car } = fixture();
    car.body.velocity.set(-10, 0, 0);
    vi.spyOn(owner, 'treesAt').mockReturnValue(Float32Array.from([10, 10, 10, 0, 0, 0]));
    vi.spyOn(sim.track.tiles, 'height').mockReturnValue(0);
    const impulse = vi.spyOn(sim.collisions, 'impulse');
    owner.collideStatic(car);
    expect(impulse).toHaveBeenCalledTimes(1);
    const normal = impulse.mock.calls[0][3];
    expect(normal.x).toBe(1);
    expect(normal.length()).toBe(1);
    expect(car.body.position.x).toBeGreaterThan(10);
    expect(car.body.velocity.length()).toBeLessThan(10);
    expect(car.impact).toBeGreaterThan(0);
  });

  it('retains the configured tree residency budget while querying neighbouring tiles', () => {
    const { sim, owner, car } = fixture([], 2);
    car.body.position.set(-0.1, 10000, -0.1);
    vi.spyOn(sim.track.tiles, 'height').mockReturnValue(0);
    const visited = vi.spyOn(owner, 'treesAt');
    owner.collideStatic(car);
    expect(visited).toHaveBeenCalledTimes(4);
    expect(owner.trees.size).toBe(2);
    const first = [...owner.trees.keys()];
    owner.collideStatic(car);
    expect(owner.trees.size).toBe(2);
    expect([...owner.trees.keys()]).toEqual(first);
  });
});
