import { describe, expect, it, vi } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { G } from '../src/core/math.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { DEFAULT_SETUP } from '../src/simulation/config.ts';
import { DirtBikeVehicle, type LandingRecord } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import { rideLine, rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { factoryBikeSag } from '../src/simulation/offroad/suspension-geometry.ts';
import { offroadCourse } from '../src/simulation/offroad/venues.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

/** Only the post-flight resolution varies. Every run reaches the identical
 * checkpoint through the real 120 Hz approach, takeoff and controlled arc. */
function tabletop(hz: number) {
  const track = rigTrack('arena-nord-sx'),
    jump = offroadCourse(track.circuit)!.jumps.find(item => item.name === 'TABLETOP')!,
    bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'sport', MX_450), speed = 13;
  bike.place(track, jump.start - 12);
  bike.dynamics.speed = speed;
  bike.gear = 3;
  const approach = () => {
    if (!bike.airborne) rideLine(bike, track,
      bike.s >= jump.start - 1 && bike.s <= jump.takeoff + 1
        ? Math.max(speed, bike.dynamics.speed) : speed);
  };
  for (let tick = 0; tick < 6 * 120 && !(bike.airborne && bike.airTime > 1.3); tick++) {
    approach();
    bike.step(1 / 120, track);
  }
  expect(bike.airborne).toBe(true);
  expect(bike.airTime).toBeGreaterThan(1.3);
  const checkpoint = {
    time: bike.clock, airTime: bike.airTime, x: bike.dynamics.x, z: bike.dynamics.z,
    speed: bike.dynamics.speed, y: bike.cgY, vy: bike.vy, pitch: bike.pitch,
    pitchRate: bike.pitchRate, heading: bike.heading, yaw: bike.airYaw,
    yawRate: bike.airYawRate, slide: bike.slide, front: bike.frontSpin, rear: bike.rearSpin,
  };
  let landing: LandingRecord | null = null;
  for (let tick = 0; tick < hz && bike.riding; tick++) {
    approach();
    bike.step(1 / hz, track);
    if (!landing && (bike.lastLanding?.airTime ?? 0) > 1) landing = bike.lastLanding;
    if (landing && bike.clock > landing.time + 0.3) break;
  }
  expect(landing).not.toBeNull();
  return { checkpoint, landing: landing!, riding: bike.riding, crashes: bike.dynamics.crashes };
}

class Plane extends DynamicsTrack {
  override readonly circuit = circuitDefinition('valley-ridge-mx');
}

type State = [y: number, velocity: number, pitch: number, pitchRate: number];
type Internals = {
  vertical(dt: number): void;
  spring(compression: number, front: boolean): number;
  longitudinal: number;
};

/** Independent constitutive equations and a fine fourth-order reference.
 * This intentionally retains the existing reduced pitch arms; it checks
 * time integration, not the separate work-conjugacy limitation. */
function reference(definition: VehicleDefinition, mass: number) {
  const spec = definition.bike!, air = spec.offroad!, sag = factoryBikeSag(definition),
    arms = [spec.cgToFront, -spec.cgToRear],
    heights = [spec.cgHeight + sag.fork, spec.cgHeight + sag.shock],
    travels = [spec.forkTravel, spec.shockTravel],
    stiffness = [spec.forkRate, spec.shockRate], damping = [air.forkDamping, air.shockDamping];
  const forces = ([y, velocity, pitch, rate]: State) => arms.map((arm, i) => {
    const c = -y - arm * Math.sin(pitch) + heights[i] * Math.cos(pitch);
    if (c <= 0) return 0;
    const shaft = -velocity - (arm * Math.cos(pitch) + heights[i] * Math.sin(pitch)) * rate,
      spring = Math.min(c, travels[i]),
      elastic = stiffness[i] * spring * (1 + air.progression * (spring / travels[i]) ** 2),
      damper = damping[i] * shaft * (shaft < 0 ? 2.2 : 1) / (1 + Math.abs(shaft) / air.damperKnee),
      stop = c > travels[i]
        ? 40 * stiffness[i] * (c - travels[i]) + 6 * damping[i] * Math.max(0, shaft) : 0;
    return Math.max(0, elastic + damper + stop);
  });
  const derivative = (state: State): State => {
    const f = forces(state);
    return [state[1], (f[0] + f[1]) / mass - G, state[3],
      (f[0] * arms[0] + f[1] * arms[1]) * Math.cos(state[2]) / air.pitchInertia - 1.5 * state[3]];
  };
  const displaced = (s: State, d: State, h: number) => s.map((value, i) => value + h * d[i]) as State;
  const integrate = (initial: State, dt: number, divisions: number) => {
    let state = initial.slice() as State;
    const h = dt / divisions;
    for (let i = 0; i < divisions; i++) {
      const k1 = derivative(state), k2 = derivative(displaced(state, k1, h / 2)),
        k3 = derivative(displaced(state, k2, h / 2)), k4 = derivative(displaced(state, k3, h));
      state = state.map((value, j) => value + h / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j])) as State;
    }
    return state;
  };
  return { forces, integrate, heights };
}

describe('motocross supported integration accuracy', () => {
  it('converges the same surveyed flat landing without a false 120 Hz crash', () => {
    const runs = [120, 240, 480, 960, 1920, 3840].map(tabletop), fine = runs.at(-1)!;
    for (const run of runs) {
      expect(run.checkpoint).toEqual(fine.checkpoint);
      expect(run.riding).toBe(true);
      expect(run.crashes).toBe(0);
      expect(run.landing.outcome).toBe('bottomed');
      expect(Math.abs(run.landing.normalSpeed - fine.landing.normalSpeed)).toBeLessThan(0.001);
      // The untouched 120 Hz step misses this by 0.414 m/s, despite its
      // already-converged first-contact normal speed. No threshold is tuned.
      expect(Math.abs(run.landing.bottomSpeed - fine.landing.bottomSpeed)).toBeLessThan(0.1);
    }
    expect(Math.abs(runs.at(-2)!.landing.bottomSpeed - fine.landing.bottomSpeed)).toBeLessThan(0.01);
  });

  it.each([MX_250, MX_450])('$id refreshes real supported forces while retaining the outer incoming force timestamp', definition => {
    const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, 'raw', definition),
      track = new Plane(), dt = 1 / 120;
    bike.placeFree(track, 0, 0, 0, 0);
    bike.step(1 / 240, track);
    const model = bike as unknown as Internals,
      oracle = reference(definition, bike.dynamics.mass), spec = definition.bike!;
    // A controlled 8 m/s compression at both stops isolates the two-DOF
    // integration from tyre impulses, terrain motion and rider controls.
    bike.pitch = Math.atan2(oracle.heights[0] - oracle.heights[1], spec.cgToFront + spec.cgToRear);
    bike.cgY = oracle.heights[0] * Math.cos(bike.pitch) - spec.cgToFront * Math.sin(bike.pitch) - 0.29;
    bike.vy = -8;
    bike.pitchRate = 0;
    bike.standing = bike.riderBody = model.longitudinal = 0;
    const initial: State = [bike.cgY, bike.vy, bike.pitch, bike.pitchRate], incoming = oracle.forces(initial),
      fine = oracle.integrate(initial, dt, 8192), finer = oracle.integrate(initial, dt, 16384),
      oldVelocity = initial[1] + ((incoming[0] + incoming[1]) / bike.dynamics.mass - G) * dt,
      spring = model.spring.bind(bike), sampledHeights: number[] = [];
    const spy = vi.spyOn(model, 'spring').mockImplementation((compression, front) => {
      sampledHeights.push(bike.cgY);
      return spring(compression, front);
    });
    try { model.vertical(dt); } finally { spy.mockRestore(); }
    expect(new Set(sampledHeights).size).toBeGreaterThan(1);
    expect(bike.forceFront).toBeCloseTo(incoming[0], 9);
    expect(bike.forceRear).toBeCloseTo(incoming[1], 9);
    expect(bike.compressionFront).toBeCloseTo(0.29, 11);
    expect(bike.compressionRear).toBeCloseTo(0.29, 11);
    expect(Math.abs(fine[1] - finer[1])).toBeLessThan(0.001);
    expect(Math.abs(bike.vy - finer[1])).toBeLessThan(Math.abs(oldVelocity - finer[1]) * 0.75);
    expect(Math.abs(bike.forceFront - oracle.forces([bike.cgY, bike.vy, bike.pitch, bike.pitchRate])[0]))
      .toBeGreaterThan(100);
    expect([bike.cgY, bike.vy, bike.pitch, bike.pitchRate].every(Number.isFinite)).toBe(true);
  });
});
