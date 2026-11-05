import * as T from 'three';
import { describe, expect, it } from 'vitest';
import { SceneAmbientPass } from '../src/rendering/scene-ambient-pass.ts';
import {
  SOFT_PARTICLE_GLSL,
  bindSoftParticleDepth,
  createSoftParticleUniforms,
  softParticleFade,
  softParticleUniforms,
} from '../src/rendering/soft-particles.ts';

function fakeRenderer(log: string[] = []) {
  return {
    autoClear: true,
    shadowMap: { autoUpdate: true },
    setRenderTarget: () => {},
    render: () => log.push('render'),
  } as unknown as T.WebGLRenderer;
}

describe('soft particle depth', () => {
  it('declares the sampler, range, validity and the fade function once', () => {
    for (const name of [
      'uniform sampler2D apexSceneDepth',
      'uniform vec2 apexSceneDepthSize',
      'uniform vec2 apexSceneDepthRange',
      'uniform float apexSceneDepthValid',
      'float apexSoftParticle(float viewDepth, float softness)',
    ])
      expect(SOFT_PARTICLE_GLSL).toContain(name);
    expect(SOFT_PARTICLE_GLSL).toContain('#ifndef APEX_SOFT_PARTICLE_DECLARED');
    // Unreadable depth and sky both leave the particle fully visible.
    expect(SOFT_PARTICLE_GLSL).toContain('if (apexSceneDepthValid < 0.5) return 1.0;');
    expect(SOFT_PARTICLE_GLSL).toContain('if (d >= 0.99999) return 1.0;');
  });

  it('linearises depth exactly like three packing.glsl perspectiveDepthToViewZ', () => {
    const near = 0.1,
      far = 1000;
    for (const d of [0, 0.3, 0.9, 0.99, 0.9999]) {
      // three: viewZ = near * far / ((far - near) * invClipZ - far), distance = -viewZ.
      const three = -(near * far) / ((far - near) * d - far);
      const ndc = d * 2 - 1;
      const shader = (2 * near * far) / (far + near - ndc * (far - near));
      expect(shader).toBeCloseTo(three, 6);
    }
  });

  it('fades from 0 at the surface to 1 one softness in front of it', () => {
    expect(softParticleFade(10, 10, 0.5)).toBe(0);
    expect(softParticleFade(10, 11, 0.5)).toBe(0);
    expect(softParticleFade(10, 9.75, 0.5)).toBeCloseTo(0.5, 9);
    expect(softParticleFade(10, 9, 0.5)).toBe(1);
    expect(softParticleFade(Infinity, 9, 0.5)).toBe(1);
    expect(softParticleFade(10, 10, 0.5, false)).toBe(1);
    expect(() => softParticleFade(NaN, 1, 1)).toThrow();
  });

  it('binds the resolved depth, size, range and readability', () => {
    const camera = new T.PerspectiveCamera(50, 16 / 9, 0.2, 800);
    const depth = new T.DepthTexture(64, 36, T.FloatType);
    const multisampled = new T.WebGLRenderTarget(64, 36, { samples: 4, depthTexture: depth });
    const uniforms = createSoftParticleUniforms();
    bindSoftParticleDepth(camera, multisampled, depth, uniforms);
    expect(uniforms.apexSceneDepth.value).toBe(depth);
    expect(uniforms.apexSceneDepthSize.value.toArray()).toEqual([64, 36]);
    expect(uniforms.apexSceneDepthRange.value.toArray()).toEqual([0.2, 800]);
    expect(uniforms.apexSceneDepthValid.value).toBe(1);
    const plain = new T.WebGLRenderTarget(64, 36, { samples: 0, depthTexture: depth });
    bindSoftParticleDepth(camera, plain, depth, uniforms);
    expect(uniforms.apexSceneDepthValid.value).toBe(0);
    multisampled.dispose();
    plain.dispose();
    depth.dispose();
  });

  it('runs registered late layers after the scene draw with state restored', () => {
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
    const pass = new SceneAmbientPass(scene, camera, 2);
    pass.setSize(64, 36);
    const order: string[] = [];
    const renderer = fakeRenderer();
    const seen: { autoClear: boolean; shadows: boolean; valid: number }[] = [];
    const record = (name: string) => () => {
      order.push(name);
      seen.push({
        autoClear: renderer.autoClear,
        shadows: renderer.shadowMap.autoUpdate,
        valid: softParticleUniforms.apexSceneDepthValid.value,
      });
    };
    (renderer as unknown as { render: (o: unknown) => void }).render = (o) => {
      if (o === scene) order.push('scene');
    };
    const remove = pass.addLateLayer(record('dust'));
    pass.addLateLayer(record('spray'));
    const write = new T.WebGLRenderTarget(4, 4);
    pass.render(renderer, write);
    expect(order).toEqual(['scene', 'dust', 'spray']);
    // Layers draw on top of the resolved scene: no clear, no shadow-map pass,
    // depth readable (multisampled).
    expect(seen).toEqual([
      { autoClear: false, shadows: false, valid: 1 },
      { autoClear: false, shadows: false, valid: 1 },
    ]);
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    order.length = 0;
    remove();
    pass.render(renderer, write);
    expect(order).toEqual(['scene', 'spray']);
    pass.dispose();
    write.dispose();
  });

  it('restores renderer state when a layer throws', () => {
    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(50, 16 / 9, 0.1, 1000);
    const pass = new SceneAmbientPass(scene, camera, 0);
    pass.setSize(64, 36);
    const renderer = fakeRenderer();
    pass.addLateLayer(() => {
      throw new Error('layer failed');
    });
    const write = new T.WebGLRenderTarget(4, 4);
    expect(() => pass.render(renderer, write)).toThrow('layer failed');
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    pass.dispose();
    write.dispose();
  });
});
