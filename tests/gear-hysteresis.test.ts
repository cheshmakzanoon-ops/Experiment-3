import { describe, expect, it } from 'vitest';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { createEntrant } from '../src/simulation/offroad/session.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';

/** Automatic shifting compares the wheel-coupled RPM with `shiftRPM` going up and
 * `downshiftRPM` going down (vehicle.ts). A gear step must leave the engine well above the
 * downshift point after an upshift, or the box hunts between two gears for ever: the driven
 * wheels spin a little faster than the road at the moment of the upshift, the spin collapses
 * once the torque is cut, and the road-coupled RPM in the new gear falls below `downshiftRPM`.
 * HF-86 did exactly that and could not pass 124 km/h. */
const MINIMUM_MARGIN = 1.1;

describe('gearbox hysteresis of every four-wheel machine', () => {
  const cars = Object.values(VEHICLES).filter((d) => d.dynamicsKind === 'four-wheel');
  it('leaves each upshift at least 10 % above the downshift point', () => {
    const tight: string[] = [];
    for (const def of cars) {
      const gears = def.spec.gearRatios.slice(2);
      for (let i = 0; i + 1 < gears.length; i++) {
        const after = def.spec.shiftRPM / (gears[i] / gears[i + 1]);
        if (after < def.spec.downshiftRPM * MINIMUM_MARGIN)
          tight.push(
            `${def.id} gear ${i + 1}->${i + 2}: ${after.toFixed(0)} rpm after the shift vs downshift ${def.spec.downshiftRPM}`,
          );
      }
    }
    expect(tight).toEqual([]);
  });
  it('lets the 1986 turbo formula car run past 250 km/h without hunting', () => {
    const def = VEHICLES.hf86,
      track = new DynamicsTrack(),
      car = createEntrant(0, 'medium', DEFAULT_SETUP, 'sport', def),
      dt = 1 / 240;
    car.place(track, 0);
    car.input.brake = 1;
    for (let t = 0; t < 2; t += dt) car.step(dt, track);
    car.input.brake = 0;
    car.input.throttle = 1;
    let gear = car.gear,
      changes = 0,
      reached = Infinity;
    for (let t = 0; t < 40; t += dt) {
      car.step(dt, track);
      if (car.gear !== gear) {
        gear = car.gear;
        changes++;
      }
      if (reached === Infinity && car.speed * 3.6 >= 250) reached = t;
    }
    expect(reached).toBeLessThan(25);
    // Six forward gears: five upshifts, never a shift back.
    expect(changes).toBeLessThanOrEqual(6);
  });
});
