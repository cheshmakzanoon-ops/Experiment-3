import { describe, it, expect } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { RigidBody } from '../src/simulation/rigid.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { Track, surfaceSample } from '../src/simulation/track.ts';
import { ChassisBox, BoxContact } from '../src/simulation/obb.ts';
import { CollisionSolver } from '../src/simulation/collision.ts';
import { makeTire, peakGrip, solveTire } from '../src/simulation/tire.ts';
import { pitMergeConflict, pitYieldSpeed, safePitRelease } from '../src/simulation/pit-safety.ts';
import { updatePit } from '../src/simulation/race.ts';

const kinetic = (c: Vehicle) => {
  const omega = new Vec3();
  c.body.orientation.inverseRotate(c.body.omega, omega);
  return (
    0.5 *
    (c.body.mass * c.body.velocity.length() ** 2 +
      c.body.inertia.x * omega.x ** 2 +
      c.body.inertia.y * omega.y ** 2 +
      c.body.inertia.z * omega.z ** 2)
  );
};
describe('collision and component consequences', () => {
  it('separates chassis boxes with full orientation and returns finite contact', () => {
    const a = new ChassisBox(),
      b = new ChassisBox(),
      body = new RigidBody(),
      contact = new BoxContact();
    a.update(body);
    body.position.x = 1.5;
    body.orientation.yaw(0.3);
    b.update(body);
    expect(contact.intersect(a, b)).toBe(true);
    expect(contact.normal.length()).toBeCloseTo(1, 10);
    expect(contact.point.finite()).toBe(true);
    body.position.x = 8;
    b.update(body);
    expect(contact.intersect(a, b)).toBe(false);
    body.position.set(0, 3, 0);
    b.update(body);
    expect(contact.intersect(a, b)).toBe(false);
  });
  it('applies dissipative tangential angular impulse while preserving pair momentum', () => {
    const a = new Vehicle(0),
      b = new Vehicle(1);
    a.body.position.set(-1, 0, 0);
    b.body.position.set(1, 0, 0);
    a.body.velocity.set(8, 0, 4);
    b.body.velocity.set(-3, 0, -2);
    const momentum = new Vec3()
      .copy(a.body.velocity)
      .scale(a.body.mass)
      .addScaled(b.body.velocity, b.body.mass);
    const before = kinetic(a) + kinetic(b);
    new CollisionSolver().impulse(a, b, new Vec3(0, 0, 0.4), new Vec3(-1, 0, 0), 0.1);
    const after = new Vec3()
      .copy(a.body.velocity)
      .scale(a.body.mass)
      .addScaled(b.body.velocity, b.body.mass);
    expect(after.sub(momentum).length()).toBeLessThan(1e-8);
    expect(kinetic(a) + kinetic(b)).toBeLessThan(before);
    expect(Math.abs(a.body.omega.y)).toBeGreaterThan(0);
  });
  it('damages the contacted wheel rather than every suspension corner', () => {
    const c = new Vehicle(0);
    c.impactAt(50000, new Vec3(-0.83, 0, 1.82));
    expect(c.cornerDamage[0]).toBeGreaterThan(0.5);
    expect(c.cornerDamage[1]).toBe(0);
    expect(c.tires[0].punctured).toBe(true);
    expect(c.tires[1].punctured).toBe(false);
  });
  it('punctures change pressure, radius and usable grip; tire service removes the fault', () => {
    const c = new Vehicle(0),
      dry = makeTire('medium'),
      s = surfaceSample();
    c.tires[0].punctured = true;
    solveTire(c.tires[0], 20, 1, 2000, 0, 0, s, 0, 1 / 240);
    expect(c.tires[0].pressure).toBeLessThan(20);
    expect(c.tires[0].radius).toBeLessThan(dry.radius * 0.8);
    expect(peakGrip(c.tires[0], 2000, s, 20)).toBeLessThan(peakGrip(dry, 2000, s, 20) * 0.3);
    c.replaceTires('intermediate');
    expect(c.tires.every((t) => !t.punctured)).toBe(true);
  });
  it('detaches each destroyed wing once and gives the fragment physical motion', () => {
    const c = new Vehicle(0),
      track = new Track();
    c.body.position.y = 2;
    c.body.velocity.z = 20;
    c.damage(200000, true);
    expect(c.lostMass).toBe(4.5);
    expect(c.debris.pieces[0].active).toBe(true);
    c.damage(200000, true);
    expect(c.lostMass).toBe(4.5);
    const z = c.debris.pieces[0].position.z;
    c.debris.step(0.1, track);
    expect(c.debris.pieces[0].position.z).toBeGreaterThan(z);
    expect(c.debris.pieces[0].velocity.y).toBeLessThan(0);
  });
});
describe('pit traffic gates', () => {
  const track = new Track();
  it('yields for a fast car approaching the merge and resumes after it passes', () => {
    const c = new Vehicle(0),
      other = new Vehicle(1);
    c.inPit = true;
    c.pitPhase = 6;
    c.s = 265;
    c.speed = 12;
    other.s = track.length - 10;
    other.speed = 70;
    expect(pitMergeConflict(c, [c, other], track)).toBe(true);
    expect(pitYieldSpeed(c, true, 5)).toBeLessThan(6);
    other.s = 350;
    expect(pitMergeConflict(c, [c, other], track)).toBe(false);
  });
  it('allows a safe separated racing lane and does not deadlock on a stopped queue', () => {
    const c = new Vehicle(0),
      other = new Vehicle(1);
    c.inPit = true;
    c.pitPhase = 6;
    c.s = 265;
    c.speed = 0;
    other.s = track.length - 10;
    other.speed = 70;
    other.lateral = -6;
    other.aiOffset = -6;
    expect(pitMergeConflict(c, [c, other], track)).toBe(false);
    c.pitPhase = 5;
    c.s = 102;
    c.lateral = 24.1;
    other.inPit = true;
    other.s = 94;
    other.lateral = 20.5;
    other.speed = 0;
    expect(safePitRelease(c, [c, other], track)).toBe(true);
    other.s = 100;
    expect(safePitRelease(c, [c, other], track)).toBe(false);
  });
  it('does not self-block or block on parked pit boxes', () => {
    const c = new Vehicle(0),
      other = new Vehicle(1);
    c.inPit = true;
    c.pitPhase = 6;
    c.s = 265;
    other.inPit = true;
    other.pitPhase = 3;
    other.s = 110;
    expect(pitMergeConflict(c, [c, other], track)).toBe(false);
  });
  it('holds the jack until the pit lane is clear instead of unsafe release', () => {
    const c = new Vehicle(0),
      other = new Vehicle(1);
    c.inPit = true;
    c.pitPhase = 5;
    c.pitClock = 5.3;
    c.s = 102;
    c.lateral = 24.1;
    other.inPit = true;
    other.s = 90;
    other.lateral = 20.5;
    other.speed = 20;
    expect(safePitRelease(c, [c, other], track)).toBe(false);
    updatePit(c, track, 1 / 120, [c, other]);
    expect(c.pitPhase).toBe(5);
    expect(c.pitStops).toBe(0);
    other.s = 135;
    updatePit(c, track, 1 / 120, [c, other]);
    expect(c.pitPhase).toBe(6);
    expect(c.pitStops).toBe(1);
  });
});
