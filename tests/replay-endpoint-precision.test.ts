import { describe, expect, it } from 'vitest';
import { ReplayClock } from '../src/session/replay-clock.ts';

const endpointCases = [
  Math.fround(16.6),
  Math.fround(16.7),
  Math.fround(0.1),
  12345.678901234567,
  1.2345678901234567e-200,
  1.2345678901234567e200,
  Number.MIN_VALUE,
];

describe('replay seek decimal endpoint round trips', () => {
  it('recovers the exact Float32-derived end reported by the native replay regression', () => {
    const clock = new ReplayClock();
    const duration = 16.600000381469727;
    const nativeValue = 16.6000003814697;
    expect(nativeValue).toBeLessThan(duration);
    clock.seek(nativeValue, 0, duration);
    expect(clock.position).toBe(duration);
    expect(clock.playing).toBe(true);
    expect(clock.seekPending).toBe(true);
  });

  it.each(endpointCases)(
    'recovers rounded upper bound %s without changing playback',
    (duration) => {
      const clock = new ReplayClock();
      clock.playing = false;
      clock.seek(Number(duration.toPrecision(15)), 0, duration);
      expect(clock.position).toBe(duration);
      expect(clock.playing).toBe(false);
      expect(clock.seekPending).toBe(true);
    },
  );

  it.each(endpointCases)('recovers rounded retained lower bound %s', (floor) => {
    const clock = new ReplayClock();
    clock.seek(Number(floor.toPrecision(15)), floor, floor * 2);
    expect(clock.position).toBe(floor);
    expect(clock.playing).toBe(true);
    expect(clock.seekPending).toBe(true);
  });

  it.each([0, Math.fround(4.3)])(
    'pauses the pending final frame and restarts from exact floor %s',
    (floor) => {
      const clock = new ReplayClock();
      const duration = Math.fround(16.6);
      clock.seek(Number(duration.toPrecision(15)), floor, duration);
      expect(clock.target(0.25, duration, true)).toBe(duration);
      expect(clock.toggle(floor, duration)).toBe(false);
      expect(clock.position).toBe(duration);
      expect(clock.seekPending).toBe(true);

      clock.presented(clock.target(0.25, duration, true), duration);
      expect(clock.position).toBe(duration);
      expect(clock.playing).toBe(false);
      expect(clock.seekPending).toBe(false);
      expect(clock.toggle(floor, duration)).toBe(true);
      expect(clock.position).toBe(floor);
      expect(clock.seekPending).toBe(true);
      expect(clock.target(0.25, duration, true)).toBe(floor);

      clock.presented(floor, duration);
      expect(clock.seekPending).toBe(false);
      expect(clock.target(0.25, duration, true)).toBe(floor + 0.25);
    },
  );

  it('stops at the exact final frame when its pending seek is presented while playing', () => {
    const clock = new ReplayClock();
    const duration = Math.fround(16.6);
    clock.seek(Number(duration.toPrecision(15)), 0, duration);
    clock.presented(clock.target(0.5, duration, true), duration);
    expect(clock.position).toBe(duration);
    expect(clock.playing).toBe(false);
    expect(clock.seekPending).toBe(false);
  });

  it.each(endpointCases.slice(0, -1))('preserves interior precision at scale %s', (duration) => {
    const clock = new ReplayClock();
    const floor = duration / 4;
    // Include a deliberately nearby position, a value with full binary64
    // precision, and meaningful distances from both ends at every scale.
    for (const value of [
      duration - duration * Number.EPSILON,
      floor + floor * Number.EPSILON,
      duration * 0.6371234567890123,
      floor + duration * 1e-6,
      duration - duration * 1e-6,
    ]) {
      expect(value).toBeGreaterThan(floor);
      expect(value).toBeLessThan(duration);
      expect(value).not.toBe(Number(floor.toPrecision(15)));
      expect(value).not.toBe(Number(duration.toPrecision(15)));
      clock.seek(value, floor, duration);
      expect(clock.position).toBe(value);
    }
  });

  it.each([
    { floor: 1 - Number.EPSILON, duration: 1 + Number.EPSILON * 2, expected: 1 - Number.EPSILON },
    { floor: 1 - Number.EPSILON * 2, duration: 1 + Number.EPSILON, expected: 1 + Number.EPSILON },
    { floor: 1 - Number.EPSILON, duration: 1 + Number.EPSILON, expected: 1 - Number.EPSILON },
  ])(
    'chooses the nearest boundary when both serialize to one ($floor, $duration)',
    ({ floor, duration, expected }) => {
      const clock = new ReplayClock();
      expect(Number(floor.toPrecision(15))).toBe(1);
      expect(Number(duration.toPrecision(15))).toBe(1);
      clock.seek(1, floor, duration);
      expect(clock.position).toBe(expected);
      // An exact endpoint must never be redirected to the opposite endpoint.
      clock.seek(floor, floor, duration);
      expect(clock.position).toBe(floor);
      clock.seek(duration, floor, duration);
      expect(clock.position).toBe(duration);
    },
  );

  it('retains ordinary clamping, exact singleton ranges and the maximum finite endpoint', () => {
    const clock = new ReplayClock();
    const floor = Math.fround(4.3);
    const duration = Math.fround(16.6);
    clock.seek(-1, floor, duration);
    expect(clock.position).toBe(floor);
    clock.seek(duration + 1, floor, duration);
    expect(clock.position).toBe(duration);
    clock.seek(Number(floor.toPrecision(15)), floor, floor);
    expect(clock.position).toBe(floor);
    clock.seek(0, 0, 0);
    expect(clock.position).toBe(0);
    clock.seek(Number.MAX_VALUE, 0, Number.MAX_VALUE);
    expect(clock.position).toBe(Number.MAX_VALUE);
    clock.seek(Number.MAX_VALUE / 2, 0, Number.MAX_VALUE);
    expect(clock.position).toBe(Number.MAX_VALUE / 2);
  });
});
