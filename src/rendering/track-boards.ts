import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './track-boards.manifest.json' with { type: 'json' };
import { Track } from '../simulation/track.ts';
import {
  conformTrackBoardGeometry,
  trackBoardMatrix,
  trackBoardPlan,
  type TrackBoardSite,
} from './track-board-plan.ts';
import { label } from './geometry.ts';
import { concreteBarrierLod } from './concrete-barriers.ts';
import { tagWeatherSurface } from './weather-presentation.ts';
import type { Quality } from './options.ts';
export const TRACK_BOARDS = manifest;
export const BOARD_VARIANTS = ['clean', 'worn', 'sector'] as const;
interface BoardDocument {
  asset: { version: string };
  nodes: { name?: string; mesh?: number; children?: number[] }[];
  meshes: { primitives: { indices: number; attributes: Record<string, number> }[] }[];
  accessors: { count: number }[];
  buffers: { uri?: string }[];
  images: { uri?: string; bufferView?: number }[];
  materials: unknown[];
}
export function trackBoardDocument(bytes: Uint8Array<ArrayBuffer>): BoardDocument {
  if (bytes.length !== manifest.bytes || bytes.length < 28 || bytes.length > 4 * 1024 * 1024)
    throw new Error('A09 byte count mismatch');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    len = v.getUint32(12, true);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length ||
    v.getUint32(16, true) !== 0x4e4f534a ||
    len > bytes.length - 28
  )
    throw new Error('Invalid A09 GLB header');
  const d = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as BoardDocument;
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
    throw new Error('Invalid self-contained A09 contract');
  for (const variant of BOARD_VARIANTS)
    for (const level of [0, 1, 2]) {
      const name = `A09_${variant.toUpperCase()}_LOD${level}`,
        nodes = d.nodes.filter((n) => n.name === name);
      if (nodes.length !== 1 || nodes[0].children?.length !== manifest.draws[variant][level])
        throw new Error('Invalid A09 LOD hierarchy');
      let tris = 0;
      for (const id of nodes[0].children!) {
        const ps = d.meshes[d.nodes[id]?.mesh ?? -1]?.primitives;
        if (
          ps?.length !== 1 ||
          ['POSITION', 'NORMAL', 'TEXCOORD_0'].some((k) => ps[0].attributes[k] === undefined)
        )
          throw new Error('Invalid A09 UV/topology contract');
        tris += d.accessors[ps[0].indices]?.count / 3;
      }
      if (tris !== manifest.triangles[variant][level])
        throw new Error('Invalid A09 triangle count');
    }
  for (const name of Object.keys(manifest.sockets))
    if (d.nodes.filter((n) => n.name === name).length !== 1) throw new Error('Missing A09 socket');
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
export class TrackBoardsKit {
  readonly root = new T.Group();
  readonly templates = new Map<string, Template[]>();
  readonly chunks: {
    levels: T.Group[];
    sphere: T.Sphere;
    level: number;
    modules: number;
    variant: TrackBoardSite['variant'];
  }[] = [];
  private disposed = false;
  private stations = new Set<string>();
  readonly labels = new Map<string, T.MeshStandardMaterial>();
  sites: readonly TrackBoardSite[] = [];
  constructor(
    private readonly source: T.Group,
    private readonly makeLabel: (text: string, width: number, height: number) => T.Texture = (
      text,
      w,
      h,
    ) => label(text, '#171d21', '#f5eee2', w, h),
  ) {
    this.root.name = 'A09 authored braking and sector boards';
    source.updateMatrixWorld(true);
    const allowed = new T.Box3(
      new T.Vector3().fromArray(manifest.bounds.min).addScalar(-1e-5),
      new T.Vector3().fromArray(manifest.bounds.max).addScalar(1e-5),
    );
    for (const variant of BOARD_VARIANTS)
      for (const level of [0, 1, 2]) {
        const group = source.getObjectByName(`A09_${variant.toUpperCase()}_LOD${level}`);
        if (!group) throw new Error('Missing A09 level');
        const parts: Template[] = [];
        group.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          if (!(o.material instanceof T.MeshStandardMaterial))
            throw new Error('Invalid A09 material');
          const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
          geometry.computeBoundingBox();
          if (
            !geometry.index ||
            !geometry.getAttribute('normal') ||
            !geometry.getAttribute('uv') ||
            !allowed.containsBox(geometry.boundingBox!)
          )
            throw new Error('A09 outside its declared envelope');
          for (const name of ['position', 'normal', 'uv'])
            if (!Array.from(geometry.getAttribute(name).array).every(Number.isFinite))
              throw new Error('Non-finite A09 geometry');
          parts.push({ geometry, material: o.material });
          tagWeatherSurface(o.material, 'paint', 0.7);
        });
        if (parts.length !== manifest.draws[variant][level])
          throw new Error('A09 draw budget mismatch');
        this.templates.set(`${variant}:${level}`, parts);
      }
    for (const [name, point] of Object.entries(manifest.sockets)) {
      const node = source.getObjectByName(name);
      if (
        !node ||
        node.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3().fromArray(point)) > 1e-5
      )
        throw new Error('Invalid A09 socket position');
    }
  }
  build(track: Track, parent: T.Group) {
    if (this.disposed) throw new Error('A09 disposed');
    if (this.chunks.length) throw new Error('Duplicate A09 boards');
    this.sites = trackBoardPlan(track);
    parent.add(this.root);
    for (const site of this.sites) {
      const key = `${site.s}:${site.text}`;
      if (this.stations.has(key)) throw new Error('Duplicate A09 station');
      this.stations.add(key);
      const spec = manifest.faces[site.variant];
      let graphic = this.labels.get(site.text);
      if (!graphic) {
        graphic = new T.MeshStandardMaterial({
          map: this.makeLabel(site.text, spec.textureSize[0], spec.textureSize[1]),
          roughness: 0.72,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        graphic.name = `A09 retained graphic ${site.text}`;
        tagWeatherSurface(graphic, 'paint', 0.7);
        this.labels.set(site.text, graphic);
      }
      const levels: T.Group[] = [];
      let sphere = new T.Sphere();
      for (const level of [0, 1, 2]) {
        const group = new T.Group();
        group.name = `A09 ${site.text} ${Math.round(site.s)}m LOD${level}`;
        for (const part of this.templates.get(`${site.variant}:${level}`)!) {
          const geometry = conformTrackBoardGeometry(part.geometry, track, site),
            mesh = new T.Mesh(geometry, part.material);
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.name = group.name + ' structure';
          group.add(mesh);
          if (level === 0) sphere = geometry.boundingSphere!.clone();
        }
        const geometry = new T.PlaneGeometry(spec.width, spec.height)
          .translate(...(spec.position as [number, number, number]))
          .applyMatrix4(trackBoardMatrix(site));
        geometry.computeBoundingSphere();
        const face = new T.Mesh(geometry, graphic);
        face.name = group.name + ' print';
        face.castShadow = false;
        face.receiveShadow = true;
        group.add(face);
        group.visible = level === 2;
        this.root.add(group);
        levels.push(group);
      }
      this.chunks.push({ levels, sphere, level: 2, modules: 1, variant: site.variant });
    }
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
      assetId: 'A09',
      revision: manifest.revision,
      sha256: manifest.sha256,
      loaded: !this.disposed,
      chunks: this.chunks.length,
      modules: this.chunks.reduce((n, c) => n + c.modules, 0),
      brakingBoards: this.chunks.filter((c) => c.variant !== 'sector').length,
      sectorBoards: this.chunks.filter((c) => c.variant === 'sector').length,
      labelTextures: this.labels.size,
      facesApproach: true,
      retainedBrakingStations: true,
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
    this.labels.clear();
  }
}
export async function decodeTrackBoards(
  bytes: Uint8Array<ArrayBuffer>,
  loader = new GLTFLoader(),
  makeLabel?: (text: string, width: number, height: number) => T.Texture,
) {
  trackBoardDocument(bytes);
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  if (sha !== manifest.sha256) throw new Error('A09 integrity mismatch');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  try {
    return new TrackBoardsKit(gltf.scene, makeLabel);
  } catch (error) {
    release([gltf.scene]);
    throw error;
  }
}
const aborted = () => new DOMException('A09 loading cancelled', 'AbortError');
export async function loadTrackBoards(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 60000),
    poll = setInterval(() => {
      if (cancelled()) controller.abort();
    }, 50);
  let asset: TrackBoardsKit | undefined;
  try {
    if (cancelled()) throw aborted();
    const response = await fetcher(
      url ?? new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      { signal: controller.signal },
    );
    if (!response.ok || !response.body)
      throw new Error(`Unable to load A09 track boards (${response.status})`);
    const bytes = new Uint8Array(manifest.bytes),
      reader = response.body.getReader();
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled() || controller.signal.aborted) throw aborted();
        if (size + value.length > bytes.length) throw new Error('A09 download exceeds byte budget');
        bytes.set(value, size);
        size += value.length;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (size !== bytes.length) throw new Error('Truncated A09 download');
    if (cancelled() || controller.signal.aborted) throw aborted();
    asset = await decodeTrackBoards(bytes);
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
