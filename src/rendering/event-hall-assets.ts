import * as T from 'three';
import source from './event-hall.geometry.json' with { type: 'json' };
import manifest from './event-hall.manifest.json' with { type: 'json' };
import { SceneryPassDetail } from './scenery-pass-detail.ts';

export const EVENT_HALL_ASSET = Object.freeze({ ...manifest, finalArtApproved: false });
export const HALL_MESHES = [
  'foundation',
  'plinth',
  'facade',
  'bearing',
  'canopy',
  'column',
  'bollard',
  'shell_near',
  'shell_mid',
  'shell_far',
] as const;
export type HallMesh = (typeof HALL_MESHES)[number];
export type HallTier = 0 | 1 | 2;
interface EncodedAttribute {
  data: string;
  count: number;
  itemSize: number;
  componentType: number;
}
interface DecodedMesh {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  index: Uint16Array | Uint32Array;
}
const fail = (): never => {
  throw new Error('Invalid authored A71 geometry');
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}
function attribute(value: unknown, itemSize: number, index = false) {
  const a = record(value) as unknown as EncodedAttribute;
  if (
    !Number.isInteger(a.count) ||
    a.count < 1 ||
    a.count > 30000 ||
    a.itemSize !== itemSize ||
    typeof a.data !== 'string' ||
    (index ? ![5123, 5125].includes(a.componentType) : a.componentType !== 5126)
  )
    return fail();
  const bytes = a.count * itemSize * (a.componentType === 5123 ? 2 : 4);
  // Exact bounded length and strict alphabet reject partial/corrupt transport.
  if (
    a.data.length !== Math.ceil(bytes / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(a.data)
  )
    return fail();
  const binary = atob(a.data);
  if (binary.length !== bytes) return fail();
  const raw = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const view = new DataView(raw.buffer);
  const result = index
    ? a.componentType === 5123
      ? new Uint16Array(a.count)
      : new Uint32Array(a.count)
    : new Float32Array(a.count * itemSize);
  for (let i = 0; i < result.length; i++) {
    const v = index
      ? a.componentType === 5123
        ? view.getUint16(i * 2, true)
        : view.getUint32(i * 4, true)
      : view.getFloat32(i * 4, true);
    if (!Number.isFinite(v)) return fail();
    result[i] = v;
  }
  return result;
}
/** Decode the actual exported accessors, not a second parametric approximation.
 * Validation accepts unknown input so negative controls exercise the same path. */
export function decodeEventHall(value: unknown): Record<HallMesh, DecodedMesh> {
  const root = record(value);
  if (root.version !== 1 || root.assetId !== 'A71' || root.units !== 'metres-Y-up') return fail();
  const meshes = record(root.meshes);
  if (Object.keys(meshes).length !== HALL_MESHES.length) return fail();
  const result = {} as Record<HallMesh, DecodedMesh>;
  for (const name of HALL_MESHES) {
    const mesh = record(meshes[name]);
    const position = attribute(mesh.position, 3) as Float32Array;
    const normal = attribute(mesh.normal, 3) as Float32Array;
    const uv = attribute(mesh.uv, 2) as Float32Array;
    const index = attribute(mesh.index, 1, true) as Uint16Array | Uint32Array;
    const n = position.length / 3;
    if (
      n < 3 ||
      normal.length !== position.length ||
      uv.length !== n * 2 ||
      index.length !== manifest.triangles[name] * 3
    )
      return fail();
    for (const i of index) if (i >= n) return fail();
    for (const p of position) if (Math.abs(p) > 40) return fail();
    for (let i = 0; i < n; i++) {
      const length = Math.hypot(normal[i * 3], normal[i * 3 + 1], normal[i * 3 + 2]);
      if (Math.abs(length - 1) > 0.001) return fail();
    }
    result[name] = { position, normal, uv, index };
  }
  return result;
}
let decoded: Record<HallMesh, DecodedMesh> | undefined;
function data() {
  return (decoded ??= decodeEventHall(source));
}
/** Each scene owns its buffers. Disposing one circuit cannot break another. */
export function eventHallGeometry(name: HallMesh): T.BufferGeometry {
  const mesh = data()[name];
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(mesh.position.slice(), 3));
  g.setAttribute('normal', new T.BufferAttribute(mesh.normal.slice(), 3));
  g.setAttribute('uv', new T.BufferAttribute(mesh.uv.slice(), 2));
  g.setIndex(new T.BufferAttribute(mesh.index.slice(), 1));
  g.name = `A71 / ${name}`;
  g.userData.authoredAsset = EVENT_HALL_ASSET.revision;
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
/** Conservative detail bands with per-camera hysteresis. Camera projection and
 * pass resolution are resolved by SceneryPassDetail, including cube reflections. */
export function eventHallTier(distance: number, previous?: HallTier): HallTier {
  if (!Number.isFinite(distance) || distance < 0) throw new Error('Invalid A71 detail distance');
  const base: HallTier = distance < 180 ? 0 : distance < 380 ? 1 : 2;
  if (previous === 0 && distance < 198) return 0;
  if (previous === 1 && distance >= 162 && distance < 418) return 1;
  if (previous === 2 && distance >= 342) return 2;
  return base;
}
export interface HallShell {
  geometry: T.BufferGeometry;
  ranges: readonly { start: number; count: number }[];
  select: (tier: HallTier) => void;
  bind: (mesh: T.Mesh) => void;
}
/** Three authored tiers packed once. Only draw ranges change for the current
 * camera; no replacement buffers, scene traversal, or recurring allocations. */
export function eventHallShell(): HallShell {
  const tiers = ['shell_near', 'shell_mid', 'shell_far'] as const;
  const input = tiers.map((name) => data()[name]);
  const vertices = input.reduce((sum, mesh) => sum + mesh.position.length / 3, 0);
  const position = new Float32Array(vertices * 3),
    normal = position.slice();
  const uv = new Float32Array(vertices * 2);
  const index = new Uint16Array(input.reduce((sum, mesh) => sum + mesh.index.length, 0));
  const ranges: { start: number; count: number }[] = [];
  let v = 0,
    offset = 0;
  for (const mesh of input) {
    position.set(mesh.position, v * 3);
    normal.set(mesh.normal, v * 3);
    uv.set(mesh.uv, v * 2);
    for (let i = 0; i < mesh.index.length; i++) index[offset + i] = mesh.index[i] + v;
    ranges.push({ start: offset, count: mesh.index.length });
    v += mesh.position.length / 3;
    offset += mesh.index.length;
  }
  const geometry = new T.BufferGeometry();
  geometry.name = 'A71 / three packed screen-shell tiers';
  geometry.userData.authoredAsset = EVENT_HALL_ASSET.revision;
  geometry.setAttribute('position', new T.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new T.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new T.BufferAttribute(uv, 2));
  geometry.setIndex(new T.BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const select = (tier: HallTier) => {
    if (!Number.isInteger(tier) || !ranges[tier]) throw new Error('Invalid A71 shell tier');
    geometry.setDrawRange(ranges[tier].start, ranges[tier].count);
  };
  select(0);
  return {
    geometry,
    ranges,
    select,
    bind(mesh) {
      const detail = new SceneryPassDetail();
      const eye = new T.Vector3(),
        centre = new T.Vector3();
      const history = new WeakMap<T.Camera, HallTier>();
      const choose = (renderer: T.WebGLRenderer, camera: T.Camera) => {
        eye.setFromMatrixPosition(camera.matrixWorld);
        centre.setFromMatrixPosition(mesh.matrixWorld);
        const d = detail.distance(eye.distanceTo(centre), camera, renderer);
        const tier = eventHallTier(d, history.get(camera));
        history.set(camera, tier);
        select(tier);
      };
      mesh.onBeforeRender = (renderer, _scene, camera) => choose(renderer, camera);
      mesh.onAfterRender = () => select(0);
      mesh.onBeforeShadow = (renderer, _object, _viewCamera, shadowCamera) =>
        choose(renderer, shadowCamera);
      mesh.onAfterShadow = () => select(0);
    },
  };
}
