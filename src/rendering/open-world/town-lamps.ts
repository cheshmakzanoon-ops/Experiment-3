import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
function housing(rings: readonly (readonly [number, number, number])[], lower: boolean) {
  const points: number[] = [],
    index: number[] = [],
    uv: number[] = [];
  const steps = 12;
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

/** Share the two geometries across static city blocks. Streetlight shadows
 * and reflections cull blocks independently of the main camera. */
export function buildTownLamps(
  matrices: readonly T.Matrix4[],
  post: T.Material,
  diffuser: T.Material,
) {
  const root = new T.Group();
  root.name = 'Port Ilse street luminaires';
  const sockets: StreetLightSocket[] = [];
  if (!matrices.length) return { root, sockets };
  const geometry = townLampGeometry();
  const blocks = new Map<string, T.Matrix4[]>();
  for (const m of matrices) {
    const key = Math.floor(m.elements[12] / 384) + ',' + Math.floor(m.elements[14] / 384);
    const block = blocks.get(key) ?? [];
    block.push(m);
    blocks.set(key, block);
    sockets.push({
      position: new T.Vector3(opticX, opticY - 0.026, 0).applyMatrix4(m),
      target: new T.Vector3(2.5, 0.08, 0).applyMatrix4(m),
    });
  }
  for (const block of blocks.values()) {
    const poles = new T.InstancedMesh(geometry.metal, post, block.length);
    const heads = new T.InstancedMesh(geometry.lens, diffuser, block.length);
    poles.name = 'Town lamp posts';
    heads.name = 'Town lamp heads';
    poles.castShadow = poles.receiveShadow = true;
    for (const mesh of [poles, heads]) {
      block.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      mesh.computeBoundingSphere();
      mesh.matrixAutoUpdate = false;
      root.add(mesh);
    }
  }
  return { root, sockets };
}
