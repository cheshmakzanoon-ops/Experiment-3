import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { CollisionSolver } from '../src/simulation/collision.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { BoxContact, ChassisBox, SweptBoxContact } from '../src/simulation/obb.ts';
import { RigidBody } from '../src/simulation/rigid.ts';
import type { Track } from '../src/simulation/track.ts';
import type { Vehicle } from '../src/simulation/vehicle.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

// Isolate vehicle/vehicle mechanics from environmental forces and barriers.
// The bodies, motorcycle dimensions, masses, inertias and damage adapter are real.
const track = {
  circuit: { offroad: false },
  nearest: () => 0,
  boundaryAt: () => Infinity,
} as unknown as Track;

function bike(id: number, x: number, speed = 0, z = 0) {
  const car = new BikeVehicle(id, 'medium', DEFAULT_SETUP, 'sport', VEHICLES.gpr1);
  car.body.position.set(x, 0, z);
  car.body.orientation.yaw(0);
  car.body.velocity.set(speed, 0, 0);
  car.body.omega.set(0, 0, 0);
  return car;
}
function proxy(car: Vehicle) {
  const box = new ChassisBox();
  box.half = car.definition.halfExtents;
  return box.update(car.body);
}
function box(x: number, z = 0, yaw = 0, half: readonly number[] = [0.2, 0.4, 1]) {
  const body = new RigidBody(),
    result = new ChassisBox();
  body.position.set(x, 0, z);
  body.orientation.yaw(yaw);
  result.half = half;
  return result.update(body);
}
function advance(cars: Vehicle[], dt: number) {
  for (const car of cars) {
    car.body.position.addScaled(car.body.velocity, dt);
    car.body.orientation.integrateWorld(car.body.omega, dt);
  }
}
function drift(cars: Vehicle[], dt: number, solver = new CollisionSolver()) {
  solver.beginStep(cars);
  advance(cars, dt);
  solver.solve(cars, track, dt);
  return solver;
}
function energy(car: Vehicle) {
  const b = car.body,
    w = b.orientation.inverseRotate(b.omega, new Vec3());
  return (
    0.5 * b.mass * b.velocity.dot(b.velocity) +
    0.5 * (b.inertia.x * w.x ** 2 + b.inertia.y * w.y ** 2 + b.inertia.z * w.z ** 2)
  );
}
function momentum(cars: Vehicle[]) {
  const linear = new Vec3(),
    angular = new Vec3();
  for (const car of cars) {
    const b = car.body,
      p = new Vec3().copy(b.velocity).scale(b.mass),
      w = b.orientation.inverseRotate(b.omega, new Vec3());
    w.set(w.x * b.inertia.x, w.y * b.inertia.y, w.z * b.inertia.z);
    linear.add(p);
    angular.add(b.orientation.rotate(w, w)).add(new Vec3().cross(b.position, p));
  }
  return { linear, angular };
}
function state(cars: Vehicle[]) {
  return cars.flatMap(({ body: b }) => [
    b.position.x,
    b.position.y,
    b.position.z,
    b.velocity.x,
    b.velocity.y,
    b.velocity.z,
    b.omega.x,
    b.omega.y,
    b.omega.z,
    b.orientation.x,
    b.orientation.y,
    b.orientation.z,
    b.orientation.w,
  ]);
}

describe('continuous oriented chassis geometry', () => {
  it('finds the analytic first contact when two thin boxes fully exchange sides', () => {
    const a = box(-1),
      b = box(1),
      endA = box(1),
      endB = box(-1);
    expect(new BoxContact().intersect(a, b)).toBe(false);
    expect(new BoxContact().intersect(endA, endB)).toBe(false);
    const sweep = new SweptBoxContact();
    expect(sweep.intersect(a, endA, b, endB)).toBe(true);
    expect(sweep.fraction).toBeCloseTo(0.4, 6);
    expect(sweep.normal.x).toBe(-1);
    expect(sweep.exhausted).toBe(false);
    expect(sweep.iterations).toBeLessThanOrEqual(80);
  });

  it('finds a rotating corner passing between clear endpoint poses', () => {
    const a = box(0, 0, 0, [0.1, 0.1, 2]),
      endA = box(0, 0, Math.PI / 2, a.half),
      b = box(1.3, 1.3, 0, [0.15, 0.15, 0.15]);
    expect(new BoxContact().intersect(a, b)).toBe(false);
    expect(new BoxContact().intersect(endA, b)).toBe(false);
    const sweep = new SweptBoxContact();
    expect(sweep.intersect(a, endA, b, b)).toBe(true);
    expect(sweep.fraction).toBeGreaterThan(0);
    expect(sweep.fraction).toBeLessThan(1);
    expect(sweep.exhausted).toBe(false);
  });

  it('rejects a genuine near miss despite overlapping bounding spheres', () => {
    const sweep = new SweptBoxContact();
    expect(sweep.intersect(box(-2, 2.001), box(2, 2.001), box(0), box(0))).toBe(false);
    expect(sweep.exhausted).toBe(false);
  });

  it.each([0, -1e-7])('detects approaching time-zero contact with signed gap %s', (gap) => {
    const a = box(-0.2 - gap * 0.5),
      b = box(0.2 + gap * 0.5);
    const sweep = new SweptBoxContact();
    expect(sweep.intersect(a, box(2), b, box(-2))).toBe(true);
    expect(sweep.fraction).toBe(0);
  });

  it.each(['resting', 'separating'])('does not rediscover %s time-zero contacts', (kind) => {
    const a = box(-0.2),
      b = box(0.2),
      sweep = new SweptBoxContact();
    expect(
      sweep.intersect(a, kind === 'resting' ? a : box(-2), b, kind === 'resting' ? b : box(2)),
    ).toBe(false);
    expect(sweep.exhausted).toBe(false);
  });

  it('interpolates antipodal quaternions without inventing a full rotation', () => {
    const a = box(0, 0, 0.7),
      b = new ChassisBox().copy(a);
    b.orientation.x *= -1;
    b.orientation.y *= -1;
    b.orientation.z *= -1;
    b.orientation.w *= -1;
    const middle = new ChassisBox().interpolate(a, b, 0.5);
    expect(a.rotationTo(b)).toBeLessThan(1e-7);
    expect(a.rotationVectorTo(b, new Vec3()).length()).toBeLessThan(1e-12);
    for (let i = 0; i < 3; i++) expect(middle.axes[i].distanceSq(a.axes[i])).toBeLessThan(1e-25);
  });
});

describe('continuous collision response', () => {
  it('catches an 85 m/s GP corner glance at the actual 240 Hz substep', () => {
    const [width, , length] = VEHICLES.gpr1.halfExtents;
    const cars = [
      bike(0, -width - 0.02, 0, length - 0.03),
      bike(1, width + 0.02, 0, -length + 0.03),
    ];
    const component = 85 / Math.sqrt(2),
      dt = 1 / 240;
    cars[0].body.velocity.set(component, 0, component);
    cars[1].body.velocity.set(-component, 0, -component);
    const before = momentum(cars),
      initialEnergy = cars.reduce((sum, c) => sum + energy(c), 0);
    expect(new BoxContact().intersect(proxy(cars[0]), proxy(cars[1]))).toBe(false);
    const solver = new CollisionSolver();
    solver.beginStep(cars);
    advance(cars, dt);
    expect(new BoxContact().intersect(proxy(cars[0]), proxy(cars[1]))).toBe(false);
    solver.solve(cars, track, dt);
    const after = momentum(cars);
    expect(solver.sweptContacts).toBeGreaterThan(0);
    expect(cars[0].impact).toBeGreaterThan(0);
    expect(state(cars).every(Number.isFinite)).toBe(true);
    expect(after.linear.sub(before.linear).length()).toBeLessThan(1e-7);
    expect(after.angular.sub(before.angular).length()).toBeLessThan(1e-7);
    expect(cars.reduce((sum, c) => sum + energy(c), 0)).toBeLessThan(initialEnergy);
  });

  it('prevents genuine GP chassis from tunnelling without imposing a velocity clamp', () => {
    const cars = [bike(0, -1, 250), bike(1, 1, -250)],
      before = momentum(cars);
    const initialEnergy = cars.reduce((sum, c) => sum + energy(c), 0);
    const solver = drift(cars, 0.01),
      after = momentum(cars);
    expect(solver.sweptContacts).toBe(1);
    expect(solver.sweepLimitReached).toBe(false);
    expect(solver.sweepIterationLimits).toBe(0);
    expect(cars[0].body.position.x).toBeLessThan(cars[1].body.position.x);
    expect(cars[0].body.velocity.x).toBeCloseTo(-20, 8);
    expect(cars[1].body.velocity.x).toBeCloseTo(20, 8);
    expect(after.linear.sub(before.linear).length()).toBeLessThan(1e-8);
    expect(after.angular.sub(before.angular).length()).toBeLessThan(1e-8);
    expect(cars.reduce((sum, c) => sum + energy(c), 0)).toBeCloseTo(initialEnergy * 0.08 ** 2, 5);
  });

  it.each([0, -1e-7])('stops a full crossing from an initially touching/shallow gap %s', (gap) => {
    const width = VEHICLES.gpr1.halfExtents[0];
    const cars = [bike(0, -width - gap / 2, 250), bike(1, width + gap / 2, -250)];
    const solver = drift(cars, 1 / 240);
    expect(solver.sweptContacts).toBe(1);
    expect(cars[0].body.position.x).toBeLessThan(cars[1].body.position.x);
    expect(cars[0].body.velocity.x).toBeCloseTo(-20, 8);
    expect(solver.sweepLimitReached).toBe(false);
  });

  it('recomputes remaining travel when a struck bike can hit a third bike', () => {
    const cars = [bike(0, -1.5, 300), bike(1, 0), bike(2, 1.5)],
      before = momentum(cars);
    const initialEnergy = cars.reduce((sum, c) => sum + energy(c), 0);
    const solver = drift(cars, 0.01),
      after = momentum(cars);
    expect(solver.sweptContacts).toBeGreaterThanOrEqual(2);
    expect(solver.sweepLimitReached).toBe(false);
    expect(cars[2].body.velocity.x).toBeGreaterThan(50);
    expect(cars[0].body.position.x).toBeLessThan(cars[1].body.position.x);
    expect(cars[1].body.position.x).toBeLessThan(cars[2].body.position.x);
    expect(after.linear.sub(before.linear).length()).toBeLessThan(1e-7);
    expect(after.angular.sub(before.angular).length()).toBeLessThan(1e-7);
    expect(cars.reduce((sum, c) => sum + energy(c), 0)).toBeLessThan(initialEnergy);
  });

  it('reports the bounded event limit for a tight inelastic impact cascade', () => {
    const cars = [bike(0, -1, 300), bike(1, 0), bike(2, 1)],
      before = momentum(cars),
      initialEnergy = cars.reduce((sum, c) => sum + energy(c), 0);
    const solver = drift(cars, 0.01),
      after = momentum(cars);
    // With the smaller gaps, successive legitimate recontacts occur before
    // this deliberately long substep ends. The diagnostic must expose the
    // bounded fallback rather than imply that every event was resolved.
    expect(solver.sweepLimitReached).toBe(true);
    expect(state(cars).every(Number.isFinite)).toBe(true);
    expect(after.linear.sub(before.linear).length()).toBeLessThan(1e-7);
    expect(after.angular.sub(before.angular).length()).toBeLessThan(1e-7);
    expect(cars.reduce((sum, c) => sum + energy(c), 0)).toBeLessThan(initialEnergy);
    expect(cars[0].body.position.x).toBeLessThan(cars[1].body.position.x);
    expect(cars[1].body.position.x).toBeLessThan(cars[2].body.position.x);
  });

  it('leaves separating contacts and their angular velocities unchanged', () => {
    const width = VEHICLES.gpr1.halfExtents[0],
      cars = [bike(0, -width, -5), bike(1, width, 5)];
    const solver = drift(cars, 1 / 240);
    expect(solver.sweptContacts).toBe(0);
    expect(cars.map((c) => c.body.velocity.x)).toEqual([-5, 5]);
    expect(cars.every((c) => c.body.omega.length() === 0 && c.impact === 0)).toBe(true);
  });

  it('depenetrates resting overlap without adding kinetic energy', () => {
    const width = VEHICLES.gpr1.halfExtents[0],
      cars = [bike(0, -width + 0.004), bike(1, width - 0.004)];
    const oldDistance = cars[1].body.position.x - cars[0].body.position.x;
    const solver = drift(cars, 1 / 240);
    expect(solver.sweptContacts).toBe(0);
    expect(cars[1].body.position.x - cars[0].body.position.x).toBeGreaterThan(oldDistance);
    expect(cars.reduce((sum, c) => sum + energy(c), 0)).toBe(0);
    expect(cars.every((c) => c.impact === 0)).toBe(true);
  });

  it('does not turn a placement or recovery teleport into travel through another bike', () => {
    const cars = [bike(0, -2), bike(1, 0)],
      solver = new CollisionSolver();
    solver.beginStep(cars);
    cars[0].body.position.x = 2;
    solver.solve(cars, track, 1 / 240);
    expect(solver.sweptContacts).toBe(0);
    expect(cars[0].body.position.x).toBe(2);
    expect(cars.every((c) => c.body.velocity.length() === 0)).toBe(true);
    solver.beginStep(cars);
    solver.solve(cars, track, 1 / 240);
    cars[0].body.position.x = -2;
    solver.solve(cars, track, 1 / 240);
    expect(solver.sweptContacts).toBe(0);
  });

  it('rejects a stale capture when a new entrant reuses the same ID and slot', () => {
    const old = bike(0, -2, 250),
      other = bike(1, 0),
      solver = new CollisionSolver();
    solver.beginStep([old, other]);
    const fresh = bike(0, 2, 250);
    solver.solve([fresh, other], track, 0.02);
    expect(solver.sweptContacts).toBe(0);
    expect(fresh.body.position.x).toBe(2);
    expect(fresh.body.velocity.x).toBe(250);
    expect(other.body.velocity.length()).toBe(0);
  });

  it('requires a fresh capture and keeps the old discrete-only API valid', () => {
    const cars = [bike(0, -1, 250), bike(1, 1, -250)],
      solver = new CollisionSolver();
    advance(cars, 0.01);
    solver.solve(cars, track, 0.01);
    expect(solver.sweptContacts).toBe(0);
    expect(cars[0].body.velocity.x).toBe(250);
    solver.beginStep(cars);
    solver.solve(cars, track);
    expect(solver.sweptContacts).toBe(0);
    solver.solve([], track, 1 / 240);
    expect(solver.sweepQueries).toBe(0);
  });

  it('keeps deterministic outcomes and scratch state local to each solver', () => {
    const run = () => {
      const cars = [bike(0, -1, 300), bike(1, 0), bike(2, 1)],
        solver = new CollisionSolver();
      for (let i = 0; i < 8; i++) drift(cars, 1 / 120, solver);
      return state(cars);
    };
    const expected = run();
    drift([bike(8, -1, 200), bike(9, 1, -200)], 0.01);
    expect(run()).toEqual(expected);
    expect(expected.every(Number.isFinite)).toBe(true);
  });

  it('conserves complete momentum for unequal off-centre rotating bodies', () => {
    const cars = [bike(0, -0.35, 12), bike(1, 0.35, -6, 0.25)];
    cars[0].body.mass = 210;
    cars[1].body.mass = 330;
    cars[0].body.inertia.set(50, 40, 16);
    cars[1].body.inertia.set(70, 100, 90);
    cars[0].body.orientation.yaw(0.2);
    cars[1].body.orientation.yaw(-0.3);
    cars[0].body.velocity.z = 2;
    cars[1].body.velocity.z = -1;
    cars[0].body.omega.set(0, 0.7, 0.2);
    cars[1].body.omega.set(0, -0.5, 0.1);
    const before = momentum(cars),
      initialEnergy = cars.reduce((sum, c) => sum + energy(c), 0);
    new CollisionSolver().impulse(cars[0], cars[1], new Vec3(0, 0, 0.12), new Vec3(-1, 0, 0), 0);
    const after = momentum(cars);
    expect(after.linear.sub(before.linear).length()).toBeLessThan(1e-9);
    expect(after.angular.sub(before.angular).length()).toBeLessThan(1e-9);
    expect(cars.reduce((sum, c) => sum + energy(c), 0)).toBeLessThan(initialEnergy);
  });

  it('responds dissipatively to an immovable wall with an angular impulse', () => {
    const car = bike(0, 0, 30);
    car.body.velocity.z = 12;
    const initial = energy(car);
    new CollisionSolver().impulse(car, null, new Vec3(0.2, 0, 0.7), new Vec3(-1, 0, 0), 0);
    expect(energy(car)).toBeLessThan(initial);
    expect(car.body.omega.length()).toBeGreaterThan(0);
    expect(car.impact).toBeGreaterThan(0);
    expect(state([car]).every(Number.isFinite)).toBe(true);
  });
});
