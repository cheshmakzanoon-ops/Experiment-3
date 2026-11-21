import { describe, expect, it } from 'vitest';
import { Vec3 } from '../src/core/math.ts';
import { circuitKerbHeight } from '../src/rendering/circuit.ts';
import { CIRCUITS } from '../src/simulation/circuits.ts';
import { gpCornerShapes } from '../src/simulation/gp-corner-shape.ts';
import { apronWidth } from '../src/simulation/gp-course-edges.ts';
import { Track, SURFACE, surfaceSample, trackPoint } from '../src/simulation/track.ts';

const venues = ['poggio-alto', 'cape-wrenna', 'haarveld', 'montejaral'] as const;
describe.each(venues)('%s constructed GP course edges', (id) => {
  const track = new Track('clear', false, undefined, CIRCUITS[id]);
  const edges = track.gpEdges!;
  it('opens the straights and constructs a tapered inside kerb at every true apex', () => {
    let open = 0;
    for (let s = 0; s < track.length; s += 5) {
      if (!edges.at(s, -1) && !edges.at(s, 1)) open += 5;
      for (const side of [-1, 1]) {
        const value = edges.at(s, side);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        expect(edges.at(s - track.length, side)).toBeCloseTo(value, 10);
        expect(Math.abs(edges.at(s + 0.1, side) - value)).toBeLessThan(0.03);
        const inMesh = edges.runs(side).some(([a, b]) => a <= s && s < b);
        if (value > 0) expect(inMesh).toBe(true);
      }
    }
    expect(open).toBeGreaterThan(track.length * 0.18);
    for (const side of [-1, 1]) {
      const distance = edges.runs(side).reduce((acc, [a, b]) => acc + b - a, 0);
      expect(distance / track.length).toBeLessThan(0.68);
    }
    gpCornerShapes(track).forEach((shape, i) => {
      if (shape.direction !== 'straight')
        expect(edges.at(track.circuit.corners[i].s, shape.direction === 'left' ? 1 : -1)).toBe(1);
    });
  });
  it('keeps the rendered height, tyre material and suspension rays on the same footprint', () => {
    const p = trackPoint(),
      sample = surfaceSample(),
      hit = surfaceSample();
    const down = new Vec3(0, -1, 0);
    for (const side of [-1, 1]) {
      const tested = new Set<string>();
      for (let s = 4; s < track.length && tested.size < 3; s += 1.7) {
        const amount = edges.at(s, side);
        const category = amount === 1 ? 'apex' : amount === 0 ? 'straight' : 'taper';
        if (tested.has(category) || (category === 'taper' && (amount < 0.3 || amount > 0.82)))
          continue;
        track.at(s, p);
        if (track.inPitLane(s, side * (p.width + 2))) continue;
        for (const across of [0.25 * (amount || 1), apronWidth(amount) + 0.7]) {
          const l = side * (p.width + across);
          const x = p.x + p.nx * l,
            z = p.z + p.nz * l;
          track.sample(x, z, sample, p.y);
          const expected =
            across > apronWidth(amount)
              ? track.runoffSurface(p, l)
              : amount === 0
                ? SURFACE.ASPHALT
                : SURFACE.KERB;
          expect(sample.surface).toBe(expected);
          // The smoothed lateral frame can project onto an adjacent spline segment.
          // Compare at the wheel's resolved station, then raycast the independent mesh.
          const at = track.at(sample.s, trackPoint());
          const physicalHeight = at.y + Math.max(-12, Math.min(12, sample.lateral)) * at.bank;
          const relief = circuitKerbHeight(track, at.s, sample.lateral, Math.abs(sample.lateral) - at.width);
          expect(sample.height - physicalHeight).toBeCloseTo(relief, 9);
          expect(track.cast(new Vec3(x, sample.height + 1, z), down, 2, hit)).toBeLessThan(1.06);
          expect(hit.surface).toBe(expected);
          expect(Math.abs(hit.height - sample.height)).toBeLessThan(0.037);
          expect(hit.normal.y).toBeGreaterThan(0.86);
        }
        tested.add(category);
      }
      expect(tested.size).toBe(3);
    }
  });
});
