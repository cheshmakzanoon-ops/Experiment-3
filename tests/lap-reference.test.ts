import { expect, it } from 'vitest';
import { LapReference } from '../src/simulation/lap-reference.ts';
import { LapTracker } from '../src/simulation/race.ts';

it('uses actual nonuniform crossing times rather than average lap speed', () => {
  const reference = new LapReference(256);
  reference.start(10);
  reference.observe(0, 128, 10, 30);
  reference.observe(128, 256, 30, 90);
  reference.finish(80, true);
  expect(reference.bestTime).toBe(80);
  expect(reference.delta(128, 21)).toBe(1);
  expect(reference.delta(192, 49)).toBe(-1);
  expect(reference.delta(256, 81)).toBe(1);
});
it('rejects incomplete, invalid and discontinuous reference laps', () => {
  const reference = new LapReference(256);
  reference.start(0);
  reference.observe(0, 100, 0, 20);
  reference.observe(110, 256, 21, 60);
  reference.finish(60, true);
  expect(reference.bestTime).toBe(0);
  reference.start(0);
  reference.observe(0, 256, 0, 60);
  reference.finish(60, false);
  expect(reference.bestTime).toBe(0);
  expect(reference.delta(40, 2)).toBe(0);
});
it('tracks ordered lap gates, a stopped interval and a new best without reference corruption', () => {
  const lap = new LapTracker(256, 250);
  lap.update(2, 1, false);
  let time = 1;
  for (let s = 4; s <= 254; s += 2) {
    time += 0.5;
    lap.update(s, time, false);
  }
  lap.update(2, time + 1, false);
  expect(lap.completed).toBe(1);
  expect(lap.reference.bestTime).toBeCloseTo(lap.best);
  const previous = Array.from(lap.reference.best);
  expect(lap.reference.delta(2, lap.lapTime)).toBeCloseTo(0.25, 6);
  time += 1;
  for (let s = 4; s <= 254; s += 2) {
    if (s === 64) {
      time += 4;
      lap.update(62, time, false);
    }
    time += 0.5;
    lap.update(s, time, false);
  }
  lap.update(2, time + 1, false);
  expect(lap.completed).toBe(2);
  expect(lap.reference.bestTime).toBe(lap.best);
  expect(Array.from(lap.reference.best)).toEqual(previous);
  expect(lap.last).toBeGreaterThan(lap.best);
});
it('disallows malformed interval times and nonfinite reference parameters', () => {
  expect(() => new LapReference(NaN)).toThrow();
  const r = new LapReference(256);
  expect(() => r.start(NaN)).toThrow();
  expect(() => r.start(-1)).toThrow();
  expect(() => r.delta(NaN, 10)).toThrow();
  expect(() => r.observe(0, 10, 2, 1)).toThrow();
  expect(() => r.observe(-1, 10, 1, 2)).toThrow();
});

it('preserves the faster recorded reference even if a caller accepts a slower lap', () => {
  const r = new LapReference(256);
  r.start(0);
  r.observe(0, 256, 0, 60);
  r.finish(60, true);
  r.start(70);
  r.observe(0, 256, 70, 150);
  r.finish(80, true);
  expect(r.bestTime).toBe(60);
  expect(r.delta(128, 30)).toBe(0);
});
