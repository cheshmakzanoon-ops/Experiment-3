import { recoveryGatePlan, type RecoveryGateSite } from './recovery-gate-plan.ts';
import type { ServiceSite } from './venue-service-plan.ts';
import { recoveryApproachGeometry, inRecoveryApproach } from './recovery-gate-route.ts';
import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import manifest from './recovery-gates.manifest.json' with { type: 'json' };
import { Track } from '../simulation/track.ts';
import { conformTracksideGeometry } from './trackside-module-conformance.ts';
import { concreteBarrierLod } from './concrete-barriers.ts';
import { tagWeatherSurface } from './weather-presentation.ts';
import type { Quality } from './options.ts';
export const RECOVERY_GATES = manifest;
export const GATE_VARIANTS = ['recovery', 'maintenance', 'access'] as const;
type Variant = (typeof GATE_VARIANTS)[number];
interface GateDocument {
  asset: { version: string };
  nodes: { name?: string; mesh?: number; children?: number[] }[];
  meshes: { primitives: { indices: number; attributes: Record<string, number> }[] }[];
  accessors: { count: number }[];
  buffers: { uri?: string }[];
  images: { uri?: string; bufferView?: number }[];
  materials: unknown[];
}
export function recoveryGateDocument(bytes: Uint8Array<ArrayBuffer>): GateDocument {
  if (bytes.length !== manifest.bytes || bytes.length < 28 || bytes.length > 4 * 1024 * 1024)
    throw new Error('A05 byte count mismatch');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    len = v.getUint32(12, true);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length ||
    v.getUint32(16, true) !== 0x4e4f534a ||
    len > bytes.length - 28
  )
    throw new Error('Invalid A05 GLB header');
  const d = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as GateDocument;
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
    throw new Error('Invalid self-contained A05 contract');
  for (const variant of GATE_VARIANTS)
    for (const level of [0, 1, 2]) {
      const name = `A05_${variant.toUpperCase()}_LOD${level}`,
        nodes = d.nodes.filter((n) => n.name === name);
      if (nodes.length !== 1 || nodes[0].children?.length !== manifest.draws[variant][level])
        throw new Error('Invalid A05 LOD hierarchy');
      let tris = 0;
      const meshNodes: number[] = [];
      const collect = (id: number) => {
        const node = d.nodes[id];
        if (node.mesh !== undefined) meshNodes.push(id);
        for (const child of node.children ?? []) collect(child);
      };
      for (const id of nodes[0].children!) collect(id);
      if (meshNodes.length !== manifest.draws[variant][level])
        throw new Error('Invalid A05 pivot hierarchy');
      for (const id of meshNodes) {
        const ps = d.meshes[d.nodes[id]?.mesh ?? -1]?.primitives;
        if (
          ps?.length !== 1 ||
          ['POSITION', 'NORMAL', 'TEXCOORD_0'].some((k) => ps[0].attributes[k] === undefined)
        )
          throw new Error('Invalid A05 UV/topology contract');
        tris += d.accessors[ps[0].indices]?.count / 3;
      }
      if (tris !== manifest.triangles[variant][level])
        throw new Error('Invalid A05 triangle count');
    }
  for (const name of Object.keys(manifest.sockets))
    if (d.nodes.filter((n) => n.name === name).length !== 1) throw new Error('Missing A05 socket');
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
export function conformRecoveryGatesGeometry(
  template: T.BufferGeometry,
  track: Track,
  start: number,
  end: number,
  side: number,
  reverse = false,
) {
  return conformTracksideGeometry(template, track, start, end, side, manifest.span, reverse);
}
interface Template {
  geometry: T.BufferGeometry;
  material: T.MeshStandardMaterial;
}
export class RecoveryGatesKit {
  readonly root = new T.Group();
  readonly templates = new Map<string, Template[]>();
  readonly chunks: {
    levels: T.Group[];
    sphere: T.Sphere;
    level: number;
    modules: number;
    accessGates: number;
  }[] = [];
  private disposed = false;
  private accessBuilt = false;
  private services: readonly ServiceSite[] = [];
  private planned: readonly RecoveryGateSite[] = [];
  get sites() {
    return this.planned;
  }
  setSites(track: Track, services: readonly ServiceSite[]) {
    if (this.disposed || this.chunks.length) throw new Error('A05 placement already constructed');
    this.services = services.map((s) => ({ ...s, access: s.access?.map((p) => ({ ...p })) }));
    this.planned = recoveryGatePlan(track, this.services);
  }
  role(station: number, side: number): { variant: Variant; reverse: boolean } | null {
    const site = this.planned.find((s) => s.side === side && station >= s.start && station < s.end);
    return site ? { variant: site.variant, reverse: false } : null;
  }
  blocksVegetation(x: number, z: number, padding = 0) {
    return inRecoveryApproach(this.planned, x, z, padding);
  }

  constructor(private readonly source: T.Group) {
    this.root.name = 'A05 authored recovery-gates supports';
    source.updateMatrixWorld(true);
    const allowed = new T.Box3(
      new T.Vector3().fromArray(manifest.bounds.min).addScalar(-1e-5),
      new T.Vector3().fromArray(manifest.bounds.max).addScalar(1e-5),
    );
    for (const variant of GATE_VARIANTS)
      for (const level of [0, 1, 2]) {
        const group = source.getObjectByName(`A05_${variant.toUpperCase()}_LOD${level}`);
        if (!group) throw new Error('Missing A05 level');
        const parts: Template[] = [];
        group.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          if (!(o.material instanceof T.MeshStandardMaterial))
            throw new Error('Invalid A05 material');
          const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
          geometry.computeBoundingBox();
          if (
            !geometry.index ||
            !geometry.getAttribute('normal') ||
            !geometry.getAttribute('uv') ||
            !allowed.containsBox(geometry.boundingBox!)
          )
            throw new Error('A05 outside its declared envelope');
          for (const name of ['position', 'normal', 'uv'])
            if (!Array.from(geometry.getAttribute(name).array).every(Number.isFinite))
              throw new Error('Non-finite A05 geometry');
          parts.push({ geometry, material: o.material });
          tagWeatherSurface(o.material, 'paint', 0.7);
        });
        if (parts.length !== manifest.draws[variant][level])
          throw new Error('A05 draw budget mismatch');
        this.templates.set(`${variant}:${level}`, parts);
      }
    for (const [name, entry] of Object.entries(manifest.hinges)) {
      const node = source.getObjectByName(name);
      if (
        !node ||
        node.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3().fromArray(entry.pivot)) >
          1e-5 ||
        node.quaternion.angleTo(new T.Quaternion()) > 1e-5 ||
        node.userData.runtimeLockedClosed !== true
      )
        throw new Error('Invalid A05 closed hinge');
    }
    for (const [name, point] of Object.entries(manifest.sockets)) {
      const node = source.getObjectByName(name);
      if (
        !node ||
        node.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3().fromArray(point)) > 1e-5
      )
        throw new Error('Invalid A05 socket position');
    }
  }
  buildAccessGates(track: Track, parent: T.Group) {
    if (this.disposed || this.accessBuilt) throw new Error('A05 access already constructed');
    this.accessBuilt = true;
    if (!this.root.parent) parent.add(this.root);
    if (this.root.parent !== parent) throw new Error('A05 already attached elsewhere');
    for (const site of this.services) {
      const access = site.access ?? [];
      if (access.length < 2) continue;
      const end = access.at(-1)!,
        prior = access.at(-2)!,
        forward = new T.Vector3(end.x - prior.x, 0, end.z - prior.z).normalize();
      const across = new T.Vector3(-forward.z, 0, forward.x),
        matrix = new T.Matrix4().makeBasis(
          forward,
          new T.Vector3(0, 1, 0),
          across.multiplyScalar(3.4 / manifest.span),
        );
      matrix.setPosition(
        new T.Vector3(end.x, end.y, end.z).addScaledVector(across, -manifest.span / 2),
      );
      const levels: T.Group[] = [];
      let sphere = new T.Sphere();
      for (const level of [0, 1, 2]) {
        const parts = this.templates.get(`access:${level}`)!,
          gs = parts.map((p) => p.geometry.clone().applyMatrix4(matrix)),
          g = mergeGeometries(gs, false)!;
        gs.forEach((p) => p.dispose());
        g.computeBoundingSphere();
        const group = new T.Group(),
          mesh = new T.Mesh(g, parts[0].material);
        mesh.castShadow = mesh.receiveShadow = true;
        group.name = `A05 service access ${site.s} LOD${level}`;
        group.add(mesh);
        group.visible = level === 2;
        this.root.add(group);
        levels.push(group);
        if (level === 0) sphere = g.boundingSphere!.clone();
      }
      this.chunks.push({ levels, sphere, level: 2, modules: 1, accessGates: 1 });
    }
    const asphalt = tagWeatherSurface(
      new T.MeshStandardMaterial({ color: 0x414747, roughness: 0.96 }),
      'paving',
    );
    for (const site of this.planned) {
      const mesh = new T.Mesh(recoveryApproachGeometry(track, site), asphalt);
      mesh.name = `A05 grounded route ${site.sourceStation}-${Math.round(site.s)}m`;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    }
    if (!this.planned.length) asphalt.dispose();
  }
  buildChunk(track: Track, parent: T.Group, start: number, end: number) {
    if (this.disposed) throw new Error('A05 disposed');
    const count = Math.ceil((end - start) / 3.8);
    const segments: { a: number; b: number; side: number; variant: Variant; reverse: boolean }[] =
      [];
    for (const side of [-1, 1])
      for (let i = 0; i < count; i++) {
        const a = start + ((end - start) * i) / count,
          b = start + ((end - start) * (i + 1)) / count;
        const role = this.role((a + b) / 2, side);
        if (role) segments.push({ a: a + 0.008, b: b - 0.008, side, ...role });
      }
    if (!segments.length) return;
    if (!this.root.parent) parent.add(this.root);
    if (this.root.parent !== parent) throw new Error('A05 already attached elsewhere');
    const build = (chosen: typeof segments): void => {
      const levels: T.Group[] = [],
        batch = this.chunks.length;
      let sphere = new T.Sphere(new T.Vector3(), -1);
      for (const level of [0, 1, 2]) {
        const group = new T.Group();
        group.name = `A05 batch ${batch} ${Math.round(start)}-${Math.round(end)}m LOD${level}`;
        const batches = new Map<T.MeshStandardMaterial, T.BufferGeometry[]>();
        for (const segment of chosen)
          for (const part of this.templates.get(`${segment.variant}:${level}`)!) {
            const parts = batches.get(part.material) ?? [];
            parts.push(
              conformRecoveryGatesGeometry(
                part.geometry,
                track,
                segment.a,
                segment.b,
                segment.side,
                segment.reverse,
              ),
            );
            batches.set(part.material, parts);
          }
        for (const [material, parts] of batches) {
          const geometry = mergeGeometries(parts, false)!;
          parts.forEach((p) => p.dispose());
          geometry.computeBoundingSphere();
          const mesh = new T.Mesh(geometry, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.name = group.name + ' ' + material.name;
          group.add(mesh);
        }
        if (level === 0) {
          sphere = new T.Sphere(new T.Vector3(), -1);
          for (const mesh of group.children as T.Mesh[])
            sphere.union(mesh.geometry.boundingSphere!);
          // Outer hairpin rails and paired sides can exceed the intended bound
          // even inside an 80m station span. Subdivide the original segment list,
          // never recompute its grid or change placement to make a bound pass.
          if (sphere.radius >= 50) {
            for (const mesh of group.children as T.Mesh[]) mesh.geometry.dispose();
            group.clear();
            if (chosen.length < 2) throw new Error('A05 module exceeds culling bounds');
            const middle = Math.ceil(chosen.length / 2);
            build(chosen.slice(0, middle));
            build(chosen.slice(middle));
            return;
          }
        }
        group.visible = level === 2;
        this.root.add(group);
        levels.push(group);
      }
      this.chunks.push({
        levels,
        sphere,
        level: 2,
        modules: chosen.length,
        accessGates: 0,
      });
    };
    build(segments);
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
      assetId: 'A05',
      revision: manifest.revision,
      sha256: manifest.sha256,
      loaded: !this.disposed,
      chunks: this.chunks.length,
      modules: this.chunks.reduce((n, c) => n + c.modules, 0),
      accessGates: this.chunks.reduce((n, c) => n + c.accessGates, 0),
      circuitGates: this.chunks.reduce((n, c) => n + c.modules - c.accessGates, 0),
      routes: this.accessBuilt ? this.planned.length : 0,
      selectedLods: [0, 1, 2].map((i) => this.chunks.filter((c) => c.level === i).length),
      gateOperation: false,
      retainedAnalyticWire: true,
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
export async function decodeRecoveryGates(
  bytes: Uint8Array<ArrayBuffer>,
  loader = new GLTFLoader(),
) {
  recoveryGateDocument(bytes);
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  if (sha !== manifest.sha256) throw new Error('A05 integrity mismatch');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  try {
    return new RecoveryGatesKit(gltf.scene);
  } catch (error) {
    release([gltf.scene]);
    throw error;
  }
}
const aborted = () => new DOMException('A05 loading cancelled', 'AbortError');
export async function loadRecoveryGates(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  const controller = new AbortController(),
    timeout = setTimeout(() => controller.abort(), 60000),
    poll = setInterval(() => {
      if (cancelled()) controller.abort();
    }, 50);
  let asset: RecoveryGatesKit | undefined;
  try {
    if (cancelled()) throw aborted();
    const response = await fetcher(
      url ?? new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      { signal: controller.signal },
    );
    if (!response.ok || !response.body)
      throw new Error(`Unable to load A05 recovery gates (${response.status})`);
    const bytes = new Uint8Array(manifest.bytes),
      reader = response.body.getReader();
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled() || controller.signal.aborted) throw aborted();
        if (size + value.length > bytes.length) throw new Error('A05 download exceeds byte budget');
        bytes.set(value, size);
        size += value.length;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (size !== bytes.length) throw new Error('Truncated A05 download');
    if (cancelled() || controller.signal.aborted) throw aborted();
    asset = await decodeRecoveryGates(bytes);
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
