import { describe, expect, it } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { OPEN } from '../src/simulation/differential.ts';
import { REGEN_EFFICIENCY, RegenerativeBrakes } from '../src/simulation/regenerative-braking.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { FORMULA_APX01, VEHICLES, type VehicleDefinition } from '../src/simulation/vehicles.ts';

const DT = 1 / 240;
const track = new DynamicsTrack();
const wheels = (speed: number) => Array.from({ length: 4 }, () => ({ omega: speed }));

/** Unsupported rotating wheels isolate the brake/driveline integration from
 * tire grip. This still runs the production clutch, tire root, heat solve,
 * rotor reaction and rigid-body integration without mocking those systems. */
function car(definition = FORMULA_APX01) {
  const result = new Vehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
  result.place(track, 0);
  result.body.position.y = 4;
  result.body.velocity.z = 30;
  result.fuel = 0;
  result.battery = result.spec.maxBatteryJ * 0.5;
  result.autoShift = false;
  result.gear = 3;
  result.input.manualClutch = true;
  result.input.clutch = 0;
  result.input.brake = 0.35;
  result.clutch.engineOmega = 800;
  for (const tire of result.tires) {
    tire.omega = 90;
    tire.discTemp = 1200;
  }
  return result;
}

describe('driveline-connected regenerative braking', () => {
  it.each(['neutral', 'clutch-open'])(
    'cannot harvest energy through a disconnected crankshaft generator (%s)',
    (disconnection) => {
      const vehicle = car();
      if (disconnection === 'neutral') vehicle.gear = 0;
      else vehicle.input.clutch = 1;
      const before = vehicle.battery;
      vehicle.step(DT, track);
      expect(vehicle.clutch.engagement).toBe(0);
      expect(vehicle.regenerationPower).toBe(0);
      expect(vehicle.battery).toBe(before);
      expect(Array.from(vehicle.brakes.regenerative)).toEqual([0, 0, 0, 0]);
      expect(vehicle.tires.every((tire) => tire.omega < 90)).toBe(true);
      expect(Array.from(vehicle.brakes.friction)).toEqual(Array.from(vehicle.brakes.total));
    },
  );

  it('keeps a separate front-axle generator connected when the engine is in neutral', () => {
    const vehicle = car(VEHICLES.hy9);
    vehicle.gear = 0;
    vehicle.input.clutch = 1;
    vehicle.step(DT, track);
    expect(vehicle.clutch.engagement).toBe(0);
    expect(vehicle.regenerationPower).toBeGreaterThan(0);
    expect(vehicle.brakes.regenerative[0]).toBeGreaterThan(0);
    expect(vehicle.brakes.regenerative[1]).toBe(vehicle.brakes.regenerative[0]);
    expect(vehicle.brakes.regenerative[2]).toBe(0);
    expect(vehicle.brakes.regenerative[3]).toBe(0);
  });

  it.each([40, 320, 1200, 1450])(
    'preserves wheel braking at %s °C when the battery fills, while changing disc heat',
    (temperature) => {
      const generating = car(),
        full = car();
      full.battery = full.spec.maxBatteryJ;
      for (const vehicle of [generating, full])
        for (const tire of vehicle.tires) tire.discTemp = temperature;
      generating.step(DT, track);
      full.step(DT, track);
      expect(generating.regenerationPower).toBeGreaterThan(0);
      expect(full.regenerationPower).toBe(0);
      for (let i = 0; i < 4; i++) {
        expect(generating.tires[i].omega).toBeCloseTo(full.tires[i].omega, 10);
        expect(generating.brakes.total[i]).toBe(full.brakes.total[i]);
        expect(generating.brakes.friction[i] + generating.brakes.regenerative[i]).toBeCloseTo(
          full.brakes.friction[i],
          10,
        );
      }
      expect(generating.tires[2].discTemp).toBeLessThan(full.tires[2].discTemp);
      expect(generating.tires[0].discTemp).toBe(full.tires[0].discTemp);
    },
  );

  it.each(['fwd', 'rwd', 'awd'] as const)(
    'routes a crankshaft generator through its %s layout',
    (drivetrain) => {
      const definition: VehicleDefinition = {
        ...FORMULA_APX01,
        drivetrain,
        driveline: { front: OPEN, rear: OPEN, centre: { ...OPEN, frontShare: 0.35 } },
      };
      const vehicle = car(definition);
      vehicle.step(DT, track);
      const front = vehicle.brakes.regenerative[0] + vehicle.brakes.regenerative[1],
        rear = vehicle.brakes.regenerative[2] + vehicle.brakes.regenerative[3];
      expect(vehicle.regenerationPower).toBeGreaterThan(0);
      expect(front + rear).toBeGreaterThan(0);
      expect(front / (front + rear)).toBeCloseTo(
        drivetrain === 'fwd' ? 1 : drivetrain === 'rwd' ? 0 : 0.35,
        12,
      );
    },
  );

  it('releases the common generator for the weakest ABS channel, preserving each wheel demand', () => {
    const brakes = new RegenerativeBrakes(0),
      spinning = wheels(90),
      demand = [1000, 1000, 600, 600],
      releases = [1, 1, 0.05, 1];
    brakes.prepare(demand, releases, spinning, 70000, 1e6, DT);
    expect(brakes.regenerative[2]).toBeGreaterThan(0);
    expect(brakes.regenerative[2]).toBe(brakes.regenerative[3]);
    for (let i = 0; i < 4; i++)
      expect(brakes.friction[i] + brakes.regenerative[i]).toBeCloseTo(demand[i] * releases[i], 12);
    expect(brakes.regenerative[2]).toBeLessThanOrEqual(demand[2] * releases[2]);
    expect(brakes.recoveredEnergy(spinning, DT, 1e6)).toBeLessThanOrEqual(
      70000 * 0.05 * REGEN_EFFICIENCY * DT,
    );
  });

  it('does not impersonate independent generators on counter-rotating differential outputs', () => {
    const brakes = new RegenerativeBrakes(0),
      spinning = wheels(90);
    spinning[3].omega = -20;
    brakes.prepare([500, 500, 500, 500], [1, 1, 1, 1], spinning, 70000, 1e6, DT);
    expect(Array.from(brakes.regenerative)).toEqual([0, 0, 0, 0]);
    expect(Array.from(brakes.friction)).toEqual([500, 500, 500, 500]);
    expect(brakes.recoveredEnergy(spinning, DT, 1e6)).toBe(0);
  });

  it('hands braking back to friction before a connected output can reverse within the step', () => {
    const definition: VehicleDefinition = {
      ...FORMULA_APX01,
      hybridAxle: { axle: 'front', minSpeed: 0 },
    };
    const vehicle = car(definition);
    vehicle.body.position.y = 0.5;
    vehicle.body.velocity.z = -20;
    vehicle.gear = 0;
    vehicle.input.clutch = 1;
    vehicle.input.brake = 0.1;
    vehicle.tires[0].omega = 0.1;
    const before = vehicle.battery;
    vehicle.step(DT, track);
    // The road really reverses one output while its partner still rolls
    // forward. Unsigned per-wheel generators would invent recoverable work.
    expect(vehicle.tires[0].omega).toBeLessThan(0);
    expect(vehicle.tires[1].omega).toBeGreaterThan(0);
    expect(vehicle.regenerationPower).toBe(0);
    expect(vehicle.battery).toBe(before);
    expect(Array.from(vehicle.brakes.regenerative)).toEqual([0, 0, 0, 0]);
    expect(Array.from(vehicle.brakes.friction)).toEqual(Array.from(vehicle.brakes.total));
  });

  it('rejects a changed output sign when accounting completed carrier work', () => {
    const brakes = new RegenerativeBrakes(0),
      spinning = wheels(90);
    brakes.prepare([500, 500, 500, 500], [1, 1, 1, 1], spinning, 70000, 1e6, DT);
    expect(brakes.regenerative[2]).toBeGreaterThan(0);
    spinning[3].omega = -20;
    expect(brakes.recoveredEnergy(spinning, DT, 1e6)).toBe(0);
  });

  it('does not add generator torque through an already saturated slipping clutch', () => {
    const vehicle = car();
    vehicle.gear = 7;
    vehicle.input.clutch = 0.99;
    vehicle.input.brake = 1;
    vehicle.clutch.engineOmega = 0;
    for (const tire of vehicle.tires) tire.omega = 10;
    vehicle.step(DT, track);
    expect(vehicle.clutch.engagement).toBeCloseTo(0.01, 12);
    expect(vehicle.clutch.transmittedTorque).toBeCloseTo(-7.6, 10);
    expect(vehicle.regenerationPower).toBe(0);
    expect(Array.from(vehicle.brakes.regenerative)).toEqual([0, 0, 0, 0]);
  });

  it('recovers the same work in either rotation direction and fades continuously near rest', () => {
    const forward = new RegenerativeBrakes(0.4),
      reverse = new RegenerativeBrakes(0.4),
      demand = [600, 600, 600, 600],
      releases = [1, 1, 1, 1];
    let previous = -1;
    for (const speed of [0, 0.001, 0.01, 0.1, 1, 2.5, 5, 20]) {
      forward.prepare(demand, releases, wheels(speed), 70000, 1e6, DT);
      reverse.prepare(demand, releases, wheels(-speed), 70000, 1e6, DT);
      expect(Array.from(forward.regenerative)).toEqual(Array.from(reverse.regenerative));
      const work = forward.recoveredEnergy(wheels(speed), DT, 1e6);
      expect(work).toBeCloseTo(reverse.recoveredEnergy(wheels(-speed), DT, 1e6), 12);
      expect(work).toBeGreaterThanOrEqual(previous);
      previous = work;
    }
  });

  it('credits completed generator work, conversion efficiency, and finite battery headroom', () => {
    const brakes = new RegenerativeBrakes(0),
      spinning = wheels(100);
    brakes.prepare([500, 500, 500, 500], [1, 1, 1, 1], spinning, 70000, 2, DT);
    expect(brakes.recoveredEnergy(spinning, DT, 2)).toBeCloseTo(2, 12);
    spinning[2].omega = spinning[3].omega = 25;
    const work = brakes.regenerative[2] * 25 * DT + brakes.regenerative[3] * 25 * DT;
    expect(brakes.recoveredEnergy(spinning, DT, 2)).toBeCloseTo(work * REGEN_EFFICIENCY, 12);
    spinning[2].omega = spinning[3].omega = 0;
    expect(brakes.recoveredEnergy(spinning, DT, 2)).toBe(0);
  });
});
