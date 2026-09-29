import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './tyre-trolleys-racks.manifest.json' with { type: 'json' };
import { detailDistance } from './view-detail.ts';
import type { Quality } from './options.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { clamp } from '../core/math.ts';

export const TYRE_EQUIPMENT = manifest;
export type TyreStructure = 'trolley' | 'rack';
export type TyreLoadState = 'empty' | 'partial-left' | 'partial-balanced' | 'full';
type Level = 0 | 1 | 2;
const LEVELS = [0, 1, 2] as const;
const KINDS = ['front', 'rear'] as const;
const SLOTS = Object.entries(manifest.sockets).sort((a, b) => a[1].slotIndex - b[1].slotIndex);
const TEMPLATES: Record<string, { triangles: number; primitives: number }> = manifest.templates;
const PRESETS: Record<TyreLoadState, readonly number[]> = {
  empty: [],
  'partial-left': [0, 1, 4, 5],
  // One complete set on the lower tier: a stable, visually balanced parked load.
  'partial-balanced': [0, 1, 2, 3],
  full: [0, 1, 2, 3, 4, 5, 6, 7],
};
const templateName = (kind: string, level: Level) => `A35_${kind.toUpperCase()}_LOD${level}`;
const envelope = () =>
  new T.Box3(
    new T.Vector3().fromArray(manifest.maxBounds.min),
    new T.Vector3().fromArray(manifest.maxBounds.max),
  );

export function tyreLoadSlots(state: TyreLoadState | readonly number[]) {
  const slots = Array.isArray(state) ? state : PRESETS[state as TyreLoadState];
  if (
    !slots ||
    slots.some((i) => !Number.isInteger(i) || i < 0 || i >= 8) ||
    new Set(slots).size !== slots.length
  )
    throw new Error('Invalid A35 load slots');
  return [...slots].sort((a, b) => a - b);
}

export function tyreEquipmentLod(
  distance: number,
  previous: number,
  quality: Quality,
  fov = 58,
  aspect = 16 / 9,
): Level {
  const d = detailDistance(distance, fov, aspect);
  const near = quality === 'high' ? 14 : quality === 'medium' ? 10 : 7;
  const far = quality === 'high' ? 48 : quality === 'medium' ? 36 : 26;
  if (previous === 0 && d < near * 1.12) return 0;
  if (previous === 2 && d > far * 0.88) return 2;
  return d < near ? 0 : d < far ? 1 : 2;
}

interface AssetDocument {
  asset: { version: string };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: { name?: string; children?: number[]; mesh?: number }[];
  meshes: {
    primitives: { indices: number; attributes: { POSITION: number }; material?: number }[];
  }[];
  accessors: { count: number; min?: number[]; max?: number[] }[];
  buffers: { byteLength: number; uri?: string }[];
  images: { uri?: string; bufferView?: number }[];
  materials: unknown[];
}

/** Inspect bounded, self-contained bytes before GLTFLoader may resolve any resources. */
export function tyreEquipmentDocument(bytes: Uint8Array<ArrayBuffer>): AssetDocument {
  if (bytes.length !== manifest.bytes || bytes.length < 28)
    throw new Error('A35 byte count mismatch');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(12, true);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    length % 4 ||
    length > bytes.length - 28
  )
    throw new Error('Invalid A35 GLB header');
  const d = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as AssetDocument;
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
    d.images.some((i) => i.uri !== undefined || !Number.isInteger(i.bufferView))
  )
    throw new Error('Invalid self-contained A35 contract');
  const required = [
    'A35_ASSET',
    ...Object.keys(TEMPLATES),
    ...SLOTS.map(([name]) => name),
    ...[1, 2, 3, 4].map((i) => `A35_CASTER_PIVOT_0${i}`),
    'A35_PUSH_HAND_L',
    'A35_PUSH_HAND_R',
  ];
  for (const name of required)
    if (d.nodes.filter((n) => n.name === name).length !== 1)
      throw new Error(`Invalid A35 node ${name}`);
  const seen = new Set<number>();
  const visit = (i: number) => {
    if (!Number.isInteger(i) || !d.nodes[i] || seen.has(i))
      throw new Error('Invalid A35 hierarchy');
    seen.add(i);
    const n = d.nodes[i];
    if (n.mesh !== undefined && !d.meshes[n.mesh]) throw new Error('Invalid A35 mesh');
    for (const child of n.children ?? []) visit(child);
  };
  for (const i of d.scenes[0].nodes) visit(i);
  if (seen.size !== d.nodes.length) throw new Error('Unreachable A35 node');
  for (const [name, expected] of Object.entries(TEMPLATES)) {
    let triangles = 0,
      primitives = 0;
    for (const node of d.nodes.filter((n) => n.name?.startsWith(`${name}_`)))
      for (const p of d.meshes[node.mesh ?? -1]?.primitives ?? []) {
        const accessor = d.accessors[p.attributes?.POSITION],
          count = d.accessors[p.indices]?.count;
        if (!accessor || !count || count % 3) throw new Error('Invalid A35 triangles');
        triangles += count / 3;
        primitives++;
      }
    if (triangles !== expected.triangles || primitives !== expected.primitives)
      throw new Error(`A35 template mismatch ${name}`);
  }
  return d;
}

function releaseResources(template: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  template.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m);
      for (const value of Object.values(m)) if (value instanceof T.Texture) textures.add(value);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => {
    t.dispose();
    if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close();
  });
}

/** One composition. Instance buffers belong here; geometry/textures belong to the kit. */
export class TyreEquipmentInstance {
  readonly root = new T.Group();
  readonly levels = LEVELS.map(() => new T.Group());
  private readonly wheels: { kind: 'front' | 'rear'; mesh: T.InstancedMesh }[] = [];
  private readonly matrix = new T.Matrix4();
  private readonly bounds = envelope();
  private readonly worldBounds = new T.Box3();
  private occupied: number[] = [];
  private level: Level = 0;
  private disposed = false;
  constructor(
    readonly structure: TyreStructure,
    template: T.Group,
    state: TyreLoadState | readonly number[],
  ) {
    if (structure !== 'trolley' && structure !== 'rack') throw new Error('Invalid A35 structure');
    const slots = tyreLoadSlots(state);
    this.root.name = `A35 ${structure}`;
    this.root.userData.assetId = 'A35';
    this.root.userData.visualOnly = true;
    // Reject missing templates before allocating instance buffers.
    for (const level of LEVELS)
      for (const kind of [structure, ...KINDS])
        if (!template.getObjectByName(templateName(kind, level)))
          throw new Error('Missing A35 template');
    for (const level of LEVELS) {
      const group = this.levels[level];
      group.name = `A35 ${structure} active LOD ${level}`;
      group.add(template.getObjectByName(templateName(structure, level))!.clone(true));
      for (const kind of KINDS) {
        const wheel = template.getObjectByName(templateName(kind, level))!;
        wheel.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          const mesh = new T.InstancedMesh(o.geometry, o.material, 4);
          mesh.name = `${o.name} shared wheel instances`;
          mesh.castShadow = mesh.receiveShadow = true;
          this.wheels.push({ kind, mesh });
          group.add(mesh);
        });
      }
      group.traverse((o) => {
        if (o instanceof T.Mesh) o.castShadow = o.receiveShadow = true;
      });
      group.visible = level === 0;
      this.root.add(group);
    }
    for (const [name, slot] of SLOTS) {
      const socket = new T.Object3D();
      socket.name = name;
      socket.position.fromArray(slot.position);
      socket.userData = { assetId: 'A35', slotIndex: slot.slotIndex, wheelType: slot.wheelType };
      this.root.add(socket);
    }
    this.setLoadState(slots);
  }
  setLoadState(state: TyreLoadState | readonly number[]) {
    if (this.disposed) throw new Error('A35 instance is disposed');
    const slots = tyreLoadSlots(state);
    for (const { kind, mesh } of this.wheels) {
      const active = slots.filter((i) => SLOTS[i][1].wheelType === kind);
      mesh.count = active.length;
      mesh.visible = active.length > 0;
      active.forEach((i, index) => {
        const p = SLOTS[i][1].position;
        this.matrix.makeTranslation(p[0], p[1], p[2]);
        mesh.setMatrixAt(index, this.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      // State changes must also invalidate culling bounds, including empty -> full.
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
    }
    this.occupied = slots;
  }
  setDetail(distance: number, quality: Quality, fov = 58, aspect = 16 / 9) {
    if (this.disposed) return;
    this.level = tyreEquipmentLod(distance, this.level, quality, fov, aspect);
    this.levels.forEach((o, i) => {
      o.visible = i === this.level;
    });
  }
  update(camera: T.PerspectiveCamera, quality: Quality) {
    if (this.disposed) return;
    this.root.updateWorldMatrix(true, false);
    this.worldBounds.copy(this.bounds).applyMatrix4(this.root.matrixWorld);
    this.setDetail(
      this.worldBounds.distanceToPoint(camera.position),
      quality,
      camera.fov,
      camera.aspect,
    );
  }
  socket(index: number, out: T.Vector3) {
    if (!Number.isInteger(index) || index < 0 || index > 7) throw new Error('Invalid A35 socket');
    return this.root.getObjectByName(SLOTS[index][0])!.getWorldPosition(out);
  }
  diagnostics() {
    const frame = TEMPLATES[templateName(this.structure, this.level)];
    let triangles = frame.triangles,
      calls = frame.primitives;
    for (const kind of KINDS) {
      const count = this.occupied.filter((i) => SLOTS[i][1].wheelType === kind).length;
      const wheel = TEMPLATES[templateName(kind, this.level)];
      triangles += count * wheel.triangles;
      if (count) calls += wheel.primitives;
    }
    return {
      structure: this.structure,
      occupiedSlots: [...this.occupied],
      wheels: this.occupied.length,
      lod: this.level,
      triangles,
      mainViewSubmissions: calls,
      disposed: this.disposed,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.wheels.forEach(({ mesh }) => mesh.dispose());
  }
}

/** Sole owner of immutable templates. No global cache can outlive a renderer. */
export class TyreEquipmentKit {
  readonly root = new T.Group();
  readonly instances: TyreEquipmentInstance[] = [];
  private disposed = false;
  constructor(readonly template: T.Group) {
    template.updateMatrixWorld(true);
    for (const name of Object.keys(TEMPLATES)) {
      const node = template.getObjectByName(name);
      if (!node) throw new Error(`Missing A35 template ${name}`);
      node.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        if (!o.matrixWorld.equals(new T.Matrix4()))
          throw new Error('A35 templates need identity transforms');
        const position = o.geometry.getAttribute('position');
        for (let i = 0; i < position.array.length; i++)
          if (!Number.isFinite(position.array[i])) throw new Error('Non-finite A35 vertex');
        o.geometry.computeBoundingBox();
        o.geometry.computeBoundingSphere();
      });
      if (/TROLLEY|RACK/.test(name) && !envelope().containsBox(new T.Box3().setFromObject(node)))
        throw new Error('A35 structure exceeds placement envelope');
    }
    for (const [name, expected] of SLOTS) {
      const socket = template.getObjectByName(name);
      if (
        !socket ||
        socket.position.distanceTo(new T.Vector3().fromArray(expected.position)) > 1e-5
      )
        throw new Error(`A35 socket transform mismatch ${name}`);
    }
    this.root.name = 'Aurel tyre logistics / A35';
    this.root.userData.assetId = 'A35';
  }
  create(
    structure: TyreStructure = 'trolley',
    state: TyreLoadState | readonly number[] = 'partial-balanced',
  ) {
    if (this.disposed) throw new Error('A35 kit is disposed');
    const instance = new TyreEquipmentInstance(structure, this.template, state);
    this.instances.push(instance);
    this.root.add(instance.root);
    return instance;
  }
  update(camera: T.PerspectiveCamera, quality: Quality) {
    if (!this.disposed) this.instances.forEach((i) => i.update(camera, quality));
  }
  diagnostics() {
    return {
      assetId: 'A35',
      revision: manifest.revision,
      sha256: manifest.sha256,
      loaded: !this.disposed,
      visualOnly: true,
      finalArtApproved: false,
      instances: this.instances
        .filter((i) => !i.diagnostics().disposed)
        .map((i) => i.diagnostics()),
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // Detach before the enclosing renderer traverses its scene for resource disposal.
    this.root.removeFromParent();
    this.instances.forEach((i) => i.dispose());
    releaseResources(this.template);
  }
}

/** Bay-local audited footprints: no lane, cabinet, doorway or crew-service mutation. */
export const A35_GARAGE_PLACEMENTS = [
  {
    id: 'a35-lower-set',
    structure: 'trolley',
    state: 'partial-balanced',
    local: [-2.2, 0.05, -3.35],
    yaw: Math.PI / 2,
  },
  {
    id: 'a35-empty-return',
    structure: 'trolley',
    state: 'empty',
    local: [-4.7, 0.05, -3.35],
    yaw: Math.PI / 2,
  },
  { id: 'a35-rear-rack', structure: 'rack', state: 'full', local: [5.5, 0.05, -2.45], yaw: 0 },
] as const;

export function tyreEquipmentPlacements(track: Track) {
  const p = track.at(106, trackPoint()),
    yaw = Math.atan2(p.tx, p.tz);
  const anchor = new T.Vector3(p.x + p.nx * 35, p.y + p.bank * clamp(35, -12, 12), p.z + p.nz * 35);
  const basis = new T.Matrix4().makeRotationY(yaw);
  return A35_GARAGE_PLACEMENTS.map((entry) => {
    const local = new T.Matrix4().compose(
      new T.Vector3().fromArray(entry.local),
      new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), entry.yaw),
      new T.Vector3(1, 1, 1),
    );
    const localBounds = envelope().applyMatrix4(local);
    // Keep the centre car aisle and rear service door clear; cabinets start at x=-.55.
    if (
      localBounds.min.x < -6.2 ||
      localBounds.max.x > 6.05 ||
      localBounds.min.z < -3.96 ||
      localBounds.max.z > -1.2 ||
      (localBounds.min.x < 4.9 && localBounds.max.x > -0.6)
    )
      throw new Error('A35 placement conflicts with garage work zones');
    const position = new T.Vector3().fromArray(entry.local).applyMatrix4(basis).add(anchor);
    const matrix = new T.Matrix4().compose(
      position,
      new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw + entry.yaw),
      new T.Vector3(1, 1, 1),
    );
    let pitClearance = Infinity;
    for (const x of [manifest.maxBounds.min[0], manifest.maxBounds.max[0]])
      for (const z of [manifest.maxBounds.min[2], manifest.maxBounds.max[2]]) {
        const corner = new T.Vector3(x, 0, z).applyMatrix4(matrix),
          q = trackPoint();
        const lateral = track.nearest(corner.x, corner.z, q);
        pitClearance = Math.min(pitClearance, lateral - (track.pitOffset(q.s) + 3.6));
      }
    if (pitClearance < 1) throw new Error('A35 equipment enters pit driving clearance');
    return { ...entry, position, yaw: yaw + entry.yaw, localBounds, pitClearance };
  });
}

export function installTyreEquipment(kit: TyreEquipmentKit, track: Track) {
  if (kit.instances.length) throw new Error('A35 scene is already populated');
  const placements = tyreEquipmentPlacements(track);
  for (const site of placements) {
    const instance = kit.create(site.structure, site.state);
    instance.root.name = site.id;
    instance.root.position.copy(site.position);
    instance.root.rotation.y = site.yaw;
    instance.root.userData.pitClearance = site.pitClearance;
  }
  return kit;
}

export async function decodeTyreEquipment(
  bytes: Uint8Array<ArrayBuffer>,
  loader = new GLTFLoader(),
) {
  tyreEquipmentDocument(bytes);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
  if (digest !== manifest.sha256) throw new Error('A35 integrity check failed');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
    '',
  );
  try {
    return new TyreEquipmentKit(gltf.scene);
  } catch (error) {
    releaseResources(gltf.scene);
    throw error;
  }
}

export async function loadTyreEquipment(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  const aborted = () => new DOMException('A35 loading cancelled', 'AbortError');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  const poll = setInterval(() => {
    if (cancelled()) controller.abort();
  }, 50);
  let kit: TyreEquipmentKit | undefined;
  try {
    if (cancelled()) throw aborted();
    const response = await fetcher(
      url ?? new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      { signal: controller.signal },
    );
    if (!response.ok || !response.body) throw new Error(`Unable to load A35 (${response.status})`);
    const reader = response.body.getReader(),
      bytes = new Uint8Array(manifest.bytes);
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled() || controller.signal.aborted) throw aborted();
        if (size + value.length > bytes.length) throw new Error('A35 download exceeds byte budget');
        bytes.set(value, size);
        size += value.length;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (size !== bytes.length) throw new Error('Truncated A35 download');
    if (cancelled() || controller.signal.aborted) throw aborted();
    kit = await decodeTyreEquipment(bytes);
    if (cancelled() || controller.signal.aborted) throw aborted();
    return kit;
  } catch (error) {
    kit?.dispose();
    throw error;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }
}
