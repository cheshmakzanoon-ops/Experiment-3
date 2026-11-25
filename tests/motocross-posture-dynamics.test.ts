import { describe, expect, it } from 'vitest';
import {
  motocrossDabTarget, motocrossStandingTarget, MxRiderPosture,
} from '../src/simulation/offroad/mx-rider-posture.ts';

const values = (posture: MxRiderPosture) => [
  posture.standing, posture.standingRate, posture.dab, posture.dabRate,
  posture.automaticBody, posture.bodyRate,
];

describe('fixed-tick motocross automatic posture', () => {
  it('eases into stance/foot/body motion at the previous response scale', () => {
    const posture = new MxRiderPosture();
    posture.step(0.001, 1, 1, 1);
    expect(posture.standing).toBeLessThan(0.0002);
    expect(posture.dab).toBeLessThan(0.0004);
    expect(posture.standingRate).toBeGreaterThan(0);
    posture.reset();
    posture.step(0.28, 1, 0, 0);
    expect(posture.standing).toBeGreaterThan(0.95);
    expect(posture.standing).toBeLessThan(1);
    posture.reset();
    posture.step(0.17, 0, 1, 0);
    expect(posture.dab).toBeGreaterThan(0.95);
    posture.reset();
    posture.step(0.27, 0, 0, 1);
    expect(posture.automaticBody).toBeGreaterThan(0.95);
  });

  it('preserves incoming velocity at a reversal instead of flipping it instantly', () => {
    const posture = new MxRiderPosture();
    posture.step(0.05, 1, 1, 1);
    const before = values(posture);
    posture.step(1e-8, 0, -1, -1);
    const after = values(posture);
    for (const index of [1, 3, 5]) {
      expect(after[index]).toBeGreaterThan(0);
      expect(Math.abs(after[index] - before[index])).toBeLessThan(0.00003);
    }
    for (const index of [0, 2, 4])
      expect((after[index] - before[index]) / 1e-8).toBeCloseTo(before[index + 1], 4);
    posture.step(0.1, 0, -1, -1);
    expect(posture.standingRate).toBeLessThan(0);
    expect(posture.dabRate).toBeLessThan(0);
    expect(posture.bodyRate).toBeLessThan(0);
  });

  it('gives the same timed command response under 60/120/240/480 Hz subdivision', () => {
    const sample = (hz: number) => {
      const posture = new MxRiderPosture();
      for (const [seconds, standing, dab, body] of [
        [0.3, 1, 1, 0.65], [0.2, 0.2, -1, -0.55], [0.4, 0, 0, 0],
      ])
        for (let n = 0; n < Math.round(seconds * hz); n++)
          posture.step(1 / hz, standing, dab, body);
      return values(posture);
    };
    const expected = sample(480);
    for (const hz of [60, 120, 240])
      sample(hz).forEach((value, i) => expect(value).toBeCloseTo(expected[i], 12));
  });

  it('holds automatic launch posture in flight and resumes from rest on landing', () => {
    const posture = new MxRiderPosture();
    posture.step(0.08, 0.6, 0.8, 0.7);
    const body = posture.automaticBody;
    expect(posture.bodyRate).toBeGreaterThan(0);
    for (let n = 0; n < 120; n++) posture.step(1 / 120, 1, 0);
    expect(posture.automaticBody).toBe(body);
    expect(posture.bodyRate).toBe(0);
    expect(posture.standing).toBeGreaterThan(0.999);
    expect(Math.abs(posture.dab)).toBeLessThan(1e-9);
    posture.step(1e-6, 0, 0, -0.7);
    expect(Math.abs(posture.automaticBody - body)).toBeLessThan(1e-9);
    expect(posture.bodyRate).toBeLessThan(0);
  });

  it('keeps every channel bounded and finite under fast reversals and invalid demands', () => {
    const posture = new MxRiderPosture();
    for (let n = 0; n < 1200; n++) {
      const command = n % 17 < 8 ? 1 : -1;
      posture.step(1 / 120, command, command * 4, n % 73 === 0 ? NaN : command);
      expect(posture.standing).toBeGreaterThanOrEqual(0);
      expect(posture.standing).toBeLessThanOrEqual(1);
      expect(Math.abs(posture.dab)).toBeLessThanOrEqual(1);
      expect(Math.abs(posture.automaticBody)).toBeLessThanOrEqual(1);
      expect(values(posture).every(Number.isFinite)).toBe(true);
    }
    posture.step(Number.MAX_VALUE, 1, -1, 0.5);
    expect(values(posture)).toEqual([1, 0, -1, 0, 0.5, 0]);
  });

  it('keeps paused/invalid time inert and clears all rates on a placement reset', () => {
    const posture = new MxRiderPosture();
    posture.step(0.06, 1, 1, 1);
    const before = values(posture);
    for (const dt of [0, -1, NaN, Infinity]) {
      posture.step(dt, 0, -1);
      expect(values(posture)).toEqual(before);
    }
    posture.reset(0.4, -0.6, 0.2);
    expect(values(posture)).toEqual([0.4, 0, -0.6, 0, 0.2, 0]);
    posture.reset(NaN, Infinity, -Infinity);
    expect(values(posture)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe('continuous motocross posture demand', () => {
  it('preserves rough-ground anticipation, steep climbs, airborne stance and corner seating', () => {
    expect(motocrossStandingTarget(12, 0, true, 0, false)).toBe(1);
    expect(motocrossStandingTarget(12, 0, false, 0, false)).toBe(0);
    expect(motocrossStandingTarget(12, 0.6, true, 0, false)).toBe(0);
    expect(motocrossStandingTarget(2, 0, false, 1, false)).toBe(1);
    expect(motocrossStandingTarget(0, 0.9, false, 0, true)).toBe(1);
    expect(motocrossStandingTarget(NaN, Infinity, true, NaN, false)).toBe(0);
  });

  it('changes continuously across former speed, lean and climb switches', () => {
    const epsilon = 1e-5;
    const near = (a: number, b: number) => {
      expect(a).toBeGreaterThan(0);
      expect(b).toBeLessThan(1);
      expect(Math.abs(a - b)).toBeLessThan(0.001);
    };
    near(motocrossStandingTarget(7 - epsilon, 0, true, 0, false),
      motocrossStandingTarget(7 + epsilon, 0, true, 0, false));
    near(motocrossStandingTarget(10, 0.42 - epsilon, true, 0, false),
      motocrossStandingTarget(10, 0.42 + epsilon, true, 0, false));
    near(motocrossStandingTarget(3, 0, false, 0.5 - epsilon, false),
      motocrossStandingTarget(3, 0, false, 0.5 + epsilon, false));
  });

  it('retracts a dab in flight/at speed and passes continuously through neutral', () => {
    const sample = (speed: number, lean: number, steer: number, airborne = false) =>
      motocrossDabTarget(speed, lean, steer, 6.5, 0.42, airborne);
    expect(sample(3, 0.4, 0)).toBe(1);
    expect(sample(3, -0.4, 0)).toBe(-1);
    expect(sample(3, 0, 0.5)).toBe(1);
    expect(sample(3, 0, -0.5)).toBe(-1);
    expect(sample(8, 0.4, 0.5)).toBe(0);
    expect(sample(3, 0.4, 0.5, true)).toBe(0);
    expect(Math.abs(sample(6.5 - 1e-5, 0.4, 0) - sample(6.5 + 1e-5, 0.4, 0))).toBeLessThan(0.001);
    expect(Math.abs(sample(3, -1e-5, 0.5) - sample(3, 1e-5, 0.5))).toBeLessThan(0.001);
    expect(motocrossDabTarget(NaN, NaN, NaN, 6.5, 0.42, false)).toBe(0);
    expect(motocrossDabTarget(3, 0.4, 0, Infinity, 0.42, false)).toBe(0);
  });
});
