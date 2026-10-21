import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import {
  motocrossDriftSteer,
  motocrossFrontGripThrottle,
} from '../src/simulation/offroad/ai.ts';

describe('motocross AI sprung front contact reserve', () => {
  const mass = 184;
  it('does not pull drive during straight starts or normal loaded cornering', () => {
    expect(motocrossFrontGripThrottle(1, 0, mass, 0.2)).toBe(1);
    expect(motocrossFrontGripThrottle(0.8, mass * G * 0.35, mass, 0.8)).toBe(0.8);
    expect(motocrossFrontGripThrottle(0.2, mass * G * 0.1, mass, 0.7)).toBe(0.2);
  });

  it('reserves progressively more front support as the fork unloads', () => {
    const get = (fraction: number) =>
      motocrossFrontGripThrottle(1, mass * G * fraction, mass, 0.6);
    expect(get(0)).toBeCloseTo(0.18, 10);
    expect(get(0.15)).toBeCloseTo(0.59, 10);
    expect(get(0.3)).toBeCloseTo(1, 10);
    expect(get(0.4)).toBe(1);
    for (let n = 0; n < 29; n++) expect(get(n / 100)).toBeLessThanOrEqual(get((n + 1) / 100));
  });

  it('takes corrective steer opposite lateral drift with bounded authority', () => {
    const positive = motocrossDriftSteer(0.1, 5, 12);
    const negative = motocrossDriftSteer(-0.1, -5, 12);
    expect(positive).toBeLessThan(0.1);
    expect(negative).toBeGreaterThan(-0.1);
    expect(positive).toBeCloseTo(-negative, 10);
    expect(motocrossDriftSteer(0.7, 0, 12)).toBe(0.6);
    expect(motocrossDriftSteer(-0.7, 0, 12)).toBe(-0.6);
    expect(
      Math.abs(motocrossDriftSteer(0, 2, 24)),
    ).toBeLessThan(Math.abs(motocrossDriftSteer(0, 2, 7)));
  });
});
