import assert from 'node:assert/strict';
import { DynamicsTrack } from './dynamics-fixtures.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { VEHICLE, type Assist } from '../src/simulation/config.ts';
function vehicle(speed: number, assist: Assist = 'sport') {
  const track = new DynamicsTrack('runway', 1.2), car = new Vehicle(0, 'medium', undefined, assist);
  car.place(track, 20); car.input.brake = 1;
  for (let i = 0; i < 480; i++) car.step(1 / 240, track);
  car.body.velocity.set(0, 0, speed); car.battery = 2e6;
  for (const tire of car.tires) tire.omega = speed / VEHICLE.wheelRadius;
  return { car, track };
}
export const brakeOracles: Record<string, () => void> = {
  'ABS releases generator torque and only credits actual generator work': () => {
    const release = 1 / (1 + (1 - 0.14) * 9), results: number[] = [];
    for (const assist of ['sport', 'raw'] as const) {
      const { car, track } = vehicle(30, assist); car.input.brake = 0.35;
      car.tires[2].slip = car.tires[3].slip = -1;
      const before = car.battery; car.step(1 / 240, track);
      assert(car.regenerationPower > 0);
      if (assist === 'sport') assert(car.regenerationPower <= VEHICLE.regenPowerW * 0.35 * release * 0.78 + 1e-6);
      assert(Math.abs((car.battery - before) * 240 - car.regenerationPower) < 1e-5);
      results.push(car.regenerationPower);
    }
    assert(results[1] > results[0] * 4, 'Raw brake input must not acquire hidden ABS assistance');
  },
  'automatic anti-stall cannot drive through a braking request below idle-coupled speed': () => {
    const { car, track } = vehicle(5); car.input.brake = 0.1;
    car.step(1 / 240, track);
    assert.equal(car.clutch.engagement, 0); assert.equal(car.clutch.transmittedTorque, 0);
  },
  'anti-stall preserves explicit manual clutch ownership and high-speed engine braking': () => {
    const manual = vehicle(5); manual.car.input.brake = 0.1;
    manual.car.input.manualClutch = true; manual.car.input.clutch = 0;
    manual.car.step(1 / 240, manual.track); assert.equal(manual.car.clutch.engagement, 1);
    const fast = vehicle(50); fast.car.input.brake = 0.1;
    fast.car.step(1 / 240, fast.track); assert(fast.car.clutch.engagement > 0);
  },
  'a full battery cannot gain regenerative energy while friction braking remains available': () => {
    const { car, track } = vehicle(30); car.battery = VEHICLE.maxBatteryJ;
    car.input.brake = 0.5; car.step(1 / 240, track);
    assert.equal(car.regenerationPower, 0); assert.equal(car.battery, VEHICLE.maxBatteryJ);
    assert(car.tires.some((t) => t.fx < 0));
  },
};
