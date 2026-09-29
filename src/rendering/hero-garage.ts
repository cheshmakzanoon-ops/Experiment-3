import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './hero-garage.manifest.json' with { type: 'json' };
import { detailDistance } from './view-detail.ts';
import type { Quality } from './options.ts';

export const HERO_GARAGE = manifest;
const aborted = () => new DOMException('Garage loading cancelled', 'AbortError');
const sha256 = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');

interface GarageDocument {
  asset?: { version?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { name?: string; children?: number[]; mesh?: number }[];
  meshes?: { primitives?: { indices?: number; material?: number }[] }[];
  accessors?: { count?: number }[];
  buffers?: { byteLength?: number; uri?: string }[];
  images?: { uri?: string; bufferView?: number }[];
  materials?: { name?: string }[];
}

/** Inspect the exact self-contained export before invoking a resource loader. */
export function garageDocument(bytes: Uint8Array<ArrayBuffer>): GarageDocument {
  if (bytes.byteLength !== manifest.bytes || bytes.byteLength < 28)
    throw new Error('Garage byte count mismatch');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = v.getUint32(12, true);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length ||
    v.getUint32(16, true) !== 0x4e4f534a ||
    length > bytes.length - 28
  )
    throw new Error('Invalid garage GLB header');
  const d: GarageDocument = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
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
    throw new Error('Invalid self-contained garage contract');
  const required = [
    'AUREL_GARAGE',
    'GARAGE_LOD0',
    'GARAGE_LOD1',
    'GARAGE_LOD2',
    ...Object.keys(manifest.sockets),
  ];
  for (const name of required)
    if (d.nodes.filter((n) => n.name === name).length !== 1)
      throw new Error(`Missing or duplicate garage node ${name}`);
  for (const level of [0, 1, 2] as const) {
    let triangles = 0;
    for (const node of d.nodes.filter((n) => n.name?.startsWith(`LOD${level}_`))) {
      const primitives = d.meshes[node.mesh ?? -1]?.primitives;
      if (!primitives?.length) throw new Error('Missing garage surface');
      for (const p of primitives) {
        const count = d.accessors?.[p.indices ?? -1]?.count;
        if (!count || count % 3) throw new Error('Invalid garage triangles');
        triangles += count / 3;
      }
    }
    if (triangles !== manifest.triangles[level]) throw new Error('Garage LOD count mismatch');
  }
  return d;
}

export function garageLod(
  distance: number,
  previous: number,
  quality: Quality,
  fov = 58,
  aspect = 16 / 9,
) {
  const d = detailDistance(distance, fov, aspect);
  const near = quality === 'high' ? 35 : quality === 'medium' ? 24 : 15;
  const far = quality === 'high' ? 110 : quality === 'medium' ? 85 : 60;
  if (previous === 0 && d < near * 1.12) return 0;
  if (previous === 2 && d > far * 0.88) return 2;
  return d < near ? 0 : d < far ? 1 : 2;
}

/** One owned, non-animated bay. Race state, collisions and car spawn are untouched. */
export class HeroGarage {
  readonly levels: T.Object3D[];
  private readonly lamps: T.MeshStandardMaterial[] = [];
  private readonly localBounds = new T.Box3();
  private readonly worldBounds = new T.Box3();
  private disposed = false;
  private level = 0;
  constructor(readonly root: T.Group) {
    this.levels = [0, 1, 2].map((i) => {
      const node = root.getObjectByName(`GARAGE_LOD${i}`);
      if (!node) throw new Error('Missing garage LOD');
      return node;
    });
    root.updateMatrixWorld(true);
    this.localBounds.setFromObject(root);
    const min = new T.Vector3(...(manifest.maxBounds.min as [number, number, number]));
    const max = new T.Vector3(...(manifest.maxBounds.max as [number, number, number]));
    if (!new T.Box3(min, max).containsBox(this.localBounds))
      throw new Error('Garage geometry exceeds the retained bay envelope');
    const seen = new Set<T.Material>();
    root.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      object.geometry.computeBoundingBox();
      object.geometry.computeBoundingSphere();
      for (const m of Array.isArray(object.material) ? object.material : [object.material]) {
        if (seen.has(m)) continue;
        seen.add(m);
        if (m instanceof T.MeshStandardMaterial && m.name === 'GARAGE_LightDiffusers')
          this.lamps.push(m);
      }
    });
    this.levels.forEach((o, i) => {
      o.visible = i === 0;
    });
    root.name = 'Aurel hero working garage / A22';
    root.userData.heroGarage = { revision: manifest.revision, assetId: 'A22' };
  }
  /** Called once for the main view; mirrors reuse a stable representation. */
  update(camera: T.PerspectiveCamera, quality: Quality, lighting: 'day' | 'sunset' | 'night') {
    this.root.updateWorldMatrix(true, false);
    this.worldBounds.copy(this.localBounds).applyMatrix4(this.root.matrixWorld);
    this.setDetail(
      this.worldBounds.distanceToPoint(camera.position),
      quality,
      camera.fov,
      camera.aspect,
    );
    for (const lamp of this.lamps)
      lamp.emissiveIntensity = lighting === 'night' ? 2.2 : lighting === 'sunset' ? 1.1 : 0.5;
  }
  setDetail(distance: number, quality: Quality, fov = 58, aspect = 16 / 9) {
    this.level = garageLod(distance, this.level, quality, fov, aspect);
    this.levels.forEach((o, i) => {
      o.visible = i === this.level;
    });
  }
  socket(name: keyof typeof manifest.sockets, out: T.Vector3) {
    const socket = this.root.getObjectByName(name);
    if (!socket) throw new Error(`Missing garage socket ${name}`);
    return socket.getWorldPosition(out);
  }
  diagnostics() {
    return {
      assetId: 'A22',
      revision: manifest.revision,
      sha256: manifest.sha256,
      bay: manifest.bayIndex + 1,
      lod: this.level,
      triangles: manifest.triangles[this.level as 0 | 1 | 2],
      sockets: Object.keys(manifest.sockets),
      loaded: !this.disposed,
      finalArtApproved: false,
    };
  }
  /** Only call for detached resources. Attached resources belong to renderer.dispose(). */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    this.root.traverse((o) => {
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
}

export async function decodeHeroGarage(bytes: Uint8Array<ArrayBuffer>, loader = new GLTFLoader()) {
  garageDocument(bytes);
  if ((await sha256(bytes)) !== manifest.sha256) throw new Error('Garage integrity check failed');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  try {
    return new HeroGarage(gltf.scene);
  } catch (error) {
    // Constructor rejects invalid geometry before ownership can transfer.
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    gltf.scene.traverse((o) => {
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
    throw error;
  }
}

/** Bounded transfer, explicit failure, and cancellation compatible with menu exit. */
export async function loadHeroGarage(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  const poll = setInterval(() => {
    if (cancelled()) controller.abort();
  }, 50);
  let garage: HeroGarage | undefined;
  try {
    if (cancelled()) throw aborted();
    const response = await fetcher(
      url ?? new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      { signal: controller.signal },
    );
    if (!response.ok || !response.body)
      throw new Error(`Unable to load authored garage (${response.status})`);
    const reader = response.body.getReader();
    const bytes = new Uint8Array(manifest.bytes);
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled() || controller.signal.aborted) throw aborted();
        if (size + value.length > bytes.length)
          throw new Error('Garage download exceeds its byte budget');
        bytes.set(value, size);
        size += value.length;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (size !== bytes.length) throw new Error('Truncated garage download');
    if (cancelled() || controller.signal.aborted) throw aborted();
    garage = await decodeHeroGarage(bytes);
    if (cancelled() || controller.signal.aborted) throw aborted();
    return garage;
  } catch (error) {
    garage?.dispose();
    throw error;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }
}
