import { describe, expect, it } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { VEHICLES, type VehicleDefinition } from '../src/simulation/vehicles.ts';
const DT = 1 / 240;
const track = new DynamicsTrack();
const hf86 = VEHICLES.hf86;

/** Seed the previous solved contact state consumed by this substep's controller.
 * Actual tyre and clutch integration remain enabled; assert only gear selection. */
function rig(roadNextRPM: number, definition: VehicleDefinition = hf86, wheelRPM = 11620) {
  const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
  car.place(track, 0);
  car.input.throttle = 1;
  const spec = car.spec;
  const roadOmega = (roadNextRPM * Math.PI) / (30 * spec.gearRatios[3] * spec.finalDrive);
  const wheelOmega = (wheelRPM * Math.PI) / (30 * spec.gearRatios[2] * spec.finalDrive);
  car.clutch.engineOmega = (wheelRPM * Math.PI) / 30;
  car.body.velocity.set(0, 0, roadOmega * spec.wheelRadius);
  for (let i = 0; i < 4; i++) {
    car.tires[i].load = (car.body.mass * 9.81) / 4;
    car.tires[i].omega = wheelOmega;
    car.contactFrames[i].forward.set(0, 0, 1);
    car.pointVelocities[i].set(0, 0, roadOmega * car.tires[i].radius);
  }
  return car;
}
const fwd = { ...hf86, drivetrain: 'fwd' as const };
const awd = { ...hf86, drivetrain: 'awd' as const };
describe('road-supported automatic upshifts', () => {
  it.each([hf86, fwd, awd])('rejects the wheelspin-only next gear on $drivetrain', (definition) => {
    const car = rig(7881, definition);
    car.step(DT, track);
    expect(car.gear).toBe(1);
    expect(car.shiftClock).toBe(0);
  });
  it.each([hf86, fwd, awd])('accepts a road-supported next gear on $drivetrain', (definition) => {
    const car = rig(8100, definition);
    car.step(DT, track);
    expect(car.gear).toBe(2);
    expect(car.shiftClock).toBeGreaterThan(0);
  });
  it('keeps ordinary low-rpm first-gear acceleration', () => {
    const car = rig(8100, hf86, 11000);
    car.step(DT, track);
    expect(car.gear).toBe(1);
  });
  it('projects the road velocity onto each steered contact rather than chassis magnitude', () => {
    const car = rig(8100);
    // Large lateral speed has zero forward support at both driven contacts.
    for (const i of [2, 3]) car.pointVelocities[i].set(100, 0, 0);
    car.step(DT, track);
    expect(car.gear).toBe(1);
  });
  it('accepts a rotated contact basis with equivalent actual road travel', () => {
    const car = rig(8100);
    for (const i of [2, 3]) {
      const speed = car.pointVelocities[i].z;
      car.pointVelocities[i].set(speed, 0, 0);
      car.contactFrames[i].forward.set(1, 0, 0);
    }
    car.step(DT, track);
    expect(car.gear).toBe(2);
  });
  it.each([hf86, fwd, awd])('rejects one unloaded driven contact on $drivetrain', (definition) => {
    const car = rig(8100, definition);
    car.tires[definition.drivetrain === 'rwd' ? 3 : 0].load = 0;
    car.step(DT, track);
    expect(car.gear).toBe(1);
  });
  it.each([hf86, fwd])('does not need undriven contact support on $drivetrain', (definition) => {
    const car = rig(8100, definition);
    for (const i of definition.drivetrain === 'rwd' ? [0, 1] : [2, 3]) car.tires[i].load = 0;
    car.step(DT, track);
    expect(car.gear).toBe(2);
  });
  it('does not interpret backward road travel as forward support', () => {
    const car = rig(-8100);
    car.step(DT, track);
    expect(car.gear).toBe(1);
  });
  it('retains the existing shift-clock lockout', () => {
    const car = rig(8100);
    car.shiftClock = 0.1;
    car.step(DT, track);
    expect(car.gear).toBe(1);
  });
  it('retains manual-clutch ownership', () => {
    const car = rig(8100);
    car.input.manualClutch = true;
    car.step(DT, track);
    expect(car.gear).toBe(1);
  });
  it('retains manual upshift authority even when road support is below the auto floor', () => {
    const car = rig(7881);
    car.input.shift = 1;
    car.step(DT, track);
    expect(car.gear).toBe(2);
    expect(car.autoShift).toBe(false);
    expect(car.input.shift).toBe(0);
  });
  it('does not bypass the existing mechanical over-rev rejection', () => {
    const car = rig(13000, hf86, 18000);
    car.step(DT, track);
    expect(car.gear).toBe(1);
  });
  it('retains ordinary downshift behavior', () => {
    const car = rig(7000, hf86, 9000);
    car.gear = 2;
    car.step(DT, track);
    expect(car.gear).toBe(1);
  });
  it('retains an explicitly disabled automatic controller', () => {
    const car = rig(8100);
    car.autoShift = false;
    car.step(DT, track);
    expect(car.gear).toBe(1);
  });
  it('never applies forward upshift decisions in reverse gear', () => {
    const car = rig(8100);
    car.gear = -1;
    car.input.reverse = true;
    car.step(DT, track);
    expect(car.gear).toBe(-1);
  });
  it('uses the driven axle mean, not the fastest road contact', () => {
    const car = rig(8100);
    car.pointVelocities[2].scale(0);
    car.pointVelocities[3].scale(1.8);
    // Mean next-gear support is 7290 RPM, despite the fast wheel's 14580.
    car.step(DT, track);
    expect(car.gear).toBe(1);
  });
  it('uses the AWD centre split, not the faster axle', () => {
    const definition: VehicleDefinition = {
      ...awd,
      driveline: {
        ...hf86.driveline!,
        centre: {
          type: 'open',
          frontShare: 0.25,
          preload: 0,
          power: 0,
          coast: 0,
        },
      },
    };
    const car = rig(8100, definition);
    for (const i of [0, 1]) car.pointVelocities[i].scale(1.2);
    for (const i of [2, 3]) car.pointVelocities[i].scale(0.8);
    // 25% front / 75% rear support is 7290 RPM; a plain mean would be 8100.
    car.step(DT, track);
    expect(car.gear).toBe(1);
  });
  it('rejects wheelspin after actual airborne contact loss has been solved', () => {
    const car = rig(8100);
    car.autoShift = false;
    car.body.position.y = 5;
    car.step(DT, track);
    expect(car.tires.every((tire) => tire.load === 0)).toBe(true);
    car.autoShift = true;
    const wheelOmega = (11620 * Math.PI) / (30 * car.spec.gearRatios[2] * car.spec.finalDrive);
    for (const tire of car.tires) tire.omega = wheelOmega;
    car.step(DT, track);
    expect(car.gear).toBe(1);
    expect(car.shiftClock).toBe(0);
  });
  it('allows the next gear after the solver confirms road contact again', () => {
    const car = rig(8100);
    car.autoShift = false;
    car.body.position.y = 5;
    car.step(DT, track);
    expect(car.tires.every((tire) => tire.load === 0)).toBe(true);
    car.place(track, 0);
    car.body.position.y -= 0.01;
    const roadOmega = (8100 * Math.PI) / (30 * car.spec.gearRatios[3] * car.spec.finalDrive);
    car.body.velocity.set(0, 0, roadOmega * car.spec.wheelRadius);
    for (const tire of car.tires) tire.omega = roadOmega;
    car.step(DT, track);
    expect(car.tires.slice(2).every((tire) => tire.load > 1)).toBe(true);
    car.autoShift = true;
    const wheelOmega = (11620 * Math.PI) / (30 * car.spec.gearRatios[2] * car.spec.finalDrive);
    for (const tire of car.tires) tire.omega = wheelOmega;
    car.step(DT, track);
    expect(car.gear).toBe(2);
  });
  it('keeps direct manual shifting available with no road support', () => {
    const car = rig(0);
    for (const tire of car.tires) tire.load = 0;
    car.shift(1);
    expect(car.gear).toBe(2);
  });
  it.each([1 / 240, 1 / 120])(
    'reaches the original HF86 band without gear reversals, dt=%s',
    (dt) => {
      const car = new Vehicle(0, 'medium', DEFAULT_SETUP, 'sport', hf86);
      car.place(track, 0);
      car.input.brake = 1;
      for (let t = 0; t < 2; t += dt) car.step(dt, track);
      car.input.brake = 0;
      car.input.throttle = 1;
      let previous = car.gear;
      let downshifts = 0;
      let peak = 0;
      for (let t = 0; t < 30; t += dt) {
        car.step(dt, track);
        if (car.gear < previous) downshifts++;
        previous = car.gear;
        peak = Math.max(peak, car.speed * 3.6);
      }
      expect(downshifts).toBe(0);
      expect(car.gear).toBe(6);
      expect(peak).toBeGreaterThanOrEqual(305);
      expect(peak).toBeLessThanOrEqual(345);
    },
  );
});
