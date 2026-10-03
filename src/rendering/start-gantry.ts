import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './start-gantry.manifest.json' with { type: 'json' };
import { Track } from '../simulation/track.ts';
import { trackPoint } from '../simulation/track.ts';
import { grassApronOffset } from './ground-profile.ts';
import type { BroadcastSightlines } from './broadcast-sightlines.ts';
import { concreteBarrierLod } from './concrete-barriers.ts';
import { tagWeatherSurface } from './weather-presentation.ts';
import type { Quality } from './options.ts';
export const START_GANTRY = manifest;
export const GANTRY_VARIANTS = ['portal'] as const;
interface GantryDocument {
  asset: { version: string };
  nodes: { name?: string; mesh?: number; children?: number[] }[];
  meshes: { primitives: { indices: number; attributes: Record<string, number> }[] }[];
  accessors: { count: number }[];
  buffers: { uri?: string }[];
  images: { uri?: string; bufferView?: number }[];
  materials: unknown[];
}
export function startGantryDocument(bytes: Uint8Array<ArrayBuffer>): GantryDocument {
  if (bytes.length !== manifest.bytes || bytes.length < 28 || bytes.length > 4 * 1024 * 1024)
    throw new Error('A07 byte count mismatch');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    len = v.getUint32(12, true);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length ||
    v.getUint32(16, true) !== 0x4e4f534a ||
    len > bytes.length - 28
  )
    throw new Error('Invalid A07 GLB header');
  const d = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as GantryDocument;
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
    throw new Error('Invalid self-contained A07 contract');
  for (const variant of GANTRY_VARIANTS)
    for (const level of [0, 1, 2]) {
      const name = `A07_${variant.toUpperCase()}_LOD${level}`,
        nodes = d.nodes.filter((n) => n.name === name);
      if (nodes.length !== 1 || nodes[0].children?.length !== manifest.draws[variant][level])
        throw new Error('Invalid A07 LOD hierarchy');
      let tris = 0;
      for (const id of nodes[0].children!) {
        const ps = d.meshes[d.nodes[id]?.mesh ?? -1]?.primitives;
        if (
          ps?.length !== 1 ||
          ['POSITION', 'NORMAL', 'TEXCOORD_0'].some((k) => ps[0].attributes[k] === undefined)
        )
          throw new Error('Invalid A07 UV/topology contract');
        tris += d.accessors[ps[0].indices]?.count / 3;
      }
      if (tris !== manifest.triangles[variant][level])
        throw new Error('Invalid A07 triangle count');
    }
  for (const name of Object.keys(manifest.sockets))
    if (d.nodes.filter((n) => n.name === name).length !== 1) throw new Error('Missing A07 socket');
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
export function conformStartGantryGeometry(
  template: T.BufferGeometry,
  track: Track,
  matrix: T.Matrix4,
) {
  const g = template.clone(),
    p = g.getAttribute('position'),
    inverse = matrix.clone().invert();
  for (let i = 0; i < p.count; i++)
    if (p.getY(i) < -0.1) {
      const world = new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(matrix),
        q = trackPoint(),
        l = track.nearest(world.x, world.z, q);
      const ground =
        q.y + q.bank * Math.max(-12, Math.min(12, l)) + grassApronOffset(track, q.s, l);
      world.y = Math.min(world.y, ground - 0.1);
      world.applyMatrix4(inverse);
      p.setXYZ(i, world.x, world.y, world.z);
    }
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
interface Template {
  name: string;
  geometry: T.BufferGeometry;
  material: T.MeshStandardMaterial;
}
export class StartGantryKit {
  readonly root = new T.Group();
  readonly templates = new Map<string, Template[]>();
  readonly chunks: {
    levels: T.Group[];
    sphere: T.Sphere;
    level: number;
    modules: number;
  }[] = [];
  private disposed = false;

  constructor(private readonly source: T.Group) {
    this.root.name = 'A07 authored start-gantry supports';
    source.updateMatrixWorld(true);
    const allowed = new T.Box3(
      new T.Vector3().fromArray(manifest.bounds.min).addScalar(-1e-5),
      new T.Vector3().fromArray(manifest.bounds.max).addScalar(1e-5),
    );
    for (const variant of GANTRY_VARIANTS)
      for (const level of [0, 1, 2]) {
        const group = source.getObjectByName(`A07_${variant.toUpperCase()}_LOD${level}`);
        if (!group) throw new Error('Missing A07 level');
        const parts: Template[] = [];
        group.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          if (!(o.material instanceof T.MeshStandardMaterial))
            throw new Error('Invalid A07 material');
          const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
          geometry.computeBoundingBox();
          if (
            !geometry.index ||
            !geometry.getAttribute('normal') ||
            !geometry.getAttribute('uv') ||
            !allowed.containsBox(geometry.boundingBox!)
          )
            throw new Error('A07 outside its declared envelope');
          for (const name of ['position', 'normal', 'uv'])
            if (!Array.from(geometry.getAttribute(name).array).every(Number.isFinite))
              throw new Error('Non-finite A07 geometry');
          parts.push({ name: o.name, geometry, material: o.material });
          tagWeatherSurface(o.material, 'paint', 0.7);
        });
        if (parts.length !== manifest.draws[variant][level])
          throw new Error('A07 draw budget mismatch');
        this.templates.set(`${variant}:${level}`, parts);
      }
    for (const [name, point] of Object.entries(manifest.sockets)) {
      const node = source.getObjectByName(name);
      if (
        !node ||
        node.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3().fromArray(point)) > 1e-5
      )
        throw new Error('Invalid A07 socket position');
    }
  }
  build(track: Track, parent: T.Group, sightlines: BroadcastSightlines) {
    if (this.disposed) throw new Error('A07 disposed');
    if (this.chunks.length || this.root.parent) throw new Error('Duplicate A07 gantry');
    parent.add(this.root);
    parent.updateWorldMatrix(true, false);
    const levels: T.Group[] = [];
    const sphere = new T.Sphere(new T.Vector3(), -1);
    for (const level of [0, 1, 2]) {
      const group = new T.Group();
      group.name = `A07 start gantry LOD${level}`;
      this.root.add(group);
      for (const part of this.templates.get(`portal:${level}`)!) {
        const geometry = conformStartGantryGeometry(part.geometry, track, parent.matrixWorld),
          mesh = new T.Mesh(geometry, part.material);
        mesh.name = part.name;
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
        if (level === 0) {
          sphere.union(geometry.boundingSphere!.clone().applyMatrix4(parent.matrixWorld));
          if (Object.values(manifest.occluders).includes(part.name)) sightlines.add(mesh);
        }
      }
      group.visible = level === 2;
      levels.push(group);
    }
    this.chunks.push({ levels, sphere, level: 2, modules: 1 });
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
      assetId: 'A07',
      revision: manifest.revision,
      sha256: manifest.sha256,
      loaded: !this.disposed,
      chunks: this.chunks.length,
      modules: this.chunks.reduce((n, c) => n + c.modules, 0),
      retainedStartLamps: 5,
      retainedBanner: true,
      occluders: this.chunks.length ? Object.keys(manifest.occluders).length : 0,
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
export async function decodeStartGantry(bytes: Uint8Array<ArrayBuffer>, loader = new GLTFLoader()) {
  startGantryDocument(bytes);
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  if (sha !== manifest.sha256) throw new Error('A07 integrity mismatch');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  try {
    return new StartGantryKit(gltf.scene);
  } catch (error) {
    release([gltf.scene]);
    throw error;
  }
}
const aborted = () => new DOMException('A07 loading cancelled', 'AbortError');
export async function loadStartGantry(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 60000),
    poll = setInterval(() => {
      if (cancelled()) controller.abort();
    }, 50);
  let asset: StartGantryKit | undefined;
  try {
    if (cancelled()) throw aborted();
    const response = await fetcher(
      url ?? new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      { signal: controller.signal },
    );
    if (!response.ok || !response.body)
      throw new Error(`Unable to load A07 start gantry (${response.status})`);
    const bytes = new Uint8Array(manifest.bytes),
      reader = response.body.getReader();
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled() || controller.signal.aborted) throw aborted();
        if (size + value.length > bytes.length) throw new Error('A07 download exceeds byte budget');
        bytes.set(value, size);
        size += value.length;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (size !== bytes.length) throw new Error('Truncated A07 download');
    if (cancelled() || controller.signal.aborted) throw aborted();
    asset = await decodeStartGantry(bytes);
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
