import * as T from 'three';
import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { AUREL } from '../../simulation/circuits.ts';
import { H } from '../../simulation/protocol.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import type { CircuitPresentationContext } from './circuit-scene.ts';
import { legacyVertexData } from './legacy-geometry.ts';
import { prepareOriginalMaterials } from './asset-preparation.ts';
import { waitForPresentation } from './presentation-ready.ts';
import type { BabylonPresentationGpu } from './presentation-gpu.ts';
import type { PresentationSchedule } from './presentation-schedule.ts';

export function startLampsEligible(track: Track, context?: CircuitPresentationContext) {
  return (
    track.circuit === AUREL &&
    context?.presentation === 'circuit' &&
    Array.isArray(context.vehicles) &&
    context.vehicles.length > 0 &&
    context.vehicles.every((v) => v?.classId === 'formula' && v.dynamicsKind === 'four-wheel')
  );
}
export interface BabylonStartLampsOptions {
  scene: Scene;
  track: Track;
  context: CircuitPresentationContext;
  signal: AbortSignal;
  gpu: BabylonPresentationGpu;
  deadline: number;
  isCurrent(): boolean;
  schedule: PresentationSchedule;
}
export interface StartLampsDependencies {
  prepare?: typeof prepareOriginalMaterials;
  present?: typeof waitForPresentation;
}
/** Original circuit.ts:957–972,1011–1012 signal component only. No timer,
 * simulation/audio authority, point lights, banner, shadows or bloom port.
 * Geometry remains the original Three CPU component; Babylon owns rendering.
 * This owner never owns or modifies the independent A07 structural container. */
export async function createBabylonStartLamps(
  options: BabylonStartLampsOptions,
  dependencies: StartLampsDependencies = {},
) {
  const { scene, track, signal, gpu, deadline, schedule } = options;
  const active = (preparing = true) => {
    signal.throwIfAborted();
    if (scene.isDisposed || !scene.useRightHandedSystem || !options.isCurrent())
      throw new DOMException('Start lamp scene ownership changed', 'AbortError');
    if (!startLampsEligible(track, options.context))
      throw new Error('Start lamps require original Aurel Formula context');
    if (preparing && (!Number.isFinite(deadline) || performance.now() >= deadline))
      throw new Error('Start lamp preparation deadline exceeded');
  };
  active();
  const parts: { index: number; mesh: Mesh; material: PBRMaterial }[] = [];
  let root: TransformNode | undefined;
  let state: 'prepared' | 'installing' | 'ready' | 'disposed' = 'prepared';
  const disposed = new AbortController();
  const resources = new Map<
    object,
    { done: boolean; attempted: boolean; release(): void; isDisposed?: () => boolean }
  >();
  const remember = (
    resource: object,
    release: () => void,
    isDisposed?: () => boolean,
    observe?: (done: () => void) => void,
  ) => {
    if (resources.has(resource)) return;
    const entry = { done: false, attempted: false, release, isDisposed };
    resources.set(resource, entry);
    observe?.(() => {
      entry.done = true;
    });
  };
  // Keep complete partial-construction ownership, not only successfully bound parts.
  const meshes: Mesh[] = [];
  const materials: PBRMaterial[] = [];
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
      console.error('Start lamp cleanup failed', cleanupError);
    }
    throw error;
  };
  const setLights = (count: number) => {
    for (const part of parts) {
      const intensity = part.index < count ? 25 : 0;
      if (part.material.emissiveIntensity !== intensity)
        part.material.emissiveIntensity = intensity;
    }
  };
  try {
    await gpu.prepare('Original start lamp geometry upload', deadline, async (invalidated) => {
      try {
        invalidated.throwIfAborted();
        // Ordinary owner cancellation while waiting for the lease is not a GPU
        // failure. Return normally, drain its fence, then reject outside the lane.
        if (signal.aborted || scene.isDisposed || !options.isCurrent()) return;
        const p = track.at(0, trackPoint()),
          originalRoot = new T.Group();
        originalRoot.position.set(p.x, p.y, p.z);
        originalRoot.rotation.y = Math.atan2(p.tx, p.tz);
        originalRoot.updateMatrixWorld(true);
        root = new TransformNode('Original five start lamps', scene);
        remember(
          root,
          () => root!.dispose(true),
          () => root!.isDisposed(),
          (done) => root!.onDisposeObservable.addOnce(done),
        );
        scene.removeTransformNode(root);
        root.position.set(p.x, p.y, p.z);
        root.rotation.y = originalRoot.rotation.y;
        for (let index = 0; index < 5; index++) {
          const geometry = new T.CylinderGeometry(0.16, 0.16, 0.08, 20);
          const originalMaterial = new T.MeshStandardMaterial({
            color: 0x1a0e0c,
            emissive: 0xff210c,
            emissiveIntensity: 0,
          });
          try {
            const source = new T.Mesh(geometry, originalMaterial);
            source.position.set((index - 2) * 0.45, 4.95, -0.3);
            source.rotation.x = Math.PI / 2;
            originalRoot.add(source);
            source.updateWorldMatrix(true, false);
            const mesh = new Mesh(`original-start-lamp-${index}`, scene);
            // Original Three indices are outward CCW; RH Babylon defaults to CW.
            // Preserve FrontSide under this positive-determinant rigid placement.
            mesh.sideOrientation = Material.CounterClockWiseSideOrientation;
            meshes.push(mesh);
            remember(
              mesh,
              () => mesh.dispose(true, false),
              () => mesh.isDisposed(),
              (done) => mesh.onDisposeObservable.addOnce(done),
            );
            scene.removeMesh(mesh);
            const material = new PBRMaterial(`original-start-lamp-material-${index}`, scene);
            materials.push(material);
            remember(
              material,
              () => material.dispose(),
              undefined,
              (done) => material.onDisposeObservable.addOnce(done),
            );
            scene.removeMaterial(material);
            material.albedoColor = new Color3(...originalMaterial.color.toArray());
            material.emissiveColor = new Color3(...originalMaterial.emissive.toArray());
            material.emissiveIntensity = originalMaterial.emissiveIntensity;
            material.roughness = originalMaterial.roughness;
            material.metallic = originalMaterial.metalness;
            material.backFaceCulling = true;
            mesh.material = material;
            try {
              legacyVertexData(geometry).applyToMesh(mesh);
            } finally {
              if (mesh.geometry) {
                const owned = mesh.geometry;
                remember(
                  owned,
                  () => owned.dispose(),
                  () => owned.isDisposed(),
                );
                scene.removeGeometry(owned);
              }
            }
            mesh.parent = root;
            mesh.position.set(source.position.x, source.position.y, source.position.z);
            mesh.rotation.set(source.rotation.x, source.rotation.y, source.rotation.z);
            // The static world transform is the exact Float32 form Three sends
            // to its GPU, not a separately rounded parent/local multiplication.
            mesh.freezeWorldMatrix(Matrix.FromArray(source.matrixWorld.elements));
            parts.push({ index, mesh, material });
          } finally {
            geometry.dispose();
            originalMaterial.dispose();
          }
        }
      } catch (error) {
        cleanupAfter(error);
      }
    });
    active();
    if (parts.length !== 5) throw new Error('Original five-lamp construction incomplete');
    // Emission is a uniform, but qualify both original endpoint states before
    // publication. Snapshot updates do not explicitly compile or toggle features.
    // Babylon marks intensity changes dirty; real-GPU qualification must verify
    // effect/program reuse across state changes, not infer it from CPU setters.
    for (const count of [0, 5]) {
      setLights(count);
      await (dependencies.prepare ?? prepareOriginalMaterials)(
        { scene, meshes },
        gpu,
        signal,
        deadline,
        () => {},
      );
      active();
    }
    setLights(0);
    return {
      diagnostics() {
        const live = parts.filter((p) => !p.mesh.isDisposed() && !scene.isDisposed);
        const visible = live.filter((p) => scene.meshes.includes(p.mesh) && p.mesh.isEnabled());
        return {
          state,
          lampCount: 5,
          parts: [...parts],
          stagedParts:
            state === 'prepared' ? live.filter((p) => !scene.meshes.includes(p.mesh)).length : 0,
          activeParts: visible.length,
          activeMaterials: new Set(
            visible.map((p) => p.mesh.material).filter((m) => m && scene.materials.includes(m)),
          ).size,
          banner: false,
          shadowParity: false,
          bloomParity: false,
        };
      },
      apply(frame: Float32Array) {
        if (state === 'disposed') throw new Error('Start lamps disposed');
        active(false);
        const count = frame[H.LIGHTS];
        if (!Number.isFinite(count) || count < 0 || count > 5)
          throw new Error('Invalid original start-light snapshot');
        setLights(count);
      },
      async install() {
        if (state !== 'prepared')
          throw new Error('Start lamps cannot install twice or after disposal');
        try {
          active();
        } catch (error) {
          cleanupAfter(error);
        }
        state = 'installing';
        const finish = schedule.prepare(),
          budget = new AbortController();
        const timer = setTimeout(
          () => budget.abort(new Error('Start lamp presentation deadline exceeded')),
          Math.max(0, deadline - performance.now()),
        );
        const waitSignal = AbortSignal.any([signal, disposed.signal, budget.signal]);
        try {
          scene.addTransformNode(root!);
          for (const material of materials) scene.addMaterial(material);
          for (const mesh of meshes) {
            if (mesh.geometry) scene.addGeometry(mesh.geometry);
            scene.addMesh(mesh);
          }
          active();
          schedule.request();
          await (dependencies.present ?? waitForPresentation)(scene, waitSignal, gpu);
          active();
          if (state !== 'installing') throw new Error('Start lamp installation invalidated');
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
