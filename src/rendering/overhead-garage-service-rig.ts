import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './overhead-garage-service-rig.manifest.json' with { type: 'json' };

export const OVERHEAD_SERVICE_RIG = manifest;
interface RigDocument {
  asset: { version: string };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: { name?: string; children?: number[]; mesh?: number }[];
  meshes: {
    primitives: { indices: number; attributes: Record<string, number>; mode?: number }[];
  }[];
  accessors: { count: number }[];
  buffers: { byteLength: number; uri?: string }[];
  images?: { uri?: string }[];
  materials: { name: string }[];
  extensionsRequired?: string[];
}
const abort = () => new DOMException('A26 loading cancelled', 'AbortError');
const hash = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');

/** Inspect the exact, self-contained file before any resource loading occurs. */
export function overheadDocument(bytes: Uint8Array<ArrayBuffer>): RigDocument {
  if (bytes.length !== manifest.bytes || bytes.length < 28)
    throw new Error('A26 byte count mismatch');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = v.getUint32(12, true);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length ||
    v.getUint32(16, true) !== 0x4e4f534a ||
    len % 4 ||
    len > bytes.length - 28 ||
    v.getUint32(24 + len, true) !== 0x004e4942 ||
    28 + len + v.getUint32(20 + len, true) !== bytes.length
  )
    throw new Error('Invalid A26 GLB header');
  const d = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as RigDocument;
  if (
    d.asset?.version !== '2.0' ||
    d.scene !== 0 ||
    d.scenes?.length !== 1 ||
    d.nodes?.length !== manifest.nodes ||
    d.meshes?.length !== manifest.meshes ||
    d.materials?.length !== manifest.materials ||
    (d.images?.length ?? 0) !== 0 ||
    d.buffers?.length !== 1 ||
    d.buffers[0].uri !== undefined ||
    d.buffers[0].byteLength > bytes.length - 28 - len ||
    (d.extensionsRequired ?? []).length > 0 ||
    !Array.isArray(d.accessors)
  )
    throw new Error('Invalid self-contained A26 contract');
  for (const name of [
    'A26_SERVICE_RIG',
    'A26_LOD0',
    'A26_LOD1',
    'A26_LOD2',
    ...Object.keys(manifest.sockets),
  ])
    if (d.nodes.filter((n) => n.name === name).length !== 1)
      throw new Error(`Missing or duplicate A26 node ${name}`);
  for (const level of [0, 1, 2] as const) {
    const lod = d.nodes.find((n) => n.name === `A26_LOD${level}`)!;
    if (!lod.children?.length || lod.children.length > manifest.maxDrawCallsPerLevel)
      throw new Error('Invalid A26 draw-call budget');
    let triangles = 0;
    for (const index of lod.children) {
      const node = d.nodes[index];
      if (!node?.name?.startsWith(`A26_L${level}_`)) throw new Error('Invalid A26 hierarchy');
      const primitives = d.meshes[node.mesh ?? -1]?.primitives;
      if (primitives?.length !== 1) throw new Error('Unbatched A26 surfaces');
      for (const p of primitives) {
        const count = d.accessors[p.indices]?.count;
        if (
          !count ||
          count % 3 ||
          (p.mode !== undefined && p.mode !== 4) ||
          p.attributes.POSITION === undefined ||
          p.attributes.NORMAL === undefined ||
          p.attributes.TEXCOORD_0 === undefined
        )
          throw new Error('Invalid A26 triangles/UVs');
        triangles += count / 3;
      }
    }
    if (triangles !== manifest.triangles[level]) throw new Error('A26 LOD count mismatch');
  }
  return d;
}

const boxFrom = (b: { min: number[]; max: number[] }) =>
  new T.Box3(new T.Vector3().fromArray(b.min), new T.Vector3().fromArray(b.max));

function resources(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>();
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
  });
  return { geometries, materials };
}

/** Owns static A26 surfaces. Live race state, collisions and camera state are not touched. */
export class OverheadServiceRig {
  readonly levels: T.Object3D[];
  private readonly owned: ReturnType<typeof resources>;
  private readonly lamps: T.MeshStandardMaterial[] = [];
  private disposed = false;
  private attached = false;
  constructor(readonly root: T.Group) {
    this.owned = resources(root);
    this.levels = [0, 1, 2].map((i) => {
      const level = root.getObjectByName(`A26_LOD${i}`);
      if (!level) throw new Error('Missing A26 LOD');
      return level;
    });
    root.updateMatrixWorld(true);
    const envelope = boxFrom(manifest.localBounds),
      corridor = boxFrom(manifest.protectedOpening);
    const triangle = new T.Triangle(),
      bounds = new T.Box3();
    const found = new Set<T.Material>();
    root.traverse((o) => {
      if (!o.matrixWorld.elements.every(Number.isFinite) || o.matrixWorld.determinant() <= 0)
        throw new Error('Invalid A26 transform');
      if (!(o instanceof T.Mesh)) return;
      const g = o.geometry,
        position = g.getAttribute('position'),
        indices = g.index;
      if (!position || !indices || !g.getAttribute('uv')) throw new Error('Missing A26 geometry');
      if (!Array.from(position.array).every(Number.isFinite))
        throw new Error('Non-finite A26 vertex');
      g.computeBoundingBox();
      g.computeBoundingSphere();
      bounds.copy(g.boundingBox!).applyMatrix4(o.matrixWorld);
      if (!envelope.containsBox(bounds)) throw new Error('A26 exceeds retained garage envelope');
      if (bounds.intersectsBox(corridor)) {
        for (let i = 0; i < indices.count; i += 3) {
          triangle.a.fromBufferAttribute(position, indices.getX(i)).applyMatrix4(o.matrixWorld);
          triangle.b.fromBufferAttribute(position, indices.getX(i + 1)).applyMatrix4(o.matrixWorld);
          triangle.c.fromBufferAttribute(position, indices.getX(i + 2)).applyMatrix4(o.matrixWorld);
          if (corridor.intersectsTriangle(triangle)) throw new Error('A26 blocks garage passage');
        }
      }
      o.castShadow = true;
      o.receiveShadow = true;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (found.has(m)) continue;
        found.add(m);
        if (m instanceof T.MeshStandardMaterial && m.name === 'A26_LightDiffusers')
          this.lamps.push(m);
      }
    });
    for (const [name, point] of Object.entries(manifest.sockets)) {
      const socket = root.getObjectByName(name);
      if (
        !socket ||
        socket.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3().fromArray(point)) > 1e-5
      )
        throw new Error('Invalid A26 socket');
    }
    for (const o of [root, root.getObjectByName('A26_SERVICE_RIG')!, ...this.levels]) {
      if (
        !o ||
        o.position.length() > 1e-6 ||
        o.quaternion.angleTo(new T.Quaternion()) > 1e-6 ||
        o.scale.distanceTo(new T.Vector3(1, 1, 1)) > 1e-6
      )
        throw new Error('A26 attachment is not identity');
    }
    this.levels.forEach((o, i) => {
      o.visible = i === 0;
    });
  }
  /** Transfer each level to its matching A22 level; sockets remain in the shared local frame. */
  attachTo(garage: T.Group, levels: T.Object3D[]) {
    if (this.disposed || this.attached) throw new Error('A26 already attached or disposed');
    if (levels.length !== 3 || levels.some((o, i) => o.name !== `GARAGE_LOD${i}`))
      throw new Error('Missing matching garage LODs');
    this.levels.forEach((o, i) => {
      levels[i].add(o);
      o.visible = true;
    });
    garage.add(this.root);
    this.attached = true;
  }
  updateLighting(lighting: 'day' | 'sunset' | 'night') {
    if (this.disposed) return;
    for (const lamp of this.lamps)
      lamp.emissiveIntensity = lighting === 'night' ? 2.2 : lighting === 'sunset' ? 1.1 : 0.5;
  }
  diagnostics(level = 0) {
    const lod = level === 1 || level === 2 ? level : 0;
    return {
      assetId: 'A26',
      revision: manifest.revision,
      sha256: manifest.sha256,
      loaded: !this.disposed,
      attached: this.attached,
      lod,
      triangles: manifest.triangles[lod],
      sockets: Object.keys(manifest.sockets),
      lightingHousings: 8,
      reels: 3,
      finalArtApproved: false,
    };
  }
  /** Detach first, so a following garage traversal cannot dispose these resources twice. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.levels.forEach((o) => o.removeFromParent());
    this.root.removeFromParent();
    this.owned.geometries.forEach((g) => g.dispose());
    this.owned.materials.forEach((m) => m.dispose());
  }
}

export async function decodeOverheadServiceRig(
  bytes: Uint8Array<ArrayBuffer>,
  loader = new GLTFLoader(),
) {
  overheadDocument(bytes);
  if ((await hash(bytes)) !== manifest.sha256) throw new Error('A26 integrity check failed');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  try {
    return new OverheadServiceRig(gltf.scene);
  } catch (error) {
    const owned = resources(gltf.scene);
    owned.geometries.forEach((g) => g.dispose());
    owned.materials.forEach((m) => m.dispose());
    throw error;
  }
}

/** Exact-size transfer, deadline, cancellation and explicit failure; no fallback art. */
export async function loadOverheadServiceRig(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const poll = setInterval(() => {
    if (cancelled()) controller.abort();
  }, 50);
  let rig: OverheadServiceRig | undefined;
  try {
    if (cancelled()) throw abort();
    const response = await fetcher(
      url ?? new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      { signal: controller.signal },
    );
    if (!response.ok || !response.body) throw new Error(`A26 download failed (${response.status})`);
    const reader = response.body.getReader(),
      bytes = new Uint8Array(manifest.bytes);
    let size = 0;
    try {
      while (true) {
        if (cancelled() || controller.signal.aborted) throw abort();
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.length > bytes.length) throw new Error('A26 transfer exceeds byte budget');
        bytes.set(value, size);
        size += value.length;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (size !== bytes.length) throw new Error('Truncated A26 transfer');
    if (cancelled() || controller.signal.aborted) throw abort();
    rig = await decodeOverheadServiceRig(bytes);
    if (cancelled() || controller.signal.aborted) throw abort();
    return rig;
  } catch (error) {
    rig?.dispose();
    throw error;
  } finally {
    clearTimeout(timeout);
    clearInterval(poll);
  }
}
