import { describe, expect, it } from 'vitest';
import { Bike, NOVICE } from '../src/simulation/bike.ts';
import { Quat, Vec3 } from '../src/core/math.ts';
import { BikeVehicle, bikeOrientation } from '../src/simulation/bike-vehicle.ts';
import { GP_R1, GP_R2 } from '../src/simulation/bike-definitions.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import {
  roadTyreSection,
  tyreShoulderSine,
  tyreRollingRadius,
} from '../src/simulation/bike-tyre-profile.ts';
import {
  MotoGPChassis,
  GP_RAKE,
  GpSteeringPlane,
  fixedWheelGroundAngle,
  gpBarSteer,
  gpGroundSteer,
} from '../src/simulation/motogp-physics.ts';
import { VEHICLES } from '../src/simulation/vehicles.ts';

it('tracks the wheel-plane intersection and inverts the bar angle across bank, pitch and countersteer', () => {
  const plane = new GpSteeringPlane(),
    axis = new Vec3(),
    rotated = new Vec3(),
    rolling = new Vec3();
  for (const heading of [-1.42, 0, 2.1])
    for (const pitch of [-0.14, 0, 0.23])
      for (const roll of [-1.06, 0, 1.06]) {
        const q = new Quat();
        bikeOrientation(q, heading, pitch, roll);
        const sh = Math.sin(heading),
          ch = Math.cos(heading);
        for (const bank of [-0.18, 0, 0.18]) {
          const n = new Vec3(ch * Math.sin(bank), Math.cos(bank), -sh * Math.sin(bank));
          plane.measure(q, n, sh, ch);
          expect(plane.valid).toBe(true);
          for (const delta of [-0.31, -0.08, 0, 0.08, 0.31]) {
            q.rotate(
              axis.set(
                Math.cos(delta),
                -Math.sin(GP_RAKE) * Math.sin(delta),
                -Math.cos(GP_RAKE) * Math.sin(delta),
              ),
              rotated,
            );
            rolling.cross(rotated, n);
            const expected = Math.atan2(
              rolling.x * ch - rolling.z * sh,
              rolling.z * ch + rolling.x * sh,
            );
            expect(gpGroundSteer(delta, roll, plane)).toBeCloseTo(expected, 12);
            if (delta === 0)
              expect(fixedWheelGroundAngle(rotated, n, sh, ch)).toBeCloseTo(expected, 12);
            expect(gpBarSteer(expected, roll, plane)).toBeCloseTo(delta, 12);
            expect(plane.axleNormal(delta)).toBeCloseTo(rotated.dot(n), 12);
          }
        }
      }
});

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

it('carries both wheels along the same oblique rolling direction without inventing scrub, yaw or heat', () => {
  for (const angle of [-0.08, 0.11]) {
    const gp = new MotoGPChassis(geometry),
      speed = 30;
    gp.reset(speed);
    gp.lateralSpeed = speed * Math.tan(angle);
    const rolling = speed / Math.cos(angle);
    gp.frontOmega = rolling / geometry.frontRadius;
    gp.rearOmega = rolling / geometry.rearRadius;
    gp.step({
      ...contact,
      speed,
      steer: gpBarSteer(angle, 0),
      rearGroundAngle: angle,
      inertialContacts: true,
    });
    expect(gp.frontSlipAngle).toBeCloseTo(0, 12);
    expect(gp.rearSlipAngle).toBeCloseTo(0, 12);
    expect(gp.yawRate).toBeCloseTo(0, 12);
    expect(gp.rearSlip).toBeCloseTo(0, 12);
    expect(gp.rearSlidingPower).toBeCloseTo(0, 9);
    gp.step({
      ...contact,
      speed: 1.7,
      steer: gpBarSteer(angle, 0),
      rearGroundAngle: angle,
      inertialContacts: true,
    });
    expect(gp.yawRate).toBeCloseTo(0, 12);
  }
});

it('previews and applies a sloping rear contact in the same chassis axes under drive and braking', () => {
  for (const angle of [-0.06, 0.09])
    for (const rearFx of [-440, 550]) {
      const gp = new MotoGPChassis(geometry);
      gp.reset(contact.speed);
      gp.lateralSpeed = 0.7;
      gp.yawRate = 0.23;
      const q = {
        ...contact,
        lean: 0.32,
        rearFx,
        frontLoad: 0,
        frontContact: 0,
        rearGroundAngle: angle,
        inertialContacts: true,
      };
      const expected = gp.rearForceFor(q.rearLoad, q.rearMu, q.lean, q.speed, rearFx, q.dt, angle);
      gp.step(q);
      const lateral = gp.rearFy * Math.cos(angle) + rearFx * Math.sin(angle);
      expect(lateral).toBeCloseTo(expected, 9);
      expect(gp.lateralAcceleration * q.mass).toBeCloseTo(lateral, 9);
      expect(gp.longitudinalCorrection * q.mass).toBeCloseTo(
        rearFx * (Math.cos(angle) - 1) - gp.rearFy * Math.sin(angle),
        9,
      );
    }
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

  it('keeps front-rim slip and heat in the actual steered contact frame', () => {
    const gp = new MotoGPChassis(geometry);
    gp.reset(30);
    gp.yawRate = 0.35;
    gp.lateralSpeed = 2.4;
    const q = { ...contact, inertialContacts: true, steer: 0.14, frontFx: -420 };
    gp.step(q);
    const cs = Math.cos(gp.groundSteer),
      sn = Math.sin(gp.groundSteer);
    const side = gp.lateralSpeed + gp.yawRate * geometry.frontArm;
    const along = gp.forwardSpeed * cs + side * sn;
    const across = side * cs - gp.forwardSpeed * sn;
    const rim = gp.frontOmega * geometry.frontRadius;
    expect(gp.frontSlip).toBeCloseTo((rim - along) / along, 12);
    expect(gp.frontSlidingPower).toBeCloseTo(
      Math.max(0, q.frontFx * (rim - along) - gp.frontFy * across),
      9,
    );
    gp.step({ ...q, speed: 1.6, steer: -0.19 });
    expect(gp.groundSteer).toBeCloseTo(gpGroundSteer(-0.19, 0), 12);
  });

  it('rolls faster on the shoulder and keeps an unsupported wheel free', () => {
    const b = GP_R1.bike!,
      crown = b.crownRadius;
    const shoulder = tyreShoulderSine(roadTyreSection('gp-bike').frontHalfWidth, crown);
    const frontRadius = tyreRollingRadius(geometry.frontRadius, crown, shoulder, 0.57);
    expect(tyreRollingRadius(geometry.frontRadius, crown, shoulder, 0)).toBe(geometry.frontRadius);
    expect(frontRadius).toBeLessThan(geometry.frontRadius - 0.005);
    expect(tyreRollingRadius(geometry.frontRadius, crown, shoulder, -0.57)).toBe(frontRadius);
    expect(tyreRollingRadius(geometry.frontRadius, crown, shoulder, 1)).toBe(
      tyreRollingRadius(geometry.frontRadius, crown, shoulder, shoulder),
    );
    const gp = new MotoGPChassis(geometry);
    gp.reset(30);
    for (let tick = 0; tick < 240; tick++)
      gp.step({ ...contact, inertialContacts: true, frontRadius });
    expect(gp.frontOmega).toBeCloseTo(30 / frontRadius, 4);
    expect(gp.rearOmega).toBeCloseTo(30 / geometry.rearRadius, 10);
    const held = gp.frontOmega;
    for (let tick = 0; tick < 15; tick++)
      gp.step({ ...contact, speed: 31, inertialContacts: true, frontContact: 0, frontRadius });
    expect(gp.frontOmega).toBe(held);
    expect(gp.frontSlidingPower).toBe(0);
    gp.step({
      ...contact,
      speed: 31,
      inertialContacts: true,
      frontContact: 0,
      frontBrakeExcess: 100,
      frontRadius,
    });
    expect(gp.frontOmega).toBeLessThan(held);
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

  it('stabilizes an assisted dry-grip corner entry and an upright recovery', () => {
    for (const speed of [15, 30, 50, 70]) {
      const bike = new Bike(NOVICE, {
        ...new BikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', GP_R1).dynamics.p,
      });
      bike.enableMotoGPPhysics(geometry);
      bike.speed = speed;
      bike.motoGP!.reset(speed);
      for (let n = 0; n < 6 / DT; n++) {
        const t = n * DT;
        const lean = t < 0.8 ? 0 : t < 4 ? 0.55 : 0;
        bike.step(
          {
            lean,
            rider: lean,
            throttle: 0.3,
            frontBrake: 0,
            rearBrake: 0,
            drive: 0.215 * bike.speed * bike.speed,
          },
          DT,
        );
        expect(bike.state).toBe('riding');
        expect(Math.abs(bike.lean)).toBeLessThan(1.2);
      }
      expect(Math.abs(bike.lean)).toBeLessThan(0.4);
    }
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
