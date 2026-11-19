import { expect, it, vi } from 'vitest';
import * as T from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RacingRenderer } from '../src/rendering/renderer.ts';
import { SceneAmbientPass } from '../src/rendering/scene-ambient-pass.ts';
import { AdaptiveExposurePass } from '../src/rendering/adaptive-exposure.ts';
import { LensBloomPass } from '../src/rendering/lens-bloom.ts';
import { BroadcastGradePass } from '../src/rendering/broadcast-grade.ts';
import { programHarness } from './helpers/three-program-harness.ts';

function fixture(fxaaEnabled = false, filmic = true, gradeEnabled = true, energy = false) {
  const h = programHarness();
  h.renderer.setRenderTarget(null);
  h.renderer.toneMapping = filmic ? T.AgXToneMapping : T.ACESFilmicToneMapping;
  h.renderer.toneMappingExposure = 1.13;
  const clear = vi.fn();
  Object.assign(h.renderer, { getPixelRatio: () => 1, clear });
  const composer = new EffectComposer(
    h.renderer,
    new T.WebGLRenderTarget(960, 600, { type: T.HalfFloatType }),
  );
  composer.writeBuffer.texture.name = 'composer A';
  composer.readBuffer.texture.name = 'composer B';
  const scenePass = new SceneAmbientPass(new T.Scene(), new T.PerspectiveCamera(), 4),
    exposure = new AdaptiveExposurePass(),
    bloom = new LensBloomPass(),
    output = new OutputPass(),
    fxaa = new ShaderPass(FXAAShader),
    grade = new BroadcastGradePass();
  fxaa.enabled = fxaaEnabled;
  grade.enabled = gradeEnabled;
  grade.filmic = filmic;
  bloom.energyConserving = energy;
  for (const pass of [scenePass, exposure, bloom, output, fxaa, grade]) composer.addPass(pass);
  // Scene/resolve and readback behavior have their own native-owner tests.
  // The real composer still owns ordering, swaps and screen selection here.
  vi.spyOn(scenePass, 'render').mockImplementation(() => {});
  const owner = {
    disposed: false,
    renderer: h.renderer,
    composer,
    scenePass,
    exposure,
    bloom,
    fxaa,
    grade,
    graphics: { autoExposure: true },
    photo: null,
  };
  const submissions: object[] = [];
  const render = h.renderer.render;
  const uniforms = (material: T.ShaderMaterial) =>
    Object.fromEntries(
      Object.entries(material.uniforms).map(([key, uniform]) => {
        const value = uniform.value;
        return [key, value instanceof T.Texture ? value.name : (value?.toArray?.() ?? value)];
      }),
    );
  h.renderer.render = (object, camera) => {
    const material = (object as T.Mesh).material as T.ShaderMaterial,
      target = h.renderer.getRenderTarget();
    render.call(h.renderer, object, camera);
    const native = [...h.owners.get(material)!.values()].at(-1)!;
    submissions.push({
      vertex: material.vertexShader,
      fragment: material.fragmentShader,
      native: h.created.find((program) => program === native.program)!.shaders,
      defines: { ...material.defines },
      uniforms: uniforms(material),
      target: target?.texture.name ?? 'screen',
      size: target ? [target.width, target.height] : [960, 600],
      type: target?.texture.type,
      colorSpace: target?.texture.colorSpace,
      autoClear: h.renderer.autoClear,
      toneMapping: h.renderer.toneMapping,
      blending: material.blending,
      blendDst: material.blendDst,
      blendAlpha: material.blendAlpha,
      transparent: material.transparent,
      camera: { position: camera.position.toArray(), quaternion: camera.quaternion.toArray() },
    });
  };
  return {
    ...h,
    owner,
    composer,
    scenePass,
    exposure,
    bloom,
    output,
    fxaa,
    grade,
    submissions,
    clear,
    prepare: (cancelled: () => boolean = () => false) =>
      RacingRenderer.prototype.preparePostProcessing.call(
        owner as unknown as RacingRenderer,
        cancelled,
      ),
    dispose() {
      for (const pass of composer.passes) pass.dispose();
      composer.dispose();
    },
  };
}

it.each([
  { fxaa: false, filmic: true, grade: true, energy: false },
  { fxaa: false, filmic: false, grade: true, energy: false },
  { fxaa: true, filmic: true, grade: true, energy: false },
  { fxaa: false, filmic: true, grade: false, energy: false },
  { fxaa: false, filmic: true, grade: true, energy: true },
])(
  'prepares exact native composer consumers: $fxaa FXAA / $filmic filmic / $grade grade / $energy energy',
  async ({ fxaa, filmic, grade, energy }) => {
    const cold = fixture(fxaa, filmic, grade, energy),
      warm = fixture(fxaa, filmic, grade, energy);
    try {
      const before = warm.state(),
        flags = warm.composer.passes.map((pass) => pass.renderToScreen);
      const buffers = [warm.composer.readBuffer, warm.composer.writeBuffer];
      const exposure = warm.exposure.diagnostics();
      const outputUniforms = Object.values(warm.output.uniforms).map((uniform) => uniform.value);
      const bloomQuad = (warm.bloom as unknown as { quad: { material: T.Material } }).quad;
      const previousQuad = bloomQuad.material;
      warm.output.clear = true;
      cold.output.clear = true;
      await warm.prepare();
      expect(warm.state()).toEqual(before);
      expect(warm.composer.passes.map((pass) => pass.renderToScreen)).toEqual(flags);
      expect([warm.composer.readBuffer, warm.composer.writeBuffer]).toEqual(buffers);
      expect(warm.exposure.diagnostics()).toEqual(exposure);
      expect(Object.values(warm.output.uniforms).map((uniform) => uniform.value)).toEqual(
        outputUniforms,
      );
      expect(bloomQuad.material).toBe(previousQuad);
      expect(warm.render).not.toHaveBeenCalled();
      expect(warm.clear).not.toHaveBeenCalled();
      expect(warm.output.material.defines).toEqual({
        SRGB_TRANSFER: '',
        [filmic ? 'AGX_TONE_MAPPING' : 'ACES_FILMIC_TONE_MAPPING']: '',
      });
      expect(warm.owners.has(warm.fxaa.material)).toBe(fxaa);
      const programs = [...warm.cache.programs],
        queries = [...warm.queries];
      const keys = [...warm.owners].map(([material, owned]) => [material, [...owned.keys()]]);
      warm.stage('after-scene');
      cold.stage('after-scene');
      cold.composer.render(1 / 120);
      warm.composer.render(1 / 120);
      // Every original pyramid, output, optional FXAA and grade draw retains
      // its full shader, target, uniforms, blending and camera state.
      expect(warm.submissions).toEqual(cold.submissions);
      expect(warm.submissions).toHaveLength(14 + 1 + Number(fxaa) + Number(grade));
      expect(warm.cache.programs).toEqual(programs);
      expect([...warm.owners].map(([material, owned]) => [material, [...owned.keys()]])).toEqual(
        keys,
      );
      expect(warm.queries).toEqual(queries);
      expect(warm.clear.mock.calls).toEqual(cold.clear.mock.calls);
      expect(warm.submissions.at(-1)).toMatchObject({ target: 'screen' });
      for (const query of cold.queries.filter((query) => query.kind === 'program-log'))
        expect(query.stage).toBe('after-scene');
    } finally {
      cold.dispose();
      warm.dispose();
    }
  },
);

it.each(['cancelled', 'disposed'] as const)(
  'restores native output state before await and stops remaining owners when %s',
  async (reason) => {
    const h = fixture(),
      before = h.state(),
      flags = h.composer.passes.map((pass) => pass.renderToScreen);
    const compile = h.renderer.compileAsync.bind(h.renderer);
    let finish: (object: T.Object3D) => void = () => {},
      object!: T.Object3D,
      cancelled = false;
    let reached: () => void = () => {};
    const atOutput = new Promise<void>((resolve) => {
      reached = resolve;
    });
    h.renderer.compileAsync = (root, camera, scene) => {
      if ((root as T.Mesh).material !== h.output.material) return compile(root, camera, scene);
      h.renderer.compile(root, camera, scene);
      object = root;
      reached();
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const pending = h.prepare(() => cancelled);
    await atOutput;
    expect(h.state()).toEqual(before);
    expect(h.composer.passes.map((pass) => pass.renderToScreen)).toEqual(flags);
    expect((h.output.uniforms as Record<string, T.IUniform>).tDiffuse.value).toBeNull();
    const queries = [...h.queries];
    if (reason === 'disposed') {
      h.owner.disposed = true;
      h.dispose();
      h.retire();
    } else cancelled = true;
    finish(object);
    await pending;
    expect(h.queries).toEqual(queries);
    expect(h.render).not.toHaveBeenCalled();
    expect(h.clear).not.toHaveBeenCalled();
    if (reason !== 'disposed') h.dispose();
  },
);

it('propagates native output compilation failure, restores borrowed state and permits retry', async () => {
  const h = fixture(),
    before = h.state(),
    flags = h.composer.passes.map((pass) => pass.renderToScreen);
  try {
    h.failCompile(h.output.material.name);
    await expect(h.prepare()).rejects.toThrow('Interrupted');
    expect(h.state()).toEqual(before);
    expect(h.composer.passes.map((pass) => pass.renderToScreen)).toEqual(flags);
    expect((h.output.uniforms as Record<string, T.IUniform>).tDiffuse.value).toBeNull();
    expect(h.render).not.toHaveBeenCalled();
    h.failCompile(null);
    await h.prepare();
    const programs = [...h.cache.programs];
    h.composer.render(1 / 120);
    expect(h.cache.programs).toEqual(programs);
  } finally {
    h.dispose();
  }
});
