import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial.js';
import {
  SurfacePreparation,
  resizePresentationWhenIdle,
  pollPresentationForRender,
} from '../src/engine/babylon/surface-preparation.ts';
import { BabylonPresentationGpu } from '../src/engine/babylon/presentation-gpu.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import { RestartOwnership } from '../src/engine/babylon/restart-ownership.ts';
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

it('hands paused surface completion to the next compiler before a surplus surface-only draw', async () => {
  const h = setup();
  const deadline = performance.now() + 120000;
  const surface = new SurfacePreparation(
    h.scene,
    h.scene.meshes,
    h.gpu,
    h.schedule,
    h.owner.signal,
    deadline,
    async () => {},
  );
  let next: SurfacePreparation | undefined;
  const compiler = vi.fn(async () => {});
  const handoff = surface.completion.then(() => {
    next = new SurfacePreparation(
      h.scene,
      h.scene.meshes,
      h.gpu,
      h.schedule,
      h.owner.signal,
      deadline,
      async (_container, gpu, _signal, sameDeadline) => {
        expect(sameDeadline).toBe(deadline);
        await gpu.prepare('next original environment owner', sameDeadline, compiler);
      },
    );
    return next.completion;
  });
  const draws: string[] = [];
  const callback = () => {
    const polled = pollPresentationForRender(h.gpu, h.schedule, true);
    if (polled.ready && !polled.deferSubmission && (next ?? surface).canDraw)
      h.gpu.frame(h.schedule, true, h.scene, () => {
        draws.push(next ? 'next' : 'surface');
        return true;
      });
    return polled;
  };
  try {
    await flush();
    callback(); // Submit first surface frame.
    h.schedule.request();
    // One synchronous render callback per iteration, before owner microtasks.
    // The old path submits surface frame three while publishing completion two.
    for (let frame = 0; frame < 6 && h.gpu.diagnostics().completed < 2; frame++) {
      if (h.gpu.diagnostics().submitted === 2) h.schedule.request();
      callback();
    }
    expect(h.gpu.diagnostics()).toMatchObject({ submitted: 2, completed: 2 });
    expect(surface.completed).toBe(false); // Owner continuation has not run yet.
    expect(h.schedule.diagnostics().requested).toBe(true); // No consumed invalidation.
    expect(draws).toEqual(['surface', 'surface']);
    await flush();
    expect(surface.completed).toBe(true);
    expect(compiler).toHaveBeenCalledOnce(); // No third surface fence blocks the next lease.
    expect(h.gpu.diagnostics().preparation).toMatchObject({ active: false, completed: 1 });
    expect(next?.canDraw).toBe(true);
    expect(next?.completed).toBe(false);
    callback();
    callback();
    await flush();
    expect(next?.completed).toBe(false); // One receipt cannot qualify next owner.
    callback();
    callback();
    await handoff;
    expect(draws).toEqual(['surface', 'surface', 'next', 'next']);
    expect(h.gpu.diagnostics()).toMatchObject({ submitted: 4, completed: 4 });
    expect(h.schedule.pending).toBe(false);
    expect(callback()).toEqual({ ready: true, deferSubmission: false });
    expect(draws).toHaveLength(4);
  } finally {
    h.dispose();
    await handoff.catch(() => {});
  }
});

it.each([false, true])(
  'does not defer active driving or paused draws without preparation (paused=%s)',
  (paused) => {
    const h = setup();
    const finish = paused ? () => {} : h.schedule.prepare();
    try {
      h.gpu.frame(h.schedule, paused, h.scene, () => true);
      h.schedule.request();
      const diagnostics = vi.spyOn(h.gpu, 'diagnostics');
      expect(pollPresentationForRender(h.gpu, h.schedule, paused)).toEqual({
        ready: true,
        deferSubmission: false,
      });
      expect(diagnostics).not.toHaveBeenCalled();
      expect(h.gpu.frame(h.schedule, paused, h.scene, () => true)).toBe(true);
    } finally {
      finish();
      h.dispose();
    }
  },
);
it('defers only a new completion, preserving demand through busy and first-receipt handoffs', () => {
  const h = setup(),
    finish = h.schedule.prepare();
  try {
    h.gpu.frame(h.schedule, true, h.scene, () => true);
    h.schedule.request();
    h.state.wait = 2;
    expect(pollPresentationForRender(h.gpu, h.schedule, true)).toEqual({
      ready: false,
      deferSubmission: false,
    });
    expect(h.schedule.diagnostics().requested).toBe(true);
    h.state.wait = 3;
    expect(pollPresentationForRender(h.gpu, h.schedule, true)).toEqual({
      ready: true,
      deferSubmission: true,
    });
    expect(h.schedule.diagnostics().requested).toBe(true);
    expect(pollPresentationForRender(h.gpu, h.schedule, true)).toEqual({
      ready: true,
      deferSubmission: false,
    });
    expect(h.gpu.frame(h.schedule, true, h.scene, () => true)).toBe(true);
    expect(h.gpu.diagnostics().submitted).toBe(2);
  } finally {
    finish();
    h.dispose();
  }
});
it('preserves fatal GPU failures rather than treating them as a yielding completion', () => {
  const h = setup(),
    finish = h.schedule.prepare();
  try {
    h.gpu.frame(h.schedule, true, h.scene, () => true);
    h.state.wait = 99;
    expect(() => pollPresentationForRender(h.gpu, h.schedule, true)).toThrow(
      'Unable to check GPU frame completion',
    );
    expect(h.gpu.diagnostics().completed).toBe(0);
    expect(h.schedule.diagnostics().preparationCount).toBe(1);
  } finally {
    finish();
    h.dispose();
  }
});
it('keeps restart and resize handling before the normal-submission-only deferral', () => {
  const source = readFileSync('src/engine/babylon/main.ts', 'utf8');
  const body = source.slice(source.indexOf('const polled = pollPresentationForRender'));
  expect(body.indexOf('restartOwnership.drain(true, rebuildScene)')).toBeLessThan(
    body.indexOf('!polled.deferSubmission'),
  );
  expect(body.indexOf('resizePresentationWhenIdle')).toBeLessThan(
    body.indexOf('!polled.deferSubmission'),
  );
  expect(body.indexOf('!polled.deferSubmission')).toBeLessThan(body.indexOf('gpu!.frame('));
});

it.each(['restart', 'loss', 'dispose'] as const)(
  'does not carry a paused handoff across %s',
  async (reason) => {
    const h = setup();
    const deadline = performance.now() + 120000;
    const surface = new SurfacePreparation(
      h.scene,
      h.scene.meshes,
      h.gpu,
      h.schedule,
      h.owner.signal,
      deadline,
      async () => {},
    );
    const outcome = surface.completion.then(
      () => 'ready',
      () => 'cancelled',
    );
    let replacement: SurfacePreparation | undefined;
    const replacementAbort = new AbortController();
    try {
      await flush();
      h.gpu.frame(h.schedule, true, h.scene, () => true);
      expect(pollPresentationForRender(h.gpu, h.schedule, true).deferSubmission).toBe(true);
      if (reason === 'dispose') {
        h.gpu.dispose();
        expect(pollPresentationForRender(h.gpu, h.schedule, true)).toEqual({
          ready: false,
          deferSubmission: false,
        });
        expect(await outcome).toBe('cancelled');
        expect(h.schedule.diagnostics().preparationCount).toBe(0);
        return;
      }
      if (reason === 'restart') {
        const reset = vi.fn(() => ({}));
        const restart = new RestartOwnership(() => h.owner.abort(), reset);
        restart.request();
        restart.request();
        const rebuild = vi.fn(() => {
          h.schedule.reset();
          replacement = new SurfacePreparation(
            h.scene,
            h.scene.meshes,
            h.gpu,
            h.schedule,
            replacementAbort.signal,
            deadline,
            async () => {},
          );
        });
        expect(restart.drain(true, rebuild)).toBe(true);
        expect(reset).toHaveBeenCalledTimes(2);
        expect(rebuild).toHaveBeenCalledOnce();
        expect(await outcome).toBe('cancelled');
        await flush();
      } else {
        h.gpu.contextLost();
        expect(pollPresentationForRender(h.gpu, h.schedule, true)).toEqual({
          ready: false,
          deferSubmission: false,
        });
        h.gpu.contextRestored();
        h.schedule.request();
      }
      const current = replacement ?? surface;
      expect(pollPresentationForRender(h.gpu, h.schedule, true).deferSubmission).toBe(false);
      for (let i = 0; i < 2; i++) {
        h.gpu.frame(h.schedule, true, h.scene, () => true);
        expect(pollPresentationForRender(h.gpu, h.schedule, true).deferSubmission).toBe(true);
        await flush();
        expect(current.completed).toBe(i === 1);
      }
      await current.completion;
      expect(h.gpu.diagnostics()).toMatchObject({ submitted: 3, completed: 3 });
      expect(h.schedule.diagnostics().preparationCount).toBe(0);
    } finally {
      replacementAbort.abort();
      h.dispose();
      await outcome;
    }
  },
);
