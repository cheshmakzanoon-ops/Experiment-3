import { describe, expect, it } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { drivingSlip } from '../src/simulation/driving-assists.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';

const DT = 1 / 240;
const track = new DynamicsTrack();

/** Real tyre/contact integration with the clutch open isolates brake and
 * traction-control decisions from forward/reverse gearbox ratio differences. */
function rig(direction: number, yaw = 0, assist: 'sport' | 'raw' = 'sport') {
  const car = new Vehicle(0, 'medium', DEFAULT_SETUP, assist);
  car.place(track, 0);
  car.body.orientation.yaw(yaw);
  car.body.velocity.set(Math.sin(yaw) * direction * 20, 0, Math.cos(yaw) * direction * 20);
  car.fuel = 0;
  car.battery = car.spec.maxBatteryJ;
  car.gear = 3;
  car.autoShift = false;
  car.input.manualClutch = true;
  car.input.clutch = 1;
  return car;
}

describe('travel-relative driving assists', () => {
  it('identifies reverse wheelspin and lockup without changing their magnitude', () => {
    expect(drivingSlip(-0.6, -20, -32, 1)).toBeCloseTo(0.6);
    expect(drivingSlip(1, -20, 0, 1)).toBe(-1);
    expect(drivingSlip(-1, 20, 0, -1)).toBe(-1);
  });

  it('uses spinning wheels near rest and requested direction when both are stationary', () => {
    for (const jitter of [-1e-7, 0, 1e-7]) {
      expect(drivingSlip(-0.8, jitter, -2, 1)).toBe(0.8);
      expect(drivingSlip(0.8, jitter, 2, -1)).toBe(0.8);
      expect(drivingSlip(0, jitter, 0, -1)).toBeCloseTo(0);
    }
    expect(drivingSlip(-0.01, 0, 0, -1)).toBe(0.01);
  });

  it.each([0, Math.PI / 2, Math.PI])(
    'releases real brakes equally forward and backward at heading %s',
    (yaw) => {
      const forward = rig(1, yaw),
        reverse = rig(-1, yaw);
      for (const [car, direction] of [
        [forward, 1],
        [reverse, -1],
      ] as const) {
        car.input.brake = 1;
        for (const tire of car.tires) {
          tire.omega = (direction * 4) / tire.radius;
          tire.slip = -direction * 0.8;
        }
        car.step(DT, track);
      }
      for (let i = 0; i < 4; i++) {
        // The contact model includes camber thrust; the mirrored steering/toe
        // configuration permits a tiny physical force difference, not a
        // direction-dependent brake-controller difference.
        expect(Math.abs(reverse.tires[i].omega)).toBeCloseTo(Math.abs(forward.tires[i].omega), 2);
        expect(forward.tires[i].omega).toBeGreaterThan(0);
        expect(reverse.tires[i].omega).toBeLessThan(0);
      }
    },
  );

  it.each([0, Math.PI / 2, Math.PI])(
    'cuts throttle for actual reverse and forward wheelspin at heading %s',
    (yaw) => {
      const forward = rig(1, yaw),
        reverse = rig(-1, yaw);
      for (const [car, direction] of [
        [forward, 1],
        [reverse, -1],
      ] as const) {
        car.input.throttle = 1;
        for (const tire of car.tires) tire.omega = (direction * 36) / tire.radius;
        // The first solve supplies matching wheel slip and contact-frame
        // velocity; the next substep consumes that state in traction control.
        car.step(DT, track);
        car.step(DT, track);
      }
      expect(forward.throttle).toBeLessThan(0.6);
      expect(reverse.throttle).toBeLessThan(0.6);
      expect(reverse.throttle).toBeCloseTo(forward.throttle, 4);
    },
  );

  it('detects wheelspin on a backward-moving driven contact during a chassis spin', () => {
    const car = rig(1);
    car.body.velocity.set(0, 0, 0);
    car.body.omega.set(0, 10, 0);
    car.input.throttle = 1;
    for (let i = 0; i < 4; i++) {
      const contactSpeed = -10 * car.wheelPositions[i][0];
      car.tires[i].omega = (contactSpeed * (i === 3 ? 2 : 1)) / car.tires[i].radius;
    }
    car.step(DT, track);
    expect(car.pointVelocities[3].dot(car.contactFrames[3].forward)).toBeLessThan(-1);
    expect(car.tires[3].slip).toBeLessThan(-0.5);
    car.step(DT, track);
    expect(car.throttle).toBeLessThan(0.6);
  });

  it.each([-1, 1])(
    'preserves physical wheel lock with assists disabled, direction %s',
    (direction) => {
      const car = rig(direction, 0, 'raw');
      car.input.brake = 1;
      for (const tire of car.tires) {
        tire.omega = 0;
        tire.slip = -direction;
      }
      car.step(DT, track);
      expect(car.tires.every((tire) => tire.omega === 0)).toBe(true);
      expect(car.tires.every((tire) => Math.abs(tire.slip) > 0.99)).toBe(true);
    },
  );
});
