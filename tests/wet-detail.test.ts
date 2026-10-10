import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { WET_REFLECTION_GLSL, WET_STREAK } from '../src/rendering/wet-reflection.ts';
import {
  DRY_LINE,
  PUDDLES,
  WET_DETAIL_HOOK,
  installWetDetail,
} from '../src/rendering/studio/wet-detail.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';

describe('wet surface detail', () => {
  it('streaks the planar reflection vertically, wider on rough film', () => {
    expect(WET_STREAK.taps).toBe(7);
    expect(WET_STREAK.base).toBe(0.004);
    expect(WET_STREAK.roughness).toBe(0.03);
    expect(WET_REFLECTION_GLSL).toContain('for (int k = 1; k <= 3; k++)');
    expect(WET_REFLECTION_GLSL).toContain(
      'float wetStreak = 0.0040 + 0.0300 * material.clearcoatRoughness;',
    );
    expect(WET_REFLECTION_GLSL).toContain('wetReflectionColor /= wetStreakWeight;');
  });

  it('breaks cell water into puddles and dries the racing line first', () => {
    const material = new T.MeshPhysicalMaterial();
    expect(installWetDetail(material)).toBe(true);
    expect(installWetDetail(material)).toBe(false);
    expect(studioHookKeys(material)).toEqual([WET_DETAIL_HOOK]);
    const shader = {
      uniforms: {},
      vertexShader: T.ShaderLib.physical.vertexShader,
      fragmentShader: T.ShaderLib.physical.fragmentShader,
    } as unknown as StudioShader;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    const f = shader.fragmentShader;
    expect(f.indexOf('D22: sub-cell puddles')).toBeGreaterThan(
      f.indexOf('#include <color_fragment>'),
    );
    expect(f.indexOf('D22: sub-cell puddles')).toBeLessThan(
      f.indexOf('#include <roughnessmap_fragment>'),
    );
    expect(f).toContain(
      'wet *= mix( 1.0, 0.5500, wetLine * smoothstep( 0.2000, 0.6500, waterMm ) * ( 1.0 - puddle ) );',
    );
    expect(DRY_LINE.depth).toBe(0.55);
    expect(PUDDLES.edgeBias).toBeGreaterThan(0);
    expect(PUDDLES.lineBias).toBeGreaterThan(0);
  });
});
