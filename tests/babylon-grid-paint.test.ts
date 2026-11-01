import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { createBabylonGridPaint, gridPaintEligible } from '../src/engine/babylon/grid-paint.ts';
import { CircuitPaintFinishPlugin } from '../src/engine/babylon/circuit-paint-finish.ts';
import {
  materialVariants,
  prepareOriginalMaterials,
} from '../src/engine/babylon/asset-preparation.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import type { PresentationReceipt } from '../src/engine/babylon/presentation-gpu.ts';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { VELLAMAR } from '../src/simulation/circuits.ts';
import { clamp } from '../src/core/math.ts';
import { batchScene, box } from '../src/rendering/geometry.ts';
import { surfaceGridFor } from '../src/rendering/studio/road-detail.ts';
import { installCircuitFinish } from '../src/rendering/circuit-finish.ts';

const context = {
  presentation: 'circuit',
  vehicles: [{ classId: 'formula', dynamicsKind: 'four-wheel' }],
} as const;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
/** Execute the already-frozen pre-port negative control, not the candidate's
 * GridPaintPresentation helper. No second parent batching is introduced. */
function reference(track: Track) {
  const text = readFileSync('tests/gp-grid-paint.test.ts', 'utf8');
  const start = text.indexOf('function originalGrid('),
    end = text.indexOf('\n\ndescribe(', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const body = text
    .slice(start, end)
    .replace('track: Track, material: T.MeshStandardMaterial', 'track, material');
  const build = new Function(
    'T',
    'surfaceGridFor',
    'trackPoint',
    'clamp',
    'box',
    'batchScene',
    `${body}; return originalGrid;`,
  )(T, surfaceGridFor, trackPoint, clamp, box, batchScene) as (
    track: Track,
    material: T.MeshStandardMaterial,
  ) => T.Group;
  const circuit = readFileSync('src/rendering/circuit.ts', 'utf8');
  const grid = circuit.indexOf('  private grid() {');
  const materialStart = circuit.indexOf('    const paint = ', grid);
  const materialEnd = circuit.indexOf('    if (!isMotocrossVenue', materialStart);
  expect(grid).toBeGreaterThan(0);
  expect(materialEnd).toBeGreaterThan(materialStart);
  const material = new Function(
    'T',
    'installCircuitFinish',
    `${circuit.slice(materialStart, materialEnd)}; return paint;`,
  )(T, installCircuitFinish) as T.MeshStandardMaterial;
  const root = build(track, material),
    meshes: T.Mesh[] = [];
  root.updateMatrixWorld(true);
  root.traverseVisible((node) => {
    if (node instanceof T.Mesh) meshes.push(node);
  });
  return {
    material,
    root,
    meshes,
    dispose() {
      meshes.forEach((mesh) => mesh.geometry.dispose());
      material.dispose();
    },
  };
}

describe('Isolated original Formula grid paint CPU contracts (not GPU parity)', () => {
  const scenes: Scene[] = [],
    engines: NullEngine[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    scenes.splice(0).forEach((s) => s.dispose());
    engines.splice(0).forEach((e) => e.dispose());
  });
  function setup() {
    const engine = new NullEngine(),
      scene = new Scene(engine),
      controller = new AbortController();
    engines.push(engine);
    scenes.push(scene);
    scene.useRightHandedSystem = true;
    // Establish the engine-shared BRDF before candidate ownership; never hide
    // arbitrary textures by taking a baseline after candidate allocation.
    const baseline = new PBRMaterial('pre-existing scene material', scene);
    expect(scene.textures).toHaveLength(1);
    const textures = [...scene.textures];
    const listeners = new Set<(receipt: PresentationReceipt) => void>();
    const gpu = {
      prepare: vi.fn(
        async (
          _label: string,
          _deadline: number,
          work: (signal: AbortSignal) => Promise<unknown>,
        ) => work(new AbortController().signal),
      ),
      subscribe: vi.fn((listener: (receipt: PresentationReceipt) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
    } as unknown as Parameters<typeof createBabylonGridPaint>[0]['gpu'];
    const options = {
      scene,
      track: new Track(),
      context,
      signal: controller.signal,
      gpu,
      deadline: performance.now() + 120000,
      isCurrent: () => true,
      schedule: new PresentationSchedule(),
    };
    const baselineCounts = () => {
      expect(scene.meshes).toHaveLength(0);
      expect(scene.geometries).toHaveLength(0);
      expect(scene.materials).toEqual([baseline]);
      expect(scene.textures).toEqual(textures);
    };
    let sequence = 0;
    const completed = (ready = true, owner: object = scene) => {
      for (const listener of listeners)
        listener({ kind: 'completed', owner, ready, sequence: ++sequence });
    };
    const event = (kind: 'lost' | 'disposed') => {
      for (const listener of listeners) listener({ kind });
    };
    return { options, scene, controller, listeners, completed, event, baselineCounts, textures };
  }
  const prepare = vi.fn(async () => {});

  it('matches every frozen original index, position, normal, UV, matrix and visible batch', async () => {
    const f = setup(),
      r = reference(f.options.track),
      owner = await createBabylonGridPaint(f.options, { prepare });
    const d = owner.diagnostics();
    expect(d.meshes.length).toBeGreaterThan(0);
    expect(d.meshes).toHaveLength(r.meshes.length);
    expect(d).toMatchObject({
      slots: 12,
      boxes: 36,
      triangles: 432,
      activeParts: 0,
      activeMaterials: 0,
      stagedParts: r.meshes.length,
      dryOnly: true,
      weatherParity: false,
      shadowParity: false,
      gpSwitchingParity: false,
    });
    expect(d.meshes.reduce((sum, m) => sum + m.getTotalIndices(), 0)).toBe(1296);
    for (let i = 0; i < r.meshes.length; i++) {
      const m = d.meshes[i],
        original = r.meshes[i];
      expect(Array.from(m.getIndices()!)).toEqual(Array.from(original.geometry.index!.array));
      for (const name of ['position', 'normal', 'uv'])
        expect(Array.from(m.getVerticesData(name)!)).toEqual(
          Array.from(original.geometry.getAttribute(name).array),
        );
      expect(Array.from(m.getWorldMatrix().m)).toEqual(
        Array.from(new Float32Array(original.matrixWorld.elements)),
      );
      expect(m.isVisible).toBe(original.visible);
      expect(m.sideOrientation).toBe(Material.CounterClockWiseSideOrientation);
      expect(m.material).toBe(d.material);
      expect(original.castShadow && original.receiveShadow).toBe(true);
    }
    expect(d.material.albedoColor.asArray()).toEqual(r.material.color.toArray());
    expect(d.material.roughness).toBe(0.55);
    expect(d.material.metallic).toBe(0);
    expect(d.material.backFaceCulling).toBe(true);
    expect(d.material.twoSidedLighting).toBe(false);
    expect(d.material.albedoTexture).toBeNull();
    expect(materialVariants({ meshes: d.meshes })).toHaveLength(d.meshes.length);
    expect(prepare).toHaveBeenLastCalledWith(
      { scene: f.scene, meshes: d.meshes },
      f.options.gpu,
      f.options.signal,
      f.options.deadline,
      expect.any(Function),
    );
    f.baselineCounts();
    owner.dispose();
    owner.dispose();
    f.baselineCounts();
    r.dispose();
  });
  it('retains original dry finish algebra, not decorated edge grounding or weather', async () => {
    const f = setup(),
      r = reference(f.options.track),
      owner = await createBabylonGridPaint(f.options, { prepare });
    const material = owner.diagnostics().material;
    const plugin = material.pluginManager!.getPlugin(
      'OriginalCircuitPaintFinish',
    ) as CircuitPaintFinishPlugin;
    expect(plugin).toBeInstanceOf(CircuitPaintFinishPlugin);
    const code = plugin.getCustomCode('fragment')!;
    expect(code.CUSTOM_FRAGMENT_UPDATE_ALBEDO).toContain('finishFilteredNoise(vPositionW.xz*24.0)');
    expect(code.CUSTOM_FRAGMENT_UPDATE_ALBEDO).toContain('.82+.16*grit+.05*wear');
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <project_vertex>',
      fragmentShader: '#include <common>\n#include <map_fragment>',
    };
    r.material.onBeforeCompile(
      shader as unknown as T.WebGLProgramParametersWithUniforms,
      {} as T.WebGLRenderer,
    );
    expect(shader.fragmentShader).toContain('.82+.16*grit+.05*wear');
    expect(shader.fragmentShader).toContain('finishFilteredNoise(vFinishWorld.xz*24.0)');
    expect(JSON.stringify(code)).not.toMatch(/grounding|aurelSurfaceWeather|lightPool/i);
    expect(material.pluginManager!.getPlugin('FormulaGrounding')).toBeNull();
    owner.dispose();
    r.dispose();
  });
  it('installs all batches synchronously, then requires two fresh ready receipts', async () => {
    const f = setup(),
      owner = await createBabylonGridPaint(f.options, { prepare });
    f.completed();
    f.completed();
    const installing = owner.install();
    expect(f.listeners.size).toBe(1);
    expect(owner.diagnostics().activeParts).toBe(owner.diagnostics().meshes.length);
    expect(owner.diagnostics().activeMaterials).toBe(1);
    expect(f.options.schedule.diagnostics().preparationCount).toBe(1);
    f.completed(true, {});
    f.completed();
    await Promise.resolve();
    expect(owner.diagnostics().state).toBe('installing');
    f.completed(false);
    f.completed();
    await Promise.resolve();
    expect(owner.diagnostics().state).toBe('installing');
    f.event('lost');
    f.completed();
    await Promise.resolve();
    expect(owner.diagnostics().state).toBe('installing');
    f.completed();
    await installing;
    expect(owner.diagnostics().state).toBe('ready');
    expect(f.listeners.size).toBe(0);
    expect(f.options.schedule.diagnostics().preparationCount).toBe(0);
    await expect(owner.install()).rejects.toThrow('cannot install twice');
    owner.dispose();
    f.baselineCounts();
  });
  it.each(['abort', 'dispose', 'scene', 'gpu'] as const)(
    'cleans installation on %s invalidation',
    async (kind) => {
      const f = setup(),
        owner = await createBabylonGridPaint(f.options, { prepare });
      const installing = owner.install(),
        rejected = expect(installing).rejects.toThrow();
      if (kind === 'abort') f.controller.abort();
      if (kind === 'dispose') owner.dispose();
      if (kind === 'scene') f.scene.dispose();
      if (kind === 'gpu') f.event('disposed');
      await rejected;
      owner.dispose();
      expect(f.listeners.size).toBe(0);
      expect(owner.diagnostics().state).toBe('disposed');
      expect(f.options.schedule.diagnostics().preparationCount).toBe(0);
      if (kind !== 'scene') f.baselineCounts();
    },
  );
  it('rejects stale generation after real receipts and removes every installed resource', async () => {
    const f = setup(),
      owner = await createBabylonGridPaint(f.options, { prepare });
    const installing = owner.install(),
      rejected = expect(installing).rejects.toThrow();
    f.options.isCurrent = () => false;
    f.completed();
    f.completed();
    await rejected;
    f.baselineCounts();
    expect(f.listeners.size).toBe(0);
  });
  it('does not dispose outstanding compiler work on user cancellation', async () => {
    const f = setup(),
      gate = deferred();
    let parts: Mesh[] = [];
    const creation = createBabylonGridPaint(f.options, {
      prepare: async (container) => {
        parts = container.meshes as Mesh[];
        await gate.promise;
      },
    });
    const rejected = expect(creation).rejects.toThrow();
    await vi.waitFor(() => expect(parts.length).toBeGreaterThan(0));
    f.controller.abort();
    expect(parts.every((mesh) => !mesh.isDisposed())).toBe(true);
    gate.resolve();
    await rejected;
    expect(parts.every((mesh) => mesh.isDisposed())).toBe(true);
    f.baselineCounts();
  });
  it.each([null, false, 0, 'compile failed'])(
    'preserves primary compiler rejection %s and releases staged objects',
    async (error) => {
      const f = setup();
      await expect(
        createBabylonGridPaint(f.options, {
          prepare: async () => {
            throw error;
          },
        }),
      ).rejects.toBe(error);
      f.baselineCounts();
    },
  );
  it('rolls back partial geometry allocation', async () => {
    const f = setup(),
      original = VertexData.prototype.applyToMesh;
    vi.spyOn(VertexData.prototype, 'applyToMesh').mockImplementation(function (
      this: VertexData,
      ...args
    ) {
      original.apply(this, args);
      throw new Error('partial upload');
    });
    await expect(createBabylonGridPaint(f.options, { prepare })).rejects.toThrow('partial upload');
    f.baselineCounts();
  });
  it('rolls back partial scene registration', async () => {
    const f = setup(),
      owner = await createBabylonGridPaint(f.options, { prepare }),
      add = f.scene.addMesh.bind(f.scene);
    vi.spyOn(f.scene, 'addMesh').mockImplementation((mesh, recursive) => {
      add(mesh, recursive);
      throw new Error('partial install');
    });
    await expect(owner.install()).rejects.toThrow('partial install');
    f.baselineCounts();
    expect(f.listeners.size).toBe(0);
    expect(f.options.schedule.diagnostics().preparationCount).toBe(0);
  });
  it('retains shared BRDF identity and releases it on final scene disposal', async () => {
    const f = setup(),
      shared = f.textures[0],
      dispose = vi.spyOn(shared, 'dispose');
    const owner = await createBabylonGridPaint(f.options, { prepare });
    owner.dispose();
    owner.dispose();
    expect(dispose).not.toHaveBeenCalled();
    f.baselineCounts();
    f.scene.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
  it.each([
    'abort',
    'generation',
    'scene',
    'left-hand',
    'deadline',
    'nan-deadline',
    'venue',
    'context',
  ] as const)('rejects %s before GPU allocation', async (kind) => {
    const f = setup();
    if (kind === 'abort') f.controller.abort();
    if (kind === 'generation') f.options.isCurrent = () => false;
    if (kind === 'scene') f.scene.dispose();
    if (kind === 'left-hand') f.scene.useRightHandedSystem = false;
    if (kind === 'deadline') f.options.deadline = 0;
    if (kind === 'nan-deadline') f.options.deadline = NaN;
    if (kind === 'venue') f.options.track = new Track('clear', false, undefined, VELLAMAR);
    if (kind === 'context')
      f.options.context = { ...context, vehicles: [] } as unknown as typeof context;
    await expect(createBabylonGridPaint(f.options, { prepare })).rejects.toThrow();
    expect(f.options.gpu.prepare).not.toHaveBeenCalled();
    if (kind !== 'scene') f.baselineCounts();
  });
  it('compiles every actual batch under a separate sequential GPU preparation lease', async () => {
    const f = setup(),
      jobs: Mesh[] = [];
    const owner = await createBabylonGridPaint(f.options, {
      prepare: (container, gpu, signal, deadline, progress) =>
        prepareOriginalMaterials(
          container,
          gpu,
          signal,
          deadline,
          progress,
          async (job, invalidated) => {
            invalidated.throwIfAborted();
            expect(f.scene.meshes).not.toContain(job.mesh);
            expect(f.scene.materials).not.toContain(job.material);
            jobs.push(job.mesh as Mesh);
          },
          async () => {},
        ),
    });
    expect(jobs).toEqual(owner.diagnostics().meshes);
    expect(f.options.gpu.prepare).toHaveBeenCalledTimes(jobs.length + 1);
    owner.dispose();
    f.baselineCounts();
  });
  it('rejects GPU invalidation before upload and does not allocate', async () => {
    const f = setup(),
      invalidated = new AbortController();
    invalidated.abort(new Error('context invalidated'));
    vi.mocked(f.options.gpu.prepare).mockImplementation(async (_label, _deadline, work) => {
      await work(invalidated.signal);
    });
    await expect(createBabylonGridPaint(f.options, { prepare })).rejects.toThrow(
      'context invalidated',
    );
    f.baselineCounts();
  });
  it('rejects a changed context between preparation and install', async () => {
    const f = setup(),
      owner = await createBabylonGridPaint(f.options, { prepare });
    f.options.isCurrent = () => false;
    await expect(owner.install()).rejects.toThrow('ownership changed');
    f.baselineCounts();
    expect(f.listeners.size).toBe(0);
  });
  it('drains cleanup independently and retains a falsy primary if cleanup and reporter throw', async () => {
    const f = setup();
    let geometryDisposals = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('reporter failed');
    });
    await expect(
      createBabylonGridPaint(f.options, {
        prepare: async (container) => {
          for (const mesh of container.meshes as Mesh[]) {
            const geometry = mesh.geometry!;
            const dispose = geometry.dispose.bind(geometry);
            vi.spyOn(geometry, 'dispose').mockImplementation(() => {
              geometryDisposals++;
              dispose();
            });
          }
          const material = container.meshes[0].material as PBRMaterial;
          const dispose = material.dispose.bind(material);
          vi.spyOn(material, 'dispose').mockImplementation(() => {
            dispose();
            throw new Error('cleanup failed');
          });
          throw false;
        },
      }),
    ).rejects.toBe(false);
    expect(geometryDisposals).toBeGreaterThan(0);
    f.baselineCounts();
  });
  it.each([null, false, undefined, 0, new Error('registered constructor failed')])(
    'cleans material constructor registration failure %s without a derived disposer',
    async (failure) => {
      const f = setup(),
        engine = f.scene.getEngine();
      const buffers = [...engine._uniformBuffers],
        textures = [...engine.getLoadedTexturesCache()];
      const add = f.scene.addMaterial.bind(f.scene);
      let captured: Material | undefined, release: ReturnType<typeof vi.spyOn> | undefined;
      const method = vi.spyOn(f.scene, 'addMaterial').mockImplementation((value) => {
        captured = value;
        const partial = value as unknown as {
          _uniformBuffer: { dispose(): void };
          _drawWrapper: { effect: unknown; drawContext: unknown };
          _renderTargets?: unknown;
        };
        expect(partial._renderTargets).toBeUndefined();
        expect(partial._drawWrapper.effect).toBeNull();
        expect(partial._drawWrapper.drawContext).toBeUndefined();
        release = vi.spyOn(partial._uniformBuffer, 'dispose');
        add(value);
        throw failure;
      });
      const descriptor = Object.getOwnPropertyDescriptor(f.scene, 'addMaterial');
      await expect(createBabylonGridPaint(f.options, { prepare })).rejects.toBe(failure);
      expect(captured).toBeInstanceOf(PBRMaterial);
      expect(release).toHaveBeenCalledTimes(1);
      expect(Object.getOwnPropertyDescriptor(f.scene, 'addMaterial')).toEqual(descriptor);
      expect(f.scene.rootNodes).toEqual([]);
      expect(engine._uniformBuffers).toEqual(buffers);
      expect(engine.getLoadedTexturesCache()).toEqual(textures);
      f.baselineCounts();
      method.mockRestore();
      expect(() => f.scene.dispose()).not.toThrow();
    },
  );
  it.each([null, false, undefined, 0, new Error('registered constructor failed')])(
    'cleans mesh constructor registration failure %s without a derived disposer',
    async (failure) => {
      const f = setup(),
        engine = f.scene.getEngine();
      const buffers = [...engine._uniformBuffers],
        textures = [...engine.getLoadedTexturesCache()];
      const add = f.scene.addMesh.bind(f.scene);
      let captured: Mesh | undefined;
      const method = vi.spyOn(f.scene, 'addMesh').mockImplementation((value, recursive) => {
        captured = value as Mesh;
        expect((value as unknown as { _uniformBuffer?: unknown })._uniformBuffer).toBeUndefined();
        expect(
          (value as unknown as { _onBeforeDrawObservable?: unknown })._onBeforeDrawObservable,
        ).toBeUndefined();
        add(value, recursive);
        throw failure;
      });
      const descriptor = Object.getOwnPropertyDescriptor(f.scene, 'addMesh');
      await expect(createBabylonGridPaint(f.options, { prepare })).rejects.toBe(failure);
      expect(captured).toBeInstanceOf(Mesh);
      expect(captured!.isDisposed()).toBe(true);
      expect(Object.getOwnPropertyDescriptor(f.scene, 'addMesh')).toEqual(descriptor);
      expect(f.scene.rootNodes).toEqual([]);
      expect(f.scene.transformNodes).toEqual([]);
      expect(engine._uniformBuffers).toEqual(buffers);
      expect(engine.getLoadedTexturesCache()).toEqual(textures);
      f.baselineCounts();
      method.mockRestore();
      expect(() => f.scene.dispose()).not.toThrow();
    },
  );
  it('constructor registration cleanup preserves nested unrelated owners and restores method identity', async () => {
    const f = setup(),
      addMaterial = f.scene.addMaterial.bind(f.scene),
      addMesh = f.scene.addMesh.bind(f.scene);
    let unrelatedMaterial: PBRMaterial | undefined, unrelatedMesh: Mesh | undefined;
    const materialMethod = vi.spyOn(f.scene, 'addMaterial').mockImplementation((value) => {
      addMaterial(value);
      if (value.name.startsWith('Original Aurel Formula grid paint')) {
        unrelatedMaterial = new PBRMaterial('unrelated callback material', f.scene);
        throw false;
      }
    });
    const materialDescriptor = Object.getOwnPropertyDescriptor(f.scene, 'addMaterial');
    await expect(createBabylonGridPaint(f.options, { prepare })).rejects.toBe(false);
    expect(Object.getOwnPropertyDescriptor(f.scene, 'addMaterial')).toEqual(materialDescriptor);
    expect(f.scene.materials).toHaveLength(2);
    expect(f.scene.materials).toContain(unrelatedMaterial);
    materialMethod.mockRestore();
    const meshMethod = vi.spyOn(f.scene, 'addMesh').mockImplementation((value, recursive) => {
      addMesh(value, recursive);
      if (value.name.startsWith('Original Aurel Formula grid paint')) {
        unrelatedMesh = new Mesh('unrelated callback mesh', f.scene);
        throw null;
      }
    });
    const meshDescriptor = Object.getOwnPropertyDescriptor(f.scene, 'addMesh');
    await expect(createBabylonGridPaint(f.options, { prepare })).rejects.toBe(null);
    expect(Object.getOwnPropertyDescriptor(f.scene, 'addMesh')).toEqual(meshDescriptor);
    expect(f.scene.meshes).toEqual([unrelatedMesh]);
    expect(f.scene.rootNodes).toEqual([unrelatedMesh]);
    expect(unrelatedMesh!.isDisposed()).toBe(false);
    expect(f.scene.materials).toHaveLength(2);
    expect(f.scene.materials).toContain(unrelatedMaterial);
    meshMethod.mockRestore();
    unrelatedMesh!.dispose();
    unrelatedMaterial!.dispose();
    f.baselineCounts();
    expect(() => f.scene.dispose()).not.toThrow();
  });
  it('constructor registration interception restores inherited descriptor absence on success', async () => {
    const f = setup();
    expect(Object.getOwnPropertyDescriptor(f.scene, 'addMaterial')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(f.scene, 'addMesh')).toBeUndefined();
    const owner = await createBabylonGridPaint(f.options, { prepare });
    expect(Object.getOwnPropertyDescriptor(f.scene, 'addMaterial')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(f.scene, 'addMesh')).toBeUndefined();
    owner.dispose();
    f.baselineCounts();
  });
  it('constructor registration interception restores exact non-default own descriptors', async () => {
    const f = setup();
    for (const name of ['addMaterial', 'addMesh'] as const)
      Object.defineProperty(f.scene, name, {
        value: f.scene[name],
        configurable: true,
        enumerable: true,
        writable: false,
      });
    const materialDescriptor = Object.getOwnPropertyDescriptor(f.scene, 'addMaterial');
    const meshDescriptor = Object.getOwnPropertyDescriptor(f.scene, 'addMesh');
    const owner = await createBabylonGridPaint(f.options, { prepare });
    expect(Object.getOwnPropertyDescriptor(f.scene, 'addMaterial')).toEqual(materialDescriptor);
    expect(Object.getOwnPropertyDescriptor(f.scene, 'addMesh')).toEqual(meshDescriptor);
    owner.dispose();
    f.baselineCounts();
  });
  it.each([null, false, undefined, 0, new Error('Created hook failed')])(
    'cleans the pinned Material Created-hook failure %s before PBRBase fields',
    async (failure) => {
      const f = setup(),
        engine = f.scene.getEngine();
      const buffers = [...engine._uniformBuffers],
        textures = [...engine.getLoadedTexturesCache()];
      const materialDescriptor = Object.getOwnPropertyDescriptor(f.scene, 'addMaterial');
      const meshDescriptor = Object.getOwnPropertyDescriptor(f.scene, 'addMesh');
      let captured: Material | undefined,
        unrelated: PBRMaterial | undefined,
        releases = 0;
      const observer = Material.OnEventObservable.add((value) => {
        if (!value.name.startsWith('Original Aurel Formula grid paint')) return;
        captured = value;
        expect(f.scene.materials).toContain(value);
        expect(Object.hasOwn(value, '_directIntensity')).toBe(false);
        const partial = value as unknown as {
          _uniformBuffer: { dispose(): void };
          _renderTargets?: unknown;
        };
        expect(partial._renderTargets).toBeUndefined();
        const release = partial._uniformBuffer.dispose.bind(partial._uniformBuffer);
        vi.spyOn(partial._uniformBuffer, 'dispose').mockImplementation(() => {
          releases++;
          release();
        });
        unrelated = new PBRMaterial('unrelated Created-hook owner', f.scene);
        expect(Object.hasOwn(unrelated, '_directIntensity')).toBe(true);
        throw failure;
      }, 1);
      try {
        await expect(createBabylonGridPaint(f.options, { prepare })).rejects.toBe(failure);
        expect(captured).toBeInstanceOf(PBRMaterial);
        expect(releases).toBe(1);
        expect(f.scene.materials).toHaveLength(2);
        expect(f.scene.materials).toContain(unrelated);
        expect(f.scene.materials).not.toContain(captured);
        expect(Object.getOwnPropertyDescriptor(f.scene, 'addMaterial')).toEqual(materialDescriptor);
        expect(Object.getOwnPropertyDescriptor(f.scene, 'addMesh')).toEqual(meshDescriptor);
        expect(f.scene.meshes).toEqual([]);
        expect(f.scene.rootNodes).toEqual([]);
        expect(f.scene.geometries).toEqual([]);
        expect(f.scene.textures).toEqual(f.textures);
        unrelated!.dispose();
        expect(engine._uniformBuffers).toEqual(buffers);
        expect(engine.getLoadedTexturesCache()).toEqual(textures);
        f.baselineCounts();
        expect(() => f.scene.dispose()).not.toThrow();
      } finally {
        Material.OnEventObservable.remove(observer);
      }
    },
  );
  it('rejects contexts outside exact canonical Aurel Formula', () => {
    expect(gridPaintEligible(new Track(), context)).toBe(true);
    expect(gridPaintEligible(new Track())).toBe(false);
    expect(
      gridPaintEligible(new Track(), {
        ...context,
        vehicles: [{ classId: 'gp-bike', dynamicsKind: 'bike' }],
      }),
    ).toBe(false);
  });
});
