import '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { loadBabylonBrakingTriplet as loadFirstTriplet } from '../src/engine/babylon/braking-triplet.ts';
import { BrakingTripletPreparation } from '../src/engine/babylon/braking-triplet-preparation.ts';
import { A09ClipOrderPlugin } from '../src/engine/babylon/braking-triplet-clip-order.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { Track } from '../src/simulation/track.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import type { PresentationReceipt } from '../src/engine/babylon/presentation-gpu.ts';
import { loadBabylonSecondBrakingTriplet as loadBabylonBrakingTriplet } from '../src/engine/babylon/braking-triplet.ts';

const context = {
  presentation: 'circuit',
  vehicles: [{ classId: 'formula', dynamicsKind: 'four-wheel' }],
} as const;
const bytes = () => new Uint8Array(readFileSync('public/models/aurel-track-boards.glb'));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const engines: NullEngine[] = [];
const scenes: Scene[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const scene of scenes.splice(0)) if (!scene.isDisposed) scene.dispose();
  for (const engine of engines.splice(0)) engine.dispose();
  vi.unstubAllGlobals();
});

type Dependencies = NonNullable<Parameters<typeof loadBabylonBrakingTriplet>[1]>;
function harness() {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    abort = new AbortController();
  scene.useRightHandedSystem = true;
  engine.getCaps().supportSRGBBuffers = true;
  engines.push(engine);
  scenes.push(scene);
  installA09CanvasFixture();
  const baselineMaterial = new PBRMaterial('unrelated shared BRDF owner', scene);
  const baselineTextures = [...scene.textures];
  const listeners = new Set<(receipt: PresentationReceipt) => void>();
  let sequence = 0,
    current = true,
    inLane = false;
  const options: Parameters<typeof loadBabylonBrakingTriplet>[0] = {
    scene,
    track: new Track(),
    context,
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
      subscribe: (listener: (receipt: PresentationReceipt) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as Parameters<typeof loadBabylonBrakingTriplet>[0]['gpu'],
  };
  const dependencies: Dependencies = {
    fetcher: vi.fn(async () => new Response(bytes())),
    allocateTexture: (...args) => {
      expect(inLane).toBe(true);
      return allocateA09Texture(...args);
    },
    decode: async (raw, target) => {
      expect(inLane).toBe(true);
      return LoadAssetContainerAsync(raw, target, { pluginExtension: '.glb' });
    },
    prepare: async (container, gpu, signal, deadline) => {
      expect(container.meshes).toHaveLength(6);
      expect(gpu).toBe(options.gpu);
      expect(signal).toBe(abort.signal);
      expect(deadline).toBe(options.deadline);
    },
  };
  return {
    engine,
    scene,
    abort,
    options,
    dependencies,
    listeners,
    baselineMaterial,
    baselineTextures,
    stale: () => {
      current = false;
    },
    inLane: () => inLane,
    load: (extra: Dependencies = {}) =>
      loadBabylonBrakingTriplet(options, { ...dependencies, ...extra }),
    emit: (receipt: PresentationReceipt) => {
      for (const listener of [...listeners]) listener(receipt);
    },
    completed: (ready = true, owner: object = scene) => {
      const receipt: PresentationReceipt = {
        kind: 'completed',
        owner,
        ready,
        sequence: ++sequence,
      };
      for (const listener of [...listeners]) listener(receipt);
    },
    baseline: () => {
      expect(scene.meshes).toEqual([]);
      expect(scene.geometries).toEqual([]);
      expect(scene.transformNodes).toEqual([]);
      expect(scene.materials).toEqual([baselineMaterial]);
      expect(scene.textures).toEqual(baselineTextures);
      expect(baselineTextures.every((texture) => texture.getInternalTexture() !== null)).toBe(true);
    },
  };
}

// Synthetic canvas pixels and a declared sRGB metadata seam exercise ownership
// only. Real stroke rasterization/native texture sampling require the GPU fixture.
import { installA09CanvasFixture, allocateA09Texture } from './fixtures/a09-triplet-original.ts';

describe('isolated second original A09 triplet ownership', () => {
  it('installs six mixed-variant parts synchronously but requires its own fresh ready pair', async () => {
    const h = harness();
    h.completed();
    h.completed();
    const owner = await h.load(),
      d = owner.diagnostics();
    expect(d).toMatchObject({
      state: 'prepared',
      stagedParts: 6,
      activeParts: 0,
      retainedTriangles: 4994,
      stations: [1020, 1070, 1120],
      lod: 0,
      dryOnly: true,
      sectorBoards: false,
      lodSelection: false,
    });
    expect(h.baselineTextures).toHaveLength(1);
    const plugins = new Set(
      d.parts.map(
        (p) => p.material.pluginManager!.getPlugin('OriginalA09ClipOrder') as A09ClipOrderPlugin,
      ),
    );
    expect(plugins.size).toBe(4);
    let ready = false;
    const installed = owner.install().then(() => {
      ready = true;
    });
    expect(h.listeners.size).toBe(1);
    expect(d.parts.every((p) => h.scene.meshes.includes(p.mesh))).toBe(true);
    h.scene.onAfterRenderObservable.notifyObservers(h.scene);
    h.completed(true, {});
    h.completed();
    h.completed(false);
    h.completed();
    await Promise.resolve();
    expect(ready).toBe(false);
    h.emit({ kind: 'lost' });
    h.completed();
    await Promise.resolve();
    expect(ready).toBe(false);
    h.completed();
    await installed;
    expect(owner.diagnostics()).toMatchObject({
      state: 'ready',
      activeParts: 6,
      activeMaterials: 4,
      activeTextures: 6,
      retainedTriangles: 4994,
    });
    expect(d.labels.map((l) => l.text)).toEqual(['150', '100', '50']);
    expect(new Set(d.labels.map((l) => l.texture)).size).toBe(3);
    owner.dispose();
    owner.dispose();
    expect([...plugins].every((p) => !p.isValid)).toBe(true);
    expect(h.listeners.size).toBe(0);
    h.baseline();
  });
  it('drains the owned compiler before cancellation reclaims staged resources', async () => {
    const h = harness(),
      entered = deferred(),
      finish = deferred();
    let parts: typeof h.scene.meshes = [];
    const loading = h.load({
      prepare: async (container) => {
        parts = [...container.meshes];
        entered.resolve();
        await finish.promise;
      },
    });
    const rejected = loading.catch((error) => error);
    await entered.promise;
    h.abort.abort();
    await Promise.resolve();
    expect(parts).toHaveLength(6);
    expect(parts.every((mesh) => !mesh.isDisposed())).toBe(true);
    finish.resolve();
    expect(await rejected).toMatchObject({ name: 'AbortError' });
    expect(parts.every((mesh) => mesh.isDisposed())).toBe(true);
    h.baseline();
  });
  it.each([undefined, null, false, 0, ''])(
    'preserves partial-install falsy primary %s while draining all owned resources',
    async (primary) => {
      const h = harness(),
        owner = await h.load(),
        d = owner.diagnostics();
      const add = h.scene.addMesh.bind(h.scene);
      let count = 0;
      vi.spyOn(h.scene, 'addMesh').mockImplementation((...args) => {
        add(...args);
        if (++count === 3) throw primary;
      });
      const geometry = d.parts[0].geometry,
        dispose = geometry.dispose.bind(geometry);
      vi.spyOn(geometry, 'dispose').mockImplementation(() => {
        dispose();
        throw new Error('secondary geometry cleanup');
      });
      vi.spyOn(console, 'error').mockImplementation(() => {
        throw new Error('reporter must not replace primary');
      });
      const sentinel = {};
      let caught: unknown = sentinel;
      try {
        await owner.install();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBe(primary);
      expect(h.listeners.size).toBe(0);
      expect(d.parts.every((p) => p.mesh.isDisposed() && p.geometry.isDisposed())).toBe(true);
      h.baseline();
    },
  );
  it('does not adopt or destroy an externally replaced geometry and shared foreign resources', async () => {
    const h = harness(),
      owner = await h.load(),
      parts = owner.diagnostics().parts;
    const installed = owner.install();
    h.completed();
    h.completed();
    await installed;
    const foreign = new Mesh('foreign geometry owner', h.scene);
    VertexData.CreateBox({ size: 1 }).applyToMesh(foreign);
    const material = new PBRMaterial('foreign material', h.scene);
    foreign.material = material;
    const geometry = foreign.geometry!;
    geometry.applyToMesh(parts[0].mesh);
    owner.dispose();
    expect(foreign.isDisposed()).toBe(false);
    expect(geometry.isDisposed()).toBe(false);
    expect(foreign.geometry).toBe(geometry);
    expect(h.scene.materials).toContain(material);
    foreign.dispose();
    material.dispose();
    h.baseline();
  });
  it('retains dry non-flat Aurel Formula eligibility and original deadline before any fetch', async () => {
    for (const track of [new Track('rain'), new Track('clear', true)]) {
      const h = harness();
      h.options.track = track;
      await expect(h.load()).rejects.toThrow('A09 requires original Aurel Formula context');
      expect(h.dependencies.fetcher).not.toHaveBeenCalled();
      h.baseline();
    }
    const h = harness();
    h.options.deadline = performance.now() - 1;
    await expect(h.load()).rejects.toThrow('deadline');
    expect(h.dependencies.fetcher).not.toHaveBeenCalled();
    h.baseline();
  });
  it('preserves an independently owned first triplet and its shared BRDF during second-owner teardown', async () => {
    const h = harness();
    const first = await loadFirstTriplet(h.options, h.dependencies);
    const firstInstall = first.install();
    h.completed();
    h.completed();
    await firstInstall;
    const retained = first.diagnostics(),
      textures = [...h.scene.textures],
      materials = [...h.scene.materials];
    const second = await h.load();
    const secondInstall = second.install();
    h.completed();
    h.completed();
    await secondInstall;
    second.dispose();
    expect(first.diagnostics()).toMatchObject({
      state: 'ready',
      activeParts: 6,
      activeMaterials: 4,
      activeTextures: 6,
      retainedTriangles: 4950,
      stations: [420, 470, 520],
    });
    expect(
      retained.parts.every((p) => h.scene.meshes.includes(p.mesh) && !p.geometry.isDisposed()),
    ).toBe(true);
    expect(h.scene.textures).toEqual(textures);
    expect(h.scene.materials).toEqual(materials);
    first.dispose();
    h.baseline();
  });
  it('does not relax the unchanged live first-triplet readiness guard for the isolated second selection', async () => {
    const h = harness();
    const preparation = new BrakingTripletPreparation(
      h.options,
      (options) =>
        loadBabylonBrakingTriplet(options, {
          ...h.dependencies,
          prepare: async (container, gpu, signal, deadline) => {
            expect(container.meshes).toHaveLength(6);
            expect(gpu).toBe(h.options.gpu);
            expect(deadline).toBe(h.options.deadline);
            expect(signal).toBe(options.signal);
            expect(signal).not.toBe(h.abort.signal);
            expect(signal.aborted).toBe(false);
          },
        }),
      { staged: true },
    );
    await expect(preparation.prepared).rejects.toThrow('A09 prepared owner contract changed');
    await expect(preparation.completion).rejects.toThrow('A09 prepared owner contract changed');
    expect(preparation.completed).toBe(false);
    h.baseline();
  });
});
