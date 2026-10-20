import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { mxCourseWearSample, sampleMxCourseWear } from '../src/rendering/offroad/mx-course-wear.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

describe('MX surveyed course wear', () => {
  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    'emphasises the actual %s loaded faces and leaves quieter gap centres',
    (id) => {
      const track = rigTrack(id),
        course = (Track.offroadOf(track) as TrackTerrainSurface).course,
        out = mxCourseWearSample(),
        point = trackPoint();
      let quietGaps = 0;
      for (const jump of course.jumps) {
        sampleMxCourseWear(course, jump.takeoff - 0.25, 0, out);
        expect(out.launch).toBeGreaterThan(0.9);
        expect(out.air).toBe(0);
        sampleMxCourseWear(course, jump.landing, 0, out);
        expect(out.landing).toBeGreaterThan(0.9);
        expect(out.air).toBe(0);
        const from = jump.takeoff + 1.8,
          to = jump.landing - jump.landingLength / 2 - 0.6;
        if (to - from > 2) {
          sampleMxCourseWear(course, (from + to) / 2, 0, out);
          expect(out.air).toBeGreaterThan(0.25);
          expect(out.launch).toBeLessThan(0.05);
          expect(out.landing).toBeLessThan(0.05);
          quietGaps++;
        }
      }
      expect(quietGaps).toBeGreaterThan(0);
      for (const berm of course.spec.berms) {
        const station = (berm.from + berm.to) / 2;
        track.at(station, point);
        sampleMxCourseWear(course, station, point.curvature, out);
        expect(Math.sign(out.berm)).toBe(berm.side ?? (point.curvature > 0 ? -1 : 1));
        expect(Math.abs(out.berm)).toBeGreaterThan(0.4);
      }
      // Equal lap positions and reused scratch storage are deterministic.
      for (let s = 0; s < track.length; s += 11.3) {
        track.at(s, point);
        const expected = { ...sampleMxCourseWear(course, s, point.curvature, out) };
        expect(sampleMxCourseWear(course, s + track.length, point.curvature, out)).toBe(out);
        for (const key of ['launch', 'landing', 'air', 'berm'] as const) {
          expect(out[key]).toBeCloseTo(expected[key], 10);
          expect(Math.abs(out[key])).toBeLessThanOrEqual(1);
        }
      }
      sampleMxCourseWear(course, 0, 0, out);
      expect(out).toEqual(mxCourseWearSample());
    },
  );

  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    'carries %s wear across chunk joins and replay without changing wheel-contact geometry',
    (id) => {
      const track = rigTrack(id),
        terrain = (Track.offroadOf(track) as TrackTerrainSurface).terrain,
        sourceHash = terrain.hash(),
        view = new TerrainView(track),
        meshes = view.group.children as T.Mesh[],
        point = trackPoint(),
        sample = mxCourseWearSample(),
        rowSize = terrain.renderColumns + 1;
      let featureRows = 0;
      for (const mesh of meshes) {
        const positions = mesh.geometry.getAttribute('position'),
          course = mesh.geometry.getAttribute('mxCourse'),
          wear = mesh.geometry.getAttribute('mxCourseWear');
        expect(wear.itemSize).toBe(4);
        expect(wear.count).toBe(positions.count);
        for (let vertex = 0; vertex < positions.count; vertex += rowSize) {
          const s = course.getY(vertex),
            lateral = course.getX(vertex);
          track.at(s, point);
          sampleMxCourseWear(terrain.course, s, point.curvature, sample);
          expect(wear.getX(vertex)).toBeCloseTo(sample.launch, 5);
          expect(wear.getY(vertex)).toBeCloseTo(sample.landing, 5);
          expect(wear.getZ(vertex)).toBeCloseTo(sample.air, 5);
          expect(wear.getW(vertex)).toBeCloseTo(sample.berm, 5);
          expect(positions.getY(vertex)).toBeCloseTo(terrain.baseHeight(s, lateral), 4);
          if (sample.launch + sample.landing + sample.air + Math.abs(sample.berm) > 0.1)
            featureRows++;
        }
      }
      expect(featureRows).toBeGreaterThan(50);
      for (let chunk = 0; chunk < meshes.length; chunk++) {
        const wear = meshes[chunk].geometry.getAttribute('mxCourseWear'),
          next = meshes[(chunk + 1) % meshes.length].geometry.getAttribute('mxCourseWear');
        expect(wear.array.slice((wear.count - rowSize) * 4)).toEqual(
          next.array.slice(0, rowSize * 4),
        );
      }
      const attribute = meshes[0].geometry.getAttribute('mxCourseWear') as T.BufferAttribute,
        original = attribute.array.slice(),
        version = attribute.version;
      view.record({ reset: true, wetness: 0.75, blocks: new Float32Array([0, 0.1, 0.8]) }, 8, true);
      view.showAt(0);
      view.showLive();
      expect(attribute.array).toEqual(original);
      expect(attribute.version).toBe(version);
      expect(terrain.hash()).toBe(sourceHash);
      view.dispose();
    },
  );

  it('leaves rallycross outside the MX prepared-wear path', () => {
    const view = new TerrainView(rigTrack('kestrel-rx'));
    for (const mesh of view.group.children as T.Mesh[])
      expect(mesh.geometry.hasAttribute('mxCourseWear')).toBe(false);
    view.dispose();
  });
});
