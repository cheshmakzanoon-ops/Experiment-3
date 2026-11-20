import { beforeAll, describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { TriangleBVH, rayHit } from '../src/simulation/bvh.ts';
import { circuitDefinition } from '../src/simulation/circuits.ts';
import { TrackContactMesh } from '../src/simulation/contact.ts';
import { TrackLaneIndex } from '../src/simulation/track-lane-index.ts';
import { FIGURE_EIGHT_OVERPASS } from '../src/simulation/test-venues.ts';
import { TireFootprint } from '../src/simulation/tire-footprint.ts';
import { SURFACE, Track, surfaceSample, trackPoint } from '../src/simulation/track.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';

const DOWN = new Vec3(0, -1, 0),
  AXLE = new Vec3(1, 0, 0);

/** The upper patch deliberately represents auxiliary geometry. It must be
 * rejected before it can hide the valid lower surface from BVH pruning. */
function overlappingPlanes(owned: boolean) {
  const vertices = new Float64Array([
    -2, 0, -2, 2, 0, -2, -2, 0, 2, 2, 0, 2, -2, 0.2, -2, 2, 0.2, -2, -2, 0.2, 2, 2, 0.2, 2,
  ]);
  return new TriangleBVH(
    vertices,
    new Uint32Array([0, 2, 1, 1, 2, 3, 4, 6, 5, 5, 6, 7]),
    undefined,
    owned ? (_triangle, _x, y) => y < 0.1 : undefined,
  );
}

describe('shared geometric contact ownership', () => {
  it('rejects a nearer auxiliary hit without hiding deeper valid ray contacts', () => {
    const raw = overlappingPlanes(false),
      owned = overlappingPlanes(true),
      hit = rayHit();
    for (const direction of [DOWN, new Vec3(0.2, -1, 0.3).normalize()]) {
      expect(raw.raycast(new Vec3(0, 1, 0), direction, 2, hit)).toBe(true);
      expect(hit.point.y).toBeCloseTo(0.2, 12);
      expect(owned.raycast(new Vec3(0, 1, 0), direction, 2, hit)).toBe(true);
      expect(hit.point.y).toBeCloseTo(0, 12);
      expect(hit.distance).toBeCloseTo(-1 / direction.y, 12);
    }
    expect(owned.raycast(new Vec3(0, -1, 0), new Vec3(0, 1, 0), 2, hit)).toBe(true);
    expect(hit.point.y).toBeCloseTo(0, 12);
    expect(owned.raycast(new Vec3(0, 1, 0), DOWN, 0.9, hit)).toBe(false);
    expect(owned.raycast(new Vec3(5, 1, 0), DOWN, 2, hit)).toBe(false);
  });

  it('applies the same ownership to finite tire faces, edges and vertices', () => {
    const raw = new TireFootprint(overlappingPlanes(false)),
      owned = new TireFootprint(overlappingPlanes(true)),
      hit = rayHit();
    for (const [x, z] of [
      [0, 0],
      [2.02, 0],
      [2.02, 2.02],
    ]) {
      const origin = new Vec3(x, 1, z);
      expect(raw.cast(origin, DOWN, 2, 0.3, 0.1, AXLE, Infinity, hit)).toBe(true);
      expect(hit.point.y).toBeCloseTo(0.2, 12);
      const falseDistance = hit.distance;
      expect(owned.cast(origin, DOWN, 2, 0.3, 0.1, AXLE, Infinity, hit)).toBe(true);
      expect(hit.point.y).toBeCloseTo(0, 12);
      expect(hit.distance - falseDistance).toBeCloseTo(0.2, 12);
    }
  });
});

describe('actual circuit road ownership at overlapping runoff ribbons', () => {
  let track: Track, mesh: TrackContactMesh, raw: TriangleBVH;
  beforeAll(() => {
    track = new Track('clear', false, undefined, circuitDefinition('ardennes'));
    mesh = new TrackContactMesh(track);
    raw = new TriangleBVH(mesh.vertices, mesh.indices, mesh.normals);
  });

  it('rejects the upstream runoff that created a 13.8 cm step on the Hilltop exit', () => {
    // Front contact from the unchanged seed1000 race at t=21.708333 seconds.
    const origin = new Vec3(596.7179217552888, 4.4, 1154.1124977119468),
      hit = rayHit(),
      surface = surfaceSample(),
      p = trackPoint();
    expect(raw.raycast(origin, DOWN, 2, hit)).toBe(true);
    const rawHeight = hit.point.y,
      row = Math.floor(hit.triangle / 28),
      band = Math.floor(hit.triangle / 2) % 14;
    expect(band).toBe(13);
    track.at((row * track.length) / mesh.rows, p);
    expect(p.s).toBeGreaterThan(309);
    expect(p.s).toBeLessThan(312);
    expect(Math.hypot(origin.x - p.x, origin.z - p.z)).toBeGreaterThan(33);
    expect(Number.isFinite(mesh.cast(origin, DOWN, 2, surface))).toBe(true);
    expect(surface.s).toBeGreaterThan(362);
    expect(surface.s).toBeLessThan(363);
    expect(surface.surface).toBe(SURFACE.ASPHALT);
    expect(surface.height).toBeCloseTo(3.3190813810431576, 9);
    expect(rawHeight - surface.height).toBeGreaterThan(0.13);
    expect(rawHeight - surface.height).toBeLessThan(0.15);
  });

  it('keeps the exact exit sweep continuous and resolves the same road for a car tire', () => {
    const p = trackPoint(),
      surface = surfaceSample(),
      origin = new Vec3(),
      axle = new Vec3(),
      point = new Vec3();
    let previous = NaN,
      largestStep = 0,
      largestAnalyticDifference = 0,
      rejectedHeight = 0;
    const hit = rayHit();
    for (let i = 0; i <= 400; i++) {
      track.at(359 + i * 0.02, p);
      origin.set(p.x + p.nx * 0.4, p.y + 1, p.z + p.nz * 0.4);
      expect(Number.isFinite(mesh.cast(origin, DOWN, 2, surface))).toBe(true);
      const height = surface.height,
        rayLength = origin.y - height,
        normalY = surface.normal.y;
      if (Number.isFinite(previous))
        largestStep = Math.max(largestStep, Math.abs(height - previous));
      previous = height;
      largestAnalyticDifference = Math.max(
        largestAnalyticDifference,
        Math.abs(height - p.y - p.bank * 0.4),
      );
      expect(raw.raycast(origin, DOWN, 2, hit)).toBe(true);
      rejectedHeight = Math.max(rejectedHeight, hit.point.y - height);
      axle.set(p.nx, 0, p.nz);
      const wheelLength = mesh.castTire(origin, DOWN, 2, 0.335, 0.13, axle, surface, point);
      expect(wheelLength).toBeCloseTo(rayLength - 0.335 / normalY, 9);
      expect(point.y).toBeCloseTo(height, 9);
      expect(mesh.tireFootprint.trianglesTested).toBeLessThan(150);
    }
    expect(largestStep).toBeLessThan(0.001);
    expect(largestAnalyticDifference).toBeLessThan(0.001);
    // The old broad ribbon really crosses this path; a flat harmless sweep
    // would not establish that the regression is exercised.
    expect(rejectedHeight).toBeGreaterThan(0.15);
  });

  it('retains both legitimate nearby road legs, kerbs, shoulders and outer runoff', () => {
    const p = trackPoint(),
      surface = surfaceSample(),
      hit = rayHit();
    for (const station of [80, 310, 362, 3130]) {
      track.at(station, p);
      for (const side of [-1, 1]) {
        // Far runoff at s80 is clear of neighbouring roads. Around the
        // hairpins, prove the two actual paved legs remain available.
        const offsets = station === 80 ? [0, p.width + 0.55, p.width + 2, p.width + 6] : [0];
        for (const offset of offsets) {
          const origin = new Vec3(p.x + p.nx * offset * side, p.y + 2, p.z + p.nz * offset * side);
          expect(raw.raycast(origin, DOWN, 4, hit)).toBe(true);
          const rawHeight = hit.point.y;
          expect(Number.isFinite(mesh.cast(origin, DOWN, 4, surface))).toBe(true);
          if (station === 80) expect(surface.height).toBeCloseTo(rawHeight, 10);
          else {
            expect(surface.surface).toBe(SURFACE.ASPHALT);
            expect(Math.abs(surface.height - p.y)).toBeLessThan(0.001);
          }
          expect(surface.normal.finite()).toBe(true);
        }
      }
    }
  });

  it('tests oblique road contacts at their hit point and retains the finite ribbon boundary', () => {
    const target = new Vec3(596.7179217552888, 3.3190813810431576, 1154.1124977119468),
      direction = new Vec3(-0.4, -1, 0.2).normalize(),
      origin = new Vec3().copy(target).addScaled(direction, -1.5),
      surface = surfaceSample();
    expect(mesh.cast(origin, direction, 2, surface)).toBeCloseTo(1.5, 9);
    expect(surface.height).toBeCloseTo(target.y, 9);
    expect(mesh.cast(new Vec3(1e6, 100, 1e6), DOWN, 200, surface)).toBe(Infinity);
  });

  it('keeps all four production car contacts on the local road through the former step', () => {
    const car = new Vehicle(0),
      p = track.at(355, trackPoint()),
      sample = surfaceSample(),
      previous = new Float64Array(4).fill(NaN);
    car.place(track, 355, 0.4);
    car.input.brake = 1;
    for (let i = 0; i < 240; i++) car.step(1 / 240, track);
    car.input.brake = 0;
    car.body.velocity.set(p.tx * 16, p.gradient * 16, p.tz * 16);
    for (const tire of car.tires) tire.omega = 16 / tire.radius;
    let largestStep = 0,
      largestMismatch = 0,
      supported = 0;
    for (let i = 0; i < 300; i++) {
      car.step(1 / 240, track);
      expect(car.body.position.finite()).toBe(true);
      for (let wheel = 0; wheel < 4; wheel++) {
        const point = car.contactPoints[wheel],
          height = car.contacts[wheel].height;
        track.sample(point.x, point.z, sample, point.y);
        largestMismatch = Math.max(largestMismatch, Math.abs(height - sample.height));
        if (Number.isFinite(previous[wheel]))
          largestStep = Math.max(largestStep, Math.abs(height - previous[wheel]));
        previous[wheel] = height;
        if (car.tires[wheel].load > 0) supported++;
      }
    }
    expect(car.s).toBeGreaterThan(370);
    expect(largestStep).toBeLessThan(0.003);
    expect(largestMismatch).toBeLessThan(0.001);
    expect(supported).toBe(1200);
  });
});

describe('real stacked road contact remains geometric', () => {
  it('retains both nine-metre-separated decks and their tire support', () => {
    const track = new Track('clear', false, undefined, FIGURE_EIGHT_OVERPASS),
      mesh = new TrackContactMesh(track, 2048),
      raw = new TriangleBVH(mesh.vertices, mesh.indices, mesh.normals),
      hit = rayHit(),
      surface = surfaceSample(),
      point = new Vec3();
    for (const y of [1, 10]) {
      const origin = new Vec3(0, y, 0);
      expect(raw.raycast(origin, DOWN, 2, hit)).toBe(true);
      const expected = hit.point.y;
      expect(Number.isFinite(mesh.cast(origin, DOWN, 2, surface))).toBe(true);
      expect(surface.height).toBeCloseTo(expected, 10);
      expect(Math.abs(surface.height - (y - 1))).toBeLessThan(0.02);
      expect(
        Number.isFinite(mesh.castTire(origin, DOWN, 2, 0.335, 0.13, AXLE, surface, point)),
      ).toBe(true);
      expect(Math.abs(point.y - expected)).toBeLessThan(0.001);
    }
    expect(mesh.cast(new Vec3(0, 10, 0), DOWN, 12, surface)).toBeCloseTo(1, 2);
    expect(surface.height).toBeGreaterThan(8.9);
  });
});

it('narrows GP centreline searches only when a nearby segment is on the queried road layer', () => {
  const p = [
    { x: 0, y: 0, z: 0 },
    { x: 4, y: 0, z: 0 },
    { x: 20, y: 8, z: 0 },
    { x: 24, y: 8, z: 0 },
  ].map((v) => ({ ...trackPoint(), ...v }));
  const coarse = [0, 2];
  const index = new TrackLaneIndex(p, 2);
  expect(index.candidates(1, 0, coarse, 0, 4)).toEqual([0]);
  expect(index.candidates(1, 0, coarse, 7.8, 4)).toBe(coarse);
  expect(index.candidates(1, 0, coarse, 4, 4)).toBe(coarse);
  expect(index.candidates(23, 0, coarse, 8, 4)).toEqual([2]);
  expect(index.candidates(23, 0, coarse, 0, 4)).toBe(coarse);
  p[1].y = 6;
  expect(index.candidates(1, 0, coarse, 0, 4)).toBe(coarse);
  for (const x of [-40, 44, 84]) index.candidates(x, 0, coarse);
  expect(index.candidates(1, 0, coarse, 7.8, 4)).toBe(coarse);
});
