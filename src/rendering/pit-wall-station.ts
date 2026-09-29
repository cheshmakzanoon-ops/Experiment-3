import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import manifest from './pit-wall-station.manifest.json' with { type: 'json' };
import { detailDistance } from './view-detail.ts';
import type { Quality } from './options.ts';
import { Track, trackPoint } from '../simulation/track.ts';
import { grassApronOffset } from './ground-profile.ts';
import { clamp } from '../core/math.ts';
import { H } from '../simulation/protocol.ts';
import {
  paintStationAtlas,
  readStationData,
  stationDataKey,
  StationDisplayClock,
  type StationMode,
  type StationReadout,
} from './pit-wall-display.ts';

export const PIT_WALL_STATION = manifest;
const abort = () => new DOMException('Pit-wall loading cancelled', 'AbortError');
const hash = async (bytes: Uint8Array<ArrayBuffer>) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
interface StationDocument {
  asset: { version: string };
  scene: number;
  scenes: { nodes: number[] }[];
  nodes: { name?: string; mesh?: number; children?: number[] }[];
  meshes: { primitives: { indices: number; attributes: { POSITION: number } }[] }[];
  accessors: { count: number }[];
  buffers: { byteLength: number; uri?: string }[];
  images: { uri?: string; bufferView?: number }[];
  materials: unknown[];
}
/** Only the pinned self-contained, static hierarchy is accepted, before decoding. */
export function pitWallDocument(bytes: Uint8Array<ArrayBuffer>): StationDocument {
  if (bytes.length !== manifest.bytes || bytes.length < 28)
    throw new Error('Pit-wall byte count mismatch');
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = v.getUint32(12, true);
  if (
    v.getUint32(0, true) !== 0x46546c67 ||
    v.getUint32(4, true) !== 2 ||
    v.getUint32(8, true) !== bytes.length ||
    v.getUint32(16, true) !== 0x4e4f534a ||
    length > bytes.length - 28
  )
    throw new Error('Invalid pit-wall GLB header');
  const d = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, 20 + length)),
  ) as StationDocument;
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
    throw new Error('Invalid self-contained pit-wall contract');
  const required = [
    'AUREL_PIT_WALL',
    ...[0, 1, 2].map((i) => `PIT_WALL_LOD${i}`),
    ...Object.keys(manifest.sockets),
  ];
  for (const name of required)
    if (d.nodes.filter((n) => n.name === name).length !== 1)
      throw new Error(`Invalid pit-wall node ${name}`);
  const visited = new Set<number>();
  const visit = (i: number) => {
    if (!Number.isInteger(i) || !d.nodes[i] || visited.has(i))
      throw new Error('Invalid pit-wall hierarchy');
    visited.add(i);
    const node = d.nodes[i];
    if (node.mesh !== undefined && !d.meshes[node.mesh]) throw new Error('Invalid pit-wall mesh');
    for (const child of node.children ?? []) visit(child);
  };
  for (const i of d.scenes[0].nodes) visit(i);
  if (visited.size !== d.nodes.length) throw new Error('Unreachable pit-wall node');
  for (const level of [0, 1, 2] as const) {
    let count = 0;
    for (const n of d.nodes.filter((n) => n.name?.startsWith(`LOD${level}_`)))
      for (const p of d.meshes[n.mesh ?? -1]?.primitives ?? []) {
        const length = d.accessors[p.indices]?.count;
        if (!length || length % 3 || !d.accessors[p.attributes?.POSITION])
          throw new Error('Invalid pit-wall triangles');
        count += length / 3;
      }
    if (count !== manifest.triangles[level]) throw new Error('Pit-wall LOD count mismatch');
  }
  return d;
}

/** Original median placement, not a new wall, race rule, or collision surface.
 * Sample the full footprint, leave >1m to the pit lane and >2m to racing runoff. */
export function pitWallPlacement(track: Track) {
  const p = track.at(manifest.trackS, trackPoint()),
    yaw = Math.atan2(p.tx, p.tz);
  const x = p.x + p.nx * manifest.lateral,
    z = p.z + p.nz * manifest.lateral;
  let highest = -Infinity,
    lowest = Infinity,
    pitClearance = Infinity,
    trackClearance = Infinity;
  for (const dx of [manifest.maxBounds.min[0], 0, manifest.maxBounds.max[0]])
    for (const dz of [-4.05, -2, 0, 2, 4.05]) {
      const wx = x + Math.cos(yaw) * dx + Math.sin(yaw) * dz;
      const wz = z - Math.sin(yaw) * dx + Math.cos(yaw) * dz;
      const q = trackPoint(),
        lateral = track.nearest(wx, wz, q);
      pitClearance = Math.min(pitClearance, track.pitOffset(q.s) - 3.6 - lateral);
      trackClearance = Math.min(trackClearance, lateral - (q.width + 4));
      const h = q.y + q.bank * clamp(lateral, -12, 12) + grassApronOffset(track, q.s, lateral);
      highest = Math.max(highest, h);
      lowest = Math.min(lowest, h);
    }
  if (pitClearance < 1 || trackClearance < 2 || highest - lowest > 0.11)
    throw new Error('Pit-wall station violates lane or ground clearance');
  return {
    x,
    y: highest - 0.015,
    z,
    yaw,
    pitClearance,
    trackClearance,
    gradeRange: highest - lowest,
  };
}
export function pitWallLod(
  distance: number,
  previous: number,
  quality: Quality,
  fov = 58,
  aspect = 16 / 9,
) {
  const d = detailDistance(distance, fov, aspect);
  const near = quality === 'high' ? 24 : quality === 'medium' ? 18 : 12,
    far = quality === 'high' ? 85 : 60;
  if (previous === 0 && d < near * 1.12) return 0;
  if (previous === 2 && d > far * 0.88) return 2;
  return d < near ? 0 : d < far ? 1 : 2;
}
function release(root: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m);
      for (const t of Object.values(m)) if (t instanceof T.Texture) textures.add(t);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => {
    t.dispose();
    if (typeof ImageBitmap !== 'undefined' && t.image instanceof ImageBitmap) t.image.close();
  });
}
function screenCanvas() {
  const c = document.createElement('canvas');
  [c.width, c.height] = manifest.atlasSize;
  return c;
}
export class PitWallStation {
  readonly levels: T.Object3D[];
  readonly atlas: T.CanvasTexture;
  private readonly context: CanvasRenderingContext2D;
  private readonly lamps: T.MeshStandardMaterial[] = [];
  private readonly bounds = new T.Box3();
  private readonly worldBounds = new T.Box3();
  private readonly frustum = new T.Frustum();
  private readonly projection = new T.Matrix4();
  private readonly clock = new StationDisplayClock();
  private disposed = false;
  private level = 0;
  private uploads = 0;
  private readout: StationReadout | null = null;
  constructor(
    readonly root: T.Group,
    canvas = screenCanvas(),
  ) {
    this.levels = [0, 1, 2].map((i) => {
      const o = root.getObjectByName(`PIT_WALL_LOD${i}`);
      if (!o) throw new Error('Missing pit-wall LOD');
      return o;
    });
    root.updateMatrixWorld(true);
    this.bounds.setFromObject(root);
    const envelope = new T.Box3(
      new T.Vector3(...(manifest.maxBounds.min as [number, number, number])),
      new T.Vector3(...(manifest.maxBounds.max as [number, number, number])),
    );
    if (!envelope.containsBox(this.bounds)) throw new Error('Pit-wall bounds exceeded');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Pit-wall canvas unavailable');
    this.context = context;
    this.atlas = new T.CanvasTexture(canvas);
    this.atlas.name = 'A24 shared presented telemetry atlas';
    this.atlas.colorSpace = T.SRGBColorSpace;
    this.atlas.flipY = false;
    this.atlas.generateMipmaps = false;
    this.atlas.minFilter = this.atlas.magFilter = T.LinearFilter;
    this.atlas.userData.dynamic = true;
    const monitor = new T.MeshBasicMaterial({ map: this.atlas, toneMapped: false });
    monitor.name = 'A24 live monitor atlas';
    const old = new Set<T.Material>(),
      seen = new Set<T.Material>();
    root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      o.castShadow = o.receiveShadow = true;
      o.geometry.computeBoundingBox();
      o.geometry.computeBoundingSphere();
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      if (ms.some((m) => m.name === 'PITWALL_ScreenSurface')) {
        ms.forEach((m) => old.add(m));
        o.material = monitor;
        o.castShadow = false;
      }
      for (const m of ms)
        if (!seen.has(m)) {
          seen.add(m);
          if (m instanceof T.MeshStandardMaterial && m.name === 'PITWALL_LightDiffusers')
            this.lamps.push(m);
        }
    });
    old.forEach((m) => m.dispose());
    this.levels.forEach((o, i) => (o.visible = i === 0));
    root.name = 'Aurel pit-wall command station / A24';
    root.userData.pitWallStation = { assetId: 'A24', revision: manifest.revision };
    paintStationAtlas(this.context, null, 'STANDBY');
  }
  /** Main-view LOD and shared screen update; reflection passes never advance data. */
  update(
    camera: T.PerspectiveCamera,
    quality: Quality,
    lighting: 'day' | 'sunset' | 'night',
    frame: Float32Array,
    mode: StationMode = 'LIVE',
    active = true,
  ) {
    if (this.disposed) return;
    this.root.updateWorldMatrix(true, false);
    this.worldBounds.copy(this.bounds).applyMatrix4(this.root.matrixWorld);
    const distance = this.worldBounds.distanceToPoint(camera.position);
    this.setDetail(distance, quality, camera.fov, camera.aspect);
    for (const m of this.lamps)
      m.emissiveIntensity = lighting === 'night' ? 1.2 : lighting === 'sunset' ? 0.65 : 0.25;
    camera.updateMatrixWorld(true);
    this.frustum.setFromProjectionMatrix(
      this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
    );
    const visible =
      active && this.root.visible && distance < 70 && this.frustum.intersectsBox(this.worldBounds);
    if (!visible) {
      this.clock.due(0, '', '', false);
      return;
    }
    // Always car zero: this is the player's engineering station, not whichever
    // opponent a broadcast camera happens to be following in a replay.
    const key = stationDataKey(frame, 0, mode);
    const time = Number.isFinite(frame[H.TIME]) ? frame[H.TIME] : 0;
    if (this.clock.due(time, key, `${mode}/${key === 'NO DATA'}`, true)) {
      this.readout = readStationData(frame, 0, mode);
      paintStationAtlas(this.context, this.readout, mode);
      this.atlas.needsUpdate = true;
      this.uploads++;
    }
  }
  setDetail(distance: number, quality: Quality, fov = 58, aspect = 16 / 9) {
    this.level = pitWallLod(distance, this.level, quality, fov, aspect);
    this.levels.forEach((o, i) => (o.visible = i === this.level));
  }
  socket(name: keyof typeof manifest.sockets, out: T.Vector3) {
    const o = this.root.getObjectByName(name);
    if (!o) throw new Error('Missing station socket');
    return o.getWorldPosition(out);
  }
  diagnostics() {
    return {
      assetId: 'A24',
      revision: manifest.revision,
      sha256: manifest.sha256,
      loaded: !this.disposed,
      lod: this.level,
      triangles: manifest.triangles[this.level as 0 | 1 | 2],
      sockets: Object.keys(manifest.sockets),
      screenUploads: this.uploads,
      screenMode: this.readout?.mode ?? 'STANDBY',
      screenTime: this.readout?.time ?? null,
      screenCar: 0,
      finalArtApproved: false,
    };
  }
  /** Detached failed loads own their resources; attached assets use scene disposal. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    release(this.root);
  }
}
export async function decodePitWallStation(
  bytes: Uint8Array<ArrayBuffer>,
  loader = new GLTFLoader(),
  canvas?: HTMLCanvasElement,
) {
  pitWallDocument(bytes);
  if ((await hash(bytes)) !== manifest.sha256) throw new Error('Pit-wall integrity check failed');
  const gltf = await loader.parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    '',
  );
  try {
    return new PitWallStation(gltf.scene, canvas);
  } catch (error) {
    release(gltf.scene);
    throw error;
  }
}
export async function loadPitWallStation(
  cancelled: () => boolean = () => false,
  url?: string,
  fetcher: typeof fetch = fetch,
) {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 60000);
  const poll = setInterval(() => {
    if (cancelled()) controller.abort();
  }, 50);
  let station: PitWallStation | undefined;
  try {
    if (cancelled()) throw abort();
    const response = await fetcher(
      url ?? new URL(`./${manifest.url}?v=${manifest.sha256.slice(0, 16)}`, document.baseURI).href,
      { signal: controller.signal },
    );
    if (!response.ok || !response.body)
      throw new Error(`Unable to load pit-wall station (${response.status})`);
    const reader = response.body.getReader(),
      bytes = new Uint8Array(manifest.bytes);
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (cancelled() || controller.signal.aborted) throw abort();
        if (size + value.length > bytes.length)
          throw new Error('Pit-wall download exceeds byte budget');
        bytes.set(value, size);
        size += value.length;
      }
    } finally {
      await reader.cancel();
      reader.releaseLock();
    }
    if (size !== bytes.length) throw new Error('Truncated pit-wall download');
    if (cancelled() || controller.signal.aborted) throw abort();
    station = await decodePitWallStation(bytes);
    if (cancelled() || controller.signal.aborted) throw abort();
    return station;
  } catch (error) {
    station?.dispose();
    throw error;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
  }
}
