import { describe, expect, it } from 'vitest';
import { G } from '../src/core/math.ts';
import { controls, DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { levelMotocrossTrack } from './motocross-test-track.ts';
import {
  motocrossYawInertia,
  stepMotocrossGround,
  type MxGroundParameters,
  type MxGroundState,
} from '../src/simulation/offroad/mx-ground-physics.ts';

const DT = 1 / 120;
const state = (): MxGroundState => ({
  speed: 16, lateralSpeed: 0, yawRate: 0, heading: 0,
  frontOmega: 16 / 0.355, rearOmega: 16 / 0.345,
});
const params = (): MxGroundParameters => ({
  mass: 184, frontArm: 0.75, rearArm: 0.73,
  frontRadius: 0.355, rearRadius: 0.345,
  frontInertia: 0.6, rearInertia: 0.62,
  frontLoad: 0, rearLoad: 1800,
  frontMu: 0.8, rearMu: 0.8,
  steer: 0.04, lean: 0,
  driveTorque: 0, frontBrakeTorque: 0, rearBrakeTorque: 0,
  drag: 0, slope: 0, tractionControl: false, abs: false,
});
const staticFrontLoad = (p: MxGroundParameters) =>
  p.mass * G * p.rearArm / (p.frontArm + p.rearArm);

describe('motocross front support owns bar steering authority', () => {
  it.each([-0.04, 0.04])('cannot turn through the rear tyre with an unsupported front and steer %s', (steer) => {
    const p = { ...params(), steer };
    const straight = stepMotocrossGround(state(), { ...p, steer: 0 }, DT);
    const result = stepMotocrossGround(state(), p, DT);
    expect(result).toEqual(straight);
    expect(result.front.fx).toBe(0);
    expect(result.front.fy).toBe(0);
    expect(result.rear.fy).toBe(0);
    expect(result.lateralAcceleration).toBe(0);
    expect(result.heading).toBe(0);
    expect(result.yawRate).toBe(0);
    expect(result.lateralSpeed).toBe(0);
  });

  it('restores steering smoothly and symmetrically across the small front support band', () => {
    const p = { ...params(), steer: 0.02, lean: 0.3 };
    const band = 0.1 * staticFrontLoad(p);
    const fullySupportedAcceleration = state().speed ** 2 * Math.tan(p.steer) /
      (p.frontArm + p.rearArm) * Math.cos(p.lean);
    let previous = 0;
    for (const fraction of [0, 0.0001, 0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 1, 1.01, 2, 10]) {
      const frontLoad = fraction * band;
      const supported = { ...p, frontLoad, rearLoad: 1800 - frontLoad };
      const left = stepMotocrossGround(state(), supported, DT);
      const right = stepMotocrossGround(state(), { ...supported, steer: -p.steer, lean: -p.lean }, DT);
      expect(left.lateralAcceleration).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(left.lateralAcceleration).toBeLessThanOrEqual(fullySupportedAcceleration + 1e-12);
      expect(left.front.fy).toBeCloseTo(-right.front.fy, 12);
      expect(left.rear.fy).toBeCloseTo(-right.rear.fy, 12);
      expect(left.heading).toBeCloseTo(-right.heading, 12);
      expect(left.dx).toBeCloseTo(-right.dx, 12);
      expect(left.dz).toBe(right.dz);
      if (fraction > 0 && fraction < 1) {
        expect(left.lateralAcceleration).toBeGreaterThan(0);
        expect(left.lateralAcceleration).toBeLessThan(fullySupportedAcceleration);
      }
      for (const [patch, load] of [[left.front, frontLoad], [left.rear, supported.rearLoad]] as const) {
        expect(Math.hypot(patch.fx, patch.fy)).toBeLessThanOrEqual(load * 0.8 + 1e-9);
        expect(patch.use).toBeLessThanOrEqual(1 + 1e-12);
      }
      if (fraction >= 1) {
        // The existing fully supported rolling-cone calibration returns as
        // soon as ten percent of the static front load is carried.
        expect(left.lateralAcceleration).toBeCloseTo(fullySupportedAcceleration, 12);
        expect(left.front.fy).toBeCloseTo(p.mass * fullySupportedAcceleration * frontLoad / 1800, 10);
        expect(left.rear.fy).toBeCloseTo(p.mass * fullySupportedAcceleration * supported.rearLoad / 1800, 10);
        expect(left.heading).toBeCloseTo(fullySupportedAcceleration * DT / state().speed, 12);
      }
      previous = left.lateralAcceleration;
    }
  });

  it('approaches zero steering slope continuously at both support-band endpoints', () => {
    const p = { ...params(), steer: 0.02 };
    const band = 0.1 * staticFrontLoad(p);
    const at = (fraction: number) => stepMotocrossGround(state(), {
      ...p, frontLoad: fraction * band, rearLoad: 1800 - fraction * band,
    }, DT).lateralAcceleration;
    const full = at(1), epsilon = 0.001;
    expect(at(-epsilon)).toBe(0);
    expect(at(0)).toBe(0);
    expect(at(epsilon)).toBeLessThan(full * 4 * epsilon ** 2);
    expect(at(epsilon / 2)).toBeLessThan(at(epsilon) * 0.26);
    expect(full - at(1 - epsilon)).toBeLessThan(full * 4 * epsilon ** 2);
    expect(full - at(1 - epsilon / 2)).toBeLessThan((full - at(1 - epsilon)) * 0.26);
    expect(at(1 + epsilon)).toBeCloseTo(full, 12);
  });

  it('keeps the existing supported combined-braking calibration exactly', () => {
    const result = stepMotocrossGround(state(), {
      ...params(), frontLoad: 900, rearLoad: 900, lean: 0.45,
      frontBrakeTorque: 600, rearBrakeTorque: 500,
    }, DT);
    // Captured from the original solver before introducing support authority.
    // Equality covers the full result, including combined grip and rotor work.
    expect(result).toEqual({
      speed: 15.963475333883377, lateralSpeed: 0, yawRate: 0,
      heading: 0.0027838822561988127,
      frontOmega: 38.859200775958584, rearOmega: 41.40022912397659,
      dx: 0.00023442997505778286, dz: 0.13320042374451838,
      longitudinal: -4.382959933994783,
      lateralAcceleration: 5.342373879060756,
      endLateralAcceleration: 3.684924743958116,
      frontBrakePower: 24996.78259170425, rearBrakePower: 21811.229234128106,
      front: {
        fx: -430.4000938980438, fy: 467.0289009523348,
        slip: -0.11754020850212281, use: 0.9471673731532874,
        slipPower: 579.1196865697278,
      },
      rear: {
        fx: -376.06453395699066, fy: 515.9678927948441,
        slip: -0.09170909071253915, use: 0.9347496606146322,
        slipPower: 402.4245805498761,
      },
    });
  });

  it('keeps both contact forces inside their combined circle during front pickup and braking', () => {
    const p = params();
    const band = 0.1 * staticFrontLoad(p);
    for (const fraction of [0, 0.0001, 0.1, 0.5, 1, 10]) {
      for (const direction of [-1, 1]) {
        const frontLoad = fraction * band, rearLoad = 1800 - frontLoad;
        const result = stepMotocrossGround({ ...state(), lateralSpeed: 0.6 * direction, yawRate: 0.1 * direction }, {
          ...p, frontLoad, rearLoad, steer: direction * 0.2,
          frontBrakeTorque: 600, rearBrakeTorque: 500,
        }, DT);
        for (const [patch, load] of [[result.front, frontLoad], [result.rear, rearLoad]] as const) {
          expect(Math.hypot(patch.fx, patch.fy)).toBeLessThanOrEqual(load * 0.8 + 1e-9);
          expect(patch.use).toBeLessThanOrEqual(1 + 1e-12);
        }
      }
    }
  });

  it.each([-1, 1])('retains incoming yaw and loaded-rear dissipation for direction %s', (direction) => {
    const p = params();
    const initial = { ...state(), lateralSpeed: 1.6 * direction, yawRate: 0.3 * direction };
    const energy = (s: MxGroundState) => (
      p.mass * (s.speed ** 2 + s.lateralSpeed ** 2) +
      motocrossYawInertia(p.mass, p.frontArm, p.rearArm) * s.yawRate ** 2 +
      p.frontInertia * s.frontOmega ** 2 + p.rearInertia * s.rearOmega ** 2
    ) / 2;
    const straight = stepMotocrossGround(initial, { ...p, steer: 0 }, DT);
    for (const steer of [-0.04, 0.04]) {
      const result = stepMotocrossGround(initial, { ...p, steer }, DT);
      expect(result).toEqual(straight);
      expect(result.front.fy).toBe(0);
      expect(result.rear.fy * direction).toBeLessThan(0);
      expect(result.rear.slipPower).toBeGreaterThan(0);
      expect(energy(result)).toBeLessThan(energy(initial));
      expect(Math.abs(result.lateralSpeed - p.rearArm * result.yawRate))
        .toBeLessThan(Math.abs(initial.lateralSpeed - p.rearArm * initial.yawRate));
      expect(result.yawRate * direction).toBeGreaterThan(0);
      expect(result.lateralSpeed * direction).toBeGreaterThan(0);
      expect(result.heading * direction).toBeGreaterThan(0);
    }
  });

  it.each(['drive', 'brake'] as const)('preserves rear %s with a free steered front', (mode) => {
    const p = {
      ...params(), driveTorque: mode === 'drive' ? 420 : 0,
      rearBrakeTorque: mode === 'brake' ? 250 : 0, frontBrakeTorque: 300,
    };
    const straight = stepMotocrossGround(state(), { ...p, steer: 0 }, DT);
    for (const steer of [-0.3, 0.3]) {
      const result = stepMotocrossGround(state(), { ...p, steer }, DT);
      expect(result).toEqual(straight);
      expect(result.front.fx).toBe(0);
      expect(result.frontOmega).toBeLessThan(state().frontOmega);
      expect(result.rear.fx * (mode === 'drive' ? 1 : -1)).toBeGreaterThan(0);
      expect((result.speed - state().speed) * (mode === 'drive' ? 1 : -1)).toBeGreaterThan(0);
    }
  });

  it.each([MX_250, MX_450])('$id cannot steer the ground through its rear tyre during a real wheelie', (definition) => {
    const sample = (steer: number) => {
      // A real bank couples rider-induced rear-load changes to downhill
      // acceleration. A level patch isolates unsupported bar authority.
      const track = levelMotocrossTrack();
      const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
      bike.place(track, 35);
      bike.input.throttle = 1;
      // Controls alone lift the front through the production suspension.
      // Neither contact loads nor chassis pitch are assigned by the test.
      for (let i = 0; i < 84; i++) bike.step(1 / 240, track);
      expect(bike.riding && !bike.airborne).toBe(true);
      expect(bike.forceFront).toBe(0);
      expect(bike.forceRear).toBeGreaterThan(0);
      expect(bike.pitch).toBeGreaterThan(0.1);
      Object.assign(bike.input, controls(), { steer });
      const heading = bike.dynamics.heading, x = bike.dynamics.x, z = bike.dynamics.z;
      for (let i = 0; i < 4; i++) {
        bike.step(1 / 240, track);
        expect(bike.forceFront).toBe(0);
        expect(bike.forceRear).toBeGreaterThan(0);
        expect(bike.riding && !bike.airborne).toBe(true);
      }
      expect(bike.dynamics.crashes).toBe(0);
      return {
        turn: bike.dynamics.heading - heading, slide: bike.slide,
        steer: bike.dynamics.steer,
        across: (bike.dynamics.x - x) * Math.cos(heading) - (bike.dynamics.z - z) * Math.sin(heading),
      };
    };
    const straight = sample(0);
    for (const steer of [-1, 1]) {
      const turned = sample(steer);
      expect(Math.abs(turned.steer - straight.steer)).toBeGreaterThan(0.001);
      expect(turned.turn).toBeCloseTo(straight.turn, 10);
      expect(turned.slide).toBeCloseTo(straight.slide, 10);
      expect(turned.across).toBeCloseTo(straight.across, 10);
    }
  });
});
