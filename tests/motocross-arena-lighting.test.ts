import * as T from 'three';
import { describe, expect, it } from 'vitest';
import {
  installMxArenaLighting,
  MX_ARENA_LIGHT,
  MX_ARENA_LIGHT_HOOK,
} from '../src/rendering/offroad/mx-arena-lighting.ts';
import { Stadium } from '../src/rendering/offroad/stadium.ts';
import { STADIUM } from '../src/rendering/offroad/stadium-dimensions.ts';
import { TerrainView } from '../src/rendering/offroad/terrain-view.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { rigTrack } from '../src/simulation/offroad/jump-rig.ts';

const count = (text: string, token: string) => text.split(token).length - 1;

describe('supercross roof floodlight grid', () => {
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
