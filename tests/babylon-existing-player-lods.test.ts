import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import {
  loadExistingPlayer,
  existingPlayerPrimitiveBindings,
} from '../src/engine/babylon/existing-player.ts';
import { loadPlayerLods, type PlayerLodData } from '../src/engine/assets/player-lod-data.ts';
import { ExistingPlayerLods } from '../src/engine/babylon/existing-player-lods.ts';
import { BabylonPresentationGpu } from '../src/engine/babylon/presentation-gpu.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import manifest from '../src/rendering/supplied-player-lods.manifest.json' with { type: 'json' };

function boundary() {
  const state = { wait: 3, lost: false };
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    TIMEOUT_EXPIRED: 2,
    ALREADY_SIGNALED: 3,
    CONDITION_SATISFIED: 4,
    isContextLost: () => state.lost,
    clientWaitSync: vi.fn(() => state.wait),
    fenceSync: vi.fn(() => ({})),
    deleteSync: vi.fn(),
    flush: vi.fn(),
  } as unknown as WebGL2RenderingContext;
  const gpu = new BabylonPresentationGpu(gl);
  return {
    state,
    gl,
    gpu,
    prepare: vi.spyOn(gpu, 'prepare'),
    schedule: new PresentationSchedule(),
  };
}
const request = (signal = new AbortController().signal) => ({
  signal,
  deadline: performance.now() + 10000,
});
const same = (a: readonly unknown[], b: readonly unknown[]) => {
  expect(a.length).toBe(b.length);
  a.forEach((value, i) => expect(value).toBe(b[i]));
};

describe('opt-in original Babylon index tiers (actual asset; NullEngine is not GPU acceptance)', () => {
  let packed: Uint8Array<ArrayBuffer>, data: PlayerLodData;
  let engine: NullEngine,
    scene: Scene,
    container: AssetContainer,
    owner: ReturnType<typeof boundary>;
  const bindings = () => existingPlayerPrimitiveBindings(container);
  const adapter = () => new ExistingPlayerLods(bindings(), data, owner.gpu);
  beforeAll(async () => {
    packed = new Uint8Array(readFileSync('public/models/supplied-player.glb.gz'));
    const derivative = new Uint8Array(readFileSync('public/models/supplied-player-lods.bin.gz'));
    // Use the real hash-verifying transport, not an unchecked parsed substitute.
    data = await loadPlayerLods(
      'https://example.invalid/lods',
      new AbortController().signal,
      async () => new Response(derivative),
    );
  });
  beforeEach(async () => {
    engine = new NullEngine();
    scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    const fetcher = vi.fn<typeof fetch>(async () => new Response(packed));
    vi.stubGlobal('fetch', fetcher);
    try {
      container = await loadExistingPlayer(
        scene,
        'https://example.invalid/',
        new AbortController().signal,
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
    owner = boundary();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    owner?.gpu.dispose();
    container?.dispose();
    scene?.dispose();
    engine?.dispose();
  });

  it('constructs at exact full detail; switches all verified streams and restores original arrays/resources', async () => {
    const rows = bindings(),
      originals = rows.map(({ mesh }) => mesh.getIndices()!);
    const before = rows.map(({ mesh }) => ({
      geometry: mesh.geometry,
      submesh: mesh.subMeshes[0],
      bounds: mesh.getBoundingInfo(),
      material: mesh.material,
      parent: mesh.parent,
      skeleton: mesh.skeleton,
      buffers: mesh.getVerticesDataKinds().map((kind) => mesh.getVertexBuffer(kind)),
      arrays: mesh.getVerticesDataKinds().map((kind) => mesh.getVertexBuffer(kind)!.getData()),
    }));
    const resourceArrays = [
      container.meshes,
      container.geometries,
      container.materials,
      container.textures,
      container.skeletons,
      container.animationGroups,
    ].map((values) => [...values]);
    const originalCopies = originals.map((indices) => Array.from(indices));
    const lods = adapter();
    same(
      rows.map(({ mesh }) => mesh.getIndices()),
      originals,
    );
    expect(owner.prepare).not.toHaveBeenCalled();
    expect(lods.diagnostics()).toMatchObject({ tier: 0, selectedTier: 0, triangles: 1455118 });
    for (const tier of [1, 2, 3, 0]) {
      await lods.setTier(tier, request());
      let triangles = 0;
      rows.forEach(({ mesh, source }, i) => {
        const level = tier ? data.rows.get(source.key)!.levels[tier - 1] : null;
        const expected =
          !level || level.offset === -1
            ? originals[i]
            : data.indices.subarray(level.offset, level.offset + level.count);
        const actual = mesh.getIndices()!;
        expect(actual.length).toBe(expected.length);
        expect(actual.every((value, j) => value === expected[j] && value < source.vertices)).toBe(
          true,
        );
        triangles += actual.length / 3;
        const old = before[i];
        expect(mesh.geometry).toBe(old.geometry);
        expect(mesh.subMeshes[0]).toBe(old.submesh);
        expect(mesh.subMeshes).toHaveLength(1);
        expect(old.submesh.IsGlobal).toBe(true);
        expect(mesh.getBoundingInfo()).toBe(old.bounds);
        expect(old.submesh.getBoundingInfo()).toBe(old.bounds);
        expect(mesh.material).toBe(old.material);
        expect(mesh.parent).toBe(old.parent);
        expect(mesh.skeleton).toBe(old.skeleton);
        same(
          mesh.getVerticesDataKinds().map((kind) => mesh.getVertexBuffer(kind)),
          old.buffers,
        );
        same(
          mesh.getVerticesDataKinds().map((kind) => mesh.getVertexBuffer(kind)!.getData()),
          old.arrays,
        );
      });
      expect(triangles).toBe(manifest.triangles[tier]);
      expect(lods.diagnostics()).toMatchObject({ tier, selectedTier: tier, failed: false });
    }
    same(
      rows.map(({ mesh }) => mesh.getIndices()),
      originals,
    );
    originals.forEach((indices, i) =>
      expect(indices.every((value, j) => value === originalCopies[i][j])).toBe(true),
    );
    [
      container.meshes,
      container.geometries,
      container.materials,
      container.textures,
      container.skeletons,
      container.animationGroups,
    ].forEach((values, i) => same(values, resourceArrays[i]));
    expect(container.textures).toHaveLength(82);
    expect(container.materials).toHaveLength(101);
    expect(container.skeletons[0].bones).toHaveLength(59);
    const calls = owner.prepare.mock.calls.length;
    await lods.setTier(0, request());
    expect(owner.prepare).toHaveBeenCalledTimes(calls);
    await lods.dispose(request().deadline);
    expect(rows.every(({ mesh }) => !mesh.isDisposed())).toBe(true);
    await expect(lods.setTier(1, request())).rejects.toThrow('disposed');
  });

  it('snapshots derivative streams/metadata without changing retained source arrays', async () => {
    const copied: PlayerLodData = {
      indices: data.indices.slice(),
      rows: new Map([...data.rows].map(([key, row]) => [key, structuredClone(row)])),
    };
    const lods = new ExistingPlayerLods(bindings(), copied, owner.gpu);
    copied.indices.fill(0);
    for (const row of copied.rows.values()) row.levels.length = 0;
    await lods.setTier(1, request());
    for (const { mesh, source } of bindings()) {
      const level = data.rows.get(source.key)!.levels[0];
      if (level.offset >= 0)
        expect(
          mesh.getIndices()!.every((value, i) => value === data.indices[level.offset + i]),
        ).toBe(true);
    }
    await lods.dispose(request().deadline);
    expect(lods.diagnostics().tier).toBe(0);
  });

  it('rejects malformed ranges, indices and late ownership before any mutation or lease', async () => {
    const original = bindings().map(({ mesh }) => mesh.getIndices());
    expect(() => new ExistingPlayerLods([...bindings()], data, owner.gpu)).toThrow(
      'mutable primitive bindings',
    );
    const bad = { indices: data.indices.slice(), rows: data.rows };
    bad.indices[bad.indices.length - 1] = 0xffffffff;
    expect(() => new ExistingPlayerLods(bindings(), bad, owner.gpu)).toThrow('derivative vertex');
    const badRows = new Map([...data.rows].map(([key, row]) => [key, structuredClone(row)]));
    [...badRows.values()].find((row) => row.levels[0].offset >= 0)!.levels[0].offset += 3;
    expect(
      () => new ExistingPlayerLods(bindings(), { indices: data.indices, rows: badRows }, owner.gpu),
    ).toThrow('range ownership');
    const lods = adapter(),
      last = bindings().at(-1)!.mesh;
    const geometry = last.geometry!,
      update = geometry.onGeometryUpdated;
    const callback = vi.fn();
    geometry.onGeometryUpdated = callback;
    await expect(lods.setTier(1, request())).rejects.toThrow('ownership changed');
    expect(callback).not.toHaveBeenCalled();
    geometry.onGeometryUpdated = update;
    last.subMeshes[0].indexStart = 1;
    await expect(lods.setTier(1, request())).rejects.toThrow('ownership changed');
    last.subMeshes[0].indexStart = 0;
    await expect(lods.setTier(4, request())).rejects.toThrow('tier');
    await expect(
      lods.setTier(1, { signal: new AbortController().signal, deadline: -1 }),
    ).rejects.toThrow('deadline');
    same(
      bindings().map(({ mesh }) => mesh.getIndices()),
      original,
    );
    expect(owner.prepare).not.toHaveBeenCalled();
    await lods.dispose(request().deadline);
  });

  it('waits for prior draw, rejects cancellation before commit without poisoning its owner', async () => {
    owner.state.wait = owner.gl.TIMEOUT_EXPIRED;
    owner.gpu.frame(owner.schedule, false, scene, () => true);
    const lods = adapter(),
      original = bindings().map(({ mesh }) => mesh.getIndices());
    const cancel = new AbortController(),
      pending = lods.setTier(1, request(cancel.signal));
    const rejection = expect(pending).rejects.toThrow('cancel before commit');
    await vi.waitFor(() => expect(owner.gpu.diagnostics().preparation.active).toBe(true));
    same(
      bindings().map(({ mesh }) => mesh.getIndices()),
      original,
    );
    await expect(lods.setTier(2, request())).rejects.toThrow('pending');
    cancel.abort(new Error('cancel before commit'));
    owner.state.wait = owner.gl.ALREADY_SIGNALED;
    await rejection;
    same(
      bindings().map(({ mesh }) => mesh.getIndices()),
      original,
    );
    expect(owner.gpu.ready()).toBe(true);
    expect(lods.diagnostics().failed).toBe(false);
    await lods.setTier(1, request());
    await lods.dispose(request().deadline);
  });

  it('revalidates all bindings after acquiring the lease, before the first write', async () => {
    owner.state.wait = owner.gl.TIMEOUT_EXPIRED;
    owner.gpu.frame(owner.schedule, false, scene, () => true);
    const lods = adapter(),
      first = bindings()[0].mesh.getIndices(),
      last = bindings().at(-1)!.mesh;
    const pending = lods.setTier(1, request()),
      rejection = expect(pending).rejects.toThrow('ownership changed');
    await vi.waitFor(() => expect(owner.gpu.diagnostics().preparation.active).toBe(true));
    last.subMeshes[0].indexStart = 1;
    owner.state.wait = owner.gl.ALREADY_SIGNALED;
    await rejection;
    expect(bindings()[0].mesh.getIndices()).toBe(first);
    expect(owner.gpu.ready()).toBe(true);
    expect(lods.diagnostics().failed).toBe(false);
    last.subMeshes[0].indexStart = 0;
    await lods.dispose(request().deadline);
  });

  it('does not abandon an already committed upload when caller cancellation arrives', async () => {
    owner.state.wait = owner.gl.TIMEOUT_EXPIRED;
    const lods = adapter(),
      cancel = new AbortController();
    let settled = false;
    const pending = lods.setTier(1, request(cancel.signal)).then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(lods.diagnostics().selectedTier).toBe(1));
    expect(lods.diagnostics().tier).toBe(0);
    cancel.abort();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    expect(owner.gpu.ready()).toBe(false);
    owner.state.wait = owner.gl.ALREADY_SIGNALED;
    await pending;
    expect(lods.diagnostics().tier).toBe(1);
    await lods.dispose(request().deadline);
    expect(lods.diagnostics().tier).toBe(0);
    expect(owner.prepare).toHaveBeenCalledTimes(2);
  });

  it('dispose cancels a waiting change, keeps the model alive and permits no later use', async () => {
    owner.state.wait = owner.gl.TIMEOUT_EXPIRED;
    owner.gpu.frame(owner.schedule, false, scene, () => true);
    const lods = adapter(),
      original = bindings().map(({ mesh }) => mesh.getIndices());
    const pending = lods.setTier(2, request()),
      rejection = expect(pending).rejects.toThrow('closing');
    await vi.waitFor(() => expect(owner.gpu.diagnostics().preparation.active).toBe(true));
    const closing = lods.dispose(request().deadline);
    owner.state.wait = owner.gl.ALREADY_SIGNALED;
    await rejection;
    await closing;
    same(
      bindings().map(({ mesh }) => mesh.getIndices()),
      original,
    );
    expect(lods.diagnostics()).toMatchObject({ disposed: true, abandoned: false, tier: 0 });
    await lods.dispose(-1);
    expect(bindings().every(({ mesh }) => !mesh.isDisposed())).toBe(true);
  });

  it('dispose waits for committed upload then restores through a second owned lease', async () => {
    owner.state.wait = owner.gl.TIMEOUT_EXPIRED;
    const lods = adapter(),
      originals = bindings().map(({ mesh }) => mesh.getIndices());
    const pending = lods.setTier(3, request());
    await vi.waitFor(() => expect(lods.diagnostics().selectedTier).toBe(3));
    const closing = lods.dispose(request().deadline);
    expect(lods.diagnostics().disposed).toBe(false);
    owner.state.wait = owner.gl.ALREADY_SIGNALED;
    await pending;
    await closing;
    same(
      bindings().map(({ mesh }) => mesh.getIndices()),
      originals,
    );
    expect(owner.prepare).toHaveBeenCalledTimes(2);
    expect(lods.diagnostics().disposed).toBe(true);
  });

  it('allows explicit safe disposal retry after an expired caller deadline', async () => {
    const lods = adapter();
    await lods.setTier(2, request());
    const current = bindings().map(({ mesh }) => mesh.getIndices());
    await expect(lods.dispose(-1)).rejects.toThrow('deadline');
    same(
      bindings().map(({ mesh }) => mesh.getIndices()),
      current,
    );
    expect(lods.diagnostics()).toMatchObject({ failed: false, disposed: false, closing: false });
    await lods.dispose(request().deadline);
    expect(lods.diagnostics().tier).toBe(0);
  });

  it('rejects an already-busy owner without claiming to poison or steal its existing lease', async () => {
    let release!: () => void;
    const other = owner.gpu.prepare(
      'other caller',
      request().deadline,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const lods = adapter(),
      originals = bindings().map(({ mesh }) => mesh.getIndices());
    await expect(lods.setTier(1, request())).rejects.toThrow('already owns');
    same(
      bindings().map(({ mesh }) => mesh.getIndices()),
      originals,
    );
    expect(lods.diagnostics().failed).toBe(true);
    release();
    await other;
    expect(owner.gpu.ready()).toBe(true);
    await expect(lods.dispose(request().deadline)).rejects.toThrow('already owns');
    container.dispose();
    await lods.dispose(request().deadline);
    expect(lods.diagnostics().abandoned).toBe(true);
  });

  it('poisons partial allocation failure, preserves first error and delegates all teardown', async () => {
    const rows = bindings(),
      originals = rows.map(({ mesh }) => mesh.getIndices()),
      lods = adapter();
    const originalCreate = engine.createIndexBuffer.bind(engine),
      error = new Error('allocation at index 4');
    let count = 0;
    vi.spyOn(engine, 'createIndexBuffer').mockImplementation((...args) => {
      if (++count === 4) throw error;
      return originalCreate(...args);
    });
    await expect(lods.setTier(3, request())).rejects.toBe(error);
    expect(count).toBe(4);
    expect(rows.some(({ mesh }, i) => mesh.getIndices() !== originals[i])).toBe(true);
    expect(rows.some(({ mesh }, i) => mesh.getIndices() === originals[i])).toBe(true);
    expect(lods.diagnostics()).toMatchObject({
      failed: true,
      tier: null,
      selectedTier: null,
      triangles: null,
    });
    expect(() => owner.gpu.ready()).toThrow(error.message);
    await expect(lods.setTier(0, request())).rejects.toBe(error);
    await expect(lods.dispose(request().deadline)).rejects.toBe(error);
    expect(count).toBe(4);
    expect(rows.every(({ mesh }) => !mesh.isDisposed())).toBe(true);
    owner.gpu.dispose();
    container.dispose();
    await lods.dispose(request().deadline);
    expect(lods.diagnostics()).toMatchObject({
      disposed: true,
      abandoned: true,
      failed: true,
      failure: error.message,
    });
    expect(count).toBe(4);
  });

  it('does not claim completion/restoration after context loss during upload fencing', async () => {
    owner.state.wait = owner.gl.TIMEOUT_EXPIRED;
    const lods = adapter(),
      pending = lods.setTier(1, request());
    const rejection = expect(pending).rejects.toThrow('context lost');
    await vi.waitFor(() => expect(lods.diagnostics().selectedTier).toBe(1));
    owner.state.lost = true;
    owner.gpu.contextLost();
    await rejection;
    expect(lods.diagnostics()).toMatchObject({ failed: true, tier: null });
    await expect(lods.dispose(request().deadline)).rejects.toThrow('context lost');
    container.dispose();
    await lods.dispose(request().deadline);
    expect(lods.diagnostics()).toMatchObject({ disposed: true, abandoned: true, tier: null });
  });
});
