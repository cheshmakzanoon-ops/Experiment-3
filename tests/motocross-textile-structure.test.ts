import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { installMotocrossFabricFinish } from '../src/rendering/offroad/motocross-detail.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';

function compiled(material: T.MeshStandardMaterial) {
  const source = T.ShaderLib.standard,
    shader = {
      vertexShader: source.vertexShader,
      fragmentShader: source.fragmentShader,
      uniforms: T.UniformsUtils.clone(source.uniforms),
    } as StudioShader;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}
const count = (text: string, token: string) => text.split(token).length - 1;

describe('motocross textile structure', () => {
  for (const kind of ['jersey', 'limb'] as const)
    it(`${kind}: chains once, reads the printed map's UV and perturbs only height, colour and roughness`, () => {
      const material = new T.MeshStandardMaterial({ map: new T.Texture(), roughness: 0.9 });
      installMotocrossFabricFinish(material, kind);
      installMotocrossFabricFinish(material, kind);
      expect(studioHookKeys(material)).toEqual([`motocross-textile-${kind}-v1`]);
      const shader = compiled(material);
      // MAP_UV: the garment UV wraps once around each piece; no extra attribute.
      expect(shader.vertexShader).toContain('vMxFabricUv = MAP_UV;');
      expect(shader.vertexShader).toContain('vMxFabricPosition = position;');
      expect(shader.fragmentShader).toContain('mxFabricHeight =');
      expect(shader.fragmentShader).toContain(
        'roughnessFactor = clamp(roughnessFactor - mxFabricCrease',
      );
      expect(count(shader.fragmentShader, '{')).toBe(count(shader.fragmentShader, '}'));
      expect(count(shader.fragmentShader, '(')).toBe(count(shader.fragmentShader, ')'));
      // Seam/stitch detail fades with screen footprint instead of sparkling.
      expect(shader.fragmentShader).toContain(
        'float near = 1. - smoothstep(.004, .02, footprint);',
      );
      expect(
        Object.values(shader.uniforms).some(
          (u) => u.value instanceof T.Texture && u !== shader.uniforms.map,
        ),
      ).toBe(false);
    });

  it('keeps distinct program keys for the two cuts', () => {
    const jersey = installMotocrossFabricFinish(new T.MeshStandardMaterial(), 'jersey'),
      limb = installMotocrossFabricFinish(new T.MeshStandardMaterial(), 'limb');
    expect(jersey.customProgramCacheKey()).not.toBe(limb.customProgramCacheKey());
  });
});
