import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { installMotocrossPlasticFinish } from '../src/rendering/offroad/motocross-detail.ts';
import { studioHookKeys, type StudioShader } from '../src/rendering/studio/shader-hooks.ts';

function compiled(material: T.MeshPhysicalMaterial) {
  const source = T.ShaderLib.physical,
    shader = {
      vertexShader: source.vertexShader,
      fragmentShader: source.fragmentShader,
      uniforms: T.UniformsUtils.clone(source.uniforms),
    } as StudioShader;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  return shader;
}
const count = (text: string, token: string) => text.split(token).length - 1;

describe('motocross moulded plastic finish', () => {
  it('chains once and adds boot-wear zones, whitened scratches and a desaturated service colour', () => {
    const material = new T.MeshPhysicalMaterial({ color: 0x6a2cd8, roughness: 0.4 });
    installMotocrossPlasticFinish(material);
    installMotocrossPlasticFinish(material);
    expect(
      studioHookKeys(material).filter((k) => k.startsWith('motocross-moulded-polymer')),
    ).toEqual(['motocross-moulded-polymer-v2']);
    const shader = compiled(material);
    // Wear lives in the part's own frame (the sprung frame for batched meshes).
    expect(shader.vertexShader).toContain('vMxPlasticPosition = position;');
    expect(shader.fragmentShader).toContain('float boot=');
    expect(shader.fragmentShader).toContain('mxPlasticWear=');
    expect(shader.fragmentShader).toContain('mix(vec3(luma),diffuseColor.rgb,.9)');
    expect(count(shader.fragmentShader, '{')).toBe(count(shader.fragmentShader, '}'));
    expect(count(shader.fragmentShader, '(')).toBe(count(shader.fragmentShader, ')'));
    // Derivative filters read the part position, never a value derived from the wear.
    expect(shader.fragmentShader).toContain('float resolved=1.-smoothstep(.003,.012,footprint);');
  });
});
