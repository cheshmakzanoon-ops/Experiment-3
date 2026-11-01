import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import { Scene } from '@babylonjs/core/scene.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Track, trackPoint } from '../src/simulation/track.ts';
import { AUREL, VELLAMAR } from '../src/simulation/circuits.ts';
import { BroadcastSightlines } from '../src/rendering/broadcast-sightlines.ts';
import { decodeStartGantry } from '../src/rendering/start-gantry.ts';
import manifest from '../src/rendering/start-gantry.manifest.json' with { type: 'json' };
import {
  validateStartGantryBytes,
  startGantryEligible,
  loadBabylonStartGantry,
} from '../src/engine/babylon/start-gantry.ts';

const bytes = () => new Uint8Array(readFileSync('public/models/aurel-start-gantry.glb'));
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
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
/** Independent unchanged production Three construction is the oracle. Texture
 * placeholders avoid decoding pixels: these tests make NO image/GPU claim. */
async function original(track: Track) {
  const loader = new GLTFLoader().register(() => ({
    name: 'CPU_geometry_only',
    loadTexture: () =>
      Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
  }));
  const kit = await decodeStartGantry(bytes(), loader);
  const root = new T.Group(),
    p = track.at(0, trackPoint());
  root.position.set(p.x, p.y, p.z);
  root.rotation.y = Math.atan2(p.tx, p.tz);
  kit.build(track, root, new BroadcastSightlines());
  root.updateMatrixWorld(true);
  return { kit, root };
}

describe('A07 original structure adapter (NullEngine CPU contracts; not GPU/image parity)', () => {
  const engines: NullEngine[] = [],
    scenes: Scene[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    scenes.splice(0).forEach((s) => {
      if (!s.isDisposed) s.dispose();
    });
    engines.splice(0).forEach((e) => e.dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  function setup() {
    const engine = new NullEngine(),
      scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    engines.push(engine);
    scenes.push(scene);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes())),
    );
    return scene;
  }
  function options(scene = setup(), controller = new AbortController()) {
    return {
      scene,
      track: new Track(),
      context,
      base: 'https://example.invalid/',
      signal: controller.signal,
      gpu: {
        prepare: async (
          _label: string,
          _deadline: number,
          work: (invalidated: AbortSignal) => Promise<unknown>,
        ) => work(new AbortController().signal),
      } as Parameters<typeof loadBabylonStartGantry>[0]['gpu'],
      deadline: performance.now() + 120000,
      isCurrent: () => true,
      schedule: new PresentationSchedule(),
    };
  }
  const prepared = { prepare: vi.fn(async () => {}), present: vi.fn(async () => {}) };
  it('pins pre-edit original construction and authored exchange independently of adapter output', () => {
    expect(hash(readFileSync('src/rendering/start-gantry.ts'))).toBe(
      '568eadac51aeedb0db493a65a718cfcdc4b5816ac4cfb1b956f46b5fb6035120',
    );
    expect(hash(readFileSync('src/rendering/start-gantry.manifest.json'))).toBe(
      'd6049df2090d93405c3f796514e752aa9f4ddec215c66459c86fb97df116c48d',
    );
    expect(hash(bytes())).toBe(manifest.sha256);
  });
  it('rejects truncated, changed and malformed exchange before native decode', async () => {
    const signal = new AbortController().signal;
    await expect(validateStartGantryBytes(bytes(), signal)).resolves.toBeUndefined();
    await expect(validateStartGantryBytes(bytes().slice(0, -1), signal)).rejects.toThrow();
    const corrupt = bytes();
    corrupt[corrupt.length - 1] ^= 1;
    await expect(validateStartGantryBytes(corrupt, signal)).rejects.toThrow();
    const header = bytes();
    header[0] = 0;
    await expect(validateStartGantryBytes(header, signal)).rejects.toThrow();
  });
  it('does not broaden Aurel Formula eligibility to Vellamar, cloned content or other presentations', () => {
    expect(startGantryEligible(new Track(), context)).toBe(true);
    expect(startGantryEligible(new Track('clear', false, undefined, VELLAMAR), context)).toBe(
      false,
    );
    expect(startGantryEligible(new Track('clear', false, undefined, { ...AUREL }), context)).toBe(
      false,
    );
    expect(startGantryEligible(new Track(), { ...context, presentation: 'offroad' })).toBe(false);
    expect(startGantryEligible(new Track(), { ...context, vehicles: [] })).toBe(false);
    expect(
      startGantryEligible(new Track(), {
        ...context,
        vehicles: [{ classId: 'gp-bike', dynamicsKind: 'bike' }],
      }),
    ).toBe(false);
    expect(startGantryEligible(new Track())).toBe(false);
  });
  it('rejects cancellation before validation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(validateStartGantryBytes(bytes(), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('preserves exact original conformed buffers, world placement and native material bindings', async () => {
    const opts = options(),
      oracle = await original(opts.track);
    const owner = await loadBabylonStartGantry(opts, prepared);
    try {
      const d = owner.diagnostics();
      expect(d.parts).toHaveLength(4);
      for (const { name, mesh, material } of d.parts) {
        const reference = oracle.kit.chunks[0].levels[0].getObjectByName(name) as T.Mesh;
        expect(reference).toBeDefined();
        expect(Array.from(mesh.getVerticesData('position')!)).toEqual(
          Array.from(reference.geometry.getAttribute('position').array),
        );
        expect(Array.from(mesh.getVerticesData('normal')!)).toEqual(
          Array.from(reference.geometry.getAttribute('normal').array),
        );
        expect(Array.from(mesh.getVerticesData('uv')!)).toEqual(
          Array.from(reference.geometry.getAttribute('uv').array),
        );
        expect(Array.from(mesh.getIndices()!)).toEqual(Array.from(reference.geometry.index!.array));
        const position = reference.geometry.getAttribute('position');
        const matrix = mesh.computeWorldMatrix(true);
        expect(Array.from(matrix.asArray())).toEqual(
          Array.from(new Float32Array(reference.matrixWorld.elements)),
        );
        expect(mesh.parent!.getClassName()).toBe('TransformNode');
        const placement =
          mesh.parent as import('@babylonjs/core/Meshes/transformNode.js').TransformNode;
        expect(placement.position.asArray()).toEqual(oracle.root.position.toArray());
        expect(placement.rotation.y).toBe(oracle.root.rotation.y);
        for (let i = 0; i < position.count; i++) {
          const a = new T.Vector3()
            .fromBufferAttribute(position, i)
            .applyMatrix4(reference.matrixWorld);
          const b = Vector3.TransformCoordinates(
            new Vector3(position.getX(i), position.getY(i), position.getZ(i)),
            matrix,
          );
          expect(b.x).toBeCloseTo(a.x, 4);
          expect(b.y).toBeCloseTo(a.y, 4);
          expect(b.z).toBeCloseTo(a.z, 4);
        }
        expect(material).toBeInstanceOf(PBRMaterial);
        const pbr = material as PBRMaterial;
        expect(pbr.albedoTexture).toBeTruthy();
        expect(pbr.bumpTexture).toBeTruthy();
        expect(pbr.metallicTexture).toBeTruthy();
        expect(pbr.bumpTexture!.level).toBeCloseTo(0.3499999940395355, 12);
        expect(pbr.ambientTexture).toBeNull();
        expect(pbr.backFaceCulling).toBe(false);
        expect(opts.scene.meshes).not.toContain(mesh);
      }
      expect(new Set(d.parts.map((p) => p.material)).size).toBe(1);
      await owner.install();
      expect(
        d.parts.every(({ mesh }) => opts.scene.meshes.includes(mesh) && mesh.isEnabled()),
      ).toBe(true);
      expect(
        opts.scene.meshes.filter((m) => m.getTotalVertices() > 0 && m.isEnabled()),
      ).toHaveLength(4);
      await expect(owner.install()).rejects.toThrow();
      owner.dispose();
      owner.dispose();
      expect(d.parts.every(({ mesh }) => mesh.isDisposed())).toBe(true);
    } finally {
      owner.dispose();
      oracle.kit.dispose();
    }
  });
  it('does not fetch or decode an already cancelled owner', async () => {
    const controller = new AbortController(),
      opts = options(setup(), controller);
    const fetcher = vi.fn(),
      decode = vi.fn();
    controller.abort();
    await expect(
      loadBabylonStartGantry(opts, { ...prepared, fetcher, decode }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
  });
  it('rejects invalid scene, wrong track and stale owner without importing', async () => {
    const opts = options();
    opts.scene.useRightHandedSystem = false;
    await expect(loadBabylonStartGantry(opts, prepared)).rejects.toThrow();
    opts.scene.useRightHandedSystem = true;
    await expect(
      loadBabylonStartGantry(
        { ...opts, track: new Track('clear', false, undefined, VELLAMAR) },
        prepared,
      ),
    ).rejects.toThrow();
    await expect(
      loadBabylonStartGantry({ ...opts, isCurrent: () => false }, prepared),
    ).rejects.toThrow();
    opts.scene.dispose();
    await expect(loadBabylonStartGantry(opts, prepared)).rejects.toThrow();
  });
  it('cancels after native decode without publishing or leaking the container', async () => {
    const controller = new AbortController(),
      opts = options(setup(), controller);
    let captured: AssetContainer | undefined;
    let capturedMeshes: AbstractMesh[] = [];
    await expect(
      loadBabylonStartGantry(opts, {
        ...prepared,
        decode: async (raw, scene) => {
          captured = await LoadAssetContainerAsync(raw, scene, { pluginExtension: '.glb' });
          capturedMeshes = [...captured.meshes];
          controller.abort();
          return captured;
        },
      }),
    ).rejects.toThrow();
    expect(captured).toBeDefined();
    expect(capturedMeshes.length).toBeGreaterThan(0);
    expect(capturedMeshes.every((m) => m.isDisposed())).toBe(true);
    expect(opts.scene.meshes).toHaveLength(0);
  });
  it('retains an active prepare until it drains even if its owner cancels', async () => {
    const controller = new AbortController(),
      opts = options(setup(), controller),
      entered = deferred(),
      drain = deferred();
    let captured: AssetContainer | undefined,
      disposed = false;
    let capturedMeshes: AbstractMesh[] = [];
    const pending = loadBabylonStartGantry(opts, {
      ...prepared,
      decode: async (raw, scene) => {
        captured = await LoadAssetContainerAsync(raw, scene, { pluginExtension: '.glb' });
        capturedMeshes = [...captured.meshes];
        const release = captured.dispose.bind(captured);
        vi.spyOn(captured, 'dispose').mockImplementation(() => {
          disposed = true;
          release();
        });
        return captured;
      },
      prepare: async () => {
        entered.resolve();
        await drain.promise;
      },
    });
    const failed = expect(pending).rejects.toThrow();
    await entered.promise;
    controller.abort();
    await Promise.resolve();
    expect(disposed).toBe(false);
    expect(opts.scene.meshes).toHaveLength(0);
    drain.resolve();
    await failed;
    expect(disposed).toBe(true);
    expect(capturedMeshes.length).toBeGreaterThan(0);
    expect(capturedMeshes.every((m) => m.isDisposed())).toBe(true);
  });
  it('rechecks cancellation and staleness before installation and drains ownership on disposal', async () => {
    const controller = new AbortController(),
      opts = options(setup(), controller);
    let current = true;
    const owner = await loadBabylonStartGantry({ ...opts, isCurrent: () => current }, prepared);
    const parts = owner.diagnostics().parts;
    current = false;
    await expect(owner.install()).rejects.toThrow();
    expect(parts.every(({ mesh }) => !opts.scene.meshes.includes(mesh))).toBe(true);
    expect(parts.every(({ mesh }) => mesh.isDisposed())).toBe(true);
    owner.dispose();
    expect(parts.every(({ mesh }) => mesh.isDisposed())).toBe(true);
    const cancelled = await loadBabylonStartGantry(opts, prepared);
    const cancelledMeshes = cancelled.diagnostics().parts.map((p) => p.mesh);
    controller.abort();
    await expect(cancelled.install()).rejects.toThrow();
    expect(cancelledMeshes.every((mesh) => mesh.isDisposed())).toBe(true);
    cancelled.dispose();
  });
  it('preserves compiler failure and releases the uninstalled resource owner', async () => {
    const opts = options(),
      failure = new Error('retained original compiler failure');
    let captured: AssetContainer | undefined;
    let capturedMeshes: AbstractMesh[] = [];
    await expect(
      loadBabylonStartGantry(opts, {
        ...prepared,
        decode: async (raw, scene) => {
          captured = await LoadAssetContainerAsync(raw, scene, { pluginExtension: '.glb' });
          capturedMeshes = [...captured.meshes];
          return captured;
        },
        prepare: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(capturedMeshes.length).toBeGreaterThan(0);
    expect(capturedMeshes.every((m) => m.isDisposed())).toBe(true);
    expect(opts.scene.meshes).toHaveLength(0);
  });

  it('rejects duplicate in-flight install and does not report ready before presentation', async () => {
    const opts = options(),
      entered = deferred(),
      drain = deferred();
    const owner = await loadBabylonStartGantry(opts, {
      ...prepared,
      present: async () => {
        entered.resolve();
        await drain.promise;
      },
    });
    const installation = owner.install();
    await entered.promise;
    expect(owner.diagnostics().state).toBe('installing');
    await expect(owner.install()).rejects.toThrow();
    expect(owner.diagnostics().state).toBe('installing');
    drain.resolve();
    await installation;
    expect(owner.diagnostics().state).toBe('ready');
    owner.dispose();
  });
  it('does not become ready after disposal during presentation and clears preparation demand', async () => {
    const opts = options(),
      entered = deferred(),
      drain = deferred();
    const owner = await loadBabylonStartGantry(opts, {
      ...prepared,
      present: async () => {
        entered.resolve();
        await drain.promise;
      },
    });
    const meshes = owner.diagnostics().parts.map((p) => p.mesh);
    const installation = owner.install(),
      failed = expect(installation).rejects.toThrow();
    await entered.promise;
    owner.dispose();
    drain.resolve();
    await failed;
    expect(owner.diagnostics().state).toBe('disposed');
    expect(meshes.every((m) => m.isDisposed())).toBe(true);
    opts.schedule.shouldRender(true);
    expect(opts.schedule.pending).toBe(false);
  });
  it('rejects scene disposal before install without duplicate resource ownership', async () => {
    const opts = options();
    let resources: AssetContainer | undefined;
    const owner = await loadBabylonStartGantry(opts, {
      ...prepared,
      decode: async (raw, scene) => {
        resources = await LoadAssetContainerAsync(raw, scene, { pluginExtension: '.glb' });
        return resources;
      },
    });
    const meshes = [...resources!.meshes],
      materials = [...resources!.materials],
      textures = [...resources!.textures];
    const disposed = [...meshes, ...materials, ...textures].map((resource) =>
      vi.spyOn(resource, 'dispose'),
    );
    opts.scene.dispose();
    // Native container traversal may call a descendant mesh's idempotent
    // disposer more than once; the adapter must never add another disposal.
    const sceneDisposalCalls = disposed.map((spy) => spy.mock.calls.length);
    expect(sceneDisposalCalls.every((count) => count >= 1)).toBe(true);
    expect(sceneDisposalCalls.slice(meshes.length).every((count) => count === 1)).toBe(true);
    await expect(owner.install()).rejects.toThrow();
    owner.dispose();
    owner.dispose();
    expect(meshes.every((m) => m.isDisposed())).toBe(true);
    expect(disposed.map((spy) => spy.mock.calls.length)).toEqual(sceneDisposalCalls);
  });
  it('retains construction errors even if native container cleanup throws', async () => {
    const opts = options();
    let capturedMeshes: AbstractMesh[] = [];
    const textureDisposals: ReturnType<typeof vi.spyOn>[] = [];
    const cleanupFailure = new Error('cleanup sentinel'),
      log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      loadBabylonStartGantry(opts, {
        ...prepared,
        decode: async (raw, scene) => {
          const container = await LoadAssetContainerAsync(raw, scene, { pluginExtension: '.glb' });
          container.meshes.find((m) => m.name === 'A07_PORTAL_LOD0_COLUMN_LEFT')!.name =
            'wrong binding';
          capturedMeshes = [...container.meshes];
          textureDisposals.push(
            ...container.textures.map((texture) => vi.spyOn(texture, 'dispose')),
          );
          vi.spyOn(container, 'dispose').mockImplementation(() => {
            throw cleanupFailure;
          });
          return container;
        },
      }),
    ).rejects.toThrow('binding');
    expect(log).toHaveBeenCalledWith('A07 cleanup failed', cleanupFailure);
    expect(capturedMeshes.length).toBeGreaterThan(0);
    expect(capturedMeshes.every((mesh) => mesh.isDisposed())).toBe(true);
    expect(textureDisposals).toHaveLength(3);
    expect(textureDisposals.every((spy) => spy.mock.calls.length > 0)).toBe(true);
  });
  it('rejects decoder scene mismatch without publishing into either scene', async () => {
    const opts = options(),
      other = setup();
    let meshes: import('@babylonjs/core/Meshes/abstractMesh.js').AbstractMesh[] = [];
    await expect(
      loadBabylonStartGantry(opts, {
        ...prepared,
        decode: async (raw) => {
          const container = await LoadAssetContainerAsync(raw, other, { pluginExtension: '.glb' });
          meshes = [...container.meshes];
          return container;
        },
      }),
    ).rejects.toThrow('different scene');
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.every((m) => m.isDisposed())).toBe(true);
    expect(opts.scene.meshes).toHaveLength(0);
    expect(other.meshes).toHaveLength(0);
  });
  it('bounds download bytes and preserves network errors without invoking decoder', async () => {
    const opts = options(),
      decode = vi.fn();
    await expect(
      loadBabylonStartGantry(opts, {
        ...prepared,
        decode,
        fetcher: async () => new Response(new Uint8Array(manifest.bytes + 1)),
      }),
    ).rejects.toThrow('byte budget');
    await expect(
      loadBabylonStartGantry(opts, {
        ...prepared,
        decode,
        fetcher: async () => new Response(bytes().slice(0, -1)),
      }),
    ).rejects.toThrow('Truncated');
    await expect(
      loadBabylonStartGantry(opts, {
        ...prepared,
        decode,
        fetcher: async () => new Response('', { status: 503 }),
      }),
    ).rejects.toThrow('503');
    expect(decode).not.toHaveBeenCalled();
  });

  it('drains off-scene resources when scene disposal skips later observers', async () => {
    const opts = options();
    opts.scene.onDisposeObservable.add((_scene, event) => {
      event.skipNextObservers = true;
    });
    let captured: AssetContainer | undefined;
    const owner = await loadBabylonStartGantry(opts, {
      ...prepared,
      decode: async (raw, scene) => {
        captured = await LoadAssetContainerAsync(raw, scene, { pluginExtension: '.glb' });
        return captured;
      },
    });
    const meshes = [...captured!.meshes],
      textures = [...captured!.textures];
    const textureSpies = textures.map((texture) => vi.spyOn(texture, 'dispose'));
    opts.scene.dispose();
    expect(opts.scene.isDisposed).toBe(true);
    expect(meshes.some((mesh) => !mesh.isDisposed())).toBe(true);
    owner.dispose();
    expect(meshes.every((mesh) => mesh.isDisposed())).toBe(true);
    expect(textureSpies.every((spy) => spy.mock.calls.length > 0)).toBe(true);
  });
  it.each([undefined, null])(
    'preserves falsy container disposal failure %s while draining independent resources',
    async (failure) => {
      const opts = options();
      let captured: AssetContainer | undefined;
      const owner = await loadBabylonStartGantry(opts, {
        ...prepared,
        decode: async (raw, scene) => {
          captured = await LoadAssetContainerAsync(raw, scene, { pluginExtension: '.glb' });
          return captured;
        },
      });
      const meshes = [...captured!.meshes],
        textures = [...captured!.textures],
        materials = [...captured!.materials];
      const textureSpies = textures.map((texture) => vi.spyOn(texture, 'dispose'));
      const materialSpies = materials.map((material) => vi.spyOn(material, 'dispose'));
      vi.spyOn(captured!, 'dispose').mockImplementation(() => {
        throw failure;
      });
      let didThrow = false,
        caught: unknown = Symbol('not thrown');
      try {
        owner.dispose();
      } catch (error) {
        didThrow = true;
        caught = error;
      }
      expect(didThrow).toBe(true);
      expect(caught).toBe(failure);
      expect(meshes.every((mesh) => mesh.isDisposed())).toBe(true);
      expect(textureSpies.every((spy) => spy.mock.calls.length > 0)).toBe(true);
      expect(materialSpies.every((spy) => spy.mock.calls.length > 0)).toBe(true);
      owner.dispose();
    },
  );
  it.each([undefined, null])(
    'drains independent resources after an individual resource throws %s',
    async (failure) => {
      const opts = options();
      let captured: AssetContainer | undefined;
      const owner = await loadBabylonStartGantry(opts, {
        ...prepared,
        decode: async (raw, scene) => {
          captured = await LoadAssetContainerAsync(raw, scene, { pluginExtension: '.glb' });
          return captured;
        },
      });
      const textures = [...captured!.textures],
        materials = [...captured!.materials];
      const materialSpies = materials.map((material) => vi.spyOn(material, 'dispose'));
      const otherTextures = textures.slice(1).map((texture) => vi.spyOn(texture, 'dispose'));
      vi.spyOn(textures[0], 'dispose').mockImplementation(() => {
        throw failure;
      });
      let didThrow = false,
        caught: unknown = Symbol('not thrown');
      try {
        owner.dispose();
      } catch (error) {
        didThrow = true;
        caught = error;
      }
      expect(didThrow).toBe(true);
      expect(caught).toBe(failure);
      expect(otherTextures.every((spy) => spy.mock.calls.length > 0)).toBe(true);
      expect(materialSpies.every((spy) => spy.mock.calls.length > 0)).toBe(true);
    },
  );
  it.each([undefined, null])(
    'retains the original preparation failure when cleanup throws %s',
    async (cleanupFailure) => {
      const opts = options(),
        primary = new Error('original preparation sentinel');
      const textureDisposals: ReturnType<typeof vi.spyOn>[] = [];
      vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(
        loadBabylonStartGantry(opts, {
          ...prepared,
          decode: async (raw, scene) => {
            const container = await LoadAssetContainerAsync(raw, scene, {
              pluginExtension: '.glb',
            });
            textureDisposals.push(
              ...container.textures.map((texture) => vi.spyOn(texture, 'dispose')),
            );
            vi.spyOn(container, 'dispose').mockImplementation(() => {
              throw cleanupFailure;
            });
            return container;
          },
          prepare: async () => {
            throw primary;
          },
        }),
      ).rejects.toBe(primary);
      expect(textureDisposals).toHaveLength(3);
      expect(textureDisposals.every((spy) => spy.mock.calls.length > 0)).toBe(true);
    },
  );
  it('reports actual staged and installed resources, not historical references after detach/dispose', async () => {
    const opts = options(),
      owner = await loadBabylonStartGantry(opts, prepared);
    const counts = () => {
      const d = owner.diagnostics() as unknown as Record<string, unknown>;
      return Object.fromEntries(
        ['stagedParts', 'activeParts', 'activeMaterials', 'activeTextures'].map((key) => [
          key,
          d[key],
        ]),
      );
    };
    expect(counts()).toMatchObject({
      stagedParts: 4,
      activeParts: 0,
      activeMaterials: 0,
      activeTextures: 0,
    });
    await owner.install();
    expect(counts()).toMatchObject({
      stagedParts: 0,
      activeParts: 4,
      activeMaterials: 1,
      activeTextures: 3,
    });
    for (const { mesh } of owner.diagnostics().parts) opts.scene.removeMesh(mesh);
    expect(counts()).toMatchObject({
      activeParts: 0,
      activeMaterials: 0,
      activeTextures: 0,
    });
    owner.dispose();
    expect(counts()).toMatchObject({
      stagedParts: 0,
      activeParts: 0,
      activeMaterials: 0,
      activeTextures: 0,
    });
  });
  it('owns native decode and geometry uploads within GPU preparation, draining owner cancellation outside the lane', async () => {
    const controller = new AbortController(),
      opts = options(setup(), controller);
    let inLane = false,
      calls = 0,
      laneRejected = false,
      captured: AssetContainer | undefined;
    opts.gpu = {
      prepare: async (
        _label: string,
        _deadline: number,
        work: (invalidated: AbortSignal) => Promise<unknown>,
      ) => {
        calls++;
        inLane = true;
        try {
          return await work(new AbortController().signal);
        } catch (error) {
          laneRejected = true;
          throw error;
        } finally {
          inLane = false;
        }
      },
    } as unknown as Parameters<typeof loadBabylonStartGantry>[0]['gpu'];
    const apply = VertexData.prototype.applyToMesh;
    const uploads = vi.spyOn(VertexData.prototype, 'applyToMesh').mockImplementation(function (
      this: VertexData,
      ...args
    ) {
      expect(inLane).toBe(true);
      return apply.apply(this, args);
    });
    await expect(
      loadBabylonStartGantry(opts, {
        ...prepared,
        decode: async (raw, scene) => {
          expect(inLane).toBe(true);
          captured = await LoadAssetContainerAsync(raw, scene, { pluginExtension: '.glb' });
          controller.abort();
          return captured;
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBeGreaterThan(0);
    expect(laneRejected).toBe(false);
    expect(uploads).toHaveBeenCalled();
    expect(opts.scene.meshes).toHaveLength(0);
  });

  it('drains late native ownership after fatal GPU invalidation rejects the outer await', async () => {
    const opts = options(),
      entered = deferred(),
      decodeGate = deferred(),
      invalidated = new AbortController();
    const fatal = new Error('fatal GPU ownership invalidation');
    let workPromise: Promise<unknown> | undefined;
    let meshes: AbstractMesh[] = [];
    const textureDisposals: ReturnType<typeof vi.spyOn>[] = [];
    opts.gpu = {
      prepare: async (
        _label: string,
        _deadline: number,
        work: (signal: AbortSignal) => Promise<unknown>,
      ) => {
        workPromise = work(invalidated.signal);
        void workPromise.catch(() => {});
        await entered.promise;
        invalidated.abort(fatal);
        throw fatal;
      },
    } as unknown as Parameters<typeof loadBabylonStartGantry>[0]['gpu'];
    await expect(
      loadBabylonStartGantry(opts, {
        ...prepared,
        decode: async (raw, scene) => {
          entered.resolve();
          await decodeGate.promise;
          const container = await LoadAssetContainerAsync(raw, scene, { pluginExtension: '.glb' });
          meshes = [...container.meshes];
          textureDisposals.push(
            ...container.textures.map((texture) => vi.spyOn(texture, 'dispose')),
          );
          return container;
        },
      }),
    ).rejects.toBe(fatal);
    expect(meshes).toHaveLength(0);
    decodeGate.resolve();
    await expect(workPromise).rejects.toBe(fatal);
    expect(meshes.length).toBeGreaterThan(0);
    expect(meshes.every((mesh) => mesh.isDisposed())).toBe(true);
    expect(textureDisposals).toHaveLength(3);
    expect(textureDisposals.every((spy) => spy.mock.calls.length > 0)).toBe(true);
    expect(opts.scene.meshes).toHaveLength(0);
  });
  it('detaches a throwing active mesh and drains independent textures without rescuing that resource', async () => {
    const opts = options(),
      owner = await loadBabylonStartGantry(opts, prepared);
    await owner.install();
    const bad = owner.diagnostics().parts[0].mesh,
      failure = new Error('mesh disposal sentinel');
    const textures = owner.diagnostics().parts[0].material.getActiveTextures(),
      spies = textures.map((texture) => vi.spyOn(texture, 'dispose'));
    vi.spyOn(bad, 'dispose').mockImplementation(() => {
      throw failure;
    });
    expect(() => owner.dispose()).toThrow(failure);
    expect(opts.scene.meshes).not.toContain(bad);
    expect(spies).toHaveLength(3);
    expect(spies.every((spy) => spy.mock.calls.length > 0)).toBe(true);
    expect(owner.diagnostics().activeParts).toBe(0);
  });

  it('retains an undefined reader cancellation failure after successful transfer', async () => {
    const opts = options();
    let sent = false;
    const releaseLock = vi.fn();
    const response = {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (sent) return { done: true };
            sent = true;
            return { done: false, value: bytes() };
          },
          cancel: async () => {
            throw undefined;
          },
          releaseLock,
        }),
      },
    } as unknown as Response;
    const decode = vi.fn();
    await expect(
      loadBabylonStartGantry(opts, { ...prepared, decode, fetcher: async () => response }),
    ).rejects.toBeUndefined();
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(decode).not.toHaveBeenCalled();
  });
  it('preserves the original stream read error when releaseLock also fails', async () => {
    const opts = options(),
      primary = new Error('stream read sentinel'),
      cleanup = new Error('release sentinel');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const cancel = vi.fn(async () => {}),
      releaseLock = vi.fn(() => {
        throw cleanup;
      });
    const response = {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            throw primary;
          },
          cancel,
          releaseLock,
        }),
      },
    } as unknown as Response;
    const decode = vi.fn();
    await expect(
      loadBabylonStartGantry(opts, { ...prepared, decode, fetcher: async () => response }),
    ).rejects.toBe(primary);
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(decode).not.toHaveBeenCalled();
  });
});
