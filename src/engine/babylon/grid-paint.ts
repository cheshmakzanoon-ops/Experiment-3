import * as T from 'three';
import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { AUREL } from '../../simulation/circuits.ts';
import type { Track } from '../../simulation/track.ts';
import { GridPaintPresentation } from '../../rendering/grid-paint.ts';
import { installCircuitFinish } from '../../rendering/circuit-finish.ts';
import type { CircuitPresentationContext } from './circuit-scene.ts';
import { legacyVertexData } from './legacy-geometry.ts';
import { CircuitPaintFinishPlugin } from './circuit-paint-finish.ts';
import { prepareOriginalMaterials } from './asset-preparation.ts';
import { waitForPresentation } from './presentation-ready.ts';
import type { BabylonPresentationGpu } from './presentation-gpu.ts';
import type { PresentationSchedule } from './presentation-schedule.ts';

export function gridPaintEligible(track: Track, context?: CircuitPresentationContext) {
  return (
    track.circuit === AUREL &&
    context?.presentation === 'circuit' &&
    Array.isArray(context.vehicles) &&
    context.vehicles.length > 0 &&
    context.vehicles.every((v) => v?.classId === 'formula' && v.dynamicsKind === 'four-wheel')
  );
}
export interface BabylonGridPaintOptions {
  scene: Scene;
  track: Track;
  context: CircuitPresentationContext;
  signal: AbortSignal;
  gpu: BabylonPresentationGpu;
  deadline: number;
  isCurrent(): boolean;
  schedule: PresentationSchedule;
}
export interface GridPaintDependencies {
  /** CPU seams only. Fake compilation/receipts do not certify GPU fidelity. */
  prepare?: typeof prepareOriginalMaterials;
  present?: typeof waitForPresentation;
}
/** Pinned Babylon 9.33.1 registers before derived constructor fields exist.
 * Capture only the direct constructor's first registration identity, never a
 * collection delta. The scene-instance method/descriptor is restored in the
 * same synchronous stack; no prototype, vendor or global hook is changed.
 * Material additionally covers the pinned base Created hook before the first
 * PBRBaseMaterial field. This is not a generic arbitrary-constructor unwinder. */
function constructGridMaterial(scene: Scene) {
  const previous = scene.addMaterial;
  const descriptor = Object.getOwnPropertyDescriptor(scene, 'addMaterial');
  let captured: Material | undefined,
    registrationFailed = false,
    registrationReturned = false;
  Object.defineProperty(scene, 'addMaterial', {
    configurable: true,
    writable: true,
    value(value: Material) {
      captured ??= value;
      try {
        const result = previous.call(scene, value);
        if (value === captured) registrationReturned = true;
        return result;
      } catch (error) {
        if (value === captured) registrationFailed = true;
        throw error;
      }
    },
  });
  try {
    return new PBRMaterial('Original Aurel Formula grid paint', scene);
  } catch (error) {
    // In pinned PBRBaseMaterial the first statement after super returns is
    // this._directIntensity = 1.0. Material's synchronous Created hook runs
    // before that boundary. Inspect only the captured object's own field;
    // never call uninitialized derived accessors or install a global hook.
    const beforePbrBase =
      captured && registrationReturned && !Object.hasOwn(captured, '_directIntensity');
    if (captured && (registrationFailed || beforePbrBase)) {
      // Material's UBO/draw wrapper exist here; PBR's _renderTargets do not.
      try {
        Material.prototype.dispose.call(captured, false, false, true);
      } catch {
        /* preserve the constructor's original (possibly falsy) error */
      }
    }
    throw error;
  } finally {
    if (descriptor) Object.defineProperty(scene, 'addMaterial', descriptor);
    else Reflect.deleteProperty(scene, 'addMaterial');
  }
}
function constructGridMesh(scene: Scene) {
  const previous = scene.addMesh;
  const descriptor = Object.getOwnPropertyDescriptor(scene, 'addMesh');
  let captured: Mesh | undefined,
    registrationFailed = false;
  Object.defineProperty(scene, 'addMesh', {
    configurable: true,
    writable: true,
    value(value: Mesh, recursive?: boolean) {
      captured ??= value;
      try {
        return previous.call(scene, value, recursive);
      } catch (error) {
        if (value === captured) registrationFailed = true;
        throw error;
      }
    },
  });
  try {
    return new Mesh('Original Aurel Formula grid paint batch', scene);
  } catch (error) {
    if (registrationFailed && captured) {
      // AbstractMesh's UBO is allocated AFTER addMesh, and Mesh fields are
      // later still. Only TransformNode is fully initialized at this boundary.
      try {
        scene.removeMesh(captured);
      } catch {
        /* continue independent cleanup */
      }
      try {
        TransformNode.prototype.dispose.call(captured, true, false);
      } catch {
        /* preserve primary; never forge disposed markers */
      }
    }
    throw error;
  } finally {
    if (descriptor) Object.defineProperty(scene, 'addMesh', descriptor);
    else Reflect.deleteProperty(scene, 'addMesh');
  }
}
/** Isolated original Aurel Formula boxes, not GP quads. Dry construction finish
 * only: no live import, weather, car grounding, light pools or shadow parity. */
export async function createBabylonGridPaint(
  options: BabylonGridPaintOptions,
  dependencies: GridPaintDependencies = {},
) {
  const { scene, track, signal, gpu, deadline, schedule } = options;
  const active = () => {
    signal.throwIfAborted();
    if (scene.isDisposed || !scene.useRightHandedSystem || !options.isCurrent())
      throw new DOMException('Grid paint scene ownership changed', 'AbortError');
    if (!gridPaintEligible(track, options.context))
      throw new Error('Grid paint requires original Aurel Formula context');
    if (!Number.isFinite(deadline) || performance.now() >= deadline)
      throw new Error('Grid paint preparation deadline exceeded');
  };
  active();
  const meshes: Mesh[] = [],
    disposed = new AbortController();
  let material: PBRMaterial | undefined;
  let state: 'prepared' | 'installing' | 'ready' | 'disposed' = 'prepared';
  const resources = new Map<
    object,
    { attempted: boolean; done: boolean; release(): void; isDisposed?: () => boolean }
  >();
  const remember = (
    resource: object,
    release: () => void,
    isDisposed?: () => boolean,
    observe?: (done: () => void) => void,
  ) => {
    if (resources.has(resource)) return;
    const entry = { attempted: false, done: false, release, isDisposed };
    resources.set(resource, entry);
    observe?.(() => {
      entry.done = true;
    });
  };
  const dispose = () => {
    state = 'disposed';
    disposed.abort();
    let failed = false,
      first: unknown;
    const attempt = (work: () => void) => {
      try {
        work();
      } catch (error) {
        if (!failed) first = error;
        failed = true;
      }
    };
    for (const mesh of meshes)
      if (!mesh.isDisposed()) {
        attempt(() => mesh.setEnabled(false));
        attempt(() => scene.removeMesh(mesh));
      }
    for (const entry of resources.values()) {
      if (entry.done || entry.attempted || entry.isDisposed?.()) continue;
      entry.attempted = true;
      attempt(() => {
        entry.release();
        entry.done = true;
      });
    }
    if (failed) throw first;
  };
  const cleanupAfter = (error: unknown): never => {
    try {
      dispose();
    } catch (cleanupError) {
      // A reporter must never replace even a falsy primary failure.
      try {
        console.error('Grid paint cleanup failed', cleanupError);
      } catch {
        /* preserve primary */
      }
    }
    throw error;
  };
  try {
    await gpu.prepare('Original grid paint geometry upload', deadline, async (invalidated) => {
      invalidated.throwIfAborted();
      active();
      const originalMaterial = new T.MeshStandardMaterial({ color: 0xe9e7e0, roughness: 0.55 });
      const parent = new T.Group();
      try {
        installCircuitFinish(originalMaterial, 'paint');
        const original = new GridPaintPresentation(track, originalMaterial);
        original.build(parent);
        parent.updateMatrixWorld(true);
        if (
          original.diagnostics().mode !== 'original' ||
          original.diagnostics().slots !== 12 ||
          original.root.children.length !== 1
        )
          throw new Error('Original Formula grid layout changed');
        material = constructGridMaterial(scene);
        const ownedMaterial = material;
        remember(
          material,
          () => ownedMaterial.dispose(),
          undefined,
          (done) => ownedMaterial.onDisposeObservable.addOnce(done),
        );
        scene.removeMaterial(material);
        material.albedoColor = new Color3(...originalMaterial.color.toArray());
        material.roughness = originalMaterial.roughness;
        material.metallic = originalMaterial.metalness;
        material.backFaceCulling = true;
        material.twoSidedLighting = false;
        new CircuitPaintFinishPlugin(material);
        // GridPaintPresentation already batches its layer. CircuitScene excludes
        // this root from parent batching: preserve these buffers AND world pose.
        original.root.traverseVisible((source) => {
          if (!(source instanceof T.Mesh)) return;
          invalidated.throwIfAborted();
          active();
          if (
            !(source.geometry instanceof T.BufferGeometry) ||
            source.material !== originalMaterial
          )
            throw new Error('Original grid batch contract changed');
          const mesh = constructGridMesh(scene);
          meshes.push(mesh);
          remember(
            mesh,
            () => mesh.dispose(true, false),
            () => mesh.isDisposed(),
            (done) => mesh.onDisposeObservable.addOnce(done),
          );
          scene.removeMesh(mesh);
          mesh.sideOrientation = Material.CounterClockWiseSideOrientation;
          mesh.material = ownedMaterial;
          mesh.isVisible = source.visible;
          try {
            legacyVertexData(source.geometry).applyToMesh(mesh);
          } finally {
            if (mesh.geometry) {
              const geometry = mesh.geometry;
              remember(
                geometry,
                () => geometry.dispose(),
                () => geometry.isDisposed(),
              );
              scene.removeGeometry(geometry);
            }
          }
          mesh.freezeWorldMatrix(Matrix.FromArray(source.matrixWorld.elements));
        });
        if (
          !meshes.length ||
          meshes.reduce((sum, mesh) => sum + mesh.getTotalIndices(), 0) !== 432 * 3
        )
          throw new Error('Original Formula grid triangle contract changed');
      } finally {
        const geometries = new Set<T.BufferGeometry>();
        parent.traverse((source) => {
          if (source instanceof T.Mesh) geometries.add(source.geometry);
        });
        for (const geometry of geometries) geometry.dispose();
        originalMaterial.dispose();
      }
    });
    active();
    if (!material || !meshes.length) throw new Error('Original grid construction incomplete');
    await (dependencies.prepare ?? prepareOriginalMaterials)(
      { scene, meshes },
      gpu,
      signal,
      deadline,
      () => {},
    );
    active();
    const ownedMaterial = material;
    return {
      diagnostics() {
        const live = meshes.filter(
          (mesh) =>
            !scene.isDisposed &&
            !mesh.isDisposed() &&
            scene.meshes.includes(mesh) &&
            mesh.isEnabled() &&
            mesh.isVisible,
        );
        return {
          state,
          meshes: [...meshes],
          material: ownedMaterial,
          slots: 12,
          boxes: 36,
          triangles: 432,
          stagedParts:
            state === 'prepared' && !scene.isDisposed
              ? meshes.filter((mesh) => !mesh.isDisposed() && !scene.meshes.includes(mesh)).length
              : 0,
          activeParts: live.length,
          activeMaterials:
            live.some((mesh) => mesh.material === ownedMaterial) &&
            scene.materials.includes(ownedMaterial)
              ? 1
              : 0,
          dryOnly: true,
          gpSwitchingParity: false,
          weatherParity: false,
          shadowParity: false,
        };
      },
      async install() {
        if (state !== 'prepared')
          throw new Error('Grid paint cannot install twice or after disposal');
        try {
          active();
        } catch (error) {
          cleanupAfter(error);
        }
        state = 'installing';
        const finish = schedule.prepare(),
          budget = new AbortController();
        const timer = setTimeout(
          () => budget.abort(new Error('Grid paint presentation deadline exceeded')),
          Math.max(0, deadline - performance.now()),
        );
        try {
          scene.addMaterial(ownedMaterial);
          for (const mesh of meshes) {
            if (mesh.geometry) scene.addGeometry(mesh.geometry);
            scene.addMesh(mesh);
          }
          active();
          schedule.request();
          await (dependencies.present ?? waitForPresentation)(
            scene,
            AbortSignal.any([signal, disposed.signal, budget.signal]),
            gpu,
          );
          active();
          if (state !== 'installing') throw new Error('Grid paint installation invalidated');
          state = 'ready';
        } catch (error) {
          cleanupAfter(error);
        } finally {
          clearTimeout(timer);
          finish();
        }
      },
      dispose,
    };
  } catch (error) {
    return cleanupAfter(error);
  }
}
