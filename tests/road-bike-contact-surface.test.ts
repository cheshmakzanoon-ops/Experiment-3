import { describe, expect, it, vi } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { BikeVehicle } from '../src/simulation/bike-vehicle.ts';
import { DEFAULT_OPTIONS } from '../src/simulation/config.ts';
import { surfaceSample, trackPoint } from '../src/simulation/track.ts';
import { Simulation } from '../src/simulation/world.ts';

const DT = 1 / 120;

/** These are actual inside bends on a graded circuit. The nearest polyline
 * station changes discontinuously there; using its analytic height as a
 * damper input created centimetre steps in an otherwise continuous ribbon. */
describe('road-bike continuous collision support', () => {
  it.each([
    [1115.34, 3],
    [2531.02, 3.5],
    [3130.88, 3.5],
  ])('uses the collision ribbon for force and pose at Ardennes station %s', (station, lateral) => {
    const sim = new Simulation({
      ...DEFAULT_OPTIONS,
      mode: 'practice',
      circuit: 'ardennes',
      opponents: 0,
      vehicles: ['gpr1'],
    });
    sim.track.windX = sim.track.windZ = 0;
    const bike = sim.cars[0] as BikeVehicle,
      d = bike.dynamics,
      p = sim.track.at(station - bike.bikeSpec.cgToFront - 0.1, trackPoint()),
      origin = new Vec3(),
      down = new Vec3(0, -1, 0),
      cast = surfaceSample(),
      analytic = surfaceSample();
    bike.placeFree(
      sim.track,
      p.x + p.nx * lateral,
      p.z + p.nz * lateral,
      Math.atan2(p.tx, p.tz),
      p.y + p.bank * lateral,
    );
    d.speed = 15;
    const support = vi.spyOn(bike.roadSuspension, 'step');
    let analyticMismatch = 0;
    const height = (x: number, z: number) => {
      sim.track.sample(x, z, analytic, p.y);
      origin.set(x, analytic.height + 1, z);
      expect(Number.isFinite(sim.track.cast(origin, down, 2, cast))).toBe(true);
      analyticMismatch = Math.max(analyticMismatch, Math.abs(cast.height - analytic.height));
      return cast.height;
    };
    for (let i = 0; i < 12; i++) {
      const sh = Math.sin(d.heading),
        ch = Math.cos(d.heading),
        side = d.motoGP?.lateralSpeed ?? 0,
        vx = sh * d.speed + ch * side,
        vz = ch * d.speed - sh * side,
        frontX = d.x + sh * bike.bikeSpec.cgToFront,
        frontZ = d.z + ch * bike.bikeSpec.cgToFront,
        rearX = d.x - sh * bike.bikeSpec.cgToRear,
        rearZ = d.z - ch * bike.bikeSpec.cgToRear,
        expected = [
          height(frontX, frontZ),
          height(rearX, rearZ),
          height(frontX + vx * DT, frontZ + vz * DT),
          height(rearX + vx * DT, rearZ + vz * DT),
        ];
      bike.step(DT, sim.track);
      const q = support.mock.calls.at(-1)![0];
      for (const [index, actual] of [
        q.frontHeight,
        q.rearHeight,
        q.nextFrontHeight,
        q.nextRearHeight,
      ].entries())
        expect(actual).toBeCloseTo(expected[index], 8);
      for (const index of [0, 2]) {
        const point = bike.contactPoints[index];
        expect(bike.contacts[index].height).toBeCloseTo(height(point.x, point.z), 8);
        expect(point.y).toBeCloseTo(bike.contacts[index].height, 10);
      }
      expect(bike.riding).toBe(true);
    }
    // The fixture must exercise the original failure, rather than accidentally
    // traversing a flat region where either query would produce the same height.
    expect(analyticMismatch).toBeGreaterThan(0.002);
    support.mockRestore();
  });
});
