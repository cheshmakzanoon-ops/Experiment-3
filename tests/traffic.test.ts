import { it, expect } from 'vitest';
import { Track } from '../src/simulation/track.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { updatePit } from '../src/simulation/race.ts';
import { TrafficPlanner, personality } from '../src/simulation/traffic.ts';

it('defers a late request rather than cutting directly into pit lane', () => {
  const track = new Track(),
    car = new Vehicle(0);
  car.place(track, track.length - 32, 2.2);
  car.pitRequested = true;
  updatePit(car, track, 1 / 120);
  expect(car.inPit).toBe(false);
  car.pitLastS = track.length - 211;
  car.s = track.length - 209;
  car.lateral = 6;
  updatePit(car, track, 1 / 120);
  expect(car.inPit).toBe(true);
  expect(car.pitPhase).toBe(1);
});
it('does not enter pits from the far side of the racing surface', () => {
  const track = new Track(),
    car = new Vehicle(0);
  car.pitRequested = true;
  car.pitLastS = track.length - 211;
  car.s = track.length - 209;
  car.lateral = -5;
  updatePit(car, track, 1 / 120);
  expect(car.inPit).toBe(false);
});
it('returns from a completed pass to the racing line when no car conflicts', () => {
  const track = new Track(),
    car = new Vehicle(0),
    planner = new TrafficPlanner();
  car.place(track, 1000, 6);
  car.speed = 50;
  expect(planner.evaluate(car, [car], track, 10, 8, personality(4417, 0), false).offset).toBe(0);
});
it('plans ahead toward a legal pit approach instead of an instantaneous lateral jump', () => {
  const track = new Track(),
    car = new Vehicle(0),
    planner = new TrafficPlanner();
  car.place(track, 2000, 0);
  car.speed = 50;
  const plan = planner.evaluate(car, [car], track, 10, 8, personality(4417, 0), false, 6);
  expect(plan.offset).toBeGreaterThan(3);
  expect(plan.offset).toBeLessThanOrEqual(car.trackPosition.width - 2.4);
});
it('an occupied service-approach corridor never becomes an overtake away from entry', () => {
  const track = new Track(),
    car = new Vehicle(0),
    other = new Vehicle(1);
  car.place(track, 2500, 1.4);
  other.place(track, 2500, 5.6);
  car.speed = other.speed = 25;
  const planner = new TrafficPlanner();
  const plan = planner.evaluate(
    car,
    [car, other],
    track,
    10,
    4,
    personality(4417, 0),
    false,
    6,
    true,
  );
  expect(Math.abs(plan.offset - 6)).toBeLessThanOrEqual(Math.abs(car.lateral - 6) + 0.1);
});
it('predicts a rival alongside along the racing line, so a parallel lane stays clear', () => {
  // Both cars follow a line drifting across the track (1 m/s at 50 m/s). A
  // rival 4 m ahead and 3.4 m to the side keeps that spacing; extrapolating
  // only its current lateral position made the shared drift look like a
  // collision and pushed the car out of its lane.
  const track = new Track(),
    car = new Vehicle(0),
    other = new Vehicle(1),
    planner = new TrafficPlanner();
  car.place(track, 1000, 0);
  other.place(track, 1004, 3.4);
  const line = (s: number) => 0.02 * (s - 1000);
  for (const v of [car, other]) {
    const p = v.trackPosition;
    v.speed = 50;
    v.body.velocity.x = p.tx * 50 + p.nx;
    v.body.velocity.z = p.tz * 50 + p.nz;
  }
  const plan = planner.evaluate(
    car,
    [car, other],
    track,
    10,
    8,
    personality(4417, 0),
    false,
    0,
    false,
    line,
  );
  expect(plan.decision).toBe('RACING LINE');
  expect(plan.offset).toBeCloseTo(0, 6);
});
it('commits to one pass target, aborts when no longer closing, then waits before retrying', () => {
  const track = new Track(),
    car = new Vehicle(0),
    other = new Vehicle(1),
    planner = new TrafficPlanner(),
    traits = personality(4417, 0);
  car.place(track, 1000, 0);
  other.place(track, 1030, 0);
  car.speed = 60;
  other.speed = 50;
  const plan = (now: number) => planner.evaluate(car, [car, other], track, now, 8, traits, false);
  expect(Math.abs(plan(10).offset)).toBeGreaterThan(1);
  expect(planner.passTarget).toBe(1);
  expect(plan(10.1).decision).toBe('PASS / COMMITTED');
  other.speed = 66;
  let t = 10.2;
  while (planner.passTarget >= 0 && t < 12) plan((t += 0.1));
  expect(planner.aborts).toBe(1);
  expect(planner.lastAbort).toBe('NOT CLOSING');
  other.speed = 50;
  plan(t + 0.5);
  expect(planner.passTarget).toBe(-1);
});
it('records a completed pass once clear ahead of the target', () => {
  const track = new Track(),
    car = new Vehicle(0),
    other = new Vehicle(1),
    planner = new TrafficPlanner(),
    traits = personality(4417, 0);
  car.place(track, 1000, 0);
  other.place(track, 1030, 0);
  car.speed = 60;
  other.speed = 50;
  planner.evaluate(car, [car, other], track, 10, 8, traits, false);
  expect(planner.passTarget).toBe(1);
  car.place(track, 1040, 3.5);
  car.speed = 60;
  expect(planner.evaluate(car, [car, other], track, 10.1, 8, traits, false).decision).toBe(
    'PASS / COMPLETE',
  );
  expect(planner.passes).toBe(1);
});
// Pace-aware passing (traffic.ts PASS_PACE): a rider that is genuinely quicker than the car in
// its way is not held at the follow reserve for ever. Seeded mixed GP/superbike races had 0
// completed passes in 12 seeds before it.
const pacedPass = () => {
  const track = new Track(),
    car = new Vehicle(0),
    other = new Vehicle(1),
    traits = personality(4417, 0);
  car.place(track, 1000, 0);
  other.place(track, 1034, 0);
  // The car ahead is moving (a car whose body stands still is a stalled one to the planner).
  other.body.velocity.set(other.trackPosition.tx * 60, 0, other.trackPosition.tz * 60);
  // Closing on the car at 6 m/s: a pass is started on closing speed on a long straight, not
  // from a corner exit with the rider still slower than the car (qa-bikes-3).
  car.speed = 66;
  other.speed = 60;
  const plan = (
    planner: TrafficPlanner,
    now: number,
    runway: number,
    topSpeed = 120,
    freeSpeed = 90,
  ) =>
    planner.evaluate(car, [car, other], track, now, 8, traits, false, 0, false, undefined, 1, 0, {
      topSpeed,
      freeSpeed,
      runway,
      laneRate: 2,
    });
  return { track, car, other, traits, plan };
};
it('a rider that opts in to pace-aware passing pulls out around a slower car and may close on it', () => {
  const { track, car, other, traits, plan } = pacedPass();
  // Without the opt-in: held to the leader's speed, on the line.
  const held = new TrafficPlanner().evaluate(car, [car, other], track, 10, 8, traits, false);
  expect(held.speedLimit).toBeLessThanOrEqual(other.speed + 1);
  const planner = new TrafficPlanner(),
    pass = plan(planner, 10, 600);
  expect(planner.blocker).toBe(other.id);
  // The lane clears the car by the corridor the swept test demands, and the rider is
  // released from the leader's speed as fast as the remaining lateral move allows.
  expect(Math.abs(pass.offset - other.lateral)).toBeGreaterThanOrEqual(2.75);
  expect(pass.speedLimit).toBeGreaterThan(other.speed + 5);
});
it('a pace-aware pass is only started on a straight long enough to finish it, and ends with it', () => {
  const { other, plan } = pacedPass();
  const short = new TrafficPlanner();
  plan(short, 10, 120);
  expect(short.blocker).toBe(-1);
  const planner = new TrafficPlanner();
  plan(planner, 10, 600);
  expect(planner.blocker).toBe(other.id);
  plan(planner, 10.1, 250);
  expect(planner.blocker).toBe(other.id);
  plan(planner, 10.2, 150);
  expect(planner.blocker).toBe(-1);
});
it('does not treat a car it is no quicker than as one to get past', () => {
  const { other, plan } = pacedPass();
  // Slower now than its free speed, but the same class (top speed): the ordinary planner.
  const sameClass = new TrafficPlanner();
  const held = plan(sameClass, 10, 600, other.definition.ai.topSpeed + 5);
  expect(sameClass.blocker).toBe(-1);
  expect(held.speedLimit).toBeLessThanOrEqual(other.speed + 1);
  // A quicker class, but the car ahead is already at its pace: no pass to make, though
  // the quicker class still closes on it by the relative-motion rule.
  other.speed = 88;
  const planner = new TrafficPlanner();
  plan(planner, 10, 600);
  expect(planner.blocker).toBe(-1);
});
it('a pace-aware pass needs a car it is closing on and a long straight to start', () => {
  const { car, other, plan } = pacedPass();
  // 599 m of straight is not enough, 600 is.
  const short = new TrafficPlanner();
  plan(short, 10, 599);
  expect(short.blocker).toBe(-1);
  // Not closing (a rider coming out of a corner behind the car): no pass is set up, the
  // 484 attempts that were had 4 completed.
  car.speed = other.speed + 1;
  const level = new TrafficPlanner();
  plan(level, 10, 900);
  expect(level.blocker).toBe(-1);
  car.speed = other.speed + 6;
  const planner = new TrafficPlanner();
  plan(planner, 10, 600);
  expect(planner.blocker).toBe(other.id);
});
it('a quicker class closes on a car by the relative-motion rule on a straight, not into a corner', () => {
  const { car, other, plan } = pacedPass();
  car.speed = other.speed + 1;
  // Straight ahead: the rider may approach at the speed it can shed over the gap.
  const straight = plan(new TrafficPlanner(), 10, 500).speedLimit;
  expect(straight).toBeGreaterThan(other.speed + 3);
  // Braking point close: the follow reserve is back, and with it the distance a GP that
  // brakes as hard as the car in front of it needs (hairpin falls, qa-bikes-3).
  const corner = plan(new TrafficPlanner(), 10, 200).speedLimit;
  expect(corner).toBeLessThan(other.speed + 1);
  expect(corner).toBeLessThan(straight);
});
it('the distance a rider keeps opens over a few seconds after a pass ends, not at once', () => {
  const { other, plan } = pacedPass();
  const planner = new TrafficPlanner();
  plan(planner, 10, 600);
  expect(planner.blocker).toBe(other.id);
  plan(planner, 10.1, 150);
  expect(planner.lastAbort).toBe('STRAIGHT ENDED');
  const early = plan(planner, 10.2, 150).speedLimit,
    late = plan(planner, 14, 150).speedLimit;
  // Alongside a car a few metres ahead and 6 m/s quicker: the cap closes in as the
  // distance opens, so the lever is not asked for the whole difference in one step.
  expect(early).toBeGreaterThan(late);
});
it('a slower class is predicted on the road where the line leaves it, and the swept test sees it', () => {
  const { track, car, other, traits } = pacedPass();
  // The line sweeps from the left edge to the right over 100 m. The car ahead sits on the
  // lane limit (as its own planner holds it) and does not follow the line off the road.
  const line = (s: number) => Math.max(-4.4, Math.min(4.4, 4.4 - (s - 1000) * 0.088));
  car.place(track, 1000, 4);
  other.place(track, 1030, -4.3);
  car.speed = 70;
  other.speed = 60;
  const plan = new TrafficPlanner().evaluate(
    car,
    [car, other],
    track,
    10,
    8,
    traits,
    false,
    line(1000),
    false,
    line,
    1,
    0,
    { topSpeed: 120, freeSpeed: 90, runway: 300, laneRate: 2 },
  );
  // Following the line, the rider reaches the car's distance on the lane limit it holds
  // (the line leaves the road there), so the line lane is not its pick. Predicted off the
  // road with the line, the car was out of the way and the line lane was safe.
  expect(plan.decision).not.toBe('RACING LINE');
});
