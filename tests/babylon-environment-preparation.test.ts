import { PausedStartupPublication } from '../src/engine/babylon/paused-startup-publication.ts';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { StripePreparation } from '../src/engine/babylon/stripe-preparation.ts';
import type { createBabylonStartFinishStripe } from '../src/engine/babylon/start-finish-stripe.ts';
import { EnvironmentPreparation } from '../src/engine/babylon/environment-preparation.ts';
import { GantryPreparation } from '../src/engine/babylon/gantry-preparation.ts';
import { BabylonPresentationGpu } from '../src/engine/babylon/presentation-gpu.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import {
  pollPresentationForRender,
  SurfacePreparation,
} from '../src/engine/babylon/surface-preparation.ts';
import { waitForPresentation } from '../src/engine/babylon/presentation-ready.ts';
import {
  type BabylonStartGantryOptions,
  loadBabylonStartGantry,
} from '../src/engine/babylon/start-gantry.ts';
import { createBabylonStartLamps } from '../src/engine/babylon/start-lamps.ts';
import { createBabylonStartBanner } from '../src/engine/babylon/start-banner.ts';
import manifest from '../src/rendering/start-gantry.manifest.json' with { type: 'json' };
import { Track } from '../src/simulation/track.ts';
import { VELLAMAR } from '../src/simulation/circuits.ts';
import { FORMULA_APX01 } from '../src/simulation/vehicles.ts';

const flush = async () => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});
type Kind = 'gantry' | 'lamps' | 'banner';
function harness() {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    abort = new AbortController();
  const baselineMaterial = new PBRMaterial('baseline', scene);
  baselineMaterial.dispose();
  const baselineTextures = [...scene.textures];
  expect(baselineTextures).toHaveLength(1);
  const state = { wait: 3, now: 0, current: true, activeCompilers: 0, peakCompilers: 0 };
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    TIMEOUT_EXPIRED: 2,
    ALREADY_SIGNALED: 3,
    CONDITION_SATISFIED: 4,
    isContextLost: () => false,
    clientWaitSync: () => state.wait,
    fenceSync: () => ({}),
    deleteSync: () => {},
    flush: () => {},
  } as unknown as WebGL2RenderingContext;
  const gpu = new BabylonPresentationGpu(gl, () => state.now),
    schedule = new PresentationSchedule();
  const options: BabylonStartGantryOptions = {
    scene,
    gpu,
    schedule,
    signal: abort.signal,
    deadline: performance.now() + 120000,
    track: new Track(),
    context: { presentation: 'circuit', vehicles: [FORMULA_APX01] },
    base: 'http://localhost/',
    isCurrent: () => state.current,
  };
  const events: string[] = [],
    receipts: Record<Kind, number[]> = { gantry: [], lamps: [], banner: [] };
  const holds: Partial<Record<Kind, ReturnType<typeof deferred>>> = {};
  const prepareFailures = new Map<Kind, unknown>(),
    installFailures = new Map<Kind, unknown>();
  const disposalFailures = new Set<Kind>();
  const owners: Partial<Record<Kind, { dispose(): void; disposed: boolean }>> = {};
  let frame = new Float32Array([0]);
  const applied: number[] = [];
  const make = async (kind: Kind, received: BabylonStartGantryOptions) => {
    events.push(`prepare:${kind}`);
    expect(received.deadline).toBe(options.deadline);
    expect(received.gpu).toBe(gpu);
    await gpu.prepare(`${kind} original variants`, received.deadline, async () => {
      state.activeCompilers++;
      state.peakCompilers = Math.max(state.peakCompilers, state.activeCompilers);
      try {
        await holds[kind]?.promise;
      } finally {
        state.activeCompilers--;
      }
    });
    if (prepareFailures.has(kind)) throw prepareFailures.get(kind);
    received.signal.throwIfAborted();
    const count = kind === 'gantry' ? 4 : kind === 'lamps' ? 5 : 1;
    const materials = Array.from({ length: kind === 'lamps' ? 5 : 1 }, (_, i) => {
      const m = new PBRMaterial(`${kind}-${i}`, scene);
      scene.removeMaterial(m);
      return m;
    });
    const meshes = Array.from({ length: count }, (_, i) => {
      const m = new Mesh(`${kind}-${i}`, scene);
      m.material = materials[kind === 'lamps' ? i : 0];
      vi.spyOn(m, 'getTotalIndices').mockReturnValue(
        kind === 'gantry' ? 7140 : kind === 'lamps' ? 240 : 6,
      );
      scene.removeMesh(m);
      return m;
    });
    const texture =
      kind === 'banner'
        ? RawTexture.CreateRGBATexture(new Uint8Array(512 * 128 * 4), 512, 128, scene)
        : undefined;
    if (texture) {
      scene.removeTexture(texture);
      materials[0].albedoTexture = texture;
    }
    let phase = 'prepared';
    const localAbort = new AbortController();
    const owner = {
      disposed: false,
      dispose() {
        expect(state.activeCompilers).toBe(0);
        events.push(`dispose:${kind}`);
        owner.disposed = true;
        phase = 'disposed';
        localAbort.abort();
        if (disposalFailures.delete(kind)) throw undefined;
        for (const mesh of meshes) mesh.dispose();
        for (const material of materials) material.dispose();
        texture?.dispose();
      },
      apply(f: Float32Array) {
        applied.push(f[0]);
        for (const m of materials) m.emissiveIntensity = f[0] ? 25 : 0;
      },
      diagnostics() {
        return {
          state: phase,
          parts: meshes.map((mesh, i) => ({ mesh, material: materials[kind === 'lamps' ? i : 0] })),
          activeParts: meshes.filter((m) => scene.meshes.includes(m)).length,
          activeMaterials: materials.filter((m) => scene.materials.includes(m)).length,
          activeTextures:
            kind === 'gantry' ? 3 : texture && scene.textures.includes(texture) ? 1 : 0,
          sha256: manifest.sha256,
          mesh: meshes[0],
          material: materials[0],
          texture,
          hardwareSrgb: true,
        };
      },
      async install() {
        events.push(`install:${kind}`);
        phase = 'installing';
        const finish = schedule.prepare();
        try {
          for (const m of meshes) scene.addMesh(m);
          for (const m of materials) scene.addMaterial(m);
          if (texture) scene.addTexture(texture);
          if (installFailures.has(kind)) throw installFailures.get(kind);
          const observer = {
            subscribe(listener: Parameters<typeof gpu.subscribe>[0]) {
              return gpu.subscribe((receipt) => {
                if (receipt.kind === 'completed' && receipt.owner === scene && receipt.ready)
                  receipts[kind].push(receipt.sequence);
                listener(receipt);
              });
            },
          };
          events.push(`subscribe:${kind}`);
          schedule.request();
          await waitForPresentation(
            scene,
            AbortSignal.any([received.signal, localAbort.signal]),
            observer,
          );
          phase = 'ready';
        } finally {
          finish();
        }
      },
    };
    owners[kind] = owner;
    return owner;
  };
  const dependencies = {
    gantry: ((o: BabylonStartGantryOptions) =>
      make('gantry', o)) as unknown as typeof loadBabylonStartGantry,
    lamps: ((o: BabylonStartGantryOptions) =>
      make('lamps', o)) as unknown as typeof createBabylonStartLamps,
    banner: ((o: BabylonStartGantryOptions) =>
      make('banner', o)) as unknown as typeof createBabylonStartBanner,
  };
  let batch: EnvironmentPreparation | undefined;
  const start = () => {
    batch = new EnvironmentPreparation(options, () => frame, dependencies);
    void batch.completion.catch(() => {});
    return batch;
  };
  const tick = (ready = true, paused = true) => {
    const polled = pollPresentationForRender(gpu, schedule, paused);
    if (polled.ready && !polled.deferSubmission && batch?.canDraw)
      gpu.frame(schedule, paused, scene, () => {
        expect(
          events
            .slice(events.lastIndexOf('prepare:gantry'))
            .filter((e) => e.startsWith('subscribe:')),
        ).toHaveLength(3);
        events.push('draw');
        batch!.lamps!.apply(frame);
        return ready;
      });
  };
  cleanups.push(() => {
    abort.abort();
    gpu.dispose();
    batch?.dispose();
    scene.dispose();
    engine.dispose();
  });
  return {
    options,
    baselineTextures,
    scene,
    gpu,
    schedule,
    state,
    abort,
    start,
    tick,
    events,
    receipts,
    holds,
    prepareFailures,
    installFailures,
    disposalFailures,
    owners,
    dependencies,
    applied,
    setFrame(value: number) {
      frame = new Float32Array([value]);
    },
  };
}

it('keeps surface pair unchanged then shares two actual future ready completions across all staged owners', async () => {
  const h = harness();
  const surface = new SurfacePreparation(
    h.scene,
    [],
    h.gpu,
    h.schedule,
    h.abort.signal,
    h.options.deadline,
    async () => {},
  );
  await flush();
  for (let i = 0; i < 2; i++) {
    h.gpu.frame(h.schedule, true, h.scene, () => true);
    h.gpu.ready();
    await flush();
  }
  await surface.completion;
  expect(h.gpu.diagnostics()).toMatchObject({ submitted: 2, completed: 2 });
  h.holds.lamps = deferred();
  const batch = h.start();
  await flush();
  expect(h.events).toEqual(['prepare:gantry', 'prepare:lamps']);
  expect(batch.canDraw).toBe(false);
  h.tick();
  expect(h.events).not.toContain('draw');
  h.setFrame(1);
  h.holds.lamps.resolve();
  await flush();
  expect(h.events).toEqual([
    'prepare:gantry',
    'prepare:lamps',
    'prepare:banner',
    'install:gantry',
    'subscribe:gantry',
    'install:lamps',
    'subscribe:lamps',
    'install:banner',
    'subscribe:banner',
  ]);
  expect(h.applied).toEqual([1]);
  expect(batch.canDraw).toBe(true);
  expect(batch.completed).toBe(false);
  h.tick();
  h.tick();
  await flush();
  expect(batch.completed).toBe(false);
  h.setFrame(0);
  h.tick();
  h.tick();
  await batch.completion;
  expect(batch.completed).toBe(true);
  expect(h.receipts).toEqual({ gantry: [3, 4], lamps: [3, 4], banner: [3, 4] });
  expect(h.applied.at(-1)).toBe(0);
  expect(h.gpu.diagnostics()).toMatchObject({
    submitted: 4,
    completed: 4,
    preparation: { started: 3, completed: 3 },
  });
  expect(h.state.peakCompilers).toBe(1);
  expect(h.schedule.diagnostics().preparationCount).toBe(0);
});
it('nonready completions and context loss reset each independent consecutive-ready requirement', async () => {
  const h = harness(),
    batch = h.start();
  await flush();
  h.tick(true);
  h.tick();
  await flush();
  expect(batch.completed).toBe(false);
  h.tick(false);
  h.tick();
  await flush();
  expect(batch.completed).toBe(false);
  h.gpu.contextLost();
  expect(batch.completed).toBe(false);
  h.gpu.contextRestored();
  h.schedule.request();
  h.tick();
  h.tick();
  await flush();
  expect(batch.completed).toBe(false);
  h.tick();
  h.tick();
  await batch.completion;
  expect(batch.completed).toBe(true);
});
it.each(['gantry', 'lamps', 'banner'] as const)(
  'rolls back every staged/installed owner on %s partial install failure with falsy primary error',
  async (kind) => {
    const h = harness();
    h.installFailures.set(kind, undefined);
    const batch = h.start();
    const result = batch.completion.then(
      () => 'unexpected',
      (e: unknown) => e,
    );
    await flush();
    expect(await result).toBeUndefined();
    expect(batch.canDraw).toBe(false);
    expect(batch.completed).toBe(false);
    expect(h.events).not.toContain('draw');
    expect(Object.values(h.owners).every((o) => o!.disposed)).toBe(true);
    expect(h.scene.meshes).toHaveLength(0);
    expect(h.scene.materials).toHaveLength(0);
    expect(h.scene.textures).toEqual(h.baselineTextures);
    expect(h.schedule.diagnostics().preparationCount).toBe(0);
  },
);
it.each(['gantry', 'lamps', 'banner'] as const)(
  'retains %s prepare failure, drains current lease and disposes earlier staged owners',
  async (kind) => {
    const h = harness();
    h.prepareFailures.set(kind, 0);
    const batch = h.start();
    await expect(batch.completion).rejects.toBe(0);
    expect(h.state.activeCompilers).toBe(0);
    expect(batch.canDraw).toBe(false);
    expect(h.events.some((e) => e.startsWith('install:'))).toBe(false);
    expect(Object.values(h.owners).every((o) => o!.disposed)).toBe(true);
  },
);
it('cancellation during a held sibling compiler defers all resource disposal until drain', async () => {
  const h = harness();
  h.holds.lamps = deferred();
  const batch = h.start();
  const failed = expect(batch.completion).rejects.toThrow();
  await flush();
  batch.dispose();
  expect(h.state.activeCompilers).toBe(1);
  expect(h.events.some((e) => e.startsWith('dispose:'))).toBe(false);
  expect(batch.canDraw).toBe(false);
  h.holds.lamps.resolve();
  await failed;
  expect(h.owners.gantry?.disposed).toBe(true);
  expect(h.events).not.toContain('prepare:banner');
});
it('staged prepared owner neither installs early nor hangs on preactivation cancellation; repeated install reuses completion', async () => {
  const h = harness();
  const owner = new GantryPreparation(h.options, h.dependencies.gantry, { staged: true });
  void owner.completion.catch(() => {});
  expect(owner.prepared).toBeInstanceOf(Promise);
  await owner.prepared;
  expect(owner.canDraw).toBe(false);
  expect(h.events).toEqual(['prepare:gantry']);
  h.abort.abort();
  await expect(owner.completion).rejects.toThrow();
  expect(h.events).toEqual(['prepare:gantry']);
  owner.dispose();
  expect(h.owners.gantry?.disposed).toBe(true);
});
it('repeated activation does not duplicate subscriptions; disposal cancels all presentation waits', async () => {
  const h = harness(),
    batch = h.start();
  await flush();
  const first = batch.gantry!.completion;
  expect(batch.gantry!.install()).toBe(first);
  expect(batch.gantry!.install()).toBe(first);
  expect(h.events.filter((e) => e === 'subscribe:gantry')).toHaveLength(1);
  batch.dispose();
  await expect(batch.completion).rejects.toThrow();
  batch.dispose();
  expect(h.schedule.diagnostics().preparationCount).toBe(0);
  expect(batch.completed).toBe(false);
});
it('stale generation never installs prepared resources', async () => {
  const h = harness();
  h.holds.banner = deferred();
  const batch = h.start();
  await flush();
  h.state.current = false;
  h.holds.banner.resolve();
  await expect(batch.completion).rejects.toThrow('ownership changed');
  expect(h.events.some((e) => e.startsWith('install:'))).toBe(false);
});
it('ineligible environment creates no adapters, promises still settle, no compiler or synthetic receipts', async () => {
  const h = harness();
  h.options.track = new Track('clear', false, undefined, VELLAMAR);
  const batch = h.start();
  await batch.completion;
  expect(h.events).toEqual([]);
  expect(batch.completed).toBe(true);
  expect(h.gpu.diagnostics().completed).toBe(0);
  expect(batch.gantry!.receipt().state).toBe('ineligible');
  expect(batch.lamps!.receipt().state).toBe('ineligible');
  expect(batch.banner!.receipt().state).toBe('ineligible');
});
it('preserves active draws after completion and confines batch wiring to existing three props after surface completion', async () => {
  const h = harness(),
    batch = h.start();
  await flush();
  h.tick(true, false);
  h.tick(true, false);
  h.tick(true, false);
  await batch.completion;
  const count = h.gpu.diagnostics().submitted;
  h.tick(true, false);
  expect(h.gpu.diagnostics().submitted).toBe(count + 1);
  const source = readFileSync('src/engine/babylon/main.ts', 'utf8');
  expect(source.indexOf('new EnvironmentPreparation')).toBeGreaterThan(
    source.indexOf('void pending.completion'),
  );
  expect(source).toContain('(!environmentPreparation || environmentPreparation.canDraw)');
  expect(source).toContain('!!environmentPreparation?.completed');
  expect(source).not.toContain('start-finish-stripe');
  expect(source).toContain('const deadline = performance.now() + 120000');
  expect(readFileSync('scripts/desktop-smoke.mjs', 'utf8')).toContain('timeout: 30000');
});

it('does not renew an expired original absolute deadline', async () => {
  const h = harness();
  h.options.deadline = performance.now() - 1;
  const batch = h.start();
  await expect(batch.completion).rejects.toThrow('deadline exceeded');
  expect(h.events).toEqual([]);
  expect(batch.canDraw).toBe(false);
});
it('preserves falsy primary failure when cleanup throws and allows cleanup retry', async () => {
  const h = harness();
  h.installFailures.set('lamps', null);
  h.disposalFailures.add('banner');
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const batch = h.start();
  await expect(batch.completion).rejects.toBeNull();
  expect(log).toHaveBeenCalled();
  expect(batch.completed).toBe(false);
  batch.dispose();
  expect(h.scene.meshes).toHaveLength(0);
  expect(h.schedule.diagnostics().preparationCount).toBe(0);
});
it('a restart cancels old subscriptions and requires two new receipts for the replacement batch', async () => {
  const h = harness();
  const old = h.start();
  await flush();
  h.tick(); // Old scene submission must not count toward the replacement.
  h.abort.abort();
  await expect(old.completion).rejects.toThrow();
  const replacementAbort = new AbortController();
  h.options.signal = replacementAbort.signal;
  h.schedule.reset();
  const replacement = h.start();
  await flush();
  expect(replacement.completed).toBe(false);
  h.tick();
  h.tick();
  await flush();
  expect(replacement.completed).toBe(false);
  h.tick();
  h.tick();
  await replacement.completion;
  expect(replacement.completed).toBe(true);
  expect(old.completed).toBe(false);
  for (const values of Object.values(h.receipts)) expect(values).toEqual([2, 3]);
  replacementAbort.abort();
});

it.each(['start-gantry', 'start-lamps', 'start-banner'])(
  'keeps %s adapter installation synchronous through its real presentation subscription',
  (name) => {
    const source = readFileSync(`src/engine/babylon/${name}.ts`, 'utf8');
    const install = source.slice(source.indexOf('async install()'));
    const firstAwait = install.indexOf('await ');
    expect(firstAwait).toBeGreaterThan(install.indexOf('schedule.request()'));
    expect(install.slice(firstAwait, firstAwait + 100)).toContain(
      'dependencies.present ?? waitForPresentation',
    );
    expect(install.slice(0, firstAwait)).toContain("state = 'installing'");
  },
);

it('does not borrow other-scene completions for any installed owner', async () => {
  const h = harness(),
    batch = h.start();
  await flush();
  h.gpu.frame(h.schedule, true, {}, () => true);
  h.gpu.ready();
  await flush();
  expect(batch.completed).toBe(false);
  expect(h.receipts).toEqual({ gantry: [], lamps: [], banner: [] });
  h.tick();
  h.tick();
  await flush();
  expect(batch.completed).toBe(false);
  h.tick();
  h.tick();
  await batch.completion;
  expect(h.receipts).toEqual({ gantry: [2, 3], lamps: [2, 3], banner: [2, 3] });
});
it('expired installation receipts fail the original absolute deadline without publication', async () => {
  const h = harness(),
    batch = h.start();
  await flush();
  h.tick();
  h.tick();
  await flush();
  expect(batch.completed).toBe(false);
  vi.spyOn(performance, 'now').mockReturnValue(h.options.deadline + 1);
  h.tick();
  h.tick();
  await expect(batch.completion).rejects.toThrow('deadline exceeded');
  expect(batch.completed).toBe(false);
  expect(batch.canDraw).toBe(false);
  expect(h.schedule.diagnostics().preparationCount).toBe(0);
});

it('retains the exact pre-owned BRDF baseline until final scene disposal releases it', async () => {
  const h = harness(),
    batch = h.start();
  await flush();
  h.tick();
  h.tick();
  h.tick();
  h.tick();
  await batch.completion;
  batch.dispose();
  expect(h.scene.textures).toEqual(h.baselineTextures);
  const disposed = vi.fn();
  for (const texture of h.baselineTextures) texture.onDisposeObservable.addOnce(disposed);
  h.scene.dispose();
  expect(disposed).toHaveBeenCalledTimes(h.baselineTextures.length);
  expect(h.scene.textures).toHaveLength(0);
});

it.each(['lamps', 'banner'] as const)(
  'a throwing %s cleanup reporter cannot replace the falsy primary error or skip settlement',
  async (kind) => {
    const h = harness();
    h.installFailures.set('lamps', null);
    h.disposalFailures.add(kind);
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw false;
    });
    const batch = h.start();
    await expect(batch.completion).rejects.toBeNull();
    expect(batch.completed).toBe(false);
    expect(batch.canDraw).toBe(false);
    expect(h.schedule.diagnostics().preparationCount).toBe(0);
    batch.dispose();
    expect(h.scene.meshes).toHaveLength(0);
  },
);

it('keeps stripe outside the batch and requires two fresh stripe receipts without a surplus batch draw', async () => {
  const h = harness();
  const surface = new SurfacePreparation(
    h.scene,
    [],
    h.gpu,
    h.schedule,
    h.abort.signal,
    h.options.deadline,
    async () => {},
  );
  let batch: EnvironmentPreparation | undefined;
  let stripe: StripePreparation | undefined;
  const stripeReceipts: number[] = [];
  const component = {},
    frame = new Float32Array([43, 0]);
  const publication = new PausedStartupPublication(h.gpu, h.scene, () => ({
    component,
    frame,
    tick: 43,
    paused: true,
    visual: 'frozen CPU seam',
  }));
  cleanups.push(() => publication.dispose());
  let sceneReady = false;
  const stripeCompiler = vi.fn(async () => {
    expect(h.gpu.diagnostics()).toMatchObject({ submitted: 4, completed: 4 });
    expect(batch?.completed).toBe(true);
  });
  // Synthetic bound resources isolate the real wrappers/GPU receipt handoff;
  // geometry, artwork and hardware parity remain the isolated adapter's tests.
  const loadStripe: typeof createBabylonStartFinishStripe = async (options) => {
    expect(options.deadline).toBe(h.options.deadline);
    expect(options.gpu).toBe(h.gpu);
    await options.gpu.prepare('independent stripe compiler', options.deadline, stripeCompiler);
    const mesh = CreatePlane('stripe lifecycle', {}, h.scene);
    const material = new PBRMaterial('stripe lifecycle', h.scene);
    const texture = RawTexture.CreateRGBATexture(new Uint8Array(128 * 32 * 4), 128, 32, h.scene);
    texture.getInternalTexture()!._useSRGBBuffer = true; // CPU allocation seam, not hardware proof.
    mesh.material = material;
    material.albedoTexture = texture;
    h.scene.removeMesh(mesh);
    h.scene.removeMaterial(material);
    h.scene.removeTexture(texture);
    let state: 'prepared' | 'installing' | 'ready' | 'disposed' = 'prepared';
    const cancelled = new AbortController();
    return {
      diagnostics: () => ({
        state,
        mesh,
        material,
        texture,
        sourceCanvas: undefined,
        stagedParts: Number(state === 'prepared'),
        activeParts: Number(h.scene.meshes.includes(mesh)),
        activeMaterials: Number(h.scene.materials.includes(material)),
        activeTextures: Number(h.scene.textures.includes(texture)),
        hardwareSrgb: texture.getInternalTexture()?._useSRGBBuffer === true,
        shadowParity: false,
        bloomParity: false,
      }),
      async install() {
        state = 'installing';
        const finish = h.schedule.prepare();
        h.scene.addMesh(mesh);
        h.scene.addMaterial(material);
        h.scene.addTexture(texture);
        h.schedule.request();
        try {
          await waitForPresentation(h.scene, AbortSignal.any([options.signal, cancelled.signal]), {
            subscribe(listener) {
              return h.gpu.subscribe((receipt) => {
                if (receipt.kind === 'completed' && receipt.ready && receipt.owner === h.scene)
                  stripeReceipts.push(receipt.sequence);
                listener(receipt);
              });
            },
          });
          state = 'ready';
        } finally {
          finish();
        }
      },
      dispose() {
        state = 'disposed';
        cancelled.abort();
        mesh.dispose();
        material.dispose();
        texture.dispose();
      },
    };
  };
  const combined = surface.completion.then(async () => {
    batch = h.start();
    await batch.completion;
    stripe = new StripePreparation(h.options, loadStripe);
    await stripe.completion;
    sceneReady = publication.canPublish(
      h.gpu.diagnostics(),
      surface.completed && batch.completed && stripe.completed && !h.schedule.pending,
    );
    if (!sceneReady) h.schedule.request(); // Same conservative fallback as main.
    publication.dispose();
  });
  void combined.catch(() => {});
  cleanups.push(() => stripe?.dispose());
  const draws: string[] = [];
  const callback = () => {
    const polled = pollPresentationForRender(h.gpu, h.schedule, true);
    if (
      polled.ready &&
      !polled.deferSubmission &&
      surface.canDraw &&
      (!batch || batch.canDraw) &&
      (!stripe || stripe.canDraw)
    )
      h.gpu.frame(h.schedule, true, h.scene, () => {
        draws.push(stripe ? 'stripe' : batch ? 'batch' : 'surface');
        publication.drawn();
        return true;
      });
  };
  await flush();
  for (let callbackCount = 0; callbackCount < 4; callbackCount++) callback();
  expect(h.gpu.diagnostics()).toMatchObject({ submitted: 2, completed: 2 });
  await flush();
  expect(surface.completed).toBe(true);
  expect(batch?.canDraw).toBe(true);
  expect(stripe).toBeUndefined();
  for (let callbackCount = 0; callbackCount < 4; callbackCount++) callback();
  expect(h.gpu.diagnostics()).toMatchObject({ submitted: 4, completed: 4 });
  expect(draws).toEqual(['surface', 'surface', 'batch', 'batch']);
  await flush();
  expect(h.receipts).toEqual({ gantry: [3, 4], lamps: [3, 4], banner: [3, 4] });
  expect(stripeCompiler).toHaveBeenCalledOnce();
  expect(stripe?.canDraw).toBe(true);
  expect(stripe?.completed).toBe(false);
  expect(stripeReceipts).toEqual([]); // No previously completed batch receipt can qualify stripe.
  callback();
  callback();
  await flush();
  expect(stripeReceipts).toEqual([5]);
  expect(stripe?.completed).toBe(false);
  callback();
  callback();
  await combined;
  expect(stripeReceipts).toEqual([5, 6]);
  expect(stripe?.completed).toBe(true);
  expect(draws).toEqual(['surface', 'surface', 'batch', 'batch', 'stripe', 'stripe']);
  expect(sceneReady).toBe(true);
  callback();
  callback();
  expect(h.gpu.diagnostics()).toMatchObject({ submitted: 6, completed: 6, settled: true });
  expect(h.schedule.diagnostics()).toMatchObject({ preparationCount: 0, requested: false });
  expect(h.schedule.pending).toBe(false);
  h.schedule.request(); // A genuine later resize/input demand is never discarded.
  callback();
  callback();
  expect(h.gpu.diagnostics()).toMatchObject({ submitted: 7, completed: 7, settled: true });
});
