import { describe, expect, it } from 'vitest';
import {
  MotoGPChassis,
  MOTOGP_SLICK,
  gpCamberFriction,
  type MotoGPContactStep,
} from '../src/simulation/motogp-physics.ts';
import { combinedForces, prepareSlip, slipState } from '../src/simulation/tyre-force.ts';

const geometry = {
  frontArm: 0.7,
  rearArm: 0.75,
  yawInertia: 55,
  frontRadius: 0.3,
  rearRadius: 0.32,
  frontWheelInertia: 0.6,
  rearWheelInertia: 0.9,
};
function contact(load = 1200, mu = 1.5): MotoGPContactStep {
  return {
    dt: 1 / 240,
    speed: 13,
    mass: 250,
    lean: 0,
    steer: 0,
    frontLoad: load,
    rearLoad: load,
    frontMu: mu,
    rearMu: mu,
    frontFx: 0,
    rearFx: 0,
    frontContact: 1,
    frontBrakeExcess: 0,
    rearDriveExcess: 0,
    rearBrakeExcess: 0,
    inertialContacts: true,
  };
}
function advance(gp: MotoGPChassis, q: MotoGPContactStep, side = 0.3) {
  // Prescribe identical wheel velocities: this is a tyre bench, not a path follower.
  gp.lateralSpeed = side;
  gp.yawRate = 0;
  return gp.step(q);
}
function steady(q: MotoGPContactStep, side = 0.3) {
  const gp = new MotoGPChassis(geometry);
  gp.reset(q.speed);
  for (let i = 0; i < 240; i++) advance(gp, q, side);
  return gp;
}
function construction(load: number, mu: number, lean = 0) {
  const state = slipState();
  prepareSlip(MOTOGP_SLICK, load, mu * gpCamberFriction(lean), 1, 1, 1, state);
  return state;
}
function publicState(gp: MotoGPChassis) {
  return {
    frontFy: gp.frontFy,
    rearFy: gp.rearFy,
    frontSlip: gp.frontSlipAngle,
    rearSlip: gp.rearSlipAngle,
    frontOmega: gp.frontOmega,
    rearOmega: gp.rearOmega,
    frontPower: gp.frontSlidingPower,
    rearPower: gp.rearSlidingPower,
    yaw: gp.yawRate,
    side: gp.lateralSpeed,
  };
}

describe('GP carcass strain survives a change in contact stiffness', () => {
  it.each([
    [500, 1900, 1 / 240],
    [1900, 500, 1 / 240],
    [500, 1900, 1 / 120],
    [1900, 500, 1 / 120],
  ])(
    'carries the same strain from %s N to %s N at dt=%s before new slip relaxation',
    (oldLoad, load, dt) => {
      const q = contact(oldLoad);
      q.dt = dt;
      const gp = steady(q),
        previous = gp.rearFy;
      const oldState = construction(oldLoad, q.rearMu),
        next = construction(load, q.rearMu);
      next.alpha = Math.atan2(0.3, q.speed);
      const force = { fx: 0, fy: 0 };
      combinedForces(next, 0, force);
      const carried = (previous * next.corneringStiffness) / oldState.corneringStiffness,
        mix = 1 - Math.exp((-q.dt * q.speed) / MOTOGP_SLICK.relaxationLength),
        expected = Math.max(-next.dy, Math.min(next.dy, carried + (force.fy - carried) * mix));
      q.frontLoad = q.rearLoad = load;
      advance(gp, q);
      expect(gp.rearFy).toBeCloseTo(expected, 12);
      expect(gp.frontFy).toBeCloseTo(expected, 12);
      expect(Math.abs(gp.rearFy)).toBeLessThanOrEqual(next.dy);
    },
  );

  it('preserves the original force relaxation bit-for-bit with constant contact preparation', () => {
    const q = contact(),
      original = new MotoGPChassis(geometry),
      current = new MotoGPChassis(geometry);
    original.reset(q.speed);
    current.reset(q.speed);
    for (let i = 0; i < 500; i++) {
      const side = 0.7 * Math.sin(i / 21);
      advance(original, { ...q, inertialContacts: false }, side);
      advance(current, q, side);
      expect(current.frontFy).toBe(original.frontFy);
      expect(current.rearFy).toBe(original.rearFy);
    }
  });

  it('keeps zero slip and zero camber force-free through changing support', () => {
    const q = contact(),
      gp = steady(q, 0);
    for (const load of [500, 1900, 0, 500, 1900, 1200]) {
      q.frontLoad = q.rearLoad = load;
      advance(gp, q, 0);
      expect(gp.frontFy).toBe(0);
      expect(gp.rearFy).toBe(0);
      expect(gp.frontSlidingPower).toBe(0);
      expect(gp.rearSlidingPower).toBe(0);
    }
  });

  it('clears unloaded strain and rebuilds a landing from an unstrained contact', () => {
    const q = contact(),
      gp = steady(q);
    expect(Math.abs(gp.rearFy)).toBeGreaterThan(100);
    q.frontLoad = q.rearLoad = 0;
    advance(gp, q);
    expect(gp.frontFy).toBe(0);
    expect(gp.rearFy).toBe(0);
    expect(gp.frontSlidingPower).toBe(0);
    expect(gp.rearSlidingPower).toBe(0);
    q.frontLoad = q.rearLoad = 1200;
    const fresh = new MotoGPChassis(geometry);
    fresh.reset(q.speed);
    advance(fresh, q);
    advance(gp, q);
    expect(gp.frontFy).toBe(fresh.frontFy);
    expect(gp.rearFy).toBe(fresh.rearFy);
  });

  it('keeps repeated previews read-only and identical to the next current-contact solve', () => {
    const q = contact(500),
      gp = steady(q);
    q.frontLoad = q.rearLoad = 1900;
    gp.lateralSpeed = 0.3;
    gp.yawRate = 0;
    const before = publicState(gp),
      values: number[] = [];
    for (let i = 0; i < 10; i++) {
      gp.frontSteerFor(500, q.lean, q.speed, q.frontFx, q.frontLoad, q.frontMu);
      values.push(gp.rearForceFor(q.rearLoad, q.rearMu, q.lean, q.speed, q.rearFx, q.dt));
      expect(publicState(gp)).toEqual(before);
    }
    expect(values.every((v) => v === values[0])).toBe(true);
    advance(gp, q);
    expect(gp.rearFy).toBe(values[0]);
  });

  it('limits changed friction and longitudinal demand to the current circle', () => {
    const q = contact(),
      gp = steady(q, 2);
    for (const [load, mu, fx] of [
      [500, 0.2, 70],
      [1900, 1.5, -1900],
      [500, 1.5, -1000],
    ]) {
      q.frontLoad = q.rearLoad = load;
      q.frontMu = q.rearMu = mu;
      q.frontFx = q.rearFx = fx;
      advance(gp, q, 2);
      const limit = Math.sqrt(Math.max(0, construction(load, mu).dy ** 2 - fx ** 2));
      expect(Math.abs(gp.frontFy)).toBeLessThanOrEqual(limit);
      expect(Math.abs(gp.rearFy)).toBeLessThanOrEqual(limit);
      expect(Number.isFinite(gp.frontSlidingPower)).toBe(true);
      expect(Number.isFinite(gp.rearSlidingPower)).toBe(true);
    }
  });
});
