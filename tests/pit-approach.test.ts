import { expect, it } from 'vitest';
import { Track } from '../src/simulation/track.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { pitApproachTrafficSpeed, pitPreparationDistance } from '../src/simulation/pit-safety.ts';

it('budgets more approach distance for an outside-lane car at higher speed', () => {
  expect(pitPreparationDistance(60, -6)).toBeGreaterThan(pitPreparationDistance(30, -6));
  expect(pitPreparationDistance(60, -6)).toBeGreaterThan(pitPreparationDistance(60, 5));
});
it('yields behind adjacent entry-lane traffic instead of maintaining a blocked side-by-side approach', () => {
  const t = new Track(),
    c = new Vehicle(0),
    other = new Vehicle(1);
  c.s = t.length - 350;
  c.lateral = 1.38;
  c.speed = 14;
  other.s = c.s - 7.5;
  other.lateral = 5.74;
  other.speed = 14;
  expect(pitApproachTrafficSpeed(c, [c, other], t, 1.38)).toBe(10);
  other.s = c.s + 35;
  expect(pitApproachTrafficSpeed(c, [c, other], t, 1.38)).toBe(Infinity);
});
it('does not make the car already occupying the entry lane yield back in a circular wait', () => {
  const t = new Track(),
    c = new Vehicle(0),
    other = new Vehicle(1);
  c.s = 2000;
  c.lateral = 5.8;
  c.speed = 14;
  other.s = 2002;
  other.lateral = 1.4;
  other.speed = 14;
  expect(pitApproachTrafficSpeed(c, [c, other], t, 6)).toBe(Infinity);
  c.lateral = 1.38;
  other.lateral = 5.8;
  expect(pitApproachTrafficSpeed(c, [c, other], t, 6)).toBe(Infinity);
});
