import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenWorldSimulation } from '../src/simulation/open-world/session.ts';
import { trunkRadius, TREE_STRIDE } from '../src/simulation/open-world/placement.ts';
import type { Vehicle } from '../src/simulation/vehicle.ts';

type StaticContacts = {
  treesAt(x: number, z: number): Float32Array;
  collideStatic(car: Vehicle): void;
};

afterEach(() => vi.restoreAllMocks());

function treeFixture() {
  const sim = new OpenWorldSimulation({ vehicle: 'tc1', traffic: false });
  const contacts = sim as unknown as StaticContacts;
  // A real deterministic forest tile from Solvane, not an artificial wall.
  const trees = contacts.treesAt(1542, 3078);
  let i = 0;
  while (i < trees.length && trunkRadius(trees[i + 3], trees[i + 2]) === 0) i += TREE_STRIDE;
  expect(i).toBeLessThan(trees.length);
  const tree = trees.slice(i, i + TREE_STRIDE);
  vi.spyOn(contacts, 'treesAt').mockReturnValue(tree);
  vi.spyOn(sim.structureGrid, 'queryBounds').mockReturnValue([]);
  const car = sim.player;
  const [hx, hy] = car.definition.halfExtents;
  const base = sim.track.tiles.height(tree[0], tree[1]);
  const crown = base + tree[2];
  car.body.position.set(tree[0] + hx + trunkRadius(tree[3], tree[2]) - 0.05, base + hy, tree[1]);
  car.body.orientation.yaw(0);
  car.forward.set(0, 0, 1);
  car.up.set(0, 1, 0);
  car.body.velocity.set(-10, 0, 0);
  car.body.omega.set(0, 0, 0);
  car.impact = 0;
  return { sim, contacts, car, base, crown, hy };
}

describe('finite-height Festival static contacts', () => {
  it('keeps the real trunk collision at ground level', () => {
    const { contacts, car } = treeFixture();
    contacts.collideStatic(car);
    expect(car.impact).toBeGreaterThan(0);
    expect(car.body.velocity.x).toBeGreaterThan(-10);
  });

  it.each([0.1, 100])('lets a chassis clear the tree top by %s metres', (clearance) => {
    const { contacts, car, crown, hy } = treeFixture();
    car.body.position.y = crown + hy + clearance;
    contacts.collideStatic(car);
    expect(car.impact).toBe(0);
    expect(car.body.velocity.x).toBe(-10);
  });

  it('rejects contact completely below the trunk base', () => {
    const { contacts, car, base, hy } = treeFixture();
    car.body.position.y = base - hy - 0.1;
    contacts.collideStatic(car);
    expect(car.impact).toBe(0);
    expect(car.body.velocity.x).toBe(-10);
  });

  it('retains contact when a rolled chassis overlaps the finite trunk', () => {
    const { contacts, car, crown, hy } = treeFixture();
    // The centre clears the old unrotated half-height, but the rolled side
    // extends below the top. The broad-phase interval must not miss it.
    car.body.position.y = crown + hy + 0.1;
    car.body.orientation.z = Math.sin(Math.PI / 8);
    car.body.orientation.w = Math.cos(Math.PI / 8);
    contacts.collideStatic(car);
    expect(car.impact).toBeGreaterThan(0);
  });

  it('uses both the top and base of a building as finite limits', () => {
    const sim = new OpenWorldSimulation({ vehicle: 'tc1', traffic: false });
    const contacts = sim as unknown as StaticContacts;
    const car = sim.player;
    const impulse = vi.spyOn(sim.collisions, 'impulse');
    const s = sim.structures.find((structure) => structure.hx > 3 && structure.hz > 3)!;
    vi.spyOn(contacts, 'treesAt').mockReturnValue(new Float32Array());
    vi.spyOn(sim.structureGrid, 'queryBounds').mockReturnValue([sim.structures.indexOf(s)]);
    const [hx, hy] = car.definition.halfExtents;
    car.body.orientation.yaw(0);
    car.forward.set(0, 0, 1);
    car.body.position.set(s.x, s.base - hy - 0.1, s.z);
    car.body.velocity.set(-10, 0, 0);
    car.impact = 0;
    contacts.collideStatic(car);
    expect(car.impact).toBe(0);
    expect(impulse).not.toHaveBeenCalled();
    car.body.position.y = s.base + s.height + hy + hx;
    contacts.collideStatic(car);
    expect(car.impact).toBe(0);
    expect(impulse).not.toHaveBeenCalled();
    car.body.position.y = s.base + hy;
    contacts.collideStatic(car);
    expect(impulse).toHaveBeenCalledTimes(1);
  });
});
