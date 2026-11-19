import { expect, it } from 'vitest';
import * as T from 'three';
import { ReflectionSystem } from '../src/rendering/reflections.ts';
import { programHarness } from './helpers/three-program-harness.ts';

function captureSky(h: ReturnType<typeof programHarness>, count: number) {
  const submissions: unknown[] = [];
  const backgroundPrograms: T.WebGLProgram[] = [];
  const backgroundKeys: string[] = [];
  const backgroundShaders: unknown[] = [];
  const originalRender = h.renderer.render;
  h.renderer.render = (root, camera) => {
    const state = h.state();
    const material = (root as T.Mesh).material as T.MeshBasicMaterial | undefined;
    submissions.push({
      owner: material?.name ?? root.type,
      width: state.target?.width,
      height: state.target?.height,
      viewport: state.target?.viewport.toArray(),
      toneMapping: h.renderer.toneMapping,
      autoClear: h.renderer.autoClear,
      camera: {
        position: camera.position.toArray(),
        up: camera.up.toArray(),
        quaternion: camera.quaternion.toArray(),
      },
    });
    originalRender.call(h.renderer, root, camera);
    if (material?.name === 'PMREM.Background')
      for (const program of h.owners.get(material)!.values()) {
        backgroundPrograms.push(program);
        backgroundKeys.push(program.cacheKey);
        backgroundShaders.push(h.created.find((handle) => handle === program.program)!.shaders);
      }
  };
  try {
    for (let bin = 0; bin < count; bin++) {
      h.stage(`sky-bin-${bin}`);
      const generator = new T.PMREMGenerator(h.renderer);
      const scene = new T.Scene();
      scene.background = new T.Color(0.2 + bin * 0.1, 0.3, 0.4);
      const target = generator.fromScene(scene, 0.04, 0.1, 700000, { size: 256 });
      expect(scene.background).toEqual(new T.Color(0.2 + bin * 0.1, 0.3, 0.4));
      generator.dispose();
      target.dispose();
    }
  } finally {
    h.renderer.render = originalRender;
  }
  return { submissions, backgroundPrograms, backgroundKeys, backgroundShaders };
}

it('retains the native background program across sky bins without changing any capture submission', () => {
  const cold = programHarness(),
    warm = programHarness(),
    reflection = new ReflectionSystem(),
    target = new T.WebGLRenderTarget(960, 600, { type: T.HalfFloatType });
  const initialState = warm.state(),
    initialToneMapping = warm.renderer.toneMapping;
  reflection.beginProbePreparation(warm.renderer, target);
  expect(warm.render).not.toHaveBeenCalled();
  expect(warm.state()).toEqual(initialState);
  expect(warm.renderer.toneMapping).toBe(initialToneMapping);
  reflection.completeProbePreparation();
  const prepared = warm.cache.programs.find((program) => program.name === 'PMREM.Background')!;
  expect(prepared).toBeDefined();

  const original = captureSky(cold, 3);
  const retained = captureSky(warm, 3);
  // The installed consumer still emits every background, sky and blur draw,
  // with the same cube cameras, target dimensions and atlas viewports.
  expect(retained.submissions).toEqual(original.submissions);
  expect(retained.backgroundPrograms).toHaveLength(18);
  expect(new Set(original.backgroundPrograms).size).toBe(3);
  expect(new Set(retained.backgroundPrograms)).toEqual(new Set([prepared]));
  for (const key of original.backgroundKeys) expect(key).toBe(prepared.cacheKey);
  const warmHandle = warm.created.find((program) => program === prepared.program)!;
  expect(warmHandle.shaders).toEqual(original.backgroundShaders[0]);
  expect(warm.queries.filter((query) => query.program === prepared.program)).toEqual([
    { kind: 'program-log', program: prepared.program, stage: 'before-scene' },
  ]);
  expect(prepared.usedTimes).toBe(1);
  expect(warm.deleted).not.toContain(prepared.program);
  reflection.dispose();
  expect(warm.deleted.filter((program) => program === warmHandle)).toHaveLength(1);
  target.dispose();
});

it('claims an existing equivalent background program even when another material named it first', () => {
  const h = programHarness(),
    target = new T.WebGLRenderTarget(960, 600, { type: T.HalfFloatType }),
    owner = new T.MeshBasicMaterial({ name: 'Existing solid background', side: T.BackSide }),
    geometry = new T.BoxGeometry();
  h.renderer.setRenderTarget(target);
  h.renderer.compile(new T.Mesh(geometry, owner), new T.PerspectiveCamera());
  const existing = [...h.owners.get(owner)!.values()][0];
  const handle = existing.program;
  const reflection = new ReflectionSystem();
  reflection.beginProbePreparation(h.renderer, target);
  reflection.completeProbePreparation();
  expect(existing.usedTimes).toBe(2);
  const { backgroundPrograms } = captureSky(h, 2);
  expect(new Set(backgroundPrograms)).toEqual(new Set([existing]));
  expect(existing.usedTimes).toBe(2);
  reflection.dispose();
  expect(existing.usedTimes).toBe(1);
  expect(h.deleted).not.toContain(existing.program);
  owner.dispose();
  expect(h.deleted.filter((program) => program === handle)).toHaveLength(1);
  geometry.dispose();
  target.dispose();
});

it('releases all partial owners after background compilation fails and permits a clean retry', () => {
  const h = programHarness(),
    reflection = new ReflectionSystem(),
    target = new T.WebGLRenderTarget(960, 600, { type: T.HalfFloatType }),
    before = h.state(),
    toneMapping = h.renderer.toneMapping;
  h.failCompile('PMREM.Background');
  expect(() => reflection.beginProbePreparation(h.renderer, target)).toThrow(
    'Interrupted PMREM.Background compilation',
  );
  expect(h.state()).toEqual(before);
  expect(h.renderer.toneMapping).toBe(toneMapping);
  expect(h.cache.programs).toEqual([]);
  expect(new Set(h.deleted)).toEqual(new Set(h.created));
  expect(h.render).not.toHaveBeenCalled();
  h.failCompile(null);
  reflection.beginProbePreparation(h.renderer, target);
  reflection.completeProbePreparation();
  captureSky(h, 1);
  reflection.dispose();
  expect(h.cache.programs).toEqual([]);
  target.dispose();
});
