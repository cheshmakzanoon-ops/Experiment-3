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
import { label } from '../../rendering/geometry.ts';
import { venuePlan } from '../../rendering/venue-plan.ts';
import type { CircuitPresentationContext } from './circuit-scene.ts';
import { legacyVertexData } from './legacy-geometry.ts';
import { prepareOriginalMaterials } from './asset-preparation.ts';
import { waitForPresentation } from './presentation-ready.ts';
import type { BabylonPresentationGpu } from './presentation-gpu.ts';
import type { PresentationSchedule } from './presentation-schedule.ts';
import { OriginalBannerBackingPlugin } from './start-banner-material.ts';

/** Reorder opaque source rows only: never draw, recolor or premultiply artwork. */
export function reverseOpaqueBannerRows(
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
    width > 512 ||
    height > 128 ||
    data.length !== width * height * 4
  )
    throw new Error('Invalid original banner RGBA dimensions');
  for (let i = 3; i < data.length; i += 4)
    if (data[i] !== 255) throw new Error('Original banner must be opaque');
  const result = new Uint8Array(data.length),
    stride = width * 4;
  for (let y = 0; y < height; y++)
    result.set(data.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
  return result;
}
export function startBannerEligible(track: Track, context?: CircuitPresentationContext) {
  return (
    track.circuit === AUREL &&
    context?.presentation === 'circuit' &&
    Array.isArray(context.vehicles) &&
    context.vehicles.length > 0 &&
    context.vehicles.every((v) => v?.classId === 'formula' && v.dynamicsKind === 'four-wheel')
  );
}
export interface BabylonStartBannerOptions {
  scene: Scene;
  track: Track;
  context: CircuitPresentationContext;
  signal: AbortSignal;
  gpu: BabylonPresentationGpu;
  deadline: number;
  isCurrent(): boolean;
  schedule: PresentationSchedule;
}
export interface StartBannerDependencies {
  /** CPU test seam only: fake allocation metadata does not certify hardware. */
  allocateTexture?: (data: Uint8Array, width: number, height: number, scene: Scene) => RawTexture;
  prepare?: typeof prepareOriginalMaterials;
  present?: typeof waitForPresentation;
}
/** Original static banner only. No live activation, font substitute, global
 * gamma/lighting changes, shadow/bloom parity or ownership of lamps/structure. */
export async function createBabylonStartBanner(
  options: BabylonStartBannerOptions,
  dependencies: StartBannerDependencies = {},
) {
  const { scene, track, signal, gpu, deadline, schedule } = options;
  const active = () => {
    signal.throwIfAborted();
    if (scene.isDisposed || !scene.useRightHandedSystem || !options.isCurrent())
      throw new DOMException('Banner scene ownership changed', 'AbortError');
    if (!startBannerEligible(track, options.context))
      throw new Error('Banner requires original Aurel Formula context');
    if (!Number.isFinite(deadline) || performance.now() >= deadline)
      throw new Error('Banner preparation deadline exceeded');
  };
  active();
  if (!scene.getEngine().getCaps().supportSRGBBuffers)
    throw new Error('Original banner requires hardware sRGB support');
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
      console.error('Banner cleanup failed', cleanupError);
    }
    throw error;
  };
  try {
    // Run the unchanged original canvas producer; do not redraw using Babylon.
    const originalMap = label(venuePlan(track).gantryLabel);
    let pixels: Uint8Array;
    try {
      sourceCanvas = originalMap.image as HTMLCanvasElement;
      if (sourceCanvas.width !== 512 || sourceCanvas.height !== 128)
        throw new Error('Original banner canvas size changed');
      const context = sourceCanvas.getContext('2d');
      if (!context) throw new Error('Original banner Canvas 2D unavailable');
      const source = context.getImageData(0, 0, 512, 128);
      pixels = reverseOpaqueBannerRows(source.data, 512, 128);
    } finally {
      originalMap.dispose();
    }
    active();
    await gpu.prepare(
      'Original banner texture and geometry upload',
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
          )(pixels, 512, 128, scene);
          remember(
            texture,
            () => texture!.dispose(),
            undefined,
            (done) => texture!.onDisposeObservable.addOnce(done),
          );
          scene.removeTexture(texture);
          if (texture.getScene() !== scene)
            throw new Error('Banner texture belongs to a different scene');
          texture.name = 'Original Aurel banner pixels';
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
            internal.width !== 512 ||
            internal.height !== 128 ||
            internal.type !== 0 ||
            texture.format !== 5
          )
            throw new Error('Original banner hardware sRGB/texture contract unavailable');
          const geometry = new T.PlaneGeometry(14, 1),
            originalMaterial = new T.MeshStandardMaterial({ side: T.DoubleSide });
          try {
            const p = track.at(0, trackPoint()),
              parent = new T.Group(),
              source = new T.Mesh(geometry, originalMaterial);
            parent.position.set(p.x, p.y, p.z);
            parent.rotation.y = Math.atan2(p.tx, p.tz);
            source.position.set(0, 6, -0.27);
            source.rotation.y = Math.PI;
            parent.add(source);
            source.updateWorldMatrix(true, false);
            mesh = new Mesh('Original Aurel gantry banner', scene);
            remember(
              mesh,
              () => mesh!.dispose(true, false),
              () => mesh!.isDisposed(),
              (done) => mesh!.onDisposeObservable.addOnce(done),
            );
            scene.removeMesh(mesh);
            // Retained Three triangles are CCW. Babylon's RH Mesh default is CW;
            // two-sided lighting still uses this winding for gl_FrontFacing, so
            // disabling culling alone would swap the print/back and normal signs.
            mesh.sideOrientation = Material.CounterClockWiseSideOrientation;
            material = new PBRMaterial('Original printed banner and plain backing', scene);
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
            material.backFaceCulling = false;
            material.twoSidedLighting = true;
            material.albedoTexture = texture;
            new OriginalBannerBackingPlugin(material);
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
            // No extra parent owner: frozen GPU world matrix is exact Float32 form
            // of original station * original local placement. Source local pose is
            // retained for diagnostics; it is not recomposed by a render loop.
            mesh.position.set(source.position.x, source.position.y, source.position.z);
            mesh.rotation.y = source.rotation.y;
            mesh.freezeWorldMatrix(Matrix.FromArray(source.matrixWorld.elements));
          } finally {
            geometry.dispose();
            originalMaterial.dispose();
          }
        } catch (error) {
          cleanupAfter(error);
        }
      },
    );
    active();
    if (!mesh || !material || !texture) throw new Error('Original banner construction incomplete');
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
        if (state !== 'prepared') throw new Error('Banner cannot install twice or after disposal');
        try {
          active();
        } catch (error) {
          cleanupAfter(error);
        }
        state = 'installing';
        const finish = schedule.prepare(),
          budget = new AbortController();
        const timer = setTimeout(
          () => budget.abort(new Error('Banner presentation deadline exceeded')),
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
          if (state !== 'installing') throw new Error('Banner installation invalidated');
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
