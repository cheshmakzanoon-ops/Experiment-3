import * as T from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { MX_MEADOW_BAND, MxMeadow } from '../src/rendering/offroad/mx-meadow.ts';
import { setMxQuality } from '../src/rendering/offroad/mx-quality.ts';
import { mxShoulderPlantGeometry } from '../src/rendering/offroad/mx-shoulder-plants.ts';
import { mxFurnitureGround } from '../src/rendering/offroad/mx-trackside-furniture.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

afterEach(() => setMxQuality('high'));

describe('MX uncut field grass', () => {
  it('forms a leaning fan of eleven single-triangle blades between 25 and 60 cm', () => {
    const g = mxShoulderPlantGeometry('meadow');
    expect((g.getAttribute('position').count / 3) | 0).toBe(11);
    expect(g.boundingBox!.max.y).toBeGreaterThan(0.25);
    expect(g.boundingBox!.max.y).toBeLessThan(0.6);
    g.dispose();
  });

  it('stands in the field beyond the shoulder, on the visible ground and clear of every course', () => {
    const track = rigTrack('valley-ridge-mx'),
      surface = Track.offroadOf(track) as TrackTerrainSurface,
      meadow = new MxMeadow(track),
      matrix = new T.Matrix4(),
      root = new T.Vector3(),
      nearest = trackPoint();
    try {
      expect(meadow.stats.clumps).toBeGreaterThan(2000);
      expect(meadow.stats.clumps).toBeLessThan(40000);
      let checked = 0;
      meadow.root.traverse((o) => {
        if (!(o instanceof T.InstancedMesh)) return;
        expect(o.castShadow).toBe(false);
        for (let i = 0; i < o.count; i += 5) {
          o.getMatrixAt(i, matrix);
          root.setFromMatrixPosition(matrix);
          const lateral = track.nearest(root.x, root.z, nearest);
          const edge = surface.course.legalWidth(nearest.width, nearest.s, lateral);
          expect(Math.abs(lateral)).toBeGreaterThan(edge + MX_MEADOW_BAND.near - 0.7);
          // Rooted a few centimetres into the visible ground.
          expect(root.y - mxFurnitureGround(track, root.x, root.z)).toBeCloseTo(-0.045, 1);
          checked++;
        }
      });
      expect(checked).toBeGreaterThan(300);
      // Field grass is a High/Ultra term: absent on Low and Medium.
      setMxQuality('medium');
      expect(meadow.root.visible).toBe(false);
      setMxQuality('ultra');
      expect(meadow.root.visible).toBe(true);
      meadow.update(7.5);
    } finally {
      meadow.dispose();
    }
  });

  it('refuses the indoor arena', () => {
    expect(() => new MxMeadow(rigTrack('arena-nord-sx'))).toThrow();
  });
});
