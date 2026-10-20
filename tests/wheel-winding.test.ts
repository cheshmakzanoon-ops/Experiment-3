import { describe, expect, it } from 'vitest';
import { TAU } from '../src/core/math.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { wheelPhase, wheelValue } from '../src/rendering/wheel-pose.ts';
import {
  CAR_STRIDE,
  F,
  H,
  HEADER,
  M,
  PROTOCOL_VERSION,
  W,
  WHEEL_BASE,
  WHEEL_MOTION_BASE,
  WHEEL_MOTION_STRIDE,
  WHEEL_STRIDE,
  carBase,
  snapshotIncompatibility,
} from '../src/simulation/protocol.ts';
import { makeTire } from '../src/simulation/tire.ts';
import {
  advanceWheelRotation,
  writeWheelRotation,
  type WheelRotation,
} from '../src/simulation/wheel-rotation.ts';
import { ReplayRecorder } from '../src/storage/recorders.ts';

const car = carBase(0),
  wheel = car + WHEEL_BASE,
  motion = car + WHEEL_MOTION_BASE;

/** Construct endpoints from a known integrated angular displacement, separately
 * from endpoint angular speeds. This can represent an unresolved braking/spin
 * impulse that a trapezoidal endpoint-speed estimate cannot recover. */
function measuredPair(travel: number, omegaA: number, omegaB: number, dt = 1 / 15, turns = 12) {
  const a = new Float32Array(HEADER + CAR_STRIDE),
    b = a.slice(),
    start = 0.25,
    total = start + travel,
    winding = Math.floor(total / TAU);
  a[H.CARS] = b[H.CARS] = 1;
  a[car + F.QW] = b[car + F.QW] = 1;
  b[H.TIME] = dt;
  a[wheel + W.ROTATION] = start;
  b[wheel + W.ROTATION] = total - winding * TAU;
  a[wheel + W.OMEGA] = omegaA;
  b[wheel + W.OMEGA] = omegaB;
  a[motion + M.VALID] = b[motion + M.VALID] = 1;
  a[motion + M.TURNS_FR] = turns;
  b[motion + M.TURNS_FR] = turns + winding;
  return { a, b, start };
}

describe('recorded whole wheel turns', () => {
  it('keeps precise bounded phase through signed crossings and multiple turns in one step', () => {
    const tire = makeTire('medium');
    let expected = 0;
    for (const radians of [1, 4 * TAU + 0.2, -0.4, -9 * TAU - 0.7, 2 * TAU + 0.15]) {
      expected += radians;
      advanceWheelRotation(tire, radians);
      expect(tire.turns * TAU + tire.rotation).toBeCloseTo(expected, 12);
      expect(tire.rotation).toBeGreaterThanOrEqual(0);
      expect(tire.rotation).toBeLessThan(TAU);
      expect(Number.isInteger(tire.turns)).toBe(true);
    }
  });

  it('does not add a phantom turn when a wheel locks early in a sparse snapshot interval', () => {
    const { a, b, start } = measuredPair(3, 300, 0);
    let previous = start;
    for (let i = 1; i < 100; i++) {
      const phase = wheelPhase(a, b, car, wheel, i / 100);
      expect(phase).toBeGreaterThanOrEqual(previous);
      expect(phase).toBeLessThanOrEqual(start + 3);
      previous = phase;
    }
    expect(wheelPhase(a, b, car, wheel, 0.9999)).toBeCloseTo(start + 3, 6);
    // These exact same endpoint omegas and wrapped phases previously select
    // an extra 2π rotation because endpoint averaging predicts ten radians.
    a[motion + M.VALID] = b[motion + M.VALID] = 0;
    expect(wheelPhase(a, b, car, wheel, 0.99)).toBeGreaterThan(start + 3 + 0.99 * TAU);
  });

  it('retains a wheelspin burst even when both recorded endpoint speeds are zero', () => {
    const travel = 8 * TAU + 1.2,
      { a, b, start } = measuredPair(travel, 0, 0);
    expect(wheelPhase(a, b, car, wheel, 0.5)).toBeCloseTo(start + travel / 2, 6);
    expect(wheelPhase(a, b, car, wheel, 0.9999)).toBeCloseTo(start + travel, 5);
    expect(wheelPhase(a, b, car, wheel, 1)).toBe(b[wheel + W.ROTATION]);
    a[motion + M.VALID] = b[motion + M.VALID] = 0;
    expect(wheelPhase(a, b, car, wheel, 0.5)).toBeCloseTo(start + 0.6, 6);
  });

  it.each([1, -1])('preserves exact signed turns across a two-second replay gap (%i)', (sign) => {
    const travel = sign * 400,
      { a, b, start } = measuredPair(travel, sign * 200, sign * 200, 2);
    for (const alpha of [0.1, 0.25, 0.5, 0.75, 0.99])
      expect(wheelPhase(a, b, car, wheel, alpha)).toBeCloseTo(start + travel * alpha, 5);
    // Phase can still be reconstructed if the optional velocity is unusable.
    b[wheel + W.OMEGA] = NaN;
    expect(wheelPhase(a, b, car, wheel, 0.5)).toBeCloseTo(start + travel / 2, 5);
  });

  it('keeps sub-milliradian phase resolution after one million revolutions', () => {
    const travel = 0.00023,
      { a, b, start } = measuredPair(travel, travel / 0.1, travel / 0.1, 0.1, 1_000_000);
    // A Float32 total angle loses this entire movement at the same history length.
    expect(Math.fround(1_000_000 * TAU + start + travel)).toBe(
      Math.fround(1_000_000 * TAU + start),
    );
    expect(wheelPhase(a, b, car, wheel, 0.5) - start).toBeCloseTo(travel / 2, 7);
  });

  it('records wheel validity independently and never treats a rounded integer as exact winding', () => {
    const frame = new Float32Array(HEADER + CAR_STRIDE),
      wheels: WheelRotation[] = [
        { rotation: 0.1, turns: -400 },
        { rotation: 1, turns: 0xffffff },
        { rotation: 2, turns: 0x1000000 + 1 },
        { rotation: 3, turns: 2.5 },
      ];
    frame[motion + M.VALID] = 15;
    writeWheelRotation(frame, car, wheels);
    expect(frame[motion + M.VALID]).toBe(3);
    expect(Array.from(frame.subarray(motion + M.TURNS_FR, motion + WHEEL_MOTION_STRIDE))).toEqual([
      -400, 0xffffff, 0, 0,
    ]);
  });

  it('uses the correct turn counter and validity bit for every wheel', () => {
    const { a, b } = measuredPair(0, 0, 0);
    a[motion + M.VALID] = b[motion + M.VALID] = 15;
    for (let i = 0; i < 4; i++) {
      const p = wheel + i * WHEEL_STRIDE,
        turns = [2, -3, 5, -7][i];
      a[p + W.ROTATION] = b[p + W.ROTATION] = 0.25;
      a[p + W.OMEGA] = b[p + W.OMEGA] = 0;
      a[motion + M.TURNS_FR + i] = 100;
      b[motion + M.TURNS_FR + i] = 100 + turns;
      expect(wheelPhase(a, b, car, p, 0.5)).toBeCloseTo(0.25 + turns * Math.PI, 7);
    }
    a[motion + M.VALID] = 13;
    expect(wheelPhase(a, b, car, wheel + WHEEL_STRIDE, 0.5)).toBe(0.25);
  });

  it('holds same-compound service replacement at installation, before the stop count increments', () => {
    const { a, b } = measuredPair(-12 * TAU, 0, 0);
    a[car + F.PIT_PHASE] = 3;
    b[car + F.PIT_PHASE] = 4;
    a[wheel + W.WEAR] = 0.8;
    b[wheel + W.WEAR] = 0;
    expect(a[car + F.PIT_STOPS]).toBe(b[car + F.PIT_STOPS]);
    expect(a[car + F.COMPOUND]).toBe(b[car + F.COMPOUND]);
    expect(wheelPhase(a, b, car, wheel, 0.99)).toBe(a[wheel + W.ROTATION]);
    expect(wheelValue(a, b, car, wheel, W.WEAR, 0.99)).toBe(a[wheel + W.WEAR]);
    expect(wheelPhase(a, b, car, wheel, 1)).toBe(b[wheel + W.ROTATION]);
    expect(wheelValue(a, b, car, wheel, W.WEAR, 1)).toBe(0);
  });

  it.each([
    [0, 4],
    [0, 5],
    [6, 4],
    [6, 5],
  ])(
    'does not unwind an old tire when a recording skips from pit phase %i to %i',
    (phaseA, phaseB) => {
      const { a, b } = measuredPair(-12 * TAU - 0.25, 60, 0, phaseA === 6 ? 120 : 20),
        presented = new PresentedFrame();
      // This gap spans pit entry, stopping and installation. The new tire has
      // no winding history; the stop count changes only on release (phase 6).
      // A phase-6 start spans another lap and visit before the next release.
      a[car + F.PIT_PHASE] = phaseA;
      b[car + F.PIT_PHASE] = phaseB;
      a[car + F.PIT_STOPS] = b[car + F.PIT_STOPS] = 2;
      a[car + F.VX] = 20;
      b[car + F.X] = 100;
      a[wheel + W.WEAR] = phaseA === 6 ? 0.01 : 0.8;
      b[wheel + W.WEAR] = 0;
      a[wheel + W.SURFACE_TEMP] = 110;
      b[wheel + W.SURFACE_TEMP] = 20;
      a[wheel + W.LENGTH] = 0.2;
      b[wheel + W.LENGTH] = 0.3;
      expect(b[motion + M.TURNS_FR]).toBe(0);
      expect(b[wheel + W.ROTATION]).toBe(0);
      expect(a[car + F.PIT_STOPS]).toBe(b[car + F.PIT_STOPS]);
      expect(a[car + F.COMPOUND]).toBe(b[car + F.COMPOUND]);
      for (const alpha of [0.1, 0.5, 0.99]) {
        const frame = presented.sample(a, b, alpha);
        expect(frame[wheel + W.ROTATION]).toBe(a[wheel + W.ROTATION]);
        for (const field of [W.OMEGA, W.WEAR, W.SURFACE_TEMP])
          expect(frame[wheel + field]).toBe(a[wheel + field]);
        // A plausible gap still moves the chassis and suspension. This test
        // cannot pass through the unrelated whole-vehicle reset fallback.
        expect(frame[car + F.X]).toBeCloseTo(100 * alpha, 5);
        expect(frame[wheel + W.LENGTH]).toBeCloseTo(0.2 + 0.1 * alpha, 6);
      }
      expect(presented.sample(a, b, 1)).toEqual(b);
    },
  );

  it('keeps measured wheel motion before a skipped service gap reaches installation', () => {
    const { a, b, start } = measuredPair(120, 60, 0, 20);
    b[car + F.PIT_PHASE] = 3;
    a[car + F.VX] = 20;
    b[car + F.X] = 100;
    a[wheel + W.WEAR] = 0.4;
    b[wheel + W.WEAR] = 0.8;
    const frame = new PresentedFrame().sample(a, b, 0.5);
    expect(frame[wheel + W.ROTATION]).toBeCloseTo(start + 60, 5);
    expect(frame[wheel + W.WEAR]).toBeCloseTo(0.6, 6);
  });

  it('continues the same tire motion and cooling from installation to lowering', () => {
    const { a, b, start } = measuredPair(0.3, 1.5, 1.5, 0.2);
    a[car + F.PIT_PHASE] = 4;
    b[car + F.PIT_PHASE] = 5;
    a[car + F.PIT_STOPS] = b[car + F.PIT_STOPS] = 2;
    a[wheel + W.SURFACE_TEMP] = 110;
    b[wheel + W.SURFACE_TEMP] = 100;
    const frame = new PresentedFrame().sample(a, b, 0.5);
    expect(frame[wheel + W.ROTATION]).toBeCloseTo(start + 0.15, 6);
    expect(frame[wheel + W.SURFACE_TEMP]).toBe(105);
  });

  it('retains the measured endpoints and deterministic winding under pause, resets and random seeking', () => {
    const { a, b } = measuredPair(7 * TAU + 1, 300, 0),
      sourceA = a.slice(),
      sourceB = b.slice(),
      presented = new PresentedFrame(),
      expected = wheelPhase(a, b, car, wheel, 0.37);
    for (const alpha of [0.9, 0.1, 1, 0, 0.37]) presented.sample(a, b, alpha);
    expect(presented.value[wheel + W.ROTATION]).toBeCloseTo(expected, 5);
    expect(presented.value[motion + M.VALID]).toBe(0);
    expect(presented.sample(a, a, 0.3)).toEqual(a);
    expect(presented.sample(a, b, 1)).toEqual(b);
    expect(a).toEqual(sourceA);
    expect(b).toEqual(sourceB);
    b[car + F.X] = 100;
    expect(wheelPhase(a, b, car, wheel, 0.37)).toBe(a[wheel + W.ROTATION]);
  });

  it('preserves winding in the bounded replay recorder and rejects pre-winding snapshot layouts', () => {
    const { a, b } = measuredPair(9 * TAU + 1.2, 0, 0),
      replay = new ReplayRecorder(1, 2),
      left = replay.makeFrame(),
      right = replay.makeFrame();
    replay.append(a);
    replay.append(b);
    const alpha = replay.sample(replay.duration / 2, left, right);
    for (let i = 0; i < WHEEL_MOTION_STRIDE; i++) {
      expect(left[motion + i]).toBe(a[motion + i]);
      expect(right[motion + i]).toBe(b[motion + i]);
    }
    expect(wheelPhase(left, right, car, wheel, alpha)).toBe(wheelPhase(a, b, car, wheel, 0.5));
    expect(PROTOCOL_VERSION).toBe(15);
    expect(snapshotIncompatibility(a, 13)).toBe(
      'snapshot format v13 is not supported (this build reads v15)',
    );
  });
});
