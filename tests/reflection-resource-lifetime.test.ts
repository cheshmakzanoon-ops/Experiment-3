import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { MirrorViews } from '../src/rendering/mirrors.ts';
import { ReflectionSystem } from '../src/rendering/reflections.ts';
import { ownEnvMapUniform } from '../src/rendering/studio/ibl-energy.ts';
import { programHarness } from './helpers/three-program-harness.ts';

afterEach(() => vi.restoreAllMocks());

function surfaces(count: number) {
  const originals = Array.from({ length: count }, () => new T.MeshBasicMaterial());
  const meshes = originals.map((material) => new T.Mesh(new T.BufferGeometry(), material));
  const borrowedDisposals = originals.map((material) => vi.spyOn(material, 'dispose'));
  return { meshes, originals, borrowedDisposals };
}

function mirrorFixture(count = 2) {
  const views = new MirrorViews(),
    borrowed = surfaces(count);
  views.bind(borrowed.meshes);
  const materials = borrowed.meshes.map((surface) => surface.material),
    materialDisposals = materials.map((material) => vi.spyOn(material, 'dispose')),
    targetDisposals = views.targets.map((target) => vi.spyOn(target, 'dispose'));
  return { views, ...borrowed, materials, materialDisposals, targetDisposals };
}

describe('MirrorViews resource lifetime', () => {
  it.each([2, 3])('restores %i borrowed panes and releases each owned resource once', (count) => {
    const f = mirrorFixture(count);
    f.views.dispose();
    f.views.dispose();
    expect(f.meshes.map((surface) => surface.material)).toEqual(f.originals);
    for (const release of [...f.materialDisposals, ...f.targetDisposals])
      expect(release).toHaveBeenCalledOnce();
    for (const release of f.borrowedDisposals) expect(release).not.toHaveBeenCalled();
  });

  it.each(['material', 'target'] as const)(
    'continues releasing the remaining resources after a %s disposal listener throws',
    (kind) => {
      const f = mirrorFixture(3),
        failure = new Error(`Failed ${kind} disposal`),
        resource = kind === 'material' ? f.materials[0] : f.views.targets[0];
      resource.addEventListener('dispose', () => {
        throw failure;
      });
      expect(() => f.views.dispose()).toThrow(failure);
      expect(f.meshes.map((surface) => surface.material)).toEqual(f.originals);
      for (const release of [...f.materialDisposals, ...f.targetDisposals])
        expect(release).toHaveBeenCalledOnce();
      expect(() => f.views.dispose()).not.toThrow();
      for (const release of f.borrowedDisposals) expect(release).not.toHaveBeenCalled();
    },
  );

  it('revokes ownership before a disposal listener reenters the owner', () => {
    const f = mirrorFixture();
    let reentered = false;
    f.materials[0].addEventListener('dispose', () => {
      if (reentered) return;
      reentered = true;
      f.views.dispose();
    });
    f.views.dispose();
    for (const release of [...f.materialDisposals, ...f.targetDisposals])
      expect(release).toHaveBeenCalledOnce();
  });

  it.each([new Error('First listener failed'), undefined])(
    'preserves the first thrown value while attempting every remaining release (%s)',
    (first) => {
      const f = mirrorFixture();
      f.materials[0].addEventListener('dispose', () => {
        throw first;
      });
      f.views.targets[0].addEventListener('dispose', () => {
        throw new Error('Later failure');
      });
      let failed = false,
        received: unknown;
      try {
        f.views.dispose();
      } catch (error) {
        failed = true;
        received = error;
      }
      expect(failed).toBe(true);
      expect(received).toBe(first);
      for (const release of [...f.materialDisposals, ...f.targetDisposals])
        expect(release).toHaveBeenCalledOnce();
    },
  );
});

function reflectionFixture() {
  const reflection = new ReflectionSystem(),
    h = programHarness(),
    target = new T.WebGLRenderTarget(960, 600, { type: T.HalfFloatType }),
    originalMap = new T.Texture(),
    material = new T.MeshStandardMaterial({ envMap: originalMap, envMapIntensity: 0.42 }),
    originalMapDisposal = vi.spyOn(originalMap, 'dispose'),
    materialDisposal = vi.spyOn(material, 'dispose'),
    borrowed = surfaces(2);
  reflection.attachMirrors(borrowed.meshes);
  const mirrorMaterials = borrowed.meshes.map((surface) => surface.material),
    mirrorMaterialDisposals = mirrorMaterials.map((entry) => vi.spyOn(entry, 'dispose'));
  reflection.beginProbePreparation(h.renderer, target);
  const captures: T.WebGLCubeRenderTarget[] = [];
  vi.spyOn(T.CubeCamera.prototype, 'update').mockImplementation(function (this: T.CubeCamera) {
    captures.push(this.renderTarget);
  });
  const scene = new T.Scene(),
    car = new T.Group();
  for (const time of [1, 3]) {
    reflection.beginFrame(time, false);
    reflection.updateProbe(h.renderer, scene, car, [material], true);
  }
  expect(captures).toHaveLength(2);
  expect(captures[0]).not.toBe(captures[1]);
  expect(material.envMap).not.toBe(originalMap);
  const targets = vi.spyOn(T.WebGLRenderTarget.prototype, 'dispose'),
    probeDisposals = captures.map((probe) => {
      const release = vi.fn();
      probe.addEventListener('dispose', release);
      return release;
    }),
    rendererState = h.state();
  const assertRestored = () => {
    expect(material.envMap).toBe(originalMap);
    expect(material.envMapIntensity).toBe(0.42);
    expect(ownEnvMapUniform(material).value).toBe(0);
    expect(reflection.localProbeActive).toBe(false);
    expect(borrowed.meshes.map((surface) => surface.material)).toEqual(borrowed.originals);
    expect(reflection.mirrors).toEqual([]);
    expect(h.state()).toEqual(rendererState);
    for (const release of [materialDisposal, originalMapDisposal, ...borrowed.borrowedDisposals])
      expect(release).not.toHaveBeenCalled();
  };
  return {
    reflection,
    h,
    target,
    material,
    mirrorMaterials,
    mirrorMaterialDisposals,
    captures,
    probeDisposals,
    targets,
    assertRestored,
  };
}

describe('ReflectionSystem resource lifetime', () => {
  it('releases owned targets once and cancels pending metadata work on disposal', async () => {
    const f = reflectionFixture(),
      complete = Promise.resolve().then(() => f.reflection.completeProbePreparation());
    f.reflection.dispose();
    f.h.retire();
    await complete;
    f.reflection.dispose();
    f.reflection.beginProbePreparation(f.h.renderer, f.target);
    for (const release of [...f.mirrorMaterialDisposals, ...f.probeDisposals])
      expect(release).toHaveBeenCalledOnce();
    // Two mirror feeds, two capture cubes, and the retained native ping-pong descriptor.
    expect(f.targets).toHaveBeenCalledTimes(5);
    expect(f.h.cache.programs).toEqual([]);
    expect(f.h.queries).toEqual([]);
    f.assertRestored();
  });

  it('releases mirrors and both capture cubes if native PMREM disposal throws', () => {
    const f = reflectionFixture(),
      failure = new Error('Native PMREM disposal failed'),
      nativeDispose = T.PMREMGenerator.prototype.dispose,
      dispose = vi.spyOn(T.PMREMGenerator.prototype, 'dispose').mockImplementation(function (
        this: T.PMREMGenerator,
      ) {
        nativeDispose.call(this);
        throw failure;
      });
    expect(() => f.reflection.dispose()).toThrow(failure);
    f.assertRestored();
    for (const release of [...f.mirrorMaterialDisposals, ...f.probeDisposals])
      expect(release).toHaveBeenCalledOnce();
    expect(f.targets).toHaveBeenCalledTimes(5);
    expect(f.h.cache.programs).toEqual([]);
    expect(() => f.reflection.dispose()).not.toThrow();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('restores borrowed maps and releases capture cubes after a mirror listener fails', () => {
    const f = reflectionFixture(),
      failure = new Error('Mirror listener failed');
    f.mirrorMaterials[0].addEventListener('dispose', () => {
      throw failure;
    });
    expect(() => f.reflection.dispose()).toThrow(failure);
    f.assertRestored();
    for (const release of [...f.mirrorMaterialDisposals, ...f.probeDisposals])
      expect(release).toHaveBeenCalledOnce();
    expect(f.targets).toHaveBeenCalledTimes(5);
    expect(() => f.reflection.dispose()).not.toThrow();
  });

  it('releases the second capture cube when the first cube disposal listener fails', () => {
    const f = reflectionFixture(),
      failure = new Error('First capture cube failed');
    f.captures[0].addEventListener('dispose', () => {
      throw failure;
    });
    expect(() => f.reflection.dispose()).toThrow(failure);
    f.assertRestored();
    for (const release of f.probeDisposals) expect(release).toHaveBeenCalledOnce();
    expect(() => f.reflection.dispose()).not.toThrow();
  });

  it('detaches the native preparation owner before a PMREM callback reenters disposal', () => {
    const f = reflectionFixture(),
      nativeDispose = T.PMREMGenerator.prototype.dispose;
    let reentered = false;
    const release = vi.spyOn(T.PMREMGenerator.prototype, 'dispose').mockImplementation(function (
      this: T.PMREMGenerator,
    ) {
      if (!reentered) {
        reentered = true;
        f.reflection.dispose();
      }
      nativeDispose.call(this);
    });
    f.reflection.dispose();
    expect(release).toHaveBeenCalledOnce();
    for (const dispose of [...f.mirrorMaterialDisposals, ...f.probeDisposals])
      expect(dispose).toHaveBeenCalledOnce();
    expect(f.targets).toHaveBeenCalledTimes(5);
    f.assertRestored();
  });
});
