import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { DirtBikeAIDriver, jumpHoldSpeed, motocrossJumpCorridor } from '../src/simulation/offroad/ai.ts';
import { MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import type { JumpSurvey } from '../src/simulation/offroad/profile.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { trackPoint, type Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

function fixture(run = 16, lateral = 0, heading = 0, speed = 14) {
  const track = rigTrack('arena-nord-sx'),
    jump = offroadCourse(track.circuit)!.jumps.find(j => j.name === 'FINISH TRIPLE')!,
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', MX_450);
  bike.place(track, jump.start - run, lateral);
  bike.dynamics.heading += heading;
  bike.dynamics.speed = speed;
  return { track, jump, bike };
}

describe('motocross surveyed jump steering corridor', () => {
  // This geometric test controls the steering handoff. It does not veto a
  // clear that can use the actual, lower profile on a tapered shoulder.
  it.each([-1, 1])('identifies the legal tape shoulder for lane recovery on side %s', side => {
    const { track, jump, bike } = fixture(16, side * 4.7);
    const p = track.at(jump.start, trackPoint());
    expect(Math.abs(bike.lateral)).toBeLessThan(offroadCourse(track.circuit)!.legalWidth(p.width, jump.start, bike.lateral));
    expect(motocrossJumpCorridor(bike, track, jump)).toBe(false);
    bike.place(track, jump.start - 16, side * 2);
    bike.dynamics.speed = 14;
    expect(motocrossJumpCorridor(bike, track, jump)).toBe(true);
  });

  it.each([-1, 1])('reserves both axle footprints and tread clearance on side %s', side => {
    const { track, jump, bike } = fixture(0),
      width = track.at(jump.start, trackPoint()).width + 0.4,
      halfTread = Math.max(bike.tires[0].construction.width, bike.tires[2].construction.width) * 0.5;
    bike.place(track, jump.start, side * (width - halfTread - 0.01));
    bike.dynamics.speed = 14;
    expect(motocrossJumpCorridor(bike, track, jump)).toBe(true);
    // A front wheel pointing out, or the rear wheel trailing an inward
    // heading, crosses the profile edge even while the contact-line centre fits.
    for (const heading of [-0.1, 0.1]) {
      bike.place(track, jump.start, side * (width - halfTread - 0.01));
      bike.dynamics.speed = 14;
      bike.dynamics.heading += side * heading;
      expect(motocrossJumpCorridor(bike, track, jump)).toBe(false);
    }
  });

  it.each([-1, 1])('rejects an across-face heading or unarrested slide on side %s', side => {
    const { track, jump, bike } = fixture(12, 0, side * 0.6);
    expect(motocrossJumpCorridor(bike, track, jump)).toBe(false);
    bike.place(track, jump.start - 12);
    bike.dynamics.speed = 14;
    bike.slide = side * 3;
    expect(motocrossJumpCorridor(bike, track, jump)).toBe(false);
  });

  it.each([-1, 1])('keeps bounded inward lane steering on a parallel shoulder approach from side %s', side => {
    const { track, jump, bike } = fixture(24, side * 5.5, 0, 14),
      ai = new DirtBikeAIDriver(bike);
    // Exercise the actual final governor with a provisional speed-feasible
    // clear: the old tangent-only override produced zero here on both sides.
    const governor = ai as unknown as {
      plan: { jump: JumpSurvey; clear: boolean; locked: boolean };
      governJump(track: Track): void;
    };
    governor.plan = { jump, clear: true, locked: false };
    bike.aiTarget = jumpHoldSpeed(jump);
    governor.governJump(track);
    expect(side * bike.input.steer).toBeLessThan(-0.15);
    expect(Math.abs(bike.input.steer)).toBeLessThanOrEqual(0.5);
  });

  it.each([-1, 1])('preserves a parallel inner-lane clear without demanding a recenter on side %s', side => {
    const { track, jump, bike } = fixture(24, side * 2, 0, 14),
      ai = new DirtBikeAIDriver(bike),
      governor = ai as unknown as {
        plan: { jump: JumpSurvey; clear: boolean; locked: boolean };
        governJump(track: Track): void;
      };
    governor.plan = { jump, clear: true, locked: true };
    bike.aiTarget = jumpHoldSpeed(jump);
    governor.governJump(track);
    expect(bike.input.steer).toBe(0);
    expect(governor.plan.clear).toBe(true);
  });

  it.each([
    { side: -1, ridden: false }, { side: 1, ridden: false },
    { side: -1, ridden: true }, { side: 1, ridden: true },
  ])('recovers the shoulder and clears the landing on side $side (ridden plant: $ridden)', ({ side, ridden }) => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'practice', weather: 'clear',
      circuit: 'arena-nord-sx', opponents: 0, vehicles: ['mx450'], seed: 41003 }),
      bike = sim.cars[0] as DirtBikeVehicle,
      jump = offroadCourse(sim.track.circuit)!.jumps.find(j => j.name === 'FINISH TRIPLE')!;
    for (let tick = 0; tick < 720; tick++) sim.step(1 / 120);
    bike.place(sim.track, jump.start - 24, side * 5.5);
    bike.dynamics.speed = jumpHoldSpeed(jump);
    bike.gear = 2;
    sim.autoPlayer = true;
    const ai = sim.ai[0] as DirtBikeAIDriver;
    if (ridden) {
      bike.aiControlled = () => {};
      const groundInputs = ai.update.bind(ai);
      ai.update = (...args) => {
        groundInputs(...args);
        if (bike.airborne) {
          bike.input.steer = 0;
          bike.input.brake = 0;
        }
      };
    }
    let departureLateral: number | null = null,
      landingLateral: number | null = null,
      landing: DirtBikeVehicle['lastLanding'] = null;
    for (let tick = 0; tick < 8 * 120 && bike.s < jump.end + 4; tick++) {
      sim.step(1 / 120);
      if (departureLateral === null && bike.airborne && bike.s > jump.start)
        departureLateral = bike.lateral;
      if (!landing && departureLateral !== null && !bike.airborne &&
          bike.lastLanding && bike.lastLanding.s > jump.takeoff) {
        landing = { ...bike.lastLanding };
        landingLateral = bike.lateral;
      }
    }
    expect(departureLateral).not.toBeNull();
    expect(side * departureLateral!).toBeLessThan(5.5);
    expect(landing).not.toBeNull();
    expect(landing!.s).toBeGreaterThan(jump.landing - jump.landingLength * 0.5);
    expect(landing!.s).toBeLessThan(jump.landing + jump.landingLength * 0.5);
    expect(landing!.airTime).toBeGreaterThan(1);
    expect(Math.abs(landingLateral!)).toBeLessThan(sim.track.at(jump.landing, trackPoint()).width);
    // Run through the whole landing so a clean initial patch followed by a
    // rear bottom-out and a nose-first rebound cannot pass this regression.
    expect(bike.s).toBeGreaterThan(jump.end);
    expect(ai.decisions.aborts).toBe(0);
    expect(bike.crashCauses).toEqual([]);
    expect(bike.dynamics.crashes).toBe(0);
  });
});
