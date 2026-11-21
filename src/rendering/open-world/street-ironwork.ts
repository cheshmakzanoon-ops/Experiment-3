import * as T from 'three';
import { clamp } from '../../core/math.ts';
import {
  IRON_DIMENSIONS,
  streetIronwork,
  type IronKind,
} from '../../simulation/open-world/street-ironwork.ts';
import type { RoadNetwork } from '../../simulation/open-world/road-network.ts';
import { trackPoint } from '../../simulation/track.ts';

const RES = 192,
  EDGE = 0.015;
const TAU = 2 * Math.PI;
const rib = (x: number, pitch: number, half: number) =>
  clamp((half - Math.abs(x - Math.round(x / pitch) * pitch)) / 0.0035, 0, 1);
function height(kind: IronKind, x: number, z: number) {
  const { across, along } = IRON_DIMENSIONS[kind];
  if (kind === 'cover') {
    const r = Math.hypot(x, z);
    if (r > across) return -Infinity;
    if (r > across - 0.014) return 0.004;
    if (r > across - 0.021) return -0.004;
    if (r > across - 0.033) return 0.003;
    const opening = Math.hypot(Math.max(0, Math.abs(x) - 0.017), Math.abs(z) - 0.256);
    if (opening < 0.009) return -0.006;
    const centre = r < 0.082,
      ring = Math.min(Math.abs(r - 0.083), Math.abs(r - 0.301));
    if (ring < 0.004) return 0.0044;
    if (centre) {
      const spoke = Math.abs(Math.sin(Math.atan2(z, x) * 3)) * r;
      return r > 0.025 && r < 0.058 && spoke < 0.004 ? 0.0035 : 0;
    }
    const cross = Math.max(
      rib((x + z) * 0.7071, 0.038, 0.006),
      rib((x - z) * 0.7071, 0.038, 0.006),
    );
    return 0.0032 * cross;
  }
  const border = Math.min(across - Math.abs(x), along - Math.abs(z));
  if (border < 0) return -Infinity;
  const bolt = Math.hypot(Math.abs(x) - (across - 0.016), Math.abs(z) - (along - 0.022));
  if (bolt < 0.007) return 0.006;
  if (border < 0.024) return 0.0025;
  if (Math.abs(x) < 0.01) return 0.003;
  const slat = rib(z + Math.abs(x) * 0.23, 0.065, 0.016);
  return -0.011 + slat * 0.014;
}
interface Atlas {
  albedo: Uint8Array<ArrayBuffer>;
  normal: Uint8Array<ArrayBuffer>;
  rough: Uint8Array<ArrayBuffer>;
}
let source: Atlas | null = null;
function atlas() {
  if (source) return source;
  const samples = 2 * RES * RES;
  const albedo = new Uint8Array(samples * 4),
    normal = new Uint8Array(samples * 4),
    rough = new Uint8Array(samples * 4);
  const heights = new Float32Array(samples);
  for (let slot = 0; slot < 2; slot++) {
    const kind = slot ? 'gully' : 'cover',
      { across, along } = IRON_DIMENSIONS[kind];
    const du = (2 * (across + EDGE)) / RES,
      dv = (2 * (along + EDGE)) / RES;
    for (let j = 0; j < RES; j++)
      for (let i = 0; i < RES; i++) {
        const index = 2 * RES * j + slot * RES + i;
        const x = (i + 0.5 - RES / 2) * du,
          z = (j + 0.5 - RES / 2) * dv;
        const h = height(kind, x, z);
        const visible = Number.isFinite(h),
          pit = visible ? h : -0.008;
        heights[index] = pit;
        const seed = Math.imul(i ^ Math.imul(j + 937, 0x45d9f3b), 0x27d4eb2d) >>> 0;
        const grain = (seed >>> 21) / 2047,
          mottling = 2.5 * Math.sin(x * 15 + z * 22) + 2 * Math.cos(TAU * z * 2.1);
        const lip = clamp(pit / 0.004, 0, 1),
          dark = clamp((pit + 0.008) / 0.008, 0.13, 1);
        const grey = (64 + 24 * lip + grain * 11 + mottling) * dark,
          k = index * 4;
        albedo[k] = grey + 3;
        albedo[k + 1] = grey + 1;
        albedo[k + 2] = grey - 4;
        albedo[k + 3] = visible ? 255 : 0;
        rough[k] = 255;
        rough[k + 1] = 194 - 39 * lip + grain * 10;
        rough[k + 2] = 163 + 55 * lip;
        rough[k + 3] = 255;
      }
    for (let j = 0; j < RES; j++)
      for (let i = 0; i < RES; i++) {
        const idx = 2 * RES * j + slot * RES + i,
          k = idx * 4;
        const nx = (heights[idx - Number(i > 0)] - heights[idx + Number(i < RES - 1)]) / (2 * du);
        const ny =
          (heights[idx - (j > 0 ? 2 * RES : 0)] - heights[idx + (j < RES - 1 ? 2 * RES : 0)]) /
          (2 * dv);
        const len = Math.hypot(nx, ny, 1);
        normal[k] = 128 + (127 * nx) / len;
        normal[k + 1] = 128 + (127 * ny) / len;
        normal[k + 2] = 128 + 127 / len;
        normal[k + 3] = 255;
      }
  }
  return (source = { albedo, normal, rough });
}
function map(bytes: Uint8Array<ArrayBuffer>, colour = false) {
  const t = new T.DataTexture(bytes, RES * 2, RES, T.RGBAFormat);
  if (colour) t.colorSpace = T.SRGBColorSpace;
  t.generateMipmaps = true;
  t.magFilter = T.LinearFilter;
  t.minFilter = T.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Flush pieces share a cast-relief atlas, one indexed quad per fitting and
 * one draw per occupied town cell. The road under the disc's corners shows
 * through its cutout; dry and wet roughness use the same raised pattern. */
export class StreetIronwork {
  readonly root = new T.Group();
  readonly material: T.MeshStandardMaterial;
  readonly count = { cover: 0, gully: 0 };
  private readonly chunks: T.Mesh[] = [];
  constructor(net: RoadNetwork) {
    this.root.name = 'Port Ilse street ironwork';
    const art = atlas(),
      packed = map(art.rough);
    this.material = new T.MeshStandardMaterial({
      map: map(art.albedo, true),
      normalMap: map(art.normal),
      roughnessMap: packed,
      metalnessMap: packed,
      roughness: 0.96,
      metalness: 0.84,
      alphaTest: 0.42,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.material.name = 'Port Ilse cast-iron covers and gully gratings';
    const layout = streetIronwork(net),
      p = trackPoint();
    const cells = new Map<string, { pos: number[]; uv: number[]; idx: number[] }>();
    for (const edge of net.edges)
      for (const fitting of layout.edges[edge.index]) {
        const { kind, station, lateral } = fitting,
          size = IRON_DIMENSIONS[kind];
        net.at(edge.offset + station, p);
        const key = Math.floor(p.x / 160) + ',' + Math.floor(p.z / 160);
        let cell = cells.get(key);
        if (!cell) cells.set(key, (cell = { pos: [], uv: [], idx: [] }));
        const index = cell.pos.length / 3,
          slot = kind === 'gully' ? 1 : 0;
        for (const v of [-1, 1]) {
          net.at(edge.offset + station + v * (size.along + EDGE), p);
          for (const u of [-1, 1]) {
            const l = lateral + u * (size.across + EDGE);
            cell.pos.push(
              p.x + p.nx * l,
              net.surfaceHeight(p, l, edge.spec.halfWidth, edge.spec.crown) + 0.004,
              p.z + p.nz * l,
            );
            cell.uv.push((slot + (u + 1) / 2) * 0.5, (v + 1) / 2);
          }
        }
        cell.idx.push(index, index + 2, index + 1, index + 1, index + 2, index + 3);
        this.count[kind]++;
      }
    for (const [cell, data] of cells) {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(data.pos, 3));
      g.setAttribute('uv', new T.Float32BufferAttribute(data.uv, 2));
      g.setIndex(data.idx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const mesh = new T.Mesh(g, this.material);
      mesh.name = 'Street ironwork ' + cell;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.root.add(mesh);
      this.chunks.push(mesh);
    }
  }
  setWet(wet: number) {
    this.material.roughness = 0.96 - 0.49 * clamp(wet, 0, 1);
  }
  update(eye: T.Vector3) {
    for (const mesh of this.chunks) {
      const sphere = mesh.geometry.boundingSphere!;
      mesh.visible = sphere.center.distanceToSquared(eye) < (sphere.radius + 320) ** 2;
    }
  }
  dispose() {
    for (const m of this.chunks) m.geometry.dispose();
    this.material.map!.dispose();
    this.material.normalMap!.dispose();
    this.material.roughnessMap!.dispose();
    this.material.dispose();
    this.root.clear();
    this.root.removeFromParent();
  }
}
