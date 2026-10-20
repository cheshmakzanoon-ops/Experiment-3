import * as T from 'three';
import { describe, expect, it, vi } from 'vitest';
import { installMotocrossMetalFinish } from '../src/rendering/offroad/motocross-metal-finish.ts';
import { installMud, mudUniforms } from '../src/rendering/offroad/mud.ts';
import { type StudioShader } from '../src/rendering/studio/shader-hooks.ts';
import { tagWeatherSurface, WeatherPresentation } from '../src/rendering/weather-presentation.ts';

function compile(material: T.MeshStandardMaterial) {
  const source = T.ShaderLib.standard;
  const shader = {
    uniforms: T.UniformsUtils.clone(source.uniforms),
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
  } as StudioShader;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}

describe('motocross cast metal finish', () => {
  it.each(['finish-mud-weather', 'mud-finish-weather', 'weather-mud-finish'] as const)(
    'preserves the deposited mud and snapshot weather layers in %s order',
    (order) => {
      const material = tagWeatherSurface(new T.MeshStandardMaterial(), 'metal', 0.4);
      const weather = new WeatherPresentation(),
        mud = mudUniforms();
      const previous = vi.fn();
      material.onBeforeCompile = previous;
      for (const stage of order.split('-')) {
        if (stage === 'finish') installMotocrossMetalFinish(material, 'aluminium');
        else if (stage === 'mud') installMud(material, mud);
        else weather.installMaterial(material);
      }
      const shader = compile(material),
        fragment = shader.fragmentShader;
      expect(previous).toHaveBeenCalledTimes(1);
      expect(shader.uniforms.offroadMud).toBe(mud.offroadMud);
      expect(shader.uniforms.offroadMudWet).toBe(mud.offroadMudWet);
      expect(shader.uniforms.aurelSurfaceWeather).toBe(weather.surface);
      const before = (first: string, second: string) => {
        expect(fragment.indexOf(first)).toBeGreaterThanOrEqual(0);
        expect(fragment.indexOf(second)).toBeGreaterThan(fragment.indexOf(first));
      };
      // Dry microstructure must not recolour, polish or displace the mud coat.
      before('diffuseColor.rgb *= 1. +', 'diffuseColor.rgb = mix( diffuseColor.rgb, earth');
      before('roughnessFactor + mxCastRoughness', 'roughnessFactor = mix( roughnessFactor');
      before('metalnessFactor *= 1. - mxCastOxide', 'metalnessFactor *= 1.0 - offroadMudMask');
      before('dFdx(mxCastHeight)', 'dFdx( offroadMudHeight )');
      before('roughnessFactor = mix( roughnessFactor', 'float surfaceWet =');
      before('float surfaceWet =', '#include <lights_physical_fragment>');
      expect(material.customProgramCacheKey()).toContain('motocross-cast-metal-v1');
      expect(material.customProgramCacheKey()).toContain('offroad-mud-v2');
      expect(material.customProgramCacheKey()).toContain('aurel-snapshot-dampness-v3');
      material.dispose();
      weather.dispose();
    },
  );

  it('shares one program across alloy profiles without adding textures or changing base properties', () => {
    const cast = new T.MeshStandardMaterial({ color: 0x92938d, metalness: 0.78, roughness: 0.59 });
    const cover = new T.MeshStandardMaterial({ color: 0x5e5b54, metalness: 0.66, roughness: 0.56 });
    const original = [cast.color.getHex(), cast.metalness, cast.roughness];
    installMotocrossMetalFinish(cast, 'aluminium');
    installMotocrossMetalFinish(cover, 'magnesium');
    expect(cast.customProgramCacheKey()).toBe(cover.customProgramCacheKey());
    expect(compile(cast).uniforms.mxCastFinish.value).not.toEqual(
      compile(cover).uniforms.mxCastFinish.value,
    );
    expect([cast.color.getHex(), cast.metalness, cast.roughness]).toEqual(original);
    for (const material of [cast, cover]) {
      expect(Object.values(material).filter((value) => value instanceof T.Texture)).toHaveLength(0);
      expect(compile(material).vertexShader).not.toContain('transformed +=');
      material.dispose();
    }
  });

  it('installs once per material while allowing a cloned material to receive its own finish', () => {
    const original = new T.MeshStandardMaterial();
    expect(installMotocrossMetalFinish(original, 'aluminium')).toBe(true);
    const version = original.version;
    expect(installMotocrossMetalFinish(original, 'aluminium')).toBe(false);
    expect(original.version).toBe(version);
    const clone = original.clone();
    expect(installMotocrossMetalFinish(clone, 'magnesium')).toBe(true);
    const shader = compile(clone);
    expect(shader.fragmentShader.split('uniform vec3 mxCastFinish;')).toHaveLength(2);
    expect(shader.vertexShader.split('vMxCastPosition = position;')).toHaveLength(2);
    original.dispose();
    clone.dispose();
  });
});
