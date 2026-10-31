import { NullEngine } from '@babylonjs/core/Engines/nullEngine.js';
import { Scene } from '@babylonjs/core/scene.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight.js';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight.js';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Tools } from '@babylonjs/core/Misc/tools.js';
import { afterEach, expect, it, vi } from 'vitest';
import { Observable } from '@babylonjs/core/Misc/observable.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import { AssetContainer } from '@babylonjs/core/assetContainer.js';
import {
  materialVariants,
  prepareOriginalMaterials,
  compileMaterialVariant,
  yieldPreparationTurn,
} from '../src/engine/babylon/asset-preparation.ts';
import { BabylonPresentationGpu } from '../src/engine/babylon/presentation-gpu.ts';
import { PresentationSchedule } from '../src/engine/babylon/presentation-schedule.ts';
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function graphics() {
  const state = { wait: 3, lost: false, now: 0 };
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
  return { state, gl, gpu: new BabylonPresentationGpu(gl, () => state.now) };
}
function asset() {
  const material = {
    name: 'shared',
    getClassName: () => 'PBRMaterial',
    onEffectCreatedObservable: new Observable(),
    forceCompilationAsync: vi.fn(async () => {}),
  };
  const meshes = ['skinned', 'unskinned'].map((name) => ({
    name,
    material,
    hasThinInstances: false,
    instances: [],
    getClassName: () => 'Mesh',
    computeWorldMatrix: vi.fn(),
    getTotalVertices: () => 3,
    subMeshes: [{ getMaterial: () => material }],
  }));
  const scene = { isDisposed: false };
  const container = { meshes, scene, addAllToScene: vi.fn() } as unknown as AssetContainer;
  return { container, material, meshes, scene };
}
it('keeps shared-material mesh variants separate and resolves actual submesh materials', () => {
  const a = asset();
  const leaf = { name: 'second-leaf', getClassName: () => 'PBRMaterial' };
  a.meshes[0].subMeshes.push({ getMaterial: () => leaf as typeof a.material });
  const jobs = materialVariants(a.container);
  expect(jobs).toHaveLength(3);
  expect(jobs.map((job) => job.mesh.name)).toEqual(['skinned', 'skinned', 'unskinned']);
  expect(jobs.map((job) => job.material.name)).toEqual(['shared', 'second-leaf', 'shared']);
  expect(jobs.every((job) => !job.useInstances)).toBe(true);
  expect(a.container.addAllToScene).not.toHaveBeenCalled();
});
it('allows one compiler only and prevents proxy submissions until its fence completes', async () => {
  vi.useFakeTimers();
  const { gpu, state, gl } = graphics(),
    work = deferred(),
    started = vi.fn(() => work.promise);
  const schedule = new PresentationSchedule(),
    draw = vi.fn(() => true);
  const stage = gpu.prepare('one', 1000, started);
  expect(started).toHaveBeenCalledTimes(1);
  expect(gpu.frame(schedule, false, {}, draw)).toBe(false);
  await expect(gpu.prepare('two', 1000, async () => {})).rejects.toThrow('already owns');
  state.wait = 2;
  work.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(gl.fenceSync).toHaveBeenCalledTimes(1);
  expect(gpu.ready()).toBe(false);
  state.wait = 3;
  await vi.advanceTimersByTimeAsync(16);
  await stage;
  expect(gpu.ready()).toBe(true);
  expect(draw).not.toHaveBeenCalled();
  expect(gpu.diagnostics().preparation).toMatchObject({ active: false, started: 1, completed: 1 });
  gpu.dispose();
});
it('waits for the previous normal frame before starting compilation', async () => {
  vi.useFakeTimers();
  const { gpu, state } = graphics(),
    work = vi.fn(async () => {});
  gpu.frame(new PresentationSchedule(), false, {}, () => true);
  state.wait = 2;
  const stage = gpu.prepare('next', 1000, work);
  expect(work).not.toHaveBeenCalled();
  state.wait = 3;
  await vi.advanceTimersByTimeAsync(16);
  await stage;
  expect(work).toHaveBeenCalledTimes(1);
  expect(gpu.diagnostics().completed).toBe(1);
});
it('user cancellation keeps genuine outstanding compiler ownership, then stops without installation or another job', async () => {
  const a = asset(),
    { gpu } = graphics(),
    cancel = new AbortController(),
    work = deferred();
  const compile = vi.fn(() => work.promise);
  const task = prepareOriginalMaterials(
    a.container,
    gpu,
    cancel.signal,
    performance.now() + 120000,
    () => {},
    compile,
    async () => {},
  );
  const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
  cancel.abort();
  expect(gpu.ready()).toBe(false);
  expect(compile).toHaveBeenCalledTimes(1);
  work.resolve();
  await rejected;
  expect(gpu.ready()).toBe(true);
  expect(compile).toHaveBeenCalledTimes(1);
  expect(a.container.addAllToScene).not.toHaveBeenCalled();
});
it('scene disposal prevents the next job and installation after a late compiler completion', async () => {
  const a = asset(),
    { gpu } = graphics(),
    work = deferred(),
    compile = vi.fn(() => work.promise);
  const task = prepareOriginalMaterials(
    a.container,
    gpu,
    new AbortController().signal,
    performance.now() + 120000,
    () => {},
    compile,
    async () => {},
  );
  const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
  a.scene.isDisposed = true;
  work.resolve();
  await rejected;
  expect(compile).toHaveBeenCalledTimes(1);
  expect(a.container.addAllToScene).not.toHaveBeenCalled();
});
it.each(['loss', 'dispose'])(
  'invalidates a never-finishing compiler on %s without stale late submissions',
  async (kind) => {
    const { gpu, state, gl } = graphics(),
      work = deferred();
    const stage = gpu.prepare('stuck', 1000, () => work.promise);
    const rejected = expect(stage).rejects.toMatchObject({ name: 'AbortError' });
    if (kind === 'loss') {
      state.lost = true;
      gpu.contextLost();
      state.lost = false;
      gpu.contextRestored();
    } else gpu.dispose();
    await rejected;
    work.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(gl.fenceSync).not.toHaveBeenCalled();
    expect(gpu.diagnostics().preparation).toMatchObject({
      active: false,
      completed: 0,
      failure: null,
    });
    expect(gpu.ready()).toBe(kind === 'loss');
  },
);
it('uses the remaining original deadline, fails closed, and does not release retry ownership as healthy', async () => {
  vi.useFakeTimers();
  const { gpu } = graphics();
  const stage = gpu.prepare('stuck', 25, () => new Promise(() => {}));
  const rejected = expect(stage).rejects.toThrow('120000ms total budget');
  await vi.advanceTimersByTimeAsync(25);
  await rejected;
  expect(() => gpu.ready()).toThrow('120000ms total budget');
  await expect(gpu.prepare('retry', 1000, async () => {})).rejects.toThrow('120000ms');
});
it('fails closed on a compiler error instead of issuing the next variant', async () => {
  const a = asset(),
    { gpu } = graphics(),
    compile = vi.fn(async () => {
      throw new Error('shader failed');
    });
  await expect(
    prepareOriginalMaterials(
      a.container,
      gpu,
      new AbortController().signal,
      performance.now() + 120000,
      () => {},
      compile,
    ),
  ).rejects.toThrow('shader failed');
  expect(compile).toHaveBeenCalledTimes(1);
  expect(() => gpu.ready()).toThrow('shader failed');
  expect(a.container.addAllToScene).not.toHaveBeenCalled();
});
it('observes public PBR effect errors even when forceCompilationAsync never rejects', async () => {
  const a = asset(),
    invalidated = new AbortController();
  const effect = { onErrorObservable: new Observable(), getCompilationError: () => 'link failed' };
  a.material.forceCompilationAsync = vi.fn(() => {
    a.material.onEffectCreatedObservable.notifyObservers({ effect });
    return new Promise<void>(() => {});
  });
  await expect(
    compileMaterialVariant(
      {
        mesh: a.container.meshes[0],
        material: a.material as unknown as Material,
        useInstances: false,
        label: 'skin/shared',
      },
      invalidated.signal,
    ),
  ).rejects.toThrow('link failed');
  expect(effect.onErrorObservable.hasObservers()).toBe(false);
  expect(a.material.onEffectCreatedObservable.hasObservers()).toBe(false);
});
it('processes all variants sequentially without installing a partial container', async () => {
  const a = asset(),
    { gpu } = graphics();
  let active = 0,
    maximum = 0;
  const compile = vi.fn(async () => {
    maximum = Math.max(maximum, ++active);
    await Promise.resolve();
    active--;
  });
  const progress = vi.fn();
  await prepareOriginalMaterials(
    a.container,
    gpu,
    new AbortController().signal,
    performance.now() + 120000,
    progress,
    compile,
    async () => {},
  );
  expect(maximum).toBe(1);
  expect(compile).toHaveBeenCalledTimes(2);
  expect(gpu.diagnostics().preparation.completed).toBe(2);
  expect(a.container.addAllToScene).not.toHaveBeenCalled();
  expect(progress).toHaveBeenLastCalledWith(2, 2, expect.any(String));
});

it('detaches public compiler observers on ownership invalidation and ignores late completion', async () => {
  const a = asset(),
    invalidated = new AbortController(),
    work = deferred();
  a.material.forceCompilationAsync = vi.fn(() => work.promise);
  const task = compileMaterialVariant(
    {
      mesh: a.container.meshes[0],
      material: a.material as unknown as Material,
      useInstances: false,
      label: 'actual mesh',
    },
    invalidated.signal,
  );
  const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
  invalidated.abort();
  await rejected;
  expect(a.material.onEffectCreatedObservable.hasObservers()).toBe(false);
  work.resolve();
  await Promise.resolve();
});
it('bounds the between-variant RAF yield by cancellation and the original deadline', async () => {
  vi.useFakeTimers();
  const cancelFrame = vi.fn();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 17),
  );
  vi.stubGlobal('cancelAnimationFrame', cancelFrame);
  const abort = new AbortController();
  const cancelled = yieldPreparationTurn(abort.signal, performance.now() + 120000);
  const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  abort.abort();
  await rejected;
  expect(cancelFrame).toHaveBeenCalledWith(17);
  const timed = yieldPreparationTurn(new AbortController().signal, performance.now() + 10);
  const expired = expect(timed).rejects.toThrow('120000ms total budget');
  await vi.advanceTimersByTimeAsync(11);
  await expired;
});
it('does not start any compiler after the total asset budget has expired', async () => {
  const a = asset(),
    { gpu } = graphics(),
    compile = vi.fn(async () => {});
  await expect(
    prepareOriginalMaterials(
      a.container,
      gpu,
      new AbortController().signal,
      performance.now() - 1,
      () => {},
      compile,
    ),
  ).rejects.toThrow('120000ms total budget');
  expect(compile).not.toHaveBeenCalled();
  expect(gpu.diagnostics().preparation.started).toBe(0);
});

it('prepares a real off-scene Babylon container with unchanged authored transforms/features and installs without hierarchy warnings', async () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  new FreeCamera('camera', new Vector3(0, 0, -5), scene);
  new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
  new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
  const entrant = new TransformNode('entrant', scene);
  const mesh = CreateBox('authored-root', {}, scene);
  mesh.position.y = 2 - 0.25;
  mesh.scaling.set(-1, 2, 1);
  mesh.rotation.y = 0.4;
  const material = new PBRMaterial('clearcoat', scene);
  material.metallic = 0.7;
  material.roughness = 0.3;
  material.clearCoat.isEnabled = true;
  mesh.material = material;
  const container = new AssetContainer(scene);
  container.meshes.push(mesh);
  container.rootNodes.push(mesh);
  container.materials.push(material);
  const warning = vi.spyOn(Tools, 'Warn');
  const { gpu } = graphics();
  try {
    container.removeAllFromScene();
    expect(scene.meshes).toHaveLength(0);
    expect(mesh.parent).toBeNull();
    expect(mesh.lightSources).toHaveLength(2);
    await prepareOriginalMaterials(
      container,
      gpu,
      new AbortController().signal,
      performance.now() + 120000,
      () => {},
      compileMaterialVariant,
      async () => {},
    );
    expect(scene.meshes).toHaveLength(0);
    expect(mesh.parent).toBeNull();
    expect(mesh.scaling.asArray()).toEqual([-1, 2, 1]);
    expect(mesh.position.y).toBe(1.75);
    expect(mesh.rotation.y).toBe(0.4);
    expect(material.metallic).toBe(0.7);
    expect(material.roughness).toBe(0.3);
    expect(material.clearCoat.isEnabled).toBe(true);
    container.addAllToScene();
    for (const root of container.rootNodes) root.parent = entrant;
    expect(scene.meshes).toContain(mesh);
    expect(mesh.parent).toBe(entrant);
    expect(entrant.scaling.asArray()).toEqual([1, 1, 1]);
    expect(warning).not.toHaveBeenCalled();
  } finally {
    warning.mockRestore();
    gpu.dispose();
    scene.dispose();
    engine.dispose();
  }
});

it('does not enqueue a fence after a synchronous compiler returns beyond the deadline', async () => {
  const { gpu, state, gl } = graphics();
  await expect(
    gpu.prepare('slow synchronous compile', 10, async () => {
      state.now = 11;
    }),
  ).rejects.toThrow('120000ms total budget');
  expect(gl.fenceSync).not.toHaveBeenCalled();
  expect(() => gpu.ready()).toThrow('120000ms total budget');
});
