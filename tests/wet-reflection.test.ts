import { describe, it, expect } from 'vitest';
import * as T from 'three';
import {
  WET_REFLECTION,
  WET_REFLECTION_GLSL,
  WET_REFLECTION_LAYER,
  WetRoadReflection,
  reflectInWetRoad,
} from '../src/rendering/wet-reflection.ts';
import { installWetRoad } from '../src/rendering/materials.ts';

/** Records calls in place of a WebGL renderer. */
function fakeRenderer(width = 1600, height = 900) {
  const calls: string[] = [];
  const renderer = {
    shadowMap: { autoUpdate: true, needsUpdate: true },
    target: null as T.WebGLRenderTarget | null,
    getDrawingBufferSize: (v: T.Vector2) => v.set(width, height),
    getRenderTarget() {
      return this.target;
    },
    setRenderTarget(t: T.WebGLRenderTarget | null) {
      this.target = t;
      calls.push(t ? 'target' : 'screen');
    },
    getViewport: (v: T.Vector4) => v.set(0, 0, width, height),
    setViewport: () => calls.push('viewport'),
    clear: () => calls.push('clear'),
    render(_scene: T.Scene, camera: T.Camera) {
      calls.push(`render:${camera.layers.mask}:${this.shadowMap.autoUpdate}`);
    },
  };
  return { renderer: renderer as unknown as T.WebGLRenderer, calls, state: renderer };
}
const project = (m: T.Matrix4, p: T.Vector3) => {
  const v = new T.Vector4(p.x, p.y, p.z, 1).applyMatrix4(m);
  return new T.Vector2(v.x / v.w, v.y / v.w);
};

describe('wet-road planar reflection', () => {
  const camera = new T.PerspectiveCamera(58, 16 / 9, 0.1, 5000);
  camera.position.set(3, 4.2, 12);
  camera.lookAt(0, 1, -20);
  camera.updateMatrixWorld();
  it('mirrors the view so a reflected point lands where the water shows it', () => {
    const reflection = new WetRoadReflection();
    const { renderer, calls } = fakeRenderer();
    const planeY = 1.25;
    reflection.update(renderer, new T.Scene(), camera, planeY, 1);
    const mirror = reflection.camera;
    expect(mirror.position.x).toBeCloseTo(3, 9);
    expect(mirror.position.z).toBeCloseTo(12, 9);
    expect(mirror.position.y).toBeCloseTo(2 * planeY - 4.2, 9);
    const matrix = reflection.uniforms.wetReflectionMatrix.value;
    // A car panel above the water, its mirror image, and the water fragment on
    // the main camera's ray to that image: the fragment must sample the panel.
    for (const q of [new T.Vector3(-1.5, 2.1, -8), new T.Vector3(4, 1.6, -30), new T.Vector3(0, 9, -60)]) {
      const image = q.clone().setY(2 * planeY - q.y);
      const eye = camera.position;
      const t = (planeY - eye.y) / (image.y - eye.y);
      const fragment = eye.clone().lerp(image, t);
      expect(fragment.y).toBeCloseTo(planeY, 9);
      const a = project(matrix, fragment),
        b = project(matrix, q);
      expect(a.distanceTo(b)).toBeLessThan(1e-6);
      expect(a.x).toBeGreaterThan(0);
      expect(a.x).toBeLessThan(1);
    }
    // Geometry below the water is removed by the oblique near plane.
    const clip = (p: T.Vector3) =>
      new T.Vector4(p.x, p.y, p.z, 1)
        .applyMatrix4(mirror.matrixWorldInverse)
        .applyMatrix4(mirror.projectionMatrix);
    const below = clip(new T.Vector3(0, planeY - 0.5, -20));
    const above = clip(new T.Vector3(0, planeY + 0.5, -20));
    expect(below.z).toBeLessThan(-below.w);
    expect(above.z).toBeGreaterThan(-above.w);
    expect(reflection.uniforms.wetReflectionState.value.x).toBe(planeY);
    expect(reflection.uniforms.wetReflectionState.value.y).toBe(1);
    // Probe and mirror passes see the road from other viewpoints: the texture
    // and matrix above belong to this camera, so sampling stops until the
    // next update.
    reflection.suspend();
    expect(reflection.uniforms.wetReflectionState.value.y).toBe(0);
    // Only the opted-in layer, at half the drawing buffer on High, without a
    // second shadow-map render; the previous target is restored.
    expect(calls).toContain(`render:${1 << WET_REFLECTION_LAYER}:false`);
    expect(calls.at(-2)).toBe('screen');
    expect(reflection.target.width).toBe(800);
    expect(reflection.target.height).toBe(450);
    expect(reflection.passes).toBe(1);
  });
  it('skips the pass when dry, on Low, or with the camera under the water', () => {
    const reflection = new WetRoadReflection();
    const { renderer, calls } = fakeRenderer();
    reflection.update(renderer, new T.Scene(), camera, 1, 0);
    expect(reflection.uniforms.wetReflectionState.value.y).toBe(0);
    reflection.update(renderer, new T.Scene(), camera, 10, 1);
    expect(reflection.uniforms.wetReflectionState.value.y).toBe(0);
    reflection.setQuality('low');
    expect(reflection.enabled).toBe(false);
    reflection.update(renderer, new T.Scene(), camera, 1, 1);
    expect(calls).toEqual([]);
    expect(reflection.passes).toBe(0);
    reflection.setQuality('medium');
    reflection.update(renderer, new T.Scene(), camera, 1, 1);
    expect(reflection.target.width).toBe(Math.round(1600 * WET_REFLECTION.scale.medium));
  });
  it('opts whole subtrees (and lights) into the reflection layer', () => {
    const root = new T.Group();
    const child = new T.Mesh();
    const light = new T.PointLight();
    root.add(child, light);
    reflectInWetRoad(root);
    for (const o of [root, child, light]) expect(o.layers.isEnabled(WET_REFLECTION_LAYER)).toBe(true);
    // Default layer membership is kept: the main view still draws them.
    expect(child.layers.isEnabled(0)).toBe(true);
  });
  it('routes the reflection through the road water-film lobe only', () => {
    const reflection = new WetRoadReflection();
    const make = (withReflection: boolean) => {
      const material = new T.MeshPhysicalMaterial({ clearcoat: 1 });
      const state = new T.DataTexture(new Uint8Array(4), 1, 1);
      installWetRoad(material, state, true, 0, withReflection ? reflection.uniforms : undefined);
      const shader = {
        vertexShader: T.ShaderLib.physical.vertexShader,
        fragmentShader: T.ShaderLib.physical.fragmentShader,
        uniforms: {} as Record<string, T.IUniform>,
      } as unknown as T.WebGLProgramParametersWithUniforms;
      material.onBeforeCompile(shader, {} as T.WebGLRenderer);
      return { material, shader };
    };
    const lit = make(true),
      plain = make(false);
    expect(lit.shader.fragmentShader).toContain('clearcoatRadiance = mix(clearcoatRadiance, wetReflectionColor');
    expect(lit.shader.fragmentShader.indexOf('wetReflectionColor')).toBeGreaterThan(
      lit.shader.fragmentShader.indexOf('getIBLRadiance( geometryViewDir, geometryClearcoatNormal'),
    );
    expect(lit.shader.uniforms.wetReflection.value).toBe(reflection.target.texture);
    expect(plain.shader.fragmentShader).not.toContain('wetReflection');
    expect(lit.material.customProgramCacheKey()).toContain('wet-planar-v1');
    expect(plain.material.customProgramCacheKey()).not.toContain('wet-planar');
    expect(WET_REFLECTION_GLSL).toContain('#ifdef USE_CLEARCOAT');
  });
});
