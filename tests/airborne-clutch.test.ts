import { describe, expect, it } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { Vec3 } from '../src/core/math.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { type SurfaceSample } from '../src/simulation/track.ts';
import { CATALOGUE } from '../src/simulation/vehicle-catalogue/index.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';

const DT = 1 / 240;

class ContactTrack extends DynamicsTrack {
  supported = true;
  override castTire(
    origin: Vec3,
    down: Vec3,
    maximum: number,
    radius: number,
    halfWidth: number,
    axle: Vec3,
    out: SurfaceSample,
    point: Vec3,
  ) {
    return this.supported
      ? super.castTire(origin, down, maximum, radius, halfWidth, axle, out, point)
      : Infinity;
  }
}

const track = new ContactTrack();

function kart(id = 'sk125') {
  const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'raw', CATALOGUE[id]);
  car.place(track, 0);
  car.fuel = car.battery = 0;
  car.gear = 1;
  car.autoShift = false;
  car.input.manualClutch = true;
  car.input.clutch = 0;
  return car;
}

/** No fuel/electric source and no road contact: coupling may only remove
 * engine/wheel rotation energy. Include the chassis reaction in the budget. */
function rotationalEnergy(car: Vehicle) {
  const omega = new Vec3();
  car.body.orientation.inverseRotate(car.body.omega, omega);
  return (
    0.5 * car.clutch.inertia * car.clutch.engineOmega ** 2 +
    car.tires.reduce((sum, tire) => sum + 0.5 * tire.inertia * tire.omega ** 2, 0) +
    0.5 *
      (car.body.inertia.x * omega.x ** 2 +
        car.body.inertia.y * omega.y ** 2 +
        car.body.inertia.z * omega.z ** 2)
  );
}

describe('grounded clutch inertia referral', () => {
  it.each([
    ['sk125', 100, 0],
    ['sk125', 1000, 60],
    ['dk100', 100, 0],
    ['dk100', 1000, 100],
  ] as const)(
    'cannot create airborne rotational energy in %s at engine/wheel speeds %s/%s',
    (id, engineSpeed, wheelSpeed) => {
      const car = kart(id);
      car.body.position.y = 4;
      car.clutch.engineOmega = engineSpeed;
      car.tires[2].omega = car.tires[3].omega = wheelSpeed;
      const before = rotationalEnergy(car);
      car.step(DT, track);
      expect(car.tires.every((tire) => tire.load === 0)).toBe(true);
      expect(car.clutch.wheelInertia).toBe(car.spec.wheelInertia);
      expect(rotationalEnergy(car)).toBeLessThan(before);
      expect(rotationalEnergy(car) + car.clutch.slipPower * DT).toBeLessThanOrEqual(before + 0.02);
      expect(car.engineOutputTorque).toBe(0);
      expect(car.motorPower).toBe(0);
      expect(car.fuel).toBe(0);
      expect(car.battery).toBe(0);
    },
  );

  it('drops and restores effective inertia after contact loss and reacquisition', () => {
    const car = kart();
    // Catalogue placement includes 10 mm of spawn clearance. Start at the
    // authored static CG height so the first solve actually supports the kart.
    car.body.position.y -= 0.01;
    car.input.clutch = 1;
    car.clutch.engineOmega = 0;
    const rotor = car.spec.wheelInertia;
    try {
      car.step(DT, track);
      expect(car.tires.slice(2).every((tire) => tire.load > 1)).toBe(true);
      // A new contact cannot lend inertia until a tyre solve has confirmed it.
      expect(car.clutch.wheelInertia).toBe(rotor);
      car.step(DT, track);
      const grounded = car.clutch.wheelInertia;
      expect(grounded).toBeGreaterThan(rotor);

      track.supported = false;
      car.step(DT, track);
      expect(car.tires.every((tire) => tire.load === 0)).toBe(true);
      // The explicit clutch/road ordering retains at most one substep of
      // previous contact state; the next step must restore physical rotors.
      car.step(DT, track);
      expect(car.clutch.wheelInertia).toBe(rotor);
      expect(car.tires.every((tire) => Math.abs(tire.omega) < 0.1)).toBe(true);

      track.supported = true;
      car.step(DT, track);
      expect(car.clutch.wheelInertia).toBe(rotor);
      expect(car.tires.slice(2).every((tire) => tire.load > 1)).toBe(true);
      car.step(DT, track);
      expect(car.clutch.wheelInertia).toBeGreaterThan(rotor);
      expect(car.clutch.wheelInertia).toBeLessThanOrEqual(grounded + 1e-9);
      expect(car.tires.every((tire) => Math.abs(tire.omega) < 0.1)).toBe(true);
      expect(car.body.position.finite()).toBe(true);
      expect(car.body.omega.finite()).toBe(true);
    } finally {
      track.supported = true;
    }
  });

  it('does not borrow chassis inertia through a single unloaded driven wheel', () => {
    const car = kart();
    car.body.position.y = 4;
    car.clutch.engineOmega = 100;
    // The preceding solve supported only one wheel. Zero slip on the free
    // wheel does not prove a contact, and must not enable mass referral.
    car.tires[2].load = 300;
    car.tires[3].load = 0;
    const before = rotationalEnergy(car);
    car.step(DT, track);
    expect(car.clutch.wheelInertia).toBe(car.spec.wheelInertia);
    expect(rotationalEnergy(car)).toBeLessThan(before);
  });
});
