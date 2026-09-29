import { describe, it, expect, vi } from 'vitest';
import * as T from 'three';
import {
  guardZeroPointLights,
  guardZeroDirectRadiance,
  installPointLightWork,
  pointLightWorkControl,
} from '../src/rendering/point-light-work.ts';

const compile = (m: T.Material) => {
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.physical.vertexShader,
    fragmentShader: T.ShaderLib.physical.fragmentShader,
  } as T.WebGLProgramParametersWithUniforms;
  m.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
};

describe('exact-zero point-light shader work', () => {
  it('skips only the arithmetic direct body for exact-zero incident radiance', () => {
    const source = T.ShaderChunk.lights_physical_pars_fragment;
    const branch = '\nif (apexPointLightWork && all(equal(directLight.color, vec3(0.0)))) return;';
    const guarded = guardZeroDirectRadiance(source);
    expect(guarded.replace(branch, '')).toBe(source);
    expect(guarded.split(branch)).toHaveLength(2);
    expect(guarded.indexOf(branch)).toBeGreaterThan(guarded.indexOf('void RE_Direct_Physical('));
    expect(guarded.indexOf(branch)).toBeLessThan(
      guarded.indexOf(
        'vec3 irradiance = dotNL * directLight.color;',
        guarded.indexOf('void RE_Direct_Physical('),
      ),
    );
    const start = source.indexOf('void RE_Direct_Physical(');
    const body = source.slice(start, source.indexOf('void RE_IndirectDiffuse_Physical(', start));
    expect(body).not.toMatch(/texture|dFdx|dFdy|fwidth/);
    expect(guardZeroDirectRadiance('custom shader')).toBe('custom shader');
  });
  it('retains both controls together in the same compiled physical shader', () => {
    const material = new T.MeshPhysicalMaterial();
    installPointLightWork(material);
    const shader = compile(material);
    expect(shader.fragmentShader).toContain('all(equal(directLight.color, vec3(0.0)))');
    expect(shader.fragmentShader).toContain('any(notEqual(pointLight.color, vec3(0.0)))');
    expect(shader.uniforms.apexPointLightWork).toBe(pointLightWorkControl(material));
  });
  it('guards only the point loop without changing its calculations or other light types', () => {
    const source = T.ShaderChunk.lights_fragment_begin;
    const result = guardZeroPointLights(source);
    const branch = '\nif (!apexPointLightWork || any(notEqual(pointLight.color, vec3(0.0)))) {';
    expect(result.includes(branch)).toBe(true);
    const restored = result
      .replace(branch, '')
      .replace('}\n}\n\t#pragma unroll_loop_end', '}\n\t#pragma unroll_loop_end');
    expect(restored).toBe(source);
    expect(result.split(branch)).toHaveLength(2);
    expect(result.slice(result.indexOf('#if ( NUM_SPOT_LIGHTS'))).toBe(
      source.slice(source.indexOf('#if ( NUM_SPOT_LIGHTS')),
    );
  });
  it('retains custom point-light material work inside the conditional', () => {
    const source = T.ShaderChunk.lights_fragment_begin.replace(
      'pointLight = pointLights[ i ];',
      'pointLight = pointLights[ i ];\n// artist-owned material adjustment',
    );
    const result = guardZeroPointLights(source);
    expect(result.indexOf('if (!apexPointLightWork')).toBeLessThan(
      result.indexOf('// artist-owned'),
    );
    expect(result).toContain('RE_Direct( directLight');
    expect(result).toContain('getPointShadow(');
  });
  it('preserves faint, negative and mixed colours rather than applying an intensity threshold', () => {
    for (const colour of [
      [0, 0, 0],
      [-0, 0, 0],
      [1e-30, 0, 0],
      [0, -1e-30, 0],
      [0, 0, 1],
      [-1, 2, 0],
    ]) {
      const active = colour.some((c) => c !== 0);
      const actual = active ? colour.map((c) => c * 0.23) : [0, 0, 0];
      expect(actual.every((v, i) => v === colour[i] * 0.23)).toBe(true);
    }
  });
  it('chains installation once and retains an independent same-program control', () => {
    const m = new T.MeshPhysicalMaterial();
    const old = vi.fn((shader: T.WebGLProgramParametersWithUniforms) => {
      shader.fragmentShader += '\n// original hook';
    });
    m.onBeforeCompile = old;
    m.customProgramCacheKey = () => 'original-policy';
    const vertices = T.ShaderLib.physical.vertexShader;
    installPointLightWork(m);
    const hook = m.onBeforeCompile,
      key = m.customProgramCacheKey();
    installPointLightWork(m);
    expect(m.onBeforeCompile).toBe(hook);
    expect(m.customProgramCacheKey()).toBe(key);
    expect(key.startsWith('original-policy|')).toBe(true);
    const shader = compile(m),
      control = pointLightWorkControl(m)!;
    expect(old).toHaveBeenCalledTimes(1);
    expect(shader.vertexShader).toBe(vertices);
    expect(shader.fragmentShader).toContain('// original hook');
    expect(shader.uniforms.apexPointLightWork).toBe(control);
    control.value = false;
    expect(shader.uniforms.apexPointLightWork.value).toBe(false);
  });
  it('leaves unknown lighting programs and nonphysical materials untouched', () => {
    const basic = new T.MeshBasicMaterial(),
      hook = basic.onBeforeCompile;
    installPointLightWork(basic);
    expect(basic.onBeforeCompile).toBe(hook);
    expect(pointLightWorkControl(basic)).toBeNull();
    expect(guardZeroPointLights('void main() {}')).toBe('void main() {}');
    const m = new T.MeshPhysicalMaterial();
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = 'void main() {}';
    };
    installPointLightWork(m);
    expect(compile(m).fragmentShader).toBe('void main() {}');
    expect(compile(m).uniforms.apexPointLightWork).toBeUndefined();
  });
  it('fails a changed unroll contract instead of silently dropping a light', () => {
    expect(() =>
      guardZeroPointLights(
        T.ShaderChunk.lights_fragment_begin.replace(
          'pointLight = pointLights[ i ];',
          'pointLight = changed;',
        ),
      ),
    ).toThrow('Unsupported point-light');
  });
});
