import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { MxCourseDressing } from '../src/rendering/offroad/mx-course-dressing.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

describe('MX boundary tape', () => {
  it('strings one ribbon between the course-edge stakes, knee high and just outside the legal edge', () => {
    const track = rigTrack('valley-ridge-mx'),
      surface = Track.offroadOf(track) as TrackTerrainSurface,
      dressing = new MxCourseDressing(track),
      nearest = trackPoint();
    try {
      const tape = dressing.turf.getObjectByName('MX boundary tape') as T.Mesh;
      expect(tape).toBeInstanceOf(T.Mesh);
      expect(dressing.stats.tapeSpans).toBeGreaterThan(60);
      // One submission, a few thousand triangles at most.
      expect(tape.geometry.index!.count / 3).toBeLessThan(6000);
      expect((tape.material as T.MeshStandardMaterial).side).toBe(T.DoubleSide);
      const position = tape.geometry.getAttribute('position');
      let lowest = Infinity,
        highest = -Infinity;
      for (let i = 0; i < position.count; i += 7) {
        const lateral = track.nearest(position.getX(i), position.getZ(i), nearest);
        const edge = surface.course.legalWidth(nearest.width, nearest.s, lateral);
        expect(Math.abs(lateral)).toBeGreaterThan(edge + 0.05);
        const above = position.getY(i) - surface.terrain.baseHeight(nearest.s, lateral);
        lowest = Math.min(lowest, above);
        highest = Math.max(highest, above);
      }
      // Knee height with a few centimetres of sag between posts.
      expect(lowest).toBeGreaterThan(0.35);
      expect(highest).toBeLessThan(0.75);
    } finally {
      dressing.dispose();
    }
  });

  it('leaves the arena to its padded lane dividers', () => {
    const dressing = new MxCourseDressing(rigTrack('arena-nord-sx'));
    expect(dressing.stats.tapeSpans).toBe(0);
    expect(dressing.turf.getObjectByName('MX boundary tape')).toBeUndefined();
    dressing.dispose();
  });
});
