import { describe, expect, it } from 'vitest';
import { mod } from '../src/core/math.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { OffroadCourse, relief } from '../src/simulation/offroad/course.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

describe.each(['valley-ridge-mx', 'arena-nord-sx'] as const)('%s banked racing grooves', (id) => {
  it('shares each worn bed and outer lip between wheel contact, geometry and soil finish', () => {
    const track = rigTrack(id);
    const { course, terrain } = Track.offroadOf(track) as TrackTerrainSurface;
    const clean = new OffroadCourse(
      { ...course.spec, berms: course.spec.berms.map((berm) => ({ ...berm, lines: undefined })) },
      course.profile, course.jumps, course.rough, track.length,
    );
    const view = new TerrainView(track);
    try {
      const p = trackPoint(), r = relief(), bank = { bed: 0, lip: 0 };
      let measured = 0;
      for (const berm of course.spec.berms) {
        const s = mod(berm.from + mod(berm.to - berm.from, track.length) / 2, track.length);
        track.at(s, p);
        for (const line of berm.lines!) {
          for (const [offset, fraction] of [[0, -1], [0.98, 0.68]]) {
            const lateral = berm.side! * (line.apex + offset * line.halfWidth);
            const base = clean.groundAt(s, lateral, p, r);
            const actual = terrain.contact(lateral, s).height;
            expect(actual - base).toBeCloseTo(line.depth * fraction, 4);
            expect(Math.abs(view.heightAt(s, lateral) - actual)).toBeLessThan(0.039);
            course.groundAt(s, lateral, p, r, bank);
            expect(offset === 0 ? bank.bed : bank.lip).toBeCloseTo(1, 6);
            measured++;
          }
        }
        const inside = -berm.side! * p.width * 0.8;
        expect(course.groundAt(s, inside, p, r, bank)).toBe(clean.groundAt(s, inside, p, r));
        expect(bank).toEqual({ bed: 0, lip: 0 });
      }
      expect(measured).toBeGreaterThan(8);
    } finally {
      view.dispose();
    }
  });

  it('has bounded, continuous slopes at the entrance, the apex and the exit', () => {
    const track = rigTrack(id), { course } = Track.offroadOf(track) as TrackTerrainSurface;
    const p = trackPoint(), r = relief(), e = 0.0001;
    for (const berm of course.spec.berms) {
      const length = mod(berm.to - berm.from, track.length);
      for (const fraction of [0, 0.03, 0.25, 0.5, 0.82, 0.97, 1]) {
        const s = berm.from + fraction * length;
        track.at(s, p);
        for (let x = -1.8; x <= 4.6; x += 0.43) {
          const lateral = x * berm.side!;
          const { ds, dl } = course.relief(s, lateral, p, r);
          const along = course.relief(s + e, lateral, p, r).h - course.relief(s - e, lateral, p, r).h;
          const across = course.relief(s, lateral + e, p, r).h - course.relief(s, lateral - e, p, r).h;
          expect(ds).toBeCloseTo(along / (2 * e), 4);
          expect(dl).toBeCloseTo(across / (2 * e), 4);
        }
      }
    }
  });
});
