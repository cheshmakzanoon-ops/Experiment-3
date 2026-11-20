import * as T from 'three';
import { add, type BikeMaterials } from '../bike.ts';
import type { RiderDetail } from '../rider.ts';
import { mapMxKitPanel } from './motocross-graphics-kit.ts';

// Across the mould from the open inner edge to the swept-back bar end.
const STATIONS = [0, 0.06, 0.16, 0.23, 0.4, 0.47, 0.54, 0.61, 0.79, 0.86, 0.94, 1];
const DISTANT_STATIONS = [0, 0.16, 0.47, 0.79, 0.94, 1];

function surface(u: number, v: number, side: number, compact: boolean, back = false) {
  const crown = Math.sin(Math.PI * u);
  const inner = T.MathUtils.smoothstep(u, 0, 0.19);
  const tip = T.MathUtils.smoothstep(u, 0.8, 1);
  const bottom = -0.023 - 0.013 * inner + 0.021 * tip;
  const top = (compact ? 0.024 : 0.035) + 0.023 * inner - 0.029 * tip;
  return new T.Vector3(
    side * (0.214 + 0.232 * u + 0.011 * (v - 0.5) * crown),
    T.MathUtils.lerp(bottom, top, v) + 0.007 * crown,
    0.126 +
      0.026 * crown -
      0.068 * tip +
      0.01 * Math.sin(Math.PI * v) -
      0.018 * v * v -
      (back ? 0.0032 : 0),
  );
}

/** Vented, compound-curved polypropylene shell. The cutouts have continuous
 * returns through the material; both sides are visible on the race cameras. */
export function motocrossHandguard(detail: RiderDetail, side: number, compact: boolean) {
  const distant = detail === 'far',
    stations = distant ? DISTANT_STATIONS : STATIONS;
  const rows = distant ? 2 : 4,
    stride = rows + 1;
  const positions: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const vertex = (p: T.Vector3, u: number, v: number) => {
    positions.push(p.x, p.y, p.z);
    uv.push(u, v);
    return positions.length / 3 - 1;
  };
  for (const back of [false, true])
    for (const [i, u] of stations.entries()) {
      const narrow = i === 2 || i === 5 || i === 6 || i === 9;
      // A tapered opening interrupts the main crease on either side of a web.
      const mid = 0.4 + 0.16 * u;
      const half = narrow ? 0.032 : compact ? 0.1 : 0.083;
      const vRows = distant ? [0, 0.52, 1] : [0, mid - half, mid + half, 0.77, 1];
      for (const v of vRows) vertex(surface(u, v, side, compact, back), u, v);
    }
  const layer = stations.length * stride;
  const solid = (i: number, j: number) =>
    i >= 0 &&
    i < stations.length - 1 &&
    j >= 0 &&
    j < rows &&
    (distant || j !== 1 || !((i >= 2 && i < 5) || (i >= 6 && i < 9)));
  const quad = (a: number, b: number, c: number, d: number) => {
    if (side > 0) indices.push(a, b, c, a, c, d);
    else indices.push(a, c, b, a, d, c);
  };
  const copy = new T.Vector3();
  const edge = (a: number, b: number) => {
    // Separate rim normals retain the thin moulded edge and both vent lips.
    const first = positions.length / 3;
    for (const [i, u, v] of [
      [b, 0, 0],
      [a, 1, 0],
      [a + layer, 1, 1],
      [b + layer, 0, 1],
    ])
      vertex(copy.fromArray(positions, i * 3), u, v);
    quad(first, first + 1, first + 2, first + 3);
  };
  for (let i = 0; i < stations.length - 1; i++)
    for (let j = 0; j < rows; j++) {
      if (!solid(i, j)) continue;
      const a = i * stride + j,
        b = a + stride,
        c = b + 1,
        d = a + 1;
      quad(a, b, c, d);
      quad(a + layer, d + layer, c + layer, b + layer);
      if (!solid(i, j - 1)) edge(a, b);
      if (!solid(i + 1, j)) edge(b, c);
      if (!solid(i, j + 1)) edge(c, d);
      if (!solid(i - 1, j)) edge(d, a);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return mapMxKitPanel(g, 'handguard', (i) => i < layer);
}

export function addMotocrossHandguards(
  steer: T.Group,
  detail: RiderDetail,
  compact: boolean,
  barY: number,
  barZ: number,
  sheet: T.Material,
  dark: T.Material,
  metal: BikeMaterials['aluminium'],
) {
  for (const side of [-1, 1]) {
    add(steer, motocrossHandguard(detail, side, compact), sheet, 0, barY, barZ);
    // The stay passes below the lever pivot, then fans out against the back
    // of the shield. The end of the bar and the escape path for the hand stay open.
    const mount = new T.Vector3(side * 0.208, -0.033, 0.029);
    const elbow = new T.Vector3(side * 0.215, -0.038, 0.102);
    const feet = [
      surface(0.29, 0.24, side, compact, true),
      surface(0.6, 0.25, side, compact, true),
    ];
    const up = new T.Vector3(0, 1, 0);
    for (const [a, b] of [
      [mount, elbow],
      [elbow, feet[0]],
      [feet[0], feet[1]],
    ]) {
      const axis = b.clone().sub(a);
      const mid = a.clone().lerp(b, 0.5);
      const stay = add(
        steer,
        new T.CylinderGeometry(0.006, 0.008, axis.length(), 5),
        dark,
        mid.x,
        mid.y + barY,
        mid.z + barZ,
      );
      stay.quaternion.setFromUnitVectors(up, axis.normalize());
    }
    if (detail === 'far') continue;
    const collar = new T.TorusGeometry(0.014, 0.004, 4, 12, Math.PI * 1.88);
    add(steer, collar.rotateY(Math.PI / 2), dark, mount.x, mount.y + barY, mount.z + barZ);
    for (const foot of feet)
      add(
        steer,
        new T.CylinderGeometry(0.0043, 0.0053, 0.005, 6).rotateX(Math.PI / 2),
        metal,
        foot.x,
        barY + foot.y,
        barZ + foot.z - 0.004,
      );
  }
}
