import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
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


it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
  'grounds every %s takeoff and landing marker and perimeter blade on its rendered triangle',
  (venue) => {
    const track = rigTrack(venue),
      view = new TerrainView(track),
      dressing = new MxCourseDressing(track);
    const ray = new T.Raycaster(),
      down = new T.Vector3(0, -1, 0),
      at = new T.Vector3();
    const matrix = new T.Matrix4(),
      point = new T.Vector3(),
      colour = new T.Color();
    const ties: T.Vector3[] = [];
    try {
      view.group.updateMatrixWorld(true);
      for (const name of ['Surveyed jump lip and landing markers', 'MX course-edge stakes']) {
        const markers = dressing.root.getObjectByName(name) as T.InstancedMesh;
        const jump = name.startsWith('Surveyed'),
          paints = new Set<number>();
        for (let i = 0; i < markers.count; i++) {
          markers.getMatrixAt(i, matrix);
          point.setFromMatrixPosition(matrix);
          ray.set(at.copy(point).addScaledVector(down, -4), down);
          const hit = ray.intersectObject(view.group, true)[0];
          expect(hit).toBeDefined();
          // Jump collars sit flush. Perimeter blades embed twelve mm. These
          // independent triangle rays also see overlapping neighbouring lanes.
          expect(Math.abs(point.y - hit.point.y + (jump ? 0 : 0.012))).toBeLessThan(0.002);
          if (jump) {
            markers.getColorAt(i, colour);
            paints.add(colour.getHex());
            expect(colour.getHex()).toBe(matrix.elements[5] > 0.8 ? 0xe98243 : 0xe2dcc1);
          } else
            ties.push(
              new T.Vector3(0, 0.58, 0.006 * Math.sin((Math.PI * 0.58) / 0.82)).applyMatrix4(
                matrix,
              ),
            );
        }
        if (jump) expect(paints.size).toBe(2);
      }
      if (venue === 'valley-ridge-mx') {
        const tape = dressing.turf.getObjectByName('MX boundary tape') as T.Mesh;
        const pos = tape.geometry.getAttribute('position');
        for (let start = 0; start < pos.count; start += 18)
          for (const end of [start, start + 16]) {
            point
              .fromBufferAttribute(pos, end)
              .add(at.fromBufferAttribute(pos, end + 1))
              .multiplyScalar(0.5);
            expect(ties.some((tie) => tie.distanceToSquared(point) < 0.000001)).toBe(true);
          }
      }
    } finally {
      view.dispose();
      dressing.dispose();
    }
  },
);
