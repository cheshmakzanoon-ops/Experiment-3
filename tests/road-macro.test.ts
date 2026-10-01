import { expect, it } from 'vitest';
import * as T from 'three';
import {
  ROAD_MACRO,
  ROAD_MACRO_APPLY,
  ROAD_MACRO_GLSL,
  roadHash,
  roadPatches,
} from '../src/rendering/road-macro.ts';
import { installWetRoad } from '../src/rendering/materials.ts';

it('lays a sparse, varied set of repair patches along a lap', () => {
  for (const length of [2973, 4000]) {
    const patches = roadPatches(length);
    // About one cell in five: roughly one repair every 170 m.
    expect(patches.length).toBeGreaterThan(length / 400);
    expect(patches.length).toBeLessThan(length / 90);
    for (const patch of patches) {
      expect(patch.length).toBeGreaterThanOrEqual(ROAD_MACRO.length[0]);
      expect(patch.length).toBeLessThanOrEqual(ROAD_MACRO.length[1]);
      const cell = Math.floor(patch.start / ROAD_MACRO.cell);
      // A patch never leaves its own cell, so cells never overlap.
      expect(patch.start + patch.length).toBeLessThanOrEqual((cell + 1) * ROAD_MACRO.cell + 1e-9);
      expect([ROAD_MACRO.fresh, ROAD_MACRO.faded]).toContain(patch.tone);
      if (patch.high - patch.low < 60) {
        expect(patch.high - patch.low).toBeGreaterThanOrEqual(2 * ROAD_MACRO.halfWidth[0]);
        expect(Math.max(Math.abs(patch.low), Math.abs(patch.high))).toBeLessThanOrEqual(7.2);
      }
    }
    // Both kinds of repair and both full-width and lane patches appear.
    expect(new Set(patches.map((p) => p.tone)).size).toBe(2);
    expect(patches.some((p) => p.high - p.low === 60)).toBe(true);
    expect(patches.some((p) => p.high - p.low < 60)).toBe(true);
  }
  for (let i = 0; i < 1000; i++) {
    const h = roadHash(i * 7.3, i % 7);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(1);
  }
});

it('shades the road from the same constants, before water darkening, in its own program', () => {
  expect(ROAD_MACRO_GLSL).toContain(`m.y / ${ROAD_MACRO.cell.toFixed(4)}`);
  expect(ROAD_MACRO_GLSL).toContain(`< ${ROAD_MACRO.chance.toFixed(4)}`);
  expect(ROAD_MACRO_GLSL).toContain('fwidth(m)');
  const material = new T.MeshPhysicalMaterial();
  const state = new T.DataTexture(new Uint8Array(4), 1, 1);
  installWetRoad(material, state, true);
  const shader = {
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
    uniforms: {} as Record<string, T.IUniform>,
  } as unknown as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  const fragment = shader.fragmentShader;
  expect(fragment).toContain('float apexRoadMacro(vec2 m)');
  const apply = fragment.indexOf(ROAD_MACRO_APPLY.trim());
  expect(apply).toBeGreaterThan(fragment.indexOf('#include <map_fragment>'));
  expect(apply).toBeLessThan(fragment.indexOf('vec4 roadState = texture2D(trackState'));
  expect(material.customProgramCacheKey()).toContain('road-macro-v1');
  material.dispose();
  state.dispose();
});
