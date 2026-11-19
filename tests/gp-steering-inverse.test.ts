import { describe, expect, it } from 'vitest';
import {
  gpBarSteer,
  MotoGPChassis,
  MOTOGP_SLICK,
  type MotoGPContactStep,
} from '../src/simulation/motogp-physics.ts';

const geometry = {
  frontArm: 0.7,
  rearArm: 0.75,
  yawInertia: 55,
  frontRadius: 0.3,
  rearRadius: 0.32,
  frontWheelInertia: 0.6,
  rearWheelInertia: 0.9,
};

function loaded(lean: number, frontFx: number) {
  const gp = new MotoGPChassis(geometry),
    q: MotoGPContactStep = {
      dt: 1 / 120,
      speed: 20,
      mass: 250,
      lean,
      steer: 0,
      frontLoad: 1400,
      rearLoad: 1050,
      frontMu: 1.5,
      rearMu: 1.5,
      frontFx,
      rearFx: 0,
      frontContact: 1,
      frontBrakeExcess: 0,
      rearDriveExcess: 0,
      rearBrakeExcess: 0,
      inertialContacts: true,
    };
  gp.reset(q.speed);
  gp.step(q);
  // Freeze an independently specified contact velocity for the inverse and
  // forward solve, rather than comparing two differently evolved states.
  gp.lateralSpeed = 1.3;
  gp.yawRate = 0.45;
  gp.frontFy = 0;
  return { gp, q };
}

function roundTrip(lean: number, frontFx: number, requested: number, load = 1400, mu = 1.5) {
  const { gp, q } = loaded(lean, frontFx);
  q.frontLoad = load;
  q.frontMu = mu;
  const ground = gp.frontSteerFor(requested, lean, q.speed, frontFx, load, mu)!;
  q.steer = gpBarSteer(ground, lean);
  gp.step(q);
  // Remove only the known physical relaxation of a fresh carcass. The
  // remaining value is the plant's actual steady tyre force, projected into
  // the chassis frame that the roll/yaw controller uses for its request.
  const mix = 1 - Math.exp((-q.dt * q.speed) / MOTOGP_SLICK.relaxationLength),
    tyreForce = gp.frontFy / mix,
    bodyForce = tyreForce * Math.cos(ground) + frontFx * Math.sin(ground);
  return { ground, bodyForce };
}

describe('GP steering inverse matches the actual contact force', () => {
  it.each([
    [0, 0, 700],
    [0.5, 0, 1100],
    [0.4, -900, 1000],
    [-0.4, -900, -1000],
    [0.2, -1400, 600],
  ])('round trips lean %s, signed Fx %s and body Fy %s', (lean, fx, force) => {
    expect(roundTrip(lean, fx, force).bodyForce).toBeCloseTo(force, 1);
  });

  it.each([
    [700, 1.5],
    [2100, 1.5],
    [1400, 0.9],
  ])('uses this step’s load %s N and friction %s before steering', (load, mu) => {
    expect(roundTrip(0.4, -300, 500, load, mu).bodyForce).toBeCloseTo(500, 1);
  });

  it('returns no ground inverse without a loaded front contact', () => {
    const gp = new MotoGPChassis(geometry);
    expect(gp.frontSteerFor(500, 0.2, 20, -500)).toBeNull();
  });

  it('keeps trial inverse work out of actual contact and thermal telemetry', () => {
    const { gp, q } = loaded(0.4, -900),
      before = {
        frontFy: gp.frontFy,
        frontSlipAngle: gp.frontSlipAngle,
        frontStiffness: gp.frontStiffness,
        frontOmega: gp.frontOmega,
        frontSlidingPower: gp.frontSlidingPower,
        lateralAcceleration: gp.lateralAcceleration,
      };
    for (const demand of [-1e6, -1000, 0, 1000, 1e6]) {
      expect(Number.isFinite(gp.frontSteerFor(demand, 0.4, q.speed, -900, 1400, 1.5))).toBe(true);
      expect({
        frontFy: gp.frontFy,
        frontSlipAngle: gp.frontSlipAngle,
        frontStiffness: gp.frontStiffness,
        frontOmega: gp.frontOmega,
        frontSlidingPower: gp.frontSlidingPower,
        lateralAcceleration: gp.lateralAcceleration,
      }).toEqual(before);
    }
  });
});
