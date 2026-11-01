import { afterEach, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer.js';
import { GridPreparation, liveGridPaintEligible } from '../src/engine/babylon/grid-preparation.ts';
import {
  createBabylonGridPaint,
  type BabylonGridPaintOptions,
} from '../src/engine/babylon/grid-paint.ts';
import type { PresentationReceipt } from '../src/engine/babylon/presentation-gpu.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import { RestartOwnership } from '../src/engine/babylon/restart-ownership.ts';
import { Track } from '../src/simulation/track.ts';
import { VELLAMAR } from '../src/simulation/circuits.ts';
import { FORMULA_APX01 } from '../src/simulation/vehicles.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const cleanup: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  cleanup.splice(0).forEach((f) => f());
});
type Owner = Awaited<ReturnType<typeof createBabylonGridPaint>>;
function harness() {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    abort = new AbortController();
  scene.useRightHandedSystem = true;
  const baseline = new PBRMaterial('existing BRDF owner', scene),
    textures = [...scene.textures];
  const stage = deferred(),
    listeners = new Set<(r: PresentationReceipt) => void>();
  let current = true,
    owner: Owner | undefined,
    stagedMeshes: ReturnType<Owner['diagnostics']>['meshes'] = [],
    sequence = 0;
  const options: BabylonGridPaintOptions = {
    scene,
    track: new Track(),
    context: { presentation: 'circuit', vehicles: [FORMULA_APX01] },
    signal: abort.signal,
    deadline: performance.now() + 120000,
    schedule: new PresentationSchedule(),
    isCurrent: () => current,
    gpu: {
      prepare: async (
        _label: string,
        deadline: number,
        work: (signal: AbortSignal) => Promise<unknown>,
      ) => {
        expect(deadline).toBe(options.deadline);
        return work(new AbortController().signal);
      },
      subscribe: (listener: (r: PresentationReceipt) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as BabylonGridPaintOptions['gpu'],
  };
  const load = vi.fn(async (opts: BabylonGridPaintOptions) => {
    expect(opts).toBe(options);
    owner = await createBabylonGridPaint(opts, {
      prepare: async (container, gpu, signal, deadline) => {
        expect(gpu).toBe(options.gpu);
        expect(signal).toBe(abort.signal);
        expect(deadline).toBe(options.deadline);
        stagedMeshes = [...container.meshes] as typeof stagedMeshes;
        await stage.promise;
      },
    });
    return owner;
  });
  cleanup.push(() => {
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
    load,
    listeners,
    owner: () => owner!,
    stagedMeshes: () => stagedMeshes,
    stale: () => {
      current = false;
    },
    completed: (ready = true, sceneOwner: object = scene) => {
      const receipt: PresentationReceipt = {
        kind: 'completed',
        owner: sceneOwner,
        ready,
        sequence: ++sequence,
      };
      for (const listener of [...listeners]) listener(receipt);
    },
    baseline: () => {
      expect(scene.meshes).toHaveLength(0);
      expect(scene.geometries).toHaveLength(0);
      expect(scene.materials).toEqual([baseline]);
      expect(scene.textures).toEqual(textures);
    },
  };
}
async function ready(h: ReturnType<typeof harness>) {
  const grid = new GridPreparation(h.options, h.load);
  h.stage.resolve();
  await flush();
  h.completed();
  h.completed();
  await grid.completion;
  return grid;
}
it('stages the real owner, drains compilation, then requires two actual ready completion receipts', async () => {
  const h = harness(),
    grid = new GridPreparation(h.options, h.load, { staged: true });
  await flush();
  expect(grid.canDraw).toBe(false);
  expect(grid.completed).toBe(false);
  h.baseline();
  expect(() => grid.install()).toThrow('prepared');
  h.stage.resolve();
  await grid.prepared;
  h.baseline();
  expect(h.owner().diagnostics().stagedParts).toBe(2);
  expect(grid.canDraw).toBe(false);
  expect(() => grid.receipt()).toThrow('not ready');
  const completion = grid.install();
  expect(grid.install()).toBe(completion);
  expect(grid.canDraw).toBe(true);
  expect(grid.completed).toBe(false);
  expect(h.scene.meshes).toHaveLength(2);
  h.scene.onAfterRenderObservable.notifyObservers(h.scene);
  await flush();
  expect(grid.completed).toBe(false);
  h.completed(true, {});
  h.completed(false);
  h.completed();
  await flush();
  expect(grid.completed).toBe(false);
  h.completed();
  await completion;
  expect(grid.receipt()).toEqual({
    state: 'ready',
    parts: 2,
    materials: 1,
    textures: 0,
    slots: 12,
    boxes: 36,
    triangles: 432,
    dryOnly: true,
    gpSwitchingParity: false,
    weatherParity: false,
    shadowParity: false,
  });
  expect(h.listeners.size).toBe(0);
  expect(h.scene.lights).toHaveLength(0);
  expect(h.scene.environmentTexture).toBeNull();
});
it.each(['abort', 'stale', 'dispose'] as const)(
  'cold %s never releases compiler-owned resources before drain',
  async (reason) => {
    const h = harness(),
      grid = new GridPreparation(h.options, h.load);
    let ended = false;
    const result = grid.completion.catch((error) => {
      ended = true;
      return error;
    });
    await flush();
    expect(h.stagedMeshes()).toHaveLength(2);
    if (reason === 'abort') h.abort.abort();
    else if (reason === 'stale') h.stale();
    else grid.dispose();
    await flush();
    expect(ended).toBe(false);
    expect(h.stagedMeshes().every((m) => !m.isDisposed())).toBe(true);
    h.stage.resolve();
    expect(await result).toBeInstanceOf(Error);
    expect(grid.canDraw).toBe(false);
    expect(grid.completed).toBe(false);
    h.baseline();
  },
);
it.each(['abort', 'stale'] as const)(
  'cannot publish completed receipts after installing owner becomes %s',
  async (reason) => {
    const h = harness(),
      grid = new GridPreparation(h.options, h.load),
      failed = expect(grid.completion).rejects.toThrow();
    h.stage.resolve();
    await flush();
    h.completed();
    if (reason === 'abort') h.abort.abort();
    else h.stale();
    h.completed();
    await failed;
    expect(grid.completed).toBe(false);
    h.baseline();
  },
);
it.each(['rain', 'changeable', 'flat', 'foreign'] as const)(
  'does not call the factory for live-ineligible %s',
  async (kind) => {
    const h = harness();
    h.options.track =
      kind === 'flat'
        ? new Track('clear', true)
        : kind === 'foreign'
          ? new Track('clear', false, undefined, VELLAMAR)
          : new Track(kind);
    expect(liveGridPaintEligible(h.options.track, h.options.context)).toBe(false);
    const grid = new GridPreparation(h.options, h.load);
    await grid.completion;
    expect(h.load).not.toHaveBeenCalled();
    expect(grid.receipt()).toMatchObject({
      state: 'ineligible',
      parts: 0,
      materials: 0,
      textures: 0,
      slots: 0,
      boxes: 0,
      triangles: 0,
    });
    h.baseline();
  },
);
it('rejects an already expired deadline without allocating or renewing it', async () => {
  const h = harness();
  h.options.deadline = performance.now() - 1;
  const grid = new GridPreparation(h.options, h.load);
  await expect(grid.completion).rejects.toThrow('deadline exceeded');
  expect(h.load).not.toHaveBeenCalled();
  h.baseline();
});
it('rejects installation if the shared original deadline expires after staging', async () => {
  const h = harness(),
    grid = new GridPreparation(h.options, h.load, { staged: true });
  h.stage.resolve();
  await grid.prepared;
  h.options.deadline = performance.now() - 1;
  await expect(grid.install()).rejects.toThrow('deadline exceeded');
  expect(grid.completed).toBe(false);
  h.baseline();
});
it.each([
  'material-binding',
  'material-value',
  'geometry',
  'geometry-replacement',
  'material-replacement',
  'position-buffer',
  'index-buffer',
  'world',
  'unfreeze',
  'visibility',
] as const)('receipt independently rejects changed %s', async (kind) => {
  const h = harness(),
    grid = await ready(h),
    d = h.owner().diagnostics(),
    mesh = d.meshes[0];
  if (kind === 'material-binding') mesh.material = null;
  if (kind === 'material-value') d.material.roughness = 0.7;
  if (kind === 'geometry') mesh.geometry!.releaseForMesh(mesh);
  if (kind === 'geometry-replacement')
    mesh.geometry!.copy('different identity same bytes').applyToMesh(mesh);
  if (kind === 'material-replacement')
    mesh.material = d.material.clone('different identity same values');
  if (kind === 'position-buffer') {
    const positions = Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!);
    positions[0] += 1;
    mesh.setVerticesData(VertexBuffer.PositionKind, positions);
  }
  if (kind === 'index-buffer') {
    const indices = Array.from(mesh.getIndices()!);
    indices[0] = indices[1];
    mesh.setIndices(indices);
  }
  if (kind === 'world') mesh.freezeWorldMatrix(Matrix.Translation(1, 2, 3));
  if (kind === 'unfreeze') mesh.unfreezeWorldMatrix();
  if (kind === 'visibility') mesh.isVisible = false;
  expect(() => grid.receipt()).toThrow('activation incomplete');
});
it('repeated restart changes authority immediately but drains before scene replacement', async () => {
  const h = harness(),
    grid = new GridPreparation(h.options, h.load),
    failed = expect(grid.completion).rejects.toThrow();
  const reset = vi.fn(() => ({})),
    restart = new RestartOwnership(() => h.abort.abort(), reset),
    replace = vi.fn(() => grid.dispose());
  await flush();
  restart.request();
  restart.request();
  expect(restart.drain(false, replace)).toBe(false);
  expect(h.abort.signal.aborted).toBe(true);
  expect(reset).toHaveBeenCalledTimes(2);
  h.stage.resolve();
  await failed;
  expect(restart.drain(true, replace)).toBe(true);
  expect(replace).toHaveBeenCalledWith(reset.mock.results[1].value);
  h.baseline();
});
it.each([undefined, null, false, 0, ''])(
  'partial installation retains falsy primary %s while independently draining resources',
  async (failure) => {
    const h = harness(),
      grid = new GridPreparation(h.options, h.load, { staged: true });
    h.stage.resolve();
    await grid.prepared;
    const d = h.owner().diagnostics(),
      original = h.scene.addMesh.bind(h.scene);
    let calls = 0;
    vi.spyOn(h.scene, 'addMesh').mockImplementation((mesh, recursive) => {
      original(mesh, recursive);
      if (++calls === 2) throw failure;
    });
    const geometry = d.meshes[0].geometry!,
      dispose = geometry.dispose.bind(geometry);
    vi.spyOn(geometry, 'dispose').mockImplementation(() => {
      dispose();
      throw new Error('secondary cleanup');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(grid.install()).rejects.toBe(failure);
    expect(grid.completed).toBe(false);
    expect(d.meshes.every((m) => m.isDisposed())).toBe(true);
    h.baseline();
  },
);
it('explicit cleanup drains ownership despite scene observers being skipped', async () => {
  const h = harness(),
    grid = await ready(h),
    d = h.owner().diagnostics();
  h.scene.onDisposeObservable.add((_scene, event) => {
    event.skipNextObservers = true;
  });
  h.scene.onDisposeObservable.add(() => {
    throw new Error('must be skipped');
  });
  h.scene.dispose();
  grid.dispose();
  expect(grid.completed).toBe(false);
  expect(() => grid.receipt()).toThrow();
  expect(d.meshes.every((m) => m.isDisposed())).toBe(true);
});

it('staged cancellation rejects promptly but explicit disposal owns resource draining', async () => {
  const h = harness(),
    grid = new GridPreparation(h.options, h.load, { staged: true });
  h.stage.resolve();
  await grid.prepared;
  const resources = h.owner().diagnostics();
  h.abort.abort();
  await expect(grid.completion).rejects.toThrow();
  expect(resources.meshes.every((mesh) => !mesh.isDisposed())).toBe(true);
  grid.dispose();
  expect(resources.meshes.every((mesh) => mesh.isDisposed())).toBe(true);
  h.baseline();
});
it('never accepts receipts after the shared deadline has expired during installation', async () => {
  const h = harness(),
    grid = new GridPreparation(h.options, h.load);
  h.stage.resolve();
  await flush();
  h.completed();
  h.options.deadline = performance.now() - 1;
  const failed = expect(grid.completion).rejects.toThrow('deadline exceeded');
  h.completed();
  await failed;
  expect(grid.completed).toBe(false);
  h.baseline();
});

it.each(['vertex', 'index'] as const)(
  'rejects byte-identical %s buffer replacement on the same geometry',
  async (kind) => {
    const h = harness(),
      grid = await ready(h),
      mesh = h.owner().diagnostics().meshes[0];
    const geometry = mesh.geometry!;
    const positions = Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!);
    const indices = Array.from(mesh.getIndices()!);
    const before =
      kind === 'vertex'
        ? mesh.getVertexBuffer(VertexBuffer.PositionKind)!.getBuffer()
        : geometry.getIndexBuffer();
    if (kind === 'vertex') mesh.setVerticesData(VertexBuffer.PositionKind, positions);
    else mesh.setIndices(indices);
    expect(mesh.geometry).toBe(geometry);
    expect(Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!)).toEqual(positions);
    expect(Array.from(mesh.getIndices()!)).toEqual(indices);
    const after =
      kind === 'vertex'
        ? mesh.getVertexBuffer(VertexBuffer.PositionKind)!.getBuffer()
        : geometry.getIndexBuffer();
    expect(after).not.toBe(before);
    expect(() => grid.receipt()).toThrow('activation incomplete');
  },
);
it('rejects removal of the original finish plugin despite unchanged geometry and material counts', async () => {
  const h = harness(),
    grid = await ready(h),
    material = h.owner().diagnostics().material;
  const manager = material.pluginManager!;
  expect(manager.getPlugin('OriginalCircuitPaintFinish')).not.toBeNull();
  material.pluginManager = undefined;
  try {
    expect(() => grid.receipt()).toThrow('activation incomplete');
  } finally {
    material.pluginManager = manager;
  }
});

it('direct disposal preserves the secondary geometry error identity and finalizes each native resource exactly once', async () => {
  const h = harness(),
    grid = await ready(h),
    resources = h.owner().diagnostics();
  const geometries = resources.meshes.map((mesh) => mesh.geometry!);
  const meshNotifications = resources.meshes.map((mesh) => {
    const notification = vi.fn();
    mesh.onDisposeObservable.add(notification);
    return notification;
  });
  const geometryNotifications = geometries.map(() => vi.fn());
  h.scene.onGeometryRemovedObservable.add((geometry) => {
    const index = geometries.indexOf(geometry);
    if (index !== -1) geometryNotifications[index]();
  });
  const failure = new Error('exact independent geometry cleanup failure');
  const disposers = geometries.map((geometry, index) => {
    const dispose = geometry.dispose.bind(geometry);
    return vi.spyOn(geometry, 'dispose').mockImplementation(() => {
      dispose();
      if (index === 0) throw failure;
    });
  });
  let caught: unknown;
  try {
    grid.dispose();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBe(failure);
  expect(grid.completed).toBe(false);
  expect(resources.meshes.every((mesh) => mesh.isDisposed())).toBe(true);
  expect(geometries.every((geometry) => geometry.isDisposed())).toBe(true);
  expect(() => grid.dispose()).not.toThrow();
  for (const notification of [...meshNotifications, ...geometryNotifications])
    expect(notification).toHaveBeenCalledOnce();
  for (const dispose of disposers) expect(dispose).toHaveBeenCalledOnce();
  h.baseline();
});
it('disposal detaches but never adopts or disposes an unrelated replacement geometry', async () => {
  const h = harness(),
    grid = await ready(h),
    resources = h.owner().diagnostics();
  const mesh = resources.meshes[0],
    ownedGeometry = mesh.geometry!;
  const foreignGeometry = ownedGeometry.copy('externally owned replacement');
  foreignGeometry.applyToMesh(mesh);
  const foreignDispose = vi.spyOn(foreignGeometry, 'dispose');
  expect(mesh.geometry).toBe(foreignGeometry);
  expect(() => grid.receipt()).toThrow('activation incomplete');
  grid.dispose();
  expect(mesh.isDisposed()).toBe(true);
  expect(ownedGeometry.isDisposed()).toBe(true);
  expect(foreignGeometry.isDisposed()).toBe(false);
  expect(foreignDispose).not.toHaveBeenCalled();
  expect(h.scene.geometries).toContain(foreignGeometry);
  foreignGeometry.dispose(); // The independent external owner performs its own cleanup.
  h.baseline();
});

it('captures retained resource proof only after public completion, never while staged or currentness is blocked', async () => {
  const h = harness(),
    grid = new GridPreparation(h.options, h.load, { staged: true });
  expect(grid.captureRetainedProof()).toBeNull();
  h.stage.resolve();
  await grid.prepared;
  expect(grid.captureRetainedProof()).toBeNull();
  const installing = grid.install();
  h.completed();
  expect(grid.captureRetainedProof()).toBeNull();
  h.completed();
  await installing;
  const proof = grid.captureRetainedProof();
  expect(proof).not.toBeNull();
  h.stale();
  expect(grid.completed).toBe(false);
  expect(() => grid.receipt()).toThrow();
  expect(grid.captureRetainedProof()).toBeNull();
  // Resource retention is deliberately not current-generation authorization.
  // Main independently validates current scene/component/GPU identity at drain.
  expect(proof!.valid(h.scene)).toBe(true);
  grid.dispose();
  h.baseline();
});
it.each([
  'signal',
  'scene',
  'abort',
  'dispose',
  'material',
  'geometry',
  'buffer',
  'hidden',
] as const)('rejects invalid retained resource proof: %s', async (kind) => {
  const h = harness(),
    grid = await ready(h),
    proof = grid.captureRetainedProof()!;
  expect(proof).not.toBeNull();
  const mesh = h.owner().diagnostics().meshes[0];
  if (kind === 'signal') h.options.signal = new AbortController().signal;
  if (kind === 'abort') h.abort.abort();
  if (kind === 'dispose') grid.dispose();
  if (kind === 'material') h.owner().diagnostics().material.alpha = 0.5;
  if (kind === 'geometry') mesh.geometry!.releaseForMesh(mesh, false);
  if (kind === 'buffer') mesh.getVerticesData('position')![0] += 0.1;
  if (kind === 'hidden') mesh.isVisible = false;
  const other = kind === 'scene' ? new Scene(h.scene.getEngine()) : h.scene;
  try {
    expect(proof.valid(other)).toBe(false);
  } finally {
    if (other !== h.scene) other.dispose();
    grid.dispose();
  }
  h.baseline();
});
it('does not issue a retained proof for an ineligible completed grid scope', async () => {
  const h = harness();
  h.options.track = new Track('rain');
  const grid = new GridPreparation(h.options, h.load);
  await grid.completion;
  expect(grid.completed).toBe(true);
  expect(grid.receipt().state).toBe('ineligible');
  expect(grid.captureRetainedProof()).toBeNull();
  expect(h.load).not.toHaveBeenCalled();
  grid.dispose();
  h.baseline();
});
