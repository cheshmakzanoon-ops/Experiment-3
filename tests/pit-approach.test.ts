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

it.each([5, 2995])(
  'does not yield back to a braking follower in the shared approach corridor at station %s',
  (s) => {
    const t = new Track(),
      lead = new Vehicle(0),
      follower = new Vehicle(1);
    lead.s = s;
    lead.lateral = 2.9;
    lead.speed = 0;
    follower.s = (s - 5 + t.length) % t.length;
    follower.lateral = 5.8;
    follower.speed = 0;
    expect(pitApproachTrafficSpeed(lead, [lead, follower], t, 2.9)).toBe(Infinity);
    expect(pitApproachTrafficSpeed(lead, [follower, lead], t, 2.9)).toBe(Infinity);
    follower.s = (s + 5) % t.length;
    expect(pitApproachTrafficSpeed(lead, [lead, follower], t, 2.9)).toBe(0);
  },
);

// Reproduces the rain/drainage queue that previously self-declared a stationary hazard.
// Moving followers still retain the pre-existing entry-lane priority contract.
it('does not yield to a stationary follower in a separate pit-entry corridor', () => {
  const t = new Track(),
    lead = new Vehicle(0),
    follower = new Vehicle(1);
  lead.s = 2750;
  lead.lateral = 2.9;
  lead.speed = 0;
  follower.s = 2742;
  follower.lateral = 5.9;
  follower.speed = 0;
  expect(pitApproachTrafficSpeed(lead, [lead, follower], t, 2.9)).toBe(Infinity);
  follower.speed = 14;
  expect(pitApproachTrafficSpeed(lead, [lead, follower], t, 2.9)).toBe(10);
});
