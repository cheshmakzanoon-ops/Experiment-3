import { describe, expect, it } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { DEFAULT_SETUP, type Assist } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

class Plane extends DynamicsTrack {
  override readonly circuit = circuitDefinition('valley-ridge-mx');
}
const cases = [MX_250, MX_450].flatMap(definition => (['raw', 'sport'] as Assist[])
  .map(assist => ({ definition, assist, id: definition.id })));

function fixture(definition: VehicleDefinition, assist: Assist, roadRpm: number, wheelRpm: number) {
  const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, definition), track = new Plane();
  bike.placeFree(track, 0, 0, 0, 0);
  bike.autoShift = false;
  bike.step(1e-6, track);
  bike.gear = 3;
  const ratio = bike.spec.gearRatios[4] * bike.spec.finalDrive * bike.gearing;
  bike.dynamics.speed = roadRpm * Math.PI / (30 * ratio) * bike.spec.wheelRadius;
  bike.rearSpin = wheelRpm * Math.PI / (30 * ratio);
  (bike as unknown as { mxReferenceSpeed: number }).mxReferenceSpeed = bike.dynamics.speed;
  bike.autoShift = true;
  return { bike, track };
}

describe('ridden motocross automatic downshift demand', () => {
  it.each(cases)('$id $assist requires both actual shaft and rolling RPM to be low',
    ({ definition, assist }) => {
      const threshold = definition.spec.downshiftRPM;
      for (const [road, wheel, expected] of [[0.8, 1.1, 3], [1.1, 0.8, 3], [0.8, 0.8, 2]]) {
        const { bike, track } = fixture(definition, assist, road * threshold, wheel * threshold),
          event = bike.gearStroke.seed.event;
        // The spinning-shaft case is safe below the next gear's limiter.
        // It must still avoid an automatic demand while the engine is busy.
        const nextRatio = bike.spec.gearRatios[3] * bike.spec.finalDrive * bike.gearing;
        expect(Math.max(bike.rearSpin, bike.dynamics.speed / bike.spec.wheelRadius) *
          nextRatio * 30 / Math.PI).toBeLessThan(bike.spec.limiterRPM);
        bike.step(1e-6, track);
        expect(bike.gear).toBe(expected);
        expect(bike.gearStroke.seed.event).toBe(event + (expected === 2 ? 1 : 0));
        expect(bike.shiftClock > 0).toBe(expected === 2);
      }
    });

  it.each(cases)('$id $assist keeps manual control separate and protects rotor and regrip over-rev',
    ({ definition, assist }) => {
      const spec = definition.spec, ratioFactor = spec.gearRatios[4] / spec.gearRatios[3],
        overspeedInCurrentGear = 1.01 * spec.limiterRPM * ratioFactor;
      for (const [roadRpm, wheelRpm, expected] of [
        [0.8 * spec.downshiftRPM, 1.1 * spec.downshiftRPM, 2],
        [0.8 * spec.downshiftRPM, overspeedInCurrentGear, 3],
        [overspeedInCurrentGear, 0.8 * spec.downshiftRPM, 3],
      ]) {
        const { bike, track } = fixture(definition, assist, roadRpm, wheelRpm),
          event = bike.gearStroke.seed.event;
        bike.input.shift = -1;
        bike.step(1e-6, track);
        expect(bike.gear).toBe(expected);
        expect(bike.gearStroke.seed.event).toBe(event + (expected === 2 ? 1 : 0));
        expect(bike.input.shift).toBe(0);
        expect(bike.autoShift).toBe(false);
      }
    });
});
