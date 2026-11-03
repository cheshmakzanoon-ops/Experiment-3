import { mod } from '../src/core/math.ts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { DirtBikeAIDriver } from '../src/simulation/offroad/ai.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { Simulation } from '../src/simulation/world.ts';

// Reproduced from the 41001 full-field moto: at the outer landing shoulder,
// wheel-speed pulses and tiny bounces were erasing real stationary effort.
// Run the actual contact, terrain, controller and visible remount sequence.
describe('motocross shoulder recovery with intermittent wheel-speed pulses', () => {
  it.each(['mx250', 'mx450'] as const)(
    'recovers a beached %s without waiting for repeated speed pulses',
    (vehicle) => {
      const sim = new Simulation({
        ...DEFAULT_OPTIONS,
        mode: 'practice',
        weather: 'clear',
        circuit: 'valley-ridge-mx',
        opponents: 0,
        vehicles: [vehicle],
        seed: 41001,
      });
      for (let i = 0; i < 120 * 6; i++) sim.step(1 / 120);
      const bike = sim.cars[0] as DirtBikeVehicle,
        ai = sim.ai[0] as DirtBikeAIDriver;
      bike.place(sim.track, 721.856, 7.265);
      bike.dynamics.heading = -1.855;
      bike.gear = 2;
      sim.autoPlayer = true;
      const initialStation = bike.s;
      let firstPush = -1,
        stopped = 0,
        longest = 0,
        previousStation = bike.s,
        forwardDistance = 0,
        largestStationStep = 0;
      for (let i = 0; i < 120 * 20; i++) {
        sim.step(1 / 120);
        const advance =
          mod(bike.s - previousStation + sim.track.length / 2, sim.track.length) -
          sim.track.length / 2;
        forwardDistance += advance;
        largestStationStep = Math.max(largestStationStep, Math.abs(advance));
        previousStation = bike.s;
        stopped = bike.speed < 1 ? stopped + 1 / 120 : 0;
        longest = Math.max(longest, stopped);
        if (ai.decisions.pushes && firstPush < 0) firstPush = i / 120;
      }
      expect(firstPush).toBeGreaterThan(4);
      expect(firstPush).toBeLessThan(6);
      expect(longest).toBeLessThan(6);
      expect(ai.decisions.pushes).toBe(1);
      // Station wraps at 919.684 m. The recovered 250 can cross the line
      // inside this trial; its ~3 m final station is ~200 m of real progress,
      // not a failure to reach station 800. Preserve the original target and
      // additionally reject a discontinuous station jump masquerading as travel.
      expect(initialStation + forwardDistance).toBeGreaterThan(800);
      expect(largestStationStep).toBeLessThan(2);
      expect(bike.riding).toBe(true);
      expect(bike.dynamics.crashes).toBe(0);
    },
  );
});
