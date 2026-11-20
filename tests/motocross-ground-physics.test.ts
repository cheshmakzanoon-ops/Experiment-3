import { describe, expect, it } from 'vitest';
import {
  motocrossTyreShear,
  stepMotocrossGround,
  type MxGroundParameters,
  type MxGroundState,
} from '../src/simulation/offroad/mx-ground-physics.ts';

const state = (): MxGroundState => ({
  speed: 16, lateralSpeed: 0, yawRate: 0, heading: 0,
  frontOmega: 16 / 0.355, rearOmega: 16 / 0.345,
});
const params = (): MxGroundParameters => ({
  mass: 184, frontArm: 0.75, rearArm: 0.73,
  frontRadius: 0.355, rearRadius: 0.345,
  frontInertia: 0.6, rearInertia: 0.62,
  frontLoad: 900, rearLoad: 900,
  frontMu: 0.8, rearMu: 0.8,
  steer: 0, driveTorque: 0, frontBrakeTorque: 0, rearBrakeTorque: 0,
  drag: 0, slope: 0, tractionControl: false, abs: false,
});
describe('independent motocross wheel/soil/yaw dynamics', () => {
  it('owns the integrated patches and clears every reused shear channel when a wheel unloads', () => {
    const first = stepMotocrossGround({ ...state(), lateralSpeed: 1.6 }, params(), 1 / 120);
    const original = { ...first.front };
    const second = stepMotocrossGround(first, params(), 1 / 120);
    expect(first.front).not.toBe(second.front);
    expect(second.front).not.toBe(second.rear);
    expect(first.front).toEqual(original);
    const out = motocrossTyreShear(3.2, 0.32, 850, 0.7, 18);
    expect(out.slipPower).toBeGreaterThan(0);
    expect(motocrossTyreShear(3.2, 0.32, 0, 0.7, 18, out)).toBe(out);
    expect(out).toEqual({ fx: 0, fy: 0, use: 0, slip: 0, slipPower: 0 });
  });
  it('keeps a settled rolling bike exactly coasting without invented contact work', () => {
    const result = stepMotocrossGround(state(), params(), 1 / 120);
    expect(result.speed).toBeCloseTo(16, 9);
    expect(result.frontOmega).toBeCloseTo(16 / 0.355, 9);
    expect(result.rearOmega).toBeCloseTo(16 / 0.345, 9);
    expect(result.front.use + result.rear.use).toBeLessThan(1e-8);
    expect(result.dx).toBeCloseTo(0, 10);
    expect(result.dz).toBeCloseTo(16 / 120, 7);
  });
  it('reports the whole tyre impulse to the chassis under steering, lockup and rest', () => {
    for (const lean of [undefined, 0.4]) {
      const p = { ...params(), steer: 0.22, lean, frontBrakeTorque: 740, rearBrakeTorque: 240 };
      const start = { ...state(), lateralSpeed: 1.3, rearOmega: 0, yawRate: 0.3 };
      const dt = 1 / 30;
      const result = stepMotocrossGround(start, p, dt);
      const across = lean === undefined
        ? result.front.fy * Math.cos(p.steer) + result.front.fx * Math.sin(p.steer)
        : result.front.fy;
      expect(result.longitudinal * dt).toBeCloseTo(result.speed - start.speed, 11);
      expect(result.lateralAcceleration * p.mass).toBeCloseTo(across + result.rear.fy, 10);
      const first = stepMotocrossGround(start, p, dt / 2);
      const second = stepMotocrossGround(first, p, dt / 2);
      expect(result.endLateralAcceleration).toBeCloseTo(second.endLateralAcceleration, 12);
      expect(result.lateralAcceleration).toBeCloseTo((first.lateralAcceleration + second.lateralAcceleration) / 2, 10);
    }
    const stopped = { ...state(), speed: 0.01, frontOmega: 0, rearOmega: 0 };
    const result = stepMotocrossGround(stopped, { ...params(), drag: 1000 }, 0.04);
    expect(result.speed).toBe(0);
    expect(result.longitudinal).toBeCloseTo(-0.25, 10);
  });
  it('saturates the combined grip circle for every slip direction and unloaded tyre', () => {
    for (const sx of [-100, -10, 0, 2, 50])
      for (const angle of [-1.2, -0.25, 0, 0.3, 1.2]) {
        const contact = motocrossTyreShear(sx, angle, 780, 0.64, 18);
        expect(Math.hypot(contact.fx, contact.fy)).toBeLessThanOrEqual(780 * 0.64 + 1e-9);
        expect(contact.use).toBeLessThanOrEqual(1 + 1e-10);
      }
    expect(motocrossTyreShear(30, 0.5, 0, 1, 20).fx).toBe(0);
    expect(motocrossTyreShear(30, 0.5, 0, 1, 20).fy).toBe(0);
  });
  it('exchanges equal and opposite longitudinal ground impulse with a free rear wheel', () => {
    const initial = { ...state(), rearOmega: state().rearOmega + 30 };
    const p = params();
    p.frontLoad = 0;
    const result = stepMotocrossGround(initial, p, 1 / 240);
    expect(result.speed).toBeGreaterThan(initial.speed);
    expect(result.rearOmega).toBeLessThan(initial.rearOmega);
    const initialMomentum = p.mass * initial.speed + p.rearInertia * initial.rearOmega / p.rearRadius;
    const finalMomentum = p.mass * result.speed + p.rearInertia * result.rearOmega / p.rearRadius;
    expect(finalMomentum).toBeCloseTo(initialMomentum, 7);
    const before = p.mass * initial.speed ** 2 + p.rearInertia * initial.rearOmega ** 2;
    const after = p.mass * result.speed ** 2 + p.rearInertia * result.rearOmega ** 2;
    expect(after).toBeLessThan(before);
  });
  it('settles a heavily loaded free wheel without reversing slip or gaining energy', () => {
    for (const front of [true, false]) {
      for (const load of [3000, 9000, 16000]) {
        for (const mismatch of [-0.5, 0.5]) {
          const p = { ...params(), frontMu: 1.12, rearMu: 1.12,
            frontLoad: front ? load : 0, rearLoad: front ? 0 : load };
          const radius = front ? p.frontRadius : p.rearRadius;
          const inertia = front ? p.frontInertia : p.rearInertia;
          const wheel = front ? 'frontOmega' : 'rearOmega';
          let s = { ...state(), speed: 4, frontOmega: 4 / p.frontRadius, rearOmega: 4 / p.rearRadius };
          s[wheel] += mismatch;
          const momentum = p.mass * s.speed + inertia * s[wheel] / radius;
          const energy = (v: MxGroundState) => (p.mass * v.speed ** 2 + inertia * v[wheel] ** 2) / 2;
          for (let i = 0; i < 16; i++) {
            const next = stepMotocrossGround(s, p, 1 / 720);
            const slip = next[wheel] * radius - next.speed;
            expect(slip * Math.sign(mismatch)).toBeGreaterThanOrEqual(-1e-11);
            expect(Math.abs(slip)).toBeLessThanOrEqual(Math.abs(s[wheel] * radius - s.speed) + 1e-11);
            expect(energy(next)).toBeLessThanOrEqual(energy(s) + 1e-9);
            expect(p.mass * next.speed + inertia * next[wheel] / radius).toBeCloseTo(momentum, 9);
            s = next;
          }
          expect(s[wheel] * radius).toBeCloseTo(s.speed, 7);
        }
      }
    }
  });
  it('publishes exactly the substep impulses exchanged by chassis and rear wheel', () => {
    const initial = { ...state(), rearOmega: state().rearOmega + 30 };
    const p = params();
    p.frontLoad = 0;
    p.rearLoad = 1100;
    const dt = 1 / 60;
    const result = stepMotocrossGround(initial, p, dt);
    const chassisImpulse = p.mass * (result.speed - initial.speed);
    const wheelImpulse = p.rearInertia * (result.rearOmega - initial.rearOmega);
    expect(chassisImpulse).toBeCloseTo(result.rear.fx * dt, 8);
    expect(wheelImpulse).toBeCloseTo(-result.rear.fx * p.rearRadius * dt, 8);
    expect(result.rear.slipPower * dt).toBeGreaterThan(0);
  });

  it('keeps unloaded front braking off the bike but slows the free rotor', () => {
    const p = params();
    p.frontLoad = 0;
    p.rearLoad = 0;
    p.frontBrakeTorque = 300;
    const result = stepMotocrossGround(state(), p, 1 / 120);
    expect(result.speed).toBeCloseTo(16, 10);
    expect(result.frontOmega).toBeLessThan(state().frontOmega);
    expect(result.front.fx).toBe(0);
    expect(result.front.fy).toBe(0);
  });
  it('generates opposite signed yaw and lateral forces for left/right steering', () => {
    const left = params(), right = params();
    left.steer = 0.08;
    right.steer = -left.steer;
    const a = stepMotocrossGround(state(), left, 1 / 60);
    const b = stepMotocrossGround(state(), right, 1 / 60);
    expect(a.yawRate).toBeGreaterThan(0);
    expect(b.yawRate).toBeLessThan(0);
    expect(a.yawRate).toBeCloseTo(-b.yawRate, 8);
    expect(a.lateralSpeed).toBeCloseTo(-b.lateralSpeed, 8);
    expect(a.front.use).toBeLessThanOrEqual(1);
  });
  it('converts only tyre slip into soil dissipation, never pure rolling grip work', () => {
    const noSlip = motocrossTyreShear(0, 0, 920, 0.85, 18);
    const driven = motocrossTyreShear(3, 0.2, 920, 0.85, 18);
    const braking = motocrossTyreShear(-3, -0.2, 920, 0.85, 18);
    expect(noSlip.slipPower).toBe(0);
    expect(driven.slipPower).toBeGreaterThan(0);
    expect(driven.slipPower).toBeCloseTo(braking.slipPower, 10);
    expect(driven.slipPower).toBeCloseTo(
      driven.fx * 3 + driven.fy * Math.tan(0.2) * 18,
      8,
    );
    const free = motocrossTyreShear(5, 1, 0, 0.85, 18);
    expect(free.slipPower).toBe(0);
    const r = stepMotocrossGround(state(), params(), 1 / 120);
    expect(r.front.slipPower + r.rear.slipPower).toBe(0);
  });

  it('reconciles coarse/fine timesteps without unstable wheel-speed divergence', () => {
    const p = params(); p.driveTorque = 420;
    const run = (dt: number) => {
      let s = state();
      for (let i = 0; i < Math.round(0.4 / dt); i++) {
        const r = stepMotocrossGround(s, p, dt);
        s = r;
      }
      return s;
    };
    const a = run(1 / 120), b = run(1 / 240);
    expect(Math.abs(a.speed - b.speed)).toBeLessThan(0.2);
    expect(Math.abs(a.rearOmega - b.rearOmega)).toBeLessThan(1.5);
  });

  it('tracks leaned motorcycle cornering demand within each tyre friction circle without false slip heat', () => {
    const p = { ...params(), steer: 0.04, lean: 0.45 };
    const rolling = stepMotocrossGround(state(), p, 1 / 240);
    const wheelbase = p.frontArm + p.rearArm;
    const expectedLat = 16 * 16 * (Math.tan(p.steer) / wheelbase) * Math.cos(p.lean!);
    expect(rolling.lateralAcceleration).toBeCloseTo(expectedLat, 8);
    expect(rolling.front.fy).toBeGreaterThan(400);
    expect(rolling.rear.fy).toBeGreaterThan(400);
    expect(rolling.front.slipPower + rolling.rear.slipPower).toBe(0);
    expect(rolling.lateralSpeed).toBe(0);
    expect(Math.hypot(rolling.front.fx, rolling.front.fy)).toBeLessThanOrEqual(
      p.frontLoad * p.frontMu + 1e-9,
    );
    expect(Math.hypot(rolling.rear.fx, rolling.rear.fy)).toBeLessThanOrEqual(
      p.rearLoad * p.rearMu + 1e-9,
    );
    const braked = stepMotocrossGround(
      state(),
      { ...p, frontBrakeTorque: 600, rearBrakeTorque: 500 },
      1 / 240,
    );
    expect(Math.hypot(braked.front.fx, braked.front.fy)).toBeLessThanOrEqual(
      p.frontLoad * p.frontMu + 1e-9,
    );
    expect(Math.hypot(braked.rear.fx, braked.rear.fy)).toBeLessThanOrEqual(
      p.rearLoad * p.rearMu + 1e-9,
    );
    expect(braked.front.use).toBeLessThanOrEqual(1 + 1e-10);
    expect(braked.rear.use).toBeLessThanOrEqual(1 + 1e-10);
  });
});
