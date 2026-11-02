import { Material } from '@babylonjs/core/Materials/material.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import type { Mesh } from '@babylonjs/core/Meshes/mesh.js';
import { A09ClipOrderPlugin } from './braking-triplet-clip-order.ts';
import {
  brakingTripletEligible,
  loadBabylonBrakingTriplet,
  type BabylonBrakingTripletOptions,
} from './braking-triplet.ts';
import { TRACK_BOARDS } from '../../rendering/track-boards.ts';

/** Original first clean triplet only; live integration requires its own qualification. */
export const A09_READINESS_SCOPE = 'dry-formula-first-clean-triplet-fixed-lod0';
type Owner = Awaited<ReturnType<typeof loadBabylonBrakingTriplet>>;
type Diagnostics = ReturnType<Owner['diagnostics']>;
type ScalarPin<T> = { object: T; keys: readonly (keyof T)[]; values: unknown[] };
function pin<T>(object: T, keys: readonly (keyof T)[]): ScalarPin<T> {
  return { object, keys, values: keys.map((key) => object[key]) };
}
function unchanged<T>(p: ScalarPin<T>) {
  for (let i = 0; i < p.keys.length; i++) if (p.object[p.keys[i]] !== p.values[i]) return false;
  return true;
}
/** Snapshots allocate once. Validation scans every current value without copying,
 * stringifying, hashing, or caching success. Mutable backing arrays are not immutable. */
function snapshot(data: ArrayLike<number> | null) {
  if (!data) throw new Error('A09 retained numeric data missing');
  const copy = new Float64Array(data.length);
  for (let i = 0; i < data.length; i++) {
    if (!Number.isFinite(data[i])) throw new Error('A09 retained numeric data nonfinite');
    copy[i] = data[i];
  }
  return copy;
}
function equal(data: ArrayLike<number> | null | undefined, expected: ArrayLike<number>) {
  if (!data || data.length !== expected.length) return false;
  for (let i = 0; i < data.length; i++) if (data[i] !== expected[i]) return false;
  return true;
}
const colorKeys = [
  'albedoColor',
  'emissiveColor',
  'reflectivityColor',
  'metallicReflectanceColor',
  'ambientColor',
  'reflectionColor',
] as const;
const expectedStations = [420, 470, 520] as const;
const expectedLabels = ['150', '100', '50'] as const;
const materialKeys = [
  'baseWeight',
  'baseDiffuseRoughness',
  'baseWeightTexture',
  'baseDiffuseRoughnessTexture',
  'roughness',
  'metallic',
  'alpha',
  'backFaceCulling',
  'twoSidedLighting',
  'sideOrientation',
  'fillMode',
  'transparencyMode',
  'disableDepthWrite',
  'disableColorWrite',
  'zOffset',
  'zOffsetUnits',
  'disableLighting',
  'maxSimultaneousLights',
  'alphaCutOff',
  'forceAlphaTest',
  'useAlphaFresnel',
  'useLinearAlphaFresnel',
  'useSpecularOverAlpha',
  'useRadianceOverAlpha',
  'useLightmapAsShadowmap',
  'enableSpecularAntiAliasing',
  'useHorizonOcclusion',
  'useRadianceOcclusion',
  'microSurface',
  'environmentBRDFTexture',
  'forceNormalForward',
  'useObjectSpaceNormalMap',
  'invertNormalMapX',
  'invertNormalMapY',
  'useParallax',
  'useParallaxOcclusion',
  'unlit',
  'directIntensity',
  'environmentIntensity',
  'specularIntensity',
  'emissiveIntensity',
  'metallicF0Factor',
  'useAlphaFromAlbedoTexture',
  'useRoughnessFromMetallicTextureAlpha',
  'useRoughnessFromMetallicTextureGreen',
  'useMetallnessFromMetallicTextureBlue',
  'useAmbientOcclusionFromMetallicTextureRed',
  'albedoTexture',
  'bumpTexture',
  'metallicTexture',
  'ambientTexture',
  'emissiveTexture',
  'opacityTexture',
  'reflectionTexture',
  'refractionTexture',
  'reflectivityTexture',
  'lightmapTexture',
  'metallicReflectanceTexture',
  'reflectanceTexture',
  'microSurfaceTexture',
  'customShaderNameResolve',
] as const satisfies readonly (keyof PBRMaterial)[];
const textureKeys = [
  'level',
  'hasAlpha',
  'gammaSpace',
  'coordinatesIndex',
  'coordinatesMode',
  'wrapU',
  'wrapV',
  'wrapR',
  'uOffset',
  'vOffset',
  'uScale',
  'vScale',
  'uAng',
  'vAng',
  'wAng',
  'uRotationCenter',
  'vRotationCenter',
  'wRotationCenter',
  'anisotropicFilteringLevel',
  'samplingMode',
  'delayLoadState',
] as const satisfies readonly (keyof Texture)[];
function captureMesh(mesh: Mesh) {
  if (
    !mesh.geometry ||
    !mesh.geometry.getIndexBuffer() ||
    mesh.geometry.getIndexBuffer()?.underlyingResource == null
  )
    throw new Error('A09 retained geometry/index buffer missing');
  return {
    mesh,
    geometry: mesh.geometry,
    material: mesh.material,
    world: snapshot(mesh.worldMatrixFromCache.m),
    attributes: ['position', 'normal', 'uv'].map((kind) => {
      const vertex = mesh.getVertexBuffer(kind);
      if (!vertex || !vertex.getBuffer() || vertex.getBuffer()?.underlyingResource == null)
        throw new Error('A09 retained vertex buffer missing');
      return {
        kind,
        vertex,
        wrapper: vertex.getWrapperBuffer(),
        buffer: vertex.getBuffer(),
        native: vertex.getBuffer()?.underlyingResource,
        values: snapshot(mesh.getVerticesData(kind)),
        metadata: pin(vertex, ['type', 'normalized', 'byteOffset', 'byteStride']),
        size: vertex.getSize(),
        updatable: vertex.isUpdatable(),
      };
    }),
    indices: snapshot(mesh.getIndices()),
    indexBuffer: mesh.geometry.getIndexBuffer(),
    indexNative: mesh.geometry.getIndexBuffer()?.underlyingResource,
    subMeshes: mesh.subMeshes.map((row) =>
      pin(row, ['materialIndex', 'verticesStart', 'verticesCount', 'indexStart', 'indexCount']),
    ),
  };
}
function unsupportedFeatures(material: PBRMaterial) {
  return (
    material.clearCoat.isEnabled ||
    material.iridescence.isEnabled ||
    material.anisotropy.isEnabled ||
    material.sheen.isEnabled ||
    material.detailMap.isEnabled ||
    material.subSurface.isRefractionEnabled ||
    material.subSurface.isTranslucencyEnabled ||
    material.subSurface.isScatteringEnabled
  );
}
const featureKeys = [
  'clearCoat',
  'iridescence',
  'anisotropy',
  'sheen',
  'detailMap',
  'subSurface',
  'brdf',
] as const;
function captureMaterial(material: PBRMaterial) {
  if (unsupportedFeatures(material)) throw new Error('A09 unsupported material feature');
  const plugin = material.pluginManager?.getPlugin('OriginalA09ClipOrder');
  if (!(plugin instanceof A09ClipOrderPlugin) || !plugin.isValid)
    throw new Error('A09 retained original clip plugin missing');
  return {
    material,
    state: pin(material, materialKeys),
    plugin,
    manager: material.pluginManager,
    uniformBuffer: material._uniformBuffer,
    features: pin(material, featureKeys),
    brdf: pin(material.brdf, [
      'useEnergyConservation',
      'useSmithVisibilityHeightCorrelated',
      'useSphericalHarmonics',
      'useSpecularGlossinessInputEnergyConservation',
      'mixIblRadianceWithIrradiance',
      'useLegacySpecularEnergyConservation',
      'baseDiffuseModel',
      'dielectricSpecularModel',
      'conductorSpecularModel',
    ]),
    subsurface: pin(material.subSurface, ['indexOfRefraction', 'linkRefractionWithTransparency']),
    colors: colorKeys.map((key) => pin(material[key], ['r', 'g', 'b'])),
  };
}
function captureTexture(texture: Texture) {
  const internal = texture.getInternalTexture();
  if (
    !internal ||
    !internal.isReady ||
    !internal._hardwareTexture ||
    internal._hardwareTexture.underlyingResource == null ||
    texture.delayLoadState === 4
  )
    throw new Error('A09 retained ready native texture missing');
  const raw = internal._bufferView;
  const bytes = raw ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength) : null;
  return {
    texture,
    internal,
    hardware: internal._hardwareTexture,
    native: internal._hardwareTexture?.underlyingResource,
    state: pin(texture, textureKeys),
    internalState: pin(internal, [
      'width',
      'height',
      'depth',
      'type',
      'format',
      'generateMipMaps',
      'invertY',
      'samplingMode',
      '_useSRGBBuffer',
    ]),
    raw,
    bytes,
    rawSnapshot: bytes ? new Uint8Array(bytes) : null,
  };
}

export class BrakingTripletPreparation {
  private readonly abort = new AbortController();
  private readonly options: BabylonBrakingTripletOptions;
  private owner: Owner | undefined;
  private disposed = false;
  private drawable = false;
  private ready = false;
  private preparedComplete = false;
  private installStarted = false;
  private bindings: ReturnType<typeof captureMesh>[] = [];
  private materials: ReturnType<typeof captureMaterial>[] = [];
  private textures: ReturnType<typeof captureTexture>[] = [];
  private labels: {
    label: Diagnostics['labels'][number];
    pixels: Uint8Array | null;
    sourceCanvas: HTMLCanvasElement;
    material: PBRMaterial;
    texture: Texture;
    pixelIdentity: Uint8Array;
  }[] = [];
  private parts: Diagnostics['parts'] = [];
  readonly eligible: boolean;
  readonly prepared: Promise<void>;
  readonly completion: Promise<void>;
  private resolveCompletion!: () => void;
  private rejectCompletion!: (error: unknown) => void;
  private readonly cancelStaged = () => {
    if (this.preparedComplete && !this.installStarted)
      this.rejectCompletion(this.options.signal.reason);
  };
  constructor(
    options: BabylonBrakingTripletOptions,
    load: typeof loadBabylonBrakingTriplet = loadBabylonBrakingTriplet,
    mode: { staged?: boolean } = {},
  ) {
    this.options = { ...options, signal: AbortSignal.any([options.signal, this.abort.signal]) };
    this.eligible = brakingTripletEligible(options.track, options.context);
    this.completion = new Promise<void>((resolve, reject) => {
      this.resolveCompletion = resolve;
      this.rejectCompletion = reject;
    });
    void this.completion.catch(() => {});
    this.prepared = this.prepare(load);
    void this.prepared
      .then(() => {
        if (!mode.staged) this.install();
      }, this.rejectCompletion)
      .catch(this.rejectCompletion);
  }
  private current() {
    return (
      !this.disposed &&
      !this.options.signal.aborted &&
      !this.options.scene.isDisposed &&
      this.options.isCurrent()
    );
  }
  private active() {
    this.options.signal.throwIfAborted();
    if (!this.current()) throw new DOMException('A09 preparation ownership changed', 'AbortError');
    if (performance.now() >= this.options.deadline)
      throw new Error('A09 preparation deadline exceeded');
  }
  get canDraw() {
    return this.current() && this.drawable;
  }
  get completed() {
    return this.current() && this.ready;
  }
  receipt() {
    if (!this.completed) throw new Error('A09 preparation is not ready');
    return this.bindingReceipt();
  }
  /** Resource-retention proof, NOT current-generation readiness. Capture only
   * while publicly ready. Validation deliberately bypasses the entire supplied
   * isCurrent predicate, not merely a pending flag. A future drained restart
   * caller must independently authorize its current component, scene, controller
   * and healthy GPU before using this proof across that synchronous handoff.
   * Cancellation, disposal and every retained binding/value check still apply. */
  captureRetainedProof() {
    if (!this.eligible || !this.completed) return null;
    try {
      this.receipt();
    } catch {
      return null;
    }
    const owner = this.owner,
      scene = this.options.scene,
      signal = this.options.signal;
    return {
      valid: (expectedScene: BabylonBrakingTripletOptions['scene']) => {
        if (
          expectedScene !== scene ||
          this.owner !== owner ||
          this.options.scene !== scene ||
          this.options.signal !== signal ||
          this.disposed ||
          !this.ready ||
          signal.aborted ||
          scene.isDisposed
        )
          return false;
        try {
          this.bindingReceipt();
          return true;
        } catch {
          return false;
        }
      },
    };
  }
  private bindingReceipt() {
    if (brakingTripletEligible(this.options.track, this.options.context) !== this.eligible)
      throw new Error('A09 eligibility changed');
    if (!this.eligible)
      return { state: 'ineligible', parts: 0, triangles: 0, scope: A09_READINESS_SCOPE };
    const scene = this.options.scene,
      d = this.owner!.diagnostics();
    if (
      d.state !== 'ready' ||
      d.assetId !== 'A09' ||
      d.sha256 !== TRACK_BOARDS.sha256 ||
      d.activeParts !== 6 ||
      d.activeMaterials !== 4 ||
      d.activeTextures !== 6 ||
      d.parts.length !== 6 ||
      d.retainedTriangles !== 4950 ||
      d.lod !== 0 ||
      !d.dryOnly ||
      d.sectorBoards ||
      d.shadowParity ||
      d.weather ||
      d.lodSelection ||
      !equal(d.stations, expectedStations) ||
      this.bindings.length !== 6 ||
      this.materials.length !== 4 ||
      this.textures.length !== 6 ||
      d.labels.length !== 3
    )
      throw new Error('A09 original first-triplet readiness contract changed');
    for (let i = 0; i < this.bindings.length; i++) {
      const b = this.bindings[i],
        mesh = b.mesh,
        part = d.parts[i],
        original = this.parts[i];
      if (
        part.mesh !== mesh ||
        part.geometry !== b.geometry ||
        part.material !== b.material ||
        part.text !== expectedLabels[Math.floor(i / 2)] ||
        part.station !== expectedStations[Math.floor(i / 2)] ||
        part.kind !== (i % 2 === 0 ? 'structure' : 'print') ||
        part.text !== original.text ||
        part.station !== original.station ||
        part.kind !== original.kind ||
        mesh.isDisposed() ||
        !mesh.isEnabled() ||
        !mesh.isVisible ||
        mesh.visibility !== 1 ||
        mesh.parent !== null ||
        mesh.geometry !== b.geometry ||
        mesh.material !== b.material ||
        b.geometry.isDisposed() ||
        !scene.meshes.includes(mesh) ||
        !scene.geometries.includes(b.geometry) ||
        mesh.getScene() !== scene ||
        !mesh.isWorldMatrixFrozen ||
        mesh.hasInstances ||
        mesh.hasThinInstances ||
        mesh.skeleton ||
        mesh.morphTargetManager ||
        mesh.sideOrientation !== Material.CounterClockWiseSideOrientation ||
        !equal(mesh.worldMatrixFromCache.m, b.world) ||
        !equal(mesh.getIndices(), b.indices) ||
        b.geometry.getIndexBuffer() !== b.indexBuffer ||
        b.geometry.getIndexBuffer()?.underlyingResource !== b.indexNative ||
        mesh.subMeshes.length !== b.subMeshes.length
      )
        throw new Error('A09 retained mesh binding changed');
      for (const a of b.attributes) {
        const vertex = mesh.getVertexBuffer(a.kind);
        if (
          vertex !== a.vertex ||
          vertex.getWrapperBuffer() !== a.wrapper ||
          vertex.getBuffer() !== a.buffer ||
          vertex.getBuffer()?.underlyingResource !== a.native ||
          !unchanged(a.metadata) ||
          vertex.getSize() !== a.size ||
          vertex.isUpdatable() !== a.updatable ||
          a.updatable ||
          !equal(mesh.getVerticesData(a.kind), a.values)
        )
          throw new Error('A09 retained vertex data changed');
      }
      for (let j = 0; j < b.subMeshes.length; j++)
        if (mesh.subMeshes[j] !== b.subMeshes[j].object || !unchanged(b.subMeshes[j]))
          throw new Error('A09 retained submesh changed');
    }
    for (const p of this.materials) {
      if (
        !scene.materials.includes(p.material) ||
        p.material.getScene() !== scene ||
        !unchanged(p.state) ||
        !unchanged(p.features) ||
        !unchanged(p.brdf) ||
        !unchanged(p.subsurface) ||
        unsupportedFeatures(p.material) ||
        p.material._uniformBuffer !== p.uniformBuffer ||
        p.material.pluginManager !== p.manager ||
        p.manager?.getPlugin('OriginalA09ClipOrder') !== p.plugin ||
        !p.plugin.isValid ||
        !p.colors.every(unchanged)
      )
        throw new Error('A09 retained material changed');
      for (let i = 0; i < colorKeys.length; i++)
        if (p.material[colorKeys[i]] !== p.colors[i].object)
          throw new Error('A09 retained material color replaced');
    }
    for (const p of this.textures) {
      if (
        !scene.textures.includes(p.texture) ||
        p.texture.getScene() !== scene ||
        !p.internal.isReady ||
        p.texture.getInternalTexture() !== p.internal ||
        p.internal._hardwareTexture !== p.hardware ||
        p.internal._hardwareTexture?.underlyingResource !== p.native ||
        !unchanged(p.state) ||
        !unchanged(p.internalState) ||
        p.internal._bufferView !== p.raw ||
        (p.rawSnapshot && !equal(p.bytes, p.rawSnapshot))
      )
        throw new Error('A09 retained texture changed');
    }
    for (let i = 0; i < this.labels.length; i++) {
      const p = this.labels[i],
        label = d.labels[i];
      if (
        label !== p.label ||
        label.material !== p.material ||
        label.texture !== p.texture ||
        label.sourceCanvas !== p.sourceCanvas ||
        label.pixels !== p.pixelIdentity ||
        label.text !== expectedLabels[i] ||
        label.sourceCanvas.width !== 256 ||
        label.sourceCanvas.height !== 256 ||
        (p.pixels !== null && !equal(label.pixels, p.pixels))
      )
        throw new Error('A09 retained original print changed');
    }
    return { state: 'ready', parts: 6, triangles: 4950, scope: A09_READINESS_SCOPE };
  }
  dispose() {
    this.options.signal.removeEventListener('abort', this.cancelStaged);
    this.disposed = true;
    this.drawable = this.ready = false;
    this.abort.abort();
    if (this.preparedComplete && !this.installStarted)
      this.rejectCompletion(new DOMException('Staged A09 disposed', 'AbortError'));
    this.owner?.dispose();
  }
  private async prepare(load: typeof loadBabylonBrakingTriplet) {
    try {
      this.active();
      if (this.eligible) {
        this.owner = await load(this.options);
        this.active();
        const d = this.owner.diagnostics();
        if (d.parts.length !== 6 || d.retainedTriangles !== 4950 || d.state !== 'prepared')
          throw new Error('A09 prepared owner contract changed');
        this.parts = d.parts.map((part) => ({ ...part }));
        this.bindings = d.parts.map((part) => captureMesh(part.mesh));
        this.materials = [...new Set(d.parts.map((part) => part.material))].map(captureMaterial);
        const textures = new Set<Texture>();
        for (const p of this.materials)
          for (const texture of p.material.getActiveTextures()) {
            if (!(texture instanceof Texture)) throw new Error('A09 unsupported texture');
            textures.add(texture);
          }
        this.textures = [...textures].map(captureTexture);
        this.labels = d.labels.map((label) => ({
          label,
          // If the same raw CPU view is already pinned and scanned by its texture,
          // do not duplicate the byte snapshot/scan. Identity is still checked.
          pixels: this.textures.some((p) => p.texture === label.texture && p.raw === label.pixels)
            ? null
            : new Uint8Array(label.pixels),
          sourceCanvas: label.sourceCanvas,
          material: label.material,
          texture: label.texture,
          pixelIdentity: label.pixels,
        }));
      }
      this.active();
      this.preparedComplete = true;
      this.options.signal.addEventListener('abort', this.cancelStaged, { once: true });
    } catch (error) {
      this.cleanupFailure(error);
    }
  }
  install(): Promise<void> {
    if (this.installStarted) return this.completion;
    if (!this.preparedComplete) throw new Error('A09 installation requires one prepared owner');
    this.installStarted = true;
    this.options.signal.removeEventListener('abort', this.cancelStaged);
    void this.present().then(this.resolveCompletion, this.rejectCompletion);
    return this.completion;
  }
  private async present() {
    try {
      this.active();
      if (this.eligible) {
        const installed = this.owner!.install();
        this.drawable = true;
        await installed;
        this.active();
      }
      this.drawable = this.ready = true;
      this.receipt();
    } catch (error) {
      this.cleanupFailure(error);
    }
  }
  private cleanupFailure(error: unknown): never {
    try {
      this.dispose();
    } catch (cleanupError) {
      try {
        console.error('A09 preparation cleanup failed', cleanupError);
      } catch {
        /* retain primary */
      }
    }
    throw error;
  }
}
export function brakingTripletPreparationValid(
  owner: BrakingTripletPreparation | undefined,
  expected = owner,
) {
  if (!owner || owner !== expected || !owner.completed) return false;
  try {
    owner.receipt();
    return true;
  } catch {
    return false;
  }
}
