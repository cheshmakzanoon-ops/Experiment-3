import { describe, expect, it } from 'vitest';
import { mod } from '../src/core/math.ts';
import { AUREL, VELLAMAR } from '../src/simulation/circuits.ts';
import { carBase, CAR_STRIDE, HEADER, R, RACE_BASE } from '../src/simulation/protocol.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { vehicleIndex } from '../src/simulation/vehicles.ts';
import {
  FormulaCourse,
  formulaStations,
  formulaTimingPaint,
} from '../src/rendering/formula-course.ts';
import { FormulaEdgeProfile } from '../src/rendering/formula-edge.ts';
import { inStandFootprint } from '../src/rendering/grandstand.ts';

describe('Formula timing stations', () => {
  for (const circuit of [AUREL, VELLAMAR])
    it(
      circuit.id + ' marks each rule station on the banked deck and faces approaching traffic',
      () => {
        const track = new Track('clear', false, undefined, circuit);
        const sites = formulaStations(track);
        expect(sites.map((site) => site.s)).toEqual(
          circuit.drsZones.flatMap((z) => [z.detect, z.start]),
        );
        for (const site of sites) {
          const p = track.at(site.s, trackPoint());
          expect(Math.sin(site.yaw) * p.tx + Math.cos(site.yaw) * p.tz).toBeCloseTo(-1, 10);
          expect(Math.abs(site.lateral)).toBeGreaterThan(
            track.boundaryAt(p, Math.sign(site.lateral)) + 1,
          );
          expect(inStandFootprint(track, site.x, site.z, 1)).toBe(false);
          const g = formulaTimingPaint(track, site),
            pos = g.getAttribute('position');
          expect(g.index!.count / 3).toBe(site.kind === 'activation' ? 2 : 8);
          const q = trackPoint();
          for (let i = 0; i < pos.count; i++) {
            const lateral = track.nearest(pos.getX(i), pos.getZ(i), q);
            expect(pos.getY(i) - (q.y + q.bank * lateral)).toBeCloseTo(0.006, 2);
            expect(g.getAttribute('normal').getY(i)).toBeGreaterThan(0.9);
          }
          g.dispose();
        }
      },
    );
  it('uses the entire field through a mixed race or a replay car change', () => {
    const course = new FormulaCourse(new Track());
    const f = new Float32Array(HEADER + 2 * CAR_STRIDE),
      car = (id: number) => carBase(id) + RACE_BASE + R.VEHICLE;
    f[car(0)] = vehicleIndex('rd2');
    f[car(1)] = vehicleIndex('fx26');
    course.select(f, 2);
    expect(course.root.visible).toBe(true);
    course.select(f, 1);
    expect(course.root.visible).toBe(false);
    expect(course.active.value).toBe(0);
    f[car(0)] = vehicleIndex('apx01');
    course.select(f, 1);
    expect(course.active.value).toBe(1);
  });
});

describe('Formula straight and apex edges', () => {
  it('carries paint into the inside approach and across the outside exit with a periodic seam', () => {
    const profile = new FormulaEdgeProfile(160, (s) => (mod(s, 160) < 20 ? 0.016 : 0));
    expect(profile.at(141, 1)).toBeGreaterThan(0.99);
    expect(profile.at(141, -1)).toBe(0);
    expect(profile.at(52, -1)).toBeGreaterThan(0.99);
    expect(profile.at(52, 1)).toBe(0);
    expect(profile.at(95, 1)).toBe(0);
    for (const side of [-1, 1])
      expect(profile.at(-0.1, side)).toBeCloseTo(profile.at(159.9, side), 10);
  });
  it('preserves both surfaces on the main circuits with a bounded four-metre table', () => {
    for (const venue of [AUREL, VELLAMAR]) {
      const track = new Track('clear', false, undefined, venue);
      const profile = FormulaEdgeProfile.forTrack(track);
      const samples = [];
      for (let s = 0; s < track.length; s += 4) samples.push(profile.at(s, 1), profile.at(s, -1));
      expect(Math.min(...samples)).toBe(0);
      expect(Math.max(...samples)).toBe(1);
      expect(samples.filter((x) => x < 0.1).length).toBeGreaterThan(samples.length * 0.25);
      expect(samples.filter((x) => x > 0.9).length).toBeGreaterThan(samples.length * 0.1);
      expect(profile.count).toBe(Math.ceil(track.length / 4));
    }
  });
});
