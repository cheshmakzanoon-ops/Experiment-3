import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './wheel-gun.manifest.json' with { type: 'json' };
import { detailDistance } from './view-detail.ts';

export const WHEEL_GUN = manifest;
export const WHEEL_GUN_PARTS = ['BODY', 'TRIGGER', 'SOCKET'] as const;
export type GunSocket = keyof typeof manifest.sockets;
const unit = new T.Vector3(1, 1, 1);
const pivot = new T.Vector3();
const rotation = new T.Quaternion();
const xAxis = new T.Vector3(1, 0, 0);
const zAxis = new T.Vector3(0, 0, 1);
const aborted = () => new DOMException('Wheel-gun loading cancelled', 'AbortError');
interface GunDocument {
  asset: { version: string };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: {
    name: string;
    children?: number[];
    mesh?: number;
    translation?: number[];
    rotation?: number[];
  }[];
  meshes: {
    primitives: {
      indices: number;
      attributes: Record<string, number>;
      material: number;
      mode: number;
    }[];
  }[];
  accessors: { count: number; componentType: number; type: string }[];
  buffers: { byteLength: number; uri?: string }[];
  images: { uri?: string; bufferView: number; mimeType: string }[];
  materials: { name: string }[];
}
/** Structural checks precede texture/mesh decoding; integrity checks precede the loader. */
export function wheelGunDocument(bytes: Uint8Array<ArrayBuffer>): GunDocument {
  if (bytes.length !== manifest.bytes || bytes.length < 28)
    throw new Error('Wheel-gun byte count mismatch');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    length > bytes.length - 28 ||
    length % 4 !== 0 ||
    view.getUint32(24 + length, true) !== 0x004e4942 ||
    view.getUint32(20 + length, true) !== bytes.length - 28 - length
  )
    throw new Error('Invalid wheel-gun GLB header');
  const d: GunDocument = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
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
    d.buffers[0].byteLength !== bytes.length - 28 - length ||
    d.images.some(
      (i) => i.uri !== undefined || !Number.isInteger(i.bufferView) || i.mimeType !== 'image/png',
    )
  )
    throw new Error('Invalid self-contained wheel-gun contract');
  for (const name of [
    'AUREL_WHEEL_GUN',
    ...Object.keys(manifest.sockets),
    ...[0, 1, 2].map((i) => `A31_LOD${i}`),
  ])
    if (d.nodes.filter((n) => n.name === name).length !== 1)
      throw new Error(`Missing or duplicate wheel-gun node ${name}`);
  for (const level of [0, 1, 2] as const) {
    let count = 0;
    const group = d.nodes.find((n) => n.name === `A31_LOD${level}`)!;
    if (group.children?.length !== 3) throw new Error('Invalid wheel-gun LOD hierarchy');
    for (const part of WHEEL_GUN_PARTS) {
      const ni = d.nodes.findIndex((n) => n.name === `A31_LOD${level}_${part}`);
      if (!group.children.includes(ni)) throw new Error('Missing wheel-gun moving part');
      const ps = d.meshes[d.nodes[ni].mesh ?? -1]?.primitives;
      if (ps?.length !== 1 || ps[0].material !== 0 || ps[0].mode !== 4)
        throw new Error('Invalid wheel-gun primitive');
      const p = ps[0],
        indices = d.accessors[p.indices];
      if (!indices?.count || indices.count % 3 || ![5123, 5125].includes(indices.componentType))
        throw new Error('Invalid wheel-gun triangles');
      for (const a of ['POSITION', 'NORMAL', 'TEXCOORD_0'])
        if (!d.accessors[p.attributes[a]]?.count)
          throw new Error('Missing wheel-gun vertex attributes');
      count += indices.count / 3;
    }
    if (count !== manifest.triangles[level]) throw new Error('Wheel-gun LOD count mismatch');
  }
  for (const [name, spec] of Object.entries(manifest.sockets)) {
    const node = d.nodes.find((n) => n.name === name)!;
    for (const [actual, expected] of [
      [node.translation, spec.position],
      [node.rotation, spec.quaternion],
    ])
      if (
        !actual ||
        actual.length !== expected!.length ||
        actual.some((v, i) => !Number.isFinite(v) || Math.abs(v - expected![i]) > 1e-6)
      )
        throw new Error(`Invalid wheel-gun socket ${name}`);
  }
  return d;
}
export function gunSocketMatrix(name: GunSocket, out: T.Matrix4): T.Matrix4 {
  const spec = manifest.sockets[name];
  return out.compose(
    pivot.fromArray(spec.position),
    rotation.fromArray(spec.quaternion).normalize(),
    unit,
  );
}
export function wheelGunLod(distance: number, previous = -1, fov = 58, aspect = 16 / 9): 0 | 1 | 2 {
  const d = detailDistance(distance, fov, aspect);
  if (previous === 0 && d < 5.6) return 0;
  if (previous === 2 && d > 13.2) return 2;
  return d < 5 ? 0 : d < 15 ? 1 : 2;
}
/** Fixed-capacity instancing shares all PBR maps. Three independently pivoted
 * parts per LOD, never one scene object/material per mechanic. No simulation state. */
export class WheelGunBatches {
  readonly batches: T.InstancedMesh[] = [];
  readonly matrices: Float64Array;
  readonly levels: Int8Array;
  private readonly triggers: Float32Array;
  private readonly angles: Float32Array;
  private readonly socketScales: Float32Array;
  private readonly partScale = new T.Vector3(1, 1, 1);
  private readonly local = new T.Matrix4();
  private readonly world = new T.Matrix4();
  private readonly composed = new T.Matrix4();
  private readonly position = new T.Vector3();
  private readonly previousCamera = new T.Vector3(Infinity, Infinity, Infinity);
  private oldFov = -1;
  private oldAspect = -1;
  private dirty = true;
  private disposed = false;
  count = 0;
  uploads = 0;
  constructor(
    readonly prototype: T.Group,
    readonly capacity = 48,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 48)
      throw new Error('Invalid wheel-gun capacity');
    this.matrices = new Float64Array(capacity * 16);
    this.triggers = new Float32Array(capacity);
    this.angles = new Float32Array(capacity);
    this.socketScales = new Float32Array(capacity).fill(1);
    this.levels = new Int8Array(capacity).fill(-1);
    prototype.updateMatrixWorld(true);
    const box = new T.Box3().setFromObject(prototype);
    const expected = new T.Box3(
      new T.Vector3().fromArray(manifest.bounds.min),
      new T.Vector3().fromArray(manifest.bounds.max),
    ).expandByScalar(1e-5);
    if (!expected.containsBox(box) || box.getSize(this.position).length() < 0.3)
      throw new Error('Wheel-gun bounds mismatch');
    for (let level = 0; level < 3; level++)
      for (const part of WHEEL_GUN_PARTS) {
        const mesh = prototype.getObjectByName(`A31_LOD${level}_${part}`);
        if (!(mesh instanceof T.Mesh) || !(mesh.material instanceof T.MeshStandardMaterial))
          throw new Error('Missing wheel-gun mesh/material');
        const batch = new T.InstancedMesh(mesh.geometry, mesh.material, capacity);
        batch.name = `A31 ${part} LOD${level}`;
        batch.count = 0;
        batch.frustumCulled = false; // PitPoseCache handles physical per-car culling.
        batch.castShadow = batch.receiveShadow = true;
        batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
        batch.userData.a31 = { level, part };
        this.batches.push(batch);
      }
  }
  begin() {
    this.count = 0;
    this.dirty = true;
  }
  put(world: T.Matrix4, trigger = 0, socketAngle = 0, socketScale = 1) {
    if (this.disposed || this.count >= this.capacity)
      throw new Error('Wheel-gun capacity exceeded or disposed');
    if (
      !world.elements.every(Number.isFinite) ||
      world.determinant() <= 0 ||
      !Number.isFinite(trigger + socketAngle + socketScale) ||
      socketScale < 1 ||
      socketScale > 1.7 ||
      trigger < 0 ||
      trigger > 1
    )
      throw new Error('Invalid wheel-gun pose');
    world.toArray(this.matrices, this.count * 16);
    this.triggers[this.count] = trigger;
    this.angles[this.count] = socketAngle;
    this.socketScales[this.count] = socketScale;
    this.count++;
    this.dirty = true;
  }
  /** Camera-only changes still update the prop LOD when the crew pose is cached. */
  setView(camera: T.Vector3, fov = 58, aspect = 16 / 9) {
    if (!Number.isFinite(camera.lengthSq())) throw new Error('Invalid wheel-gun camera');
    detailDistance(0, fov, aspect);
    if (
      !this.dirty &&
      camera.equals(this.previousCamera) &&
      fov === this.oldFov &&
      aspect === this.oldAspect
    )
      return;
    let changed = this.dirty;
    for (let i = 0; i < this.count; i++) {
      this.world.fromArray(this.matrices, i * 16);
      const d = this.position.setFromMatrixPosition(this.world).distanceTo(camera);
      const level = wheelGunLod(d, this.levels[i], fov, aspect);
      changed ||= level !== this.levels[i];
      this.levels[i] = level;
    }
    this.previousCamera.copy(camera);
    this.oldFov = fov;
    this.oldAspect = aspect;
    if (!changed) return;
    for (const batch of this.batches) batch.count = 0;
    for (let i = 0; i < this.count; i++) {
      this.world.fromArray(this.matrices, i * 16);
      for (let j = 0; j < 3; j++) {
        const part = WHEEL_GUN_PARTS[j],
          p = manifest.pivots[part];
        rotation.setFromAxisAngle(
          j === 1 ? xAxis : zAxis,
          j === 1 ? this.triggers[i] * manifest.triggerRadians : j === 2 ? this.angles[i] : 0,
        );
        this.partScale.set(
          j === 2 ? this.socketScales[i] : 1,
          j === 2 ? this.socketScales[i] : 1,
          1,
        );
        this.local.compose(pivot.fromArray(p), rotation, this.partScale);
        this.composed.multiplyMatrices(this.world, this.local);
        const batch = this.batches[this.levels[i] * 3 + j];
        batch.setMatrixAt(batch.count++, this.composed);
      }
    }
    for (const batch of this.batches) {
      batch.instanceMatrix.clearUpdateRanges();
      if (batch.count) {
        batch.instanceMatrix.addUpdateRange(0, batch.count * 16);
        batch.instanceMatrix.needsUpdate = true;
      }
    }
    this.dirty = false;
    this.uploads++;
  }
  socketTransform(index: number, name: GunSocket, out: T.Matrix4) {
    if (!Number.isInteger(index) || index < 0 || index >= this.count)
      throw new Error('Invalid wheel-gun index');
    this.world.fromArray(this.matrices, index * 16);
    return out.multiplyMatrices(this.world, gunSocketMatrix(name, this.local));
  }
  diagnostics() {
    const counts = [0, 0, 0];
    for (let i = 0; i < this.count; i++) if (this.levels[i] >= 0) counts[this.levels[i]]++;
    return {
      assetId: 'A31',
      revision: manifest.revision,
      sha256: manifest.sha256,
      capacity: this.capacity,
      instances: this.count,
      lodCounts: counts,
      drawBatches: this.batches.filter((b) => b.count > 0).length,
      triangles: counts.reduce((n, v, i) => n + v * manifest.triangles[i as 0 | 1 | 2], 0),
      uploads: this.uploads,
      finalArtApproved: false,
    };
  }
  /** Detached ownership only; attached batches are disposed by RacingRenderer. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    disposeGunPrototype(this.prototype);
    this.batches.forEach((b) => b.dispose());
  }
}
function disposeGunPrototype(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m);
      for (const v of Object.values(m)) if (v instanceof T.Texture) textures.add(v);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => {
    t.dispose();
    if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close();
  });
}
export async function decodeWheelGuns(bytes: Uint8Array<ArrayBuffer>, loader = new GLTFLoader()) {
  wheelGunDocument(bytes);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
  if (digest !== manifest.sha256) throw new Error('Wheel-gun integrity check failed');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  try {
    return new WheelGunBatches(gltf.scene);
  } catch (error) {
    disposeGunPrototype(gltf.scene);
    throw error;
  }
}
export async function loadWheelGuns(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  const poll = setInterval(() => {
    if (cancelled()) controller.abort();
  }, 50);
  let guns: WheelGunBatches | undefined;
  try {
    if (cancelled()) throw aborted();
    const response = await fetcher(
      url ?? new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      { signal: controller.signal },
    );
    if (!response.ok || !response.body)
      throw new Error(`Unable to load authored wheel gun (${response.status})`);
    const reader = response.body.getReader(),
      bytes = new Uint8Array(manifest.bytes);
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled() || controller.signal.aborted) throw aborted();
        if (size + value.length > bytes.length)
          throw new Error('Wheel-gun download exceeds byte budget');
        bytes.set(value, size);
        size += value.length;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (size !== bytes.length) throw new Error('Truncated wheel-gun download');
    if (cancelled() || controller.signal.aborted) throw aborted();
    guns = await decodeWheelGuns(bytes);
    if (cancelled() || controller.signal.aborted) throw aborted();
    return guns;
  } catch (error) {
    guns?.dispose();
    throw error;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }
}

/** Two stowed tools on the existing A22 worktops. The garage and tools retain
 * independent editable source; neither source model is rebaked into the other. */
export class WheelGunStorage {
  readonly root = new T.Group();
  readonly guns: WheelGunBatches;
  private readonly cameraLocal = new T.Vector3();
  constructor(prototype: T.Group, garage: T.Group) {
    this.guns = new WheelGunBatches(prototype, 2);
    this.root.name = 'A31 stowed worktop tools';
    this.root.userData.a31Storage = true;
    this.root.add(...this.guns.batches);
    garage.add(this.root);
    const q = new T.Quaternion().setFromEuler(new T.Euler(0, Math.PI / 2, Math.PI / 2));
    this.guns.begin();
    for (const side of [-1, 1])
      this.guns.put(new T.Matrix4().compose(new T.Vector3(4.0, 1.243, side * 3.3), q, unit));
    this.guns.setView(new T.Vector3(4, 1, 0));
  }
  update(camera: T.PerspectiveCamera) {
    this.root.worldToLocal(this.cameraLocal.copy(camera.position));
    this.guns.setView(this.cameraLocal, camera.fov, camera.aspect);
  }
}
