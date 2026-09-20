import { describe, it, expect } from 'vitest';
import { Vec3, FixedStepper } from '../src/core/math.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { Track, surfaceSample } from '../src/simulation/track.ts';
import { ellipse, makeTire, peakGrip, solveTire, temperatureGrip } from '../src/simulation/tire.ts';
import { aero, groundEffect, wakeOverlap } from '../src/simulation/aero.ts';
import { RigidBody } from '../src/simulation/rigid.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { CollisionSolver } from '../src/simulation/collision.ts';
import { Simulation } from '../src/simulation/world.ts';
function stillTrack() {
  const t = new Track('clear', true);
  t.windX = 0;
  t.windZ = 0;
  return t;
}
const result = () => ({ front: 0, rear: 0, floor: 0, drag: 0, wake: 0 });
describe('tire model', () => {
  it('saturates combined forces inside the friction circle', () => {
    const out = { fx: 0, fy: 0 };
    ellipse(5000, 5000, 4000, out);
    expect(Math.hypot(out.fx, out.fy)).toBeCloseTo(4000, 8);
    ellipse(5000, 5000, 0, out);
    expect(out.fx).toBe(0);
    expect(out.fy).toBe(0);
  });
  it('has load sensitivity, a thermal optimum, and a wet penalty for slicks', () => {
    const t = makeTire('medium'),
      s = surfaceSample();
    expect(peakGrip(t, 4000, s, 40)).toBeLessThan(peakGrip(t, 2000, s, 40));
    expect(temperatureGrip('medium', 92)).toBeGreaterThan(temperatureGrip('medium', 32));
    const dry = peakGrip(t, 3000, s, 50);
    s.water = 1;
    expect(peakGrip(t, 3000, s, 50)).toBeLessThan(dry * 0.65);
    expect(peakGrip(makeTire('wet'), 3000, s, 50)).toBeGreaterThan(peakGrip(t, 3000, s, 50));
  });
  it('dissipates lateral slip with opposing force', () => {
    const t = makeTire('medium');
    t.omega = 40 / 0.335;
    solveTire(t, 40, 3, 2500, 0, 0, surfaceSample(), 0, 1 / 240);
    expect(t.fy).toBeLessThan(0);
    expect(t.energy).toBeGreaterThan(0);
  });
  it('does not accelerate a locked wheel backwards under brake torque', () => {
    const t = makeTire('medium');
    for (let i = 0; i < 1000; i++) solveTire(t, 0, 0, 2000, 0, 3000, surfaceSample(), 0, 1 / 240);
    expect(t.omega).toBe(0);
    expect(t.fx).toBe(0);
  });
  it('uses the same wheel torque for regen but less disc heat', () => {
    const friction = makeTire('medium'),
      regen = makeTire('medium');
    friction.omega = regen.omega = 90;
    const s = surfaceSample();
    solveTire(friction, 30, 0, 2500, 0, 200, s, 0, 1 / 240);
    solveTire(regen, 30, 0, 2500, 0, 200, s, 0, 1 / 240, 200);
    expect(friction.omega).toBeCloseTo(regen.omega, 10);
    expect(friction.discTemp).toBeGreaterThan(regen.discTemp);
  });
  it('keeps low-speed alternating inputs finite', () => {
    const t = makeTire('soft');
    for (let i = 0; i < 15000; i++)
      solveTire(
        t,
        Math.sin(i * 0.004) * 0.5,
        Math.sin(i * 0.01) * 0.05,
        2200,
        i % 200 < 100 ? 40 : -40,
        i % 300 < 20 ? 400 : 0,
        surfaceSample(),
        0,
        1 / 240,
      );
    expect(Number.isFinite(t.omega + t.surfaceTemp + t.fx + t.fy)).toBe(true);
  });
});
describe('aerodynamics', () => {
  it('has approximately quadratic force and drag scaling', () => {
    const a = result(),
      b = result();
    aero(30, DEFAULT_SETUP, 0.065, 0.075, 1, 1, 1, 0, 0, a);
    aero(60, DEFAULT_SETUP, 0.065, 0.075, 1, 1, 1, 0, 0, b);
    expect(b.front / a.front).toBeCloseTo(4, 10);
    expect(b.drag / a.drag).toBeCloseTo(4, 10);
  });
  it('loses floor effectiveness when choked or excessively high', () => {
    expect(groundEffect(0.01, 0.01)).toBeLessThan(groundEffect(0.065, 0.075));
    expect(groundEffect(0.25, 0.25)).toBeLessThan(groundEffect(0.065, 0.075));
  });
  it('links wing damage and dirty air to actual downforce', () => {
    const clean = result(),
      damaged = result();
    aero(60, DEFAULT_SETUP, 0.065, 0.075, 1, 1, 1, 0, 0, clean);
    aero(60, DEFAULT_SETUP, 0.065, 0.075, 0.5, 1, 1, 0.7, 0, damaged);
    expect(damaged.front).toBeLessThan(clean.front * 0.5);
    expect(damaged.drag).toBeLessThan(clean.drag * 1.1);
  });
  it('creates a wake behind but not ahead of the leader', () => {
    const leader = new Vec3(),
      forward = new Vec3(0, 0, 1);
    expect(wakeOverlap(new Vec3(0, 0, -20), leader, forward, 60)).toBeGreaterThan(0);
    expect(wakeOverlap(new Vec3(0, 0, 20), leader, forward, 60)).toBe(0);
    expect(wakeOverlap(new Vec3(30, 0, -20), leader, forward, 60)).toBe(0);
  });
});
describe('rigid dynamics and integration', () => {
  it('falls under gravity without manufactured forces', () => {
    const b = new RigidBody();
    for (let i = 0; i < 120; i++) {
      b.clear();
      b.force.y = -b.mass * 9.80665;
      b.integrate(1 / 120);
    }
    expect(b.velocity.y).toBeCloseTo(-9.80665, 8);
    expect(b.position.y).toBeCloseTo(-4.944, 2);
  });
  it('settles on four suspension contacts without low-speed chatter', () => {
    const track = stillTrack(),
      car = new Vehicle(0);
    car.place(track, 30);
    car.input.brake = 1;
    for (let i = 0; i < 2400; i++) car.step(1 / 240, track);
    expect(car.speed).toBeLessThan(0.015);
    expect(car.body.position.y).toBeGreaterThan(0.45);
    expect(car.tires.reduce((sum, t) => sum + t.load, 0)).toBeCloseTo(car.body.mass * 9.80665, -1);
  });
  it('accelerates from torque and brakes to rest', () => {
    const track = stillTrack(),
      car = new Vehicle(0);
    car.place(track, 30);
    car.input.throttle = 1;
    for (let i = 0; i < 720; i++) car.step(1 / 240, track);
    expect(car.speed).toBeGreaterThan(24);
    const fuel = car.fuel;
    car.input.throttle = 0;
    car.input.brake = 1;
    for (let i = 0; i < 1200; i++) car.step(1 / 240, track);
    expect(car.speed).toBeLessThan(0.1);
    expect(car.fuel).toBeLessThan(fuel);
  });
  it('conserves pair momentum and dissipates collision energy', () => {
    const a = new Vehicle(0),
      b = new Vehicle(1);
    a.body.position.set(-1, 0, 0);
    b.body.position.set(1, 0, 0);
    a.body.velocity.set(5, 0, 0);
    b.body.velocity.set(-5, 0, 0);
    const initial = 25 * a.body.mass;
    new CollisionSolver().impulse(a, b, new Vec3(), new Vec3(-1, 0, 0), 0.1);
    expect(a.body.velocity.x + b.body.velocity.x).toBeCloseTo(0, 10);
    const energy =
      0.5 * a.body.mass * (a.body.velocity.length() ** 2 + b.body.velocity.length() ** 2);
    expect(energy).toBeLessThan(initial);
  });
  it('serializes identical results for identical seeds and input history', () => {
    const a = new Simulation({ ...DEFAULT_OPTIONS, opponents: 1, mode: 'practice' }),
      b = new Simulation({ ...DEFAULT_OPTIONS, opponents: 1, mode: 'practice' });
    a.autoPlayer = b.autoPlayer = true;
    for (let i = 0; i < 1800; i++) {
      a.step(1 / 120);
      b.step(1 / 120);
    }
    expect(Array.from(a.makeFrame())).toEqual(Array.from(b.makeFrame()));
  });
  it.each([24, 30, 60, 90, 120, 144])('physics state is independent of %i FPS rendering', (fps) => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice' });
    sim.autoPlayer = true;
    const clock = new FixedStepper();
    for (let i = 0; i < fps * 3; i++) clock.advance(1 / fps, (dt) => sim.step(dt));
    const reference = new Simulation({ ...DEFAULT_OPTIONS, opponents: 0, mode: 'practice' });
    reference.autoPlayer = true;
    for (let i = 0; i < 360; i++) reference.step(1 / 120);
    expect(Array.from(sim.makeFrame())).toEqual(Array.from(reference.makeFrame()));
  });
});
