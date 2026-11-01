import * as T from 'three';
import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { AUREL } from '../../simulation/circuits.ts';
import { trackPoint, type Track } from '../../simulation/track.ts';
import { batchScene, canvasTexture, mesh as originalMesh } from '../../rendering/geometry.ts';
import type { CircuitPresentationContext } from './circuit-scene.ts';
import { legacyVertexData } from './legacy-geometry.ts';
import { prepareOriginalMaterials } from './asset-preparation.ts';
import { waitForPresentation } from './presentation-ready.ts';
import type { BabylonPresentationGpu } from './presentation-gpu.ts';
import type { PresentationSchedule } from './presentation-schedule.ts';

/** Reorder opaque source rows only: never draw, recolor or premultiply artwork. */
export function reverseOpaqueStripeRows(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  if (
    !(data instanceof Uint8Array || data instanceof Uint8ClampedArray) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 128 ||
    height > 32 ||
    data.length !== width * height * 4
  )
    throw new Error('Invalid original stripe RGBA dimensions');
  for (let i = 3; i < data.length; i += 4)
    if (data[i] !== 255) throw new Error('Original stripe must be opaque');
  const result = new Uint8Array(data.length),
    stride = width * 4;
  for (let y = 0; y < height; y++)
    result.set(data.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
  return result;
}
export function startFinishStripeEligible(track: Track, context?: CircuitPresentationContext) {
  return (
    track.circuit === AUREL &&
    context?.presentation === 'circuit' &&
    Array.isArray(context.vehicles) &&
    context.vehicles.length > 0 &&
    context.vehicles.every((v) => v?.classId === 'formula' && v.dynamicsKind === 'four-wheel')
  );
}
export interface BabylonStartFinishStripeOptions {
  scene: Scene;
  track: Track;
  context: CircuitPresentationContext;
  signal: AbortSignal;
  gpu: BabylonPresentationGpu;
  deadline: number;
  isCurrent(): boolean;
  schedule: PresentationSchedule;
}
export interface StartFinishStripeDependencies {
  /** CPU test seam only: fake allocation metadata does not certify hardware. */
  allocateTexture?: (data: Uint8Array, width: number, height: number, scene: Scene) => RawTexture;
  prepare?: typeof prepareOriginalMaterials;
  present?: typeof waitForPresentation;
}
/** Original static finish stripe only. No live activation, grounding/weather
 * plugin, polygon offset, new lights or ownership of road/gantry resources. */
export async function createBabylonStartFinishStripe(
  options: BabylonStartFinishStripeOptions,
  dependencies: StartFinishStripeDependencies = {},
) {
  const { scene, track, signal, gpu, deadline, schedule } = options;
  const active = () => {
    signal.throwIfAborted();
    if (scene.isDisposed || !scene.useRightHandedSystem || !options.isCurrent())
      throw new DOMException('Stripe scene ownership changed', 'AbortError');
    if (!startFinishStripeEligible(track, options.context))
      throw new Error('Stripe requires original Aurel Formula context');
    if (!Number.isFinite(deadline) || performance.now() >= deadline)
      throw new Error('Stripe preparation deadline exceeded');
  };
  active();
  if (!scene.getEngine().getCaps().supportSRGBBuffers)
    throw new Error('Original stripe requires hardware sRGB support');
  let mesh: Mesh | undefined, material: PBRMaterial | undefined, texture: RawTexture | undefined;
  let sourceCanvas: HTMLCanvasElement | undefined;
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
  const dispose = () => {
    state = 'disposed';
    disposed.abort();
    // Drop our CPU canvas reference, but never resize/mutate an original canvas
    // borrowed by a same-canvas reference renderer. External borrows own theirs.
    sourceCanvas = undefined;
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
    if (mesh && !mesh.isDisposed()) {
      attempt(() => mesh!.setEnabled(false));
      attempt(() => scene.removeMesh(mesh!));
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
      console.error('Stripe cleanup failed', cleanupError);
    }
    throw error;
  };
  try {
    // Run the unchanged original canvas producer; do not redraw using Babylon.
    // Original circuit.ts grid() finish drawing, distinct from grid-box paint.
    const originalMap = canvasTexture(128, 32, (c) => {
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 16; x++) {
          c.fillStyle = (x + y) % 2 ? '#e8e5da' : '#242b29';
          c.fillRect(x * 8, y * 16, 8, 16);
        }
    });
    let pixels: Uint8Array;
    try {
      sourceCanvas = originalMap.image as HTMLCanvasElement;
      if (sourceCanvas.width !== 128 || sourceCanvas.height !== 32)
        throw new Error('Original stripe canvas size changed');
      const context = sourceCanvas.getContext('2d');
      if (!context) throw new Error('Original stripe Canvas 2D unavailable');
      const source = context.getImageData(0, 0, 128, 32);
      pixels = reverseOpaqueStripeRows(source.data, 128, 32);
    } finally {
      originalMap.dispose();
    }
    active();
    await gpu.prepare(
      'Original stripe texture and geometry upload',
      deadline,
      async (invalidated) => {
        try {
          invalidated.throwIfAborted();
          if (signal.aborted || scene.isDisposed || !options.isCurrent()) return;
          texture = (
            dependencies.allocateTexture ??
            ((data, width, height, target) =>
              RawTexture.CreateRGBATexture(
                data,
                width,
                height,
                target,
                true,
                false,
                Texture.TRILINEAR_SAMPLINGMODE,
                0,
                0,
                true,
              ))
          )(pixels, 128, 32, scene);
          remember(
            texture,
            () => texture!.dispose(),
            undefined,
            (done) => texture!.onDisposeObservable.addOnce(done),
          );
          scene.removeTexture(texture);
          if (texture.getScene() !== scene)
            throw new Error('Stripe texture belongs to a different scene');
          texture.name = 'Original Aurel stripe pixels';
          texture.gammaSpace = true;
          texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
          texture.anisotropicFilteringLevel = 8;
          const internal = texture.getInternalTexture();
          if (
            !internal ||
            internal._useSRGBBuffer !== true ||
            Boolean(texture.gammaSpace) ||
            !internal.generateMipMaps ||
            internal.samplingMode !== Texture.TRILINEAR_SAMPLINGMODE ||
            internal.invertY !== false ||
            internal.width !== 128 ||
            internal.height !== 32 ||
            internal.type !== 0 ||
            texture.format !== 5
          )
            throw new Error('Original stripe hardware sRGB/texture contract unavailable');
          const p = track.at(0, trackPoint()),
            originalMaterial = new T.MeshStandardMaterial({ roughness: 0.8 }),
            parent = new T.Group(),
            geometry = new T.PlaneGeometry(p.width * 2, 1.2);
          let baked: T.BufferGeometry | undefined;
          let originalGeometryDisposed = false;
          geometry.addEventListener('dispose', () => {
            originalGeometryDisposed = true;
          });
          try {
            const source = originalMesh(parent, geometry, originalMaterial);
            source.position.set(p.x, p.y + 0.015, p.z);
            source.rotation.set(-Math.PI / 2, 0, -Math.atan2(p.tx, p.tz));
            // CircuitScene batches this unique material after grid(): use the
            // unchanged original CPU batcher, including its Float32 rounding.
            batchScene(parent, new Set());
            const batch = parent.children[0];
            if (
              !(batch instanceof T.Mesh) ||
              !(batch.geometry instanceof T.BufferGeometry) ||
              parent.children.length !== 1
            )
              throw new Error('Original stripe batch contract changed');
            baked = batch.geometry;
            mesh = new Mesh('Original Aurel start-finish stripe', scene);
            remember(
              mesh,
              () => mesh!.dispose(true, false),
              () => mesh!.isDisposed(),
              (done) => mesh!.onDisposeObservable.addOnce(done),
            );
            scene.removeMesh(mesh);
            // Original FrontSide triangles are CCW; RH Babylon defaults CW.
            mesh.sideOrientation = Material.CounterClockWiseSideOrientation;
            material = new PBRMaterial('Original checkered start-finish stripe', scene);
            remember(
              material,
              () => material!.dispose(),
              undefined,
              (done) => material!.onDisposeObservable.addOnce(done),
            );
            scene.removeMaterial(material);
            material.albedoColor = new Color3(...originalMaterial.color.toArray());
            material.roughness = originalMaterial.roughness;
            material.metallic = originalMaterial.metalness;
            material.backFaceCulling = true;
            material.twoSidedLighting = false;
            material.albedoTexture = texture;
            mesh.material = material;
            try {
              legacyVertexData(baked).applyToMesh(mesh);
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
            // Original post-batch geometry is already in world coordinates.
            mesh.freezeWorldMatrix(Matrix.FromArray(batch.matrixWorld.elements));
          } finally {
            baked?.dispose();
            if (!originalGeometryDisposed) geometry.dispose();
            originalMaterial.dispose();
          }
        } catch (error) {
          cleanupAfter(error);
        }
      },
    );
    active();
    if (!mesh || !material || !texture) throw new Error('Original stripe construction incomplete');
    await (dependencies.prepare ?? prepareOriginalMaterials)(
      { scene, meshes: [mesh] },
      gpu,
      signal,
      deadline,
      () => {},
    );
    active();
    const ownedMesh = mesh,
      ownedMaterial = material,
      ownedTexture = texture;
    return {
      diagnostics() {
        const visible =
          !scene.isDisposed &&
          !ownedMesh.isDisposed() &&
          scene.meshes.includes(ownedMesh) &&
          ownedMesh.isEnabled();
        return {
          state,
          mesh: ownedMesh,
          material: ownedMaterial,
          texture: ownedTexture,
          sourceCanvas,
          stagedParts:
            state === 'prepared' &&
            !ownedMesh.isDisposed() &&
            !scene.isDisposed &&
            !scene.meshes.includes(ownedMesh)
              ? 1
              : 0,
          activeParts: visible ? 1 : 0,
          activeMaterials:
            visible &&
            ownedMesh.material === ownedMaterial &&
            scene.materials.includes(ownedMaterial)
              ? 1
              : 0,
          activeTextures:
            visible &&
            ownedMesh.material === ownedMaterial &&
            scene.materials.includes(ownedMaterial) &&
            ownedMaterial.albedoTexture === ownedTexture &&
            scene.textures.includes(ownedTexture)
              ? 1
              : 0,
          hardwareSrgb: ownedTexture.getInternalTexture()?._useSRGBBuffer === true,
          shadowParity: false,
          bloomParity: false,
        };
      },
      async install() {
        if (state !== 'prepared') throw new Error('Stripe cannot install twice or after disposal');
        try {
          active();
        } catch (error) {
          cleanupAfter(error);
        }
        state = 'installing';
        const finish = schedule.prepare(),
          budget = new AbortController();
        const timer = setTimeout(
          () => budget.abort(new Error('Stripe presentation deadline exceeded')),
          Math.max(0, deadline - performance.now()),
        );
        try {
          scene.addTexture(ownedTexture);
          scene.addMaterial(ownedMaterial);
          if (ownedMesh.geometry) scene.addGeometry(ownedMesh.geometry);
          scene.addMesh(ownedMesh);
          active();
          schedule.request();
          await (dependencies.present ?? waitForPresentation)(
            scene,
            AbortSignal.any([signal, disposed.signal, budget.signal]),
            gpu,
          );
          active();
          if (state !== 'installing') throw new Error('Stripe installation invalidated');
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
