import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import {
  SurfacePreparation,
  resizePresentationWhenIdle,
} from '../src/engine/babylon/surface-preparation.ts';
import { BabylonPresentationGpu } from '../src/engine/babylon/presentation-gpu.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import { prepareOriginalMaterials } from '../src/engine/babylon/asset-preparation.ts';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
function setup() {
  const state = { now: 0, lost: false, wait: 3 };
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    TIMEOUT_EXPIRED: 2,
    ALREADY_SIGNALED: 3,
    CONDITION_SATISFIED: 4,
    isContextLost: () => state.lost,
    clientWaitSync: () => state.wait,
    fenceSync: () => ({}),
    deleteSync: () => {},
    flush: () => {},
  } as unknown as WebGL2RenderingContext;
  const gpu = new BabylonPresentationGpu(gl, () => state.now),
    schedule = new PresentationSchedule(),
    engine = new NullEngine(),
    scene = new Scene(engine),
    owner = new AbortController();
  for (let i = 0; i < 2; i++) {
    const m = CreateBox(`surface-${i}`, {}, scene);
    m.material = new StandardMaterial(`material-${i}`, scene);
  }
  return {
    state,
    gpu,
    schedule,
    engine,
    scene,
    owner,
    dispose() {
      owner.abort();
      gpu.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}
it('suppresses all compile gaps, then requires two ready completions of the current scene', async () => {
  const h = setup(),
    gap = deferred();
  let compiled = 0;
  const prepare: typeof prepareOriginalMaterials = (container, gpu, signal, deadline, progress) =>
    prepareOriginalMaterials(
      container,
      gpu,
      signal,
      deadline,
      progress,
      async () => {
        compiled++;
      },
      () => (compiled === 1 ? gap.promise : Promise.resolve()),
    );
  const readiness = new SurfacePreparation(
    h.scene,
    h.scene.meshes,
    h.gpu,
    h.schedule,
    h.owner.signal,
    performance.now() + 120000,
    prepare,
  );
  try {
    await flush();
    expect(compiled).toBe(1);
    expect(h.gpu.ready()).toBe(true);
    expect(readiness.canDraw).toBe(false);
    expect(readiness.completed).toBe(false);
    gap.resolve();
    await flush();
    expect(compiled).toBe(2);
    expect(readiness.canDraw).toBe(true);
    expect(readiness.completed).toBe(false);
    for (let i = 0; i < 2; i++) {
      h.gpu.frame(h.schedule, true, {}, () => true);
      h.gpu.ready();
    }
    await flush();
    expect(readiness.completed).toBe(false);
    h.gpu.frame(h.schedule, true, h.scene, () => true);
    h.gpu.ready();
    await flush();
    expect(readiness.completed).toBe(false);
    h.gpu.frame(h.schedule, true, h.scene, () => false);
    h.gpu.ready();
    await flush();
    expect(readiness.completed).toBe(false);
    for (let i = 0; i < 2; i++) {
      h.gpu.frame(h.schedule, true, h.scene, () => true);
      h.gpu.ready();
    }
    await readiness.completion;
    expect(readiness.completed).toBe(true);
  } finally {
    gap.resolve();
    h.dispose();
  }
});
it('ordinary owner restart cannot release an active compiler or publish its late readiness', async () => {
  const h = setup(),
    compile = deferred();
  let compiled = 0;
  const prepare: typeof prepareOriginalMaterials = (container, gpu, signal, deadline, progress) =>
    prepareOriginalMaterials(
      container,
      gpu,
      signal,
      deadline,
      progress,
      async () => {
        compiled++;
        await compile.promise;
      },
      () => Promise.resolve(),
    );
  const readiness = new SurfacePreparation(
    h.scene,
    h.scene.meshes,
    h.gpu,
    h.schedule,
    h.owner.signal,
    performance.now() + 120000,
    prepare,
  );
  const rejection = expect(readiness.completion).rejects.toBeDefined();
  try {
    await flush();
    h.owner.abort();
    expect(h.gpu.ready()).toBe(false);
    expect(readiness.canDraw).toBe(false);
    compile.resolve();
    await rejection;
    expect(h.gpu.ready()).toBe(true);
    expect(h.gpu.diagnostics().preparation.failure).toBeNull();
    expect(compiled).toBe(1);
    expect(readiness.completed).toBe(false);
  } finally {
    compile.resolve();
    h.dispose();
  }
});
for (const invalidation of ['loss', 'dispose'] as const)
  it(`does not revive after GPU ${invalidation}`, async () => {
    const h = setup(),
      compile = deferred();
    const prepare: typeof prepareOriginalMaterials = (container, gpu, signal, deadline, progress) =>
      prepareOriginalMaterials(
        container,
        gpu,
        signal,
        deadline,
        progress,
        () => compile.promise,
        () => Promise.resolve(),
      );
    const readiness = new SurfacePreparation(
      h.scene,
      h.scene.meshes,
      h.gpu,
      h.schedule,
      h.owner.signal,
      performance.now() + 120000,
      prepare,
    );
    const rejection = expect(readiness.completion).rejects.toBeDefined();
    try {
      await flush();
      if (invalidation === 'loss') {
        h.state.lost = true;
        h.gpu.contextLost();
      } else h.gpu.dispose();
      await rejection;
      compile.resolve();
      await flush();
      expect(readiness.canDraw).toBe(false);
      expect(readiness.completed).toBe(false);
    } finally {
      compile.resolve();
      h.dispose();
    }
  });
it('enforces remaining absolute deadline when the first presentation fence never completes', async () => {
  vi.useFakeTimers();
  const h = setup(),
    clock = vi.spyOn(performance, 'now').mockReturnValue(900);
  const originalSubscribe = h.gpu.subscribe.bind(h.gpu);
  let unsubscribe = vi.fn();
  vi.spyOn(h.gpu, 'subscribe').mockImplementation((listener) => {
    unsubscribe = vi.fn(originalSubscribe(listener));
    return unsubscribe;
  });
  const initialObservers = h.scene.onDisposeObservable.observers.length;
  const readiness = new SurfacePreparation(
    h.scene,
    h.scene.meshes,
    h.gpu,
    h.schedule,
    h.owner.signal,
    1000,
    async () => {},
  );
  const rejection = expect(readiness.completion).rejects.toThrow('original readiness budget');
  try {
    await flush();
    expect(readiness.canDraw).toBe(true);
    h.state.wait = 2;
    h.gpu.frame(h.schedule, true, h.scene, () => true);
    expect(h.gpu.ready()).toBe(false);
    await vi.advanceTimersByTimeAsync(99);
    expect(readiness.completed).toBe(false);
    expect(unsubscribe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(readiness.canDraw).toBe(false);
    expect(h.gpu.ready()).toBe(false);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    // Babylon removes marked Observable observers on a deferred task.
    await vi.advanceTimersByTimeAsync(1);
    expect(h.scene.onDisposeObservable.observers.length).toBe(initialObservers);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.gpu.diagnostics().preparation.failure).toBeNull();
  } finally {
    clock.mockRestore();
    h.dispose();
    vi.useRealTimers();
  }
});
it('owner restart cancels presentation first and clears the remaining-deadline timer', async () => {
  vi.useFakeTimers();
  const h = setup(),
    clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  const readiness = new SurfacePreparation(
    h.scene,
    h.scene.meshes,
    h.gpu,
    h.schedule,
    h.owner.signal,
    1000,
    async () => {},
  );
  const rejection = expect(readiness.completion).rejects.toMatchObject({ name: 'AbortError' });
  try {
    await flush();
    h.owner.abort();
    await rejection;
    // Flush Babylon's deferred observer removal, not the remaining 1000ms budget.
    await vi.advanceTimersByTimeAsync(1);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(readiness.completed).toBe(false);
    expect(readiness.canDraw).toBe(false);
  } finally {
    clock.mockRestore();
    h.dispose();
    vi.useRealTimers();
  }
});
it('retains resize after rebuild claims a compiler lease despite an earlier ready receipt', async () => {
  const h = setup(),
    compiler = deferred(),
    resize = vi.fn();
  try {
    expect(h.gpu.ready()).toBe(true);
    const rebuild = h.gpu.prepare(
      'rebuild compiler',
      performance.now() + 120000,
      () => compiler.promise,
    );
    let resizePending = true;
    if (resizePending && resizePresentationWhenIdle(h.gpu, resize)) resizePending = false;
    expect(resizePending).toBe(true);
    expect(resize).not.toHaveBeenCalled();
    compiler.resolve();
    await rebuild;
    if (resizePending && resizePresentationWhenIdle(h.gpu, resize)) resizePending = false;
    expect(resizePending).toBe(false);
    expect(resize).toHaveBeenCalledTimes(1);
  } finally {
    compiler.resolve();
    h.dispose();
  }
});
it('wires readiness, cancellation, live diagnostics and exclusive draw checks into the actual route', () => {
  const source = readFileSync('src/engine/babylon/main.ts', 'utf8');
  expect(source).toContain('vehicles: owner.simulation.cars.map((car) => car.definition)');
  expect(source).toContain('!surfacePreparation?.completed');
  expect(source).toContain('surfacePreparation?.canDraw && gpu!.ready()');
  expect(source).toContain(
    'if (resizePresentationWhenIdle(gpu!, () => engine!.resize())) resizePending = false;',
  );
  expect(source.indexOf('const diagnostics = currentScene.surfaceDiagnostics')).toBeGreaterThan(
    source.indexOf('void pending.completion'),
  );
  const clear = source.slice(
    source.indexOf('function clearSurfaceDiagnostics()'),
    source.indexOf('declare global'),
  );
  const completed = source.slice(
    source.indexOf('void pending.completion'),
    source.indexOf("window.addEventListener('pagehide'"),
  );
  for (const key of [
    'asphaltSubstrateRoadChunks',
    'asphaltSubstrateMaterials',
    'asphaltSubstrateTextures',
    'asphaltSubstrateSrgbTextures',
  ]) {
    expect(clear).toContain(`'surface${key[0].toUpperCase()}${key.slice(1)}'`);
    expect(completed).toContain(`'${key}'`);
    expect(completed).toContain(`diagnostics.${key} !==`);
  }
  expect(clear).toContain('delete status.dataset[key]');
  for (const guard of [
    'currentOwner.signal.aborted',
    'scene !== currentScene',
    'restartOwnership.pending',
    '!pending.completed',
  ]) {
    expect(completed).toContain(guard);
    expect(completed.indexOf(guard)).toBeLessThan(completed.indexOf('const diagnostics ='));
  }
  expect(completed).toContain("throw new Error('Original Formula surface activation incomplete')");
  for (const fn of [
    'function reset()',
    'function rebuildScene',
    'engine.onContextLostObservable.add',
  ])
    expect(source.slice(source.indexOf(fn), source.indexOf(fn) + 180)).toContain(
      'clearSurfaceDiagnostics()',
    );
});
