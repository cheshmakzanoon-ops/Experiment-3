import { afterEach, expect, it, vi } from 'vitest';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { SkyEnvironment, configureSky } from '../src/rendering/daylight.ts';
import { installWetRoad, installStableSurfaceBump } from '../src/rendering/materials.ts';

afterEach(() => vi.restoreAllMocks());
it('recaptures bounded sky bins, restores live uniforms and disposes replaced outputs exactly once', () => {
  const sky = new Sky();
  configureSky(sky);
  sky.material.uniforms.cloudCover.value = 0.37;
  sky.material.uniforms.turbidity.value = 4.65;
  sky.material.uniforms.skyRadiance.value = 0.394;
  const samples: number[] = [],
    outputs: T.WebGLRenderTarget[] = [];
  const render = vi.spyOn(T.PMREMGenerator.prototype, 'fromScene').mockImplementation((scene) => {
    const material = (scene.children[0] as Sky).material;
    samples.push(material.uniforms.cloudCover.value);
    expect(material.uniforms.skyRadiance.value).toBeCloseTo(
      0.32 + material.uniforms.cloudCover.value * 0.2,
      8,
    );
    const target = new T.WebGLRenderTarget(8, 8);
    outputs.push(target);
    return target;
  });
  const generatorDispose = vi.spyOn(T.PMREMGenerator.prototype, 'dispose');
  // PMREM's constructor only compiles a null initial material; capture is mocked
  // here. The browser fixture separately exercises actual shader/GPU behavior.
  const renderer = { compile: () => {} } as unknown as T.WebGLRenderer;
  const scene = new T.Scene(),
    environment = new SkyEnvironment(sky);
  expect(environment.update(renderer, scene, 0.36)).toBe(true);
  const disposeFirst = vi.spyOn(outputs[0], 'dispose');
  expect(environment.update(renderer, scene, 0.38)).toBe(false);
  expect(environment.update(renderer, scene, 0.8)).toBe(true);
  expect(disposeFirst).toHaveBeenCalledTimes(1);
  expect(environment.update(renderer, scene, 0.36)).toBe(true);
  expect(samples).toEqual([0.375, 0.75, 0.375]);
  expect(render).toHaveBeenCalledTimes(3);
  expect(scene.environment).toBe(outputs[2].texture);
  expect(sky.material.uniforms.cloudCover.value).toBe(0.37);
  expect(sky.material.uniforms.turbidity.value).toBe(4.65);
  expect(sky.material.uniforms.skyRadiance.value).toBe(0.394);
  expect(generatorDispose).toHaveBeenCalledTimes(3);
  const lastDispose = vi.spyOn(outputs[2], 'dispose');
  environment.dispose();
  environment.dispose();
  expect(lastDispose).toHaveBeenCalledTimes(1);
  sky.geometry.dispose();
  sky.material.dispose();
});
it('does not publish a failed sky capture, lose the previous texture or poison its bin', () => {
  const sky = new Sky();
  configureSky(sky);
  const output = new T.WebGLRenderTarget(8, 8),
    dispose = vi.spyOn(output, 'dispose');
  const capture = vi.spyOn(T.PMREMGenerator.prototype, 'fromScene').mockReturnValue(output);
  const generatorDispose = vi.spyOn(T.PMREMGenerator.prototype, 'dispose');
  const renderer = { compile: () => {} } as unknown as T.WebGLRenderer;
  const scene = new T.Scene(),
    environment = new SkyEnvironment(sky);
  environment.update(renderer, scene, 0);
  capture.mockImplementationOnce(() => {
    throw new Error('Injected GPU capture failure');
  });
  expect(() => environment.update(renderer, scene, 1)).toThrow('Injected GPU');
  expect(scene.environment).toBe(output.texture);
  expect(dispose).not.toHaveBeenCalled();
  expect(environment.captures).toBe(1);
  expect(sky.material.uniforms.cloudCover.value).toBe(0);
  expect(sky.material.uniforms.skyRadiance.value).toBe(0.32);
  expect(environment.update(renderer, scene, 0)).toBe(false);
  expect(generatorDispose).toHaveBeenCalledTimes(2);
  expect(() => environment.update(renderer, scene, NaN)).toThrow('Non-finite');
  environment.dispose();
  sky.geometry.dispose();
  sky.material.dispose();
});
it('shares actual water channels and normal flattening without inventing pit rubber', () => {
  const state = new T.DataTexture(new Uint8Array(16), 2, 2);
  for (const deposits of [true, false]) {
    const material = new T.MeshStandardMaterial();
    installWetRoad(material, state, deposits);
    const shader = {
      uniforms: {},
      vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
    } as T.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.uniforms.trackState.value).toBe(state);
    expect(shader.uniforms.surfaceDeposits.value).toBe(deposits ? 1 : 0);
    expect(shader.fragmentShader).toContain('roadState.gb *= surfaceDeposits');
    expect(shader.fragmentShader).toContain('mix(normal, dryRoadNormal, wet * 0.9)');
    expect(shader.fragmentShader).toContain('#include <normal_fragment_maps>');
    material.dispose();
  }
  state.dispose();
});

it('retains singular-derivative normal guards through wet-road shader composition', () => {
  const material = new T.MeshStandardMaterial();
  const state = new T.DataTexture(new Uint8Array(16), 2, 2);
  installStableSurfaceBump(material);
  installWetRoad(material, state, true);
  const shader = {
    uniforms: {},
    vertexShader: T.ShaderLib.standard.vertexShader,
    fragmentShader: T.ShaderLib.standard.fragmentShader,
  } as T.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as T.WebGLRenderer);
  expect(shader.fragmentShader).toContain('if (min(dx2, dy2) < 1e-16) return surf_norm;');
  expect(shader.fragmentShader).toContain('if (abs(fDet) < 1e-7) return surf_norm;');
  expect(shader.fragmentShader).toContain(
    'normal2 > 1e-16 ? perturbed * inversesqrt(normal2) : surf_norm;',
  );
  expect(shader.fragmentShader).not.toContain('normalize( dFdx( surf_pos.xyz ) )');
  expect(shader.fragmentShader).not.toContain('#include <bumpmap_pars_fragment>');
  expect(shader.fragmentShader).toContain('roadState.gb *= surfaceDeposits');
  material.dispose();
  state.dispose();
});
