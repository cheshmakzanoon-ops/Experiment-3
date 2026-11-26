import { describe, expect, it } from 'vitest';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { DEFAULT_SETUP, type Assist } from '../src/simulation/config.ts';
import { DirtBikeVehicle } from '../src/simulation/offroad/dirt-bike-vehicle.ts';
import { MX_250, MX_450 } from '../src/simulation/offroad/dirt-bikes.ts';
import type { SurfaceSample, Track } from '../src/simulation/track.ts';
import type { VehicleDefinition } from '../src/simulation/vehicles.ts';

/** Smooth analytical height fields isolate transport from authored geometry. */
class Profile extends DynamicsTrack {
  override readonly circuit = circuitDefinition('arena-nord-sx');
  constructor(readonly grade: number, readonly curvature: number, readonly heading = 0) { super(); }
  override sample(x: number, z: number, out: SurfaceSample) {
    super.sample(x, z, out);
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading),
      along = sin * x + cos * z, across = cos * x - sin * z,
      slope = this.grade + this.curvature * along;
    out.height = this.grade * along + 0.5 * this.curvature * along ** 2 + 0.2 * across;
    out.normal.set(-slope * sin - 0.2 * cos, 1, -slope * cos + 0.2 * sin).normalize();
    // No contact means even substantial soil resistance must be inactive.
    out.resistance = 0.12;
    return out;
  }
}
interface Internals {
  mxReferenceSpeed: number;
  mxYawRate: number;
  freeSteps: number;
  writeBody(track: Track, dt: number): void;
}
const internal = (bike: DirtBikeVehicle) => bike as unknown as Internals;
const cases = [MX_250, MX_450].flatMap(definition => (['raw', 'sport'] as Assist[])
  .map(assist => ({ definition, assist, id: definition.id })));
function fixture(definition: VehicleDefinition, assist: Assist, track: Profile, speed = 12, yaw = 0) {
  const bike = new DirtBikeVehicle(0, 'medium', DEFAULT_SETUP, assist, definition);
  bike.placeFree(track, 0, 0, track.heading, 0);
  bike.step(1e-6, track);
  // A prescribed, fully extended free state at the start of the ordinary
  // launch debounce. The public step resolves all subsequent motion.
  bike.cgY = 5;
  bike.vy = 2;
  bike.pitch = bike.pitchRate = 0;
  bike.forceFront = bike.forceRear = 0;
  bike.slide = 1.25;
  bike.dynamics.speed = speed / Math.cos(bike.groundPitch);
  bike.dynamics.p.drag = 0;
  bike.dynamics.p.rolling = 0.08;
  bike.input.throttle = bike.input.brake = bike.input.clutch = bike.input.steer = 0;
  const state = internal(bike);
  state.mxReferenceSpeed = bike.dynamics.speed;
  state.mxYawRate = yaw;
  state.freeSteps = 0;
  state.writeBody(track, 0);
  return bike;
}
const horizontal = (bike: DirtBikeVehicle) => ({ x: bike.body.velocity.x, z: bike.body.velocity.z });

describe('motocross ground-coordinate transport', () => {
  it.each(cases)('$id $assist changes its sampled slope basis without changing world momentum',
    ({ definition, assist }) => {
      for (const heading of [-1.2, 0, 2.4]) for (const loaded of [false, true]) {
        const track = new Profile(0.3, 0.8, heading), bike = fixture(definition, assist, track);
        if (loaded) bike.forceFront = bike.forceRear = bike.dynamics.mass * 9.81 / 2;
        const state = internal(bike), before = horizontal(bike), oldPitch = bike.groundPitch,
          oldReference = state.mxReferenceSpeed * Math.cos(oldPitch),
          rotations = [bike.frontSpin, bike.rearSpin], vertical = [bike.vy, bike.pitchRate];
        // A position already advanced by the physical solver now queries a
        // different terrain chord. Sampling itself cannot apply an impulse.
        bike.dynamics.x += Math.sin(heading) * 0.6;
        bike.dynamics.z += Math.cos(heading) * 0.6;
        state.writeBody(track, 0);
        expect(Math.abs(bike.groundPitch - oldPitch)).toBeGreaterThan(0.2);
        expect(bike.body.velocity.x).toBeCloseTo(before.x, 11);
        expect(bike.body.velocity.z).toBeCloseTo(before.z, 11);
        expect(state.mxReferenceSpeed * Math.cos(bike.groundPitch)).toBeCloseTo(oldReference, 11);
        expect([bike.frontSpin, bike.rearSpin]).toEqual(rotations);
        expect([bike.vy, bike.pitchRate]).toEqual(vertical);
      }
    });

  it.each(cases)('$id $assist keeps unsupported translation free of ground gravity and resistance during launch debounce',
    ({ definition, assist }) => {
      for (const sign of [-1, 1]) for (const hz of [120, 240, 480]) for (const yaw of [0, -0.7, 0.7]) {
        const dt = 1 / hz, track = new Profile(sign * 0.45, sign * 0.7, sign * 0.8),
          bike = fixture(definition, assist, track, 12, yaw), initial = horizontal(bike),
          x = bike.dynamics.x, z = bike.dynamics.z,
          specificEnergy = (initial.x ** 2 + initial.z ** 2) / 2;
        for (let tick = 1; tick <= 3; tick++) {
          bike.step(dt, track);
          expect([bike.forceFront, bike.forceRear]).toEqual([0, 0]);
          expect(bike.airborne).toBe(tick === 3);
          expect(bike.body.velocity.x).toBeCloseTo(initial.x, 10);
          expect(bike.body.velocity.z).toBeCloseTo(initial.z, 10);
          expect(bike.dynamics.x).toBeCloseTo(x + initial.x * dt * tick, 10);
          expect(bike.dynamics.z).toBeCloseTo(z + initial.z * dt * tick, 10);
          expect((bike.body.velocity.x ** 2 + bike.body.velocity.z ** 2) / 2).toBeCloseTo(specificEnergy, 9);
          expect([bike.dynamics.driveForce, bike.dynamics.frontBrakeForce, bike.dynamics.rearBrakeForce])
            .toEqual([0, 0, 0]);
          expect(bike.tires.every(tire => tire.fx === 0 && tire.fy === 0 && tire.energy === 0)).toBe(true);
        }
      }
    });
});
