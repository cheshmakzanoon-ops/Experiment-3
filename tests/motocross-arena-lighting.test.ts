import * as T from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import {
  installMxArenaLighting,
  MX_ARENA_LIGHT,
  MX_ARENA_LIGHT_HOOK,
} from '../src/rendering/offroad/mx-arena-lighting.ts';
import { mxFloodlightHead, mxFloodlightMount } from '../src/rendering/offroad/mx-floodlight.ts';
import { Stadium } from '../src/rendering/offroad/stadium.ts';
import { STADIUM } from '../src/rendering/offroad/stadium-dimensions.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';
import { mxHighDetail, setMxQuality } from '../src/rendering/offroad/mx-quality.ts';

const count = (text: string, token: string) => text.split(token).length - 1;
afterEach(() => setMxQuality('high'));

describe('supercross roof floodlight grid', () => {
  it('aims the visible recessed glass into the same cone as each roof fixture', () => {
    const head = mxFloodlightHead();
    const origin = new T.Vector3(8, 23, -7);
    const down = new T.Vector3(0, -1, 0);
    for (const target of [
      new T.Vector3(-5, 1, 6),
      new T.Vector3(23, 1, -3),
      new T.Vector3(8, 0, -7),
    ]) {
      const mount = mxFloodlightMount(origin, target);
      const direction = target.clone().sub(origin).normalize();
      expect(down.clone().transformDirection(mount).dot(direction)).toBeCloseTo(1, 6);
      // A ray from inside the real light pool must hit the front of all
      // three glass cells, and their normals must face away from the truss.
      const mesh = new T.Mesh(head.glass, new T.MeshBasicMaterial());
      mesh.applyMatrix4(mount);
      mesh.updateMatrixWorld();
      for (const cell of [-0.37, 0, 0.37]) {
        const eye = new T.Vector3(cell + 0.02, -2, 0.011).applyMatrix4(mount);
        const hit = new T.Raycaster(eye, direction.clone().negate()).intersectObject(mesh)[0];
        expect(hit).toBeDefined();
        expect(hit.face!.normal.clone().transformDirection(mount).dot(direction)).toBeGreaterThan(
          0.9,
        );
      }
      mesh.material.dispose();
    }
    for (const part of Object.values(head)) part.dispose();
  });

  it('retains its single haze draw on Medium without enabling High surface detail', () => {
    setMxQuality('medium');
    const stadium = new Stadium(rigTrack('arena-nord-sx'));
    try {
      const haze = stadium.root.getObjectByName('Arena floodlight haze beams') as T.Mesh;
      expect(haze).toBeInstanceOf(T.Mesh);
      expect(haze.visible).toBe(true);
      expect(mxHighDetail()).toBe(false);
      const geometry = haze.geometry;
      setMxQuality('low');
      expect(haze.visible).toBe(false);
      for (const preset of ['medium', 'high', 'ultra'] as const) {
        setMxQuality(preset);
        expect(haze.visible).toBe(true);
        expect(haze.geometry).toBe(geometry);
      }
    } finally {
      stadium.dispose();
    }
  });

  it('exposes the 8 x 5 lamp grid the trusses hang, over the floor and inside the bowl', () => {
    const track = rigTrack('arena-nord-sx'),
      stadium = new Stadium(track),
      grid = stadium.lampGrid;
    try {
      expect(grid.columns).toBe(8);
      expect(grid.rows).toBe(5);
      expect(grid.spanX).toBeGreaterThan(40);
      expect(grid.spanZ).toBeGreaterThan(20);
      // Hung from the roof's trusses (2 m under the deck) with the housing below.
      const box = new T.Box3().setFromObject(stadium.root);
      expect(grid.y).toBeLessThan(box.min.y + STADIUM.roof);
      expect(grid.y).toBeGreaterThan(box.min.y + STADIUM.roof - 6);
      // The first and last lamps sit half a cell inside the grid's edge.
      const cellX = grid.spanX / grid.columns;
      expect(grid.minX + 0.5 * cellX).toBeGreaterThan(grid.minX);
      expect(grid.minX + (grid.columns - 0.5) * cellX).toBeLessThan(grid.minX + grid.spanX);
    } finally {
      stadium.dispose();
    }
  });

  it('chains once onto the floor and fades every lamp out before a cell edge shows', () => {
    const track = rigTrack('arena-nord-sx'),
      view = new TerrainView(track),
      grid = { minX: -40, minZ: -20, spanX: 80, spanZ: 40, y: 30, columns: 8, rows: 5 };
    const uniform = installMxArenaLighting(view.material, grid);
    expect(uniform).not.toBeNull();
    expect(installMxArenaLighting(view.material, grid)).toBeNull();
    expect(studioHookKeys(view.material)).toContain(MX_ARENA_LIGHT_HOOK);
    const source = T.ShaderLib.physical,
      shader = {
        vertexShader: source.vertexShader,
        fragmentShader: source.fragmentShader,
        uniforms: T.UniformsUtils.clone(source.uniforms),
      } as StudioShader;
    view.material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    const f = shader.fragmentShader;
    expect(f).toContain('float mxArenaIrradiance( vec3 world, vec3 up )');
    expect(f).toContain('reflectedLight.directDiffuse *= mxArenaColour.a;');
    expect(count(f, '{')).toBe(count(f, '}'));
    expect(count(f, '(')).toBe(count(f, ')'));
    // 4 x 4 lamps suffice because the fade reaches zero by the reach, two cells.
    expect(MX_ARENA_LIGHT.reachCells).toBeLessThanOrEqual(2);
    expect((shader.uniforms.mxArenaGrid.value as T.Vector4).z).toBeCloseTo(10, 6);
    expect((shader.uniforms.mxArenaLamp.value as T.Vector4).toArray()).toEqual([8, 5, 30, 1]);
    uniform!.value.w = 0;
    expect((shader.uniforms.mxArenaLamp.value as T.Vector4).w).toBe(0);
    view.dispose();
  });
});
