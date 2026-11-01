import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Scene } from '@babylonjs/core/scene.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { GantryPreparation } from '../src/engine/babylon/gantry-preparation.ts';
import {
  type BabylonStartGantryOptions,
  loadBabylonStartGantry,
} from '../src/engine/babylon/start-gantry.ts';
import manifest from '../src/rendering/start-gantry.manifest.json' with { type: 'json' };
import { Track } from '../src/simulation/track.ts';
import { AUREL, VELLAMAR } from '../src/simulation/circuits.ts';
import { FORMULA_APX01 } from '../src/simulation/vehicles.ts';
import { RestartOwnership } from '../src/engine/babylon/restart-ownership.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function harness(circuit = AUREL) {
  const staged = deferred(),
    presented = deferred(),
    abort = new AbortController();
  let current = true,
    state = 'prepared';
  const meshes = Array.from(
    { length: 4 },
    () =>
      ({
        isDisposed: () => false,
        isEnabled: () => true,
        getTotalIndices: () => 7140,
      }) as unknown as Mesh,
  );
  const scene = { isDisposed: false, meshes: [] as Mesh[] } as unknown as Scene;
  const dispose = vi.fn(() => {
    state = 'disposed';
    scene.meshes.length = 0;
  });
  const install = vi.fn(async () => {
    state = 'installing';
    scene.meshes.push(...meshes);
    await presented.promise;
    abort.signal.throwIfAborted();
    state = 'ready';
  });
  const owner = {
    install,
    dispose,
    diagnostics: () => ({
      state,
      parts: meshes.map((mesh) => ({ mesh })),
      activeParts: scene.meshes.length,
      activeMaterials: 1,
      activeTextures: 3,
      sha256: manifest.sha256,
    }),
  } as unknown as Awaited<ReturnType<typeof loadBabylonStartGantry>>;
  const options = {
    scene,
    track: new Track('clear', false, undefined, circuit),
    context: { presentation: 'circuit', vehicles: [FORMULA_APX01] },
    base: 'http://localhost/',
    signal: abort.signal,
    deadline: performance.now() + 120000,
    isCurrent: () => current,
    gpu: {},
    schedule: {},
  } as unknown as BabylonStartGantryOptions;
  const load = vi.fn(async (received: BabylonStartGantryOptions) => {
    expect(received).toBe(options);
    await staged.promise;
    return owner;
  });
  return {
    options,
    owner,
    load,
    dispose,
    install,
    staged,
    presented,
    abort,
    scene,
    stale: () => {
      current = false;
    },
  };
}
it('keeps staging nondrawable and model readiness blocked until delayed install receipts', async () => {
  const h = harness(),
    readiness = new GantryPreparation(h.options, h.load);
  expect(readiness.canDraw).toBe(false);
  expect(readiness.completed).toBe(false);
  expect(h.install).not.toHaveBeenCalled();
  expect(() => readiness.receipt()).toThrow('not ready');
  h.staged.resolve();
  await flush();
  expect(h.install).toHaveBeenCalledOnce();
  expect(readiness.canDraw).toBe(true); // Receipt-producing draws cannot depend on completed.
  expect(readiness.completed).toBe(false);
  h.presented.resolve();
  await readiness.completion;
  expect(readiness.receipt()).toEqual({
    state: 'ready',
    parts: 4,
    materials: 1,
    textures: 3,
    triangles: 9520,
    sha256: manifest.sha256,
  });
  readiness.dispose();
  expect(readiness.canDraw).toBe(false);
  expect(readiness.completed).toBe(false);
});
it.each(['abort', 'stale', 'dispose'] as const)(
  'drains late staged ownership after %s without installation',
  async (reason) => {
    const h = harness(),
      readiness = new GantryPreparation(h.options, h.load);
    const rejected = expect(readiness.completion).rejects.toThrow();
    if (reason === 'abort') h.abort.abort();
    else if (reason === 'stale') h.stale();
    else readiness.dispose();
    h.staged.resolve();
    await rejected;
    expect(h.install).not.toHaveBeenCalled();
    expect(h.dispose).toHaveBeenCalledOnce();
    expect(readiness.completed).toBe(false);
  },
);
it('rejects aborted presentation and never publishes stale ready counts', async () => {
  const h = harness(),
    readiness = new GantryPreparation(h.options, h.load);
  const rejected = expect(readiness.completion).rejects.toThrow();
  h.staged.resolve();
  await flush();
  h.abort.abort();
  expect(readiness.canDraw).toBe(false);
  h.presented.resolve();
  await rejected;
  expect(h.dispose).toHaveBeenCalledOnce();
  expect(() => readiness.receipt()).toThrow();
});
it('rejects a stale installation and retains its failure if cleanup also throws', async () => {
  const h = harness(),
    readiness = new GantryPreparation(h.options, h.load);
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const rejected = expect(readiness.completion).rejects.toThrow('ownership changed');
  try {
    h.staged.resolve();
    await flush();
    h.stale();
    h.dispose.mockImplementationOnce(() => {
      throw undefined;
    });
    h.presented.resolve();
    await rejected;
    expect(readiness.completed).toBe(false);
    expect(readiness.canDraw).toBe(false);
    expect(log).toHaveBeenCalledWith('A07 cleanup failed', undefined);
    readiness.dispose();
    expect(h.scene.meshes).toHaveLength(0);
  } finally {
    log.mockRestore();
  }
});
it('does not fetch A07 for ineligible canonical venue or non-Formula context', async () => {
  for (const h of [harness(VELLAMAR), harness()]) {
    if (h.options.track.circuit === AUREL) h.options.context.vehicles = [];
    const readiness = new GantryPreparation(h.options, h.load);
    await readiness.completion;
    expect(h.load).not.toHaveBeenCalled();
    expect(readiness.completed).toBe(true);
    expect(readiness.receipt()).toEqual({
      state: 'ineligible',
      parts: 0,
      materials: 0,
      textures: 0,
      triangles: 0,
      sha256: '',
    });
  }
});
it('repeated restart aborts immediately but preserves drain and newest authority', async () => {
  const h = harness(),
    readiness = new GantryPreparation(h.options, h.load);
  const rejected = expect(readiness.completion).rejects.toThrow();
  const reset = vi.fn(() => ({}));
  const ownership = new RestartOwnership(() => h.abort.abort(), reset);
  ownership.request();
  ownership.request();
  const rebuild = vi.fn(() => readiness.dispose());
  expect(ownership.drain(false, rebuild)).toBe(false);
  expect(rebuild).not.toHaveBeenCalled();
  h.staged.resolve();
  await rejected;
  expect(ownership.drain(true, rebuild)).toBe(true);
  expect(rebuild).toHaveBeenCalledWith(reset.mock.results[1].value);
  expect(reset).toHaveBeenCalledTimes(2);
  expect(readiness.completed).toBe(false);
});
it('invalidates readiness even when explicit cleanup fails, and permits retrying disposal', async () => {
  const h = harness(),
    readiness = new GantryPreparation(h.options, h.load);
  h.staged.resolve();
  h.presented.resolve();
  await readiness.completion;
  h.dispose.mockImplementationOnce(() => {
    throw new Error('cleanup failure');
  });
  expect(() => readiness.dispose()).toThrow('cleanup failure');
  expect(readiness.completed).toBe(false);
  expect(() => readiness.receipt()).toThrow();
  readiness.dispose();
  expect(h.scene.meshes).toHaveLength(0);
});
it('explicitly drains the owner when scene disposal skipped callbacks', async () => {
  const h = harness(),
    readiness = new GantryPreparation(h.options, h.load);
  h.staged.resolve();
  h.presented.resolve();
  await readiness.completion;
  Object.defineProperty(h.scene, 'isDisposed', { value: true });
  expect(readiness.completed).toBe(false);
  expect(h.dispose).not.toHaveBeenCalled();
  readiness.dispose();
  expect(h.dispose).toHaveBeenCalledOnce();
  expect(h.scene.meshes).toHaveLength(0);
});
it('does not accept retained references as active binding evidence', async () => {
  const h = harness(),
    readiness = new GantryPreparation(h.options, h.load);
  h.staged.resolve();
  h.presented.resolve();
  await readiness.completion;
  h.scene.meshes.pop();
  expect(() => readiness.receipt()).toThrow('activation incomplete');
});
it('wires startup after surfaces with the same deadline and keeps draw receipts independent of readiness', () => {
  const source = readFileSync('src/engine/babylon/main.ts', 'utf8');
  const startup = source.slice(
    source.indexOf('function rebuildScene'),
    source.indexOf("window.addEventListener('pagehide'"),
  );
  expect(startup.match(/performance.now\(\) \+ 120000/g)).toHaveLength(1);
  expect(startup.indexOf('new GantryPreparation')).toBeGreaterThan(
    startup.indexOf('const diagnostics = currentScene.surfaceDiagnostics'),
  );
  expect(startup).toContain('await gantry.completion');
  expect(startup.indexOf('loadAsset.disabled = false')).toBeGreaterThan(
    startup.indexOf('await gantry.completion'),
  );
  expect(source).toContain('!gantryPreparation?.completed');
  expect(source).toContain('(!gantryPreparation || gantryPreparation.canDraw)');
  expect(source).toContain('readyBefore && readyAfter && !!gantryPreparation?.completed');
  expect(source.match(/\(\) => gantryPreparation\?\.dispose\(\)/g)).toHaveLength(2);
});
