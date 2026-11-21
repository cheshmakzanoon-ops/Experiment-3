import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { QualityPreset } from '../options.ts';
import type { StreetLightSocket } from './street-light-pools.ts';

const opticX = 1.46;
const opticY = 6.82;
const color = new T.Color();

function finish(g: T.BufferGeometry, tint: number) {
  const count = g.getAttribute('position').count;
  const rgb = new Float32Array(count * 3);
  color.setHex(tint);
  for (let i = 0; i < count; i++) color.toArray(rgb, i * 3);
  g.setAttribute('color', new T.BufferAttribute(rgb, 3));
  return g;
}

/** Horizontal sections of the die-cast housing. The spigot end necks down
 * and the crown rolls over the cut-off visor. Only the recessed underside emits. */
function housing(
  rings: readonly (readonly [number, number, number])[],
  lower: boolean,
  steps = 12,
) {
  const points: number[] = [],
    index: number[] = [],
    uv: number[] = [];
  for (const [y, rx, rz] of rings) {
    for (let k = 0; k < steps; k++) {
      const a = (k * 2 * Math.PI) / steps;
      const u = Math.cos(a),
        v = Math.sin(a);
      points.push(opticX + rx * u, y, rz * v * (0.86 + 0.14 * u));
      uv.push(u * 0.5 + 0.5, v * 0.5 + 0.5);
    }
  }
  for (let row = 1; row < rings.length; row++)
    for (let k = 0; k < steps; k++) {
      const a = (row - 1) * steps + k,
        b = (row - 1) * steps + ((k + 1) % steps);
      index.push(a, a + steps, b, b, a + steps, b + steps);
    }
  for (let k = 1; k < steps - 1; k++) {
    if (lower) index.push(0, k, k + 1);
    else {
      const end = (rings.length - 1) * steps;
      index.push(end, end + k + 1, end + k);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(points, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

export function townLampGeometry() {
  const mast = new T.LatheGeometry(
    [
      [0.18, 0.02],
      [0.18, 0.09],
      [0.148, 0.14],
      [0.135, 0.56],
      [0.12, 0.6],
      [0.093, 0.64],
      [0.063, 6.12],
      [0.058, 6.28],
    ].map(([r, y]) => new T.Vector2(r, y)),
    8,
  );
  const arm = new T.TubeGeometry(
    new T.CubicBezierCurve3(
      new T.Vector3(0, 6.23, 0),
      new T.Vector3(0, 6.98, 0),
      new T.Vector3(0.47, 7.005, 0),
      new T.Vector3(opticX - 0.27, 7.005, 0),
    ),
    7,
    0.052,
    6,
    false,
  );
  const shell = housing(
    [
      [6.819, 0.417, 0.176],
      [6.846, 0.464, 0.207],
      [6.925, 0.474, 0.21],
      [7.012, 0.391, 0.179],
      [7.038, 0.228, 0.117],
    ],
    false,
  );
  const gasket = housing(
    [
      [6.816, 0.412, 0.174],
      [6.835, 0.435, 0.187],
    ],
    true,
  );
  const door = new T.BoxGeometry(0.09, 0.28, 0.018).translate(0, 0.35, 0.135);
  const parts = [
    finish(mast, 0x849393),
    finish(arm, 0xabb7b6),
    finish(shell, 0x596663),
    finish(gasket, 0x272e30),
    finish(door, 0x505e60),
  ];
  // A shoe and four capped anchors catch light separately at street level.
  parts.push(finish(new T.BoxGeometry(0.34, 0.034, 0.34).translate(0, 0.027, 0), 0x596563));
  for (const x of [-0.137, 0.137])
    for (const z of [-0.137, 0.137])
      parts.push(
        finish(new T.CylinderGeometry(0.024, 0.028, 0.035, 6).translate(x, 0.057, z), 0x959e99),
      );
  const metal = mergeGeometries(parts, false)!;
  parts.forEach((g) => g.dispose());
  const lens = housing(
    [
      [6.806, 0.347, 0.132],
      [6.811, 0.385, 0.151],
      [6.817, 0.394, 0.161],
    ],
    true,
  );
  return { metal, lens };
}

function distantTownLamp() {
  const base = new T.LatheGeometry(
    [
      [0.16, 0.025],
      [0.15, 0.56],
      [0.092, 0.65],
      [0.057, 6.27],
    ].map(([r, y]) => new T.Vector2(r, y)),
    5,
  );
  const arm = new T.TubeGeometry(
    new T.CubicBezierCurve3(
      new T.Vector3(0, 6.23, 0),
      new T.Vector3(0, 6.98, 0),
      new T.Vector3(0.47, 7.005, 0),
      new T.Vector3(opticX - 0.27, 7.005, 0),
    ),
    3,
    0.052,
    4,
    false,
  );
  const shell = housing(
    [
      [6.815, 0.42, 0.18],
      [6.926, 0.474, 0.21],
      [7.038, 0.25, 0.12],
    ],
    false,
    6,
  );
  const parts = [finish(base, 0x849393), finish(arm, 0xabb7b6), finish(shell, 0x596663)];
  const metal = mergeGeometries(parts, false)!;
  for (const p of parts) p.dispose();
  const lens = housing(
    [
      [6.806, 0.35, 0.135],
      [6.817, 0.394, 0.161],
    ],
    true,
    6,
  );
  return { metal, lens };
}
type LampPair = readonly [T.InstancedMesh, T.InstancedMesh];
interface LampBlock {
  matrices: T.Matrix4[];
  detail: Uint8Array;
  near: LampPair;
  far: LampPair;
}
const focusRange = { low: 70, medium: 105, high: 145, ultra: 180 } as const;

/** Keep one instanced pair per occupied tier and block. A distant casting drops
 * fasteners and fine casting stations but retains its projected swan-neck,
 * mast height, and emitting underside for arbitrary mirror/shadow directions. */
export function buildTownLamps(
  matrices: readonly T.Matrix4[],
  post: T.Material,
  diffuser: T.Material,
) {
  const root = new T.Group();
  root.name = 'Port Ilse street luminaires';
  const sockets: StreetLightSocket[] = [],
    blocks: LampBlock[] = [];
  const stats = { near: 0, far: 0, triangles: 0, batches: 0 };
  const layout = new Map<string, T.Matrix4[]>();
  for (const m of matrices) {
    const key = Math.floor(m.elements[12] / 384) + ',' + Math.floor(m.elements[14] / 384);
    let items = layout.get(key);
    if (!items) layout.set(key, (items = []));
    items.push(m);
    sockets.push({
      position: new T.Vector3(opticX, opticY - 0.026, 0).applyMatrix4(m),
      target: new T.Vector3(2.5, 0.08, 0).applyMatrix4(m),
    });
  }
  let fullTriangles = 0,
    farTriangles = 0;
  if (matrices.length) {
    const full = townLampGeometry(),
      low = distantTownLamp();
    const triangles = (g: typeof full) => (g.metal.index!.count + g.lens.index!.count) / 3;
    fullTriangles = triangles(full);
    farTriangles = triangles(low);
    for (const items of layout.values()) {
      const pair = (g: typeof full, far: boolean): LampPair => {
        const poles = new T.InstancedMesh(g.metal, post, items.length),
          heads = new T.InstancedMesh(g.lens, diffuser, items.length);
        poles.name = far ? 'Distant town lamp posts' : 'Town lamp posts';
        heads.name = far ? 'Distant town lamp heads' : 'Town lamp heads';
        poles.castShadow = poles.receiveShadow = true;
        for (const mesh of [poles, heads]) {
          for (let i = 0; i < items.length; i++) mesh.setMatrixAt(i, items[i]);
          // A compacted subset stays inside the original full block's sphere.
          mesh.computeBoundingSphere();
          mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
          mesh.count = far ? 0 : items.length;
          mesh.visible = !far;
          mesh.matrixAutoUpdate = false;
          root.add(mesh);
        }
        return [poles, heads];
      };
      blocks.push({
        matrices: items,
        detail: new Uint8Array(items.length).fill(1),
        near: pair(full, false),
        far: pair(low, true),
      });
    }
  }
  stats.near = matrices.length;
  stats.triangles = matrices.length * fullTriangles;
  stats.batches = blocks.length * 2;
  const previous = new T.Vector3(Infinity, 0, 0);
  let lastRange = 0;
  function update(eye: T.Vector3, quality: QualityPreset) {
    const range = focusRange[quality];
    if (lastRange === range && previous.distanceToSquared(eye) < 9) return;
    previous.copy(eye);
    lastRange = range;
    stats.near = stats.far = stats.batches = 0;
    for (const block of blocks) {
      let changed = false,
        near = 0;
      for (let i = 0; i < block.matrices.length; i++) {
        const e = block.matrices[i].elements,
          dist = (e[12] - eye.x) ** 2 + (e[13] + 3.5 - eye.y) ** 2 + (e[14] - eye.z) ** 2;
        const next = Number(dist < (range * (block.detail[i] ? 1.1 : 0.9)) ** 2);
        if (next !== block.detail[i]) {
          block.detail[i] = next;
          changed = true;
        }
        near += next;
      }
      const far = block.matrices.length - near;
      stats.near += near;
      stats.far += far;
      stats.batches += 2 * Number(near > 0) + 2 * Number(far > 0);
      if (!changed) continue;
      let n = 0,
        f = 0;
      for (let i = 0; i < block.matrices.length; i++) {
        const useNear = block.detail[i],
          meshes = useNear ? block.near : block.far,
          slot = useNear ? n++ : f++;
        for (const mesh of meshes) mesh.setMatrixAt(slot, block.matrices[i]);
      }
      for (const pair of [block.near, block.far]) {
        const count = pair === block.near ? near : far;
        for (const mesh of pair) {
          mesh.count = count;
          mesh.visible = count > 0;
          if (count) {
            mesh.instanceMatrix.clearUpdateRanges();
            mesh.instanceMatrix.addUpdateRange(0, count * 16);
            mesh.instanceMatrix.needsUpdate = true;
          }
        }
      }
    }
    stats.triangles = stats.near * fullTriangles + stats.far * farTriangles;
  }
  return { root, sockets, stats, update };
}
