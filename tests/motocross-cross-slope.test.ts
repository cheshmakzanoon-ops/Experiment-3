import { describe, expect, it, vi } from 'vitest';
import { G } from '../src/core/math.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { trackPoint } from '../src/simulation/track.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';
import {
  motocrossLateralGravity,
  motocrossYawInertia,
  stepMotocrossGround,
  type MxGroundParameters,
  type MxGroundState,
} from '../src/simulation/offroad/mx-ground-physics.ts';

const DT = 1 / 120;
const parameters = (): MxGroundParameters => ({
  mass: 184, frontArm: 0.75, rearArm: 0.73,
  frontRadius: 0.355, rearRadius: 0.345,
  frontInertia: 0.6, rearInertia: 0.62,
  frontLoad: 184 * G * 0.73 / 1.48, rearLoad: 184 * G * 0.75 / 1.48,
  frontMu: 0.8, rearMu: 0.8, steer: 0, lean: 0,
  driveTorque: 0, frontBrakeTorque: 0, rearBrakeTorque: 0,
  drag: 0, slope: 0, tractionControl: false, abs: false,
});
const initial = (speed = 0): MxGroundState => ({
  speed, lateralSpeed: 0, yawRate: 0, heading: 0,
  frontOmega: speed / 0.355, rearOmega: speed / 0.345,
});
const worldVelocity = (s: MxGroundState) => ({
  x: Math.sin(s.heading) * s.speed + Math.cos(s.heading) * s.lateralSpeed,
  z: Math.cos(s.heading) * s.speed - Math.sin(s.heading) * s.lateralSpeed,
});
const energy = (s: MxGroundState, p: MxGroundParameters) => 0.5 * (
  p.mass * (s.speed ** 2 + s.lateralSpeed ** 2) +
  motocrossYawInertia(p.mass, p.frontArm, p.rearArm) * s.yawRate ** 2 +
  p.frontInertia * s.frontOmega ** 2 + p.rearInertia * s.rearOmega ** 2
);
// For a plane rising by grade per horizontal left metre, n=(-grade,1,0)/|n|.
// G*n.y*n.x is the horizontal projection of downhill tangential gravity.
const bankGravity = (grade: number) => -G * grade / (1 + grade ** 2);

describe('supported motocross cross-slope gravity', () => {
  it('projects unit terrain normals into the current heading and scales continuously with actual support', () => {
    const p = parameters();
    for (const grade of [-0.3, 0.3]) for (const heading of [-2.3, 0, 1.7]) {
      const length = Math.hypot(1, grade);
      const normal = { x: -grade * Math.cos(heading) / length,
        y: 1 / length, z: grade * Math.sin(heading) / length };
      for (const support of [0, 0.0001, 0.01, 0.5, 1, 2]) {
        expect(motocrossLateralGravity(heading, p.mass,
          support * p.frontLoad, normal, support * p.rearLoad, normal))
          .toBeCloseTo(support * bankGravity(grade), 12);
      }
    }
    expect(motocrossLateralGravity(0, p.mass, p.frontLoad, { x: 0, y: 1, z: 0 },
      p.rearLoad, { x: 0, y: 1, z: 0 })).toBe(0);
  });

  it('weights each terrain direction only by its supported axle and excludes a free tyre', () => {
    const p = parameters();
    const frontNormal = { x: -0.6, y: 0.8, z: 0 };
    const rearNormal = { x: 0.8, y: 0.6, z: 0 };
    expect(motocrossLateralGravity(0, p.mass, 200, frontNormal, 700, rearNormal))
      .toBeCloseTo(240 / p.mass, 12);
    expect(motocrossLateralGravity(0, p.mass, 0, frontNormal, 700, rearNormal))
      .toBeCloseTo(336 / p.mass, 12);
    expect(motocrossLateralGravity(0, p.mass, -20, frontNormal, 700, rearNormal))
      .toBeCloseTo(336 / p.mass, 12);
    expect(motocrossLateralGravity(Math.PI / 2, p.mass, 200, frontNormal, 700, rearNormal))
      .toBeCloseTo(0, 12);
    expect(motocrossLateralGravity(0, p.mass, 0, frontNormal, 0, rearNormal)).toBe(0);
  });

  it('preserves the complete original result when the optional acceleration is omitted or zero', () => {
    for (const lean of [undefined, 0, 0.45]) for (const steer of [-0.3, 0, 0.3]) {
      const p = { ...parameters(), lean, steer, frontBrakeTorque: 600, rearBrakeTorque: 500 };
      const s = { ...initial(16), lateralSpeed: 1.3, yawRate: 0.3, heading: 1.4 };
      const original = stepMotocrossGround(s, p, DT);
      expect(stepMotocrossGround(s, { ...p, lateralGravity: 0 }, DT)).toEqual(original);
      expect(stepMotocrossGround(s, { ...p, lateralGravity: -0 }, DT)).toEqual(original);
      expect(original).not.toHaveProperty('lateralGravityPower');
      expect(original).not.toHaveProperty('endLateralGravity');
    }
  });

  it.each([-0.3, 0.3])('holds grade %s without side creep, yaw or fictitious slip heat', (grade) => {
    for (const lean of [undefined, 0]) {
      const p = { ...parameters(), lean, lateralGravity: bankGravity(grade) };
      let s = initial(), x = 0, z = 0;
      for (let tick = 0; tick < 120; tick++) {
        const next = stepMotocrossGround(s, p, DT);
        expect(next.speed).toBeLessThan(1e-12);
        expect(Math.abs(next.lateralSpeed)).toBeLessThan(1e-12);
        expect(Math.abs(next.yawRate)).toBeLessThan(1e-12);
        expect(next.front.fy + next.rear.fy).toBeCloseTo(-p.mass * p.lateralGravity, 9);
        expect(p.frontArm * next.front.fy - p.rearArm * next.rear.fy).toBeCloseTo(0, 9);
        expect(next.front.slipPower).toBe(0);
        expect(next.rear.slipPower).toBe(0);
        expect(Math.abs(next.lateralGravityPower ?? Infinity)).toBeLessThan(1e-10);
        expect(next.front.use).toBeGreaterThan(0);
        expect(next.front.use).toBeLessThan(1);
        x += next.dx;
        z += next.dz;
        s = next;
      }
      expect(Math.hypot(x, z)).toBeLessThan(1e-12);
    }
  });

  it('slides downhill on mirrored low-grip banks with the supported Coulomb acceleration', () => {
    const results = [];
    for (const grade of [-0.3, 0.3]) {
      const p = { ...parameters(), frontMu: 0.01, rearMu: 0.01, lateralGravity: bankGravity(grade) };
      const acceleration = p.lateralGravity - Math.sign(p.lateralGravity) * 0.01 * G;
      let s = initial(), x = 0, z = 0;
      for (let tick = 0; tick < 120; tick++) {
        const next = stepMotocrossGround(s, p, DT);
        expect(next.front.fy * p.lateralGravity).toBeLessThan(0);
        expect(next.rear.fy * p.lateralGravity).toBeLessThan(0);
        expect(next.front.slipPower).toBeGreaterThan(0);
        expect(next.rear.slipPower).toBeGreaterThan(0);
        expect(next.front.use).toBeCloseTo(1, 10);
        expect(next.rear.use).toBeCloseTo(1, 10);
        x += next.dx;
        z += next.dz;
        s = next;
      }
      expect(s.lateralSpeed).toBeCloseTo(acceleration, 9);
      expect(x).toBeCloseTo(0.5 * acceleration * (1 + 1 / 720), 9);
      expect(Math.abs(z)).toBeLessThan(1e-12);
      expect(Math.abs(s.yawRate)).toBeLessThan(1e-12);
      results.push({ s, x, z });
    }
    expect(results[0].s.lateralSpeed).toBeCloseTo(-results[1].s.lateralSpeed, 11);
    expect(results[0].x).toBeCloseTo(-results[1].x, 11);
  });

  it('accounts for downhill gravity work and soil heat over finite impulses', () => {
    const p = { ...parameters(), frontMu: 0.01, rearMu: 0.01, lateralGravity: bankGravity(0.3) };
    let s = initial(), gravitationalWork = 0, soilWork = 0;
    for (let tick = 0; tick < 120; tick++) {
      const next = stepMotocrossGround(s, p, DT);
      gravitationalWork += next.lateralGravityPower! * DT;
      soilWork += (next.front.slipPower + next.rear.slipPower) * DT;
      expect(energy(next, p) + soilWork).toBeCloseTo(gravitationalWork, 8);
      s = next;
    }
    expect(gravitationalWork).toBeGreaterThan(soilWork);
    expect(soilWork).toBeGreaterThan(0);
  });

  it('never powers an existing uphill or downhill skid through its static shear preload', () => {
    for (const direction of [-1, 1]) for (const lateralSpeed of [-1, -0.0001, 0, 0.0001, 1]) {
      const p = { ...parameters(), lateralGravity: direction * bankGravity(0.3) };
      let s = { ...initial(8), lateralSpeed, yawRate: 0.1 * direction };
      let input = 0, heat = 0;
      const before = energy(s, p);
      for (let tick = 0; tick < 120; tick++) {
        const next = stepMotocrossGround(s, p, 1 / 720);
        const gravityWork = next.lateralGravityPower! / 720;
        const soilWork = (next.front.slipPower + next.rear.slipPower) / 720;
        expect(soilWork).toBeGreaterThanOrEqual(0);
        // The existing yaw damper can remove additional work.
        expect(energy(next, p) + soilWork).toBeLessThanOrEqual(energy(s, p) + gravityWork + 1e-8);
        input += gravityWork;
        heat += soilWork;
        s = next;
      }
      expect(energy(s, p) + heat).toBeLessThanOrEqual(before + input + 1e-7);
    }
  });

  it('keeps gravity support, braking, driven spin and cornering inside the same contact circles', () => {
    for (const lean of [undefined, 0.4]) for (const direction of [-1, 1]) {
      for (const mode of ['rolling', 'locked', 'spinning'] as const) {
        const p = { ...parameters(), lean, steer: direction * 0.25,
          lateralGravity: direction * bankGravity(0.3),
          frontBrakeTorque: mode === 'locked' ? 900 : 0,
          rearBrakeTorque: mode === 'locked' ? 700 : 0,
          driveTorque: mode === 'spinning' ? 450 : 0 };
        const s = { ...initial(12), lateralSpeed: direction * 0.4, yawRate: direction * 0.1,
          frontOmega: mode === 'locked' ? 0 : 12 / p.frontRadius,
          rearOmega: mode === 'locked' ? 0 : (mode === 'spinning' ? 30 : 12) / p.rearRadius };
        const result = stepMotocrossGround(s, p, 1 / 30);
        for (const [patch, peak] of [
          [result.front, p.frontLoad * p.frontMu], [result.rear, p.rearLoad * p.rearMu],
        ] as const) {
          expect(Math.hypot(patch.fx, patch.fy)).toBeLessThanOrEqual(peak + 1e-9);
          expect(patch.use).toBeLessThanOrEqual(1 + 1e-12);
          expect(patch.slipPower).toBeGreaterThanOrEqual(0);
        }
        expect(Object.values(result).filter((value) => typeof value === 'number').every(Number.isFinite)).toBe(true);
        if (mode === 'locked') {
          expect(result.frontBrakePower).toBe(0);
          expect(result.rearBrakePower).toBe(0);
        }
      }
    }
  });

  it('does not manufacture horizontal terrain support when both contacts are free', () => {
    for (const lean of [undefined, 0.4]) {
      const p = { ...parameters(), lean, frontLoad: 0, rearLoad: 0, steer: 0.3 };
      const s = { ...initial(16), lateralSpeed: 4, yawRate: 2, heading: -0.6 };
      const free = stepMotocrossGround(s, p, DT);
      for (const lateralGravity of [-8, 8]) {
        expect(stepMotocrossGround(s, { ...p, lateralGravity }, DT)).toEqual(free);
      }
    }
  });

  it('cannot brake the ground through a free front rotor on either bank', () => {
    for (const lateralGravity of [-0.4, 0.4]) for (const lean of [undefined, 0.3]) {
      const p = { ...parameters(), frontLoad: 0, rearLoad: 2600, lean,
        lateralGravity, steer: 0.2, driveTorque: 80, rearBrakeTorque: 50 };
      const s = { ...initial(16), lateralSpeed: 0.7, yawRate: 0.2, rearOmega: 90 };
      const coasting = stepMotocrossGround(s, p, DT);
      const braking = stepMotocrossGround(s, { ...p, frontBrakeTorque: 900 }, DT);
      const groundResponse = (value: ReturnType<typeof stepMotocrossGround>) => {
        const { frontOmega: _frontOmega, frontBrakePower: _frontBrakePower, ...ground } = value;
        return ground;
      };
      expect(groundResponse(braking)).toEqual(groundResponse(coasting));
      expect(braking.front.fx).toBe(0);
      expect(braking.front.fy).toBe(0);
      expect(braking.front.slipPower).toBe(0);
      expect(braking.frontOmega).toBeLessThan(coasting.frontOmega);
      expect(braking.frontBrakePower).toBeGreaterThan(0);
    }
  });

  it('does not create bar steering through the rear contact on a bank with the front free', () => {
    for (const lateralGravity of [-0.4, 0.4]) for (const lean of [undefined, 0.3]) {
      const p = { ...parameters(), frontLoad: 0, rearLoad: 2600, lean,
        lateralGravity, driveTorque: 80, rearBrakeTorque: 50 };
      const s = { ...initial(16), lateralSpeed: 0.7, yawRate: 0.2, rearOmega: 90 };
      const straight = stepMotocrossGround(s, p, DT);
      for (const steer of [-0.3, 0.3]) {
        expect(stepMotocrossGround(s, { ...p, steer }, DT)).toEqual(straight);
      }
      expect(straight.front.fx).toBe(0);
      expect(straight.front.fy).toBe(0);
      expect(straight.rear.slipPower).toBeGreaterThan(0);
    }
  });

  it.each(['front', 'rear'] as const)('a lone %s contact retains its real yaw leverage', (loaded) => {
    const p = { ...parameters(), lateralGravity: 0.3,
      frontLoad: loaded === 'front' ? 1800 : 0,
      rearLoad: loaded === 'rear' ? 1800 : 0 };
    const result = stepMotocrossGround(initial(), p, 1 / 720);
    const free = loaded === 'front' ? result.rear : result.front;
    expect(free.fx).toBe(0);
    expect(free.fy).toBe(0);
    expect(free.slipPower).toBe(0);
    expect(result.lateralSpeed).toBeGreaterThan(0);
    expect(result.yawRate * (loaded === 'front' ? -1 : 1)).toBeGreaterThan(0);
    expect(energy(result, p)).toBeCloseTo(result.lateralGravityPower! / 720, 10);
  });

  it('rotates entry-frame gravity into both body axes without bending its world direction or work', () => {
    for (const direction of [-1, 1]) for (const heading of [-2.3, 0, 1.7]) {
      const p = { ...parameters(), frontMu: 0, rearMu: 0, lateralGravity: direction * 3 };
      const s = { ...initial(20), lateralSpeed: 10, yawRate: direction * 2, heading };
      const before = worldVelocity(s), dt = 1 / 30;
      const result = stepMotocrossGround(s, p, dt), after = worldVelocity(result);
      const gx = p.lateralGravity * Math.cos(heading), gz = -p.lateralGravity * Math.sin(heading);
      expect(after.x).toBeCloseTo(before.x + gx * dt, 10);
      expect(after.z).toBeCloseTo(before.z + gz * dt, 10);
      const travelTime = 0.5 * dt * (dt + 1 / 720);
      expect(result.dx).toBeCloseTo(before.x * dt + gx * travelTime, 10);
      expect(result.dz).toBeCloseTo(before.z * dt + gz * travelTime, 10);
      const translationalChange = 0.5 * p.mass * (
        result.speed ** 2 + result.lateralSpeed ** 2 - s.speed ** 2 - s.lateralSpeed ** 2);
      expect(result.lateralGravityPower! * dt).toBeCloseTo(translationalChange, 8);
      expect(result.endLateralGravity).toBeCloseTo(
        gx * Math.cos(result.heading) - gz * Math.sin(result.heading), 12);
      expect(result.front.slipPower + result.rear.slipPower).toBe(0);
    }
  });

  it.each([-1, 1])('keeps a supported banked turn bounded for direction %s', (direction) => {
    const p = { ...parameters(), lean: direction * 0.3, steer: direction * 0.025,
      lateralGravity: direction * bankGravity(0.3) };
    let s = initial(12);
    for (let tick = 0; tick < 120; tick++) {
      const next = stepMotocrossGround(s, p, DT);
      expect(next.front.use).toBeLessThanOrEqual(1 + 1e-12);
      expect(next.rear.use).toBeLessThanOrEqual(1 + 1e-12);
      expect(Math.abs(next.lateralSpeed)).toBeLessThan(0.1);
      expect(Number.isFinite(next.lateralGravityPower)).toBe(true);
      s = next;
    }
    expect(s.heading * direction).toBeGreaterThan(0.1);
    expect(s.speed).toBeGreaterThan(10);
    expect(s.speed).toBeLessThan(14);
  });

  it('rejects a nonfinite optional gravity input', () => {
    for (const lateralGravity of [NaN, Infinity, -Infinity]) {
      expect(() => stepMotocrossGround(initial(), { ...parameters(), lateralGravity }, DT))
        .toThrow('Invalid MX lateral gravity');
    }
  });
});

/** Only the in-memory sample is replaced: production bike, suspension,
 * inputs and terrain ownership all remain on their ordinary public path. */
function stationaryPlane(definition: VehicleDefinition, grade: number, mu: number) {
  const track = rigTrack('valley-ridge-mx'), origin = track.at(35, trackPoint());
  const sample = track.sample.bind(track);
  const surface = vi.spyOn(track, 'sample').mockImplementation((x, z, out, hint) => {
    sample(x, z, out, hint);
    out.height = origin.y + grade * ((x - origin.x) * origin.nx + (z - origin.z) * origin.nz);
    out.normal.set(-grade * origin.nx, 1, -grade * origin.nz).normalize();
    return out;
  });
  try {
    const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
    bike.place(track, 35);
    bike.dynamics.p.mu = mu;
    const heading = bike.dynamics.heading, x = bike.dynamics.x, z = bike.dynamics.z;
    for (let tick = 0; tick < 240; tick++) {
      bike.step(1 / 240, track);
      expect(bike.riding && !bike.airborne).toBe(true);
      expect(bike.forceFront).toBeGreaterThan(0);
      expect(bike.forceRear).toBeGreaterThan(0);
    }
    return {
      across: (bike.dynamics.x - x) * Math.cos(heading) - (bike.dynamics.z - z) * Math.sin(heading),
      along: (bike.dynamics.x - x) * Math.sin(heading) + (bike.dynamics.z - z) * Math.cos(heading),
      slide: bike.slide, speed: bike.dynamics.speed,
      lean: bike.dynamics.lean, leanRate: bike.dynamics.leanRate,
      curvature: bike.dynamics.curvature,
      turn: bike.dynamics.heading - heading, crashes: bike.dynamics.crashes,
    };
  } finally {
    surface.mockRestore();
  }
}

describe('player motocross cross-slope adapter', () => {
  it.each([MX_250, MX_450])('$id begins a mirrored downhill slide from rest on low-grip banks', (definition) => {
    const flat = stationaryPlane(definition, 0, 0.01);
    expect(flat.across).toBe(0);
    expect(flat.slide).toBe(0);
    const left = stationaryPlane(definition, -0.3, 0.01);
    const right = stationaryPlane(definition, 0.3, 0.01);
    expect(left.across).toBeGreaterThan(0.5);
    expect(left.slide).toBeGreaterThan(1);
    expect(right.across).toBeLessThan(-0.5);
    expect(right.slide).toBeLessThan(-1);
    expect(left.across).toBeCloseTo(-right.across, 7);
    expect(left.slide).toBeCloseTo(-right.slide, 7);
    expect(left.lean).toBeCloseTo(-right.lean, 7);
    expect(left.crashes + right.crashes).toBe(0);
  });

  it.each([MX_250, MX_450])('$id remains stationary on a grippy bank without phantom roll', (definition) => {
    for (const grade of [-0.3, 0, 0.3]) {
      const held = stationaryPlane(definition, grade, 1);
      expect(Math.abs(held.across)).toBeLessThan(1e-7);
      expect(Math.abs(held.along)).toBeLessThan(1e-7);
      expect(Math.abs(held.slide)).toBeLessThan(1e-7);
      expect(Math.abs(held.speed)).toBeLessThan(1e-7);
      expect(Math.abs(held.turn)).toBeLessThan(1e-7);
      expect(held.lean).toBe(0);
      expect(held.leanRate).toBe(0);
      expect(held.curvature).toBe(0);
      expect(held.crashes).toBe(0);
    }
  });
});
