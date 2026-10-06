import { describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  chainShaderHook,
  injectAfter,
  injectBefore,
  studioHookKeys,
  type StudioShader,
} from '../src/rendering/studio/shader-hooks.ts';

const renderer = {} as T.WebGLRenderer;
function shaderFor(id: 'standard' | 'physical' = 'standard'): StudioShader {
  const source = T.ShaderLib[id];
  return {
    uniforms: T.UniformsUtils.clone(source.uniforms),
    vertexShader: source.vertexShader,
    fragmentShader: source.fragmentShader,
  } as unknown as StudioShader;
}
function count(source: string, text: string) {
  return source.split(text).length - 1;
}

describe('chainShaderHook', () => {
  it('calls the previous hook exactly once, before its own body', () => {
    const material = new T.MeshStandardMaterial();
    const order: string[] = [];
    const previous = vi.fn(() => order.push('previous'));
    material.onBeforeCompile = previous;
    const body = vi.fn(() => order.push('studio'));
    expect(chainShaderHook(material, 'probe-v1', body)).toBe(true);
    const shader = shaderFor();
    material.onBeforeCompile(shader, renderer);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(previous).toHaveBeenCalledWith(shader, renderer);
    expect(previous.mock.contexts[0]).toBe(material);
    expect(body).toHaveBeenCalledExactlyOnceWith(shader, renderer, material);
    expect(order).toEqual(['previous', 'studio']);
  });

  it('is idempotent per key and keeps chaining distinct keys in order', () => {
    const material = new T.MeshStandardMaterial();
    const previous = vi.fn();
    material.onBeforeCompile = previous;
    const first = vi.fn(),
      second = vi.fn();
    expect(chainShaderHook(material, 'wind-v1', first)).toBe(true);
    const hook = material.onBeforeCompile;
    const key = material.customProgramCacheKey();
    expect(chainShaderHook(material, 'wind-v1', vi.fn())).toBe(false);
    expect(material.onBeforeCompile).toBe(hook);
    expect(material.customProgramCacheKey()).toBe(key);
    expect(chainShaderHook(material, 'grounding-v2', second)).toBe(true);
    expect(chainShaderHook(material, 'wind-v1', vi.fn())).toBe(false);
    expect(studioHookKeys(material)).toEqual(['wind-v1', 'grounding-v2']);
    material.onBeforeCompile(shaderFor(), renderer);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0]);
  });

  it('extends a custom program cache key with |<id>-vN, evaluated lazily', () => {
    const material = new T.MeshStandardMaterial();
    let role = 'road';
    material.customProgramCacheKey = () => `weather-v2:${role}`;
    chainShaderHook(material, 'asphalt-v1', () => {});
    expect(material.customProgramCacheKey()).toBe('weather-v2:road|asphalt-v1');
    chainShaderHook(material, 'grounding-v3', () => {});
    expect(material.customProgramCacheKey()).toBe('weather-v2:road|asphalt-v1|grounding-v3');
    role = 'kerb';
    expect(material.customProgramCacheKey()).toBe('weather-v2:kerb|asphalt-v1|grounding-v3');
  });

  it('keeps distinct previous hooks in distinct programs under the default key', () => {
    const plain = new T.MeshStandardMaterial();
    const hooked = new T.MeshStandardMaterial();
    hooked.onBeforeCompile = (shader) => {
      shader.fragmentShader = `// legacy edit\n${shader.fragmentShader}`;
    };
    const plainKey = plain.customProgramCacheKey();
    const hookedKey = hooked.customProgramCacheKey();
    chainShaderHook(plain, 'probe-v1', () => {});
    chainShaderHook(hooked, 'probe-v1', () => {});
    expect(plain.customProgramCacheKey()).toBe(`${plainKey}|probe-v1`);
    expect(hooked.customProgramCacheKey()).toBe(`${hookedKey}|probe-v1`);
    expect(plain.customProgramCacheKey()).not.toBe(hooked.customProgramCacheKey());
  });

  it('marks the material for recompilation once per new key', () => {
    const material = new T.MeshPhysicalMaterial();
    const version = material.version;
    chainShaderHook(material, 'paint-v1', () => {});
    expect(material.version).toBe(version + 1);
    chainShaderHook(material, 'paint-v1', () => {});
    expect(material.version).toBe(version + 1);
  });

  it('a copied hook carries its keys, so a clone sharing it is not patched twice', () => {
    const material = new T.MeshStandardMaterial();
    const body = vi.fn();
    chainShaderHook(material, 'wind-v1', body);
    const clone = material.clone();
    // Material.copy() does not copy hooks: the clone is genuinely unpatched.
    expect(studioHookKeys(clone)).toEqual([]);
    clone.onBeforeCompile = material.onBeforeCompile;
    expect(chainShaderHook(clone, 'wind-v1', vi.fn())).toBe(false);
    clone.onBeforeCompile(shaderFor(), renderer);
    expect(body).toHaveBeenCalledExactlyOnceWith(expect.anything(), renderer, clone);
  });

  it.each(['', 'Wind-v1', 'wind', 'wind-v', 'wind|v1', 'wind v1', 'wind-v1|x'])(
    'rejects the unversioned or unsafe key %j',
    (key) => {
      const material = new T.MeshStandardMaterial();
      const hook = material.onBeforeCompile;
      expect(() => chainShaderHook(material, key, () => {})).toThrow(/<feature>-v<N>/);
      expect(material.onBeforeCompile).toBe(hook);
    },
  );
});

describe('injectAfter / injectBefore', () => {
  it('inserts on the line after a chunk include in the stage that has it', () => {
    const shader = shaderFor('physical');
    const stage = injectAfter(shader, 'lights_fragment_maps', 'radiance *= 1.0; // probe');
    expect(stage).toBe('fragment');
    expect(shader.fragmentShader).toContain(
      '#include <lights_fragment_maps>\nradiance *= 1.0; // probe',
    );
    expect(shader.vertexShader).toBe(T.ShaderLib.physical.vertexShader);
  });

  it('finds vertex-only anchors and accepts literal anchor text', () => {
    const shader = shaderFor();
    expect(injectAfter(shader, 'begin_vertex', 'transformed.y += 0.0;')).toBe('vertex');
    expect(shader.vertexShader).toContain('#include <begin_vertex>\ntransformed.y += 0.0;');
    const anchor = 'vec3 outgoingLight = ';
    expect(injectBefore(shader, anchor, '// before outgoing')).toBe('fragment');
    expect(shader.fragmentShader).toContain(`// before outgoing\n${anchor}`);
  });

  it('throws when the anchor is missing, and leaves the shader unchanged', () => {
    const shader = shaderFor();
    const vertex = shader.vertexShader,
      fragment = shader.fragmentShader;
    expect(() => injectAfter(shader, 'no_such_chunk', 'x')).toThrow(
      'Shader anchor "#include <no_such_chunk>" is missing',
    );
    expect(() => injectAfter(shader, 'begin_vertex', 'x', 'fragment')).toThrow(
      /missing from the fragment shader/,
    );
    expect(shader.vertexShader).toBe(vertex);
    expect(shader.fragmentShader).toBe(fragment);
  });

  it('requires a stage for anchors present in both stages', () => {
    const shader = shaderFor();
    expect(() => injectAfter(shader, 'common', '// both')).toThrow(/both stages/);
    expect(injectAfter(shader, 'common', '// vertex only', 'vertex')).toBe('vertex');
    expect(shader.vertexShader).toContain('#include <common>\n// vertex only');
    expect(shader.fragmentShader).not.toContain('// vertex only');
  });

  it('rejects an anchor that occurs more than once in its stage', () => {
    const shader = shaderFor();
    shader.fragmentShader += '\n// twice\n// twice';
    expect(() => injectAfter(shader, '// twice', 'x', 'fragment')).toThrow(/ambiguous/);
  });

  it('is idempotent and safe for replacement patterns in the GLSL', () => {
    const shader = shaderFor();
    const glsl = 'float studioProbe = 1.0; // $& $1 $$';
    injectAfter(shader, 'lights_fragment_end', glsl);
    injectAfter(shader, 'lights_fragment_end', glsl);
    expect(count(shader.fragmentShader, glsl)).toBe(1);
    expect(shader.fragmentShader).toContain(`#include <lights_fragment_end>\n${glsl}`);
  });

  it('patches through a chained hook on a real compile path', () => {
    const material = new T.MeshPhysicalMaterial();
    chainShaderHook(material, 'probe-v1', (shader) => {
      injectAfter(shader, 'lights_fragment_maps', '// studio probe');
    });
    const shader = shaderFor('physical');
    material.onBeforeCompile(shader, renderer);
    expect(count(shader.fragmentShader, '// studio probe')).toBe(1);
  });
});
