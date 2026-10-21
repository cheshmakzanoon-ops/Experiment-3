import { describe, expect, it } from 'vitest';
import { Bike, NOVICE } from '../src/simulation/bike.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { GP_R1, GP_R2 } from '../src/simulation/bike-definitions.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MotoGPChassis } from '../src/simulation/motogp-physics.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

const DT = 1 / 240;
const geometry = Object.freeze({
  frontArm: 0.7,
  rearArm: 0.75,
  yawInertia: 55,
  frontRadius: 0.3,
  rearRadius: 0.32,
  frontWheelInertia: 0.6,
  rearWheelInertia: 0.9,
});
const contact = Object.freeze({
  dt: DT,
  speed: 30,
  mass: 245,
  lean: 0,
  steer: 0,
  frontLoad: 1240,
  rearLoad: 1160,
  frontMu: 1.75,
  rearMu: 1.75,
  frontFx: 0,
  rearFx: 0,
  frontContact: 1,
  frontBrakeExcess: 0,
  rearDriveExcess: 0,
  rearBrakeExcess: 0,
});

describe('MotoGP-only single-track tyre/yaw dynamics', () => {
  it('is enabled for both prototypes and not other motorcycles or standalone Bike research tests', () => {
    for (const def of [GP_R1, GP_R2]) {
      const bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', def);
      expect(bike.dynamics.motoGP).toBeInstanceOf(MotoGPChassis);
    }
    for (const id of ['sbk1000', 'ss600', 'mx450', 'mx250', 'sm450']) {
      const bike = new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', VEHICLES[id]);
      expect(bike.dynamics.motoGP).toBeNull();
    }
    expect(new Bike(NOVICE).motoGP).toBeNull();
  });

  it('accelerates yaw from tyre forces instead of assigning steering curvature', () => {
    const bike = new MotoGPChassis(geometry);
    bike.reset(30);
    bike.step({ ...contact, steer: 0.015 });
    expect(bike.yawRate).toBeGreaterThan(0);
    expect(bike.yawRate).toBeLessThan(0.1);
    expect(bike.frontFy).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) bike.step({ ...contact, steer: 0.015 });
    expect(bike.yawRate).toBeGreaterThan(0);
    expect(Number.isFinite(bike.lateralSpeed)).toBe(true);
    expect(Number.isFinite(bike.lateralAcceleration)).toBe(true);
  });

  it('generates bounded camber thrust without turning the handlebars', () => {
    const bike = new MotoGPChassis(geometry);
    bike.reset(30);
    for (let i = 0; i < 20; i++) bike.step({ ...contact, lean: 0.36 });
    expect(bike.frontFy).toBeGreaterThan(0);
    expect(bike.rearFy).toBeGreaterThan(0);
    expect(Math.abs(bike.frontFy)).toBeLessThanOrEqual(contact.frontLoad * contact.frontMu);
    expect(Math.abs(bike.rearFy)).toBeLessThanOrEqual(contact.rearLoad * contact.rearMu);
  });

  it('uses the longitudinal friction budget under hard braking', () => {
    const free = new MotoGPChassis(geometry);
    const braked = new MotoGPChassis(geometry);
    free.reset(30);
    braked.reset(30);
    for (let i = 0; i < 12; i++) {
      free.step({ ...contact, steer: 0.03 });
      braked.step({ ...contact, steer: 0.03, frontFx: -2500 });
    }
    expect(free.frontFy).toBeGreaterThan(100);
    expect(braked.frontFy).toBe(0);
  });

  it('removes front-road steering in a wheelie and retains low-speed turning', () => {
    const bike = new MotoGPChassis(geometry);
    bike.reset(30);
    for (let i = 0; i < 30; i++) bike.step({ ...contact, steer: 0.02 });
    expect(bike.yawRate).toBeGreaterThan(0);
    bike.step({ ...contact, steer: 0.02, frontContact: 0, frontLoad: 0 });
    expect(bike.yawRate).toBe(0);
    expect(bike.frontFy).toBe(0);
    expect(bike.lateralSpeed).toBe(0);
    bike.step({ ...contact, speed: 1.5, steer: 0.12, frontContact: 1 });
    expect(bike.yawRate).toBeGreaterThan(0);
  });

  it('permits wheel lock and wheelspin only when the unassisted force is supplied', () => {
    const raw = new MotoGPChassis(geometry);
    const aided = new MotoGPChassis(geometry);
    raw.reset(30);
    aided.reset(30);
    raw.step({ ...contact, frontBrakeExcess: 9000, rearDriveExcess: 6000 });
    aided.step(contact);
    expect(raw.frontSlip).toBeLessThan(-0.05);
    expect(raw.rearSlip).toBeGreaterThan(0.05);
    expect(aided.frontSlip).toBeCloseTo(0, 6);
    expect(aided.rearSlip).toBeCloseTo(0, 6);
    raw.reset(20);
    expect(raw.yawRate).toBe(0);
    expect(raw.lateralSpeed).toBe(0);
    expect(raw.frontOmega).toBeCloseTo(20 / geometry.frontRadius);
    expect(raw.rearOmega).toBeCloseTo(20 / geometry.rearRadius);
  });

  it('tracks a steady corner consistently at 120 Hz and 240 Hz substeps', () => {
    const run = (dt: number) => {
      const bike = new MotoGPChassis(geometry);
      bike.reset(30);
      for (let i = 0; i < 2 / dt; i++) {
        bike.step({ ...contact, dt, steer: 0.012, lean: 0.2 });
        expect(Number.isFinite(bike.yawRate)).toBe(true);
      }
      return { yaw: bike.yawRate, lateral: bike.lateralSpeed };
    };
    const slow = run(1 / 120);
    const fast = run(1 / 240);
    expect(Math.abs(slow.yaw - fast.yaw)).toBeLessThan(0.15);
    expect(Math.abs(slow.lateral - fast.lateral)).toBeLessThan(1.0);
  });
});
