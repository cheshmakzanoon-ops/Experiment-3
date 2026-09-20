import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { RIDE_AXIS, sampleAeroMap } from '../src/simulation/aero-map.ts';
import { aero, groundEffect, wakeOverlap } from '../src/simulation/aero.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { Track, surfaceSample, SURFACE } from '../src/simulation/track.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { aquaplaning, makeTire, solveTire } from '../src/simulation/tire.ts';
const coefficients = () => ({ front: 0, rear: 0, floor: 0, drag: 0 });

describe('sampled aerodynamics and actual floor clearance', () => {
  it('reproduces every floor calibration node with no negative extrapolated coefficients', () => {
    const out = coefficients();
    for (const f of RIDE_AXIS)
      for (const r of RIDE_AXIS) {
        sampleAeroMap(f, r, 0, out);
        expect(out.floor).toBeCloseTo(groundEffect(f, r), 8);
      }
    for (const h of [-5, 0, 0.03, 0.065, 0.4, 10]) {
      sampleAeroMap(h, h, 0.2, out);
      expect(Object.values(out).every((v) => Number.isFinite(v) && v >= 0)).toBe(true);
    }
    sampleAeroMap(10, 10, 0, out);
    expect(out.floor).toBeLessThan(1e-6);
  });
  it('remains continuous at cell and pitch boundaries, with a separate pitch response', () => {
    const a = coefficients(),
      b = coefficients();
    for (const h of RIDE_AXIS) {
      sampleAeroMap(h - 1e-8, 0.075, 0, a);
      sampleAeroMap(h + 1e-8, 0.075, 0, b);
      expect(Math.abs(a.floor - b.floor)).toBeLessThan(1e-5);
    }
    sampleAeroMap(0.065, 0.075, 0, a);
    sampleAeroMap(0.065, 0.075, 0.06, b);
    expect(b.floor).toBeLessThan(a.floor);
    expect(b.front / b.rear).not.toBeCloseTo(a.front / a.rear, 3);
    expect(() => sampleAeroMap(NaN, 0.07, 0, a)).toThrow();
  });
  it('keeps quadratic load and drag scaling on the same map sample', () => {
    const a = { ...coefficients(), wake: 0 },
      b = { ...coefficients(), wake: 0 };
    aero(100 / 3.6, DEFAULT_SETUP, 0.05, 0.07, 1, 1, 1, 0.3, 0.05, a);
    aero(200 / 3.6, DEFAULT_SETUP, 0.05, 0.07, 1, 1, 1, 0.3, 0.05, b);
    for (const key of ['front', 'rear', 'floor', 'drag'] as const)
      expect(b[key] / a[key]).toBeCloseTo(4, 10);
  });
  it('measures front and rear clearance at chassis floor stations during pitch', () => {
    const track = new Track('clear', true),
      car = new Vehicle(0);
    car.body.position.set(0, 0.6, 0);
    const angle = 0.025;
    car.body.orientation.x = Math.sin(angle / 2);
    car.body.orientation.w = Math.cos(angle / 2);
    const front = car.floorClearance(track, 1.7),
      rear = car.floorClearance(track, -1.6);
    expect(rear - front).toBeCloseTo(3.3 * Math.sin(angle), 8);
    expect(front).toBeGreaterThan(0);
  });
});
describe('finite, continuous wake volumes', () => {
  const leader = new Vec3(),
    forward = new Vec3(0, 0, 1);
  const value = (behind: number, speed = 55) =>
    wakeOverlap(new Vec3(0, 0, -behind), leader, forward, speed);
  it('fades in/out at front, back and leader-speed boundaries', () => {
    for (const boundary of [2, 6, 75, 100])
      expect(Math.abs(value(boundary - 1e-6) - value(boundary + 1e-6))).toBeLessThan(1e-5);
    expect(value(20, 20.000001)).toBeLessThan(1e-8);
    expect(value(20)).toBeGreaterThan(value(70));
  });
  it('does not affect an overpass, opposing car, or laterally separated car', () => {
    expect(wakeOverlap(new Vec3(0, 5, -20), leader, forward, 55)).toBe(0);
    expect(wakeOverlap(new Vec3(10, 0, -20), leader, forward, 55)).toBe(0);
    expect(wakeOverlap(new Vec3(0, 0, -20), leader, forward, 55, new Vec3(0, 0, -1))).toBe(0);
    expect(wakeOverlap(new Vec3(0, 0, -20), leader, new Vec3(), 55)).toBe(0);
  });
});
describe('surface contact cannot be decorative', () => {
  it('makes aquaplaning depend smoothly on contact load, water, speed and tread', () => {
    expect(aquaplaning('medium', 1000, 1.5, 55)).toBeGreaterThan(
      aquaplaning('medium', 4000, 1.5, 55),
    );
    expect(aquaplaning('medium', 2200, 1.5, 55)).toBeGreaterThan(aquaplaning('wet', 2200, 1.5, 55));
    expect(aquaplaning('medium', 2200, 0, 100)).toBe(0);
    expect(aquaplaning('medium', 2200, 1.5, 0)).toBe(0);
    expect(aquaplaning('medium', 2200, 1.5, 55)).toBe(aquaplaning('medium', 2200, 1.5, -55));
  });
  it('airborne tires neither clear water nor deposit rubber, marbles or dirt', () => {
    const track = new Track('rain');
    const before = [track.water[12], track.rubber[12], track.marbles[7]];
    track.interact(12, 0, 0, 70, 1);
    expect([track.water[12], track.rubber[12], track.marbles[7]]).toEqual(before);
    const tire = makeTire('medium'),
      surface = surfaceSample();
    surface.surface = SURFACE.GRASS;
    tire.omega = 200;
    solveTire(tire, 60, 0, 0, 0, 0, surface, 0, 1 / 240);
    expect(tire.dirt).toBe(0);
    track.interact(12, 2200, 1000, 70, 1);
    expect(track.water[12]).toBeLessThan(before[0]);
  });
});
