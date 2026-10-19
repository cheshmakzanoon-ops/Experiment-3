import * as T from 'three';
import { describe, expect, it } from 'vitest';
import {
  installMxSoilDetail,
  MX_SOIL_DETAIL_HOOK,
} from '../src/rendering/offroad/mx-soil-detail.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { TrackTerrainSurface } from '../src/simulation/offroad/course-terrain.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';

describe('MX prepared traffic corridor', () => {
  it.each(['valley-ridge-mx', 'arena-nord-sx'] as const)(
    'carries the real %s corridor width across mesh chunks without altering the course',
    (id) => {
      const track = rigTrack(id),
        terrain = (Track.offroadOf(track) as TrackTerrainSurface).terrain,
        original = terrain.hash(),
        view = new TerrainView(track),
        point = trackPoint();
      const meshes = view.group.children as T.Mesh[];
      let minimum = Infinity,
        maximum = -Infinity;
      for (const mesh of meshes) {
        const geometry = mesh.geometry,
          positions = geometry.getAttribute('position'),
          course = geometry.getAttribute('mxCourse'),
          width = geometry.getAttribute('mxCourseWidth');
        expect(width.count).toBe(positions.count);
        expect(width.itemSize).toBe(1);
        expect(width.array.byteLength).toBe(positions.count * Float32Array.BYTES_PER_ELEMENT);
        for (let vertex = 0; vertex < positions.count; vertex += 29) {
          const s = course.getY(vertex),
            lateral = course.getX(vertex);
          track.at(s, point);
          expect(width.getX(vertex)).toBeCloseTo(point.width, 4);
          expect(positions.getY(vertex)).toBeCloseTo(terrain.baseHeight(s, lateral), 4);
          minimum = Math.min(minimum, width.getX(vertex));
          maximum = Math.max(maximum, width.getX(vertex));
        }
      }
      expect(minimum).toBeGreaterThan(3);
      expect(maximum - minimum).toBeGreaterThan(0.5);
      const rowSize = terrain.renderColumns + 1;
      for (let chunk = 0; chunk < meshes.length; chunk++) {
        const width = meshes[chunk].geometry.getAttribute('mxCourseWidth'),
          next = meshes[(chunk + 1) % meshes.length].geometry.getAttribute('mxCourseWidth');
        expect(width.array.slice(width.count - rowSize)).toEqual(next.array.slice(0, rowSize));
      }
      expect(terrain.hash()).toBe(original);
      view.dispose();
    },
  );

  it('keeps prepared width and shader resources stable through terrain recording, holding and rewinding', () => {
    const track = rigTrack('valley-ridge-mx'),
      view = new TerrainView(track),
      geometry = (view.group.children[0] as T.Mesh).geometry,
      width = geometry.getAttribute('mxCourseWidth') as T.BufferAttribute,
      positions = geometry.getAttribute('position'),
      initialHeight = positions.getY(0),
      original = width.array.slice(),
      version = width.version,
      programKey = view.material.customProgramCacheKey();
    const source = T.ShaderLib.physical,
      compiled = {
        vertexShader: source.vertexShader,
        fragmentShader: source.fragmentShader,
        uniforms: T.UniformsUtils.clone(source.uniforms),
      } as StudioShader;
    view.material.onBeforeCompile(compiled, {} as T.WebGLRenderer);
    expect(compiled.uniforms.mxCourseLength.value).toBe(track.length);
    expect(installMxSoilDetail(view.material, track.length)).toBe(false);
    expect(studioHookKeys(view.material).filter((key) => key === MX_SOIL_DETAIL_HOOK)).toHaveLength(
      1,
    );
    view.record(
      { reset: true, wetness: 0.68, blocks: new Float32Array([0, 0.085, 0.73]) },
      9,
      true,
    );
    expect(positions.getY(0)).toBeCloseTo(initialHeight - 0.085, 5);
    view.showAt(9);
    view.showAt(2);
    expect(positions.getY(0)).toBe(initialHeight);
    view.showLive();
    expect(positions.getY(0)).toBeCloseTo(initialHeight - 0.085, 5);
    expect(width.array).toEqual(original);
    expect(width.version).toBe(version);
    expect(view.material.customProgramCacheKey()).toBe(programKey);
    view.dispose();

    const rallycross = new TerrainView(rigTrack('kestrel-rx'));
    expect(studioHookKeys(rallycross.material)).not.toContain(MX_SOIL_DETAIL_HOOK);
    for (const mesh of rallycross.group.children as T.Mesh[])
      expect(mesh.geometry.hasAttribute('mxCourseWidth')).toBe(false);
    rallycross.dispose();
  });
});
