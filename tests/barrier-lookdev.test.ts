import { expect, it } from 'vitest';
import * as T from 'three';
import { FENCE, catchFenceMaterial } from '../src/rendering/circuit-finish.ts';
import { barrierMaterials } from '../src/rendering/circuit-barriers.ts';

it('galvanises the fence and steel and veils distant fencing', () => {
  const fence = catchFenceMaterial();
  expect(fence.color.getHex()).toBe(new T.Color(0x8d9396).getHex());
  expect([fence.metalness, fence.roughness]).toEqual([0.85, 0.45]);
  expect([FENCE.fadeMetres, FENCE.nearOpacity, FENCE.farOpacity]).toEqual([70, 0.55, 0.12]);
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
  } as unknown as T.WebGLProgramParametersWithUniforms;
  fence.onBeforeCompile(shader, {} as T.WebGLRenderer);
  expect(shader.fragmentShader).toContain(
    'diffuseColor.a=min(diffuseColor.a,clamp(1.0-length(vViewPosition)/70.0,0.12,0.55));',
  );
  expect(fence.customProgramCacheKey()).toBe('apex-filtered-catch-fence-v1-d25-veil');
  const m = barrierMaterials();
  expect(m.steel.color.getHex()).toBe(new T.Color(0x8d9396).getHex());
  expect([m.steel.metalness, m.steel.roughness]).toEqual([0.85, 0.45]);
  expect(m.concrete.color.getHex()).toBe(new T.Color(0xc8c8c4).getHex());
});
