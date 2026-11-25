import { describe, expect, it } from 'vitest';
import { G, mod } from '../src/core/math.ts';
import { DEFAULT_OPTIONS, type Assist, type Controls } from '../src/simulation/config.ts';
import type { DirtBikeAIDriver } from '../src/simulation/offroad/ai.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import type { RaceDirector } from '../src/simulation/race.ts';
import { trackPoint, type Track } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

interface GuardPort {
  headingGuard(track: Track, race: RaceDirector): void;
}

interface LoadProbe {
  time: number;
  load: number;
  before: Controls;
  low: Controls;
  high: Controls;
}

/** The unchanged twelve-rider start which formerly put rider 7 across the
 * adjacent, opposite-facing rhythm lane. No route, speed or posture is
 * assigned: ordinary AI, terrain, contacts and the gate drive this run.
 * The guard probes change only its observed load for two isolated calls,
 * then restore the original result before physics advances. */
function gridStart(assist: Assist) {
  const sim = new Simulation({
    ...DEFAULT_OPTIONS,
    assist,
    mode: 'race',
    weather: 'clear',
    circuit: 'arena-nord-sx',
    ruleset: 'motocross-moto',
    laps: 2,
    opponents: 11,
    seed: 60724,
    vehicles: Array.from({ length: 12 }, (_, i) => (i % 2 ? 'mx250' : 'mx450')),
  });
  sim.autoPlayer = true;
  const rider = sim.cars[7] as DirtBikeVehicle;
  const driver = sim.ai[7] as DirtBikeAIDriver;
  const port = driver as unknown as GuardPort;
  const guard = port.headingGuard.bind(driver);
  let boundary: LoadProbe | undefined, benign: LoadProbe | undefined;
  port.headingGuard = (track, race) => {
    const before = { ...rider.input },
      beforeTarget = rider.aiTarget,
      load = rider.forceFront;
    guard(track, race);
    const after = { ...rider.input },
      afterTarget = rider.aiTarget;
    const p = track.at(rider.s, trackPoint());
    const error =
      mod(Math.atan2(p.tx, p.tz) - rider.dynamics.heading + Math.PI, 2 * Math.PI) - Math.PI;
    const across = rider.body.velocity.x * p.nx + rider.body.velocity.z * p.nz;
    const changed =
      Math.max(Math.abs(after.throttle - before.throttle), Math.abs(after.brake - before.brake)) >
      0.03;
    // Keep these isolated calls outside the separate heading-recovery branch,
    // so they cannot change a committed jump plan as a side effect.
    const canProbe = rider.clock > 8 && Math.abs(error) < 0.49;
    const atBoundary = canProbe && !boundary && load > rider.dynamics.mass * G * 0.38 && changed;
    const inward = canProbe && !benign && rider.clock < 8.1 && rider.lateral * across < 0;
    if (atBoundary || inward) {
      const sample = (fraction: number) => {
        Object.assign(rider.input, before);
        rider.aiTarget = beforeTarget;
        rider.forceFront = rider.dynamics.mass * G * fraction;
        guard(track, race);
        return { ...rider.input };
      };
      const probe = {
        time: rider.clock,
        load,
        before,
        low: sample(0.38 - 1e-6),
        high: sample(0.38 + 1e-6),
      };
      if (atBoundary) boundary = probe;
      if (inward) benign = probe;
      rider.forceFront = load;
      rider.aiTarget = afterTarget;
      Object.assign(rider.input, after);
    }
  };
  let previous = rider.s,
    largestStationStep = 0;
  for (let tick = 0; tick < 18 * 120; tick++) {
    sim.step(1 / 120);
    const distance =
      mod(rider.s - previous + sim.track.length / 2, sim.track.length) - sim.track.length / 2;
    largestStationStep = Math.max(largestStationStep, Math.abs(distance));
    previous = rider.s;
  }
  return { sim, rider, largestStationStep, boundary, benign };
}

describe('motocross shoulder recovery through a finite body stroke', () => {
  it.each(['sport', 'raw'] as const)(
    'keeps the real %s-session AI start on its lane without a front-load cutoff',
    (assist) => {
      const { sim, rider, largestStationStep, boundary, benign } = gridStart(assist);
      // The old load gate allowed a ~150 m nearest-lane jump, a backwards
      // double and a genuine nose-first crash at 12.604 s. No verdict is
      // suppressed: the corrected driver avoids that physical approach.
      expect(largestStationStep).toBeLessThan(1);
      expect(rider.s).toBeGreaterThan(100);
      expect(sim.cars.map((car) => (car as DirtBikeVehicle).dynamics.crashes)).toEqual(
        Array(12).fill(0),
      );
      expect(rider.dynamics.p.independentRearBrake).toBe(false);

      // A 0.0002%-of-weight measurement change cannot remove recovery
      // while position, momentum and the requested controls are identical.
      expect(boundary).toBeDefined();
      for (const field of ['throttle', 'brake', 'steer'] as const)
        expect(Math.abs(boundary!.high[field] - boundary!.low[field])).toBeLessThan(1e-4);
      expect(boundary!.high.brake).toBeGreaterThan(boundary!.before.brake);
      expect(boundary!.high.throttle).toBeLessThan(boundary!.before.throttle);

      // A loaded bike travelling inward on the ordinary start straight
      // keeps exactly the commands it had before this geometric guard.
      expect(benign).toBeDefined();
      expect(benign!.low).toEqual(benign!.before);
      expect(benign!.high).toEqual(benign!.before);
    },
    30000,
  );
});
