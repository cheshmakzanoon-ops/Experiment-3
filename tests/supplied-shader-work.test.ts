import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import * as T from 'three';
import { installSuppliedShaderWork, suppliedShaderWorkControl } from '../src/rendering/supplied-shader-work.ts';

function compile(material: T.Material) {
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
  } as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}

describe('source-preserving supplied shader work', () => {
  it('skips only exact-zero influences and retains original weighted skin/normal stages', () => {
    const material = new T.MeshPhysicalMaterial();
    installSuppliedShaderWork(material);
    const shader = compile(material);
    for (const component of ['x', 'y', 'z', 'w']) {
      assert.ok(shader.vertexShader.includes(`skinWeight.${component} != 0.0`));
      assert.ok(shader.vertexShader.includes(`getBoneMatrix( skinIndex.${component} )`));
    }
    assert.ok(shader.vertexShader.includes('#include <skinning_vertex>'));
    assert.ok(shader.vertexShader.includes('#include <skinnormal_vertex>'));
    assert.ok(!shader.vertexShader.includes('normalize( skinWeight'));
    assert.equal(shader.fragmentShader, T.ShaderLib.physical.fragmentShader);
  });
  it('has the same finite weighted-matrix result for zero, small, negative and mixed influences', () => {
    for (let sample = 0; sample < 1024; sample++) {
      const weights = [1, sample % 3 ? 0 : 0.3, sample % 7 ? 0 : -0.1, sample % 11 ? 0 : 1e-20];
      for (let entry = 0; entry < 16; entry++) {
        const matrices = weights.map((_, bone) => Math.sin(sample + entry * 13 + bone * 0.7));
        const original = weights.reduce((sum, weight, i) => sum + matrices[i] * weight, 0);
        const reduced = weights.reduce((sum, weight, i) => sum + (weight === 0 ? 0 : matrices[i]) * weight, 0);
        assert.equal(reduced, original);
      }
    }
  });
  it('reuses only the same packed texture object and retains an independent original-lookup oracle', () => {
    const texture = new T.Texture();
    const material = new T.MeshPhysicalMaterial({ roughnessMap: texture, metalnessMap: texture });
    const before = texture.toJSON();
    installSuppliedShaderWork(material);
    const shader = compile(material), control = suppliedShaderWorkControl(material)!;
    assert.ok(shader.fragmentShader.includes('(apexShaderWork && apexPackedORM) ? texelRoughness'));
    assert.ok(shader.fragmentShader.includes('texture2D( metalnessMap, vMetalnessMapUv )'));
    assert.equal(shader.uniforms.apexShaderWork, control);
    control.value = false;
    assert.equal(shader.uniforms.apexShaderWork.value, false);
    assert.equal(material.roughnessMap, texture);
    assert.equal(material.metalnessMap, texture);
    assert.deepEqual(texture.toJSON(), before);
  });
  it('keeps independent UV transforms on clones, and recompiles eligibility after a map change', () => {
    const texture = new T.Texture();
    const material = new T.MeshPhysicalMaterial({ roughnessMap: texture, metalnessMap: texture });
    installSuppliedShaderWork(material);
    const packedKey = material.customProgramCacheKey();
    material.metalnessMap = texture.clone();
    material.metalnessMap.offset.set(0.5, 0.25);
    assert.equal(material.roughnessMap!.source, material.metalnessMap.source);
    assert.notEqual(material.customProgramCacheKey(), packedKey);
    assert.equal(compile(material).fragmentShader, T.ShaderLib.physical.fragmentShader);
    material.roughnessMap = null;
    assert.equal(compile(material).fragmentShader, T.ShaderLib.physical.fragmentShader);
  });
  it('guards map identity on each draw even when a later hook freezes the cache key', () => {
    const texture = new T.Texture();
    const material = new T.MeshPhysicalMaterial({ roughnessMap: texture, metalnessMap: texture });
    installSuppliedShaderWork(material);
    const shader = compile(material), key = material.customProgramCacheKey();
    material.customProgramCacheKey = () => key;
    material.metalnessMap = texture.clone();
    material.onBeforeRender(...([] as unknown as Parameters<typeof material.onBeforeRender>));
    assert.equal(shader.uniforms.apexPackedORM.value, false);
    material.metalnessMap = texture;
    material.onBeforeRender(...([] as unknown as Parameters<typeof material.onBeforeRender>));
    assert.equal(shader.uniforms.apexPackedORM.value, true);
  });
  it('chains hooks exactly once and keeps a stable independent control without new textures', () => {
    const material = new T.MeshPhysicalMaterial();
    let calls = 0;
    material.onBeforeCompile = (shader) => { calls++; shader.fragmentShader += '\n// source hook'; };
    material.customProgramCacheKey = () => 'original-policy';
    installSuppliedShaderWork(material);
    const key = material.customProgramCacheKey(), hook = material.onBeforeCompile;
    const control = suppliedShaderWorkControl(material);
    installSuppliedShaderWork(material);
    assert.equal(material.onBeforeCompile, hook);
    assert.equal(material.customProgramCacheKey(), key);
    assert.equal(suppliedShaderWorkControl(material), control);
    assert.ok(key.startsWith('original-policy:'));
    assert.ok(compile(material).fragmentShader.includes('// source hook'));
    assert.equal(calls, 1);
    assert.equal(suppliedShaderWorkControl(new T.MeshBasicMaterial()), null);
  });
  it('does not replace a custom metalness stage or reuse a missing roughness lookup', () => {
    const texture = new T.Texture();
    const material = new T.MeshPhysicalMaterial({ roughnessMap: texture, metalnessMap: texture });
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', 'float roughnessFactor = 0.5;');
    };
    installSuppliedShaderWork(material);
    const shader = compile(material);
    assert.ok(shader.fragmentShader.includes('#include <metalnessmap_fragment>'));
    assert.ok(!shader.fragmentShader.includes('(apexShaderWork && apexPackedORM) ? texelRoughness'));
  });
});
