import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { TriangleBVH, rayHit } from '../src/simulation/bvh.ts';
import { TireFootprint } from '../src/simulation/tire-footprint.ts';
import { TrackContactMesh } from '../src/simulation/contact.ts';
import { Track, SURFACE, surfaceSample, trackPoint } from '../src/simulation/track.ts';
import { Vehicle } from '../src/simulation/vehicle.ts';
import { DynamicsTrack } from '../scripts/dynamics-fixtures.ts';

const RADIUS = 0.335,
  HALF_WIDTH = 0.18,
  DOWN = new Vec3(0, -1, 0),
  AXLE = new Vec3(1, 0, 0);

function plane(slope = 0, grade = 0, height = 0) {
  const vertices = [-10, -10, 10, -10, -10, 10, 10, 10].flatMap((value, i, values) =>
    i % 2 === 0 ? [value, height + slope * value + grade * values[i + 1], values[i + 1]] : [],
  );
  return new TriangleBVH(new Float64Array(vertices), new Uint32Array([0, 2, 1, 1, 2, 3]));
}
function raisedEdge(height = 0.06, reverse = false) {
  const sign = reverse ? -1 : 1;
  return new TriangleBVH(
    new Float64Array([
      -10,
      height,
      0,
      10,
      height,
      0,
      -10,
      height,
      10 * sign,
      10,
      height,
      10 * sign,
    ]),
    new Uint32Array([0, 2, 1, 1, 2, 3]),
  );
}
function query(
  footprint: TireFootprint,
  origin: Vec3,
  prior = Infinity,
  maximum = 1.5,
  axle = AXLE,
  down = DOWN,
) {
  const hit = rayHit();
  const found = footprint.cast(origin, down, maximum, RADIUS, HALF_WIDTH, axle, prior, hit);
  return { found, hit };
}

describe('continuous finite tire-crown contact', () => {
  it('matches independent ellipsoid-plane support under bank, grade and camber', () => {
    for (const [slope, grade] of [
      [0, 0],
      [0.2, 0],
      [0, -0.17],
      [-0.3, 0.22],
    ]) {
      const footprint = new TireFootprint(plane(slope, grade)),
        normal = new Vec3(-slope, 1, -grade).normalize();
      for (const axle of [AXLE, new Vec3(0.94, -0.12, 0.31).normalize()]) {
        const origin = new Vec3(0.7, 1, -0.9),
          support = Math.sqrt(
            RADIUS ** 2 + (HALF_WIDTH ** 2 - RADIUS ** 2) * axle.dot(normal) ** 2,
          ),
          expected = (origin.dot(normal) - support) / normal.y,
          { found, hit } = query(footprint, origin, Infinity, 1.5, axle);
        expect(found).toBe(true);
        expect(hit.distance).toBeCloseTo(expected, 11);
        expect(hit.point.y).toBeCloseTo(slope * hit.point.x + grade * hit.point.z, 11);
        expect(hit.normal.distanceSq(normal)).toBeLessThan(1e-20);
        const radial = new Vec3().copy(hit.point).sub(origin).addScaled(DOWN, -hit.distance),
          lateral = radial.dot(axle);
        expect(
          radial.dot(radial) / RADIUS ** 2 + lateral ** 2 * (1 / HALF_WIDTH ** 2 - 1 / RADIUS ** 2),
        ).toBeCloseTo(1, 11);
      }
    }
  });

  it('preserves the original planar centre-ray support and prunes unnecessary feature tests', () => {
    for (const [slope, grade] of [
      [0, 0],
      [0.12, 0.3],
      [-0.7, 0.2],
    ]) {
      const footprint = new TireFootprint(plane(slope, grade)),
        normal = new Vec3(-slope, 1, -grade).normalize(),
        length = 1 - RADIUS / normal.y,
        { found, hit } = query(footprint, new Vec3(0, 1, 0), length);
      expect(found).toBe(false);
      expect(hit.distance).toBe(length);
      expect(footprint.featureTests).toBe(0);
    }
  });

  it.each([false, true])(
    'rolls continuously onto a curb before the centre ray crosses (reverse=%s)',
    (reverse) => {
      const height = 0.06,
        footprint = new TireFootprint(raisedEdge(height, reverse)),
        sign = reverse ? -1 : 1,
        onset = Math.sqrt(2 * RADIUS * height - height * height),
        baseline = 1 - RADIUS;
      let previous = baseline;
      for (let i = 0; i <= 160; i++) {
        const z = -sign * (onset + 0.01) * (1 - i / 160),
          { found, hit } = query(footprint, new Vec3(0, 1, z), baseline),
          distance = found ? hit.distance : baseline,
          expected = Math.min(baseline, 1 - height - Math.sqrt(RADIUS ** 2 - z * z));
        expect(distance).toBeCloseTo(expected, 10);
        expect(distance).toBeLessThanOrEqual(previous + 1e-10);
        expect(previous - distance).toBeLessThan(0.0011);
        if (found) {
          expect(hit.point.z).toBeCloseTo(0, 10);
          expect(hit.point.y).toBeCloseTo(height, 11);
          expect(hit.normal.z * sign).toBeLessThanOrEqual(1e-10);
        }
        previous = distance;
      }
      const beforeCentre = query(footprint, new Vec3(0, 1, -sign * 0.1), baseline);
      expect(beforeCentre.found).toBe(true);
      expect(beforeCentre.hit.distance).toBeLessThan(baseline - 0.04);
    },
  );

  it('resolves a raised triangle corner without mistaking tread width for rolling radius', () => {
    const bvh = new TriangleBVH(
        new Float64Array([0, 0.06, 0, 5, 0.06, 0, 0, 0.06, 5]),
        new Uint32Array([0, 2, 1]),
      ),
      footprint = new TireFootprint(bvh),
      origin = new Vec3(-0.08, 1, -0.08),
      expected =
        1 - 0.06 - Math.sqrt(RADIUS ** 2 - ((0.08 * RADIUS) / HALF_WIDTH) ** 2 - 0.08 ** 2),
      { found, hit } = query(footprint, origin);
    expect(found).toBe(true);
    expect(hit.distance).toBeCloseTo(expected, 11);
    expect(hit.point.distanceSq(new Vec3(0, 0.06, 0))).toBeLessThan(1e-20);
    expect(hit.normal.x).toBeLessThan(0);
    expect(hit.normal.z).toBeLessThan(0);
    expect(query(footprint, new Vec3(-HALF_WIDTH - 0.001, 1, 0.1)).found).toBe(false);
    expect(query(footprint, new Vec3(-0.25, 1, 0.1)).found).toBe(false);
  });

  it('converts curb normal gap speed into the finite-difference suspension compression rate', () => {
    const footprint = new TireFootprint(raisedEdge()),
      z = -0.17,
      epsilon = 1e-6,
      baseline = 1 - RADIUS,
      before = query(footprint, new Vec3(0, 1, z - epsilon), baseline),
      at = query(footprint, new Vec3(0, 1, z), baseline),
      after = query(footprint, new Vec3(0, 1, z + epsilon), baseline),
      // Unit forward translation, away from an active-feature switch.
      measured = -(after.hit.distance - before.hit.distance) / (2 * epsilon),
      normalSpeed = -at.hit.normal.z,
      projected = normalSpeed / at.hit.normal.y;
    expect(before.found && at.found && after.found).toBe(true);
    expect(measured).toBeCloseTo(-z / Math.sqrt(RADIUS ** 2 - z ** 2), 8);
    expect(projected).toBeCloseTo(measured, 8);
    // Treating normal speed itself as axis speed misses 14% at this curb.
    expect(Math.abs(projected - normalSpeed)).toBeGreaterThan(0.08);
  });

  it('has continuous shoulder onset instead of a hard lateral footprint clip', () => {
    const bvh = new TriangleBVH(
        new Float64Array([0, 0.06, -10, 10, 0.06, -10, 0, 0.06, 10, 10, 0.06, 10]),
        new Uint32Array([0, 2, 1, 1, 2, 3]),
      ),
      footprint = new TireFootprint(bvh),
      baseline = 1 - RADIUS,
      onset = (HALF_WIDTH / RADIUS) * Math.sqrt(2 * RADIUS * 0.06 - 0.06 ** 2),
      epsilon = 1e-7,
      before = query(footprint, new Vec3(-onset - epsilon, 1, 0), baseline),
      after = query(footprint, new Vec3(-onset + epsilon, 1, 0), baseline);
    expect(before.found).toBe(false);
    expect(after.found).toBe(true);
    expect(before.hit.distance - after.hit.distance).toBeGreaterThan(0);
    expect(before.hit.distance - after.hit.distance).toBeLessThan(2e-7);
  });

  it('retains road layers, exact cast reach and bounded penetration recovery', () => {
    const bvh = new TriangleBVH(
      new Float64Array([
        -5, 0, -5, 5, 0, -5, -5, 0, 5, 5, 0, 5, -5, 3, -5, 5, 3, -5, -5, 3, 5, 5, 3, 5,
      ]),
      new Uint32Array([0, 2, 1, 1, 2, 3, 4, 6, 5, 5, 6, 7]),
    );
    const footprint = new TireFootprint(bvh);
    const belowDeck = query(footprint, new Vec3(0, 1, 0));
    expect(belowDeck.found).toBe(true);
    expect(belowDeck.hit.point.y).toBeCloseTo(0, 10);
    expect(belowDeck.hit.distance).toBeCloseTo(1 - RADIUS, 10);
    expect(query(footprint, new Vec3(0, 1, 0), Infinity, 0.999).found).toBe(false);
    expect(query(footprint, new Vec3(0, 1, 0), Infinity, 1).found).toBe(true);
    const overlap = query(footprint, new Vec3(0, 0.1, 0));
    expect(overlap.found).toBe(true);
    expect(overlap.hit.distance).toBeCloseTo(0.1 - RADIUS, 10);
    expect(query(footprint, new Vec3(0, -0.1, 0)).found).toBe(false);
    expect(query(footprint, new Vec3(0, 5, 0), Infinity, 1.5).found).toBe(false);
  });

  it('does not turn a vertical sidewall into suspension support', () => {
    const footprint = new TireFootprint(
      new TriangleBVH(
        new Float64Array([0, -10, -10, 0, 10, -10, 0, -10, 10, 0, 10, 10]),
        new Uint32Array([0, 2, 1, 1, 2, 3]),
      ),
    );
    expect(query(footprint, new Vec3(-0.1, 1, 0)).found).toBe(false);
  });

  it('rejects malformed geometry-query input', () => {
    const footprint = new TireFootprint(plane()),
      hit = rayHit(),
      origin = new Vec3(0, 1, 0);
    expect(() =>
      footprint.cast(origin, new Vec3(), 1.5, RADIUS, HALF_WIDTH, AXLE, Infinity, hit),
    ).toThrow();
    expect(() =>
      footprint.cast(origin, DOWN, 1.5, RADIUS, HALF_WIDTH, new Vec3(2, 0, 0), Infinity, hit),
    ).toThrow();
    expect(() =>
      footprint.cast(origin, DOWN, 1.5, RADIUS, RADIUS * 2, AXLE, Infinity, hit),
    ).toThrow();
    expect(() => footprint.cast(origin, DOWN, 1.5, -1, HALF_WIDTH, AXLE, Infinity, hit)).toThrow();
    expect(() => footprint.cast(origin, DOWN, 1.5, RADIUS, 0, AXLE, Infinity, hit)).toThrow();
    expect(() =>
      footprint.cast(origin, DOWN, -1, RADIUS, HALF_WIDTH, AXLE, Infinity, hit),
    ).toThrow();
    expect(() =>
      footprint.cast(new Vec3(NaN), DOWN, 1.5, RADIUS, HALF_WIDTH, AXLE, Infinity, hit),
    ).toThrow();
    expect(() => footprint.cast(origin, DOWN, 1.5, RADIUS, HALF_WIDTH, AXLE, NaN, hit)).toThrow();
  });
});

describe('production road mesh and vehicle integration', () => {
  it('finds actual kerb triangles before the centre ray and attributes their support surface', () => {
    const track = new Track('clear', true),
      mesh = new TrackContactMesh(track, 2048),
      p = trackPoint(),
      surface = surfaceSample(),
      point = new Vec3();
    let raised = 0;
    for (let row = 80; row < 120; row += 4) {
      track.at((row * track.length) / 2048, p);
      const axle = new Vec3(p.nx, 0, p.nz),
        origin = new Vec3(
          p.x + p.nx * (p.width - 0.000001),
          p.y + 1,
          p.z + p.nz * (p.width - 0.000001),
        ),
        distance = mesh.cast(origin, DOWN, 1.5, surface),
        baseline = distance - RADIUS / surface.normal.y,
        length = mesh.castTire(origin, DOWN, 1.5, RADIUS, HALF_WIDTH, axle, surface, point);
      expect(Number.isFinite(length)).toBe(true);
      expect(length).toBeLessThanOrEqual(baseline + 1e-10);
      expect(mesh.tireFootprint.trianglesTested).toBeLessThan(150);
      if (length < baseline - 1e-6) {
        raised++;
        expect(point.y).toBeGreaterThan(p.y);
        expect(surface.surface).toBe(SURFACE.KERB);
        expect(surface.height).toBe(point.y);
        expect(surface.normal.finite()).toBe(true);
      }
    }
    expect(raised).toBeGreaterThan(0);
  });

  it('preserves analytic/terrain caster overrides and their exact reach in the shared vehicle', () => {
    class InstrumentedTrack extends DynamicsTrack {
      casts = 0;
      override cast(
        origin: Vec3,
        down: Vec3,
        maximum: number,
        out: ReturnType<typeof surfaceSample>,
      ) {
        this.casts++;
        return super.cast(origin, down, maximum, out);
      }
    }
    const track = new InstrumentedTrack(),
      car = new Vehicle(0),
      surface = surfaceSample(),
      point = new Vec3(),
      origin = new Vec3(0, 1, 0);
    expect(track.castTire(origin, DOWN, 1.5, RADIUS, HALF_WIDTH, AXLE, surface, point)).toBeCloseTo(
      1 - RADIUS,
      12,
    );
    expect(track.casts).toBe(1);
    car.place(track, 0);
    car.step(1 / 240, track);
    expect(track.casts).toBeGreaterThanOrEqual(5);
    expect(car.tires.some((tire) => tire.load > 100)).toBe(true);
    car.body.position.y += 3;
    car.step(1 / 240, track);
    expect([...car.hub.contact]).toEqual([0, 0, 0, 0]);
    expect(car.tires.every((tire) => tire.load === 0)).toBe(true);
    Object.assign(car.body.orientation, { x: 0, y: 0, z: 1, w: 0 });
    car.step(1 / 240, track);
    expect([...car.hub.contact]).toEqual([0, 0, 0, 0]);
  });
});
