import * as T from 'three';
import source from './secondary-grandstands.geometry.json' with { type: 'json' };
import manifest from './secondary-grandstands.manifest.json' with { type: 'json' };

export const SECONDARY_STAND_ASSET = Object.freeze({ ...manifest, finalArtApproved: false });
export const SECONDARY_ROLES = [
  'deck',
  'roof',
  'rails',
  'frame',
  'aisle',
  'end',
  'seat',
  'post',
  'foot',
  'trim',
] as const;
export const SECONDARY_TIERS = ['near', 'mid', 'far'] as const;
export type SecondaryRole = (typeof SECONDARY_ROLES)[number];
export type SecondaryTier = 0 | 1 | 2;
export type SecondaryMesh = `${SecondaryRole}_${(typeof SECONDARY_TIERS)[number]}`;
export const SECONDARY_MESHES: readonly SecondaryMesh[] = SECONDARY_ROLES.flatMap((role) =>
  SECONDARY_TIERS.map((tier): SecondaryMesh => `${role}_${tier}`),
);
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
  throw new Error('Invalid authored A12 geometry');
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
export function decodeSecondaryStands(value: unknown): Record<SecondaryMesh, DecodedMesh> {
  const root = record(value);
  if (root.version !== 1 || root.assetId !== 'A12' || root.units !== 'metres-Y-up') return fail();
  const meshes = record(root.meshes);
  if (Object.keys(meshes).length !== SECONDARY_MESHES.length) return fail();
  const result = {} as Record<SecondaryMesh, DecodedMesh>;
  for (const name of SECONDARY_MESHES) {
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
let decoded: Record<SecondaryMesh, DecodedMesh> | undefined;
function data() {
  return (decoded ??= decodeSecondaryStands(source));
}
/** Each scene owns its buffers. Disposing one circuit cannot break another. */
export function secondaryStandGeometry(name: SecondaryMesh, mirror = false): T.BufferGeometry {
  if (!SECONDARY_MESHES.includes(name)) return fail();
  const mesh = data()[name];
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.BufferAttribute(mesh.position.slice(), 3));
  g.setAttribute('normal', new T.BufferAttribute(mesh.normal.slice(), 3));
  g.setAttribute('uv', new T.BufferAttribute(mesh.uv.slice(), 2));
  g.setIndex(new T.BufferAttribute(mesh.index.slice(), 1));
  if (mirror) {
    g.scale(-1, 1, 1);
    const ix = g.index!;
    for (let i = 0; i < ix.count; i += 3) {
      const b = ix.getX(i + 1);
      ix.setX(i + 1, ix.getX(i + 2));
      ix.setX(i + 2, b);
    }
  }
  g.name = `A12 / ${name}`;
  g.userData.authoredAsset = SECONDARY_STAND_ASSET.revision;
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
