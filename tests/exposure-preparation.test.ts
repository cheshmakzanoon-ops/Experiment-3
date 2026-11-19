import { expect, it, vi } from 'vitest';
import * as T from 'three';
import { AdaptiveExposurePass } from '../src/rendering/adaptive-exposure.ts';
import { programHarness } from './helpers/three-program-harness.ts';

function fixture() {
  const h = programHarness(),
    pass = new AdaptiveExposurePass(),
    owner = pass as unknown as { material: T.ShaderMaterial; target: T.WebGLRenderTarget },
    source = new T.WebGLRenderTarget(960, 600, { type: T.HalfFloatType });
  let finishRead: () => void = () => {};
  const reads = vi.fn(
    (
      _target: T.WebGLRenderTarget,
      _x: number,
      _y: number,
      _w: number,
      _h: number,
      pixels: Uint8Array,
    ) =>
      new Promise<Uint8Array>((resolve) => {
        finishRead = () => resolve(pixels);
      }),
  );
  Object.assign(h.renderer, { readRenderTargetPixelsAsync: reads });
  Object.assign(h.renderer.getContext(), {
    isContextLost: () => false,
    PIXEL_PACK_BUFFER: 35051,
    bindBuffer: vi.fn(),
  });
  return {
    ...h,
    pass,
    owner,
    source,
    reads,
    async finishRead() {
      finishRead();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
    dispose() {
      pass.dispose();
      source.dispose();
    },
  };
}

it('prepares the actual 16x12 meter owner without drawing, reading or advancing adaptation', async () => {
  const cold = fixture(),
    warm = fixture();
  try {
    const before = warm.state(),
      diagnostics = warm.pass.diagnostics();
    const generation = warm.pass.adaptation.generation;
    const uniforms = { ...warm.owner.material.uniforms };
    const targetDispose = vi.fn();
    warm.owner.target.addEventListener('dispose', targetDispose);
    await warm.pass.prepareMaterial(warm.renderer, () => false);
    expect(warm.state()).toEqual(before);
    expect(warm.pass.diagnostics()).toEqual(diagnostics);
    expect(warm.pass.adaptation.generation).toBe(generation);
    expect(warm.owner.material.uniforms).toEqual(uniforms);
    expect(warm.owner.material.uniforms.tScene.value).toBeNull();
    expect(warm.render).not.toHaveBeenCalled();
    expect(warm.reads).not.toHaveBeenCalled();
    const prepared = [...warm.owners.get(warm.owner.material)!.values()][0];
    const queries = [...warm.queries];
    expect(queries.filter((query) => query.kind === 'program-log')).toEqual([
      { kind: 'program-log', program: prepared.program, stage: 'before-scene' },
    ]);
    for (const h of [cold, warm]) {
      h.stage('after-scene');
      h.pass.prepare(0, 'day:chase:-1:0', 1, true);
      h.pass.render(h.renderer, h.source, h.source);
      expect(h.render).toHaveBeenCalledOnce();
      expect(h.reads).toHaveBeenCalledExactlyOnceWith(
        h.owner.target,
        0,
        0,
        16,
        12,
        expect.any(Uint8Array),
      );
      expect(h.owner.target.texture.type).toBe(T.UnsignedByteType);
      expect(h.owner.target.texture.colorSpace).toBe(T.NoColorSpace);
      expect(h.owner.material.uniforms.tScene.value).toBe(h.source.texture);
    }
    const unprepared = [...cold.owners.get(cold.owner.material)!.values()][0];
    expect(cold.queries.filter((query) => query.kind === 'program-log')).toEqual([
      { kind: 'program-log', program: unprepared.program, stage: 'after-scene' },
    ]);
    // Shader-source IDs are globally allocated across independent caches;
    // compare complete shaders across caches and the exact retained key/owner
    // within the prepared cache's actual native consumer.
    expect(warm.created[0].shaders).toEqual(cold.created[0].shaders);
    expect([...warm.owners.get(warm.owner.material)!.values()]).toEqual([prepared]);
    expect([...warm.owners.get(warm.owner.material)!.keys()]).toEqual([prepared.cacheKey]);
    expect(warm.queries).toEqual(queries);
    // Reentry cannot read a second frame or release a target owned by the
    // real asynchronous read. Disposal still waits for that read to settle.
    const pending = warm.pass.diagnostics();
    await warm.pass.prepareMaterial(warm.renderer, () => false);
    expect(warm.pass.diagnostics()).toEqual(pending);
    expect(warm.reads).toHaveBeenCalledOnce();
    warm.pass.dispose();
    expect(targetDispose).not.toHaveBeenCalled();
    await warm.finishRead();
    expect(targetDispose).toHaveBeenCalledOnce();
    await cold.finishRead();
  } finally {
    cold.dispose();
    warm.dispose();
  }
});

it.each(['disabled', 'cancelled', 'disposed'] as const)(
  'does no native preparation while %s',
  async (state) => {
    const h = fixture();
    if (state === 'disabled') h.pass.enabled = false;
    if (state === 'disposed') h.pass.dispose();
    const before = h.state();
    await h.pass.prepareMaterial(h.renderer, () => state === 'cancelled');
    expect(h.created).toEqual([]);
    expect(h.queries).toEqual([]);
    expect(h.render).not.toHaveBeenCalled();
    expect(h.reads).not.toHaveBeenCalled();
    expect(h.state()).toEqual(before);
    h.dispose();
  },
);

it.each(['cancelled', 'disposed'] as const)(
  'restores renderer state before awaiting and skips late metadata when %s',
  async (state) => {
    const h = fixture(),
      before = h.state();
    let cancelled = false,
      finish: (object: T.Object3D) => void = () => {};
    let compiled!: T.Object3D;
    h.renderer.compileAsync = (object, camera) => {
      h.renderer.compile(object, camera);
      compiled = object;
      return new Promise((resolve) => {
        finish = resolve;
      });
    };
    const pending = h.pass.prepareMaterial(h.renderer, () => cancelled);
    expect(h.state()).toEqual(before);
    expect(h.created).toHaveLength(1);
    expect(h.queries).toEqual([]);
    if (state === 'disposed') {
      h.pass.dispose();
      h.retire();
    } else cancelled = true;
    finish(compiled);
    await pending;
    expect(h.queries).toEqual([]);
    expect(h.render).not.toHaveBeenCalled();
    expect(h.reads).not.toHaveBeenCalled();
    h.dispose();
  },
);

it('propagates preparation failure and restores state without recording a measurement failure', async () => {
  const h = fixture(),
    before = h.state(),
    diagnostics = h.pass.diagnostics();
  h.failCompile('');
  await expect(h.pass.prepareMaterial(h.renderer, () => false)).rejects.toThrow('Interrupted');
  expect(h.state()).toEqual(before);
  expect(h.pass.diagnostics()).toEqual(diagnostics);
  expect(h.queries).toEqual([]);
  expect(h.render).not.toHaveBeenCalled();
  expect(h.reads).not.toHaveBeenCalled();
  h.failCompile(null);
  await h.pass.prepareMaterial(h.renderer, () => false);
  expect(h.created).toHaveLength(1);
  expect(h.queries.filter((query) => query.kind === 'program-log')).toHaveLength(1);
  h.dispose();
});
