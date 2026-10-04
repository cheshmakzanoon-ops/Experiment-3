import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './broadcast-cameras.manifest.json' with { type: 'json' };
import { Track } from '../simulation/track.ts';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  conformCameraHead,
  conformCameraTower,
  cameraHardwareHeight,
} from './broadcast-camera-placement.ts';
import type { TrackDetailSite } from './track-infrastructure.ts';
import { concreteBarrierLod } from './concrete-barriers.ts';
import { tagWeatherSurface } from './weather-presentation.ts';
import type { Quality } from './options.ts';
export const BROADCAST_CAMERAS = manifest;
export const CAMERA_VARIANTS = ['dry', 'rain', 'tower_low', 'tower_high'] as const;
interface CameraDocument {
  asset: { version: string };
  nodes: { name?: string; mesh?: number; children?: number[] }[];
  meshes: { primitives: { indices: number; attributes: Record<string, number> }[] }[];
  accessors: { count: number }[];
  buffers: { uri?: string }[];
  images: { uri?: string; bufferView?: number }[];
  materials: unknown[];
}
export function broadcastCameraDocument(bytes: Uint8Array<ArrayBuffer>): CameraDocument {
  if (bytes.length !== manifest.bytes || bytes.length < 28 || bytes.length > 4 * 1024 * 1024)
    throw new Error('A10 byte count mismatch');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    len = v.getUint32(12, true);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length ||
    v.getUint32(16, true) !== 0x4e4f534a ||
    len > bytes.length - 28
  )
    throw new Error('Invalid A10 GLB header');
  const d = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as CameraDocument;
  if (
    d.asset?.version !== '2.0' ||
    d.nodes?.length !== manifest.nodes ||
    d.meshes?.length !== manifest.meshes ||
    d.materials?.length !== 1 ||
    d.images?.length !== 3 ||
    d.buffers?.length !== 1 ||
    d.buffers[0].uri ||
    d.images.some((i) => i.uri || !Number.isInteger(i.bufferView))
  )
    throw new Error('Invalid self-contained A10 contract');
  for (const variant of CAMERA_VARIANTS)
    for (const level of [0, 1, 2]) {
      const name = `A10_${variant.toUpperCase()}_LOD${level}`,
        nodes = d.nodes.filter((n) => n.name === name);
      if (nodes.length !== 1 || nodes[0].children?.length !== manifest.draws[variant][level])
        throw new Error('Invalid A10 LOD hierarchy');
      let tris = 0;
      for (const id of nodes[0].children!) {
        const ps = d.meshes[d.nodes[id]?.mesh ?? -1]?.primitives;
        if (
          ps?.length !== 1 ||
          ['POSITION', 'NORMAL', 'TEXCOORD_0'].some((k) => ps[0].attributes[k] === undefined)
        )
          throw new Error('Invalid A10 UV/topology contract');
        tris += d.accessors[ps[0].indices]?.count / 3;
      }
      if (tris !== manifest.triangles[variant][level])
        throw new Error('Invalid A10 triangle count');
    }
  for (const name of Object.keys(manifest.sockets))
    if (d.nodes.filter((n) => n.name === name).length !== 1) throw new Error('Missing A10 socket');
  return d;
}
function release(roots: T.Object3D[]) {
  const gs = new Set<T.BufferGeometry>(),
    ms = new Set<T.Material>(),
    ts = new Set<T.Texture>();
  for (const root of roots)
    root.traverse((o) => {
      if (o instanceof T.Mesh) {
        gs.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          ms.add(m);
          for (const v of Object.values(m)) if (v instanceof T.Texture) ts.add(v);
        }
      }
    });
  gs.forEach((g) => g.dispose());
  ms.forEach((m) => m.dispose());
  ts.forEach((t) => {
    t.dispose();
    if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close();
  });
}
interface Template {
  geometry: T.BufferGeometry;
  material: T.MeshStandardMaterial;
}
export class BroadcastCamerasKit {
  readonly root = new T.Group();
  readonly templates = new Map<string, Template[]>();
  readonly chunks: {
    levels: T.Group[];
    sphere: T.Sphere;
    level: number;
    modules: number;
    rigId: number;
    covered: boolean;
    supported: boolean;
  }[] = [];
  private disposed = false;
  private stations = new Set<number>();
  constructor(private readonly source: T.Group) {
    this.root.name = 'A10 authored broadcast-camera and platform kit';
    source.updateMatrixWorld(true);
    const allowed = new T.Box3(
      new T.Vector3().fromArray(manifest.bounds.min).addScalar(-1e-5),
      new T.Vector3().fromArray(manifest.bounds.max).addScalar(1e-5),
    );
    for (const variant of CAMERA_VARIANTS)
      for (const level of [0, 1, 2]) {
        const group = source.getObjectByName(`A10_${variant.toUpperCase()}_LOD${level}`);
        if (!group) throw new Error('Missing A10 level');
        const parts: Template[] = [];
        group.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          if (!(o.material instanceof T.MeshStandardMaterial))
            throw new Error('Invalid A10 material');
          const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
          geometry.computeBoundingBox();
          if (
            !geometry.index ||
            !geometry.getAttribute('normal') ||
            !geometry.getAttribute('uv') ||
            !allowed.containsBox(geometry.boundingBox!)
          )
            throw new Error('A10 outside its declared envelope');
          for (const name of ['position', 'normal', 'uv'])
            if (!Array.from(geometry.getAttribute(name).array).every(Number.isFinite))
              throw new Error('Non-finite A10 geometry');
          parts.push({ geometry, material: o.material });
          tagWeatherSurface(o.material, 'paint', 0.7);
        });
        if (parts.length !== manifest.draws[variant][level])
          throw new Error('A10 draw budget mismatch');
        this.templates.set(`${variant}:${level}`, parts);
      }
    for (const [name, point] of Object.entries(manifest.sockets)) {
      const node = source.getObjectByName(name);
      if (
        !node ||
        node.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3().fromArray(point)) > 1e-5
      )
        throw new Error('Invalid A10 socket position');
    }
  }
  buildCamera(track: Track, parent: T.Group, site: TrackDetailSite) {
    if (this.disposed) throw new Error('A10 disposed');
    if (
      site.kind !== 'camera' ||
      !Number.isInteger(site.rigId) ||
      ![-1, 1].includes(site.side) ||
      ![site.s, site.x, site.y, site.z, site.yaw, site.cameraY ?? NaN].every(Number.isFinite)
    )
      throw new Error('Invalid A10 camera site');
    const id = site.rigId!;
    if (this.stations.has(id)) throw new Error('Duplicate A10 camera');
    this.stations.add(id);
    if (!this.root.parent) parent.add(this.root);
    if (this.root.parent !== parent) throw new Error('A10 already attached elsewhere');
    const head = id % 3 === 0 ? 'rain' : 'dry',
      tower = cameraHardwareHeight(site) > 5.3 ? 'tower_high' : 'tower_low',
      levels: T.Group[] = [];
    let sphere = new T.Sphere();
    for (const level of [0, 1, 2]) {
      const group = new T.Group();
      group.name = `A10 rig ${id} LOD${level}`;
      const h = this.templates.get(`${head}:${level}`)![0],
        parts = [conformCameraHead(h.geometry, site)];
      if (site.supported) {
        const t = this.templates.get(`${tower}:${level}`)![0];
        if (t.material !== h.material) throw new Error('A10 atlas material must be shared');
        parts.push(conformCameraTower(t.geometry, track, site, manifest.towerHeights[tower]));
      }
      const geometry = parts.length > 1 ? mergeGeometries(parts, false)! : parts[0];
      if (parts.length > 1) parts.forEach((g) => g.dispose());
      geometry.computeBoundingSphere();
      const mesh = new T.Mesh(geometry, h.material);
      mesh.name = group.name;
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
      group.visible = level === 2;
      this.root.add(group);
      levels.push(group);
      if (level === 0) sphere = geometry.boundingSphere!.clone();
    }
    this.chunks.push({
      levels,
      sphere,
      level: 2,
      modules: 1,
      rigId: id,
      covered: head === 'rain',
      supported: !!site.supported,
    });
  }
  update(camera: T.PerspectiveCamera, quality: Quality) {
    if (this.disposed) return;
    for (const c of this.chunks) {
      const d = Math.max(0, camera.position.distanceTo(c.sphere.center) - c.sphere.radius),
        level = concreteBarrierLod(d, c.level, quality, camera.fov, camera.aspect);
      if (level !== c.level) {
        c.levels[c.level].visible = false;
        c.levels[level].visible = true;
        c.level = level;
      }
    }
  }
  diagnostics() {
    return {
      assetId: 'A10',
      revision: manifest.revision,
      sha256: manifest.sha256,
      loaded: !this.disposed,
      chunks: this.chunks.length,
      modules: this.chunks.reduce((n, c) => n + c.modules, 0),
      rainCovers: this.chunks.filter((c) => c.covered).length,
      platforms: this.chunks.filter((c) => c.supported).length,
      opticalPositionsRetained: true,
      cameraDirectorChanged: false,
      selectedLods: [0, 1, 2].map((i) => this.chunks.filter((c) => c.level === i).length),

      physicsChanged: false,
      finalArtApproved: false,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    release([this.source, this.root]);
    this.templates.forEach((parts) => parts.forEach((p) => p.geometry.dispose()));
    this.templates.clear();
    this.root.clear();
  }
}
export async function decodeBroadcastCameras(
  bytes: Uint8Array<ArrayBuffer>,
  loader = new GLTFLoader(),
) {
  broadcastCameraDocument(bytes);
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  if (sha !== manifest.sha256) throw new Error('A10 integrity mismatch');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  try {
    return new BroadcastCamerasKit(gltf.scene);
  } catch (error) {
    release([gltf.scene]);
    throw error;
  }
}
const aborted = () => new DOMException('A10 loading cancelled', 'AbortError');
export async function loadBroadcastCameras(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 60000),
    poll = setInterval(() => {
      if (cancelled()) controller.abort();
    }, 50);
  let asset: BroadcastCamerasKit | undefined;
  try {
    if (cancelled()) throw aborted();
    const response = await fetcher(
      url ?? new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      { signal: controller.signal },
    );
    if (!response.ok || !response.body)
      throw new Error(`Unable to load A10 broadcast cameras (${response.status})`);
    const bytes = new Uint8Array(manifest.bytes),
      reader = response.body.getReader();
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled() || controller.signal.aborted) throw aborted();
        if (size + value.length > bytes.length) throw new Error('A10 download exceeds byte budget');
        bytes.set(value, size);
        size += value.length;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (size !== bytes.length) throw new Error('Truncated A10 download');
    if (cancelled() || controller.signal.aborted) throw aborted();
    asset = await decodeBroadcastCameras(bytes);
    if (cancelled() || controller.signal.aborted) throw aborted();
    return asset;
  } catch (error) {
    asset?.dispose();
    throw error;
  } finally {
    clearTimeout(timeout);
    clearInterval(poll);
  }
}
