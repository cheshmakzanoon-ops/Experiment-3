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
  it('keeps a settled rolling bike exactly coasting without invented contact work', () => {
    const result = stepMotocrossGround(state(), params(), 1 / 120);
    expect(result.speed).toBeCloseTo(16, 9);
    expect(result.frontOmega).toBeCloseTo(16 / 0.355, 9);
    expect(result.rearOmega).toBeCloseTo(16 / 0.345, 9);
    expect(result.front.use + result.rear.use).toBeLessThan(1e-8);
    expect(result.dx).toBeCloseTo(0, 10);
    expect(result.dz).toBeCloseTo(16 / 120, 7);
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
});
