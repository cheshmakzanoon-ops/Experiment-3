import { SceneryPassDetail } from './scenery-pass-detail.ts';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import manifest from './aurel-quarry.manifest.json' with { type: 'json' };
import {
  aurelQuarryPlan,
  inQuarryFootprint,
  quarryGround,
  type QuarrySite,
  type QuarryExclusion,
  type QuarryVariant,
} from './aurel-quarry-plan.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { grassApronOffset } from './ground-profile.ts';
import { terrainFor } from './terrain.ts';
import { type ServiceSite } from './venue-service-plan.ts';
import { BuildQueue } from './build-queue.ts';
import { cameraDetailDistance } from './camera-detail.ts';
import type { Quality } from './options.ts';
import { tagWeatherSurface } from './weather-presentation.ts';

export const AUREL_QUARRY = manifest;
interface QuarryDocument {
  asset: { version: string };
  nodes: { name?: string; mesh?: number }[];
  meshes: { primitives: { indices: number; attributes: Record<string, number> }[] }[];
  accessors: { count: number }[];
  buffers: { uri?: string }[];
  images: { uri?: string; bufferView?: number }[];
  materials: unknown[];
  skins?: unknown[];
  animations?: unknown[];
}
export function quarryDocument(bytes: Uint8Array<ArrayBuffer>): QuarryDocument {
  if (bytes.length !== manifest.bytes || bytes.length < 28 || bytes.length > 2 * 1024 * 1024)
    throw new Error('A55-A60 byte count mismatch');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    length = v.getUint32(12, true);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length ||
    v.getUint32(16, true) !== 0x4e4f534a ||
    length > bytes.length - 28
  )
    throw new Error('Invalid A55-A60 GLB header');
  const d = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as QuarryDocument;
  if (
    d.asset?.version !== '2.0' ||
    d.nodes?.length !== manifest.nodes ||
    d.meshes?.length !== manifest.meshes ||
    d.materials?.length !== manifest.materials ||
    d.images?.length !== manifest.images ||
    d.buffers?.length !== 1 ||
    d.buffers[0].uri ||
    d.images.some((i) => i.uri || !Number.isInteger(i.bufferView)) ||
    d.skins?.length ||
    d.animations?.length
  )
    throw new Error('Invalid self-contained A55-A60 contract');
  for (const name of manifest.variants as QuarryVariant[])
    for (let level = 0; level < 3; level++) {
      const nodes = d.nodes.filter((n) => n.name === `${name}_LOD${level}`),
        ps = d.meshes[nodes[0]?.mesh ?? -1]?.primitives;
      if (
        nodes.length !== 1 ||
        ps?.length !== 1 ||
        ['POSITION', 'NORMAL', 'TEXCOORD_0'].some((k) => ps[0].attributes[k] === undefined) ||
        d.accessors[ps[0].indices]?.count !== manifest.triangles[name][level] * 3
      )
        throw new Error('Invalid A55-A60 topology contract');
    }
  return d;
}
function releaseSource(root: T.Object3D) {
  const gs = new Set<T.BufferGeometry>(),
    ms = new Set<T.Material>(),
    ts = new Set<T.Texture>(),
    images = new Set<ImageBitmap>();
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
    if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) images.add(t.image);
  });
  images.forEach((i) => i.close());
}
/** Main-view hysteresis is not changed by smaller reflection/shadow cameras. */
export function quarryLod(distance: number, previous: number, quality: Quality) {
  if (!Number.isFinite(distance) || distance < 0) throw new Error('Invalid quarry LOD distance');
  const scale = quality === 'high' ? 1.3 : quality === 'low' ? 0.65 : 1,
    near = 70 * scale,
    middle = 230 * scale;
  if (previous === 0 && distance < near * 1.14) return 0;
  if (previous === 1 && distance >= near * 0.86 && distance < middle * 1.14) return 1;
  if (previous === 2 && distance >= middle * 0.86) return 2;
  return distance < near ? 0 : distance < middle ? 1 : 2;
}
export interface QuarryChunk {
  mesh: T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>;
  ranges: { start: number; count: number }[];
  sphere: T.Sphere;
  level: number;
  background: boolean;
  sites: number;
}
/** Seam-bound apron-to-terrain transition. Only the inaccessible outer slope is
 * dressed; every road, kerb, runoff and physical contact triangle is unchanged. */
export function quarrySkirtGeometry(track: Track, start: number, end: number) {
  if (
    track.circuit.id !== 'aurel' ||
    !Number.isFinite(start + end) ||
    start < 1080 ||
    end > 1480 ||
    end <= start ||
    end - start > 80
  )
    throw new Error('Invalid quarry ground strip');
  const rows = Math.ceil((end - start) / 3),
    cols = 6,
    p = trackPoint(),
    pos: number[] = [],
    uv: number[] = [],
    color: number[] = [],
    indices: number[] = [];
  const ground = terrainFor(track);
  for (let i = 0; i <= rows; i++) {
    const s = start + ((end - start) * i) / rows;
    track.at(s, p);
    const inner = p.width + 37.8;
    const taper = Math.min(1, (s - 1080) / 40, (1480 - s) / 40),
      outer = inner + Math.max(0.2, taper * 12);
    for (let j = 0; j <= cols; j++) {
      const t = j / cols,
        l = -(inner + (outer - inner) * t),
        x = p.x + p.nx * l,
        z = p.z + p.nz * l;
      const apron = p.y + p.bank * Math.max(-12, l) + grassApronOffset(track, s, l);
      const mix = t * t * (3 - 2 * t),
        y = apron * (1 - mix) + ground.height(x, z) * mix - 0.006;
      pos.push(x, y, z);
      uv.push(l / 5, s / 5);
      color.push(0.56 + 0.44 * mix, 0.63 + 0.37 * mix, 0.35 + 0.6 * mix);
    }
  }
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++) {
      const a = i * (cols + 1) + j,
        b = a + cols + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new T.Float32BufferAttribute(color, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export class AurelQuarryKit {
  readonly root = new T.Group();
  readonly chunks: QuarryChunk[] = [];
  readonly templates = new Map<string, T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>>();
  sites: readonly QuarrySite[] = [];
  private disposed = false;
  private prepared = false;
  private quality: Quality = 'medium';
  private primaryCamera: T.Camera | null = null;
  private readonly eye = new T.Vector3();
  private readonly centre = new T.Vector3();
  private readonly passDetail = new SceneryPassDetail();
  private readonly depths = new Set<T.MeshDepthMaterial>();
  private readonly distances = new Set<T.MeshDistanceMaterial>();
  constructor(private readonly source: T.Group) {
    this.root.name = 'A55-A60 authored Quarry and ground integration';
    source.updateMatrixWorld(true);
    for (const variant of manifest.variants as QuarryVariant[])
      for (let level = 0; level < 3; level++) {
        const name = `${variant}_LOD${level}`,
          o = source.getObjectByName(name);
        if (
          !(o instanceof T.Mesh) ||
          !(o.material instanceof T.MeshStandardMaterial) ||
          !o.geometry.index
        )
          throw new Error('Missing A55-A60 mesh');
        if (!o.matrixWorld.equals(new T.Matrix4()))
          throw new Error('Unexpected A55-A60 source transform');
        const p = o.geometry.getAttribute('position'),
          n = o.geometry.getAttribute('normal'),
          uv = o.geometry.getAttribute('uv'),
          b = manifest.bounds[variant];
        if (!p || !n || !uv || p.count !== n.count || p.count !== uv.count)
          throw new Error('Incomplete A55-A60 attributes');
        for (let i = 0; i < p.count; i++) {
          const point = [p.getX(i), p.getY(i), p.getZ(i)],
            normal = [n.getX(i), n.getY(i), n.getZ(i)];
          if (
            ![...point, ...normal, uv.getX(i), uv.getY(i)].every(Number.isFinite) ||
            Math.abs(Math.hypot(...normal) - 1) > 0.002 ||
            point.some((v, k) => v < b.min[k] - 0.002 || v > b.max[k] + 0.002)
          )
            throw new Error('Invalid A55-A60 geometry');
        }
        const m = o.material;
        m.vertexColors = true;
        if (variant === 'shrub' || variant === 'hedge') {
          m.alphaTest = 0.45;
          m.transparent = false;
          m.side = T.DoubleSide;
          if (m.map) m.map.userData.foliageAlphaCutoff = 0.45;
          tagWeatherSurface(m, 'foliage');
        } else if (variant === 'tussock') {
          m.side = T.DoubleSide;
          tagWeatherSurface(m, 'grass');
        } else tagWeatherSurface(m, 'stone');
        this.templates.set(name, o as T.Mesh<T.BufferGeometry, T.MeshStandardMaterial>);
      }
  }
  blocksPlanting(track: Track, x: number, z: number, padding: number) {
    if (inQuarryFootprint(this.sites, x, z, padding)) return true;
    const p = trackPoint(),
      l = track.nearest(x, z, p);
    // The new outer slope has its own height; do not leave old terrain-grounded
    // trunks floating in it or bury their roots by draping new scenery over them.
    return (
      p.s >= 1080 - padding &&
      p.s <= 1480 + padding &&
      l < -(p.width + 37.6 - padding) &&
      l > -(p.width + 50 + padding)
    );
  }
  enqueue(
    track: Track,
    parent: T.Group,
    services: readonly ServiceSite[],
    queue: BuildQueue,
    excluded?: QuarryExclusion,
  ) {
    if (this.disposed || this.prepared)
      throw new Error('A55-A60 library already built or disposed');
    this.prepared = true;
    this.sites = aurelQuarryPlan(track, services, excluded);
    if (track.circuit.id !== 'aurel') return;
    queue.add('Quarry library attachment', 2.4, () => parent.add(this.root));
    const buckets = new Map<string, QuarrySite[]>();
    for (const site of this.sites) {
      const material = this.templates.get(`${site.variant}_LOD0`)!.material;
      const key = `${Math.floor(site.x / 96)},${Math.floor(site.z / 96)}/${material.name}/${site.variant === 'ridge' ? 'background' : 'foreground'}`;
      const list = buckets.get(key) ?? [];
      list.push(site);
      buckets.set(key, list);
    }
    for (const [key, sites] of buckets)
      queue.add('Bounded Quarry geometry chunk', 2.5, () => this.buildChunk(track, key, sites));
    const material = this.templates.get('cliff-bench_LOD0')!.material;
    for (let start = 1080; start < 1480; start += 80)
      queue.add('Quarry apron transition', 2.5, () => {
        const g = quarrySkirtGeometry(track, start, start + 80),
          mesh = new T.Mesh(g, material);
        mesh.name = `A59 grounded scree transition ${start}`;
        mesh.receiveShadow = true;
        this.root.add(mesh);
      });
  }
  private buildChunk(track: Track, key: string, sites: readonly QuarrySite[]) {
    const geometries: T.BufferGeometry[] = [],
      ranges: { start: number; count: number }[] = [];
    let offset = 0;
    for (let level = 0; level < 3; level++) {
      const parts: T.BufferGeometry[] = [];
      for (const site of sites) {
        const template = this.templates.get(`${site.variant}_LOD${level}`)!,
          g = new T.BufferGeometry();
        for (const attr of ['position', 'normal', 'uv'])
          g.setAttribute(attr, template.geometry.getAttribute(attr).clone());
        g.setIndex(template.geometry.index!.clone());
        const matrix = new T.Matrix4().compose(
          new T.Vector3(site.x, 0, site.z),
          new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), site.yaw),
          new T.Vector3(...site.scale),
        );
        g.applyMatrix4(matrix);
        const p = g.getAttribute('position'),
          colors = new Float32Array(p.count * 3),
          shade = 0.86 + (Math.floor(site.station + 91) % 7) * 0.021;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i),
            z = p.getZ(i);
          p.setY(i, p.getY(i) + quarryGround(track, x, z, site.ground));
          colors.set([shade, shade * 0.985, shade * 0.95], i * 3);
        }
        g.setAttribute('color', new T.BufferAttribute(colors, 3));
        g.computeVertexNormals();
        parts.push(g);
      }
      const joined = mergeGeometries(parts, false);
      parts.forEach((g) => g.dispose());
      if (!joined?.index) throw new Error('Unable to batch A55-A60 geometry');
      ranges.push({ start: offset, count: joined.index.count });
      offset += joined.index.count;
      geometries.push(joined);
    }
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach((g) => g.dispose());
    if (!geometry) throw new Error('Unable to pack A55-A60 levels');
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.setDrawRange(ranges[2].start, ranges[2].count);
    const material = this.templates.get(`${sites[0].variant}_LOD0`)!.material,
      mesh = new T.Mesh(geometry, material);
    const chunk: QuarryChunk = {
      mesh,
      ranges,
      sphere: geometry.boundingSphere!.clone(),
      level: -1,
      background: sites[0].variant === 'ridge',
      sites: sites.length,
    };
    mesh.name = `A55-A60 spatial chunk ${key}`;
    mesh.castShadow =
      !chunk.background &&
      material.name !== 'A55_A60_GRASS' &&
      !sites.every((s) => ['drain-collar', 'verge-edge'].includes(s.variant));
    mesh.receiveShadow = true;
    if (material.alphaTest > 0) {
      const depth = new T.MeshDepthMaterial({
        depthPacking: T.RGBADepthPacking,
        map: material.map,
        alphaTest: 0.45,
        side: T.DoubleSide,
      });
      const distance = new T.MeshDistanceMaterial({
        map: material.map,
        alphaTest: 0.45,
        side: T.DoubleSide,
      });
      mesh.customDepthMaterial = depth;
      mesh.customDistanceMaterial = distance;
      this.depths.add(depth);
      this.distances.add(distance);
    }
    mesh.onBeforeRender = (renderer, _scene, camera) => this.select(chunk, camera, renderer);
    // Three passes the viewing camera third and the actual light camera fourth.
    mesh.onBeforeShadow = (renderer, _object, _viewCamera, shadowCamera) =>
      this.select(chunk, shadowCamera, renderer);
    this.root.add(mesh);
    this.chunks.push(chunk);
  }
  private select(chunk: QuarryChunk, camera: T.Camera, renderer?: T.WebGLRenderer | null) {
    if (this.disposed) return;
    let level = 2;
    if (
      !chunk.background &&
      (camera instanceof T.PerspectiveCamera ||
        (camera instanceof T.OrthographicCamera && renderer))
    ) {
      camera.getWorldPosition(this.eye);
      this.centre.copy(chunk.sphere.center).applyMatrix4(this.root.matrixWorld);
      const d = Math.max(
        0,
        this.eye.distanceTo(this.centre) -
          chunk.sphere.radius * this.root.matrixWorld.getMaxScaleOnAxis(),
      );
      const primary = camera === this.primaryCamera;
      level = quarryLod(
        renderer && !primary
          ? this.passDetail.distance(d, camera, renderer)
          : cameraDetailDistance(d, camera as T.PerspectiveCamera),
        primary ? chunk.level : -1,
        this.quality,
      );
      if (primary) chunk.level = level;
    }
    const range = chunk.ranges[level];
    chunk.mesh.geometry.setDrawRange(range.start, range.count);
  }
  update(camera: T.Camera, quality: Quality) {
    if (this.disposed) return;
    this.primaryCamera = camera;
    this.quality = quality;
    this.root.updateWorldMatrix(true, false);
    for (const chunk of this.chunks) this.select(chunk, camera);
  }
  diagnostics() {
    return {
      revision: manifest.revision,
      sites: this.sites.length,
      chunks: this.chunks.length,
      families: Object.fromEntries(
        manifest.variants.map((v) => [v, this.sites.filter((s) => s.variant === v).length]),
      ),
      geometryBytes: this.chunks.reduce(
        (sum, c) =>
          sum +
          c.mesh.geometry.index!.array.byteLength +
          Object.values(c.mesh.geometry.attributes).reduce((n, a) => n + a.array.byteLength, 0),
        0,
      ),
      finalArtApproved: false,
    };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if (o instanceof T.Mesh) o.geometry.dispose();
    });
    this.root.clear();
    this.chunks.length = 0;
    this.depths.forEach((m) => m.dispose());
    this.distances.forEach((m) => m.dispose());
    this.templates.clear();
    releaseSource(this.source);
  }
}
export async function decodeAurelQuarry(bytes: Uint8Array<ArrayBuffer>, loader = new GLTFLoader()) {
  quarryDocument(bytes);
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  if (sha !== manifest.sha256) throw new Error('A55-A60 integrity mismatch');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  try {
    return new AurelQuarryKit(gltf.scene);
  } catch (error) {
    releaseSource(gltf.scene);
    throw error;
  }
}
export async function loadAurelQuarry(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  const controller = new AbortController(),
    aborted = () => new DOMException('A55-A60 loading cancelled', 'AbortError'),
    timeout = setTimeout(() => controller.abort(), 60000),
    poll = setInterval(() => {
      if (cancelled()) controller.abort();
    }, 50);
  let asset: AurelQuarryKit | undefined;
  try {
    if (cancelled()) throw aborted();
    const response = await fetcher(
      url ?? new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      { signal: controller.signal },
    );
    if (!response.ok || !response.body)
      throw new Error(`Unable to load A55-A60 (${response.status})`);
    const bytes = new Uint8Array(manifest.bytes),
      reader = response.body.getReader();
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled() || controller.signal.aborted) throw aborted();
        if (size + value.length > bytes.length)
          throw new Error('A55-A60 download exceeds byte budget');
        bytes.set(value, size);
        size += value.length;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (size !== bytes.length) throw new Error('Truncated A55-A60 download');
    if (cancelled() || controller.signal.aborted) throw aborted();
    asset = await decodeAurelQuarry(bytes);
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
