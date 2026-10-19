import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { PresentedFrame } from '../src/rendering/frame-state.ts';
import { sampleChassisPose } from '../src/rendering/snapshot-interpolation.ts';
import {
  B,
  BIKE_BASE,
  CAR_STRIDE,
  F,
  H,
  HEADER,
  K,
  O,
  OFFROAD_BASE,
  R,
  RACE_BASE,
  SKID_BASE,
  W,
  WHEEL_BASE,
  carBase,
} from '../src/simulation/protocol.ts';

const car = carBase(0),
  bike = car + BIKE_BASE,
  offroad = car + OFFROAD_BASE,
  wheel = car + WHEEL_BASE;
function frame(time: number, cars = 1) {
  const value = new Float32Array(HEADER + cars * CAR_STRIDE);
  value[H.CARS] = cars;
  value[H.TIME] = time;
  for (let id = 0; id < cars; id++) value[carBase(id) + F.QW] = 1;
  return value;
}
function accelerationPair() {
  const a = frame(0),
    b = frame(0.1),
    dt = b[H.TIME];
  a[car + F.VX] = 2;
  b[car + F.VX] = 2 + 8 * dt;
  b[car + F.X] = 2 * dt + 4 * dt * dt;
  return { a, b, dt };
}

describe('shared measured chassis motion', () => {
  it('reconstructs constant acceleration with the recorded endpoint velocities', () => {
    const { a, b, dt } = accelerationPair(),
      sample = new PresentedFrame();
    for (const alpha of [0, 0.1, 0.25, 0.5, 0.8, 1]) {
      const time = alpha * dt;
      expect(sample.sample(a, b, alpha)[car + F.X]).toBeCloseTo(2 * time + 4 * time * time, 6);
    }
  });

  it('preserves an airborne apex above both measured endpoints', () => {
    const a = frame(0),
      b = frame(0.2),
      dt = b[H.TIME];
    a[offroad + O.AIRBORNE] = b[offroad + O.AIRBORNE] = 1;
    a[car + F.Y] = b[car + F.Y] = 2;
    a[car + F.VY] = (9.81 * dt) / 2;
    b[car + F.VY] = -a[car + F.VY];
    const out = new PresentedFrame().sample(a, b, 0.5);
    expect(out[car + F.Y]).toBeCloseTo(2 + (9.81 * dt * dt) / 8, 6);
    expect(out[car + F.Y]).toBeGreaterThan(2);
  });

  it('retains the analytic near-endpoint slope without a Float32 finite-difference assumption', () => {
    const { a, b, dt } = accelerationPair(),
      sample = new PresentedFrame();
    const h = dt * 0.01;
    const x = sample.sample(a, b, 0.01)[car + F.X];
    // A forward difference of x=2t+4t² is 2+4h, not exactly the endpoint velocity.
    expect(x / h).toBeCloseTo(2 + 4 * h, 5);
  });

  it.each(['tyre contact', 'airborne transition', 'floor contact'])(
    'uses a bounded linear segment across %s',
    (change) => {
      const { a, b } = accelerationPair();
      if (change === 'tyre contact') b[wheel + W.LOAD] = 1000;
      if (change === 'airborne transition') b[offroad + O.AIRBORNE] = 1;
      if (change === 'floor contact') b[car + SKID_BASE + K.CONTACTS] = 1;
      expect(new PresentedFrame().sample(a, b, 0.5)[car + F.X]).toBeCloseTo(b[car + F.X] / 2, 7);
    },
  );

  it('rejects inconsistent and impulsive tangents instead of overshooting the chassis', () => {
    const a = frame(0),
      b = frame(0.1),
      sample = new PresentedFrame();
    b[car + F.X] = 1;
    a[car + F.VX] = 1000;
    b[car + F.VX] = -980;
    for (const alpha of [0.1, 0.25, 0.5, 0.75, 0.9])
      expect(sample.sample(a, b, alpha)[car + F.X]).toBeCloseTo(alpha, 6);
    // Also cover positions without usable endpoint velocities, as in imported ghosts.
    a[car + F.VX] = b[car + F.VX] = 0;
    expect(sample.sample(a, b, 0.4)[car + F.X]).toBeCloseTo(0.4, 6);
  });

  it('allows plausible long recording gaps but falls back to a linear segment', () => {
    const a = frame(0),
      b = frame(2);
    a[car + F.VX] = b[car + F.VX] = 2;
    b[car + F.X] = 4;
    expect(new PresentedFrame().sample(a, b, 0.25)[car + F.X]).toBe(1);
  });

  it.each(['teleport', 'vehicle identity', 'same-time reset'])(
    'holds every per-entrant channel at a %s boundary',
    (change) => {
      const a = frame(0),
        b = frame(0.1),
        sample = new PresentedFrame();
      b[car + F.X] = change === 'teleport' ? 100 : 2;
      b[bike + B.LEAN] = 0.8;
      b[wheel + W.LENGTH] = 0.4;
      if (change === 'vehicle identity') b[car + RACE_BASE + R.VEHICLE] = 3;
      if (change === 'same-time reset') b[H.TIME] = 0;
      expect(sample.sample(a, b, 0.99).subarray(car)).toEqual(a.subarray(car));
      expect(sample.sample(a, b, 1)).toEqual(b);
    },
  );

  it('gives model roots exactly the same Float32 position and orientation as camera/effects', () => {
    const { a, b } = accelerationPair(),
      sample = new PresentedFrame();
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7).toArray(b, car + F.QX);
    const position = new Vector3(),
      orientation = new Quaternion();
    for (const alpha of [0, 0.23, 0.5, 0.97, 1]) {
      const out = sample.sample(a, b, alpha);
      sampleChassisPose(a, b, car, alpha, position, orientation);
      expect(position.toArray()).toEqual(Array.from(out.subarray(car + F.X, car + F.X + 3)));
      expect(orientation.toArray()).toEqual(Array.from(out.subarray(car + F.QX, car + F.QX + 4)));
    }
  });

  it('takes the short quaternion arc even when equivalent endpoints have opposite signs', () => {
    const a = frame(0),
      b = frame(0.1);
    b[car + F.QW] = -1;
    const out = new PresentedFrame().sample(a, b, 0.5);
    expect(out[car + F.QW]).toBe(1);
    expect(out[car + F.QX]).toBe(0);
  });
});

describe('motorcycle and off-road presentation channels', () => {
  it('smooths suspension, rider controls and MX weight without fractional discrete states', () => {
    const a = frame(0),
      b = frame(0.1),
      sample = new PresentedFrame();
    for (const field of [
      B.LEAN,
      B.LEAN_RATE,
      B.STEER,
      B.RIDER_OFFSET,
      B.FORK,
      B.SHOCK,
      B.TUCK,
      B.REAR_BRAKE,
    ]) {
      a[bike + field] = 0.2;
      b[bike + field] = 0.6;
    }
    for (const field of [O.STANDING, O.DAB, O.BODY, O.MUD, O.MOISTURE]) b[offroad + field] = 1;
    b[offroad + O.AIRBORNE] = 1;
    b[offroad + O.AIR_TIME] = 0.1;
    b[offroad + O.JOKERS] = 1;
    b[offroad + O.LANDING_SPEED] = 7;
    const out = sample.sample(a, b, 0.25);
    expect(out[bike + B.LEAN]).toBeCloseTo(0.3, 6);
    expect(out[bike + B.FORK]).toBeCloseTo(0.3, 6);
    expect(out[bike + B.REAR_BRAKE]).toBeCloseTo(0.3, 6);
    expect(out[offroad + O.BODY]).toBe(0.25);
    expect(out[offroad + O.AIRBORNE]).toBe(0);
    expect(out[offroad + O.AIR_TIME]).toBe(0);
    expect(out[offroad + O.JOKERS]).toBe(0);
    expect(out[offroad + O.LANDING_SPEED]).toBe(0);
    expect(sample.sample(a, b, 1)).toEqual(b);
  });

  it('wraps rider heading while preserving accumulated full-turn tumble', () => {
    const a = frame(0),
      b = frame(0.1);
    a[bike + B.RIDER_HEADING] = Math.PI - 0.1;
    b[bike + B.RIDER_HEADING] = -Math.PI + 0.1;
    b[bike + B.RIDER_TUMBLE] = 4 * Math.PI;
    const out = new PresentedFrame().sample(a, b, 0.5);
    expect(out[bike + B.RIDER_HEADING]).toBeCloseTo(Math.PI, 6);
    expect(out[bike + B.RIDER_TUMBLE]).toBeCloseTo(2 * Math.PI, 6);
  });

  it.each(['crash', 'remount', 'clock reset'])(
    'keeps the old rider origin and clock until the %s sample',
    (change) => {
      const a = frame(0),
        b = frame(0.1),
        sample = new PresentedFrame();
      a[bike + B.RIDER_X] = 7;
      a[bike + B.STATE_CLOCK] = 2;
      b[bike + B.RIDER_X] = 60;
      b[bike + B.STATE_CLOCK] = 0;
      if (change === 'crash') b[bike + B.STATE] = 1;
      if (change === 'remount') {
        a[bike + B.STATE] = 3;
        b[bike + B.STATE] = 4;
      }
      const out = sample.sample(a, b, 0.75);
      expect(out[bike + B.STATE]).toBe(a[bike + B.STATE]);
      expect(out[bike + B.RIDER_X]).toBe(7);
      expect(out[bike + B.STATE_CLOCK]).toBe(2);
      expect(sample.sample(a, b, 1)).toEqual(b);
    },
  );

  it('keeps fresh tyre properties at their replacement time while suspension still travels', () => {
    const a = frame(0),
      b = frame(0.1),
      sample = new PresentedFrame();
    a[wheel + W.WEAR] = 0.8;
    b[wheel + W.WEAR] = 0;
    a[wheel + W.SURFACE_TEMP] = 100;
    b[wheel + W.SURFACE_TEMP] = 40;
    a[wheel + W.LENGTH] = 0.2;
    b[wheel + W.LENGTH] = 0.3;
    b[car + F.PIT_STOPS] = 1;
    const out = sample.sample(a, b, 0.5);
    expect(out[wheel + W.WEAR]).toBe(a[wheel + W.WEAR]);
    expect(out[wheel + W.SURFACE_TEMP]).toBe(100);
    expect(out[wheel + W.LENGTH]).toBeCloseTo(0.25, 6);
  });

  it('reuses a full 32-entrant buffer and is deterministic under pause and reordered replay queries', () => {
    const a = frame(0, 32),
      b = frame(0.1, 32),
      sample = new PresentedFrame();
    for (let id = 0; id < 32; id++) {
      a[carBase(id) + F.VX] = b[carBase(id) + F.VX] = 10;
      b[carBase(id) + F.X] = 1;
      b[carBase(id) + BIKE_BASE + B.LEAN] = 0.8;
    }
    const originalA = a.slice(),
      originalB = b.slice();
    const buffer = sample.sample(a, b, 0.5),
      expected = buffer.slice();
    for (const alpha of [1, 0.25, 0.8, 0, 0.5]) expect(sample.sample(a, b, alpha)).toBe(buffer);
    expect(buffer).toEqual(expected);
    expect(sample.sample(b, b, 0.7)).toEqual(b);
    expect(a).toEqual(originalA);
    expect(b).toEqual(originalB);
  });
});
