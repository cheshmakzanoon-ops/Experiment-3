import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import manifest from './workshop-equipment.manifest.json' with { type: 'json' };

export const WORKSHOP_EQUIPMENT = manifest;
export type WorkshopKind = keyof typeof manifest.variants;
export interface WorkshopPlacement {
  readonly id: string;
  readonly kind: WorkshopKind;
  readonly position: readonly number[];
  readonly yaw: number;
}
const LEVELS = [0, 1, 2] as const;
const KINDS = Object.keys(manifest.variants) as WorkshopKind[];
const defaults = manifest.placements as WorkshopPlacement[];
const box = (b: { min: readonly number[]; max: readonly number[] }) =>
  new T.Box3(new T.Vector3().fromArray(b.min), new T.Vector3().fromArray(b.max));
const aborted = () => new DOMException('A36 loading cancelled', 'AbortError');

interface WorkshopDocument {
  asset: { version: string };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: { name?: string; children?: number[]; mesh?: number }[];
  meshes: {
    primitives: {
      attributes: Record<string, number>;
      indices: number;
      material: number;
      mode?: number;
    }[];
  }[];
  accessors: { count: number; componentType: number; type: string }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number }[];
  buffers: { byteLength: number; uri?: string }[];
  materials: unknown[];
  images: { uri?: string; bufferView: number; mimeType: string }[];
  extensionsRequired?: string[];
}

/** Check bounded, self-contained bytes before a loader can resolve resources. */
export function workshopDocument(bytes: Uint8Array<ArrayBuffer>): WorkshopDocument {
  if (bytes.length !== manifest.bytes || bytes.length < 28)
    throw new Error('A36 byte count mismatch');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = v.getUint32(12, true);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length ||
    v.getUint32(16, true) !== 0x4e4f534a ||
    length % 4 ||
    length > bytes.length - 28 ||
    v.getUint32(24 + length, true) !== 0x004e4942 ||
    28 + length + v.getUint32(20 + length, true) !== bytes.length
  )
    throw new Error('Invalid A36 GLB header');
  const d = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + length)),
  ) as WorkshopDocument;
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
    d.buffers[0].byteLength > bytes.length - 28 - length ||
    (d.extensionsRequired ?? []).length ||
    !Array.isArray(d.accessors) ||
    !Array.isArray(d.bufferViews) ||
    d.images.some(
      (i) => i.uri !== undefined || i.mimeType !== 'image/png' || !Number.isInteger(i.bufferView),
    )
  )
    throw new Error('Invalid self-contained A36 contract');
  for (const b of d.bufferViews) {
    const offset = b.byteOffset ?? 0;
    if (
      b.buffer !== 0 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(b.byteLength) ||
      b.byteLength <= 0 ||
      offset + b.byteLength > d.buffers[0].byteLength
    )
      throw new Error('Invalid A36 buffer range');
  }
  const seen = new Set<number>();
  const visit = (i: number) => {
    if (!Number.isInteger(i) || !d.nodes[i] || seen.has(i))
      throw new Error('Invalid A36 hierarchy');
    seen.add(i);
    for (const child of d.nodes[i].children ?? []) visit(child);
  };
  for (const i of d.scenes[0].nodes) visit(i);
  if (seen.size !== d.nodes.length) throw new Error('Unreachable A36 node');
  const required = ['A36_WORKSHOP_EQUIPMENT'];
  for (const kind of KINDS) {
    required.push(
      `A36_${kind}`,
      ...Object.keys(manifest.variants[kind].sockets).map((n) => `SOCKET_A36_${kind}_${n}`),
    );
    for (const level of LEVELS) {
      const name = `A36_${kind}_LOD${level}`;
      required.push(name);
      const node = d.nodes.find((n) => n.name === name);
      const primitives = d.meshes[node?.mesh ?? -1]?.primitives;
      if (primitives?.length !== 1) throw new Error('Unbatched A36 template');
      const p = primitives[0],
        count = d.accessors[p.indices];
      const position = d.accessors[p.attributes?.POSITION];
      if (
        p.material !== 0 ||
        (p.mode !== undefined && p.mode !== 4) ||
        count?.type !== 'SCALAR' ||
        count.componentType !== 5125 ||
        count.count !== manifest.variants[kind].triangles[level] * 3 ||
        position?.type !== 'VEC3' ||
        position.componentType !== 5126 ||
        d.accessors[p.attributes.NORMAL]?.count !== position.count ||
        d.accessors[p.attributes.TEXCOORD_0]?.count !== position.count
      )
        throw new Error('Invalid A36 template geometry');
    }
  }
  for (const name of required)
    if (d.nodes.filter((n) => n.name === name).length !== 1)
      throw new Error(`Missing or duplicate A36 node ${name}`);
  return d;
}

/** Audited garage-local footprints. These do not create physics obstacles. */
export function workshopPlacementBounds(placements: readonly WorkshopPlacement[] = defaults) {
  if (
    !placements.length ||
    placements.length > 16 ||
    new Set(placements.map((p) => p.id)).size !== placements.length
  )
    throw new Error('Invalid A36 placement count or identifiers');
  const envelope = box(manifest.garageEnvelope);
  const result = placements.map((p) => {
    if (
      !KINDS.includes(p.kind) ||
      !p.id ||
      p.position.length !== 3 ||
      !p.position.every(Number.isFinite) ||
      !Number.isFinite(p.yaw)
    )
      throw new Error('Invalid A36 placement transform');
    const matrix = new T.Matrix4().compose(
      new T.Vector3().fromArray(p.position),
      new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), p.yaw),
      new T.Vector3(1, 1, 1),
    );
    const bounds = box(manifest.variants[p.kind].bounds).applyMatrix4(matrix);
    if (!envelope.containsBox(bounds)) throw new Error('A36 exceeds garage work-zone envelope');
    for (const zone of manifest.reservedZones)
      if (bounds.intersectsBox(box(zone))) throw new Error(`A36 blocks ${zone.name}`);
    return { ...p, matrix, bounds };
  });
  for (let i = 0; i < result.length; i++)
    for (let j = i + 1; j < result.length; j++)
      if (result[i].bounds.intersectsBox(result[j].bounds))
        throw new Error('Overlapping A36 equipment');
  return result;
}

function resources(roots: readonly T.Object3D[]) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  for (const root of roots)
    root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      geometries.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        materials.add(m);
        for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
      }
    });
  return { geometries, materials, textures };
}
function release(owned: ReturnType<typeof resources>) {
  owned.geometries.forEach((g) => g.dispose());
  owned.materials.forEach((m) => m.dispose());
  owned.textures.forEach((t) => {
    t.dispose();
    if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close();
  });
}

function assemble(library: T.Group, placements: ReturnType<typeof workshopPlacementBounds>) {
  const root = new T.Group();
  root.name = 'Aurel workshop equipment / A36';
  root.userData.workshopEquipment = { assetId: 'A36', revision: manifest.revision };
  const templates = new Map<string, T.Mesh>();
  const materials = new Set<T.Material>();
  for (const kind of KINDS)
    for (const level of LEVELS) {
      const name = `A36_${kind}_LOD${level}`;
      const mesh = library.getObjectByName(name);
      if (
        !(mesh instanceof T.Mesh) ||
        Array.isArray(mesh.material) ||
        mesh.position.lengthSq() > 1e-12 ||
        mesh.quaternion.angleTo(new T.Quaternion()) > 1e-6 ||
        mesh.scale.distanceTo(new T.Vector3(1, 1, 1)) > 1e-6
      )
        throw new Error('Invalid A36 template transform');
      const g = mesh.geometry,
        positions = g.getAttribute('position'),
        normals = g.getAttribute('normal');
      if (
        !positions ||
        !normals ||
        !g.getAttribute('uv') ||
        !g.index ||
        g.index.count !== manifest.variants[kind].triangles[level] * 3 ||
        !Array.from(positions.array).every(Number.isFinite)
      )
        throw new Error('Invalid A36 surface');
      g.computeBoundingBox();
      if (!box(manifest.variants[kind].bounds).containsBox(g.boundingBox!))
        throw new Error('A36 template exceeds bounds');
      for (let i = 0; i < normals.count; i++) {
        const length = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i));
        if (!Number.isFinite(length) || Math.abs(length - 1) > 0.002)
          throw new Error('Invalid A36 normal');
      }
      materials.add(mesh.material);
      templates.set(name, mesh);
    }
  if (materials.size !== 1) throw new Error('A36 atlas material is not shared');
  const material = [...materials][0];
  try {
    for (const level of LEVELS) {
      const copies: T.BufferGeometry[] = [];
      try {
        for (const placement of placements)
          copies.push(
            templates
              .get(`A36_${placement.kind}_LOD${level}`)!
              .geometry.clone()
              .applyMatrix4(placement.matrix),
          );
        const geometry = mergeGeometries(copies, false);
        if (!geometry) throw new Error('Unable to batch A36 equipment');
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        const mesh = new T.Mesh(geometry, material);
        mesh.name = `A36_LOD${level}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.visible = level === 0;
        root.add(mesh);
      } finally {
        copies.forEach((g) => g.dispose());
      }
    }
    for (const placement of placements) {
      const origin = new T.Group();
      origin.name = placement.id;
      origin.position.fromArray(placement.position);
      origin.rotation.y = placement.yaw;
      origin.userData.kind = placement.kind;
      root.add(origin);
      for (const [name, point] of Object.entries(manifest.variants[placement.kind].sockets)) {
        const socket = new T.Object3D();
        socket.name = `SOCKET_A36_${placement.kind}_${name}`;
        socket.position.fromArray(point);
        socket.userData.futureInteractionOnly = true;
        origin.add(socket);
      }
    }
    return root;
  } catch (error) {
    resources([root]).geometries.forEach((g) => g.dispose());
    throw error;
  }
}

/** One static garage arrangement. LOD follows A22; mirrors reuse the main view. */
export class WorkshopEquipment {
  readonly levels: T.Object3D[];
  private readonly owned: ReturnType<typeof resources>;
  private disposed = false;
  private attached = false;
  constructor(
    readonly root: T.Group,
    readonly placements: ReturnType<typeof workshopPlacementBounds>,
  ) {
    this.levels = LEVELS.map((level) => {
      const mesh = root.getObjectByName(`A36_LOD${level}`);
      if (!mesh) throw new Error('Missing A36 level');
      return mesh;
    });
    this.owned = resources([root]);
  }
  attachTo(garage: T.Group, levels: T.Object3D[]) {
    if (this.disposed || this.attached) throw new Error('A36 already attached or disposed');
    if (levels.length !== 3 || levels.some((o, i) => o.name !== `GARAGE_LOD${i}`))
      throw new Error('Missing matching A22 levels');
    this.levels.forEach((o, i) => {
      levels[i].add(o);
      o.visible = true;
    });
    garage.add(this.root);
    this.attached = true;
  }
  socket(placementId: string, role: string, out: T.Vector3) {
    const origin = this.root.getObjectByName(placementId);
    const socket = origin?.getObjectByName(`SOCKET_A36_${origin.userData.kind}_${role}`);
    if (!socket || this.disposed) throw new Error('Unknown or disposed A36 socket');
    return socket.getWorldPosition(out);
  }
  diagnostics(level = 0) {
    const lod = level === 1 || level === 2 ? level : 0;
    return {
      assetId: 'A36',
      revision: manifest.revision,
      sha256: manifest.sha256,
      loaded: !this.disposed,
      attached: this.attached,
      lod,
      instances: this.placements.length,
      triangles: this.placements.reduce(
        (sum, p) => sum + manifest.variants[p.kind].triangles[lod],
        0,
      ),
      drawBatches: 1,
      variants: this.placements.map((p) => p.kind),
      finalArtApproved: false,
      visualOnly: true,
    };
  }
  /** Detach first to prevent a following garage traversal from disposing twice. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.levels.forEach((o) => o.removeFromParent());
    this.root.removeFromParent();
    release(this.owned);
  }
}

export async function decodeWorkshopEquipment(
  bytes: Uint8Array<ArrayBuffer>,
  loader = new GLTFLoader(),
) {
  workshopDocument(bytes);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  if (digest !== manifest.sha256) throw new Error('A36 integrity check failed');
  const placements = workshopPlacementBounds();
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    '',
  );
  let root: T.Group | undefined;
  try {
    root = assemble(gltf.scene, placements);
    const equipment = new WorkshopEquipment(root, placements);
    // The arrangement keeps the atlas; only its unused library geometry is released.
    resources([gltf.scene]).geometries.forEach((g) => g.dispose());
    return equipment;
  } catch (error) {
    release(resources(root ? [gltf.scene, root] : [gltf.scene]));
    throw error;
  }
}

/** Bounded transfer, timeout and cancellation; a failed asset is never silent fallback art. */
export async function loadWorkshopEquipment(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
  decode: typeof decodeWorkshopEquipment = decodeWorkshopEquipment,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  const poll = setInterval(() => {
    if (cancelled()) controller.abort();
  }, 50);
  let equipment: WorkshopEquipment | undefined;
  try {
    if (cancelled()) throw aborted();
    const response = await fetcher(
      url ?? new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      { signal: controller.signal },
    );
    if (!response.ok || !response.body) throw new Error(`A36 download failed (${response.status})`);
    const reader = response.body.getReader(),
      bytes = new Uint8Array(manifest.bytes);
    let size = 0;
    try {
      while (true) {
        if (cancelled() || controller.signal.aborted) throw aborted();
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.length > bytes.length) throw new Error('A36 transfer exceeds byte budget');
        bytes.set(value, size);
        size += value.length;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (cancelled() || controller.signal.aborted) throw aborted();
    if (size !== bytes.length) throw new Error('Truncated A36 transfer');
    equipment = await decode(bytes);
    if (cancelled() || controller.signal.aborted) throw aborted();
    return equipment;
  } catch (error) {
    equipment?.dispose();
    throw error;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }
}
