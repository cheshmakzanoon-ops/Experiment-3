import { describe, expect, it } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { DEFAULT_OPTIONS, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { VEHICLES, type VehicleDefinition } from '../src/simulation/vehicles.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 240;
const track = new DynamicsTrack();
const hf86 = VEHICLES.hf86;

/** Seed a previous solved contact sample, independently of wheel rotation.
 * Public gear/input behavior is the contract: wheelspin can require a higher
 * gear even when road speed cannot sustain that gear without continued slip. */
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

describe('automatic shifting preserves wheelspin-relieving launch behavior', () => {
  it.each([hf86, fwd, awd])('allows a wheelspin-relieving upshift on $drivetrain', (definition) => {
    const car = rig(7881, definition);
    car.step(DT, track);
    expect(car.gear).toBe(2);
    expect(car.shiftClock).toBeGreaterThan(0);
  });
  it.each([hf86, fwd, awd])(
    'does not lock a gearbox for one unloaded driven wheel on $drivetrain',
    (definition) => {
      const car = rig(7881, definition);
      car.tires[definition.drivetrain === 'rwd' ? 3 : 0].load = 0;
      car.step(DT, track);
      expect(car.gear).toBe(2);
    },
  );
  it.each([hf86, fwd, awd])(
    'keeps wheel-speed selection available while airborne on $drivetrain',
    (definition) => {
      const car = rig(0, definition);
      for (const tire of car.tires) tire.load = 0;
      car.step(DT, track);
      expect(car.gear).toBe(2);
    },
  );
  it.each([hf86, fwd, awd])(
    'does not upshift for road speed alone on $drivetrain',
    (definition) => {
      const car = rig(8100, definition, 11000);
      car.step(DT, track);
      expect(car.gear).toBe(1);
    },
  );
  it.each([hf86, fwd])('ignores undriven wheelspin on $drivetrain', (definition) => {
    const car = rig(8100, definition, 11000);
    for (const i of definition.drivetrain === 'rwd' ? [0, 1] : [2, 3]) car.tires[i].omega *= 10;
    car.step(DT, track);
    expect(car.gear).toBe(1);
  });
  it('does not turn lateral road travel into a gearbox lockout', () => {
    const car = rig(0);
    for (const i of [2, 3]) car.pointVelocities[i].set(100, 0, 0);
    car.step(DT, track);
    expect(car.gear).toBe(2);
  });
  it('uses the AWD centre split rather than the faster axle for wheel RPM', () => {
    const definition: VehicleDefinition = {
      ...awd,
      driveline: {
        ...hf86.driveline!,
        centre: { type: 'open', frontShare: 0.25, preload: 0, power: 0, coast: 0 },
      },
    };
    const car = rig(8100, definition);
    for (const i of [0, 1]) car.tires[i].omega *= 1.2;
    for (const i of [2, 3]) car.tires[i].omega *= 0.8;
    // The unweighted mean exceeds shiftRPM; the actual carrier is only 90%.
    car.step(DT, track);
    expect(car.gear).toBe(1);
  });
  it('retains an explicitly disabled automatic controller', () => {
    const car = rig(7881);
    car.autoShift = false;
    car.step(DT, track);
    expect(car.gear).toBe(1);
  });
  it('retains manual-clutch ownership', () => {
    const car = rig(7881);
    car.input.manualClutch = true;
    car.step(DT, track);
    expect(car.gear).toBe(1);
  });
  it('retains manual upshift authority and disables subsequent automatic selection', () => {
    const car = rig(7881);
    car.input.shift = 1;
    car.step(DT, track);
    expect(car.gear).toBe(2);
    expect(car.autoShift).toBe(false);
    expect(car.input.shift).toBe(0);
  });
  it('retains the existing shift-clock lockout', () => {
    const car = rig(7881);
    car.shiftClock = 0.1;
    car.step(DT, track);
    expect(car.gear).toBe(1);
  });
  it('allows a new automatic decision when no prior shift is in progress', () => {
    const car = rig(7881);
    car.shiftClock = 0;
    car.step(DT, track);
    expect(car.gear).toBe(2);
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
  it('never applies forward automatic selection in reverse gear', () => {
    const car = rig(8100);
    car.gear = -1;
    car.input.reverse = true;
    car.step(DT, track);
    expect(car.gear).toBe(-1);
  });
  it('does not latch a road-contact lockout after actual airborne contact loss', () => {
    const car = rig(8100);
    car.autoShift = false;
    car.body.position.y = 5;
    car.step(DT, track);
    expect(car.tires.every((tire) => tire.load === 0)).toBe(true);
    car.autoShift = true;
    const wheelOmega = (11620 * Math.PI) / (30 * car.spec.gearRatios[2] * car.spec.finalDrive);
    for (const tire of car.tires) tire.omega = wheelOmega;
    car.step(DT, track);
    expect(car.gear).toBe(2);
  });
  it('keeps automatic selection available after real contact reacquisition', () => {
    const car = rig(8100);
    car.autoShift = false;
    car.body.position.y = 5;
    car.step(DT, track);
    expect(car.tires.every((tire) => tire.load === 0)).toBe(true);
    car.place(track, 0);
    car.body.position.y -= 0.01;
    for (const tire of car.tires) tire.omega = 0;
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
  it.each([1 / 240, 1 / 120])('can leave the real continuous-input launch phase, dt=%s', (dt) => {
    // The original integrated-driving fixture remains the full acceptance gate.
    // This short regression preserves its exact raw launch and six-car traffic;
    // only control requests are made, never pose, velocity, torque or gear edits.
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'race',
      laps: 8,
      opponents: 5,
      assist: 'raw',
      weather: 'changeable',
      setup: { ...DEFAULT_OPTIONS.setup, brakeBias: 0.66 },
      seed: 4417,
    });
    const car = sim.cars[0];
    let followed = false;
    let upshifted = false;
    for (let tick = 0; tick * dt < 14; tick++) {
      const time = sim.race.raceTime;
      sim.ai[0].update(dt, sim.track, sim.cars, sim.race);
      if (time < 2.5) {
        car.input.throttle = 0;
        car.input.brake = 1;
      } else if (!followed) {
        car.input.throttle = 1;
        car.input.brake = 0;
        car.input.ers = 2;
        if (car.speed > 22) followed = true;
      }
      const gear = car.gear;
      sim.step(dt);
      upshifted ||= car.gear > gear;
    }
    expect(upshifted).toBe(true);
    expect(followed).toBe(true);
    expect(car.retired).toBe(false);
  });
});
