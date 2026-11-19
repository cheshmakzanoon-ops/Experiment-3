import { expect, it } from 'vitest';
import { BikeAIDriver } from '../src/simulation/bike-ai.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { racingLineFor } from '../src/simulation/racing-line.ts';
import { TrafficPlanner, personality, type PassPace } from '../src/simulation/traffic.ts';
import { vehicleDefinition } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';

type FollowingPace = PassPace & { followingRunway?: number };

/** The real Vellamar profile used in the passing-horizon regression. Both
 * horizons inspect this same road; only their reference speed differs. */
function nativePair() {
  const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      circuit: 'vellamar',
      ruleset: 'gp-motorcycle',
      opponents: 0,
      vehicles: ['gpr1'],
      seed: 3303,
    }),
    bike = sim.cars[0] as BikeVehicle,
    track = sim.track,
    line = racingLineFor(track),
    station = 165.06075214680368,
    speed = 68.88404586322334,
    freeSpeed = 91.08;
  bike.place(track, station, line.offsetAt(station));
  bike.speed = bike.dynamics.speed = speed;
  bike.body.velocity.set(bike.trackPosition.tx * speed, 0, bike.trackPosition.tz * speed);
  bike.dynamics.grip = bike.dynamics.frontGrip = bike.dynamics.rearGrip = 1;
  bike.dynamics.contactLoads = { front: 1250, rear: 1200 };
  bike.dynamics.frontLoad = 1250;
  bike.dynamics.rearLoad = 1200;
  const road = bike.trackPosition,
    slope = (line.offsetAt(station + 3) - line.offsetAt(station - 3)) / 6;
  bike.dynamics.heading =
    Math.atan2(road.tx, road.tz) +
    Math.atan(slope / Math.max(0.5, 1 - road.curvature * bike.lateral));
  bike.dynamics.motoGP!.lateralSpeed = 0;
  bike.aiOffset = line.offsetAt(station + Math.max(8, Math.min(46, 6 + speed * 0.48)));
  class Probe extends BikeAIDriver {
    inspect() {
      this.freeSpeed = freeSpeed;
      const target = this.limitSpeed(freeSpeed, track, sim.race, bike.aiOffset),
        next = this.planNext,
        pace = this.passPace(track);
      return { target, next, pace: pace && ({ ...pace } as FollowingPace) };
    }
  }
  const observed = new Probe(bike, 0.988, 3303).inspect(),
    other = new BikeVehicle(1, 'medium', DEFAULT_SETUP, 'sport', vehicleDefinition('sbk1000'));
  const placeLeader = (gap: number) => {
    other.place(track, station + gap, line.offsetAt(station + gap));
    other.speed = other.dynamics.speed = 65;
    other.body.velocity.set(other.trackPosition.tx * 65, 0, other.trackPosition.tz * 65);
  };
  placeLeader(64);
  const evaluate = (pace: FollowingPace) => {
    const planner = new TrafficPlanner(),
      result = planner.evaluate(
        bike,
        [bike, other],
        track,
        10,
        8,
        personality(4417, 0),
        false,
        line.offsetAt(station),
        false,
        (s) => line.offsetAt(s),
        1,
        0,
        pace,
      );
    return {
      result: { ...result },
      blocker: planner.blocker,
      passTarget: planner.passTarget,
      limitedBy: planner.limitedBy,
      needDecel: planner.needDecel,
    };
  };
  return { bike, observed, evaluate, placeLeader };
}

it('keeps current following and prospective passing crossings distinct on the same native profile', () => {
  const { bike, observed } = nativePair();
  expect(observed.target).toBe(91.08);
  expect(observed.next).toBeGreaterThan(bike.speed);
  expect(observed.pace).toMatchObject({ runway: 372, followingRunway: 528 });
  expect(observed.pace!.followingRunway).toBeLessThanOrEqual(720);
});

it('does not brake the current following pair for acceleration that has not happened', () => {
  const { bike, observed, evaluate } = nativePair(),
    pace = observed.pace!,
    current = evaluate(pace),
    nearCorner = evaluate({ ...pace, followingRunway: pace.runway });
  expect(current.limitedBy).toBe('settle');
  expect(current.result.speedLimit).toBeCloseTo(79.85498899355876, 10);
  expect(current.result.speedLimit).toBeGreaterThan(bike.speed);
  expect(nearCorner.limitedBy).toBe('follow');
  expect(nearCorner.result.speedLimit).toBeCloseTo(67.22939964010767, 10);
  expect(nearCorner.result.speedLimit).toBeLessThan(bike.speed);
  expect(current.result.offset).toBe(nearCorner.result.offset);
  expect(current.needDecel).toBe(nearCorner.needDecel);
  expect(current.blocker).toBe(-1);
  expect(nearCorner.blocker).toBe(-1);
  expect(current.passTarget).toBe(-1);
  expect(nearCorner.passTarget).toBe(-1);
});

it('uses the prospective horizon for passing admission independently of the following horizon', () => {
  const { observed, evaluate, placeLeader } = nativePair();
  // This closer pair can clear its gap within 720 m, but not the native
  // 372 m prospective horizon. A long current horizon must not approve it.
  placeLeader(40);
  const shortPass = evaluate({ ...observed.pace!, followingRunway: 720 }),
    longPass = evaluate({ ...observed.pace!, runway: 720, followingRunway: 0 });
  expect(shortPass.blocker).toBe(-1);
  expect(shortPass.passTarget).toBe(-1);
  expect(longPass.blocker).toBe(1);
  expect(longPass.passTarget).toBe(1);
});

it.each([372, 528])(
  'retains legacy PassPace behavior when followingRunway is omitted (%s m)',
  (runway) => {
    const { observed, evaluate } = nativePair(),
      legacy: PassPace = {
        topSpeed: observed.pace!.topSpeed,
        freeSpeed: observed.pace!.freeSpeed,
        laneRate: observed.pace!.laneRate,
        runway,
      };
    expect(evaluate(legacy)).toEqual(evaluate({ ...legacy, followingRunway: runway }));
  },
);

it('retains an explicitly exhausted following horizon instead of falling back to the passing distance', () => {
  const { observed, evaluate } = nativePair(),
    result = evaluate({ ...observed.pace!, runway: 528, followingRunway: 0 });
  expect(result.limitedBy).toBe('follow');
  expect(result.result.speedLimit).toBeCloseTo(67.22939964010767, 10);
});
