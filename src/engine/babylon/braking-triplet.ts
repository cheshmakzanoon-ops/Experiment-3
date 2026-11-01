import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader.js';
import '@babylonjs/loaders/glTF/index.js';
import type { AssetContainer } from '@babylonjs/core/assetContainer.js';
import type { Scene } from '@babylonjs/core/scene.js';
import { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Material } from '@babylonjs/core/Materials/material.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { AUREL } from '../../simulation/circuits.ts';
import { type Track } from '../../simulation/track.ts';
import {
  TRACK_BOARDS,
  trackBoardDocument,
  decodeTrackBoards,
} from '../../rendering/track-boards.ts';
import { legacyVertexData } from './legacy-geometry.ts';
import { prepareOriginalMaterials } from './asset-preparation.ts';
import { waitForPresentation } from './presentation-ready.ts';
import type { BabylonPresentationGpu } from './presentation-gpu.ts';
import type { PresentationSchedule } from './presentation-schedule.ts';
import type { CircuitPresentationContext } from './circuit-scene.ts';

function constructBoardMaterial(scene: Scene) {
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
    return new PBRMaterial('Original A09 print', scene);
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
function constructBoardMesh(scene: Scene) {
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
    return new Mesh('Original A09 triplet part', scene);
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
function constructBoardTexture(scene: Scene, allocate: () => RawTexture) {
  const previous = scene.addTexture,
    descriptor = Object.getOwnPropertyDescriptor(scene, 'addTexture');
  let captured: BaseTexture | undefined,
    registrationFailed = false;
  Object.defineProperty(scene, 'addTexture', {
    configurable: true,
    writable: true,
    value(value: BaseTexture) {
      captured ??= value;
      try {
        return previous.call(scene, value);
      } catch (error) {
        if (value === captured) registrationFailed = true;
        throw error;
      }
    },
  });
  try {
    const texture = allocate();
    if (texture !== captured || texture.getScene() !== scene)
      throw new Error('A09 texture allocation ownership mismatch');
    return texture;
  } catch (error) {
    if (captured) {
      try {
        // addTexture runs in BaseTexture before Texture fields exist. RawTexture's
        // later allocation runs only after Texture completes; use its full cleanup.
        if (registrationFailed) BaseTexture.prototype.dispose.call(captured);
        else Texture.prototype.dispose.call(captured);
      } catch {
        /* preserve exact primary */
      }
    }
    throw error;
  } finally {
    if (descriptor) Object.defineProperty(scene, 'addTexture', descriptor);
    else Reflect.deleteProperty(scene, 'addTexture');
  }
}
/** Original opaque canvas rows only: no artwork, color, alpha or sampler change. */
export function reverseOpaqueBoardRows(data: Uint8Array | Uint8ClampedArray) {
  if (
    !(data instanceof Uint8Array || data instanceof Uint8ClampedArray) ||
    data.length !== 256 * 256 * 4
  )
    throw new Error('A09 original RGBA dimensions');
  for (let i = 3; i < data.length; i += 4)
    if (data[i] !== 255) throw new Error('A09 original print must be opaque');
  const out = new Uint8Array(data.length),
    stride = 256 * 4;
  for (let y = 0; y < 256; y++)
    out.set(data.subarray(y * stride, (y + 1) * stride), (255 - y) * stride);
  return out;
}

export function brakingTripletEligible(track: Track, context?: CircuitPresentationContext) {
  return (
    track.circuit === AUREL &&
    !track.flat &&
    track.preset === 'clear' &&
    context?.presentation === 'circuit' &&
    Array.isArray(context.vehicles) &&
    context.vehicles.length > 0 &&
    context.vehicles.every((v) => v?.classId === 'formula' && v.dynamicsKind === 'four-wheel')
  );
}
export async function validateBrakingTripletBytes(
  raw: Uint8Array<ArrayBuffer>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  trackBoardDocument(raw);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', raw)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  signal.throwIfAborted();
  if (hash !== TRACK_BOARDS.sha256) throw new Error('A09 integrity mismatch');
}
export interface BabylonBrakingTripletOptions {
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
export interface BrakingTripletDependencies {
  fetcher?: typeof fetch;
  /** CPU allocation seam only; metadata never certifies real texture decoding. */
  allocateTexture?: (pixels: Uint8Array, width: number, height: number, scene: Scene) => RawTexture;
  decode?: (raw: Uint8Array<ArrayBuffer>, scene: Scene) => Promise<AssetContainer>;
  prepare?: typeof prepareOriginalMaterials;
  present?: typeof waitForPresentation;
}
/** Isolated first original clean braking triplet, LOD0 only. No live activation,
 * wet/shadow/LOD-switching or sector-board claim. Test seams are not GPU proof. */
export async function loadBabylonBrakingTriplet(
  options: BabylonBrakingTripletOptions,
  dependencies: BrakingTripletDependencies = {},
) {
  const { scene, track, signal, deadline, gpu, schedule } = options;
  const active = () => {
    signal.throwIfAborted();
    if (scene.isDisposed || !scene.useRightHandedSystem || !options.isCurrent())
      throw new DOMException('A09 scene ownership changed', 'AbortError');
    if (!brakingTripletEligible(track, options.context))
      throw new Error('A09 requires original Aurel Formula context');
    if (!Number.isFinite(deadline) || performance.now() >= deadline)
      throw new Error('A09 preparation deadline exceeded');
  };
  active();
  if (!scene.getEngine().getCaps().supportSRGBBuffers)
    throw new Error('A09 print requires hardware sRGB support');
  const response = await (dependencies.fetcher ?? fetch)(
    new URL(`models/aurel-track-boards.glb?v=${TRACK_BOARDS.sha256.slice(0, 16)}`, options.base),
    {
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now()))),
      ]),
    },
  );
  if (!response.ok || !response.body) throw new Error(`A09 request failed: ${response.status}`);
  const reader = response.body.getReader(),
    raw = new Uint8Array(TRACK_BOARDS.bytes);
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
      if (size + value.length > raw.length) throw new Error('A09 download exceeds byte budget');
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
      } else {
        try {
          console.error('A09 stream cleanup failed', error);
        } catch {
          /* primary remains authoritative */
        }
      }
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
  if (size !== raw.length) throw new Error('Truncated A09 download');
  await validateBrakingTripletBytes(raw, signal);
  active();
  let container: AssetContainer | undefined;
  let state: 'prepared' | 'installing' | 'ready' | 'disposed' = 'prepared';
  let preparing = true;
  const disposed = new AbortController();
  const parts: {
    name: string;
    mesh: Mesh;
    geometry: NonNullable<Mesh['geometry']>;
    material: PBRMaterial;
    text: string;
    station: number;
    kind: 'structure' | 'print';
  }[] = [];
  const ownedMaterialTextures = new Map<PBRMaterial, BaseTexture[]>();
  const labels: {
    text: string;
    sourceCanvas: HTMLCanvasElement;
    pixels: Uint8Array;
    texture: RawTexture;
    material: PBRMaterial;
  }[] = [];
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
        () => {
          if (mesh instanceof Mesh) mesh.geometry?.releaseForMesh(mesh, false);
          mesh.dispose(true, false);
        },
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
    labels.length = 0;
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
      // These exact-hash A09 collections were drained above. Container teardown
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
      'A09 native decode and original geometry upload',
      deadline,
      async (invalidated) => {
        try {
          const decoded = await (
            dependencies.decode ??
            ((bytes, target) => LoadAssetContainerAsync(bytes, target, { pluginExtension: '.glb' }))
          )(raw, scene);
          if (decoded.scene !== scene) throw new Error('A09 decoder returned a different scene');
          container = decoded;
          capture(container);
          invalidated.throwIfAborted();
          const atlas = container.materials.find(
            (m) => m.name === 'A09_original_PBR_surface_atlas',
          );
          if (
            !(atlas instanceof PBRMaterial) ||
            !atlas.albedoTexture ||
            !atlas.bumpTexture ||
            !atlas.metallicTexture ||
            atlas.ambientTexture ||
            atlas.backFaceCulling ||
            new Set([atlas.albedoTexture, atlas.bumpTexture, atlas.metallicTexture]).size !== 3 ||
            container.materials.length !== 1 ||
            container.textures.length !== 3
          )
            throw new Error('A09 original native atlas contract');
          ownedMaterialTextures.set(atlas, [
            atlas.albedoTexture,
            atlas.bumpTexture,
            atlas.metallicTexture,
          ]);
          // Original Three Texture.DEFAULT_ANISOTROPY is 1; glTF has no
          // anisotropy sampler field and TrackBoardsKit never changes it.
          // Babylon's default is 4, so preserve the original atlas sampling.
          for (const texture of ownedMaterialTextures.get(atlas)!)
            texture.anisotropicFilteringLevel = 1;
          // The untouched Three kit is the source producer. Its temporary atlas
          // placeholders are CPU-only: native atlas pixels come from exact GLB.
          const cpuLoader = new GLTFLoader().register(() => ({
            name: 'A09_CPU_geometry_only',
            loadTexture: () =>
              Promise.resolve(new T.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1)),
          }));
          const original = await decodeTrackBoards(raw, cpuLoader);
          let originalWorkFailed = false,
            originalCleanupFailed = false;
          let originalCleanupError: unknown;
          try {
            invalidated.throwIfAborted();
            active();
            const parent = new T.Group();
            original.build(track, parent);
            parent.updateMatrixWorld(true);
            const selected = ['150', '100', '50'].map((text) => {
              const index = original.sites.findIndex(
                (site) =>
                  site.s === 570 - Number(text) &&
                  site.text === text &&
                  site.lateral === -18 &&
                  site.variant === 'clean',
              );
              if (index < 0) throw new Error('A09 original first triplet changed');
              return { site: original.sites[index], group: original.chunks[index].levels[0] };
            });
            // Native source nodes supply atlas ownership only. Dispose their exact
            // meshes/geometries independently, never their retained material/maps.
            const sourceResources = [
              ...container.meshes,
              ...container.transformNodes,
              ...container.geometries,
            ];
            let sourceFailed = false,
              sourceError: unknown;
            for (const resource of sourceResources) {
              const entry = resources.get(resource)!;
              if (entry.done || entry.attempted || entry.isDisposed?.()) continue;
              entry.attempted = true;
              try {
                entry.release();
                entry.done = true;
              } catch (error) {
                if (!sourceFailed) sourceError = error;
                sourceFailed = true;
              }
            }
            if (sourceFailed) throw sourceError;
            container.meshes.length =
              container.transformNodes.length =
              container.geometries.length =
              container.rootNodes.length =
                0;
            for (const { site, group } of selected) {
              invalidated.throwIfAborted();
              active();
              if (group.children.length !== 2)
                throw new Error('A09 original two-part board changed');
              const print = group.children[1];
              if (
                !(print instanceof T.Mesh) ||
                !(print.material instanceof T.MeshStandardMaterial) ||
                !print.material.map
              )
                throw new Error('A09 original print missing');
              const sourceCanvas = print.material.map.image as HTMLCanvasElement;
              if (sourceCanvas.width !== 256 || sourceCanvas.height !== 256)
                throw new Error('A09 original label dimensions');
              const context = sourceCanvas.getContext('2d');
              if (!context) throw new Error('A09 original Canvas2D unavailable');
              const pixels = reverseOpaqueBoardRows(context.getImageData(0, 0, 256, 256).data);
              const texture = constructBoardTexture(scene, () =>
                (
                  dependencies.allocateTexture ??
                  ((data, w, h, target) =>
                    RawTexture.CreateRGBATexture(
                      data,
                      w,
                      h,
                      target,
                      true,
                      false,
                      Texture.TRILINEAR_SAMPLINGMODE,
                      0,
                      0,
                      true,
                    ))
                )(pixels, 256, 256, scene),
              );
              container.textures.push(texture);
              capture(container);
              scene.removeTexture(texture);
              texture.name = `A09 original ${site.text} print pixels`;
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
                internal.width !== 256 ||
                internal.height !== 256 ||
                internal.type !== 0 ||
                texture.format !== 5
              )
                throw new Error('A09 original print hardware sRGB contract');
              const graphic = constructBoardMaterial(scene);
              container.materials.push(graphic);
              capture(container);
              scene.removeMaterial(graphic);
              graphic.name = `A09 retained graphic ${site.text}`;
              graphic.albedoColor = new Color3(...print.material.color.toArray());
              graphic.roughness = print.material.roughness;
              graphic.metallic = print.material.metalness;
              graphic.albedoTexture = texture;
              graphic.backFaceCulling = true;
              graphic.twoSidedLighting = false;
              graphic.zOffset = print.material.polygonOffsetFactor;
              graphic.zOffsetUnits = print.material.polygonOffsetUnits;
              ownedMaterialTextures.set(graphic, [texture]);
              labels.push({ text: site.text, sourceCanvas, pixels, texture, material: graphic });
              for (const [i, source] of group.children.entries()) {
                if (!(source instanceof T.Mesh)) throw new Error('A09 original mesh missing');
                const mesh = constructBoardMesh(scene);
                container.meshes.push(mesh);
                container.rootNodes.push(mesh);
                capture(container);
                scene.removeMesh(mesh);
                mesh.name = source.name;
                mesh.material = i === 0 ? atlas : graphic;
                mesh.sideOrientation = Material.CounterClockWiseSideOrientation;
                try {
                  legacyVertexData(source.geometry).applyToMesh(mesh);
                } finally {
                  if (mesh.geometry && !container.geometries.includes(mesh.geometry)) {
                    container.geometries.push(mesh.geometry);
                    capture(container);
                    scene.removeGeometry(mesh.geometry);
                  }
                }
                mesh.freezeWorldMatrix(Matrix.FromArray(source.matrixWorld.elements));
                parts.push({
                  name: source.name,
                  mesh,
                  geometry: mesh.geometry!,
                  material: i === 0 ? atlas : graphic,
                  text: site.text,
                  station: site.s,
                  kind: i === 0 ? 'structure' : 'print',
                });
              }
            }
            if (
              parts.length !== 6 ||
              parts.reduce((sum, p) => sum + p.mesh.getTotalIndices() / 3, 0) !== 4950
            )
              throw new Error('A09 exact first-triplet topology changed');
          } catch (error) {
            originalWorkFailed = true;
            throw error;
          } finally {
            try {
              original.dispose();
            } catch (error) {
              if (!originalWorkFailed) {
                originalCleanupFailed = true;
                originalCleanupError = error;
              } else {
                try {
                  console.error('A09 original source cleanup failed', error);
                } catch {
                  /* preserve primary */
                }
              }
            }
          }
          if (originalCleanupFailed) throw originalCleanupError;
        } catch (error) {
          // A fatal lease invalidation can finish the outer await before a native
          // decoder resolves. Late acquired ownership must still be drained here.
          try {
            dispose();
          } catch (cleanupError) {
            try {
              console.error('A09 cleanup failed', cleanupError);
            } catch {
              /* preserve even falsy primary */
            }
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
        const activeParts = live.filter(
          (p) =>
            scene.meshes.includes(p.mesh) &&
            p.mesh.isEnabled() &&
            p.mesh.isVisible &&
            p.mesh.visibility > 0 &&
            p.mesh.material === p.material &&
            p.mesh.geometry === p.geometry &&
            !p.geometry.isDisposed(),
        );
        const activeMaterials = [...new Set(activeParts.map((p) => p.material))].filter(
          (m): m is PBRMaterial => m instanceof PBRMaterial && scene.materials.includes(m),
        );
        return {
          stagedParts:
            state === 'prepared' ? live.filter((p) => !scene.meshes.includes(p.mesh)).length : 0,
          activeParts: activeParts.length,
          activeMaterials: activeMaterials.length,
          activeTextures: new Set(
            activeMaterials
              .flatMap((m) =>
                (ownedMaterialTextures.get(m) ?? []).filter((t) =>
                  m.getActiveTextures().includes(t),
                ),
              )
              .filter((t) => scene.textures.includes(t)),
          ).size,
          state,
          sha256: TRACK_BOARDS.sha256,
          assetId: 'A09',
          parts: [...parts],
          retainedMaterials: new Set(
            parts.filter((p) => !p.mesh.isDisposed()).map((p) => p.material),
          ).size,
          retainedTextures: new Set(
            parts
              .filter((p) => !p.mesh.isDisposed())
              .flatMap((p) => ownedMaterialTextures.get(p.material) ?? []),
          ).size,
          retainedTriangles: parts
            .filter((p) => !p.mesh.isDisposed() && !p.geometry.isDisposed())
            .reduce((n, p) => n + p.geometry.getTotalIndices() / 3, 0),
          lod: 0,
          retainedMeshes: owned.meshes.length,
          labels: [...labels],
          stations: parts.filter((p) => p.kind === 'structure').map((p) => p.station),
          dryOnly: true,
          sectorBoards: false,
          shadowParity: false,
          weather: false,
          lodSelection: false,
        };
      },
      async install() {
        if (state !== 'prepared' || preparing)
          throw new Error('A09 cannot install twice or after disposal');
        try {
          active();
        } catch (error) {
          try {
            dispose();
          } catch (cleanupError) {
            try {
              console.error('A09 cleanup failed', cleanupError);
            } catch {
              /* preserve even falsy primary */
            }
          }
          throw error;
        }
        state = 'installing';
        const finish = schedule.prepare();
        const timerController = new AbortController();
        const timer = setTimeout(
          () => timerController.abort(new Error('A09 presentation deadline exceeded')),
          Math.max(0, deadline - performance.now()),
        );
        const waitSignal = AbortSignal.any([signal, disposed.signal, timerController.signal]);
        try {
          owned.addAllToScene();
          active();
          schedule.request();
          await (dependencies.present ?? waitForPresentation)(scene, waitSignal, gpu);
          active();
          if (state !== 'installing') throw new Error('A09 installation invalidated');
          state = 'ready';
        } catch (error) {
          try {
            dispose();
          } catch (cleanupError) {
            try {
              console.error('A09 cleanup failed', cleanupError);
            } catch {
              /* preserve even falsy primary */
            }
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
      try {
        console.error('A09 cleanup failed', cleanupError);
      } catch {
        /* preserve even falsy primary */
      }
    }
    throw error;
  }
}
