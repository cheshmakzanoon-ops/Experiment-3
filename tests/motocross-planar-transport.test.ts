import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETUP, type Assist } from '../src/simulation/config.ts';
import type { CircuitId } from '../src/simulation/circuits.ts';
import { MX_250, MX_450, SM_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import * as ground from '../src/simulation/offroad/mx-ground-physics.ts';
import type { MxGroundParameters, MxGroundResult, MxGroundState } from '../src/simulation/offroad/mx-ground-physics.ts';
import { trackPoint } from '../src/simulation/track.ts';

const DT = 1 / 120;
const stepGround = ground.stepMotocrossGround;
const parameters = (): MxGroundParameters => ({
  mass: 184, frontArm: 0.75, rearArm: 0.73,
  frontRadius: 0.355, rearRadius: 0.345,
  frontInertia: 0.6, rearInertia: 0.62,
  frontLoad: 900, rearLoad: 900, frontMu: 0.8, rearMu: 0.8,
  steer: 0, driveTorque: 0, frontBrakeTorque: 0, rearBrakeTorque: 0,
  drag: 0, slope: 0, tractionControl: false, abs: false,
});
const initial = (speed = 16): MxGroundState => ({
  speed, lateralSpeed: 0, yawRate: 0, heading: 0,
  frontOmega: speed / 0.355, rearOmega: speed / 0.345,
});
const world = (forward: number, lateral: number, heading: number) => ({
  x: Math.sin(heading) * forward + Math.cos(heading) * lateral,
  z: Math.cos(heading) * forward - Math.sin(heading) * lateral,
});
const mechanical = ({ dx: _dx, dz: _dz, ...result }: MxGroundResult) => result;
const energy = (s: MxGroundState, p: MxGroundParameters) => 0.5 * (
  p.mass * (s.speed ** 2 + s.lateralSpeed ** 2) +
  ground.motocrossYawInertia(p.mass, p.frontArm, p.rearArm) * s.yawRate ** 2 +
  p.frontInertia * s.frontOmega ** 2 + p.rearInertia * s.rearOmega ** 2
);

/** Independent kinematic quadrature: use the unchanged force solver only
 * to obtain each microstep's physical state, then integrate its represented
 * world velocity. Never use the solver's dx/dz as the spatial oracle. */
function integratedVelocity(start: MxGroundState, p: MxGroundParameters, dt: number, projection: number) {
  const n = Math.ceil(dt * 720), h = dt / n;
  let state = start, x = 0, z = 0;
  for (let i = 0; i < n; i++) {
    state = stepGround(state, { ...p, forwardProjection: 1 }, h);
    const velocity = world(state.speed * projection, state.lateralSpeed, state.heading);
    x += velocity.x * h;
    z += velocity.z * h;
  }
  return { state, x, z };
}

/** Analytical height-field fixture, retaining the venue's real soil and
 * public sampling/placement code. The two grades are horizontal gradients. */
function plane(grade: number, cross: number, heading: number, venue: CircuitId = 'valley-ridge-mx') {
  const track = rigTrack(venue), point = track.at(35, trackPoint()),
    gradient = world(grade, cross, heading), sample = track.sample.bind(track);
  const spy = vi.spyOn(track, 'sample').mockImplementation((x, z, out, hint) => {
    sample(x, z, out, hint);
    out.height = point.y + gradient.x * (x - point.x) + gradient.z * (z - point.z);
    out.normal.set(-gradient.x, 1, -gradient.z).normalize();
    return out;
  });
  return { track, point, restore: () => spy.mockRestore() };
}

interface PrivateMotion {
  playerMotocross: boolean;
  flightSpeed: number;
  mxYawRate: number;
  mxReferenceSpeed: number;
}
const motion = (bike: DirtBikeVehicle) => bike as unknown as PrivateMotion;
const playerCases = [MX_250, MX_450].flatMap(definition => (['raw', 'sport'] as Assist[])
  .map(assist => ({ definition, assist, id: definition.id })));

describe('motocross forward-only planar projection', () => {
  it('preserves the complete default result exactly at zero pitch, with omitted or identity projection', () => {
    for (const lean of [undefined, 0, 0.45]) for (const gravity of [undefined, 0, -0, 1.2]) {
      const p = { ...parameters(), lean, steer: 0.22, lateralGravity: gravity,
        frontBrakeTorque: 600, rearBrakeTorque: 400, rearEngineBrakeTorque: 100 };
      const start = { ...initial(), lateralSpeed: -2.3, yawRate: 0.8, heading: -1.4 };
      const original = stepGround(start, p, DT);
      expect(stepGround(start, { ...p, forwardProjection: undefined }, DT)).toEqual(original);
      expect(stepGround(start, { ...p, forwardProjection: 1 }, DT)).toEqual(original);
      expect(stepGround(start, { ...p, forwardProjection: Math.cos(0) }, DT)).toEqual(original);
      expect(stepGround(start, { ...p, forwardProjection: Math.cos(-0) }, DT)).toEqual(original);
    }
  });

  it('integrates coasting forward and sideways velocity independently on mirrored grades and headings', () => {
    const p = { ...parameters(), frontMu: 0, rearMu: 0 };
    for (const grade of [-0.75, -0.3, 0, 0.3, 0.75])
      for (const heading of [-2.4, -0.4, 0, 1.2, Math.PI])
        for (const speed of [0, 16]) for (const lateralSpeed of [-3, 0, 3]) {
          const projection = 1 / Math.hypot(1, grade),
            start = { ...initial(speed), lateralSpeed, heading },
            velocity = world(speed * projection, lateralSpeed, heading),
            result = stepGround(start, { ...p, forwardProjection: projection }, 1 / 30);
          expect(result.dx).toBeCloseTo(velocity.x / 30, 13);
          expect(result.dz).toBeCloseTo(velocity.z / 30, 13);
          expect(result.longitudinal).toBe(0);
          expect(result.lateralAcceleration).toBe(0);
          expect(result.front.slipPower + result.rear.slipPower).toBe(0);
          expect(energy(result, p)).toBe(energy(start, p));
        }
  });

  it('projects each yawed and cambered microstep, including signed slides, rather than its final heading', () => {
    for (const lean of [undefined, 0, 0.45]) for (const side of [-1, 1])
      for (const grade of [-0.75, 0.75]) for (const heading of [-2.1, 0.8]) {
        const p = { ...parameters(), lean, steer: side * 0.22,
          frontBrakeTorque: 120, rearBrakeTorque: 80 },
          start = { ...initial(), lateralSpeed: side * 3, yawRate: side * 0.8, heading },
          projection = 1 / Math.hypot(1, grade), dt = 1 / 30,
          reference = integratedVelocity(start, p, dt, projection),
          result = stepGround(start, { ...p, forwardProjection: projection }, dt);
        expect(result.dx).toBeCloseTo(reference.x, 13);
        expect(result.dz).toBeCloseTo(reference.z, 13);
        for (const key of ['speed', 'lateralSpeed', 'heading', 'yawRate', 'frontOmega', 'rearOmega'] as const)
          expect(result[key]).toBe(reference.state[key]);
        const old = stepGround(start, p, dt);
        // A whole-vector cosine measurably contracts the horizontal slide.
        expect(Math.hypot(reference.x - old.dx * projection, reference.z - old.dz * projection))
          .toBeGreaterThan(0.01);
        expect(mechanical(result)).toEqual(mechanical(old));
      }
  });

  it('changes no acceleration, contact force, rotor work, gravity work or mechanical energy', () => {
    for (const lean of [undefined, 0, 0.4]) for (const gravity of [-2.1, 0, 2.1]) {
      const p = { ...parameters(), lean, steer: -0.2, lateralGravity: gravity,
        driveTorque: 100, frontBrakeTorque: 230, rearBrakeTorque: 160,
        rearEngineBrakeTorque: 60, drag: 45, slope: -1.1 };
      let original: MxGroundState = { ...initial(), lateralSpeed: 1.5, yawRate: -0.6 },
        projected = original;
      for (let tick = 0; tick < 30; tick++) {
        const a = stepGround(original, p, DT),
          b = stepGround(projected, { ...p, forwardProjection: 0.8 }, DT);
        expect(mechanical(b)).toEqual(mechanical(a));
        expect(energy(b, p)).toBe(energy(a, p));
        original = a;
        projected = b;
      }
    }
  });

  it('retains forward-only slope travel and permits an exactly zero forward projection without dropping slide', () => {
    const p = { ...parameters(), frontMu: 0, rearMu: 0 },
      start = { ...initial(), heading: 1.3 };
    const unprojected = stepGround(start, p, DT), projection = Math.cos(0.6),
      projected = stepGround(start, { ...p, forwardProjection: projection }, DT);
    expect(projected.dx).toBeCloseTo(unprojected.dx * projection, 14);
    expect(projected.dz).toBeCloseTo(unprojected.dz * projection, 14);
    const sideways = stepGround({ ...start, lateralSpeed: -3 }, { ...p, forwardProjection: 0 }, DT),
      expected = world(0, -3, start.heading);
    expect(sideways.dx).toBeCloseTo(expected.x * DT, 14);
    expect(sideways.dz).toBeCloseTo(expected.z * DT, 14);
    expect(sideways.speed).toBe(start.speed);
  });
});

describe('public motocross planar transport', () => {
  it.each(playerCases)('$id $assist has finite-difference motion matching its represented world velocity', ({ definition, assist }) => {
    for (const grade of [-0.6, 0, 0.6]) for (const heading of [-2.2, 0.7])
      for (const lateral of [-3, 3]) {
        const terrain = plane(grade, 0.2, heading);
        try {
          const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, definition), dt = 1e-6;
          bike.placeFree(terrain.track, terrain.point.x, terrain.point.z, heading, terrain.point.y);
          bike.dynamics.speed = 12;
          bike.slide = lateral;
          bike.vy = 12 * Math.sin(bike.groundPitch) + 0.2 * lateral;
          const before = world(12 * Math.cos(Math.atan(grade)), lateral, heading),
            x = bike.dynamics.x, z = bike.dynamics.z;
          bike.step(dt, terrain.track);
          expect(motion(bike).playerMotocross).toBe(true);
          expect(bike.riding && !bike.airborne).toBe(true);
          expect(Math.hypot(bike.dynamics.x - x - before.x * dt,
            bike.dynamics.z - z - before.z * dt)).toBeLessThan(2e-10);
          expect(Math.hypot(bike.dynamics.x - x - bike.body.velocity.x * dt,
            bike.dynamics.z - z - bike.body.velocity.z * dt)).toBeLessThan(2e-10);
        } finally { terrain.restore(); }
      }
  });

  it.each(playerCases)('$id $assist transports actual loaded solver microsteps at ordinary tick rates', ({ definition, assist }) => {
    for (const dt of [1 / 120, 1 / 240, 1 / 480]) for (const sign of [-1, 1]) {
      const heading = sign * 1.7, grade = sign * 0.6,
        terrain = plane(grade, 0, heading);
      try {
        const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, definition);
        bike.placeFree(terrain.track, terrain.point.x, terrain.point.z, heading, terrain.point.y);
        bike.dynamics.speed = 12;
        bike.frontSpin = 12 / definition.bike!.frontWheelRadius;
        bike.rearSpin = 12 / definition.bike!.rearWheelRadius;
        bike.slide = sign * 2.4;
        bike.vy = 12 * Math.sin(bike.groundPitch);
        bike.dynamics.lean = sign * 0.2;
        bike.input.steer = sign * 0.2;
        motion(bike).mxReferenceSpeed = 12;
        motion(bike).mxYawRate = sign * 0.7;
        const x = bike.dynamics.x, z = bike.dynamics.z, projection = Math.cos(bike.groundPitch);
        let oracle: ReturnType<typeof integratedVelocity> | undefined;
        const spy = vi.spyOn(ground, 'stepMotocrossGround').mockImplementation((start, p, duration) => {
          expect(p.forwardProjection).toBe(projection);
          // This heading is aligned with the plane's rise, so its supported
          // cross gravity is zero apart from normal/trigonometric roundoff.
          expect(Math.abs(p.lateralGravity ?? 0)).toBeLessThan(1e-12);
          oracle = integratedVelocity(start, { ...p, lateralGravity: 0 }, duration, projection);
          return stepGround(start, p, duration);
        });
        try { bike.step(dt, terrain.track); } finally { spy.mockRestore(); }
        expect(oracle).toBeDefined();
        expect(bike.riding && !bike.airborne).toBe(true);
        expect(bike.dynamics.x).toBeCloseTo(x + oracle!.x, 11);
        expect(bike.dynamics.z).toBeCloseTo(z + oracle!.z, 11);
        expect(Math.abs(bike.heading - heading)).toBeGreaterThan(1e-5);
      } finally { terrain.restore(); }
    }
  });

  it('preserves the exact legacy core projection and separate slide for AI, supermoto and non-MX courses', () => {
    for (const [definition, venue, ai] of [
      [MX_250, 'valley-ridge-mx', true], [MX_450, 'valley-ridge-mx', true],
      [SM_450, 'valley-ridge-mx', false], [MX_250, 'aurel', false], [MX_450, 'kestrel-rx', false],
    ] as const) {
      const heading = 0.7, terrain = plane(0.45, 0, heading, venue);
      try {
        const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', definition);
        if (ai) bike.aiControlled(10);
        bike.placeFree(terrain.track, terrain.point.x, terrain.point.z, heading, terrain.point.y);
        bike.dynamics.speed = 10;
        bike.slide = 1;
        bike.vy = 10 * Math.sin(bike.groundPitch);
        const d = bike.dynamics, x = d.x, z = d.z, projection = Math.cos(bike.groundPitch),
          original = d.step.bind(d);
        let coreX = NaN, coreZ = NaN;
        const spy = vi.spyOn(d, 'step').mockImplementation((...args) => {
          original(...args);
          coreX = d.x;
          coreZ = d.z;
        });
        try { bike.step(DT, terrain.track); } finally { spy.mockRestore(); }
        expect(motion(bike).playerMotocross).toBe(false);
        expect(bike.riding && !bike.airborne).toBe(true);
        expect(d.x).toBe(x + (coreX - x) * projection + Math.cos(d.heading) * bike.slide * DT);
        expect(d.z).toBe(z + (coreZ - z) * projection - Math.sin(d.heading) * bike.slide * DT);
      } finally { terrain.restore(); }
    }
  });

  it.each([MX_250, MX_450])('$id keeps flight travel horizontal through chassis yaw above either grade', definition => {
    for (const grade of [-0.6, 0.6]) {
      const heading = -1.3, terrain = plane(grade, 0.2, heading);
      try {
        const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition);
        bike.placeFree(terrain.track, terrain.point.x, terrain.point.z, heading, terrain.point.y);
        bike.airborne = true;
        bike.cgY += 6;
        bike.forceFront = bike.forceRear = 0;
        bike.dynamics.speed = motion(bike).flightSpeed = 12;
        bike.slide = -2;
        bike.airYaw = 0.3;
        bike.airYawRate = 0.4;
        const d = bike.dynamics, x = d.x, z = d.z, k = d.p.drag / d.mass,
          distance = Math.log1p(k * 12 * DT) / k,
          expected = world(distance, -2 * DT, heading);
        bike.step(DT, terrain.track);
        expect(bike.riding && bike.airborne).toBe(true);
        expect(d.heading).toBe(heading);
        expect(bike.airYaw).not.toBe(0.3);
        expect(d.x).toBeCloseTo(x + expected.x, 11);
        expect(d.z).toBeCloseTo(z + expected.z, 11);
        const velocity = world(12 / (1 + k * 12 * DT), -2, heading);
        expect(bike.body.velocity.x).toBeCloseTo(velocity.x, 11);
        expect(bike.body.velocity.z).toBeCloseTo(velocity.z, 11);
      } finally { terrain.restore(); }
    }
  });
});
