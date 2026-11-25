import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { controls } from '../src/simulation/config.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { rideLine, rigBike, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { jumpHoldSpeed } from '../src/simulation/offroad/jump-target.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import type { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

const RATES = [120, 240, 480];

/** Follow the production jump approach until its springs release both
 * wheels. The only initial condition supplied is a rolling run-up speed;
 * no flight pose, suspension force, vertical velocity or impulse is set. */
function launch(definition: VehicleDefinition, dt: number, ai = false) {
  const track = rigTrack('valley-ridge-mx'),
    jump = offroadCourse(track.circuit)!.jumps.find((j) => j.name === 'RIDGE TABLE')!,
    speed = jumpHoldSpeed(jump),
    bike = rigBike(definition, track, jump.start - 12, speed);
  for (let tick = 0; tick < Math.ceil(6 / dt); tick++) {
    if (!bike.airborne)
      rideLine(
        bike,
        track,
        bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1
          ? Math.max(speed, bike.dynamics.speed)
          : speed,
      );
    bike.step(dt, track);
    if (bike.airborne && bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 3) {
      bike.aiControlled(ai ? 1e6 : 0);
      Object.assign(bike.input, controls());
      return { bike, track };
    }
  }
  throw new Error('The production takeoff was not reached');
}

/** Specific vertical mechanical energy avoids confusing fuel consumption
 * with integration loss. Horizontal aerodynamic work is a separate port. */
const energy = (bike: DirtBikeVehicle) => 0.5 * bike.vy ** 2 + G * bike.cgY;

function expectUnsupported(bike: DirtBikeVehicle) {
  expect(bike.airborne).toBe(true);
  expect(bike.forceFront).toBe(0);
  expect(bike.forceRear).toBe(0);
}

describe('motocross ballistic heave timing', () => {
  it.each(
    [MX_250, MX_450].flatMap((definition) =>
      RATES.map((hz) => ({ definition, id: definition.id, hz })),
    ),
  )('$id at $hz Hz conserves vertical energy along its actual free-flight arc', ({ definition, hz }) => {
    for (const ai of [false, true]) {
      const dt = 1 / hz,
        { bike, track } = launch(definition, dt, ai),
        y0 = bike.cgY,
        v0 = bike.vy,
        e0 = energy(bike);
      expectUnsupported(bike);
      // Ordinary body and wheel inputs may rotate the chassis, but cannot
      // act as a vertical thrust or alter its centre-of-mass gravity arc.
      bike.input.riderLean = 0.7;
      bike.input.throttle = 0.6;
      for (let tick = 1; tick <= Math.round(0.8 * hz); tick++) {
        bike.step(dt, track);
        const elapsed = tick * dt;
        expectUnsupported(bike);
        expect(bike.vy).toBeCloseTo(v0 - G * elapsed, 10);
        expect(bike.cgY).toBeCloseTo(y0 + v0 * elapsed - 0.5 * G * elapsed ** 2, 10);
        expect(energy(bike)).toBeCloseTo(e0, 9);
      }
    }
  });

  it.each([MX_250, MX_450])('$id gives the same free-flight height after different subdivisions', (definition) => {
    const schedules = [
      ...RATES.map((hz) => Array<number>(Math.round(0.8 * hz)).fill(1 / hz)),
      Array.from({ length: 48 }, () => [1 / 120, 1 / 480, 1 / 480, 1 / 240]).flat(),
    ];
    const results = schedules.map((schedule) => {
      // Use the same real departure for each schedule: different spring
      // approach timesteps can legitimately produce different takeoffs.
      const { bike, track } = launch(definition, 1 / 480);
      const y0 = bike.cgY, v0 = bike.vy;
      for (const dt of schedule) {
        bike.step(dt, track);
        expectUnsupported(bike);
      }
      return { y0, v0, y: bike.cgY, v: bike.vy, energy: energy(bike) };
    });
    for (const result of results.slice(1)) {
      expect(result.y0).toBe(results[0].y0);
      expect(result.v0).toBe(results[0].v0);
      expect(result.y).toBeCloseTo(results[0].y, 10);
      expect(result.v).toBeCloseTo(results[0].v, 10);
      expect(result.energy).toBeCloseTo(results[0].energy, 9);
    }
  });

  it.each(RATES)('retains the gravity arc after rider separation at %i Hz', (hz) => {
    const dt = 1 / hz, { bike, track } = launch(MX_450, dt);
    for (let tick = 0; tick < Math.round(0.15 * hz); tick++) bike.step(dt, track);
    expectUnsupported(bike);
    // Exercise the public crash transition from a genuine flight; falling
    // does not supply a fabricated body impulse or change the machine's vy.
    bike.dynamics.fall('highside');
    const y0 = bike.cgY, v0 = bike.vy, e0 = energy(bike);
    for (let tick = 1; tick <= Math.round(0.6 * hz); tick++) {
      bike.step(dt, track);
      const elapsed = tick * dt;
      expect(bike.riding).toBe(false);
      expectUnsupported(bike);
      expect(bike.vy).toBeCloseTo(v0 - G * elapsed, 10);
      expect(bike.cgY).toBeCloseTo(y0 + v0 * elapsed - 0.5 * G * elapsed ** 2, 10);
      expect(energy(bike)).toBeCloseTo(e0, 9);
    }
  });

  it.each([false, true])('preserves legacy supermoto heave with rider separation=%s', (separated) => {
    const dt = 1 / 240, { bike, track } = launch(SM_450, dt);
    if (separated) bike.dynamics.fall('highside');
    const y0 = bike.cgY, v0 = bike.vy;
    for (let tick = 1; tick <= 24; tick++) {
      bike.step(dt, track);
      const elapsed = tick * dt;
      expectUnsupported(bike);
      expect(bike.vy).toBeCloseTo(v0 - G * elapsed, 10);
      expect(bike.cgY).toBeCloseTo(
        y0 + v0 * elapsed - 0.5 * G * elapsed * (elapsed + dt),
        10,
      );
    }
  });
});
