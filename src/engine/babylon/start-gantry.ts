import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { AUREL } from '../../simulation/circuits.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import {
  START_GANTRY,
  startGantryDocument,
  decodeStartGantry,
  conformStartGantryGeometry,
} from '../../rendering/start-gantry.ts';
import { legacyVertexData } from './legacy-geometry.ts';
import { prepareOriginalMaterials } from './asset-preparation.ts';
import { waitForPresentation } from './presentation-ready.ts';
import type { BabylonPresentationGpu } from './presentation-gpu.ts';
import type { PresentationSchedule } from './presentation-schedule.ts';
import type { CircuitPresentationContext } from './circuit-scene.ts';

export function startGantryEligible(track: Track, context?: CircuitPresentationContext) {
  return (
    track.circuit === AUREL &&
    context?.presentation === 'circuit' &&
    Array.isArray(context.vehicles) &&
    context.vehicles.length > 0 &&
    context.vehicles.every((v) => v?.classId === 'formula' && v.dynamicsKind === 'four-wheel')
  );
}
export async function validateStartGantryBytes(raw: Uint8Array<ArrayBuffer>, signal: AbortSignal) {
  signal.throwIfAborted();
  startGantryDocument(raw);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  signal.throwIfAborted();
  if (hash !== START_GANTRY.sha256) throw new Error('A07 integrity mismatch');
}
export interface BabylonStartGantryOptions {
  scene: Scene;
  track: Track;
  context: CircuitPresentationContext;
  base: string;
  signal: AbortSignal;
  gpu: BabylonPresentationGpu;
  deadline: number;
  isCurrent(): boolean;
  schedule: PresentationSchedule;
}
export interface StartGantryDependencies {
  fetcher?: typeof fetch;
  decode?: (raw: Uint8Array<ArrayBuffer>, scene: Scene) => Promise<AssetContainer>;
  prepare?: typeof prepareOriginalMaterials;
  present?: typeof waitForPresentation;
}
/** A07 structure only: no banner/lamps, weather hooks, shadows or LOD selection.
 * All native imported resources retain one container owner. Only LOD0 is drawn.
 * Test seams do not establish native image decoding or GPU presentation parity. */
export async function loadBabylonStartGantry(
  options: BabylonStartGantryOptions,
  dependencies: StartGantryDependencies = {},
) {
  const { scene, track, signal, deadline, gpu, schedule } = options;
  const active = () => {
    signal.throwIfAborted();
    if (scene.isDisposed || !scene.useRightHandedSystem || !options.isCurrent())
      throw new DOMException('A07 scene ownership changed', 'AbortError');
    if (!startGantryEligible(track, options.context))
      throw new Error('A07 requires original Aurel Formula context');
    if (performance.now() >= deadline) throw new Error('A07 preparation deadline exceeded');
  };
  active();
  const response = await (dependencies.fetcher ?? fetch)(
    new URL(`models/aurel-start-gantry.glb?v=${START_GANTRY.sha256.slice(0, 16)}`, options.base),
    {
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now()))),
      ]),
    },
  );
  if (!response.ok || !response.body) throw new Error(`A07 request failed: ${response.status}`);
  const reader = response.body.getReader(),
    raw = new Uint8Array(START_GANTRY.bytes);
  let size = 0;
  let readFailed = false;
  let streamCleanupError: unknown;
  let streamCleanupFailed = false;
  try {
    while (true) {
      active();
      const { done, value } = await reader.read();
      active();
      if (done) break;
      if (size + value.length > raw.length) throw new Error('A07 download exceeds byte budget');
      raw.set(value, size);
      size += value.length;
    }
  } catch (error) {
    readFailed = true;
    throw error;
  } finally {
    const retainCleanup = (error: unknown) => {
      if (!readFailed && !streamCleanupFailed) {
        streamCleanupFailed = true;
        streamCleanupError = error;
      } else console.error('A07 stream cleanup failed', error);
    };
    try {
      await reader.cancel();
    } catch (error) {
      retainCleanup(error);
    }
    try {
      reader.releaseLock();
    } catch (error) {
      retainCleanup(error);
    }
  }
  if (streamCleanupFailed) throw streamCleanupError;
  if (size !== raw.length) throw new Error('Truncated A07 download');
  await validateStartGantryBytes(raw, signal);
  active();
  let container: AssetContainer | undefined;
  let placement: TransformNode | undefined;
  let state: 'prepared' | 'installing' | 'ready' | 'disposed' = 'prepared';
  let preparing = true;
  const disposed = new AbortController();
  const parts: { name: string; mesh: Mesh; material: PBRMaterial }[] = [];
  // Public disposal receipts survive Scene callback short-circuiting. A scene's
  // disposed flag is not evidence that any off-scene resource was reclaimed.
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
  const capture = (owner: AssetContainer) => {
    for (const mesh of owner.meshes)
      remember(
        mesh,
        () => mesh.dispose(true, false),
        () => mesh.isDisposed(),
        (done) => mesh.onDisposeObservable.addOnce(done),
      );
    for (const node of owner.transformNodes)
      remember(
        node,
        () => node.dispose(true),
        () => node.isDisposed(),
        (done) => node.onDisposeObservable.addOnce(done),
      );
    for (const geometry of owner.geometries)
      remember(
        geometry,
        () => geometry.dispose(),
        () => geometry.isDisposed(),
      );
    for (const material of owner.materials)
      remember(
        material,
        () => material.dispose(),
        undefined,
        (done) => material.onDisposeObservable.addOnce(done),
      );
    for (const texture of owner.textures)
      remember(
        texture,
        () => texture.dispose(),
        undefined,
        (done) => texture.onDisposeObservable.addOnce(done),
      );
  };
  let containerTornDown = false;
  const dispose = () => {
    state = 'disposed';
    disposed.abort();
    let first: unknown,
      failed = false;
    const attempt = (release: () => void) => {
      try {
        release();
      } catch (error) {
        if (!failed) first = error;
        failed = true;
      }
    };
    // Detach even a resource whose own disposer will throw; never leave a
    // half-cleaned candidate visible. Each removal is independently guarded.
    for (const mesh of container?.meshes ?? []) {
      if (mesh.isDisposed()) continue;
      attempt(() => mesh.setEnabled(false));
      attempt(() => container!.scene.removeMesh(mesh));
    }
    // Drain independently: an exceptional mesh/material/texture cannot prevent
    // other resources from releasing. Never recurse through already-owned nodes.
    for (const entry of resources.values()) {
      if (entry.done || entry.attempted || entry.isDisposed?.()) continue;
      entry.attempted = true;
      attempt(() => {
        entry.release();
        entry.done = true;
      });
    }
    if (container && !containerTornDown) {
      containerTornDown = true;
      // These exact-hash A07 collections were drained above. Container teardown
      // still removes its public scene/context observers, but must not double
      // release resources or stop again at an already-reported resource failure.
      for (const values of [
        container.meshes,
        container.transformNodes,
        container.geometries,
        container.materials,
        container.textures,
      ])
        values.length = 0;
      container.rootNodes.length = 0;
      attempt(() => container!.dispose());
    }
    if (failed) throw first;
  };
  try {
    await gpu.prepare(
      'A07 native decode and original geometry upload',
      deadline,
      async (invalidated) => {
        try {
          container = await (
            dependencies.decode ??
            ((bytes, target) => LoadAssetContainerAsync(bytes, target, { pluginExtension: '.glb' }))
          )(raw, scene);
          capture(container);
          invalidated.throwIfAborted();
          if (container.scene !== scene) throw new Error('A07 decoder returned a different scene');
          // Reuse the untouched production Three matrix baking and conformation.
          // CPU-only dummy textures are never presented or transferred to Babylon.
          const cpuLoader = new GLTFLoader().register(() => ({
            name: 'A07_CPU_geometry_only',
            loadTexture: () =>
              Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
          }));
          const original = await decodeStartGantry(raw, cpuLoader);
          try {
            invalidated.throwIfAborted();
            const p = track.at(0, trackPoint()),
              parent = new T.Group();
            parent.position.set(p.x, p.y, p.z);
            parent.rotation.y = Math.atan2(p.tx, p.tz);
            parent.updateMatrixWorld(true);
            placement = new TransformNode('A07 original start station', scene);
            // Keep the placement owner off-scene alongside its container.
            scene.removeTransformNode(placement);
            container.transformNodes.push(placement);
            capture(container);
            placement.position.set(p.x, p.y, p.z);
            placement.rotation.y = parent.rotation.y;
            const rootNodes = [...container.rootNodes];
            for (const root of rootNodes) root.parent = placement;
            container.rootNodes = [placement];
            const templates = original.templates.get('portal:0')!;
            const materialSet = new Set<PBRMaterial>();
            for (const template of templates) {
              const matches = container.meshes.filter((mesh) => mesh.name === template.name);
              if (matches.length !== 1 || !(matches[0] instanceof Mesh))
                throw new Error('A07 original part binding mismatch');
              const mesh = matches[0];
              if (!(mesh.material instanceof PBRMaterial))
                throw new Error('A07 native PBR material required');
              materialSet.add(mesh.material);
              const geometry = conformStartGantryGeometry(
                template.geometry,
                track,
                parent.matrixWorld,
              );
              try {
                legacyVertexData(geometry).applyToMesh(mesh);
              } finally {
                geometry.dispose();
              }
              // Template already bakes source world transforms. Parent rigid placement
              // alone must act on those buffers (no doubled source transform).
              mesh.parent = placement;
              mesh.position.setAll(0);
              mesh.rotation.setAll(0);
              mesh.rotationQuaternion = null;
              mesh.scaling.setAll(1);
              mesh.setEnabled(true);
              parts.push({ name: template.name, mesh, material: mesh.material });
            }
            if (parts.length !== 4 || materialSet.size !== 1)
              throw new Error('A07 four-part single-material contract');
            const material = parts[0].material;
            if (
              material.name !== 'A07_original_PBR_surface_atlas' ||
              !material.albedoTexture ||
              !material.bumpTexture ||
              !material.metallicTexture ||
              material.ambientTexture ||
              material.backFaceCulling ||
              new Set([material.albedoTexture, material.bumpTexture, material.metallicTexture])
                .size !== 3
            )
              throw new Error('A07 original material/three-texture contract');
            for (const mesh of container.meshes)
              if (mesh.getTotalVertices() > 0 && !parts.some((part) => part.mesh === mesh))
                mesh.setEnabled(false);
          } finally {
            original.dispose();
          }
        } catch (error) {
          // A fatal lease invalidation can finish the outer await before a native
          // decoder resolves. Late acquired ownership must still be drained here.
          try {
            dispose();
          } catch (cleanupError) {
            console.error('A07 cleanup failed', cleanupError);
          }
          throw error;
        }
      },
    );
    active();
    await (dependencies.prepare ?? prepareOriginalMaterials)(
      { scene, meshes: parts.map((p) => p.mesh) },
      gpu,
      signal,
      deadline,
      () => {},
    );
    preparing = false;
    active();
    const owned = container!;
    return {
      diagnostics() {
        const live = parts.filter((p) => !p.mesh.isDisposed() && !scene.isDisposed);
        const activeParts = live.filter((p) => scene.meshes.includes(p.mesh) && p.mesh.isEnabled());
        const activeMaterials = [...new Set(activeParts.map((p) => p.mesh.material))].filter(
          (m): m is PBRMaterial => m instanceof PBRMaterial && scene.materials.includes(m),
        );
        return {
          stagedParts:
            state === 'prepared' ? live.filter((p) => !scene.meshes.includes(p.mesh)).length : 0,
          activeParts: activeParts.length,
          activeMaterials: activeMaterials.length,
          activeTextures: new Set(
            activeMaterials
              .flatMap((m) => m.getActiveTextures())
              .filter((t) => scene.textures.includes(t)),
          ).size,
          state,
          sha256: START_GANTRY.sha256,
          assetId: 'A07',
          parts: [...parts],
          retainedMaterials: new Set(
            parts.filter((p) => !p.mesh.isDisposed()).map((p) => p.mesh.material),
          ).size,
          retainedTextures: new Set(
            parts
              .filter((p) => !p.mesh.isDisposed())
              .flatMap((p) => p.material.getActiveTextures()),
          ).size,
          retainedTriangles: parts
            .filter((p) => !p.mesh.isDisposed())
            .reduce((n, p) => n + p.mesh.getTotalIndices() / 3, 0),
          lod: 0,
          retainedMeshes: owned.meshes.length,
          banner: false,
          lamps: false,
          weather: false,
          lodSelection: false,
        };
      },
      async install() {
        if (state !== 'prepared' || preparing)
          throw new Error('A07 cannot install twice or after disposal');
        try {
          active();
        } catch (error) {
          try {
            dispose();
          } catch (cleanupError) {
            console.error('A07 cleanup failed', cleanupError);
          }
          throw error;
        }
        state = 'installing';
        const finish = schedule.prepare();
        const timerController = new AbortController();
        const timer = setTimeout(
          () => timerController.abort(new Error('A07 presentation deadline exceeded')),
          Math.max(0, deadline - performance.now()),
        );
        const waitSignal = AbortSignal.any([signal, disposed.signal, timerController.signal]);
        try {
          owned.addAllToScene();
          active();
          schedule.request();
          await (dependencies.present ?? waitForPresentation)(scene, waitSignal, gpu);
          active();
          if (state !== 'installing') throw new Error('A07 installation invalidated');
          state = 'ready';
        } catch (error) {
          try {
            dispose();
          } catch (cleanupError) {
            console.error('A07 cleanup failed', cleanupError);
          }
          throw error;
        } finally {
          clearTimeout(timer);
          finish();
        }
      },
      dispose,
    };
  } catch (error) {
    try {
      dispose();
    } catch (cleanupError) {
      console.error('A07 cleanup failed', cleanupError);
    }
    throw error;
  }
}
