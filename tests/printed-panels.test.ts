import { describe, it, expect } from 'vitest';
import * as T from 'three';
import { unprintedBack } from '../src/rendering/geometry.ts';

describe('printed boards', () => {
  it('show a plain backing instead of mirrored artwork on back faces', () => {
    const material = unprintedBack(
      new T.MeshStandardMaterial({ map: new T.Texture(), side: T.DoubleSide }),
      0x2b3236,
    );
    const shader = {
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
      uniforms: {} as Record<string, T.IUniform>,
    } as unknown as T.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    const fragment = shader.fragmentShader;
    // The front face keeps the printed map; only back faces are replaced.
    expect(fragment.indexOf('if (!gl_FrontFacing) diffuseColor.rgb = printedBack;')).toBeGreaterThan(
      fragment.indexOf('#include <map_fragment>'),
    );
    expect(fragment).toContain('uniform vec3 printedBack;');
    expect((shader.uniforms.printedBack.value as T.Color).getHex()).toBe(0x2b3236);
    expect(material.customProgramCacheKey()).toContain('unprinted-back-v1');
    expect(material.side).toBe(T.DoubleSide);
  });
});
