import { expect, it } from 'vitest';
import { DEFAULT_SETUP, WING_DETACH_HEALTH } from '../src/simulation/config.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

it.each(['apx01', 'fx26', 'fr3', 'jf2'])(
  'restores %s front wing load only when the damaged assembly is replaced',
  (id) => {
    const track = new DynamicsTrack();
    const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'raw', VEHICLES[id]);
    car.place(track, 0);
    const tick = () => {
      car.body.velocity.set(0, 0, 60);
      for (const tyre of car.tires) tyre.omega = 60 / tyre.radius;
      car.step(1 / 120, track);
    };
    tick();
    expect(car.aero.front).toBeGreaterThan(100);
    car.damage(150000 * (1 - WING_DETACH_HEALTH / 2), true);
    expect(car.frontHealth).toBeGreaterThan(0);
    expect(car.frontHealth).toBeLessThan(WING_DETACH_HEALTH);
    expect(car.lostMass).toBeGreaterThan(0);
    tick();
    expect(car.aero.front).toBe(0);
    expect(car.aero.floor).toBeGreaterThan(0);
    expect(car.aero.rear).toBeGreaterThan(0);
    car.repairFrontWing(0.06);
    tick();
    expect(car.aero.front).toBe(0);
    car.repairFrontWing(0.2);
    tick();
    expect(car.lostMass).toBe(0);
    expect(car.aero.front).toBeGreaterThan(0);
  },
);
