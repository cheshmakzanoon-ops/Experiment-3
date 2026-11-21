import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { OpenWorldTrack } from '../src/simulation/open-world/open-world-track.ts';
import { ROAD_FLAG } from '../src/simulation/open-world/road-network.ts';
import { openWorld } from '../src/simulation/open-world/world.ts';
import { MATERIAL } from '../src/simulation/surface-material.ts';
import { makeTire, peakGrip, solveTire } from '../src/simulation/tire.ts';
import { surfaceSample, trackPoint } from '../src/simulation/track.ts';

const world = openWorld(),
  net = world.network;

function station(roadClass: 'country' | 'mountain' | 'highway' | 'town') {
  for (const edge of net.edges) {
    if (edge.roadClass !== roadClass) continue;
    for (let i = edge.first + 2; i < edge.last - 2; i++) {
      if (
        net.flags[i] & ROAD_FLAG.BRIDGE ||
        net.s[i] - edge.offset < 60 ||
        edge.offset + edge.length - net.s[i] < 60
      )
        continue;
      return { edge, p: net.pointOnSegment(i, 0.5, trackPoint()) };
    }
  }
  throw new Error('Missing test road ' + roadClass);
}

function contact(
  track: OpenWorldTrack,
  road: ReturnType<typeof station>,
  side: number,
  offset: number,
  steer = 0,
) {
  const { edge, p } = road,
    l = side * (edge.spec.halfWidth + offset);
  const x = p.x + p.nx * l,
    z = p.z + p.nz * l;
  const axle = new Vec3(
    p.nx * Math.cos(steer) + p.tx * Math.sin(steer),
    0,
    p.nz * Math.cos(steer) + p.tz * Math.sin(steer),
  );
  const out = surfaceSample();
  track.castTire(
    new Vec3(x, track.groundHeight(x, z, p.y) + 0.85, z),
    new Vec3(0, -1, 0),
    1.5,
    0.34,
    0.15,
    axle,
    out,
    new Vec3(),
  );
  return out;
}

describe('Festival tyres crossing a paved rural edge', () => {
  it('shares grip and rolling resistance across each steered tread on either side of the road', () => {
    const track = new OpenWorldTrack(world, 'rain');
    for (const roadClass of ['mountain', 'country'] as const) {
      const road = station(roadClass);
      for (const side of [-1, 1])
        for (const steer of [0, 0.53]) {
          const half = 0.15 * Math.cos(steer);
          const inside = contact(track, road, side, -half * 1.02, steer),
            outside = contact(track, road, side, half * 1.02, steer);
          expect(inside.shoulderCoverage).toBeUndefined();
          expect(outside.shoulderCoverage).toBeUndefined();
          expect(outside.surface).toBe(MATERIAL.DIRT);
          for (const fraction of [0.12, 0.32, 0.49, 0.51, 0.68, 0.88]) {
            const result = contact(track, road, side, (2 * fraction - 1) * half, steer);
            expect(result.shoulderCoverage).toBeCloseTo(fraction, 2);
            expect(result.grip).toBeCloseTo(
              (1 - fraction - 0.07 * (result.paintCoverage ?? 0)) * road.edge.spec.grip +
                fraction * outside.grip,
              2,
            );
            expect(result.resistance).toBeCloseTo(
              (1 - fraction) * inside.resistance + fraction * outside.resistance,
              4,
            );
            expect(result.water).toBeCloseTo(
              (1 - fraction) * inside.water + fraction * outside.water,
              3,
            );
          }
        }
    }
  });
  it('crosses the material ID without a step in wet tyre force or soil loss', () => {
    const road = station('mountain'),
      track = new OpenWorldTrack(world, 'rain');
    const solve = (offset: number) => {
      const sample = contact(track, road, 1, offset),
        tyre = makeTire('medium');
      tyre.omega = 36 / tyre.radius;
      for (let i = 0; i < 45; i++) solveTire(tyre, 36, 0.8, 3400, 130, 0, sample, 0, 1 / 240);
      return {
        mu: peakGrip(tyre, 3400, sample, 36),
        box: [tyre.rolling, tyre.sinkage, tyre.groundDrag],
        material: sample.surface,
      };
    };
    const a = solve(-0.0001),
      b = solve(0.0001);
    expect(a.material).not.toBe(b.material);
    expect(Math.abs(a.mu - b.mu)).toBeLessThan(0.0015);
    expect(Math.abs(a.box[0] - b.box[0])).toBeLessThan(0.001);
    expect(Math.abs(a.box[1] - b.box[1])).toBeLessThan(0.0001);
    expect(Math.abs(a.box[2] - b.box[2])).toBeLessThan(0.25);
    const roadOnly = solve(-0.3),
      loose = solve(0.3);
    expect(a.box[1]).toBeGreaterThan(roadOnly.box[1]);
    expect(a.box[1]).toBeLessThan(loose.box[1]);
  });
  it('keeps motorway shoulders paved and uses the formed town kerb', () => {
    const track = new OpenWorldTrack(world);
    for (const type of ['highway', 'town'] as const) {
      const s = contact(track, station(type), 1, 0.05);
      expect(s.shoulderCoverage).toBeUndefined();
      expect(s.surface).not.toBe(MATERIAL.DIRT);
    }
  });
});
