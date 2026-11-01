import { TrackBoardsKit } from '../src/rendering/track-boards.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { Track } from '../src/simulation/track.ts';
import { AUREL, VELLAMAR } from '../src/simulation/circuits.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import type { PresentationReceipt } from '../src/engine/babylon/presentation-gpu.ts';
import {
  brakingTripletEligible,
  validateBrakingTripletBytes,
  loadBabylonBrakingTriplet,
} from '../src/engine/babylon/braking-triplet.ts';

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

describe('A09 clean triplet ownership (NullEngine CPU contracts, not GPU parity)', () => {
  it('stages six original resources off-scene and waits for two fresh actual ready receipts', async () => {
    const h = harness();
    h.completed();
    h.completed(); // Before installation: never qualifies the new owner.
    const owner = await h.load(),
      staged = owner.diagnostics();
    expect(staged.parts).toHaveLength(6);
    expect(staged.parts.every(({ mesh }) => !h.scene.meshes.includes(mesh))).toBe(true);
    expect(staged.activeParts).toBe(0);
    let done = false;
    const installed = owner.install().then(() => {
      done = true;
    });
    expect(h.listeners.size).toBe(1);
    expect(
      staged.parts.every(({ mesh }) => h.scene.meshes.includes(mesh) && mesh.isEnabled()),
    ).toBe(true);
    h.scene.onAfterRenderObservable.notifyObservers(h.scene);
    await Promise.resolve();
    expect(done).toBe(false);
    h.completed(true, {});
    h.completed();
    await Promise.resolve();
    expect(done).toBe(false);
    h.completed(false);
    h.completed();
    await Promise.resolve();
    expect(done).toBe(false);
    h.completed();
    await installed;
    expect(owner.diagnostics()).toMatchObject({
      activeParts: 6,
      activeMaterials: 4,
      activeTextures: 6,
    });
    expect(h.listeners.size).toBe(0);
    await expect(owner.install()).rejects.toThrow();
    owner.dispose();
    owner.dispose();
    expect(staged.parts.every(({ mesh }) => mesh.isDisposed())).toBe(true);
    h.baseline();
  });
  it('resets the consecutive pair on loss and does not accept another scene completion', async () => {
    const h = harness(),
      owner = await h.load();
    let done = false;
    const installed = owner.install().then(() => {
      done = true;
    });
    h.completed();
    h.emit({ kind: 'lost' });
    h.completed();
    h.completed(true, {});
    await Promise.resolve();
    expect(done).toBe(false);
    h.completed();
    await installed;
    owner.dispose();
    h.baseline();
  });
  it.each(['cancel', 'stale', 'disposed'] as const)(
    'rejects %s ownership before fetching',
    async (kind) => {
      const h = harness();
      if (kind === 'cancel') h.abort.abort();
      if (kind === 'stale') h.stale();
      if (kind === 'disposed') h.scene.dispose();
      await expect(h.load()).rejects.toThrow();
      expect(h.dependencies.fetcher).not.toHaveBeenCalled();
    },
  );
  it('rejects altered bytes before native decoding', async () => {
    const h = harness(),
      raw = bytes();
    await validateBrakingTripletBytes(raw, h.abort.signal);
    raw[raw.length - 1] ^= 1;
    await expect(validateBrakingTripletBytes(raw, h.abort.signal)).rejects.toThrow();
    const decode = vi.fn();
    await expect(h.load({ fetcher: async () => new Response(raw), decode })).rejects.toThrow();
    expect(decode).not.toHaveBeenCalled();
    h.baseline();
  });
  it('requires the original Aurel dry Formula context before allocating resources', async () => {
    const h = harness();
    expect(brakingTripletEligible(h.options.track, context)).toBe(true);
    for (const track of [
      new Track('rain'),
      new Track('clear', true),
      new Track('clear', false, undefined, VELLAMAR),
    ]) {
      expect(brakingTripletEligible(track, context)).toBe(false);
      await expect(
        loadBabylonBrakingTriplet({ ...h.options, track }, h.dependencies),
      ).rejects.toThrow();
    }
    expect(
      brakingTripletEligible(new Track('clear', false, undefined, { ...AUREL }), context),
    ).toBe(false);
    expect(brakingTripletEligible(h.options.track, { ...context, vehicles: [] })).toBe(false);
    expect(h.dependencies.fetcher).not.toHaveBeenCalled();
    h.baseline();
  });
  it('rejects left-handed scene and an expired absolute deadline without import', async () => {
    const h = harness();
    h.scene.useRightHandedSystem = false;
    await expect(h.load()).rejects.toThrow();
    h.scene.useRightHandedSystem = true;
    h.options.deadline = performance.now() - 1;
    await expect(h.load()).rejects.toThrow();
    expect(h.dependencies.fetcher).not.toHaveBeenCalled();
    h.baseline();
  });
  it('holds resources until the existing compiler lane drains after cancellation', async () => {
    const h = harness(),
      entered = deferred(),
      drain = deferred();
    let meshes: Scene['meshes'] = [];
    const pending = h.load({
      prepare: async (container, gpu, _signal, deadline) => {
        meshes = [...container.meshes];
        await gpu.prepare('held original A09 compiler', deadline, async () => {
          entered.resolve();
          await drain.promise;
        });
      },
    });
    const rejected = expect(pending).rejects.toThrow();
    await entered.promise;
    h.abort.abort();
    expect(h.inLane()).toBe(true);
    expect(meshes).toHaveLength(6);
    expect(meshes.every((mesh) => !mesh.isDisposed())).toBe(true);
    expect(h.listeners.size).toBe(0);
    drain.resolve();
    await rejected;
    expect(h.inLane()).toBe(false);
    expect(meshes.every((mesh) => mesh.isDisposed())).toBe(true);
    h.baseline();
  });
  it.each(['cancel', 'stale', 'deadline'] as const)(
    'never installs %s staged owner',
    async (kind) => {
      const h = harness(),
        owner = await h.load();
      if (kind === 'cancel') h.abort.abort();
      if (kind === 'stale') h.stale();
      const clock =
        kind === 'deadline'
          ? vi.spyOn(performance, 'now').mockReturnValue(h.options.deadline + 1)
          : undefined;
      try {
        await expect(owner.install()).rejects.toThrow();
      } finally {
        clock?.mockRestore();
      }
      owner.dispose();
      h.baseline();
    },
  );
  it('explicit disposal rejects pending receipts even when scene observers are skipped', async () => {
    const h = harness(),
      owner = await h.load(),
      d = owner.diagnostics();
    const install = owner.install(),
      rejected = expect(install).rejects.toThrow();
    h.scene.onDisposeObservable.clear();
    owner.dispose();
    await rejected;
    h.completed();
    h.completed();
    expect(h.listeners.size).toBe(0);
    expect(d.parts.every(({ mesh }) => mesh.isDisposed())).toBe(true);
    expect(owner.diagnostics().activeParts).toBe(0);
    h.baseline();
  });
  it.each([undefined, null, false, 0, ''])(
    'preserves falsy partial-install primary %s while independently draining failed cleanup',
    async (primary) => {
      const h = harness(),
        owner = await h.load(),
        d = owner.diagnostics();
      const add = h.scene.addMesh.bind(h.scene);
      let calls = 0;
      vi.spyOn(h.scene, 'addMesh').mockImplementation((mesh, ...rest) => {
        add(mesh, ...rest);
        if (++calls === 2) throw primary;
      });
      const geometry = d.parts[0].mesh.geometry!,
        dispose = geometry.dispose.bind(geometry);
      vi.spyOn(geometry, 'dispose').mockImplementation(() => {
        dispose();
        throw new Error('secondary cleanup');
      });
      let rejected = false,
        caught: unknown;
      try {
        await owner.install();
      } catch (error) {
        rejected = true;
        caught = error;
      }
      expect(rejected).toBe(true);
      expect(caught).toBe(primary);
      expect(d.parts.every(({ mesh }) => mesh.isDisposed())).toBe(true);
      expect(owner.diagnostics().activeParts).toBe(0);
      h.baseline();
    },
  );
  it('rejects a foreign-scene decoder result without adopting external resources', async () => {
    const h = harness(),
      other = new Scene(h.engine);
    scenes.push(other);
    other.useRightHandedSystem = true;
    const foreign = await LoadAssetContainerAsync(bytes(), other, { pluginExtension: '.glb' });
    const foreignMeshes = [...foreign.meshes];
    await expect(h.load({ decode: async () => foreign })).rejects.toThrow();
    expect(foreignMeshes.every((mesh) => !mesh.isDisposed())).toBe(true);
    h.baseline();
    foreign.dispose();
  });
  it('keeps independent replacement geometry alive during owner disposal', async () => {
    const h = harness(),
      owner = await h.load(),
      mesh = owner.diagnostics().parts[0].mesh;
    const original = mesh.geometry!,
      replacement = original.copy('unrelated replacement');
    replacement.applyToMesh(mesh);
    owner.dispose();
    expect(original.isDisposed()).toBe(true);
    expect(mesh.isDisposed()).toBe(true);
    expect(replacement.isDisposed()).toBe(false);
    replacement.dispose();
    h.baseline();
  });
  it('preserves the existing shared BRDF and unrelated material through repeated ownership', async () => {
    const h = harness();
    for (let cycle = 0; cycle < 3; cycle++) {
      const owner = await h.load(),
        install = owner.install();
      h.completed();
      h.completed();
      await install;
      owner.dispose();
      h.baseline();
    }
  });
  it('binds original atlas textures and three independent front-only offset print materials', async () => {
    const h = harness(),
      owner = await h.load(),
      d = owner.diagnostics();
    const structures = d.parts.filter((part) => part.kind === 'structure');
    const prints = d.parts.filter((part) => part.kind === 'print');
    expect(structures).toHaveLength(3);
    expect(prints).toHaveLength(3);
    expect(new Set(structures.map((part) => part.material)).size).toBe(1);
    const atlas = structures[0].material as PBRMaterial;
    expect(atlas.albedoTexture).not.toBeNull();
    expect(atlas.bumpTexture).not.toBeNull();
    expect(atlas.metallicTexture).not.toBeNull();
    for (const { mesh, material } of prints) {
      const print = material as PBRMaterial;
      expect(mesh.sideOrientation).toBe(Material.CounterClockWiseSideOrientation);
      expect(print.backFaceCulling).toBe(true);
      expect(print.zOffset).toBe(-1);
      expect(print.zOffsetUnits).toBe(-1);
      expect(print.roughness).toBe(0.72);
      expect(print.albedoTexture!.getSize()).toEqual({ width: 256, height: 256 });
      expect(print.albedoTexture!.gammaSpace).toBe(false);
      expect(print.albedoTexture!.getInternalTexture()!._useSRGBBuffer).toBe(true);
    }
    expect(new Set(prints.map((part) => part.material)).size).toBe(3);
    owner.dispose();
    h.baseline();
  });
  it.each(['mesh', 'material', 'texture'] as const)(
    'drains a partial %s constructor registration while preserving falsy failure and exact method identity',
    async (kind) => {
      const h = harness(),
        buffers = [...h.engine._uniformBuffers];
      const failure = null;
      let captured = false,
        allocating = false;
      const method =
        kind === 'mesh' ? 'addMesh' : kind === 'material' ? 'addMaterial' : 'addTexture';
      const original = h.scene[method].bind(h.scene) as (
        value: { name: string },
        recursive?: boolean,
      ) => unknown;
      const spy = vi.spyOn(h.scene, method).mockImplementation(((
        value: { name: string },
        recursive?: boolean,
      ) => {
        const result = original(value, recursive);
        if (
          (kind === 'mesh' && value.name === 'Original A09 triplet part') ||
          (kind === 'material' && value.name === 'Original A09 print') ||
          (kind === 'texture' && allocating)
        ) {
          captured = true;
          throw failure;
        }
        return result;
      }) as never);
      const descriptor = Object.getOwnPropertyDescriptor(h.scene, method);
      await expect(
        h.load({
          allocateTexture: (...args) => {
            allocating = true;
            try {
              return allocateA09Texture(...args);
            } finally {
              allocating = false;
            }
          },
        }),
      ).rejects.toBe(failure);
      expect(captured).toBe(true);
      expect(Object.getOwnPropertyDescriptor(h.scene, method)).toEqual(descriptor);
      expect(h.engine._uniformBuffers).toEqual(buffers);
      h.baseline();
      spy.mockRestore();
    },
  );
  it.each([undefined, null, false, 0, ''])(
    'retains Created-hook primary %s and does not dispose an unrelated nested material',
    async (failure) => {
      const h = harness(),
        buffers = [...h.engine._uniformBuffers];
      let captured: Material | undefined, external: PBRMaterial | undefined;
      const hook = Material.OnEventObservable.add((material) => {
        if (material.name !== 'Original A09 print') return;
        captured = material;
        expect(Object.hasOwn(material, '_directIntensity')).toBe(false);
        external = new PBRMaterial('independent Created-hook material', h.scene);
        throw failure;
      }, 1);
      try {
        await expect(h.load()).rejects.toBe(failure);
        expect(captured).toBeDefined();
        expect(h.scene.materials).not.toContain(captured);
        expect(h.scene.materials).toContain(external);
        external!.dispose();
        expect(h.engine._uniformBuffers).toEqual(buffers);
        h.baseline();
      } finally {
        Material.OnEventObservable.remove(hook);
      }
    },
  );
  it('cancels immediately after native decode and drains every imported resource', async () => {
    const h = harness();
    let imported: Scene['meshes'] = [];
    await expect(
      h.load({
        decode: async (raw, scene) => {
          const container = await LoadAssetContainerAsync(raw, scene, { pluginExtension: '.glb' });
          imported = [...container.meshes];
          h.abort.abort();
          return container;
        },
      }),
    ).rejects.toThrow();
    expect(imported.length).toBeGreaterThan(0);
    expect(imported.every((mesh) => mesh.isDisposed())).toBe(true);
    h.baseline();
  });
  it('cancellation during installation removes subscriptions and rejects old completion', async () => {
    const h = harness(),
      owner = await h.load();
    const install = owner.install(),
      rejected = expect(install).rejects.toThrow();
    h.completed();
    h.abort.abort();
    await rejected;
    h.completed();
    h.completed();
    expect(h.listeners.size).toBe(0);
    expect(owner.diagnostics().activeParts).toBe(0);
    h.baseline();
  });
  it('does not adopt an unrelated texture returned by an allocation seam', async () => {
    const h = harness();
    const foreign = allocateA09Texture(new Uint8Array(256 * 256 * 4), 256, 256, h.scene);
    const internal = foreign.getInternalTexture();
    await expect(h.load({ allocateTexture: () => foreign })).rejects.toThrow('ownership mismatch');
    expect(foreign.getInternalTexture()).toBe(internal);
    expect(h.scene.textures).toContain(foreign);
    foreign.dispose();
    h.baseline();
  });
  it.each([
    'hidden',
    'transparent',
    'disabled',
    'detached',
    'foreign-material',
    'foreign-geometry',
  ] as const)(
    'counts only actually registered expected resources after %s mutation',
    async (kind) => {
      const h = harness(),
        owner = await h.load(),
        installing = owner.install();
      h.completed();
      h.completed();
      await installing;
      const part = owner.diagnostics().parts.find((p) => p.kind === 'print')!;
      let foreignMaterial: PBRMaterial | undefined;
      let foreignGeometry: NonNullable<typeof part.mesh.geometry> | undefined;
      if (kind === 'hidden') part.mesh.isVisible = false;
      if (kind === 'transparent') part.mesh.visibility = 0;
      if (kind === 'disabled') part.mesh.setEnabled(false);
      if (kind === 'detached') h.scene.removeMesh(part.mesh);
      if (kind === 'foreign-material') {
        foreignMaterial = new PBRMaterial('unrelated replacement material', h.scene);
        part.mesh.material = foreignMaterial;
      }
      if (kind === 'foreign-geometry') {
        foreignGeometry = part.mesh.geometry!.copy('unrelated replacement geometry');
        foreignGeometry.setIndices([0, 1, 2]);
        foreignGeometry.applyToMesh(part.mesh);
        expect(part.mesh.getTotalIndices()).toBe(3);
      }
      const d = owner.diagnostics();
      expect(d.activeParts).toBe(5);
      expect(d.activeMaterials).toBe(3);
      expect(d.activeTextures).toBe(5);
      expect(d.retainedMaterials).toBe(4);
      expect(d.retainedTextures).toBe(6);
      expect(d.retainedTriangles).toBe(4950);
      owner.dispose();
      if (foreignMaterial) {
        expect(h.scene.materials).toContain(foreignMaterial);
        foreignMaterial.dispose();
      }
      if (foreignGeometry) {
        expect(foreignGeometry.isDisposed()).toBe(false);
        foreignGeometry.dispose();
      }
      h.baseline();
    },
  );
  it('never counts or releases an externally substituted print texture', async () => {
    const h = harness(),
      owner = await h.load(),
      installing = owner.install();
    h.completed();
    h.completed();
    await installing;
    const part = owner.diagnostics().parts.find((p) => p.kind === 'print')!;
    const original = part.material.albedoTexture!;
    const foreign = allocateA09Texture(new Uint8Array(256 * 256 * 4), 256, 256, h.scene);
    const internal = foreign.getInternalTexture();
    part.material.albedoTexture = foreign;
    const d = owner.diagnostics();
    expect(d.activeTextures).toBe(5);
    expect(d.retainedTextures).toBe(6);
    owner.dispose();
    expect(original.getInternalTexture()).toBeNull();
    expect(foreign.getInternalTexture()).toBe(internal);
    expect(h.scene.textures).toContain(foreign);
    foreign.dispose();
    h.baseline();
  });
  it('uploads every native geometry only in the existing GPU lane and never polls scene readiness', async () => {
    const h = harness();
    const apply = VertexData.prototype.applyToMesh;
    const uploads = vi.spyOn(VertexData.prototype, 'applyToMesh').mockImplementation(function (
      this: VertexData,
      ...args
    ) {
      expect(h.inLane()).toBe(true);
      return apply.apply(this, args);
    });
    const ready = vi.spyOn(h.scene, 'isReady');
    const owner = await h.load(),
      installing = owner.install();
    expect(uploads.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(h.inLane()).toBe(false);
    h.completed();
    h.completed();
    await installing;
    expect(ready).not.toHaveBeenCalled();
    owner.dispose();
    h.baseline();
  });
});

describe('independent original source cleanup failure boundary', () => {
  it.each(['cleanup-only', 'construction-primary'] as const)(
    'preserves %s while draining all native allocations',
    async (kind) => {
      const h = harness(),
        secondary = new Error('original Three cleanup failure');
      const dispose = TrackBoardsKit.prototype.dispose;
      const cleaned = vi.spyOn(TrackBoardsKit.prototype, 'dispose').mockImplementation(function (
        this: TrackBoardsKit,
      ) {
        dispose.call(this);
        throw secondary;
      });
      if (kind === 'construction-primary')
        vi.spyOn(TrackBoardsKit.prototype, 'build').mockImplementation(() => {
          throw false;
        });
      vi.spyOn(console, 'error').mockImplementation(() => {
        throw new Error('reporter failure');
      });
      await expect(h.load()).rejects.toBe(kind === 'construction-primary' ? false : secondary);
      expect(cleaned).toHaveBeenCalledTimes(1);
      h.baseline();
    },
  );
});
