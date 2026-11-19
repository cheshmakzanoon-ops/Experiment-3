import { describe, expect, it } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { G } from '../src/core/math.ts';
import { GP_R1, SBK_1000 } from '../src/simulation/bike-definitions.ts';
import { BIKE, Bike, EXPERT } from '../src/simulation/bike.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { RoadBikeSuspension } from '../src/simulation/road-bike-suspension.ts';

const suspensionSpec = {
  mass: 260,
  pitchInertia: 95,
  frontArm: 0.73,
  rearArm: 0.72,
  frontRate: 28000,
  rearRate: 36000,
  frontTravel: 0.12,
  rearTravel: 0.12,
  frontPreload: 0,
  rearPreload: 0,
  frontDamping: 1,
  rearDamping: 1,
};
const flatStep = {
  mass: suspensionSpec.mass,
  rideHeight: 0.62,
  frontHeight: 0,
  rearHeight: 0,
  nextFrontHeight: 0,
  nextRearHeight: 0,
  frontForce: 0,
  rearForce: 0,
  cgHeight: 0.62,
  downforce: 0,
  downforceFront: 0.6,
};

describe('sprung motorcycle rear-lift braking geometry', () => {
  it.each([0, 600])('matches the upright static threshold with %s N of wing load', (downforce) => {
    const chassis = new RoadBikeSuspension(suspensionSpec),
      length = suspensionSpec.frontArm + suspensionSpec.rearArm,
      rearWeight = (suspensionSpec.mass * G * suspensionSpec.frontArm) / length,
      rearAero = downforce * (1 - flatStep.downforceFront);
    chassis.reset(0, 0, flatStep.rideHeight);
    // Resolve the initial pose without a measurable suspension transient.
    chassis.step({ ...flatStep, downforce }, 1e-9);
    expect(chassis.rearLiftForce).toBeCloseTo(
      ((rearWeight + rearAero) * length) / flatStep.cgHeight,
      9,
    );
  });

  it('reduces the threshold during dive and never invents support at near-vertical attitudes', () => {
    const chassis = new RoadBikeSuspension(suspensionSpec);
    chassis.reset(0, 0, flatStep.rideHeight);
    chassis.step(flatStep, 1e-9);
    const upright = chassis.rearLiftForce;
    chassis.height = 10; // Free flight: only the geometric diagnostic changes.
    chassis.pitch = -0.15;
    chassis.step(flatStep, 1 / 240);
    expect(chassis.rearLiftForce).toBeGreaterThan(0);
    expect(chassis.rearLiftForce).toBeLessThan(upright);
    for (const pitch of [-Math.PI / 2, -Math.PI / 2 + 1e-9, Math.PI / 2]) {
      chassis.pitch = pitch;
      chassis.step({ ...flatStep, cgHeight: 1e-9 }, 1 / 240);
      expect(Number.isFinite(chassis.rearLiftForce)).toBe(true);
      expect(chassis.rearLiftForce).toBeGreaterThanOrEqual(0);
      expect(chassis.frontLoad + chassis.rearLoad).toBe(0);
      expect(chassis.acceleration).toBeCloseTo(-G, 12);
    }
    chassis.reset(0, 0, flatStep.rideHeight);
    expect(chassis.rearLiftForce).toBe(0);
  });

  it.each([
    { frontBrake: 1, rearBrake: 1, engineBrake: 800 },
    { frontBrake: 0, rearBrake: 1, engineBrake: 0 },
    { frontBrake: 0, rearBrake: 0, engineBrake: 800 },
  ])(
    'bounds total service and engine braking for $frontBrake/$rearBrake/$engineBrake',
    (brakes) => {
      const bike = new Bike({ ...EXPERT, wheelie: true }, { ...BIKE, mu: 5 });
      bike.speed = 25;
      bike.contactLoads = { front: 1500, rear: 1500, rearLiftForce: 500 };
      bike.step({ lean: 0, throttle: 0, rider: 0, drive: 0, ...brakes }, 1 / 240);
      expect(bike.frontBrakeForce + bike.rearBrakeForce).toBeCloseTo(0.92 * 500, 10);
      expect(bike.engineBrakeForce).toBeLessThanOrEqual(bike.rearBrakeForce);
      if (brakes.engineBrake && !brakes.rearBrake)
        expect(bike.engineBrakeForce).toBe(bike.rearBrakeForce);
    },
  );

  it('retains the original standalone limit when the optional pose bound is absent', () => {
    const bike = new Bike({ ...EXPERT, wheelie: true }, { ...BIKE, mu: 5 });
    bike.speed = 25;
    const rearHeld = 0.1 * BIKE.rearBrake,
      expected = (0.92 * bike.rearLoad * BIKE.wheelbase) / BIKE.cgHeight - rearHeld;
    bike.step({ lean: 0, throttle: 0, frontBrake: 1, rearBrake: 0.1, rider: 0, drive: 0 }, 1 / 240);
    expect(bike.frontBrakeForce).toBe(expected);
    expect(bike.rearBrakeForce).toBe(rearHeld);
    expect(bike.contactLoads).toBeUndefined();
  });

  it('cannot apply braking through a positive geometric threshold without contacts', () => {
    const bike = new Bike({ ...EXPERT, wheelie: true });
    bike.speed = 25;
    bike.contactLoads = { front: 0, rear: 0, rearLiftForce: 3000 };
    bike.step(
      { lean: 0, throttle: 0, frontBrake: 1, rearBrake: 1, engineBrake: 800, rider: 0, drive: 0 },
      1 / 240,
    );
    expect(bike.frontBrakeForce + bike.rearBrakeForce + bike.driveForce).toBe(0);
  });

  for (const dt of [1 / 240, 1 / 120]) {
    it.each([
      { definition: GP_R1, band: [30, 42] },
      { definition: SBK_1000, band: [32, 45] },
    ])(
      '$definition.id stops from 100 km/h without pitching over at dt=' + dt,
      ({ definition, band }) => {
        const track = new DynamicsTrack('runway'),
          bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', definition),
          d = bike.dynamics;
        bike.place(track, 0);
        bike.input.throttle = 1;
        for (let t = 0; t < 30 && bike.speed * 3.6 < 100; t += dt) bike.step(dt, track);
        expect(bike.speed * 3.6).toBeGreaterThanOrEqual(100);
        const start = d.z;
        bike.input.throttle = 0;
        bike.input.brake = 1;
        bike.input.clutch = 1;
        for (let t = 0; t < 20 && bike.speed > 0.2; t += dt) {
          bike.step(dt, track);
          expect(bike.riding).toBe(true);
          expect(d.frontBrakeForce + d.rearBrakeForce).toBeLessThanOrEqual(
            (d.p.stoppieMargin ?? 0.92) * bike.roadSuspension.rearLiftForce + 1e-8,
          );
          expect(d.frontBrakeForce).toBeLessThanOrEqual(
            d.p.mu * (d.frontGrip ?? d.grip) * d.frontLoad + 1e-8,
          );
          expect(d.rearBrakeForce).toBeLessThanOrEqual(
            d.p.mu * (d.rearGrip ?? d.grip) * d.rearLoad + 1e-8,
          );
        }
        expect(d.crashes).toBe(0);
        expect(bike.speed).toBeLessThanOrEqual(0.2);
        expect(d.z - start).toBeGreaterThanOrEqual(band[0]);
        expect(d.z - start).toBeLessThanOrEqual(band[1]);
      },
    );
  }
});
