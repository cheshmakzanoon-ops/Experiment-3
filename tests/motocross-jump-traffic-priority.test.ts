import { describe, expect, it } from 'vitest';
import { clamp, mod } from '../src/core/math.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { DirtBikeAIDriver, jumpHoldSpeed } from '../src/simulation/offroad/ai.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import type { JumpSurvey } from '../src/simulation/offroad/profile.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import { trackPoint, type Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

type Governor = {
  plan: { jump: JumpSurvey; clear: boolean; locked: boolean } | null;
  governJump(track: Track): void;
};

const cases = [MX_250, MX_450].flatMap(definition => [-1, 1].map(side => ({
  definition, id: definition.id, side,
})));

describe('motocross shoulder recovery respects traffic lane ownership', () => {
  it.each(cases)('$id side $side keeps blocked, passing and caution corridors', ({ definition, side }) => {
    const track = rigTrack('arena-nord-sx'),
      jump = offroadCourse(track.circuit)!.jumps.find(j => j.name === 'FINISH TRIPLE')!,
      bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', definition),
      ai = new DirtBikeAIDriver(bike), governor = ai as unknown as Governor;
    bike.place(track, jump.start - 24, side * 5.5);
    bike.dynamics.speed = 14;
    bike.aiTarget = jumpHoldSpeed(jump);
    for (const locked of [false, true]) {
      governor.plan = { jump, clear: true, locked };
      for (const decision of ['ABORT / FOLLOW', 'PASS / HOLD LANE', 'LOCAL CAUTION / NO OVERTAKING']) {
        ai.decision = decision;
        governor.governJump(track);
        // This parallel, upright approach needs no square-to-lip turn.
        // A traffic-owned corridor must not acquire the separate inward
        // recenter command simply because the bike is on the legal shoulder.
        expect(bike.input.steer).toBe(0);
        expect(governor.plan).toEqual({ jump, clear: true, locked });
        const pedals = [bike.input.throttle, bike.input.brake, bike.input.clutch];
        ai.decision = 'RACING LINE';
        governor.governJump(track);
        expect(side * bike.input.steer).toBeLessThan(-0.15);
        expect(Math.abs(bike.input.steer)).toBeLessThanOrEqual(0.5);
        expect([bike.input.throttle, bike.input.brake, bike.input.clutch]).toEqual(pedals);
      }
    }
  });

  it('honours the real twelve-rider planner when it cannot find a safe lane on the opening run-up', () => {
    const sim = new Simulation({ ...DEFAULT_OPTIONS, mode: 'race', weather: 'rain',
      circuit: 'arena-nord-sx', ruleset: 'motocross-moto', laps: 2, opponents: 11,
      vehicles: Array.from({ length: 12 }, (_, i) => i % 2 ? 'mx250' : 'mx450'), seed: 60729 });
    sim.autoPlayer = true;
    const bike = sim.cars[7] as DirtBikeVehicle, ai = sim.ai[7] as DirtBikeAIDriver,
      governor = ai as unknown as Governor, original = governor.governJump,
      descriptor = Object.getOwnPropertyDescriptor(ai, 'governJump'), point = trackPoint();
    let observed = false;
    governor.governJump = function (track) {
      const plan = this.plan, d = bike.dynamics, p = track.at(bike.s, point),
        run = plan ? mod(plan.jump.takeoff - bike.s, track.length) : Infinity,
        across = Math.sin(d.heading) * p.nx + Math.cos(d.heading) * p.nz,
        footprint = Math.max(
          Math.abs(bike.lateral + bike.bikeSpec.cgToFront * across) + bike.tires[0].construction.width * 0.5,
          Math.abs(bike.lateral - bike.bikeSpec.cgToRear * across) + bike.tires[2].construction.width * 0.5,
        ),
        blockedShoulder = plan?.clear && bike.riding && !bike.airborne && !bike.input.reverse &&
          run < 28 && footprint > p.width + 0.4 && ai.decision === 'ABORT / FOLLOW',
        error = mod(Math.atan2(p.tx, p.tz) - d.heading + Math.PI, Math.PI * 2) - Math.PI,
        lipSteer = clamp(error * 2.2 - d.lean * 0.9 - d.leanRate * 0.12, -0.5, 0.5);
      original.call(this, track);
      // A saturated lip command can coincide with the unsafe recenter by
      // accident. Observe the first unsaturated blocked-lane command, where
      // the two owners would actually request different steering.
      if (blockedShoulder && Math.abs(lipSteer) < 0.5) {
        observed = true;
        expect(bike.input.steer).toBe(lipSteer);
      }
    };
    try {
      for (let tick = 0; tick < 25 * 120 && !observed; tick++) sim.step(1 / 120);
      expect(observed).toBe(true);
      expect(bike.dynamics.crashes).toBe(0);
      expect(bike.riding).toBe(true);
    } finally {
      if (descriptor) Object.defineProperty(ai, 'governJump', descriptor);
      else Reflect.deleteProperty(ai, 'governJump');
    }
    expect(Object.getOwnPropertyDescriptor(ai, 'governJump')).toEqual(descriptor);
  });
});
