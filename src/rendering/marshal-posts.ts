import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './marshal-posts.manifest.json' with { type: 'json' };
import { Track } from '../simulation/track.ts';
import { trackPoint } from '../simulation/track.ts';
import { grassApronOffset } from './ground-profile.ts';
import type { TrackDetailSite } from './track-infrastructure.ts';
import { concreteBarrierLod } from './concrete-barriers.ts';
import { tagWeatherSurface } from './weather-presentation.ts';
import type { Quality } from './options.ts';
export const MARSHAL_POSTS = manifest;
export const MARSHAL_VARIANTS = ['open', 'sheltered'] as const;
interface MarshalDocument {
  asset: { version: string };
  nodes: { name?: string; mesh?: number; children?: number[] }[];
  meshes: { primitives: { indices: number; attributes: Record<string, number> }[] }[];
  accessors: { count: number }[];
  buffers: { uri?: string }[];
  images: { uri?: string; bufferView?: number }[];
  materials: unknown[];
}
export function marshalPostDocument(bytes: Uint8Array<ArrayBuffer>): MarshalDocument {
  if (bytes.length !== manifest.bytes || bytes.length < 28 || bytes.length > 4 * 1024 * 1024)
    throw new Error('A06 byte count mismatch');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    len = v.getUint32(12, true);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length ||
    v.getUint32(16, true) !== 0x4e4f534a ||
    len > bytes.length - 28
  )
    throw new Error('Invalid A06 GLB header');
  const d = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as MarshalDocument;
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
    throw new Error('Invalid self-contained A06 contract');
  for (const variant of MARSHAL_VARIANTS)
    for (const level of [0, 1, 2]) {
      const name = `A06_${variant.toUpperCase()}_LOD${level}`,
        nodes = d.nodes.filter((n) => n.name === name);
      if (nodes.length !== 1 || nodes[0].children?.length !== manifest.draws[variant][level])
        throw new Error('Invalid A06 LOD hierarchy');
      let tris = 0;
      for (const id of nodes[0].children!) {
        const ps = d.meshes[d.nodes[id]?.mesh ?? -1]?.primitives;
        if (
          ps?.length !== 1 ||
          ['POSITION', 'NORMAL', 'TEXCOORD_0'].some((k) => ps[0].attributes[k] === undefined)
        )
          throw new Error('Invalid A06 UV/topology contract');
        tris += d.accessors[ps[0].indices]?.count / 3;
      }
      if (tris !== manifest.triangles[variant][level])
        throw new Error('Invalid A06 triangle count');
    }
  for (const name of Object.keys(manifest.sockets))
    if (d.nodes.filter((n) => n.name === name).length !== 1) throw new Error('Missing A06 socket');
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
export function marshalPostMatrix(site: TrackDetailSite) {
  return new T.Matrix4()
    .makeRotationY(site.yaw)
    .scale(new T.Vector3(site.side, 1, 1))
    .setPosition(site.x, site.y, site.z);
}
export function conformMarshalPostGeometry(
  template: T.BufferGeometry,
  track: Track,
  site: TrackDetailSite,
) {
  const g = template.clone().applyMatrix4(marshalPostMatrix(site)),
    p = g.getAttribute('position'),
    source = template.getAttribute('position');
  for (let i = 0; i < p.count; i++)
    if (source.getY(i) < 0.02) {
      const q = trackPoint(),
        l = track.nearest(p.getX(i), p.getZ(i), q),
        ground = q.y + q.bank * Math.max(-12, Math.min(12, l)) + grassApronOffset(track, q.s, l);
      p.setY(i, Math.min(p.getY(i), ground - 0.025));
    }
  if (site.side < 0) {
    const index = g.index!;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      index.setX(i, index.getX(i + 2));
      index.setX(i + 2, a);
    }
  }
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
interface Template {
  geometry: T.BufferGeometry;
  material: T.MeshStandardMaterial;
}
export class MarshalPostsKit {
  readonly root = new T.Group();
  readonly templates = new Map<string, Template[]>();
  readonly chunks: {
    levels: T.Group[];
    sphere: T.Sphere;
    level: number;
    modules: number;
    sheltered: boolean;
  }[] = [];
  private disposed = false;
  private stations = new Set<number>();
  constructor(private readonly source: T.Group) {
    this.root.name = 'A06 authored marshal-posts supports';
    source.updateMatrixWorld(true);
    const allowed = new T.Box3(
      new T.Vector3().fromArray(manifest.bounds.min).addScalar(-1e-5),
      new T.Vector3().fromArray(manifest.bounds.max).addScalar(1e-5),
    );
    for (const variant of MARSHAL_VARIANTS)
      for (const level of [0, 1, 2]) {
        const group = source.getObjectByName(`A06_${variant.toUpperCase()}_LOD${level}`);
        if (!group) throw new Error('Missing A06 level');
        const parts: Template[] = [];
        group.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          if (!(o.material instanceof T.MeshStandardMaterial))
            throw new Error('Invalid A06 material');
          const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
          geometry.computeBoundingBox();
          if (
            !geometry.index ||
            !geometry.getAttribute('normal') ||
            !geometry.getAttribute('uv') ||
            !allowed.containsBox(geometry.boundingBox!)
          )
            throw new Error('A06 outside its declared envelope');
          for (const name of ['position', 'normal', 'uv'])
            if (!Array.from(geometry.getAttribute(name).array).every(Number.isFinite))
              throw new Error('Non-finite A06 geometry');
          parts.push({ geometry, material: o.material });
          tagWeatherSurface(o.material, 'paint', 0.7);
        });
        if (parts.length !== manifest.draws[variant][level])
          throw new Error('A06 draw budget mismatch');
        this.templates.set(`${variant}:${level}`, parts);
      }
    for (const [name, point] of Object.entries(manifest.sockets)) {
      const node = source.getObjectByName(name);
      if (
        !node ||
        node.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3().fromArray(point)) > 1e-5
      )
        throw new Error('Invalid A06 socket position');
    }
  }
  buildPost(track: Track, parent: T.Group, site: TrackDetailSite, ordinal: number) {
    if (this.disposed) throw new Error('A06 disposed');
    if (
      site.kind !== 'marshal' ||
      ![-1, 1].includes(site.side) ||
      ![site.s, site.x, site.y, site.z, site.yaw, ordinal].every(Number.isFinite)
    )
      throw new Error('Invalid A06 marshal site');
    if (this.stations.has(site.s)) throw new Error('Duplicate A06 post');
    this.stations.add(site.s);
    if (!this.root.parent) parent.add(this.root);
    if (this.root.parent !== parent) throw new Error('A06 already attached elsewhere');
    const variant = ordinal % 3 === 2 ? 'sheltered' : 'open',
      levels: T.Group[] = [];
    let sphere = new T.Sphere();
    for (const level of [0, 1, 2]) {
      const group = new T.Group();
      group.name = `A06 marshal ${ordinal + 1} ${Math.round(site.s)}m LOD${level}`;
      for (const part of this.templates.get(`${variant}:${level}`)!) {
        const geometry = conformMarshalPostGeometry(part.geometry, track, site),
          mesh = new T.Mesh(geometry, part.material);
        mesh.name = group.name;
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
      }
      group.visible = level === 2;
      this.root.add(group);
      levels.push(group);
      if (level === 0) sphere = (group.children[0] as T.Mesh).geometry.boundingSphere!.clone();
    }
    this.chunks.push({ levels, sphere, level: 2, modules: 1, sheltered: variant === 'sheltered' });
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
      assetId: 'A06',
      revision: manifest.revision,
      sha256: manifest.sha256,
      loaded: !this.disposed,
      chunks: this.chunks.length,
      modules: this.chunks.reduce((n, c) => n + c.modules, 0),
      sheltered: this.chunks.filter((c) => c.sheltered).length,
      staffDatum: manifest.staffDatum,
      retainedStaffAndSignals: true,
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
export async function decodeMarshalPosts(
  bytes: Uint8Array<ArrayBuffer>,
  loader = new GLTFLoader(),
) {
  marshalPostDocument(bytes);
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  if (sha !== manifest.sha256) throw new Error('A06 integrity mismatch');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  try {
    return new MarshalPostsKit(gltf.scene);
  } catch (error) {
    release([gltf.scene]);
    throw error;
  }
}
const aborted = () => new DOMException('A06 loading cancelled', 'AbortError');
export async function loadMarshalPosts(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 60000),
    poll = setInterval(() => {
      if (cancelled()) controller.abort();
    }, 50);
  let asset: MarshalPostsKit | undefined;
  try {
    if (cancelled()) throw aborted();
    const response = await fetcher(
      url ?? new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      { signal: controller.signal },
    );
    if (!response.ok || !response.body)
      throw new Error(`Unable to load A06 marshal posts (${response.status})`);
    const bytes = new Uint8Array(manifest.bytes),
      reader = response.body.getReader();
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled() || controller.signal.aborted) throw aborted();
        if (size + value.length > bytes.length) throw new Error('A06 download exceeds byte budget');
        bytes.set(value, size);
        size += value.length;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (size !== bytes.length) throw new Error('Truncated A06 download');
    if (cancelled() || controller.signal.aborted) throw aborted();
    asset = await decodeMarshalPosts(bytes);
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
