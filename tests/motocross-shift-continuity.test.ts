import { describe, expect, it } from 'vitest';
import { MxGearStroke } from '../src/simulation/offroad/mx-gear-stroke.ts';

const values = (stroke: MxGearStroke) => [stroke.angle, stroke.cover, stroke.clear];
const rates = (stroke: MxGearStroke) => [stroke.angleRate, stroke.coverRate, stroke.clearRate];
const snapshot = (stroke: MxGearStroke) => [...values(stroke), ...rates(stroke)];

describe('motocross interrupted shift momentum', () => {
  it('carries the measured selector and boot velocities through legal repeated shifts and reversals', () => {
    // A bridge shortens near a travel limit; use a local derivative rather
    // than averaging its high, finite deceleration over a larger interval.
    const epsilon = 1e-10;
    for (const first of [-1, 1]) for (const next of [-1, 1]) {
      for (const at of [.060, .063, .090, .114, .126, .174, .205, .231, .259]) {
        const stroke = new MxGearStroke();
        stroke.engage(first, 0);
        const before = values(stroke.sample(at - epsilon));
        const position = values(stroke.sample(at)), velocity = rates(stroke);
        stroke.engage(next, at);
        expect(values(stroke.sample(at))).toEqual(position);
        rates(stroke).forEach((rate, i) => expect(rate).toBeCloseTo(velocity[i], 9));
        const after = values(stroke.sample(at + epsilon));
        for (let axis = 0; axis < 3; axis++) {
          expect((position[axis] - before[axis]) / epsilon).toBeCloseTo(velocity[axis], 3);
          expect((after[axis] - position[axis]) / epsilon).toBeCloseTo(velocity[axis], 3);
        }
      }
    }
  });

  it('retains the two audited nonzero incoming rates instead of stopping on the command', () => {
    const selector = new MxGearStroke(), boot = new MxGearStroke();
    selector.engage(-1, 0);
    selector.sample(.09);
    expect(selector.angleRate).toBeCloseTo(7.817898248869764, 6);
    const incomingAngle = selector.angleRate;
    selector.engage(1, .09);
    expect(selector.sample(.09).angleRate).toBeCloseTo(incomingAngle, 12);
    boot.engage(-1, 0);
    boot.sample(.063);
    expect(boot.clearRate).toBeCloseTo(-52.224, 6);
    const incomingClear = boot.clearRate;
    boot.engage(1, .063);
    expect(boot.sample(.063).clearRate).toBeCloseTo(incomingClear, 12);
  });

  it('keeps all channels inside the existing mechanical envelopes through many accepted requests', () => {
    const stroke = new MxGearStroke();
    let time = 0;
    for (let command = 0; command < 160; command++) {
      const direction = command % 5 < 3 ? -1 : 1;
      stroke.engage(direction, time);
      const duration = .060 + (command * 37 % 199) / 1000;
      for (let sample = 0; sample <= 80; sample++) {
        stroke.sample(time + duration * sample / 80);
        expect(stroke.angle).toBeGreaterThanOrEqual(-.24 - 1e-12);
        expect(stroke.angle).toBeLessThanOrEqual(.22 + 1e-12);
        for (const foot of [stroke.cover, stroke.clear]) {
          expect(foot).toBeGreaterThanOrEqual(-1e-12);
          expect(foot).toBeLessThanOrEqual(1 + 1e-12);
        }
        expect(snapshot(stroke).every(Number.isFinite)).toBe(true);
      }
      time += duration;
    }
    expect(snapshot(stroke.sample(time + .27))).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('joins the canonical stroke with matching velocity and finishes at the original time', () => {
    const interrupted = new MxGearStroke(), canonical = new MxGearStroke();
    interrupted.engage(-1, 0);
    interrupted.engage(1, .09);
    canonical.engage(1, .09);
    for (const time of [.045, .052, .09, .14, .26]) {
      expect(snapshot(interrupted.sample(.09 + time))).toEqual(snapshot(canonical.sample(.09 + time)));
    }
    const epsilon = 1e-8;
    for (const [at, axis] of [[.045, 0], [.022, 1], [.03, 2]]) {
      const before = rates(interrupted.sample(.09 + at - epsilon))[axis];
      const after = rates(interrupted.sample(.09 + at + epsilon))[axis];
      expect(before).toBeCloseTo(after, 3);
    }
  });

  it('samples the interrupted curve absolutely through pause, out-of-order seeks and reset', () => {
    const stroke = new MxGearStroke();
    stroke.engage(-1, 2);
    stroke.engage(1, 2.063);
    const times = [2.063, 2.068, 2.075, 2.09, 2.108, 2.2, 2.4];
    const expected = times.map(time => snapshot(stroke.sample(time)));
    for (let round = 0; round < 4; round++) {
      for (let i = times.length - 1; i >= 0; i--) {
        expect(snapshot(stroke.sample(times[i]))).toEqual(expected[i]);
        expect(snapshot(stroke.sample(times[i]))).toEqual(expected[i]);
      }
    }
    stroke.reset();
    expect(snapshot(stroke.sample(2.075))).toEqual([0, 0, 0, 0, 0, 0]);
    const fresh = new MxGearStroke();
    stroke.engage(-1, 3);
    fresh.engage(-1, 3);
    for (const time of [3, 3.03, 3.086, 3.115, 3.23, 3.26])
      expect(snapshot(stroke.sample(time))).toEqual(snapshot(fresh.sample(time)));
  });
});
