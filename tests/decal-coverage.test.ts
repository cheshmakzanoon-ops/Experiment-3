import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  configureSuppliedMaterial,
  suppliedDecalCoverageControl,
} from '../src/rendering/supplied-player-materials.ts';

function decal() {
  const m = new T.MeshPhysicalMaterial({
    transparent: true,
    depthWrite: false,
    side: T.DoubleSide,
    map: new T.Texture(),
  });
  m.name = 'Decal | oracle';
  return m;
}
function compile(m: T.Material) {
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
  } as T.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}

describe('zero-coverage supplied decals', () => {
  it('discards exactly zero alpha before physical lighting without changing filtered edges or geometry', () => {
    const m = decal(),
      map = m.map,
      original = m.toJSON(),
      vertex = T.ShaderLib.physical.vertexShader;
    configureSuppliedMaterial(m);
    const shader = compile(m);
    expect(shader.vertexShader).toBe(vertex);
    expect(shader.fragmentShader).toContain('diffuseColor.a == 0.0');
    expect(shader.fragmentShader.indexOf('diffuseColor.a == 0.0')).toBeGreaterThan(
      shader.fragmentShader.indexOf('#include <alphamap_fragment>'),
    );
    expect(shader.fragmentShader.indexOf('diffuseColor.a == 0.0')).toBeLessThan(
      shader.fragmentShader.indexOf('#include <lights_physical_fragment>'),
    );
    expect(m.map).toBe(map);
    expect(m.alphaTest).toBe(0);
    expect(m.depthWrite).toBe(false);
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBe(original.opacity ?? 1);
    expect(m.blending).toBe(T.NormalBlending);
    expect(suppliedDecalCoverageControl(m)?.value).toBe(true);
    m.dispose();
    map!.dispose();
  });

  it('chains existing shader hooks once and retains a stable opt-out oracle uniform', () => {
    const m = decal(),
      previous = vi.fn((shader: T.WebGLProgramParametersWithUniforms) => {
        shader.fragmentShader += '\n// prior hook';
      });
    m.onBeforeCompile = previous;
    m.customProgramCacheKey = () => 'prior-key';
    configureSuppliedMaterial(m);
    const key = m.customProgramCacheKey(),
      hook = m.onBeforeCompile,
      control = suppliedDecalCoverageControl(m)!;
    configureSuppliedMaterial(m);
    expect(m.onBeforeCompile).toBe(hook);
    expect(m.customProgramCacheKey()).toBe(key);
    expect(key).toContain('prior-key:');
    control.value = false;
    const shader = compile(m);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(shader.fragmentShader).toContain('// prior hook');
    expect(shader.uniforms).toHaveProperty('apexDiscardEmptyDecal', control);
    expect(m.customProgramCacheKey()).toBe(key);
    expect(shader.fragmentShader.match(/diffuseColor.a == 0.0/g)).toHaveLength(1);
    m.dispose();
  });

  it('does not change alpha or side-effect policies outside normal non-depth-writing decal sheets', () => {
    const variants: Partial<T.MeshPhysicalMaterial>[] = [
      { name: 'Visor' },
      { transparent: false },
      { depthWrite: true },
      { stencilWrite: true },
      { blending: T.AdditiveBlending },
      { blending: T.CustomBlending },
      { alphaToCoverage: true },
      { alphaHash: true },
      { alphaTest: 0.2 },
      { transmission: 0.5 },
    ];
    for (const v of variants) {
      const m = decal();
      Object.assign(m, v);
      const hook = m.onBeforeCompile,
        key = m.customProgramCacheKey();
      configureSuppliedMaterial(m);
      expect(suppliedDecalCoverageControl(m), JSON.stringify(v)).toBeNull();
      expect(m.onBeforeCompile).toBe(hook);
      expect(m.customProgramCacheKey()).toBe(key);
      m.dispose();
    }
  });

  it('fails closed when a previous hook removes the required source alpha stage', () => {
    const m = decal();
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = 'void main() {}';
    };
    configureSuppliedMaterial(m);
    expect(() => compile(m)).toThrow('Missing supplied decal alpha stage');
    m.dispose();
  });
});
