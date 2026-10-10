import { expect, it } from 'vitest';
import * as T from 'three';
import { GLAZING, GLAZING_HOOK, installGlazing } from '../src/rendering/studio/glazing.ts';
import { venueMaterials } from '../src/rendering/venue-materials.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';

it('makes venue glass reflective with a parallax interior, no transmission', () => {
  const { glass } = venueMaterials();
  expect(studioHookKeys(glass)).toEqual([GLAZING_HOOK]);
  expect(glass.roughness).toBe(GLAZING.roughness);
  expect(glass.envMapIntensity).toBe(1.4);
  expect(glass.transmission).toBe(0);
  expect(glass.metalness).toBe(0);
  expect(installGlazing(glass)).toBe(false);
  const shader = {
    uniforms: T.UniformsUtils.clone(T.ShaderLib.physical.uniforms),
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
  } as unknown as StudioShader;
  glass.onBeforeCompile(shader, {} as T.WebGLRenderer);
  expect(shader.fragmentShader).toContain('D26 parallax interior');
  expect(shader.fragmentShader).toContain('totalEmissiveRadiance += glassInterior;');
  expect(shader.vertexShader).toContain('vGlassWorld = ( modelMatrix * glassWorld ).xyz;');
});
