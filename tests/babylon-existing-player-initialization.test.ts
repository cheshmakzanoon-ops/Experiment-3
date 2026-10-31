import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import {
  decodeExistingPlayerBytes,
  loadExistingPlayer,
  existingPlayerPrimitiveBindings,
  disposeUninstalledPlayer,
} from '../src/engine/babylon/existing-player.ts';
import { ExistingPlayerSteering } from '../src/engine/babylon/existing-player-steering.ts';
import { ExistingPlayerWheels } from '../src/engine/babylon/existing-player-wheels.ts';
import { createExistingPlayerHeightAdapter } from '../src/engine/babylon/existing-player-height.ts';
import { BabylonPresentationGpu } from '../src/engine/babylon/presentation-gpu.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function graphics() {
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1,
    TIMEOUT_EXPIRED: 2,
    ALREADY_SIGNALED: 3,
    CONDITION_SATISFIED: 4,
    isContextLost: () => false,
    clientWaitSync: () => 3,
    fenceSync: () => ({}),
    deleteSync: () => {},
    flush: () => {},
  } as unknown as WebGL2RenderingContext;
  return new BabylonPresentationGpu(gl);
}
describe('actual GLB pre-return initializer lifetime (NullEngine, not GPU pixels)', () => {
  let raw: Uint8Array<ArrayBuffer>;
  const engines: NullEngine[] = [],
    scenes: Scene[] = [];
  beforeAll(async () => {
    raw = await decodeExistingPlayerBytes(
      new Uint8Array(readFileSync('public/models/supplied-player.glb.gz')),
      new AbortController().signal,
    );
  });
  afterEach(() => {
    scenes.splice(0).forEach((scene) => scene.dispose());
    engines.splice(0).forEach((engine) => engine.dispose());
    vi.unstubAllGlobals();
  });
  function setup() {
    const engine = new NullEngine(),
      scene = new Scene(engine);
    engines.push(engine);
    scenes.push(scene);
    scene.useRightHandedSystem = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(raw)),
    );
    return scene;
  }
  it('retains the raw default with no height plugin or automatic scene installation', async () => {
    const scene = setup();
    const container = await loadExistingPlayer(
      scene,
      'https://example.invalid/',
      new AbortController().signal,
    );
    expect(container.meshes).toHaveLength(173);
    expect(
      container.materials.every(
        (m) => !m.pluginManager?.getPlugin('ExistingPlayerScalarHeightProbe'),
      ),
    ).toBe(true);
    expect(container.meshes.every((mesh) => !scene.meshes.includes(mesh))).toBe(true);
    container.dispose();
  });
  it('initializes verified bound assets before preparation; materials own enabled plugin teardown', async () => {
    const scene = setup(),
      gpu = graphics();
    let captured: AssetContainer | undefined;
    let retainedAdapter: Awaited<ReturnType<typeof createExistingPlayerHeightAdapter>> | undefined;
    const plugins: { enabled: boolean }[] = [];
    try {
      const container = await loadExistingPlayer(
        scene,
        'https://example.invalid/',
        new AbortController().signal,
        async (asset) => {
          captured = asset.container;
          expect(asset.raw.byteLength).toBe(raw.byteLength);
          expect(createHash('sha256').update(asset.raw).digest('hex')).toBe(
            createHash('sha256').update(raw).digest('hex'),
          );
          expect(asset.bindings).toBe(existingPlayerPrimitiveBindings(asset.container));
          expect(asset.bindings).toHaveLength(172);
          expect(asset.container.meshes.every((mesh) => !scene.meshes.includes(mesh))).toBe(true);
          await gpu.prepare(
            'scalar initialization',
            performance.now() + 10000,
            async (invalidated) => {
              const adapter = await createExistingPlayerHeightAdapter(
                asset.raw,
                asset.bindings,
                invalidated,
              );
              invalidated.throwIfAborted();
              retainedAdapter = adapter;
              expect(adapter.enabledCount).toBe(0);
              adapter.setEnabled(true);
              expect(adapter.enabledCount).toBe(10);
              for (const material of adapter.materials) {
                expect(material._uniformBufferLayoutBuilt).toBe(false);
                plugins.push(
                  material.pluginManager!.getPlugin(
                    'ExistingPlayerScalarHeightProbe',
                  ) as unknown as { enabled: boolean },
                );
              }
            },
          );
        },
      );
      expect(container).toBe(captured);
      expect(plugins).toHaveLength(10);
      expect(plugins.every((plugin) => plugin.enabled)).toBe(true);
      expect(gpu.diagnostics().preparation).toMatchObject({
        completed: 1,
        active: false,
        failure: null,
      });
      container.dispose();
      expect(retainedAdapter!.enabledCount).toBe(0);
      expect(plugins.every((plugin) => !plugin.enabled)).toBe(true);
    } finally {
      gpu.dispose();
    }
  });
  it('waits for initializer GPU drain on owner cancellation, then disposes once without poisoning the lane', async () => {
    const scene = setup(),
      gpu = graphics(),
      owner = new AbortController();
    const started = deferred(),
      finish = deferred();
    let dispose: ReturnType<typeof vi.spyOn> | undefined;
    let materialDisposed = 0;
    try {
      const pending = loadExistingPlayer(
        scene,
        'https://example.invalid/',
        owner.signal,
        async ({ container }) => {
          dispose = vi.spyOn(container, 'dispose');
          container.materials[0].onDisposeObservable.add(() => {
            materialDisposed++;
          });
          await gpu.prepare(
            'owned initialization',
            performance.now() + 10000,
            async (invalidated) => {
              started.resolve();
              await finish.promise;
              invalidated.throwIfAborted();
            },
          );
        },
      );
      const result = pending.then(
        () => null,
        (error: unknown) => error,
      );
      await started.promise;
      owner.abort(new DOMException('Restart requested', 'AbortError'));
      await Promise.resolve();
      expect(dispose).not.toHaveBeenCalled();
      expect(gpu.diagnostics().preparation.active).toBe(true);
      finish.resolve();
      expect(await result).toMatchObject({ name: 'AbortError' });
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(materialDisposed).toBe(1);
      expect(gpu.diagnostics().preparation).toMatchObject({
        completed: 1,
        active: false,
        failure: null,
      });
    } finally {
      finish.resolve();
      gpu.dispose();
    }
  });
  it.each([false, true])(
    'reclaims a rejected initializer once and preserves primary error (cleanup throws=%s)',
    async (cleanupThrows) => {
      const scene = setup(),
        failure = new Error('Initializer failed');
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
      const cleanupFailure = new Error('Cleanup failed after release');
      let dispose: ReturnType<typeof vi.spyOn> | undefined;
      let captured: AssetContainer | undefined;
      await expect(
        loadExistingPlayer(
          scene,
          'https://example.invalid/',
          new AbortController().signal,
          async ({ container }) => {
            captured = container;
            const release = container.dispose.bind(container);
            dispose = vi.spyOn(container, 'dispose');
            if (cleanupThrows)
              dispose.mockImplementationOnce(() => {
                release();
                throw cleanupFailure;
              });
            throw failure;
          },
        ),
      ).rejects.toBe(failure);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(() => existingPlayerPrimitiveBindings(captured!)).toThrow('unavailable');
      expect(captured!.meshes).toHaveLength(0);
      if (cleanupThrows)
        expect(logged).toHaveBeenCalledWith('Existing player cleanup failed:', cleanupFailure);
      else expect(logged).not.toHaveBeenCalled();
      logged.mockRestore();
    },
  );
  it.each([false, true])(
    'cleans actual adapters before uninstalled assets (scene disposed=%s)',
    async (sceneDisposed) => {
      const scene = setup();
      const container = await loadExistingPlayer(
        scene,
        'https://example.invalid/',
        new AbortController().signal,
      );
      const steering = new ExistingPlayerSteering(container.animationGroups);
      const wheels = new ExistingPlayerWheels([...container.transformNodes, ...container.meshes]);
      const dispose = vi.spyOn(container, 'dispose');
      const steeringDispose = vi.spyOn(steering, 'dispose'),
        wheelDispose = vi.spyOn(wheels, 'dispose');
      const materialDisposed = vi.fn();
      container.materials[0].onDisposeObservable.add(materialDisposed);
      if (sceneDisposed) scene.dispose();
      expect(disposeUninstalledPlayer(container, [steering, wheels])).toEqual([]);
      expect(steeringDispose).toHaveBeenCalledTimes(1);
      expect(wheelDispose).toHaveBeenCalledTimes(1);
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(materialDisposed).toHaveBeenCalledTimes(1);
      if (!sceneDisposed) {
        expect(steeringDispose.mock.invocationCallOrder[0]).toBeLessThan(
          dispose.mock.invocationCallOrder[0],
        );
        expect(wheelDispose.mock.invocationCallOrder[0]).toBeLessThan(
          dispose.mock.invocationCallOrder[0],
        );
      }
    },
  );
  it('respects Babylon off-scene disposal ownership when the scene dies during initialization', async () => {
    const scene = setup();
    let dispose: ReturnType<typeof vi.spyOn> | undefined;
    let materialDisposed = 0;
    await expect(
      loadExistingPlayer(
        scene,
        'https://example.invalid/',
        new AbortController().signal,
        async ({ container }) => {
          dispose = vi.spyOn(container, 'dispose');
          container.materials[0].onDisposeObservable.add(() => {
            materialDisposed++;
          });
          scene.dispose();
          await Promise.resolve();
        },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(materialDisposed).toBe(1);
  });
});

it('wires one-time height repair under lease invalidation before preparation and atomic scene installation', () => {
  const source = readFileSync('src/engine/babylon/main.ts', 'utf8');
  const initializer = source.indexOf('async ({ raw, bindings }) =>');
  const end = source.indexOf('wheels = new ExistingPlayerWheels', initializer);
  const stage = source.slice(initializer, end);
  expect(stage).toContain("'Original scalar-height materials'");
  expect(stage).toContain('createExistingPlayerHeightAdapter(raw, bindings, invalidated)');
  expect(stage).not.toContain('AbortSignal.any');
  expect(stage).toContain('if (height.enabledCount !== 10)');
  expect(stage).not.toContain('assetStatus.dataset.scalarHeightMaterials =');
  expect(stage).toContain('heightAdapter = height');
  const presentation = source.indexOf(
    'await waitForPresentation(currentScene.scene, signal, gpu!)',
    end,
  );
  const publish = source.indexOf(
    'assetStatus.dataset.scalarHeightMaterials = String(heightAdapter.enabledCount)',
    presentation,
  );
  const ownerCheck = source.indexOf('active();', presentation);
  const loadedStatus = source.indexOf("'Original Formula asset loaded", presentation);
  expect(presentation).toBeGreaterThan(end);
  expect(ownerCheck).toBeGreaterThan(presentation);
  expect(publish).toBeGreaterThan(ownerCheck);
  expect(publish).toBeLessThan(loadedStatus);
  expect(source.slice(ownerCheck, publish)).toContain('if (heightAdapter?.enabledCount !== 10)');
  for (const boundary of [
    'function stop(',
    'function reset()',
    'function rebuildScene(',
    'engine.onContextLostObservable.add(() => {',
  ]) {
    const start = source.indexOf(boundary);
    expect(source.slice(start, start + 300)).toContain(
      'delete assetStatus.dataset.scalarHeightMaterials',
    );
  }
  expect(
    source.slice(source.indexOf('loadAsset.disabled = true;', initializer - 800), initializer),
  ).toContain('delete assetStatus.dataset.scalarHeightMaterials');
  expect(source.slice(source.indexOf('// Never retry against a compiler') - 100)).toContain(
    'delete assetStatus.dataset.scalarHeightMaterials',
  );
  expect(stage.indexOf('invalidated.throwIfAborted()')).toBeLessThan(
    stage.indexOf('height.setEnabled(true)'),
  );
  expect(stage).not.toContain('dispose(');
  expect(source).toContain('disposeUninstalledPlayer(container, [steering, wheels])');
  expect(source).toContain('for (const failure of disposeUninstalled())');
  expect(initializer).toBeGreaterThan(source.indexOf('container = await loadExistingPlayer'));
  expect(end).toBeLessThan(source.indexOf('await prepareOriginalMaterials', end));
  expect(source.indexOf('await prepareOriginalMaterials', end)).toBeLessThan(
    source.indexOf('container.addAllToScene()', end),
  );
});

it('continues uninstalled cleanup after adapter/disposer failures without throwing over the primary error', () => {
  const adapterFailure = new Error('Adapter cleanup'),
    containerFailure = new Error('Container cleanup');
  const first = {
    dispose: vi.fn(() => {
      throw adapterFailure;
    }),
  };
  const second = { dispose: vi.fn() };
  const container = {
    scene: { isDisposed: false },
    dispose: vi.fn(() => {
      throw containerFailure;
    }),
  } as unknown as AssetContainer;
  expect(disposeUninstalledPlayer(container, [first, second])).toEqual([
    adapterFailure,
    containerFailure,
  ]);
  expect(second.dispose).toHaveBeenCalledTimes(1);
  expect(container.dispose).toHaveBeenCalledTimes(1);
});
