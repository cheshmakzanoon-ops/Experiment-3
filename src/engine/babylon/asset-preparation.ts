import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh.js';
import type { Material } from '@babylonjs/core/Materials/material.js';
import type { Effect } from '@babylonjs/core/Materials/effect.js';
import type { Observer } from '@babylonjs/core/Misc/observable.js';
import type { BabylonPresentationGpu } from './presentation-gpu.ts';

export interface MaterialVariant {
  mesh: AbstractMesh;
  material: Material;
  useInstances: boolean;
  label: string;
}
/** Actual mesh identity is part of the key: skinning/attributes/scale can differ
 * when meshes share a material. Submesh.getMaterial resolves MultiMaterial leaves.
 * Existing instanced sources compile both draw paths, not every unused variant. */
export function materialVariants(container: Pick<AssetContainer, 'meshes'>): MaterialVariant[] {
  const jobs: MaterialVariant[] = [];
  for (const mesh of container.meshes) {
    if (!mesh.subMeshes?.length || mesh.getTotalVertices() === 0) continue;
    mesh.computeWorldMatrix(true);
    const materials = new Set(mesh.subMeshes.map((submesh) => submesh.getMaterial()));
    const instanced = mesh.getClassName() === 'InstancedMesh' || mesh.hasThinInstances;
    const modes =
      !instanced && 'instances' in mesh && (mesh.instances as unknown[]).length
        ? [false, true]
        : [instanced];
    for (const material of materials) {
      if (!material) throw new Error(`Original model mesh ${mesh.name} has no material`);
      if (material.getClassName() === 'MultiMaterial')
        throw new Error(`Unresolved original model submaterial on ${mesh.name}`);
      for (const useInstances of modes)
        jobs.push({
          mesh,
          material,
          useInstances,
          label: `${mesh.name}/${material.name}/${useInstances ? 'instances' : 'ordinary'}`.slice(
            0,
            180,
          ),
        });
    }
  }
  return jobs;
}
/** PBR's pinned forceCompilation override does not forward the base onError
 * callback. Observe public effects as well; no shader checks or features change.
 * This signal invalidates GPU ownership (loss/disposal/deadline), not user cancel
 * of a still-running driver compiler. */
export function compileMaterialVariant(
  job: MaterialVariant,
  invalidated: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    invalidated.throwIfAborted();
    let settled = false;
    const errors = new Map<Effect, Observer<Effect> | null>();
    const clean = () => {
      job.material.onEffectCreatedObservable.remove(created);
      for (const [effect, observer] of errors) effect.onErrorObservable.remove(observer);
      invalidated.removeEventListener('abort', aborted);
    };
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clean();
      if (error !== undefined) reject(error);
      else resolve();
    };
    const aborted = () =>
      finish(
        invalidated.reason ?? new DOMException('Graphics ownership invalidated', 'AbortError'),
      );
    const created = job.material.onEffectCreatedObservable.add(({ effect }) => {
      if (!effect) return;
      const fail = () =>
        finish(
          new Error(`Original model shader failed: ${effect.getCompilationError() || job.label}`),
        );
      if (!errors.has(effect)) errors.set(effect, effect.onErrorObservable.add(fail));
      if (effect.getCompilationError()) fail();
    });
    invalidated.addEventListener('abort', aborted, { once: true });
    try {
      job.material.forceCompilationAsync(job.mesh, { useInstances: job.useInstances }).then(
        () => finish(),
        (error: unknown) => finish(error),
      );
    } catch (error) {
      finish(error);
    }
  });
}

/** Give the normal render loop a presentation opportunity between variants.
 * Abort/deadline still settle this wait if the browser stops delivering RAF. */
export function yieldPreparationTurn(signal: AbortSignal, deadline: number): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    let frame = 0;
    const clean = () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
    };
    const aborted = () => {
      clean();
      reject(signal.reason);
    };
    const timer = setTimeout(
      () => {
        clean();
        reject(new Error('Original model preparation exceeded its 120000ms total budget'));
      },
      Math.max(0, deadline - performance.now()),
    );
    signal.addEventListener('abort', aborted, { once: true });
    frame = requestAnimationFrame(() => {
      clean();
      resolve();
    });
  });
}

/** No addAllToScene here: callers install atomically only after this returns.
 * One shared deadline belongs to the entire click, including load and final draws. */
export async function prepareOriginalMaterials(
  container: AssetContainer,
  gpu: Pick<BabylonPresentationGpu, 'prepare'>,
  signal: AbortSignal,
  deadline: number,
  progress: (done: number, total: number, label: string) => void,
  compile = compileMaterialVariant,
  yieldTask: () => Promise<void> = () => yieldPreparationTurn(signal, deadline),
) {
  const scene = container.scene;
  const active = () => {
    signal.throwIfAborted();
    if (scene.isDisposed) throw new DOMException('Original model scene disposed', 'AbortError');
    if (performance.now() >= deadline)
      throw new Error('Original model preparation exceeded its 120000ms total budget');
  };
  active();
  const jobs = materialVariants(container);
  if (!jobs.length) throw new Error('Original model has no material variants');
  for (let index = 0; index < jobs.length; index++) {
    active();
    const job = jobs[index];
    progress(index, jobs.length, job.label);
    // A user's cancellation cannot declare an already-started compiler done.
    await gpu.prepare(job.label, deadline, (invalidated) => compile(job, invalidated));
    active();
    progress(index + 1, jobs.length, job.label);
    await yieldTask();
  }
  active();
}
