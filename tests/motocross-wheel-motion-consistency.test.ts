import { describe, expect, it } from 'vitest';
import { TAU } from '../src/core/math.ts';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { wheelPhase, wheelValue } from '../src/rendering/wheel-pose.ts';
import {
  B,
  BIKE_BASE,
  CAR_STRIDE,
  F,
  H,
  HEADER,
  M,
  R,
  RACE_BASE,
  ROAD_BIKE_CONTACT,
  W,
  WHEEL_BASE,
  WHEEL_CONTACT_BASE,
  WHEEL_MOTION_BASE,
  WHEEL_STRIDE,
  carBase,
} from '../src/simulation/protocol.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';

const car = carBase(0),
  wheel = car + WHEEL_BASE,
  motion = car + WHEEL_MOTION_BASE;

/** Net measured travel is independent of the endpoint velocities: an interval
 * may contain a spin burst or a lock that neither endpoint speed resolves. */
function pair(
  travel: number,
  omegaA: number,
  omegaB: number,
  duration = 1 / 15,
  vehicle = 'mx250',
  index = 0,
) {
  const a = new Float32Array(HEADER + CAR_STRIDE),
    b = a.slice(),
    p = wheel + index * WHEEL_STRIDE,
    total = 0.25 + travel,
    winding = Math.floor(total / TAU);
  a[H.CARS] = b[H.CARS] = 1;
  a[car + F.QW] = b[car + F.QW] = 1;
  a[car + RACE_BASE + R.VEHICLE] = b[car + RACE_BASE + R.VEHICLE] = vehicleIndex(vehicle);
  b[H.TIME] = duration;
  a[p + W.ROTATION] = 0.25;
  b[p + W.ROTATION] = total - winding * TAU;
  a[p + W.OMEGA] = omegaA;
  b[p + W.OMEGA] = omegaB;
  a[motion + M.VALID] = b[motion + M.VALID] = 1 << index;
  a[motion + M.TURNS_FR + index] = 12;
  b[motion + M.TURNS_FR + index] = 12 + winding;
  return { a, b, p };
}

function recordedTravel(a: Float32Array, b: Float32Array, index = 0) {
  const p = wheel + index * WHEEL_STRIDE;
  return (
    b[p + W.ROTATION] -
    a[p + W.ROTATION] +
    TAU * (b[motion + M.TURNS_FR + index] - a[motion + M.TURNS_FR + index])
  );
}

/** Independently differentiate the public phase sampler, using the serialized
 * clock duration. Interior probes avoid the intentional wrapped endpoint. */
function phaseRate(a: Float32Array, b: Float32Array, p: number, alpha: number) {
  const epsilon = 1e-5;
  return (
    (wheelPhase(a, b, car, p, alpha + epsilon) - wheelPhase(a, b, car, p, alpha - epsilon)) /
    (2 * epsilon * (b[H.TIME] - a[H.TIME]))
  );
}

function consistent(a: Float32Array, b: Float32Array, p = wheel) {
  const view = new PresentedFrame();
  for (const alpha of [0.125, 0.25, 0.5, 0.75, 0.875]) {
    const rate = wheelValue(a, b, car, p, W.OMEGA, alpha),
      shown = view.sample(a, b, alpha);
    expect(Math.abs(rate - phaseRate(a, b, p, alpha))).toBeLessThan(2e-6 + Math.abs(rate) * 1e-8);
    expect(shown[p + W.OMEGA]).toBe(Math.fround(rate));
    expect(shown[p + W.ROTATION]).toBe(Math.fround(wheelPhase(a, b, car, p, alpha)));
  }
}

describe('motocross displayed wheel phase and angular velocity', () => {
  it.each(['mx250', 'mx450'])('publishes the zero-endpoint spin burst for %s', (vehicle) => {
    const { a, b } = pair(3, 0, 0, 1 / 15, vehicle),
      dt = b[H.TIME] - a[H.TIME];
    consistent(a, b);
    expect(wheelValue(a, b, car, wheel, W.OMEGA, 0.5)).toBeCloseTo(4.5 / dt, 10);
    expect(wheelValue(a, b, car, wheel, W.OMEGA, 0.5)).toBeGreaterThan(67);
  });

  it.each([1, -1])('differentiates the limited rapid-lock trajectory in direction %i', (sign) => {
    const { a, b } = pair(sign * 3, sign * 300, 0),
      dt = b[H.TIME] - a[H.TIME];
    consistent(a, b);
    // The start tangent is limited to three times the measured displacement.
    // Its midpoint speed is 33.75 rad/s, not the old endpoint average of 150.
    expect(wheelValue(a, b, car, wheel, W.OMEGA, 0.5)).toBeCloseTo((sign * 2.25) / dt, 5);
    for (const alpha of [0.01, 0.25, 0.5, 0.75, 0.99])
      expect(sign * wheelValue(a, b, car, wheel, W.OMEGA, alpha)).toBeGreaterThanOrEqual(0);
    // Actual sample times still expose exact recorded bytes, even when the
    // conservative interior curve needed a different endpoint tangent.
    expect(wheelValue(a, b, car, wheel, W.OMEGA, 0)).toBe(sign * 300);
    expect(wheelValue(a, b, car, wheel, W.OMEGA, 1)).toBe(0);
  });

  it('uses the final pairwise slope limit when both endpoint speeds are excessive', () => {
    const { a, b } = pair(3, 300, 300);
    consistent(a, b);
    expect(wheelValue(a, b, car, wheel, W.OMEGA, 0.5)).toBeLessThan(20);
  });

  it.each([1, -1])('uses constant signed speed across a two-second recorded gap (%i)', (sign) => {
    const { a, b } = pair(sign * 400, 0, 0, 2),
      travel = recordedTravel(a, b);
    consistent(a, b);
    for (const alpha of [0.125, 0.5, 0.875]) {
      expect(wheelValue(a, b, car, wheel, W.OMEGA, alpha)).toBe(travel / 2);
      expect(wheelPhase(a, b, car, wheel, alpha)).toBe(0.25 + travel * alpha);
    }
  });

  it.each([0.5, 0.500001])('shares the cubic/long-gap branch at duration %s', (duration) => {
    const { a, b } = pair(3, 0, 0, duration),
      dt = b[H.TIME] - a[H.TIME];
    consistent(a, b);
    expect(wheelValue(a, b, car, wheel, W.OMEGA, 0.5)).toBe((dt > 0.5 ? 3 : 4.5) / dt);
  });

  it.each([NaN, Infinity, -Infinity])(
    'uses measured winding when an endpoint rate is %s',
    (rate) => {
      const { a, b } = pair(3, 20, rate, 0.1);
      consistent(a, b);
      expect(wheelValue(a, b, car, wheel, W.OMEGA, 0.5)).toBe(3 / b[H.TIME]);
    },
  );

  it.each([0, 1, 2, 3])(
    'keeps signed recorded wraps and the correct counter for wheel %i',
    (index) => {
      const sign = index % 2 === 0 ? 1 : -1,
        { a, b, p } = pair(sign * ((4 + index) * TAU + 0.7), 0, 0, 1 / 15, 'mx450', index),
        travel = recordedTravel(a, b, index);
      consistent(a, b, p);
      expect(wheelPhase(a, b, car, p, 0.5)).toBeCloseTo(0.25 + travel / 2, 10);
      expect(wheelPhase(a, b, car, p, 0.99999)).toBeCloseTo(0.25 + travel, 7);
      expect(wheelPhase(a, b, car, p, 1)).toBe(b[p + W.ROTATION]);
      expect(sign * wheelValue(a, b, car, p, W.OMEGA, 0.5)).toBeGreaterThan(500);
    },
  );

  it.each([1, -1])('retains inferred winding for legacy MX without a turn marker (%i)', (sign) => {
    const { a, b } = pair(sign * 3, sign * 300, 0);
    a[motion + M.VALID] = b[motion + M.VALID] = 0;
    consistent(a, b);
    // The existing unmarked fallback infers one extra turn from the endpoint
    // speeds. Only its published derivative changes; its trajectory is retained.
    const expected = 0.25 + sign * ((3 + TAU) / 2 + (300 * b[H.TIME]) / 8);
    expect(wheelPhase(a, b, car, wheel, 0.5)).toBeCloseTo(expected, 6);
  });

  it.each([true, false])('keeps a coherent low-speed reversal with winding=%s', (measured) => {
    const { a, b } = pair(0, 2, -2, 0.1);
    if (!measured) a[motion + M.VALID] = b[motion + M.VALID] = 0;
    consistent(a, b);
    expect(wheelPhase(a, b, car, wheel, 0.5)).toBeCloseTo(0.3, 7);
    expect(wheelValue(a, b, car, wheel, W.OMEGA, 0.25)).toBeCloseTo(1, 12);
    expect(wheelValue(a, b, car, wheel, W.OMEGA, 0.5)).toBe(0);
    expect(wheelValue(a, b, car, wheel, W.OMEGA, 0.75)).toBeCloseTo(-1, 12);
  });

  it('reports zero velocity when an unresolved continuous interval holds its wheel phase', () => {
    for (const reason of ['unmeasured gap', 'stationary winding', 'unusable unmeasured speed']) {
      const { a, b } = pair(reason === 'stationary winding' ? 0 : 3, 12, 18, 0.1);
      if (reason !== 'stationary winding') a[motion + M.VALID] = b[motion + M.VALID] = 0;
      if (reason === 'unmeasured gap') b[H.TIME] = 2;
      if (reason === 'unusable unmeasured speed') b[wheel + W.OMEGA] = NaN;
      consistent(a, b);
      expect(wheelPhase(a, b, car, wheel, 0.5)).toBe(a[wheel + W.ROTATION]);
      expect(wheelValue(a, b, car, wheel, W.OMEGA, 0.5)).toBe(0);
      expect(wheelValue(a, b, car, wheel, W.OMEGA, 0)).toBe(a[wheel + W.OMEGA]);
      expect(wheelValue(a, b, car, wheel, W.OMEGA, 1)).toBe(b[wheel + W.OMEGA]);
    }
  });

  it('retains measured endpoints and repeated snapshots independent of query order', () => {
    const { a, b } = pair(7 * TAU + 1, 300, 20),
      savedA = a.slice(),
      savedB = b.slice(),
      view = new PresentedFrame(),
      expected = view.sample(a, b, 0.37).slice();
    for (const alpha of [0.9, 0.1, 1, 0, 0.37]) view.sample(a, b, alpha);
    expect(view.value).toEqual(expected);
    expect(view.sample(a, b, 0)).toEqual(a);
    expect(view.sample(a, b, 1)).toEqual(b);
    for (const alpha of [0.125, 0.5, 0.875]) {
      expect(wheelPhase(a, a, car, wheel, alpha)).toBe(a[wheel + W.ROTATION]);
      expect(wheelValue(a, a, car, wheel, W.OMEGA, alpha)).toBe(a[wheel + W.OMEGA]);
      expect(view.sample(a, a, alpha)).toEqual(a);
    }
    expect(a).toEqual(savedA);
    expect(b).toEqual(savedB);
  });

  it.each([0, -0.1])('retains the older state at a distinct nonincreasing clock (%s)', (time) => {
    const { a, b } = pair(3, 300, 0);
    b[H.TIME] = time;
    expect(wheelPhase(a, b, car, wheel, 0.5)).toBe(a[wheel + W.ROTATION]);
    expect(wheelValue(a, b, car, wheel, W.OMEGA, 0.5)).toBe(a[wheel + W.OMEGA]);
    expect(wheelPhase(a, b, car, wheel, 1)).toBe(b[wheel + W.ROTATION]);
    expect(wheelValue(a, b, car, wheel, W.OMEGA, 1)).toBe(b[wheel + W.OMEGA]);
    if (time === 0) expect(new PresentedFrame().sample(a, b, 0.5)).toEqual(a);
    else expect(() => new PresentedFrame().sample(a, b, 0.5)).toThrow('Invalid presentation');
  });

  it.each(['teleport', 'MX vehicle change', 'road vehicle change', 'root convention'])(
    'retains the selected recorded rate at a %s boundary',
    (boundary) => {
      const { a, b } = pair(3, 300, 0);
      if (boundary === 'teleport') b[car + F.X] = 100;
      if (boundary === 'MX vehicle change') b[car + RACE_BASE + R.VEHICLE] = vehicleIndex('mx450');
      if (boundary === 'road vehicle change') b[car + RACE_BASE + R.VEHICLE] = vehicleIndex('gpr1');
      if (boundary === 'root convention') b[car + WHEEL_CONTACT_BASE] = ROAD_BIKE_CONTACT;
      for (const alpha of [0.125, 0.5, 0.875]) {
        expect(wheelPhase(a, b, car, wheel, alpha)).toBe(a[wheel + W.ROTATION]);
        expect(wheelValue(a, b, car, wheel, W.OMEGA, alpha)).toBe(a[wheel + W.OMEGA]);
        // A synthetic root marker on an MX bike is rejected by PresentedFrame;
        // the pure samplers still must agree on its existing reset selection.
        if (boundary !== 'root convention')
          expect(new PresentedFrame().sample(a, b, alpha)[wheel + W.OMEGA]).toBe(
            a[wheel + W.OMEGA],
          );
      }
      expect(wheelPhase(a, b, car, wheel, 1)).toBe(b[wheel + W.ROTATION]);
      expect(wheelValue(a, b, car, wheel, W.OMEGA, 1)).toBe(b[wheel + W.OMEGA]);
    },
  );

  it.each([
    [F.COMPOUND, 0, 1],
    [F.PIT_STOPS, 0, 1],
    [F.PIT_PHASE, 3, 4],
    [F.PIT_PHASE, 0, 5],
    [F.PIT_PHASE, 6, 4],
  ])('keeps measured wheel state at tire boundary %i: %i to %i', (field, from, to) => {
    const { a, b } = pair(-12 * TAU, 60, 0),
      view = new PresentedFrame();
    a[car + field] = from;
    b[car + field] = to;
    for (const alpha of [0.125, 0.5, 0.875]) {
      expect(wheelPhase(a, b, car, wheel, alpha)).toBe(a[wheel + W.ROTATION]);
      expect(wheelValue(a, b, car, wheel, W.OMEGA, alpha)).toBe(60);
      expect(view.sample(a, b, alpha)[wheel + W.OMEGA]).toBe(60);
    }
    expect(view.sample(a, b, 1)).toEqual(b);
  });

  it.each([0, 1, 2, 3])('uses MX vehicle identity independently of rider state %i', (state) => {
    const { a, b } = pair(3, 0, 0);
    a[car + BIKE_BASE + B.STATE] = b[car + BIKE_BASE + B.STATE] = state;
    consistent(a, b);
    expect(wheelValue(a, b, car, wheel, W.OMEGA, 0.5)).toBeGreaterThan(67);
  });

  it.each(['apx01', 'gpr1', 'sm450'])(
    'preserves the existing non-MX velocity contract for %s',
    (vehicle) => {
      const { a, b } = pair(3, 300, 0, 1 / 15, vehicle);
      for (const alpha of [0.125, 0.5, 0.875]) {
        const expected = 300 * (1 - alpha);
        expect(wheelValue(a, b, car, wheel, W.OMEGA, alpha)).toBe(expected);
        expect(new PresentedFrame().sample(a, b, alpha)[wheel + W.OMEGA]).toBe(
          Math.fround(expected),
        );
      }
      expect(phaseRate(a, b, wheel, 0.5)).toBeCloseTo(2.25 / b[H.TIME], 5);
    },
  );
});
