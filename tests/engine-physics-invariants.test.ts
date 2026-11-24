import { describe, expect, it } from 'vitest';
import { Random, Vec3 } from '../src/core/math.ts';
import { rayHit, TriangleBVH, VerticalRayColumn } from '../src/simulation/bvh.ts';
import { CollisionSolver } from '../src/simulation/collision.ts';
import { BoxContact, ChassisBox, SweptBoxContact } from '../src/simulation/obb.ts';
import {
  TerrainTileCache,
  TILE_SIZE,
  type TerrainCarver,
} from '../src/simulation/open-world/terrain-tiles.ts';
import { RigidBody } from '../src/simulation/rigid.ts';
import type { Track } from '../src/simulation/track.ts';
import type { Vehicle } from '../src/simulation/vehicle.ts';

// Real rigid/query code with external forces, authored venues and damage
// adapters outside this focused ownership/invariant check.
const track = {
  circuit: { offroad: false },
  nearest: () => 0,
  boundaryAt: () => Infinity,
} as unknown as Track;

function proxy(body: RigidBody, half: readonly number[]) {
  const box = new ChassisBox();
  box.half = half;
  return box.update(body);
}

function field(count: number, episode: number) {
  return Array.from({ length: count }, (_, index) => {
    const body = new RigidBody();
    body.position.set((index % 2) * 0.7, (index % 3) * 0.45, Math.floor(index / 2) * 0.8);
    body.orientation.integrateWorld(new Vec3(0.1, (episode + index) * 0.12, -0.05), 1);
    body.velocity.set(index % 2 ? -3 : 3, (index % 3) - 1, 0.2 * episode);
    body.omega.set(0, (index % 2 ? 1 : -1) * 0.2, 0);
    body.mass = 300 + index * 50;
    body.inertia.set(160 + index, 250 + index, 220 + index);
    return {
      id: count - index,
      body,
      definition: { halfExtents: [0.4 + episode * 0.03, 0.5, 0.65 + index * 0.02] },
      impactAt: () => undefined,
    } as unknown as Vehicle;
  });
}

function drift(cars: Vehicle[], dt: number) {
  for (const car of cars) {
    car.body.position.addScaled(car.body.velocity, dt);
    car.body.orientation.integrateWorld(car.body.omega, dt);
  }
}

function state(cars: Vehicle[]) {
  return cars.map(({ body }) => ({
    position: { ...body.position },
    velocity: { ...body.velocity },
    omega: { ...body.omega },
    orientation: { ...body.orientation },
  }));
}

class ObservedSolver extends CollisionSolver {
  readonly contacts: number[][] = [];

  override impulse(a: Vehicle, b: Vehicle | null, point: Vec3, normal: Vec3, depth: number) {
    this.contacts.push([
      a.id,
      b?.id ?? -1,
      point.x,
      point.y,
      point.z,
      normal.x,
      normal.y,
      normal.z,
      depth,
    ]);
    super.impulse(a, b, point, normal, depth);
  }
}

function diagnostics(solver: CollisionSolver) {
  return {
    contacts: solver.sweptContacts,
    queries: solver.sweepQueries,
    iterationLimits: solver.sweepIterationLimits,
    limitReached: solver.sweepLimitReached,
  };
}

describe('physics scratch reuse and conservative bounds', () => {
  it.each(['start', 'end'] as const)(
    'retains exact aliased %s interpolation and contains every y/z chassis corner',
    (alias) => {
      const random = new Random(5517);
      const sample = (scale: number) => (random.next() - 0.5) * scale;
      for (let index = 0; index < 256; index++) {
        const a = new RigidBody();
        const b = new RigidBody();
        const translation = index % 3 === 0 ? 1e12 : index % 3 === 1 ? 1e6 : 0;
        a.position.set(sample(12), translation + sample(12), -translation + sample(12));
        b.position.copy(a.position).add(new Vec3(sample(4), sample(4), sample(4)));
        a.orientation.integrateWorld(new Vec3(sample(6), sample(6), sample(6)), 1);
        b.orientation.integrateWorld(new Vec3(sample(6), sample(6), sample(6)), 1);
        const half = [0.03 + random.next(), 0.03 + random.next(), 0.1 + random.next() * 4];
        const start = proxy(a, half);
        const end = proxy(b, half);
        const fraction = [0, 1, 0.5, random.next()][index % 4];
        const expected = new ChassisBox().interpolate(start, end, fraction);
        const actual = alias === 'start' ? start : end;
        actual.interpolate(start, end, fraction);
        expect(actual).toStrictEqual(expected);
        expect(new ChassisBox().copy(actual)).toStrictEqual(expected);
        for (const x of [-1, 1])
          for (const y of [-1, 1])
            for (const z of [-1, 1]) {
              // Transform actual local corners independently of the AABB's
              // sum-of-projected-radii construction.
              const corner = actual.orientation
                .rotate(new Vec3(x * half[0], y * half[1], z * half[2]), new Vec3())
                .add(actual.center);
              expect(corner.y).toBeGreaterThanOrEqual(actual.minY);
              expect(corner.y).toBeLessThanOrEqual(actual.maxY);
              expect(corner.z).toBeGreaterThanOrEqual(actual.minZ);
              expect(corner.z).toBeLessThanOrEqual(actual.maxZ);
            }
      }
    },
  );

  it('matches a fresh solver after empty, resized, reordered and differently sized fields', () => {
    const reused = new ObservedSolver();
    let observedContacts = 0;
    for (const [episode, count] of [6, 2, 0, 8, 1, 4, 0, 5].entries()) {
      const actual = field(count, episode);
      const expected = field(count, episode);
      if (episode % 2) {
        actual.reverse();
        expected.reverse();
      }
      const fresh = new ObservedSolver();
      const dt = 1 / 120;
      reused.contacts.length = 0;
      reused.beginStep(actual);
      fresh.beginStep(expected);
      drift(actual, dt);
      drift(expected, dt);
      reused.solve(actual, track, dt);
      fresh.solve(expected, track, dt);
      expect(reused.contacts).toStrictEqual(fresh.contacts);
      expect(state(actual)).toStrictEqual(state(expected));
      expect(diagnostics(reused)).toStrictEqual(diagnostics(fresh));
      observedContacts += reused.contacts.length;
    }
    expect(observedContacts).toBeGreaterThan(10);
  });

  it('retires abandoned captures and does not reuse them in a later endpoint-only solve', () => {
    const reused = new ObservedSolver();
    const abandoned = field(4, 1);
    reused.beginStep(abandoned);
    drift(abandoned, 0.1);
    const actual = field(4, 2);
    const expected = field(4, 2);
    const fresh = new ObservedSolver();
    reused.solve(actual, track, 1 / 120);
    fresh.solve(expected, track, 1 / 120);
    expect(reused.sweepQueries).toBe(0);
    expect(reused.contacts).toStrictEqual(fresh.contacts);
    expect(state(actual)).toStrictEqual(state(expected));
    for (const cars of [actual, expected]) drift(cars, 1 / 120);
    reused.contacts.length = fresh.contacts.length = 0;
    reused.solve(actual, track, 1 / 120);
    fresh.solve(expected, track, 1 / 120);
    expect(reused.sweepQueries).toBe(0);
    expect(reused.contacts).toStrictEqual(fresh.contacts);
    expect(state(actual)).toStrictEqual(state(expected));
  });

  it('refreshes contact geometry after a deferred miss and a resting zero-motion query', () => {
    const a = new RigidBody();
    const b = new RigidBody();
    b.position.set(10, 0, 0);
    const half = [0.5, 0.5, 0.5];
    const first = proxy(a, half);
    const distant = proxy(b, half);
    const contact = new BoxContact();
    contact.point.set(911, 912, 913);
    expect(contact.separation(first, distant, 1e-5)).toBe(9);
    expect(contact.point).toStrictEqual(new Vec3(911, 912, 913));
    expect(contact.separation(first, distant)).toBe(9);
    expect(contact.point).toStrictEqual(new Vec3(5, 0, 0));

    b.position.set(1, 0, 0);
    const touching = proxy(b, half);
    const sweep = new SweptBoxContact();
    expect(sweep.intersect(first, first, touching, touching)).toBe(false);
    b.position.set(-1, 0, 0);
    const approaching = proxy(b, half);
    expect(sweep.intersect(first, first, touching, approaching)).toBe(true);
    const fresh = new SweptBoxContact();
    expect(fresh.intersect(first, first, touching, approaching)).toBe(true);
    expect(sweep.fraction).toBe(0);
    expect(sweep.fraction).toBe(fresh.fraction);
    expect(sweep.point).toStrictEqual(fresh.point);
    expect(sweep.normal).toStrictEqual(fresh.normal);
    expect(sweep.exhausted).toBe(false);
  });

  it('reevaluates ownership while alternating cached vertical and deferred general queries', () => {
    let allowed = 1;
    const vertices = Float64Array.from([
      -2, 0, -2, 2, 0, -2, 0, 0, 2, -2, 3, -2, 2, 3, -2, 0, 3, 2,
    ]);
    const normals = Float64Array.from([
      0, 1, 0, 0.25, 1, 0, 0, 1, 0.5, 0, 1, 0.25, 0.5, 1, 0, 0, 1, 0,
    ]);
    const tree = new TriangleBVH(
      vertices,
      Uint32Array.from([0, 2, 1, 3, 5, 4]),
      normals,
      (triangle) => triangle === allowed,
    );
    const column = new VerticalRayColumn();
    const origin = new Vec3(0.25, 7, 0.125);
    const down = new Vec3(0, -1, 0);
    const vertical = rayHit();
    const general = rayHit();
    for (let round = 0; round < 64; round++) {
      for (allowed of [1, 0, -1, 0, 1]) {
        expect(tree.raycastVertical(origin, 10, vertical, column)).toBe(allowed >= 0);
        expect(tree.raycast(origin, down, 10, general)).toBe(allowed >= 0);
        expect(general).toStrictEqual(vertical);
        if (allowed >= 0) {
          expect(general.triangle).toBe(allowed);
          expect(general.point.y).toBe(allowed * 3);
          expect(general.distance).toBe(7 - allowed * 3);
        }
      }
    }
  });
});

describe('terrain residency failure boundaries', () => {
  it.each(['query', 'prefetch'] as const)(
    'retains valid physics samples after a %s build failure, retry and clear',
    (operation) => {
      let fail = false;
      let offset = 0;
      const failure = new Error('Synthetic terrain allocation failure');
      const cache = new TerrainTileCache(
        {
          build(x0: number, z0: number, step: number, resolution: number) {
            if (fail) {
              fail = false;
              throw failure;
            }
            const side = resolution + 1;
            return {
              heights: Float32Array.from(
                { length: side * side },
                (_, index) =>
                  offset +
                  (x0 + (index % side) * step) * 0.25 -
                  (z0 + Math.floor(index / side) * step) * 0.5,
              ),
            };
          },
        } as unknown as TerrainCarver,
        2,
      );
      const a = TILE_SIZE / 2;
      const b = a + TILE_SIZE;
      const normal = new Vec3();
      const expectedNormal = new Vec3(-0.25, 1, 0.5).normalize();
      expect(cache.height(a, a, normal)).toBe(-a * 0.25);
      expect(normal).toStrictEqual(expectedNormal);
      cache.want(b, a, 0, 0);
      fail = true;
      expect(() => (operation === 'query' ? cache.height(b, a) : cache.prefetch(Infinity))).toThrow(
        failure,
      );
      expect(cache.has(a, a)).toBe(true);
      expect(cache.has(b, a)).toBe(false);
      expect(cache.stats.generated).toBe(1);
      expect(cache.height(a, a, normal)).toBe(-a * 0.25);
      expect(normal).toStrictEqual(expectedNormal);
      expect(cache.height(b, a, normal)).toBe(b * 0.25 - a * 0.5);
      expect(normal).toStrictEqual(expectedNormal);
      expect(cache.queuedCount).toBe(0);
      expect(cache.stats.resident).toBe(2);
      offset = 7;
      cache.clear();
      expect(cache.height(b, a, normal)).toBe(7 + b * 0.25 - a * 0.5);
      expect(normal).toStrictEqual(expectedNormal);
      expect(cache.stats.resident).toBe(1);
    },
  );
});
