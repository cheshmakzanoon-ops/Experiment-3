import { describe, expect, it } from 'vitest';
import {
  motocrossYawInertia,
  stepMotocrossGround,
  type MxGroundParameters,
  type MxGroundState,
} from '../src/simulation/offroad/mx-ground-physics.ts';

const parameters = (): MxGroundParameters => ({
  mass: 184, frontArm: 0.82, rearArm: 0.66,
  frontRadius: 0.34, rearRadius: 0.32,
  frontInertia: 0.6, rearInertia: 0.8,
  frontLoad: 0, rearLoad: 0, frontMu: 1, rearMu: 1,
  steer: 0, driveTorque: 0, frontBrakeTorque: 0, rearBrakeTorque: 0,
  drag: 0, slope: 0, tractionControl: false, abs: false,
});
const initial = (): MxGroundState => ({
  speed: 20, lateralSpeed: 10, yawRate: 2, heading: 0,
  frontOmega: 50, rearOmega: 50,
});
const worldVelocity = (state: MxGroundState) => ({
  x: Math.sin(state.heading) * state.speed + Math.cos(state.heading) * state.lateralSpeed,
  z: Math.cos(state.heading) * state.speed - Math.sin(state.heading) * state.lateralSpeed,
});
function energy(state: MxGroundState, p: MxGroundParameters, rotation = false) {
  return 0.5 * (p.mass * (state.speed ** 2 + state.lateralSpeed ** 2) +
    (rotation ? motocrossYawInertia(p.mass, p.frontArm, p.rearArm) * state.yawRate ** 2 +
      p.frontInertia * state.frontOmega ** 2 + p.rearInertia * state.rearOmega ** 2 : 0));
}

describe('motocross yaw coordinate passivity', () => {
  it('keeps free world momentum, straight displacement and translational energy while the chassis yaws', () => {
    const p = parameters();
    let state = initial(), x = 0, z = 0;
    const start = worldVelocity(state), before = energy(state, p);
    for (let tick = 0; tick < 120; tick++) {
      const next = stepMotocrossGround(state, p, 1 / 120);
      x += next.dx;
      z += next.dz;
      const velocity = worldVelocity(next);
      expect(velocity.x).toBeCloseTo(start.x, 10);
      expect(velocity.z).toBeCloseTo(start.z, 10);
      expect(energy(next, p)).toBeCloseTo(before, 7);
      expect(Math.abs(next.yawRate)).toBeLessThan(Math.abs(state.yawRate));
      state = next;
    }
    expect(state.heading).toBeGreaterThan(1.8);
    expect(state.speed).toBeGreaterThan(0);
    expect(x).toBeCloseTo(start.x, 10);
    expect(z).toBeCloseTo(start.z, 10);
  });

  it('preserves free velocity for both yaw directions, arbitrary heading and the leaned adapter', () => {
    for (const direction of [-1, 1]) for (const lean of [undefined, -0.4, 0.4]) {
      // A steered but unsupported tyre cannot redirect the centre of mass.
      const p = { ...parameters(), steer: 0.35, lean };
      let state = { ...initial(), heading: direction * 2.9, yawRate: direction * 2 };
      const before = worldVelocity(state);
      for (let tick = 0; tick < 30; tick++) state = stepMotocrossGround(state, p, 1 / 120);
      expect(worldVelocity(state).x).toBeCloseTo(before.x, 10);
      expect(worldVelocity(state).z).toBeCloseTo(before.z, 10);
    }
  });

  it('retains the forward-only stop without adding energy when the body rotates past sideways', () => {
    const p = parameters();
    let state = { ...initial(), yawRate: -3 };
    let reachedStop = false;
    for (let tick = 0; tick < 240; tick++) {
      const next = stepMotocrossGround(state, p, 1 / 120);
      expect(next.speed).toBeGreaterThanOrEqual(0);
      expect(energy(next, p, true)).toBeLessThanOrEqual(energy(state, p, true) + 1e-8);
      if (next.speed === 0) reachedStop = true;
      state = next;
    }
    expect(reachedStop).toBe(true);
  });

  it('dissipates loaded lateral and wheel slip while preserving each tyre force budget', () => {
    for (const lean of [undefined, 0.4]) for (const steer of [-0.3, 0.3]) {
      const p = { ...parameters(), lean, steer, frontLoad: 900, rearLoad: 900 };
      let state: MxGroundState = {
        speed: 5, lateralSpeed: 0.8, yawRate: 0.7, heading: 0.1,
        frontOmega: 17, rearOmega: 20,
      };
      const before = energy(state, p, true);
      for (let step = 0; step < 240; step++) {
        const next = stepMotocrossGround(state, p, 1 / 720);
        expect(energy(next, p, true)).toBeLessThanOrEqual(energy(state, p, true) + 1e-8);
        expect(Math.hypot(next.front.fx, next.front.fy)).toBeLessThanOrEqual(900 + 1e-8);
        expect(Math.hypot(next.rear.fx, next.rear.fy)).toBeLessThanOrEqual(900 + 1e-8);
        state = next;
      }
      expect(energy(state, p, true)).toBeLessThan(before);
    }
  });

  it('gives the same state and displacement when a public step is subdivided at the fixed contact cadence', () => {
    for (const loaded of [false, true]) {
      const p = {
        ...parameters(), frontLoad: loaded ? 900 : 0, rearLoad: loaded ? 900 : 0,
        steer: 0.18,
      };
      const whole = stepMotocrossGround(initial(), p, 1 / 30);
      let state = initial(), x = 0, z = 0;
      for (let step = 0; step < 4; step++) {
        const next = stepMotocrossGround(state, p, 1 / 120);
        x += next.dx;
        z += next.dz;
        state = next;
      }
      for (const key of ['speed', 'lateralSpeed', 'yawRate', 'heading', 'frontOmega', 'rearOmega'] as const)
        expect(state[key]).toBeCloseTo(whole[key], 12);
      expect(x).toBeCloseTo(whole.dx, 12);
      expect(z).toBeCloseTo(whole.dz, 12);
    }
  });
});
