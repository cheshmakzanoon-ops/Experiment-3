import * as T from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { MxCourseDressing } from '../src/rendering/offroad/mx-course-dressing.ts';
import { setMxQuality } from '../src/rendering/offroad/mx-quality.ts';
import { mxShoulderPlantGeometry } from '../src/rendering/offroad/mx-shoulder-plants.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

describe('MX close-cropped shoulder turf', () => {
  afterEach(() => setMxQuality('high'));

  it('forms short, kinked blades that stay under a quarter metre and colour by height', () => {
    const g = mxShoulderPlantGeometry('tuft');
    const box = g.boundingBox!;
    expect(box.max.y).toBeGreaterThan(0.1);
    expect(box.max.y).toBeLessThan(0.25);
    expect((g.getAttribute('position').count / 3) | 0).toBe(21);
    const colour = g.getAttribute('color'),
      position = g.getAttribute('position');
    let base = 1,
      tip = 0;
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) < 0.01) base = Math.min(base, colour.getY(i));
      if (position.getY(i) > 0.8 * box.max.y) tip = Math.max(tip, colour.getY(i));
    }
    expect(tip).toBeGreaterThan(base + 0.1);
    g.dispose();
  });

  it('roots every tuft on the rendered terrain beside, never inside, the riding lanes', () => {
    const track = rigTrack('valley-ridge-mx'),
      surface = Track.offroadOf(track) as TrackTerrainSurface,
      terrain = new TerrainView(track),
      dressing = new MxCourseDressing(track),
      matrix = new T.Matrix4(),
      root = new T.Vector3(),
      nearest = trackPoint(),
      ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0, -1, 0), 0, 20);
    const mesh = dressing.turf.getObjectByName('MX shoulder grass tufts') as T.InstancedMesh;
    try {
      expect(mesh).toBeInstanceOf(T.InstancedMesh);
      expect(dressing.stats.tufts).toBe(mesh.count);
      expect(mesh.count).toBeGreaterThan(1500);
      terrain.group.updateMatrixWorld(true);
      for (let i = 0; i < mesh.count; i += 7) {
        mesh.getMatrixAt(i, matrix);
        root.setFromMatrixPosition(matrix);
        const lateral = track.nearest(root.x, root.z, nearest);
        expect(Math.abs(lateral)).toBeGreaterThan(
          surface.course.legalWidth(nearest.width, nearest.s, lateral) + 0.1,
        );
        ray.ray.origin.set(root.x, root.y + 10, root.z);
        const hit = ray.intersectObject(terrain.group, true)[0];
        expect(hit, `tuft ${i}`).toBeDefined();
        const burial = hit.point.y - root.y;
        expect(burial).toBeGreaterThanOrEqual(0);
        expect(burial).toBeLessThanOrEqual(0.08);
      }
      // High and Ultra draw the whole band; Low and Medium a third.
      const total = mesh.count;
      setMxQuality('low');
      expect(mesh.count).toBeLessThan(total * 0.4);
      setMxQuality('ultra');
      expect(mesh.count).toBe(total);
    } finally {
      dressing.dispose();
      terrain.dispose();
    }
  });

  it('leaves the indoor arena without outdoor turf', () => {
    const dressing = new MxCourseDressing(rigTrack('arena-nord-sx'));
    expect(dressing.stats.tufts).toBe(0);
    dressing.dispose();
  });
});
