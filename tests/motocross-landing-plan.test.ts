import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { FLAG } from '../src/simulation/marshal.ts';
import { DirtBikeAIDriver } from '../src/simulation/offroad/ai.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import type { JumpSurvey } from '../src/simulation/offroad/profile.ts';
import { LANDING_RULES } from '../src/simulation/offroad/riding-feedback.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import type { RaceDirector } from '../src/simulation/race.ts';
import type { Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

type Planner = {
  plan: { jump: JumpSurvey; clear: boolean; locked: boolean } | null;
  limitSpeed(desired: number, track: Track, race: RaceDirector): number;
};

function fixture(vehicle: 'mx250' | 'mx450' = 'mx450') {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS, mode: 'practice', weather: 'clear', circuit: 'arena-nord-sx',
    opponents: 0, vehicles: [vehicle], seed: 41003,
  }),
    bike = sim.cars[0] as DirtBikeVehicle,
    ai = sim.ai[0] as DirtBikeAIDriver,
    planner = ai as unknown as Planner,
    jump = offroadCourse(sim.track.circuit)!.jumps.find((j) => j.name === 'FINISH TRIPLE')!,
    touchdown = 10;
  bike.place(sim.track, jump.landing - jump.landingLength * 0.5 + 0.1);
  bike.dynamics.speed = 12;
  bike.clock = touchdown + 1 / 240;
  bike.lastLanding = {
    time: touchdown, s: bike.s, distance: 17, takeoffSpeed: 14,
    airTime: 1.4, pitchError: -0.2, slope: 0.28, normalSpeed: 9.5,
    yawError: 0, lateralSpeed: 0, bottomSpeed: 0, outcome: 'clean',
  };
  planner.plan = { jump, clear: true, locked: true };
  const target = (desired = 18) => planner.limitSpeed(desired, sim.track, sim.race);
  return { sim, bike, planner, jump, touchdown, target };
}

describe('committed motocross landing-plan lifetime', () => {
  it.each(['mx250', 'mx450'] as const)(
    '%s retains the original settle window across a short contact rebound', (vehicle) => {
      const { bike, planner, touchdown, target } = fixture(vehicle);
      expect(target()).toBe(18);
      // The live record legitimately describes the latest contact. A tiny
      // rebound must not turn a completed clear into a beached-gap command.
      bike.lastLanding = { ...bike.lastLanding!, time: touchdown + 0.08,
        airTime: 0.006, distance: 0.06, normalSpeed: -1.1 };
      for (const age of [0.09, 0.15, 0.24, LANDING_RULES.settleSeconds]) {
        bike.clock = touchdown + age;
        expect(target()).toBe(18);
        expect(planner.plan?.clear).toBe(true);
      }
      bike.clock = touchdown + LANDING_RULES.settleSeconds + 1e-6;
      expect(target()).toBe(4);
      expect(planner.plan).toBeNull();
    },
  );

  it('does not renew the first touchdown deadline with a second qualifying hop', () => {
    const { bike, touchdown, target } = fixture();
    expect(target()).toBe(18);
    bike.lastLanding = { ...bike.lastLanding!, time: touchdown + 0.2,
      airTime: LANDING_RULES.minimumAirTime + 0.01 };
    bike.clock = touchdown + 0.24;
    expect(target()).toBe(18);
    bike.clock = touchdown + LANDING_RULES.settleSeconds + 1e-6;
    expect(target()).toBe(4);
  });

  it.each([0, 0.5, 3])('preserves an upstream stop or traffic cap of %s m/s', (desired) => {
    const { sim, bike, planner, touchdown, target } = fixture();
    expect(target()).toBe(18);
    bike.lastLanding = { ...bike.lastLanding!, time: touchdown + 0.06, airTime: 0.01 };
    bike.clock = touchdown + 0.1;
    sim.race.control.flags[bike.id] = FLAG.DOUBLE_YELLOW;
    expect(target(desired)).toBe(desired);
    expect(planner.plan?.clear).toBe(true);
    // Removing the upstream cap does not destroy the remaining settle time.
    sim.race.control.flags[bike.id] = FLAG.GREEN;
    expect(target()).toBe(18);
  });

  it('does not arm from a small hop, stale record, future record or another jump', () => {
    for (const kind of ['small', 'stale', 'future', 'elsewhere'] as const) {
      const { sim, bike, jump, target } = fixture();
      const landing = bike.lastLanding!;
      if (kind === 'small') landing.airTime = LANDING_RULES.minimumAirTime;
      if (kind === 'stale') landing.time = bike.clock - LANDING_RULES.settleSeconds - 0.01;
      if (kind === 'future') landing.time = bike.clock + 0.01;
      if (kind === 'elsewhere') {
        const other = offroadCourse(sim.track.circuit)!.jumps.find((j) => j !== jump)!;
        landing.s = other.landing;
      }
      expect(target()).toBe(4);
    }
  });

  it('does not transfer a clear landing allowance into a replacement rolling plan', () => {
    const { bike, planner, jump, touchdown, target } = fixture();
    expect(target()).toBe(18);
    bike.clock = touchdown + 0.1;
    planner.plan = { jump, clear: false, locked: true };
    expect(target()).toBe(4);
    expect(planner.plan).toBeNull();
  });

  it('expires safely if the vehicle clock is reset during the stored allowance', () => {
    const { bike, planner, target } = fixture();
    expect(target()).toBe(18);
    bike.clock = 0;
    expect(target()).toBe(4);
    expect(planner.plan).toBeNull();
  });
});
