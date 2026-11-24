import { afterEach, describe, expect, it, vi } from 'vitest';
import { Random, Vec3 } from '../src/core/math.ts';
import { CollisionSolver } from '../src/simulation/collision.ts';
import { BoxContact, ChassisBox, SweptBoxContact } from '../src/simulation/obb.ts';
import { RigidBody } from '../src/simulation/rigid.ts';
import type { Track } from '../src/simulation/track.ts';
import type { Vehicle } from '../src/simulation/vehicle.ts';

// Real rigid bodies and impulses, with environmental forces/damage outside the query under test.
const track = {
  circuit: { offroad: false },
  nearest: () => 0,
  boundaryAt: () => Infinity,
} as unknown as Track;

function car(id: number, position: Vec3, half: readonly number[] = [0.5, 0.5, 0.5]) {
  const body = new RigidBody();
  body.position.copy(position);
  return { id, body, definition: { halfExtents: half }, impactAt: () => {} } as unknown as Vehicle;
}

function box(car: Vehicle) {
  const result = new ChassisBox();
  result.half = car.definition.halfExtents;
  return result.update(car.body);
}

function clone(source: Vehicle) {
  const result = car(source.id, source.body.position, source.definition.halfExtents),
    a = source.body,
    b = result.body;
  Object.assign(b.orientation, a.orientation);
  b.velocity.copy(a.velocity);
  b.omega.copy(a.omega);
  b.mass = a.mass;
  b.inertia.copy(a.inertia);
  return result;
}

function state(cars: Vehicle[]) {
  return cars.map(({ body }) => [
    body.position.x,
    body.position.y,
    body.position.z,
    body.velocity.x,
    body.velocity.y,
    body.velocity.z,
    body.omega.x,
    body.omega.y,
    body.omega.z,
  ]);
}

class RecordingSolver extends CollisionSolver {
  contacts: number[][] = [];
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

/** Prior endpoint broadphase: freeze x candidates, then SAT every candidate in ID order. */
function solveXOnly(cars: Vehicle[], solver: RecordingSolver) {
  const boxes = cars.map(box),
    minX = boxes.map((b) => b.minX),
    maxX = boxes.map((b) => b.maxX),
    order = cars.map((_, i) => i),
    contact = new BoxContact();
  order.sort((a, b) => minX[a] - minX[b] || cars[a].id - cars[b].id);
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    for (let l = k + 1; l < order.length; l++) {
      const j = order[l];
      if (minX[j] > maxX[i]) break;
      if (contact.intersect(boxes[i], boxes[j])) {
        solver.impulse(cars[i], cars[j], contact.point, contact.normal, contact.depth);
        boxes[i].update(cars[i].body);
        boxes[j].update(cars[j].body);
      }
    }
  }
}

/** Original swept broadphase arithmetic, without its per-event cache. */
function sweptCandidates(cars: Vehicle[], starts: ChassisBox[], ends: ChassisBox[]) {
  const minX = starts.map((s, i) => Math.min(s.center.x, ends[i].center.x) - Math.hypot(...s.half)),
    maxX = starts.map((s, i) => Math.max(s.center.x, ends[i].center.x) + Math.hypot(...s.half)),
    order = cars.map((_, i) => i),
    pairs: number[][] = [];
  order.sort((a, b) => minX[a] - minX[b] || cars[a].id - cars[b].id);
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    for (let l = k + 1; l < order.length; l++) {
      const j = order[l];
      if (minX[j] > maxX[i]) break;
      const a = starts[i].center,
        endA = ends[i].center,
        b = starts[j].center,
        endB = ends[j].center,
        radius = Math.hypot(...starts[i].half) + Math.hypot(...starts[j].half);
      if (
        Math.min(a.y, endA.y) <= Math.max(b.y, endB.y) + radius &&
        Math.min(b.y, endB.y) <= Math.max(a.y, endA.y) + radius &&
        Math.min(a.z, endA.z) <= Math.max(b.z, endB.z) + radius &&
        Math.min(b.z, endB.z) <= Math.max(a.z, endA.z) + radius
      )
        pairs.push([cars[i].id, cars[j].id]);
    }
  }
  return pairs;
}

function randomCars(random: Random, count: number) {
  const sample = (scale: number) => (random.next() - 0.5) * scale;
  return Array.from({ length: count }, (_, i) => {
    const result = car(count - i, new Vec3(sample(7), sample(5), sample(11)), [
      0.2 + random.next(),
      0.2 + random.next(),
      0.5 + 2 * random.next(),
    ]);
    result.body.orientation.integrateWorld(new Vec3(sample(5), sample(5), sample(5)), 1);
    result.body.velocity.set(sample(20), sample(20), sample(20));
    result.body.omega.set(sample(4), sample(4), sample(4));
    result.body.mass = 200 + 1000 * random.next();
    result.body.inertia.set(
      100 + random.next() * 500,
      100 + random.next() * 500,
      100 + random.next() * 500,
    );
    return result;
  });
}

afterEach(() => vi.restoreAllMocks());

describe('collision candidate work', () => {
  it.each(['y', 'z'] as const)('skips SAT for 2,016 x candidates separated along %s', (axis) => {
    const cars = Array.from({ length: 64 }, (_, i) => {
      const position = new Vec3();
      position[axis] = i * 5;
      return car(i, position);
    });
    const intersect = vi.spyOn(BoxContact.prototype, 'intersect'),
      reference = new RecordingSolver(),
      optimized = new RecordingSolver();
    solveXOnly(cars.map(clone), reference);
    expect(intersect).toHaveBeenCalledTimes(2016);
    intersect.mockClear();
    optimized.solve(cars, track);
    expect(intersect).not.toHaveBeenCalled();
    expect(optimized.contacts).toEqual(reference.contacts);
  });

  it.each(['y', 'z'] as const)('retains contacts created by earlier %s depenetration', (axis) => {
    const cars = [0, 0.8, 1.82].map((coordinate, id) => {
      const position = new Vec3();
      position[axis] = coordinate;
      return car(id, position);
    });
    const expected = cars.map(clone),
      reference = new RecordingSolver(),
      optimized = new RecordingSolver();
    solveXOnly(expected, reference);
    optimized.solve(cars, track);
    expect(optimized.contacts.map((c) => c.slice(0, 2))).toEqual([
      [0, 1],
      [1, 2],
    ]);
    expect(optimized.contacts).toEqual(reference.contacts);
    expect(state(cars)).toEqual(state(expected));
  });

  it('preserves contact order, points, normals and response in 120 seeded 3D scenes', () => {
    const random = new Random(14839);
    let contacts = 0;
    for (let scene = 0; scene < 120; scene++) {
      const cars = randomCars(random, 12),
        expected = cars.map(clone),
        reference = new RecordingSolver(),
        optimized = new RecordingSolver();
      solveXOnly(expected, reference);
      optimized.solve(cars, track);
      expect(optimized.contacts).toEqual(reference.contacts);
      expect(state(cars)).toEqual(state(expected));
      contacts += optimized.contacts.length;
    }
    expect(contacts).toBeGreaterThan(500);
  });

  it('retains a grazing SAT contact whose unpadded y bounds are one rounding step apart', () => {
    const a = car(0, new Vec3(), [0.44818376428447665, 0.40303455414250494, 1.3044342738576233]),
      b = car(
        1,
        new Vec3(0.6079842638904773, 4.896849040559106, 1.2674180287026393),
        [1.1932831218466162, 1.1800052363425493, 3.254620611667633],
      );
    Object.assign(a.body.orientation, {
      x: 0.067114430736939,
      y: 0.6438768129947033,
      z: 0.6926943297195896,
      w: 0.3179510472525123,
    });
    Object.assign(b.body.orientation, {
      x: 0.06925540237379642,
      y: 0.6865214325266848,
      z: 0.6447239478785104,
      w: 0.3289727085268625,
    });
    const cars = [a, b],
      reference = new RecordingSolver(),
      optimized = new RecordingSolver();
    solveXOnly(cars.map(clone), reference);
    expect(reference.contacts).toHaveLength(1);
    expect(reference.contacts[0][8]).toBe(4.440892098500626e-16);
    optimized.solve(cars, track);
    expect(optimized.contacts).toEqual(reference.contacts);
  });

  it.each([0, 1e6, 1e10, 1e14])('preserves grazing y/z contacts translated to %s', (coordinate) => {
    const random = new Random(17291),
      direction = new Vec3(),
      opposite = new Vec3(),
      aPoint = new Vec3(),
      bPoint = new Vec3();
    let contacts = 0;
    for (let i = 0; i < 256; i++) {
      const axis = i % 2 === 0 ? 'y' : 'z',
        cars = randomCars(random, 2);
      for (const car of cars) {
        car.body.position.set(0, 0, 0);
        car.body.velocity.set(0, 0, 0);
        car.body.omega.set(0, 0, 0);
      }
      direction.set(0, Number(axis === 'y'), Number(axis === 'z'));
      opposite.copy(direction).scale(-1);
      box(cars[0]).support(direction, aPoint);
      box(cars[1]).support(opposite, bPoint);
      cars[1].body.position.copy(aPoint).sub(bPoint);
      cars[0].body.position[axis] += coordinate;
      cars[1].body.position[axis] += coordinate;
      cars[1].body.position[axis] += [-1e-8, -1e-12, 0, 1e-12, 1e-8][i % 5];
      const expected = cars.map(clone),
        reference = new RecordingSolver(),
        optimized = new RecordingSolver();
      solveXOnly(expected, reference);
      optimized.solve(cars, track);
      expect(optimized.contacts).toEqual(reference.contacts);
      expect(state(cars)).toEqual(state(expected));
      contacts += reference.contacts.length;
    }
    expect(contacts).toBeGreaterThan(30);
  });

  it('preserves the original swept candidate order across 32 seeded moving 3D scenes', () => {
    const random = new Random(9238),
      dt = 0.1;
    let candidates = 0;
    for (let scene = 0; scene < 32; scene++) {
      const cars = randomCars(random, 20),
        starts = cars.map(box),
        ids = new Map(starts.map((b, i) => [JSON.stringify(b.center), cars[i].id])),
        solver = new CollisionSolver(),
        seen: number[][] = [];
      solver.beginStep(cars);
      for (const car of cars) {
        car.body.position.addScaled(car.body.velocity, dt);
        car.body.orientation.integrateWorld(car.body.omega, dt);
      }
      const expected = sweptCandidates(cars, starts, cars.map(box));
      const query = vi
        .spyOn(SweptBoxContact.prototype, 'intersect')
        .mockImplementation((a, _endA, b) => {
          seen.push([ids.get(JSON.stringify(a.center))!, ids.get(JSON.stringify(b.center))!]);
          return false;
        });
      solver.solve(cars, track, dt);
      expect(seen).toEqual(expected);
      expect(solver.sweepQueries).toBe(expected.length);
      candidates += seen.length;
      query.mockRestore();
    }
    expect(candidates).toBeGreaterThan(1000);
  });

  it('computes each swept bounding radius once instead of twice for every rejected pair', () => {
    const half = [0.37, 0.43, 0.89],
      cars = Array.from({ length: 64 }, (_, i) => car(i, new Vec3(0, 0, i * 5), half)),
      solver = new CollisionSolver();
    solver.beginStep(cars);
    const hypot = vi.spyOn(Math, 'hypot');
    solver.solve(cars, track, 1 / 240);
    const radiusCalls = hypot.mock.calls.filter(
      (args) => args.length === 3 && args.every((v, i) => v === half[i]),
    );
    expect(radiusCalls).toHaveLength(64);
    // Previously: 64 event radii + 2 radii for each of the 2,016 rejected pairs = 4,096.
    expect(solver.sweepQueries).toBe(0);
  });
});

type Path = [ChassisBox, ChassisBox, ChassisBox, ChassisBox];
function sweepResult(sweep: SweptBoxContact, path: Path) {
  const hit = sweep.intersect(...path);
  return {
    hit,
    fraction: sweep.fraction,
    iterations: sweep.iterations,
    exhausted: sweep.exhausted,
    point: hit ? [sweep.point.x, sweep.point.y, sweep.point.z] : null,
    normal: hit ? [sweep.normal.x, sweep.normal.y, sweep.normal.z] : null,
  };
}

describe('swept contact point work', () => {
  it('builds the rotating contact point only at the hit iteration', () => {
    const a = car(0, new Vec3(), [0.1, 0.1, 2]),
      endA = clone(a),
      b = car(1, new Vec3(1.3, 0, 1.3), [0.15, 0.15, 0.15]);
    endA.body.orientation.yaw(Math.PI / 2);
    const path: Path = [box(a), box(endA), box(b), box(b)],
      support = vi.spyOn(ChassisBox.prototype, 'support'),
      optimized = sweepResult(new SweptBoxContact(), path);
    expect(optimized.hit).toBe(true);
    expect(optimized.iterations).toBeGreaterThan(2);
    expect(support).toHaveBeenCalledTimes(2);
    support.mockClear();
    const separation = BoxContact.prototype.separation;
    vi.spyOn(BoxContact.prototype, 'separation').mockImplementation(function (
      this: BoxContact,
      a,
      b,
    ) {
      return separation.call(this, a, b);
    });
    const eager = sweepResult(new SweptBoxContact(), path);
    expect(eager).toEqual(optimized);
    expect(support).toHaveBeenCalledTimes(2 * eager.iterations);
  });

  it('keeps eager-query hit fractions and contact geometry exact across 256 seeded paths', () => {
    const random = new Random(83071),
      paths: Path[] = [];
    for (let i = 0; i < 256; i++) {
      const cars = randomCars(random, 2),
        starts = cars.map(box);
      for (const car of cars) {
        car.body.position.addScaled(car.body.velocity, 0.3);
        car.body.orientation.integrateWorld(car.body.omega, 0.3);
      }
      paths.push([starts[0], box(cars[0]), starts[1], box(cars[1])]);
    }
    const sweep = new SweptBoxContact(),
      optimized = paths.map((path) => sweepResult(sweep, path)),
      separation = BoxContact.prototype.separation;
    vi.spyOn(BoxContact.prototype, 'separation').mockImplementation(function (
      this: BoxContact,
      a,
      b,
    ) {
      return separation.call(this, a, b);
    });
    const eager = new SweptBoxContact();
    expect(paths.map((path) => sweepResult(eager, path))).toEqual(optimized);
    expect(optimized.some((result) => result.hit)).toBe(true);
    expect(optimized.some((result) => !result.hit)).toBe(true);
  });
});
