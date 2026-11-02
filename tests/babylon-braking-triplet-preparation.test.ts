import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { Track } from '../src/simulation/track.ts';
import { VELLAMAR } from '../src/simulation/circuits.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import type { PresentationReceipt } from '../src/engine/babylon/presentation-gpu.ts';
import { A09ClipOrderPlugin } from '../src/engine/babylon/braking-triplet-clip-order.ts';
import {
  loadBabylonBrakingTriplet,
  type BabylonBrakingTripletOptions,
} from '../src/engine/babylon/braking-triplet.ts';
import {
  BrakingTripletPreparation,
  brakingTripletPreparationValid,
} from '../src/engine/babylon/braking-triplet-preparation.ts';
import {
  a09Bytes,
  allocateA09Texture,
  installA09CanvasFixture,
} from './fixtures/a09-triplet-original.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const cleanups: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const clean of cleanups.splice(0).reverse()) clean();
  vi.unstubAllGlobals();
});
type Owner = Awaited<ReturnType<typeof loadBabylonBrakingTriplet>>;
function harness() {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    abort = new AbortController();
  scene.useRightHandedSystem = true;
  engine.getCaps().supportSRGBBuffers = true;
  installA09CanvasFixture();
  const baseline = new PBRMaterial('foreign shared BRDF owner', scene),
    textures = [...scene.textures];
  const stage = deferred(),
    entered = deferred();
  const listeners = new Set<(r: PresentationReceipt) => void>();
  let current = true,
    sequence = 0,
    inLane = false,
    owner: Owner | undefined,
    signal: AbortSignal | undefined;
  const options: BabylonBrakingTripletOptions = {
    scene,
    track: new Track(),
    context: {
      presentation: 'circuit',
      vehicles: [{ classId: 'formula', dynamicsKind: 'four-wheel' }],
    },
    base: 'https://example.invalid/',
    signal: abort.signal,
    deadline: performance.now() + 120000,
    isCurrent: () => current,
    schedule: new PresentationSchedule(),
    gpu: {
      prepare: async (
        _label: string,
        deadline: number,
        work: (signal: AbortSignal) => Promise<unknown>,
      ) => {
        expect(deadline).toBe(options.deadline);
        expect(inLane).toBe(false);
        inLane = true;
        try {
          return await work(new AbortController().signal);
        } finally {
          inLane = false;
        }
      },
      subscribe: (listener: (r: PresentationReceipt) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as BabylonBrakingTripletOptions['gpu'],
  };
  const fetcher = vi.fn(async () => new Response(a09Bytes()));
  const load = vi.fn(async (received: BabylonBrakingTripletOptions) => {
    expect(received).not.toBe(options);
    expect(received.signal).not.toBe(options.signal);
    expect(received.scene).toBe(options.scene);
    expect(received.gpu).toBe(options.gpu);
    expect(received.deadline).toBe(options.deadline);
    signal = received.signal;
    owner = await loadBabylonBrakingTriplet(received, {
      fetcher,
      decode: (bytes, target) => {
        expect(inLane).toBe(true);
        return LoadAssetContainerAsync(bytes, target, { pluginExtension: '.glb' });
      },
      allocateTexture: (...args) => {
        expect(inLane).toBe(true);
        return allocateA09Texture(...args);
      },
      prepare: async (_container, gpu, compilerSignal, deadline) => {
        expect(gpu).toBe(options.gpu);
        expect(compilerSignal).toBe(received.signal);
        expect(deadline).toBe(options.deadline);
        entered.resolve();
        await stage.promise;
      },
    });
    // NullEngine has no native allocation. Opaque CPU-only handles exercise exact
    // identity/lifetime validation, not GPU upload, shader or texture readiness.
    for (const { mesh } of owner.diagnostics().parts) {
      for (const kind of ['position', 'normal', 'uv']) {
        const buffer = mesh.getVertexBuffer(kind)!.getBuffer()!;
        Object.defineProperty(buffer, 'underlyingResource', { configurable: true, value: {} });
      }
      Object.defineProperty(mesh.geometry!.getIndexBuffer()!, 'underlyingResource', {
        configurable: true,
        value: {},
      });
    }
    for (const material of new Set(owner.diagnostics().parts.map((p) => p.material))) {
      for (const texture of material.getActiveTextures()) {
        const internal = texture.getInternalTexture()!;
        internal.isReady = true;
        internal._hardwareTexture = {
          underlyingResource: {},
          release() {},
          reset() {},
        } as unknown as NonNullable<typeof internal._hardwareTexture>;
      }
    }
    return owner;
  });
  cleanups.push(() => {
    abort.abort();
    owner?.dispose();
    scene.dispose();
    engine.dispose();
  });
  return {
    options,
    scene,
    abort,
    stage,
    entered,
    load,
    fetcher,
    listeners,
    baseline,
    owner: () => owner!,
    signal: () => signal!,
    current: (value: boolean) => {
      current = value;
    },
    emit: (receipt: PresentationReceipt) => {
      for (const listener of [...listeners]) listener(receipt);
    },
    completed: (ready = true, receiptOwner: object = scene) => {
      for (const listener of [...listeners])
        listener({ kind: 'completed', owner: receiptOwner, sequence: ++sequence, ready });
    },
    assertBaseline: () => {
      expect(scene.meshes).toEqual([]);
      expect(scene.geometries).toEqual([]);
      expect(scene.materials).toEqual([baseline]);
      expect(scene.textures).toEqual(textures);
    },
  };
}
async function prepared(h: ReturnType<typeof harness>) {
  const p = new BrakingTripletPreparation(h.options, h.load, { staged: true });
  h.stage.resolve();
  await p.prepared;
  return p;
}
async function ready(h: ReturnType<typeof harness>) {
  const p = await prepared(h);
  p.install();
  h.completed();
  h.completed();
  await p.completion;
  return p;
}

describe('held A09 readiness ownership (CPU contracts, not native rasterization evidence)', () => {
  it('stages the actual owner, installs synchronously and requires two fresh same-scene completed ready receipts', async () => {
    const h = harness(),
      p = new BrakingTripletPreparation(h.options, h.load, { staged: true });
    await h.entered.promise;
    expect(p.canDraw).toBe(false);
    expect(p.completed).toBe(false);
    expect(() => p.install()).toThrow('prepared');
    h.assertBaseline();
    h.completed();
    h.completed();
    h.stage.resolve();
    await p.prepared;
    h.assertBaseline();
    expect(p.captureRetainedProof()).toBeNull();
    const completion = p.install();
    expect(p.install()).toBe(completion);
    expect(h.listeners.size).toBe(1);
    expect(p.canDraw).toBe(true);
    expect(p.completed).toBe(false);
    expect(h.scene.meshes).toHaveLength(6);
    h.scene.onAfterRenderObservable.notifyObservers(h.scene);
    h.completed(true, {});
    await flush();
    expect(p.completed).toBe(false);
    h.completed();
    h.completed(false);
    h.completed();
    await flush();
    expect(p.completed).toBe(false);
    h.emit({ kind: 'lost' });
    h.completed();
    await flush();
    expect(p.completed).toBe(false);
    h.completed();
    await completion;
    expect(p.receipt()).toEqual({
      state: 'ready',
      parts: 6,
      triangles: 4950,
      scope: 'dry-formula-first-clean-triplet-fixed-lod0',
    });
    expect(brakingTripletPreparationValid(p)).toBe(true);
    expect(brakingTripletPreparationValid(undefined)).toBe(false);
    expect(brakingTripletPreparationValid(p, {} as BrakingTripletPreparation)).toBe(false);
    expect(h.listeners.size).toBe(0);
    p.dispose();
    p.dispose();
    h.assertBaseline();
  });
  it('auto-installs without blocking the frames needed to complete', async () => {
    const h = harness(),
      p = new BrakingTripletPreparation(h.options, h.load);
    h.stage.resolve();
    await p.prepared;
    await flush();
    expect(p.canDraw).toBe(true);
    expect(p.completed).toBe(false);
    h.completed();
    h.completed();
    await p.completion;
    expect(brakingTripletPreparationValid(p)).toBe(true);
  });
  it.each(['wet', 'flat', 'circuit', 'vehicle', 'presentation'] as const)(
    'does not fetch for ineligible %s',
    async (kind) => {
      const h = harness();
      if (kind === 'wet') h.options.track = new Track('rain');
      if (kind === 'flat') h.options.track = new Track('clear', true);
      if (kind === 'circuit') h.options.track = new Track('clear', false, undefined, VELLAMAR);
      if (kind === 'vehicle')
        h.options.context = {
          presentation: 'circuit',
          vehicles: [{ classId: 'touring', dynamicsKind: 'four-wheel' }],
        };
      if (kind === 'presentation')
        h.options.context = { ...h.options.context, presentation: 'studio' };
      const p = new BrakingTripletPreparation(h.options, h.load);
      await p.completion;
      expect(h.load).not.toHaveBeenCalled();
      expect(h.fetcher).not.toHaveBeenCalled();
      expect(p.receipt()).toEqual({
        state: 'ineligible',
        parts: 0,
        triangles: 0,
        scope: 'dry-formula-first-clean-triplet-fixed-lod0',
      });
      expect(p.captureRetainedProof()).toBeNull();
      h.assertBaseline();
    },
  );
  it.each(['dispose', 'abort', 'stale'] as const)(
    'drains held compilation after %s without publishing stale ownership',
    async (mode) => {
      const h = harness(),
        p = new BrakingTripletPreparation(h.options, h.load);
      await h.entered.promise;
      let settled = false;
      void p.completion.catch(() => {
        settled = true;
      });
      if (mode === 'dispose') p.dispose();
      else if (mode === 'abort') h.abort.abort();
      else h.current(false);
      await flush();
      expect(settled).toBe(false);
      expect(p.canDraw).toBe(false);
      h.stage.resolve();
      await expect(p.completion).rejects.toBeDefined();
      h.assertBaseline();
      expect(p.captureRetainedProof()).toBeNull();
    },
  );
  it.each(['dispose', 'abort'] as const)(
    'settles staged cancellation before install: %s',
    async (mode) => {
      const h = harness(),
        p = await prepared(h);
      if (mode === 'dispose') p.dispose();
      else h.abort.abort();
      await expect(p.completion).rejects.toBeDefined();
      expect(p.canDraw).toBe(false);
      p.dispose();
      h.assertBaseline();
    },
  );
  it('cancels the installed wait and never counts an old pair toward replacement', async () => {
    const h = harness(),
      p = await prepared(h);
    p.install();
    h.completed();
    p.dispose();
    await expect(p.completion).rejects.toBeDefined();
    expect(h.listeners.size).toBe(0);
    const next = await prepared(h);
    next.install();
    h.completed();
    await flush();
    expect(next.completed).toBe(false);
    h.completed();
    await next.completion;
    expect(next.completed).toBe(true);
  });
  it('enforces the original absolute deadline even when timeout callbacks have not run', async () => {
    const h = harness(),
      p = await prepared(h);
    p.install();
    vi.spyOn(performance, 'now').mockReturnValue(h.options.deadline + 1);
    h.completed();
    h.completed();
    await expect(p.completion).rejects.toThrow();
    expect(p.completed).toBe(false);
    h.assertBaseline();
  });
  it('retained proof bypasses pending public current only, not the captured composed signal', async () => {
    const h = harness(),
      cohort = new AbortController();
    h.options.signal = AbortSignal.any([h.abort.signal, cohort.signal]);
    const p = await ready(h),
      proof = p.captureRetainedProof()!;
    expect(h.signal()).not.toBe(h.options.signal);
    expect(proof.valid(h.scene)).toBe(true);
    h.current(false);
    expect(p.completed).toBe(false);
    expect(p.canDraw).toBe(false);
    expect(() => p.receipt()).toThrow();
    expect(p.captureRetainedProof()).toBeNull();
    expect(brakingTripletPreparationValid(p)).toBe(false);
    expect(proof.valid(h.scene)).toBe(true);
    expect(proof.valid({} as Scene)).toBe(false);
    cohort.abort();
    expect(h.abort.signal.aborted).toBe(false);
    expect(proof.valid(h.scene)).toBe(false);
  });
  it('private disposal aborts the forwarded signal without aborting the caller', async () => {
    const h = harness(),
      p = await ready(h),
      proof = p.captureRetainedProof()!;
    p.dispose();
    expect(h.signal().aborted).toBe(true);
    expect(h.abort.signal.aborted).toBe(false);
    expect(proof.valid(h.scene)).toBe(false);
    expect(p.captureRetainedProof()).toBeNull();
  });
  it.each([undefined, null, false, 0, ''])(
    'preserves exact falsy primary %s through failed cleanup',
    async (primary) => {
      const h = harness(),
        real = await loadPreparedOwner(h);
      const original = real.dispose.bind(real);
      vi.spyOn(real, 'dispose').mockImplementation(() => {
        original();
        throw new Error('secondary cleanup');
      });
      vi.spyOn(real, 'install').mockImplementation(() => {
        throw primary;
      });
      vi.spyOn(console, 'error').mockImplementation(() => {
        throw new Error('logger failure');
      });
      const p = new BrakingTripletPreparation(h.options, async () => real, { staged: true });
      await p.prepared;
      p.install();
      await expect(p.completion).rejects.toBe(primary);
      expect(p.canDraw).toBe(false);
      expect(p.completed).toBe(false);
      h.assertBaseline();
    },
  );
});
async function loadPreparedOwner(h: ReturnType<typeof harness>) {
  h.stage.resolve();
  return h.load({ ...h.options, signal: AbortSignal.any([h.options.signal]) });
}

type Mutation = (h: ReturnType<typeof harness>) => void;
const mutations: [string, Mutation][] = [
  [
    'native vertex handle',
    (h) => {
      const b = h.owner().diagnostics().parts[0].mesh.getVertexBuffer('position')!.getBuffer()!;
      Object.defineProperty(b, 'underlyingResource', { configurable: true, value: {} });
    },
  ],
  [
    'native index handle',
    (h) => {
      const b = h.owner().diagnostics().parts[0].mesh.geometry!.getIndexBuffer()!;
      Object.defineProperty(b, 'underlyingResource', { configurable: true, value: null });
    },
  ],
  [
    'native texture handle',
    (h) => {
      const t = h.owner().diagnostics().labels[0].texture.getInternalTexture()!;
      Object.defineProperty(t._hardwareTexture!, 'underlyingResource', {
        configurable: true,
        value: {},
      });
    },
  ],
  [
    'internal texture readiness',
    (h) => {
      h.owner().diagnostics().labels[0].texture.getInternalTexture()!.isReady = false;
    },
  ],
  [
    'delay load state',
    (h) => {
      h.owner().diagnostics().labels[0].texture.delayLoadState = 4;
    },
  ],
  [
    'base weight',
    (h) => {
      h.owner().diagnostics().parts[0].material.baseWeight = 0.5;
    },
  ],
  [
    'clear coat enable',
    (h) => {
      h.owner().diagnostics().parts[0].material.clearCoat.isEnabled = true;
    },
  ],
  [
    'extra PBR map',
    (h) => {
      const d = h.owner().diagnostics();
      d.parts[0].material.emissiveTexture = d.labels[0].texture;
    },
  ],

  [
    'position bytes',
    (h) => {
      h.owner().diagnostics().parts[0].mesh.getVerticesData('position')![0] += 0.01;
    },
  ],
  [
    'normal bytes',
    (h) => {
      h.owner().diagnostics().parts[0].mesh.getVerticesData('normal')![0] += 0.01;
    },
  ],
  [
    'UV bytes',
    (h) => {
      h.owner().diagnostics().parts[0].mesh.getVerticesData('uv')![0] += 0.01;
    },
  ],
  [
    'index bytes',
    (h) => {
      h.owner().diagnostics().parts[0].mesh.getIndices()![0] += 1;
    },
  ],
  [
    'world matrix',
    (h) => {
      h.owner()
        .diagnostics()
        .parts[0].mesh.freezeWorldMatrix(Matrix.Translation(1, 0, 0));
    },
  ],
  [
    'visibility',
    (h) => {
      h.owner().diagnostics().parts[0].mesh.visibility = 0.5;
    },
  ],
  [
    'detached mesh',
    (h) => {
      h.scene.removeMesh(h.owner().diagnostics().parts[0].mesh);
    },
  ],
  [
    'submesh range',
    (h) => {
      h.owner().diagnostics().parts[0].mesh.subMeshes[0].indexCount -= 3;
    },
  ],
  [
    'vertex buffer replacement',
    (h) => {
      const m = h.owner().diagnostics().parts[0].mesh;
      m.setVerticesBuffer(
        new VertexBuffer(h.scene.getEngine(), m.getVerticesData('position')!, 'position', false),
      );
    },
  ],
  [
    'roughness',
    (h) => {
      h.owner().diagnostics().parts[0].material.roughness = 0.123;
    },
  ],
  [
    'color',
    (h) => {
      h.owner().diagnostics().parts[0].material.albedoColor.r = 0.123;
    },
  ],
  [
    'plugin invalidation',
    (h) => {
      (
        h
          .owner()
          .diagnostics()
          .parts[0].material.pluginManager!.getPlugin('OriginalA09ClipOrder') as A09ClipOrderPlugin
      ).invalidate();
    },
  ],
  [
    'sampler',
    (h) => {
      h.owner().diagnostics().labels[0].texture.wrapU += 1;
    },
  ],
  [
    'internal sRGB',
    (h) => {
      h.owner().diagnostics().labels[0].texture.getInternalTexture()!._useSRGBBuffer = false;
    },
  ],
  [
    'label pixels',
    (h) => {
      h.owner().diagnostics().labels[0].pixels[0] ^= 1;
    },
  ],
  [
    'print canvas',
    (h) => {
      h.owner().diagnostics().labels[0].sourceCanvas.width = 255;
    },
  ],
  [
    'print offset',
    (h) => {
      h.owner().diagnostics().labels[0].material.zOffset = 0;
    },
  ],
];
it.each(mutations)(
  'rejects retained %s mutation after prior successful validation',
  async (_name, mutate) => {
    const h = harness(),
      p = await ready(h),
      proof = p.captureRetainedProof()!;
    expect(brakingTripletPreparationValid(p)).toBe(true);
    expect(proof.valid(h.scene)).toBe(true);
    mutate(h);
    expect(() => p.receipt()).toThrow();
    expect(brakingTripletPreparationValid(p)).toBe(false);
    expect(proof.valid(h.scene)).toBe(false);
    expect(p.captureRetainedProof()).toBeNull();
  },
);
it('does not adopt or dispose replacement foreign materials and textures', async () => {
  const h = harness(),
    p = await ready(h),
    foreign = new PBRMaterial('foreign', h.scene);
  const texture = allocateA09Texture(new Uint8Array(256 * 256 * 4), 256, 256, h.scene);
  foreign.albedoTexture = texture;
  h.owner().diagnostics().parts[0].mesh.material = foreign;
  expect(brakingTripletPreparationValid(p)).toBe(false);
  p.dispose();
  expect(h.scene.materials).toContain(foreign);
  expect(h.scene.textures).toContain(texture);
  expect(texture.getInternalTexture()).not.toBeNull();
  foreign.dispose();
  texture.dispose();
  h.assertBaseline();
});

it('readiness validation does not call texture readiness or delay-load paths', async () => {
  const h = harness(),
    p = await ready(h);
  const spies = [
    ...new Set(
      h
        .owner()
        .diagnostics()
        .parts.flatMap((part) => part.material.getActiveTextures()),
    ),
  ].flatMap((texture) => [
    vi.spyOn(texture, 'isReady').mockImplementation(() => {
      throw new Error('off-lane readiness');
    }),
    vi.spyOn(texture, 'delayLoad').mockImplementation(() => {
      throw new Error('off-lane load');
    }),
  ]);
  expect(brakingTripletPreparationValid(p)).toBe(true);
  expect(p.captureRetainedProof()!.valid(h.scene)).toBe(true);
  for (const spy of spies) expect(spy).not.toHaveBeenCalled();
});
it.each(['vertex', 'index', 'texture'] as const)(
  'rejects unknown %s handles before capturing a readiness proof',
  async (kind) => {
    const h = harness();
    const load = async (options: BabylonBrakingTripletOptions) => {
      const owner = await h.load(options),
        d = owner.diagnostics();
      if (kind === 'texture') d.labels[0].texture.getInternalTexture()!._hardwareTexture = null;
      else {
        const buffer =
          kind === 'vertex'
            ? d.parts[0].mesh.getVertexBuffer('position')!.getBuffer()!
            : d.parts[0].mesh.geometry!.getIndexBuffer()!;
        Object.defineProperty(buffer, 'underlyingResource', { configurable: true, value: null });
      }
      return owner;
    };
    const p = new BrakingTripletPreparation(h.options, load);
    h.stage.resolve();
    await expect(p.completion).rejects.toThrow();
    expect(p.captureRetainedProof()).toBeNull();
    h.assertBaseline();
  },
);
it('preserves a falsy partial native scene installation failure and drains every owned resource', async () => {
  const h = harness(),
    p = await prepared(h),
    add = h.scene.addMesh.bind(h.scene);
  let count = 0;
  vi.spyOn(h.scene, 'addMesh').mockImplementation((...args) => {
    const result = add(...args);
    if (++count === 3) throw false;
    return result;
  });
  p.install();
  await expect(p.completion).rejects.toBe(false);
  expect(count).toBe(3);
  expect(p.completed).toBe(false);
  expect(p.canDraw).toBe(false);
  expect(h.listeners.size).toBe(0);
  h.assertBaseline();
});
it('a throwing owner disposal still invalidates public and retained readiness first', async () => {
  const h = harness(),
    p = await ready(h),
    proof = p.captureRetainedProof()!,
    owner = h.owner(),
    dispose = owner.dispose.bind(owner);
  vi.spyOn(owner, 'dispose').mockImplementation(() => {
    dispose();
    throw null;
  });
  let thrown: unknown = 'not thrown';
  try {
    p.dispose();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeNull();
  expect(p.completed).toBe(false);
  expect(p.canDraw).toBe(false);
  expect(proof.valid(h.scene)).toBe(false);
  h.assertBaseline();
});
