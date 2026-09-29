import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './tyre-blankets.manifest.json' with { type: 'json' };
import { HERO_GARAGE } from './hero-garage.ts';
import { detailDistance } from './view-detail.ts';
import type { Quality } from './options.ts';
import type { A33GarageStorage } from './a33-spare-wheel-set.ts';

export const TYRE_BLANKETS = manifest;
export type BlanketVariant = keyof typeof manifest.variants;
const variants = Object.keys(manifest.variants) as BlanketVariant[];
const aborted = () => new DOMException('A34 loading cancelled', 'AbortError');
const digest = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
interface Document {
  asset?: { version?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { name?: string; children?: number[]; mesh?: number; camera?: number }[];
  meshes?: { primitives?: { indices?: number; mode?: number; material?: number }[] }[];
  accessors?: { count?: number }[];
  buffers?: { byteLength?: number; uri?: string }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  materials?: { name?: string }[];
  animations?: unknown[];
  skins?: unknown[];
  cameras?: unknown[];
}
/** Exact retained export only. Never substitutes procedural stand-in blankets. */
export function blanketDocument(bytes: Uint8Array<ArrayBuffer>): Document {
  if (bytes.length !== manifest.bytes || bytes.length < 28)
    throw new Error('A34 byte count mismatch');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = v.getUint32(12, true);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length ||
    v.getUint32(16, true) !== 0x4e4f534a ||
    length % 4 ||
    length > bytes.length - 28
  )
    throw new Error('Invalid A34 GLB header');
  const d: Document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  if (
    d.asset?.version !== '2.0' ||
    d.scene !== 0 ||
    d.scenes?.length !== 1 ||
    d.nodes?.length !== manifest.nodes ||
    d.meshes?.length !== manifest.meshes ||
    d.materials?.length !== manifest.materials ||
    d.images?.length !== manifest.images ||
    d.buffers?.length !== 1 ||
    d.buffers[0].uri !== undefined ||
    d.buffers[0].byteLength !== bytes.length - length - 28 ||
    d.images.some(
      (i) => i.uri !== undefined || !Number.isInteger(i.bufferView) || i.mimeType !== 'image/png',
    ) ||
    d.animations?.length ||
    d.skins?.length ||
    d.cameras?.length ||
    d.nodes.some((n) => n.camera !== undefined)
  )
    throw new Error('Invalid self-contained A34 contract');
  const nodes = d.nodes;
  const find = (name: string) => {
    const ids = nodes.flatMap((n, i) => (n.name === name ? [i] : []));
    if (ids.length !== 1) throw new Error(`Missing or duplicate A34 node ${name}`);
    return ids[0];
  };
  const library = find('A34_LIBRARY');
  if (d.scenes[0].nodes?.length !== 1 || d.scenes[0].nodes[0] !== library)
    throw new Error('Invalid A34 scene root');
  for (const id of variants) {
    const root = find(`A34_${id}`);
    if (!nodes[library].children?.includes(root)) throw new Error('Invalid A34 variant parent');
    for (const name of Object.keys(manifest.variants[id].sockets)) {
      if (!nodes[root].children?.includes(find(`A34_${id}_SOCKET_${name}`)))
        throw new Error('Invalid A34 socket parent');
    }
    for (const level of [0, 1, 2] as const) {
      const lod = find(`A34_${id}_LOD${level}`);
      if (!nodes[root].children?.includes(lod)) throw new Error('Invalid A34 LOD parent');
      let triangles = 0;
      for (const child of nodes[lod].children ?? []) {
        const mesh = d.meshes[nodes[child]?.mesh ?? -1];
        if (!mesh?.primitives?.length) throw new Error('Invalid A34 surface');
        for (const p of mesh.primitives) {
          const count = d.accessors?.[p.indices ?? -1]?.count;
          if (!count || count % 3 || p.mode !== 4) throw new Error('Invalid A34 triangle count');
          triangles += count / 3;
        }
      }
      if (triangles !== manifest.variants[id].triangles[level])
        throw new Error('A34 LOD count mismatch');
    }
  }
  return d;
}
export function blanketLod(
  distance: number,
  previous: number,
  quality: Quality,
  fov = 58,
  aspect = 16 / 9,
) {
  if (!Number.isFinite(distance) || distance < 0) throw new Error('Invalid A34 distance');
  const d = detailDistance(distance, fov, aspect);
  const near = quality === 'high' ? 12 : quality === 'medium' ? 8 : 5;
  const far = quality === 'high' ? 45 : quality === 'medium' ? 32 : 24;
  if (previous === 0 && d < near * 1.12) return 0;
  if (previous === 2 && d > far * 0.88) return 2;
  return d < near ? 0 : d < far ? 1 : 2;
}
export interface BlanketPlacement {
  name: string;
  variant: BlanketVariant;
  position: [number, number, number];
  yaw: number;
}
/** A22 sockets are FLOOR contacts, not wheel centres. The wheel axle follows
 * garage Z, rather than garage X; neither the garage nor its sockets are edited. */
export function blanketPlacements(): BlanketPlacement[] {
  const result: BlanketPlacement[] = [];
  for (const corner of ['FL', 'FR', 'RL', 'RR'] as const) {
    const p = HERO_GARAGE.sockets[`SOCKET_TYRE_${corner}`];
    result.push({
      name: corner,
      variant: corner[0] === 'F' ? 'FRONT_FITTED' : 'REAR_FITTED',
      position: [p[0], p[1] + 0.36, p[2]],
      yaw: p[2] > 0 ? -Math.PI / 2 : Math.PI / 2,
    });
  }
  for (const [name, variant, x, z] of [
    ['MAIN', 'CONTROLLER_MAIN', -0.2, -2.75],
    ['PORTABLE', 'CONTROLLER_PORTABLE', -1, -2.75],
    ['FOLDED_NEAT', 'FOLDED_NEAT', 0.65, -2.75],
    ['FOLDED_LOOSE', 'FOLDED_LOOSE', 2.35, 2.55],
    ['COIL', 'CABLE_COIL', -1.6, -2.75],
  ] as const)
    result.push({ name, variant, position: [x, 0.06, z], yaw: -Math.PI / 2 });
  return result;
}
function disposeGraph(root: T.Object3D) {
  const gs = new Set<T.BufferGeometry>(),
    ms = new Set<T.Material>(),
    ts = new Set<T.Texture>();
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    gs.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      ms.add(m);
      for (const v of Object.values(m)) if (v instanceof T.Texture) ts.add(v);
    }
  });
  gs.forEach((g) => g.dispose());
  ms.forEach((m) => m.dispose());
  ts.forEach((t) => {
    t.dispose();
    if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close();
  });
}
class FloorCable extends T.Curve<T.Vector3> {
  private readonly curve: T.CatmullRomCurve3;
  constructor(points: T.Vector3[]) {
    super();
    this.curve = new T.CatmullRomCurve3(points, false, 'centripetal');
  }
  getPoint(t: number, out = new T.Vector3()) {
    this.curve.getPoint(t, out);
    out.y = Math.max(0.072, out.y);
    return out;
  }
}
export class TyreBlanketSet {
  readonly root = new T.Group();
  readonly instances = new Map<
    string,
    { root: T.Object3D; variant: BlanketVariant; levels: T.Object3D[] }
  >();
  readonly harness = [new T.Group(), new T.Group(), new T.Group()];
  readonly renderLevels = [new T.Group(), new T.Group(), new T.Group()];
  private readonly bounds = new T.Box3();
  private readonly worldBounds = new T.Box3();
  private readonly indicators = new Set<T.MeshStandardMaterial>();
  private level = 0;
  private disposed = false;
  private cableTriangles = [0, 0, 0];
  private wheelStorage: A33GarageStorage | null = null;
  private wheelBatch: T.InstancedMesh | null = null;
  private wheelVersion = -1;
  private readonly wheelInverse = new T.Matrix4();
  private readonly wheelTransform = new T.Matrix4();
  constructor(readonly library: T.Group) {
    this.root.name = 'A34 tyre blankets and controllers';
    this.root.userData.assetId = 'A34';
    // Hidden templates stay under the owned root so normal renderer disposal
    // also releases unused OPEN variants exactly once. They are never drawn.
    library.visible = false;
    this.root.add(library);
    try {
      for (const placement of blanketPlacements()) {
        const prototype = library.getObjectByName(`A34_${placement.variant}`);
        if (!prototype) throw new Error(`Missing A34 variant ${placement.variant}`);
        const instance = prototype.clone(true);
        instance.name = `A34_INSTANCE_${placement.name}`;
        instance.position.set(...placement.position);
        instance.rotation.y = placement.yaw;
        const levels = [0, 1, 2].map((i) => {
          const l = instance.getObjectByName(`A34_${placement.variant}_LOD${i}`);
          if (!l) throw new Error('Missing A34 detail level');
          return l;
        });
        this.root.add(instance);
        this.instances.set(placement.name, { root: instance, variant: placement.variant, levels });
        this.bounds.union(new T.Box3().setFromObject(instance));
      }
      this.root.updateMatrixWorld(true);
      const cableMaterial = library.getObjectByName('A34_CABLE_COIL_L0_A34_CableRubber');
      if (!(cableMaterial instanceof T.Mesh)) throw new Error('Missing A34 cable material');
      for (const [channel, name] of ['FL', 'FR', 'RL', 'RR'].entries()) {
        const start = this.socket('MAIN', `CHANNEL_${channel + 1}`, new T.Vector3());
        const end = this.socket(name, 'BLANKET_POWER', new T.Vector3());
        const side = end.z < 0 ? -1 : 1;
        const points = [start, new T.Vector3(start.x, 0.072, -2.45)];
        // Short corner controls bound the centripetal spline's rear overshoot.
        if (side > 0)
          points.push(
            new T.Vector3(4.5, 0.072, -2.45),
            new T.Vector3(4.8, 0.072, -2.15),
            new T.Vector3(4.8, 0.072, 2.15),
            new T.Vector3(4.5, 0.072, 2.45),
          );
        points.push(
          new T.Vector3(end.x, 0.072, side * 2.45),
          new T.Vector3(end.x, 0.072, end.z),
          end,
        );
        for (const lod of [0, 1] as const) {
          const g = new T.TubeGeometry(
            new FloorCable(points),
            lod === 0 ? 48 : 24,
            0.0045,
            lod === 0 ? 6 : 4,
            false,
          );
          const mesh = new T.Mesh(g, cableMaterial.material);
          mesh.name = `A34_ROUTED_LEAD_${name}_LOD${lod}`;
          this.harness[lod].add(mesh);
          this.cableTriangles[lod] += g.index!.count / 3;
        }
      }
      for (const [i, group] of this.harness.entries()) {
        group.name = `A34_HARNESS_LOD${i}`;
        this.root.add(group);
        this.bounds.union(new T.Box3().setFromObject(group));
      }
      if (
        !new T.Box3(new T.Vector3(-3, 0.05, -3.3), new T.Vector3(5.15, 1.0, 3.3)).containsBox(
          this.bounds,
        )
      )
        throw new Error('A34 layout exceeds the reserved garage envelope');
      // Bake only this static A34 arrangement into material batches. Named source
      // variants and sockets remain available, protected from the global batcher.
      this.root.updateMatrixWorld(true);
      for (const lod of [0, 1, 2] as const) {
        const groups = new Map<T.Material, T.BufferGeometry[]>();
        const collect = (node: T.Object3D) =>
          node.traverse((o) => {
            if (!(o instanceof T.Mesh) || Array.isArray(o.material)) return;
            const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
            const bucket = groups.get(o.material) ?? [];
            bucket.push(g);
            groups.set(o.material, bucket);
          });
        for (const instance of this.instances.values()) collect(instance.levels[lod]);
        collect(this.harness[lod]);
        for (const [material, geometries] of groups) {
          const g = mergeGeometries(geometries, false);
          geometries.forEach((item) => item.dispose());
          if (!g) throw new Error('Incompatible A34 batch attributes');
          const m = new T.Mesh(g, material);
          m.name = `A34_BATCH_LOD${lod}_${material.name}`;
          this.renderLevels[lod].add(m);
        }
        this.renderLevels[lod].name = `A34_RENDER_LOD${lod}`;
        this.root.add(this.renderLevels[lod]);
      }
      this.root.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        o.castShadow = !o.name.startsWith('A34_ROUTED_LEAD');
        o.receiveShadow = true;
        o.geometry.computeBoundingBox();
        o.geometry.computeBoundingSphere();
        for (const m of Array.isArray(o.material) ? o.material : [o.material])
          if (m instanceof T.MeshStandardMaterial && m.name === 'A34_StandbyIndicators')
            this.indicators.add(m);
      });
      this.setDetail(0, 'high');
    } catch (e) {
      disposeGraph(this.root);
      throw e;
    }
  }
  /** Output is in A34-root local space, including each instance's orientation. */
  socket(instanceName: string, name: string, out: T.Vector3) {
    const instance = this.instances.get(instanceName);
    if (!instance) throw new Error(`Unknown A34 instance ${instanceName}`);
    const node = instance.root.getObjectByName(`A34_${instance.variant}_SOCKET_${name}`);
    if (!node) throw new Error(`Unknown A34 socket ${name}`);
    this.root.updateWorldMatrix(true, true);
    node.getWorldPosition(out);
    return this.root.worldToLocal(out);
  }
  update(camera: T.PerspectiveCamera, quality: Quality, lighting: 'day' | 'sunset' | 'night') {
    this.root.updateWorldMatrix(true, false);
    this.worldBounds.copy(this.bounds).applyMatrix4(this.root.matrixWorld);
    this.setDetail(
      this.worldBounds.distanceToPoint(camera.position),
      quality,
      camera.fov,
      camera.aspect,
    );
    for (const material of this.indicators)
      material.emissiveIntensity = lighting === 'night' ? 0.8 : 0.4;
  }
  setDetail(distance: number, quality: Quality, fov = 58, aspect = 16 / 9) {
    this.level = blanketLod(distance, this.level, quality, fov, aspect);
    for (const instance of this.instances.values()) {
      instance.root.visible = false;
      instance.levels.forEach((l, i) => {
        l.visible = i === this.level;
      });
    }
    this.harness.forEach((h) => {
      h.visible = false;
    });
    this.renderLevels.forEach((h, i) => {
      h.visible = i === this.level;
    });
  }
  /** A33 keeps its own geometry, morph selection, LOD and disposal. In this
   * dressed bay only, orient its stored wheels under the fitted covers. Reapply
   * after A33 changes a LOD; identical held frames do not upload matrices again.
   * The unblanketed A33 horizontal layout and pit-service poses are unchanged. */
  alignGarageWheels(storage: A33GarageStorage) {
    const level = storage.wheels.batches.findIndex((b) => b.count > 0);
    if (level < 0) return;
    const batch = storage.wheels.batches[level];
    if (
      this.wheelStorage === storage &&
      this.wheelBatch === batch &&
      this.wheelVersion === batch.instanceMatrix.version
    )
      return;
    if (storage.wheels.diagnostics().instances !== 4)
      throw new Error('A34 requires exactly four A33 garage wheels');
    storage.root.updateWorldMatrix(true, false);
    this.root.updateWorldMatrix(true, true);
    this.wheelInverse.copy(storage.root.matrixWorld).invert();
    storage.wheels.begin();
    for (const [wheel, corner] of ['FL', 'FR', 'RL', 'RR'].entries()) {
      const instance = this.instances.get(corner)!;
      this.wheelTransform.multiplyMatrices(this.wheelInverse, instance.root.matrixWorld);
      storage.wheels.put(wheel, this.wheelTransform, level as 0 | 1 | 2);
    }
    storage.wheels.finish();
    this.wheelStorage = storage;
    this.wheelBatch = batch;
    this.wheelVersion = batch.instanceMatrix.version;
  }
  diagnostics() {
    const level = this.level as 0 | 1 | 2;
    return {
      assetId: 'A34',
      revision: manifest.revision,
      sha256: manifest.sha256,
      loaded: !this.disposed,
      instances: [...this.instances.keys()],
      lod: level,
      triangles: [...this.instances.values()].reduce(
        (n, v) => n + manifest.variants[v.variant].triangles[level],
        this.cableTriangles[level],
      ),
      cableTriangles: this.cableTriangles[level],
      libraryVariants: variants.length,
      display: 'STANDBY',
      heatingSimulation: false,
      bay: HERO_GARAGE.bayIndex + 1,
      finalArtApproved: false,
    };
  }
  /** Attached resources are owned by the renderer's normal graph cleanup. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    disposeGraph(this.root);
  }
}
export async function decodeTyreBlankets(
  bytes: Uint8Array<ArrayBuffer>,
  loader = new GLTFLoader(),
) {
  blanketDocument(bytes);
  if ((await digest(bytes)) !== manifest.sha256) throw new Error('A34 integrity check failed');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  return new TyreBlanketSet(gltf.scene);
}
export async function loadTyreBlankets(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  const poll = setInterval(() => {
    if (cancelled()) controller.abort();
  }, 50);
  let result: TyreBlanketSet | undefined;
  try {
    if (cancelled()) throw aborted();
    const response = await fetcher(
      url ?? new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      { signal: controller.signal },
    );
    if (!response.ok || !response.body)
      throw new Error(`Unable to load A34 blankets (${response.status})`);
    const reader = response.body.getReader(),
      bytes = new Uint8Array(manifest.bytes);
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (cancelled() || controller.signal.aborted) throw aborted();
        if (done) break;
        if (size + value.length > bytes.length) throw new Error('A34 download exceeds byte budget');
        bytes.set(value, size);
        size += value.length;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (size !== bytes.length) throw new Error('Truncated A34 download');
    result = await decodeTyreBlankets(bytes);
    if (cancelled() || controller.signal.aborted) throw aborted();
    return result;
  } catch (error) {
    result?.dispose();
    throw error;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }
}
