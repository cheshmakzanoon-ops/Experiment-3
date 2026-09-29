import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './a32-pit-jacks.manifest.json' with { type: 'json' };
import { detailDistance } from './view-detail.ts';
import type { A32JackPose, JackRole } from './a32-jack-pose.ts';

export const PIT_JACKS = manifest;
export const JACK_PARTS = ['FRAME', 'LEVER', 'PAD', 'WHEELS'] as const;
const ROLES = ['front', 'rear'] as const;
interface JackDocument {
  asset: { version: string };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: {
    name: string;
    mesh?: number;
    children?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  meshes: {
    primitives: {
      indices: number;
      attributes: Record<string, number>;
      material: number;
      mode?: number;
    }[];
  }[];
  accessors: { count: number; componentType: number; type: string }[];
  buffers: { byteLength: number; uri?: string }[];
  images: { bufferView: number; uri?: string; mimeType: string }[];
  materials: { name: string }[];
}
/** Validate the bounded, self-contained GLB before any texture decoder runs. */
export function pitJackDocument(bytes: Uint8Array<ArrayBuffer>): JackDocument {
  if (bytes.length !== manifest.bytes || bytes.length < 28)
    throw new Error('A32 byte count mismatch');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = v.getUint32(12, true);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length ||
    v.getUint32(16, true) !== 0x4e4f534a ||
    length % 4 ||
    length > bytes.length - 28 ||
    v.getUint32(length + 24, true) !== 0x004e4942 ||
    v.getUint32(length + 20, true) !== bytes.length - length - 28
  )
    throw new Error('Invalid A32 GLB header');
  const d: JackDocument = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  if (
    d.asset?.version !== '2.0' ||
    d.scene !== 0 ||
    d.scenes?.length !== 1 ||
    d.nodes?.length !== manifest.nodes ||
    d.meshes?.length !== manifest.meshes ||
    d.materials?.length !== 1 ||
    d.images?.length !== 3 ||
    d.buffers?.length !== 1 ||
    d.buffers[0].uri !== undefined ||
    Math.abs(d.buffers[0].byteLength - (bytes.length - length - 28)) > 3 ||
    d.images.some(
      (i) => i.uri !== undefined || !Number.isInteger(i.bufferView) || i.mimeType !== 'image/png',
    )
  )
    throw new Error('Invalid self-contained A32 contract');
  const byName = new Map<string, number>();
  d.nodes.forEach((n, i) => {
    if (!n.name || byName.has(n.name)) throw new Error('Duplicate or unnamed A32 node');
    byName.set(n.name, i);
    if (
      (n.scale && n.scale.some((s) => !Number.isFinite(s) || Math.abs(s - 1) > 1e-6)) ||
      n.translation?.some((s) => !Number.isFinite(s))
    )
      throw new Error('Invalid A32 node transform');
  });
  const child = (name: string, parent: string, expected?: number[]) => {
    const index = byName.get(name),
      p = byName.get(parent);
    if (index === undefined || p === undefined || !d.nodes[p].children?.includes(index))
      throw new Error(`Missing A32 hierarchy: ${parent}/${name}`);
    const node = d.nodes[index];
    if (expected && expected.some((x, i) => Math.abs(x - (node.translation?.[i] ?? 0)) > 1e-6))
      throw new Error(`Invalid A32 pivot/socket: ${name}`);
    return node;
  };
  if (!byName.has('A32_PIT_JACKS')) throw new Error('Missing A32 family root');
  for (const role of ROLES) {
    const prefix = `A32_${role.toUpperCase()}`,
      root = `${prefix}_ROOT`,
      spec = manifest.kinematics[role];
    child(root, 'A32_PIT_JACKS');
    for (const part of JACK_PARTS) {
      const point =
        part === 'LEVER'
          ? spec.pivot
          : part === 'WHEELS'
            ? spec.wheelPivot
            : part === 'PAD'
              ? [0, 0, spec.length]
              : [0, 0, 0];
      child(`${prefix}_${part}_PIVOT`, part === 'PAD' ? `${prefix}_LEVER_PIVOT` : root, point);
    }
    for (const level of [0, 1, 2, 3] as const) {
      let triangles = 0;
      for (const part of JACK_PARTS) {
        const node = child(`${prefix}_${part}_LOD${level}`, `${prefix}_${part}_PIVOT`, [0, 0, 0]);
        const ps = d.meshes[node.mesh ?? -1]?.primitives;
        if (ps?.length !== 1 || ps[0].material !== 0 || (ps[0].mode ?? 4) !== 4)
          throw new Error('Invalid A32 material batching');
        const primitive = ps[0],
          a = d.accessors[primitive.indices];
        if (!a?.count || a.count % 3 || ![5123, 5125].includes(a.componentType))
          throw new Error('Invalid A32 triangles');
        for (const attr of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'TANGENT'])
          if (!d.accessors[primitive.attributes[attr]]?.count)
            throw new Error('Missing A32 vertex attribute');
        triangles += a.count / 3;
      }
      if (triangles !== manifest.triangles[role][level]) throw new Error('A32 LOD count mismatch');
    }
    child(`SOCKET_${prefix}_CONTACT`, `${prefix}_PAD_PIVOT`, [0, spec.padTop, 0]);
    child(`SOCKET_${prefix}_GROUND`, `${prefix}_FRAME_PIVOT`, [0, 0, 0]);
    child(`SOCKET_${prefix}_STOW`, `${prefix}_FRAME_PIVOT`, [0, 0, 0]);
    for (const [side, sign] of [
      ['L', -1],
      ['R', 1],
    ] as const) {
      child(`SOCKET_${prefix}_GRIP_${side}`, `${prefix}_LEVER_PIVOT`, [
        (sign * spec.gripSpacing) / 2,
        spec.grip[1],
        spec.grip[2],
      ]);
      child(`SOCKET_${prefix}_WHEEL_${side}_GROUND`, `${prefix}_FRAME_PIVOT`, [
        (sign * spec.width) / 2,
        0,
        spec.wheelPivot[2],
      ]);
    }
  }
  return d;
}
export function pitJackLod(
  distance: number,
  previous = -1,
  fov = 58,
  aspect = 16 / 9,
): 0 | 1 | 2 | 3 {
  const d = detailDistance(distance, fov, aspect),
    breaks = [6, 16, 42];
  if (
    previous >= 0 &&
    previous <= 3 &&
    (previous === 0 || d >= breaks[previous - 1] * 0.88) &&
    (previous === 3 || d < breaks[previous] * 1.12)
  )
    return previous as 0 | 1 | 2 | 3;
  return d < 6 ? 0 : d < 16 ? 1 : d < 42 ? 2 : 3;
}
/** At most 24 jack instances. Shared geometry/atlas, four independently moving
 * part draws per role/LOD. Mirrors and shadows consume the same presented pose. */
export class PitJackBatches {
  readonly batches: T.InstancedMesh[] = [];
  readonly levels: Int8Array;
  readonly matrices: Float64Array;
  private readonly roles: Uint8Array;
  private readonly positions: Float64Array;
  private readonly world = new T.Matrix4();
  private readonly center = new T.Vector3();
  private readonly previousCamera = new T.Vector3(Infinity, Infinity, Infinity);
  private oldFov = -1;
  private oldAspect = -1;
  private dirty = true;
  private disposed = false;
  count = 0;
  uploads = 0;
  constructor(
    readonly prototype: T.Group,
    readonly capacity = 24,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 24)
      throw new Error('Invalid A32 capacity');
    this.levels = new Int8Array(capacity).fill(-1);
    this.roles = new Uint8Array(capacity);
    this.positions = new Float64Array(capacity * 3);
    this.matrices = new Float64Array(capacity * 4 * 16);
    for (const role of ROLES)
      for (let level = 0; level < 4; level++)
        for (const part of JACK_PARTS) {
          const mesh = prototype.getObjectByName(`A32_${role.toUpperCase()}_${part}_LOD${level}`);
          if (!(mesh instanceof T.Mesh) || !(mesh.material instanceof T.MeshStandardMaterial))
            throw new Error('Missing A32 mesh or PBR material');
          mesh.geometry.computeBoundingBox();
          mesh.geometry.computeBoundingSphere();
          if (
            !Number.isFinite(mesh.geometry.boundingSphere!.radius) ||
            mesh.geometry.boundingSphere!.radius <= 0
          )
            throw new Error('Invalid A32 geometry bounds');
          const batch = new T.InstancedMesh(mesh.geometry, mesh.material, capacity);
          batch.name = `A32 ${role} ${part} LOD${level}`;
          batch.userData.a32 = { role, part, level };
          batch.count = 0;
          batch.frustumCulled = false; // Existing physical pit-service eligibility owns culling.
          batch.castShadow = batch.receiveShadow = true;
          batch.instanceMatrix.setUsage(T.DynamicDrawUsage);
          this.batches.push(batch);
        }
  }
  begin() {
    if (this.disposed) throw new Error('A32 is disposed');
    this.count = 0;
    this.dirty = true;
  }
  put(role: JackRole, pose: A32JackPose, carWorld: T.Matrix4) {
    if (this.disposed || this.count >= this.capacity)
      throw new Error('A32 capacity exceeded or disposed');
    if (
      !ROLES.includes(role) ||
      !carWorld.elements.every(Number.isFinite) ||
      carWorld.determinant() <= 0 ||
      pose.parts.some((m) => !m.elements.every(Number.isFinite) || m.determinant() <= 0)
    )
      throw new Error('Invalid A32 pose');
    this.roles[this.count] = role === 'front' ? 0 : 1;
    this.center
      .copy(pose.contact)
      .applyMatrix4(carWorld)
      .toArray(this.positions, this.count * 3);
    for (let part = 0; part < 4; part++)
      this.world
        .multiplyMatrices(carWorld, pose.parts[part])
        .toArray(this.matrices, (this.count * 4 + part) * 16);
    this.count++;
    this.dirty = true;
  }
  setView(camera: T.Vector3, fov = 58, aspect = 16 / 9) {
    if (this.disposed || !Number.isFinite(camera.lengthSq())) throw new Error('Invalid A32 view');
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
      const level = pitJackLod(
        this.center.fromArray(this.positions, i * 3).distanceTo(camera),
        this.levels[i],
        fov,
        aspect,
      );
      changed ||= level !== this.levels[i];
      this.levels[i] = level;
    }
    this.previousCamera.copy(camera);
    this.oldFov = fov;
    this.oldAspect = aspect;
    if (!changed) return;
    for (const b of this.batches) b.count = 0;
    for (let i = 0; i < this.count; i++)
      for (let part = 0; part < 4; part++) {
        const b = this.batches[this.roles[i] * 16 + this.levels[i] * 4 + part];
        b.setMatrixAt(b.count++, this.world.fromArray(this.matrices, (i * 4 + part) * 16));
      }
    for (const b of this.batches) {
      b.instanceMatrix.clearUpdateRanges();
      if (b.count) {
        b.instanceMatrix.addUpdateRange(0, b.count * 16);
        b.instanceMatrix.needsUpdate = true;
      }
    }
    this.dirty = false;
    this.uploads++;
  }
  diagnostics() {
    const counts = { front: [0, 0, 0, 0], rear: [0, 0, 0, 0] };
    for (let i = 0; i < this.count; i++)
      if (this.levels[i] >= 0) counts[ROLES[this.roles[i]]][this.levels[i]]++;
    return {
      assetId: 'A32',
      revision: manifest.revision,
      sha256: manifest.sha256,
      instances: this.count,
      lodCounts: counts,
      drawBatches: this.batches.filter((b) => b.count > 0).length,
      triangles: ROLES.reduce(
        (n, r) =>
          n + counts[r].reduce((a, c, l) => a + c * manifest.triangles[r][l as 0 | 1 | 2 | 3], 0),
        0,
      ),
      uploads: this.uploads,
      finalArtApproved: false,
    };
  }
  /** Detached ownership only. Attached batches belong to RacingRenderer's traversal. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    disposePitJackPrototype(this.prototype);
    this.batches.forEach((b) => b.dispose());
  }
}
function disposePitJackPrototype(root: T.Object3D) {
  const gs = new Set<T.BufferGeometry>(),
    ms = new Set<T.Material>(),
    ts = new Set<T.Texture>();
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    gs.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      ms.add(m);
      for (const value of Object.values(m)) if (value instanceof T.Texture) ts.add(value);
    }
  });
  gs.forEach((g) => g.dispose());
  ms.forEach((m) => m.dispose());
  ts.forEach((t) => {
    t.dispose();
    if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close();
  });
}
export async function decodePitJacks(bytes: Uint8Array<ArrayBuffer>, loader = new GLTFLoader()) {
  pitJackDocument(bytes);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) =>
    v.toString(16).padStart(2, '0'),
  ).join('');
  if (hash !== manifest.sha256) throw new Error('A32 integrity check failed');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    '',
  );
  try {
    return new PitJackBatches(gltf.scene);
  } catch (error) {
    disposePitJackPrototype(gltf.scene);
    throw error;
  }
}
export async function loadPitJacks(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  const aborted = () => new DOMException('A32 loading cancelled', 'AbortError');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  const poll = setInterval(() => {
    if (cancelled()) controller.abort();
  }, 50);
  let jacks: PitJackBatches | undefined;
  try {
    if (cancelled()) throw aborted();
    const response = await fetcher(
      url ?? new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      { signal: controller.signal },
    );
    if (!response.ok || !response.body) throw new Error(`Unable to load A32 (${response.status})`);
    const reader = response.body.getReader(),
      bytes = new Uint8Array(manifest.bytes);
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled() || controller.signal.aborted) throw aborted();
        if (size + value.length > bytes.length) throw new Error('A32 transfer exceeds byte budget');
        bytes.set(value, size);
        size += value.length;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (size !== bytes.length) throw new Error('Truncated A32 download');
    if (cancelled() || controller.signal.aborted) throw aborted();
    jacks = await decodePitJacks(bytes);
    if (cancelled() || controller.signal.aborted) throw aborted();
    return jacks;
  } catch (error) {
    jacks?.dispose();
    throw error;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }
}
