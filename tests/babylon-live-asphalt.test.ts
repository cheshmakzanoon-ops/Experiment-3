import { afterEach, expect, it, vi } from 'vitest';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { Logger } from '@babylonjs/core/Misc/logger.js';
import type { IReadonlyObservable } from '@babylonjs/core/Misc/observable.js';
import { BabylonCircuitScene } from '../src/engine/babylon/circuit-scene.ts';
import { createFormulaSurfaceProbe } from '../src/engine/babylon/formula-surfaces.ts';
import { AsphaltSubstratePlugin } from '../src/engine/babylon/asphalt-substrate-plugin.ts';
import { SurfacePreparation } from '../src/engine/babylon/surface-preparation.ts';
import {
  prepareOriginalMaterials,
  materialVariants,
} from '../src/engine/babylon/asset-preparation.ts';
import { BabylonPresentationGpu } from '../src/engine/babylon/presentation-gpu.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
import { RestartOwnership } from '../src/engine/babylon/restart-ownership.ts';
import { Track } from '../src/simulation/track.ts';
import { FORMULA_APX01 } from '../src/simulation/vehicles.ts';

const engines: NullEngine[] = [];
function engine() {
  const value = new NullEngine();
  // Explicit NullEngine ownership simulation; no GPU result is inferred here.
  Object.defineProperty(value, 'webGLVersion', { value: 2 });
  Object.defineProperty(value, 'supportsUniformBuffers', { value: true });
  Object.assign(value.getCaps(), { supportSRGBBuffers: true, standardDerivatives: true });
  engines.push(value);
  return value;
}
const context = { presentation: 'circuit', vehicles: [FORMULA_APX01] };
const probeContext = {
  discipline: 'formula',
  presentation: 'circuit',
  circuitId: 'aurel',
} as const;
const counts = (scene: Scene) => ({
  meshes: scene.meshes.length,
  geometries: scene.geometries.length,
  materials: scene.materials.length,
  textures: scene.textures.length,
  roots: scene.rootNodes.length,
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const value of engines.splice(0)) value.dispose();
  vi.useRealTimers();
});

it('derives dry-substrate diagnostics from every actual road binding and live attached owned texture', () => {
  const view = new BabylonCircuitScene(engine(), new Track('clear'), 1, context);
  const road = view.scene.meshes.filter((m) => m.metadata?.surface === 'road');
  const material = road[0].material as PBRMaterial;
  const original = view.surfaceDiagnostics;
  expect(original).toMatchObject({
    asphaltSubstrateRoadChunks: 38,
    asphaltSubstrateMaterials: 1,
    asphaltSubstrateTextures: 3,
    asphaltSubstrateSrgbTextures: 1,
  });
  expect(road.every((mesh) => mesh.material === material)).toBe(true);
  expect(material.pluginManager!.getPlugin('OriginalAsphaltSubstrate')).toBeInstanceOf(
    AsphaltSubstratePlugin,
  );
  const variants = materialVariants({ meshes: view.scene.meshes });
  expect(variants).toHaveLength(115);
  expect(variants.filter((variant) => variant.material === material).map((v) => v.mesh)).toEqual(
    road,
  );
  road[0].material = null;
  expect(view.surfaceDiagnostics.asphaltSubstrateRoadChunks).toBe(37);
  road[0].material = material;
  road[0].setEnabled(false);
  expect(view.surfaceDiagnostics.asphaltSubstrateRoadChunks).toBe(37);
  road[0].setEnabled(true);
  const albedo = material.albedoTexture!;
  material.albedoTexture = null;
  expect(view.surfaceDiagnostics).toMatchObject({
    asphaltSubstrateTextures: 2,
    asphaltSubstrateSrgbTextures: 0,
  });
  material.albedoTexture = albedo;
  view.scene.removeTexture(albedo);
  expect(view.surfaceDiagnostics.asphaltSubstrateTextures).toBe(2);
  view.scene.addTexture(albedo);
  expect(view.surfaceDiagnostics).toEqual(original);
  view.scene.removeMaterial(material);
  expect(view.surfaceDiagnostics).toMatchObject({
    asphaltSubstrateRoadChunks: 0,
    asphaltSubstrateMaterials: 0,
    asphaltSubstrateTextures: 0,
    asphaltSubstrateSrgbTextures: 0,
  });
  view.scene.addMaterial(material);
  expect(view.surfaceDiagnostics).toEqual(original);
  albedo.dispose();
  expect(view.surfaceDiagnostics.asphaltSubstrateTextures).toBe(2);
  expect(view.surfaceDiagnostics.asphaltSubstrateSrgbTextures).toBe(0);
  material.dispose(false, false);
  expect(view.surfaceDiagnostics.asphaltSubstrateMaterials).toBe(0);
  expect(view.surfaceDiagnostics.asphaltSubstrateTextures).toBe(0);
  view.dispose();
});

it('releases the shared three maps once for material-first and owner-first surface disposal without touching borrowed resources', () => {
  for (const materialFirst of [false, true]) {
    const scene = new Scene(engine());
    scene.useRightHandedSystem = true;
    const borrowed = new PBRMaterial('unrelated', scene),
      before = counts(scene),
      surface = createFormulaSurfaceProbe(scene, new Track('clear'), probeContext, {
        start: 0,
        end: 160,
      });
    const resources = [
      surface.roadMaterial,
      surface.paintMaterial,
      ...Object.values(surface.asphaltSubstrate.textures),
    ];
    const spies = resources.map((resource) => vi.spyOn(resource, 'dispose'));
    if (materialFirst) surface.roadMaterial.dispose(false, false);
    surface.dispose();
    surface.dispose();
    spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    expect(surface.asphaltSubstrate.isValid).toBe(false);
    expect(counts(scene)).toEqual(before);
    expect(scene.materials).toContain(borrowed);
    scene.dispose();
  }
});

it('keeps context loss sticky and creates a fresh three-map owner only on explicit rebuild', () => {
  const e = engine(),
    track = new Track('clear'),
    view = new BabylonCircuitScene(e, track, 1, context),
    old = view.scene.textures.filter((t) => t !== view.scene.environmentBRDFTexture),
    disposed = old.map((texture) => {
      const call = vi.fn();
      texture.onDisposeObservable.add(call);
      return call;
    });
  e.onContextLostObservable.notifyObservers(e);
  expect(view.surfaceDiagnostics.asphaltSubstrateRoadChunks).toBe(0);
  expect(view.surfaceDiagnostics.asphaltSubstrateTextures).toBe(0);
  e.onContextRestoredObservable.notifyObservers(e);
  expect(view.surfaceDiagnostics.asphaltSubstrateTextures).toBe(0);
  view.dispose();
  disposed.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
  const rebuilt = new BabylonCircuitScene(e, track, 1, context);
  expect(rebuilt.surfaceDiagnostics.asphaltSubstrateTextures).toBe(3);
  expect(rebuilt.scene.textures.every((texture) => !old.includes(texture))).toBe(true);
  rebuilt.dispose();
  view.dispose();
  disposed.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
});

for (const order of ['detached-paint', 'paint-first', 'scene-first-detached'] as const)
  it(`retains allocated resource ownership through ${order}, using actual disposal receipts`, () => {
    const scene = new Scene(engine());
    scene.useRightHandedSystem = true;
    const borrowed = new PBRMaterial('unrelated', scene),
      borrowedDisposed = vi.fn(),
      before = counts(scene);
    borrowed.onDisposeObservable.add(borrowedDisposed);
    const surface = createFormulaSurfaceProbe(scene, new Track('clear'), probeContext, {
      start: 0,
      end: 80,
    });
    const resources = [
      ...surface.meshes,
      surface.roadMaterial,
      surface.paintMaterial,
      ...Object.values(surface.asphaltSubstrate.textures),
    ];
    const released = resources.map((resource) => {
      const call = vi.fn();
      const observable: IReadonlyObservable = resource.onDisposeObservable;
      observable.add(call);
      return call;
    });
    const disposeCalls = resources.map((resource) => vi.spyOn(resource, 'dispose'));
    if (order === 'paint-first') surface.paintMaterial.dispose(false, false);
    else scene.removeMaterial(surface.paintMaterial);
    if (order === 'scene-first-detached') {
      scene.removeMaterial(surface.roadMaterial);
      scene.removeTexture(surface.asphaltSubstrate.textures.data);
      released.forEach((call) => expect(call).not.toHaveBeenCalled());
      scene.dispose();
      // Verify scene-first ownership before an explicit owner cleanup can help.
      released.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
      expect(borrowedDisposed).toHaveBeenCalledTimes(1);
    }
    surface.dispose();
    surface.dispose();
    released.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
    disposeCalls.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
    if (order !== 'scene-first-detached') {
      expect(counts(scene)).toEqual(before);
      expect(borrowedDisposed).not.toHaveBeenCalled();
      scene.dispose();
      expect(borrowedDisposed).toHaveBeenCalledTimes(1);
    }
    released.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
    disposeCalls.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
  });

for (const kind of ['paint', 'mesh'] as const)
  it(`cleans a ${kind} constructor registered before its real deferred notification`, async () => {
    vi.useFakeTimers();
    const scene = new Scene(engine());
    scene.useRightHandedSystem = true;
    new PBRMaterial('unrelated', scene);
    const before = counts(scene),
      failure = new Error(`injected partial ${kind} constructor`),
      notified = vi.fn(),
      disposed = vi.fn();
    let partial: object | undefined;
    const materialObserver = scene.onNewMaterialAddedObservable.add((value) => {
      if (value === partial) notified();
    });
    const meshObserver = scene.onNewMeshAddedObservable.add((value) => {
      if (value === partial) notified();
    });
    if (kind === 'paint') {
      const add = scene.addMaterial.bind(scene);
      let calls = 0;
      vi.spyOn(scene, 'addMaterial').mockImplementation((material) => {
        add(material);
        if (++calls === 2) {
          partial = material;
          material.onDisposeObservable.add(disposed);
          throw failure;
        }
      });
    } else {
      const add = scene.addMesh.bind(scene);
      vi.spyOn(scene, 'addMesh').mockImplementationOnce((mesh, recursive) => {
        add(mesh, recursive);
        partial = mesh;
        mesh.onDisposeObservable.add(disposed);
        mesh.onAfterWorldMatrixUpdateObservable.add(vi.fn());
        mesh.onCollideObservable.add(vi.fn());
        mesh.onCollisionPositionChangeObservable.add(vi.fn());
        mesh.onRebuildObservable.add(vi.fn());
        throw failure;
      });
    }
    try {
      expect(() =>
        createFormulaSurfaceProbe(scene, new Track('clear'), probeContext, { start: 0, end: 80 }),
      ).toThrow(failure);
      expect(partial).toBeDefined();
      expect(notified).not.toHaveBeenCalled();
      expect(counts(scene)).toEqual(before);
      expect(disposed).toHaveBeenCalledTimes(1);
      expect((partial as Mesh | PBRMaterial).onDisposeObservable.hasObservers()).toBe(false);
      if (kind === 'mesh') {
        const mesh = partial as Mesh;
        expect(mesh.isDisposed()).toBe(true);
        for (const observable of [
          mesh.onAfterWorldMatrixUpdateObservable,
          mesh.onCollideObservable,
          mesh.onCollisionPositionChangeObservable,
          mesh.onRebuildObservable,
        ])
          expect(observable.hasObservers()).toBe(false);
      }
      await vi.runOnlyPendingTimersAsync();
      expect(notified).toHaveBeenCalledTimes(1);
      expect(disposed).toHaveBeenCalledTimes(1);
      expect(counts(scene)).toEqual(before);
    } finally {
      scene.onNewMaterialAddedObservable.remove(materialObserver);
      scene.onNewMeshAddedObservable.remove(meshObserver);
    }
  });

for (const resourceKind of ['material', 'texture'] as const)
  for (const afterCleanup of [false, true])
    it(`retains pinned Scene notification-error semantics and drains unrelated resources after a ${resourceKind} cleanup error (after cleanup=${afterCleanup})`, () => {
      const scene = new Scene(engine());
      scene.useRightHandedSystem = true;
      const unrelated = [
        new PBRMaterial('unrelated', scene),
        CreateBox('unrelated', {}, scene),
        RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, scene),
      ];
      const unrelatedReleased = unrelated.map((resource) => {
        const call = vi.fn();
        const observable: IReadonlyObservable = resource.onDisposeObservable;
        observable.add(call);
        return call;
      });
      const surface = createFormulaSurfaceProbe(scene, new Track('clear'), probeContext, {
        start: 0,
        end: 80,
      });
      const owned = [
        ...surface.meshes,
        surface.roadMaterial,
        surface.paintMaterial,
        ...Object.values(surface.asphaltSubstrate.textures),
      ];
      const ownedReleased = owned.map((resource) => {
        const call = vi.fn();
        // Observe the actual event before a later cleanup listener can throw.
        // A separate late observer below pins that skipped-notification limit.
        const observable: IReadonlyObservable = resource.onDisposeObservable;
        observable.add(call, -1, true);
        return call;
      });
      const roadBufferReleased = vi.spyOn(surface.roadMaterial._uniformBuffer, 'dispose'),
        lateMaterialObserver = vi.fn();
      surface.roadMaterial.onDisposeObservable.add(lateMaterialObserver);
      const failure = new Error(`injected ${resourceKind} cleanup failure`),
        log = vi.spyOn(Logger, 'Error'),
        consoleError = vi.spyOn(console, 'error'),
        laterObserver = vi.fn();
      scene.onDisposeObservable.add(laterObserver);
      const damaged =
        resourceKind === 'material'
          ? surface.paintMaterial
          : surface.asphaltSubstrate.textures.data;
      const dispose = damaged.dispose.bind(damaged);
      vi.spyOn(damaged, 'dispose').mockImplementationOnce(() => {
        if (afterCleanup) dispose();
        throw failure;
      });
      expect(() => scene.dispose()).not.toThrow();
      expect(log).toHaveBeenCalledExactlyOnceWith(
        'An error occurred while calling onDisposeObservable!',
        failure,
      );
      expect(consoleError).toHaveBeenCalledExactlyOnceWith(
        'Original Formula surface cleanup failed:',
        failure,
      );
      // This is Babylon's existing whole-notification catch, not a stronger claim
      // that later callbacks run or that Scene.dispose rethrows callback errors.
      expect(laterObserver).not.toHaveBeenCalled();
      expect(scene.isDisposed).toBe(true);
      expect(roadBufferReleased).toHaveBeenCalledTimes(1);
      expect(lateMaterialObserver).toHaveBeenCalledTimes(resourceKind === 'texture' ? 0 : 1);
      for (const texture of Object.values(surface.asphaltSubstrate.textures))
        expect(texture.getInternalTexture()).toBeNull();
      unrelatedReleased.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
      ownedReleased.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
      surface.dispose();
      ownedReleased.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
    });

for (const firstFailure of ['material', 'texture'] as const)
  for (const firstValue of ['error', 'undefined', 'null'] as const)
    it(`direct owner disposal attempts every resource and rethrows the first ${firstFailure} post-cleanup failure (${firstValue})`, () => {
      const scene = new Scene(engine());
      scene.useRightHandedSystem = true;
      const borrowed = new PBRMaterial('unrelated', scene),
        borrowedReleased = vi.fn();
      borrowed.onDisposeObservable.add(borrowedReleased);
      const surface = createFormulaSurfaceProbe(scene, new Track('clear'), probeContext, {
        start: 0,
        end: 80,
      });
      const resources = [
        ...surface.meshes,
        surface.roadMaterial,
        surface.paintMaterial,
        ...Object.values(surface.asphaltSubstrate.textures),
      ];
      const released = resources.map((resource) => {
        const call = vi.fn();
        const observable: IReadonlyObservable = resource.onDisposeObservable;
        observable.add(call, -1, true);
        return call;
      });
      const originalDisposers = resources.map((resource) => resource.dispose.bind(resource));
      const attempts = resources.map((resource) => vi.spyOn(resource, 'dispose'));
      const buffers = [surface.roadMaterial, surface.paintMaterial].map((material) =>
        vi.spyOn(material._uniformBuffer, 'dispose'),
      );
      const damaged =
        firstFailure === 'material'
          ? [surface.paintMaterial, surface.asphaltSubstrate.textures.data]
          : [surface.asphaltSubstrate.textures.data, surface.asphaltSubstrate.textures.normal];
      const failures = [
        firstValue === 'error'
          ? new Error('first post-cleanup failure')
          : firstValue === 'null'
            ? null
            : undefined,
        new Error('second post-cleanup failure'),
      ];
      damaged.forEach((resource, index) => {
        const resourceIndex = resources.indexOf(resource),
          dispose = originalDisposers[resourceIndex];
        attempts[resourceIndex].mockImplementationOnce(() => {
          dispose();
          throw failures[index];
        });
      });
      let caught = false,
        observed: unknown = Symbol('not thrown');
      try {
        surface.dispose();
      } catch (error) {
        caught = true;
        observed = error;
      }
      expect(caught).toBe(true);
      expect(observed).toBe(failures[0]);
      attempts.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
      released.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
      buffers.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
      for (const texture of Object.values(surface.asphaltSubstrate.textures))
        expect(texture.getInternalTexture()).toBeNull();
      expect(borrowedReleased).not.toHaveBeenCalled();
      surface.dispose();
      scene.dispose();
      expect(borrowedReleased).toHaveBeenCalledTimes(1);
      attempts.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
      released.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
    });

for (const earlier of ['throw', 'skip', 'skip-with-scene-error'] as const)
  it(`authoritative view cleanup releases detached resources when an earlier observer uses ${earlier}`, () => {
    const view = new BabylonCircuitScene(engine(), new Track('clear'), 1, context),
      scene = view.scene;
    const meshes = scene.meshes.filter((mesh) => mesh.metadata?.surface),
      road = meshes.find((mesh) => mesh.metadata.surface === 'road')!.material as PBRMaterial,
      paint = meshes.find((mesh) => mesh.metadata.surface === 'edge-paint')!
        .material as PBRMaterial,
      textures = road.getActiveTextures();
    expect(textures).toHaveLength(3);
    const data = textures.find((texture) => texture.name.includes('R meso'))!;
    const owned = [...meshes, road, paint, ...textures];
    const released = owned.map((resource) => {
      const call = vi.fn();
      const observable: IReadonlyObservable = resource.onDisposeObservable;
      observable.add(call);
      return call;
    });
    const originalDisposers = owned.map((resource) => resource.dispose.bind(resource));
    const attempts = owned.map((resource) => vi.spyOn(resource, 'dispose'));
    const unrelated = new PBRMaterial('unrelated', scene),
      unrelatedReleased = vi.fn(),
      earlierError = new Error('earlier notification error');
    unrelated.onDisposeObservable.add(unrelatedReleased);
    scene.onDisposeObservable.add(
      (_scene, state) => {
        if (earlier === 'throw') throw earlierError;
        state.skipNextObservers = true;
      },
      -1,
      true,
    );
    scene.removeMaterial(road);
    scene.removeMaterial(paint);
    scene.removeTexture(data);
    if (earlier === 'skip-with-scene-error') {
      const primary = new Error('scene teardown failure'),
        secondary = new Error('owned paint teardown failure'),
        disposeScene = scene.dispose.bind(scene),
        disposePaint = originalDisposers[owned.indexOf(paint)];
      vi.spyOn(scene, 'dispose').mockImplementationOnce(() => {
        disposeScene();
        throw primary;
      });
      // Use the already captured spy so invocation evidence is not replaced.
      attempts[owned.indexOf(paint)].mockImplementationOnce(() => {
        disposePaint();
        throw secondary;
      });
      expect(() => view.dispose()).toThrow(primary);
    } else {
      scene.dispose();
      // Scene-alone notification suppression does not dispose detached materials.
      expect(released[owned.indexOf(road)]).not.toHaveBeenCalled();
      expect(released[owned.indexOf(paint)]).not.toHaveBeenCalled();
      view.dispose();
    }
    expect(scene.isDisposed).toBe(true);
    expect(unrelatedReleased).toHaveBeenCalledTimes(1);
    released.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
    attempts.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
    view.dispose();
    released.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
    attempts.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
  });

it.each([undefined, null])('preserves a nullish first view teardown failure: %s', (failure) => {
  const view = new BabylonCircuitScene(engine(), new Track('clear'), 1);
  vi.spyOn(view.scene, 'dispose').mockImplementationOnce(() => {
    throw failure;
  });
  let caught = false,
    actual: unknown = Symbol('not thrown');
  try {
    view.dispose();
  } catch (error) {
    caught = true;
    actual = error;
  }
  expect(caught).toBe(true);
  expect(actual).toBe(failure);
  view.dispose();
  expect(view.scene.isDisposed).toBe(true);
});

it('does not replace an owner cleanup error when reporting that error also throws', () => {
  const scene = new Scene(engine());
  scene.useRightHandedSystem = true;
  const surface = createFormulaSurfaceProbe(scene, new Track('clear'), probeContext, {
    start: 0,
    end: 80,
  });
  const primary = new Error('owned cleanup error'),
    reporting = new Error('reporting error'),
    dispose = surface.paintMaterial.dispose.bind(surface.paintMaterial),
    sceneLogger = vi.spyOn(Logger, 'Error'),
    consoleError = vi.spyOn(console, 'error').mockImplementationOnce(() => {
      throw reporting;
    });
  vi.spyOn(surface.paintMaterial, 'dispose').mockImplementationOnce(() => {
    dispose();
    throw primary;
  });
  scene.dispose();
  expect(consoleError).toHaveBeenCalledExactlyOnceWith(
    'Original Formula surface cleanup failed:',
    primary,
  );
  expect(sceneLogger).toHaveBeenCalledExactlyOnceWith(
    'An error occurred while calling onDisposeObservable!',
    primary,
  );
  expect(scene.isDisposed).toBe(true);
  for (const texture of Object.values(surface.asphaltSubstrate.textures))
    expect(texture.getInternalTexture()).toBeNull();
});

it('does not confuse a texture disposal notification with its actual internal allocation release', () => {
  const scene = new Scene(engine());
  scene.useRightHandedSystem = true;
  const surface = createFormulaSurfaceProbe(scene, new Track('clear'), probeContext, {
    start: 0,
    end: 80,
  });
  const texture = surface.asphaltSubstrate.textures.data,
    internal = texture.getInternalTexture()!,
    allocationRelease = vi.spyOn(internal, 'dispose'),
    notified = vi.fn(),
    failure = new Error('texture listener interrupted release');
  texture.onDisposeObservable.add(notified);
  texture.onDisposeObservable.addOnce(() => {
    throw failure;
  });
  expect(() => texture.dispose()).toThrow(failure);
  expect(notified).toHaveBeenCalledTimes(1);
  expect(texture.getInternalTexture()).toBe(internal);
  expect(allocationRelease).not.toHaveBeenCalled();
  // A later explicit owner teardown still attempts its retained allocation.
  surface.dispose();
  expect(notified).toHaveBeenCalledTimes(2);
  expect(texture.getInternalTexture()).toBeNull();
  expect(allocationRelease).toHaveBeenCalledTimes(1);
  surface.dispose();
  scene.dispose();
  expect(allocationRelease).toHaveBeenCalledTimes(1);
});

it('does not choose coarse fallback after an eligible asphalt capability failure', () => {
  const e = engine(),
    before = e.scenes.length;
  e.getCaps().supportSRGBBuffers = false;
  expect(() => new BabylonCircuitScene(e, new Track('clear'), 1, context)).toThrow('WebGL2/sRGB');
  expect(e.scenes).toHaveLength(before);
});

it('retains cancelled live surface ownership until the actual preparation lease drains, then rebuilds once', async () => {
  const e = engine(),
    track = new Track('clear');
  let view = new BabylonCircuitScene(e, track, 1, context);
  const initial = view;
  const textures = view.scene.textures.filter((t) => t !== view.scene.environmentBRDFTexture);
  const disposed = textures.map((t) => vi.spyOn(t, 'dispose'));
  let release!: () => void;
  const compiler = new Promise<void>((resolve) => {
    release = resolve;
  });
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
  const gpu = new BabylonPresentationGpu(gl),
    schedule = new PresentationSchedule(),
    owner = new AbortController();
  const compile = vi.fn(() => compiler);
  const prepare: typeof prepareOriginalMaterials = (container, lane, signal, deadline, progress) =>
    prepareOriginalMaterials(container, lane, signal, deadline, progress, compile, () =>
      Promise.resolve(),
    );
  const readiness = new SurfacePreparation(
    view.scene,
    view.scene.meshes,
    gpu,
    schedule,
    owner.signal,
    performance.now() + 120000,
    prepare,
  );
  const rejected = expect(readiness.completion).rejects.toMatchObject({ name: 'AbortError' });
  const restart = new RestartOwnership(
    () => owner.abort(),
    () => ({}),
  );
  const rebuild = vi.fn(() => {
    view.dispose();
    view = new BabylonCircuitScene(e, track, 1, context);
  });
  try {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    restart.request();
    expect(restart.drain(gpu.ready(), rebuild)).toBe(false);
    expect(readiness.canDraw).toBe(false);
    disposed.forEach((spy) => expect(spy).not.toHaveBeenCalled());
    release();
    await rejected;
    expect(gpu.ready()).toBe(true);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(readiness.completed).toBe(false);
    expect(restart.drain(gpu.ready(), rebuild)).toBe(true);
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(initial.scene.isDisposed).toBe(true);
    disposed.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1));
    expect(view.surfaceDiagnostics.asphaltSubstrateTextures).toBe(3);
    expect(restart.drain(gpu.ready(), rebuild)).toBe(false);
  } finally {
    release();
    owner.abort();
    gpu.dispose();
    view.dispose();
  }
});
