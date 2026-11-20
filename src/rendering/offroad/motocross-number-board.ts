import * as T from 'three';
import type { RiderDetail } from '../rider.ts';

// Stations up the pressing, from the radiused lower tongue to the shoulders.
const STATIONS = [
  [-0.162, 0.022],
  [-0.151, 0.075],
  [-0.126, 0.115],
  [-0.078, 0.126],
  [0.012, 0.146],
  [0.066, 0.153],
  [0.101, 0.149],
  [0.129, 0.139],
  [0.143, 0.123],
];
const WALL = 0.0038;

/** The unprinted side follows the fork straps. A shallow crown stiffens the
 * centre of the number field and the outer wings turn back toward the fork. */
export function mxNumberBoardBack(x: number, y: number, compact: boolean) {
  const sweep = x / 0.153;
  const height = T.MathUtils.clamp((y + 0.16) / 0.3, 0, 1);
  return (
    0.013 -
    (compact ? 0.028 : 0.033) * sweep * sweep -
    0.007 * (1 - height) ** 2 +
    0.002 * Math.sin(height * Math.PI) -
    WALL
  );
}

export function mxNumberBoard(detail: RiderDetail, compact: boolean) {
  const rows = detail === 'far' ? STATIONS.filter((_, i) => i % 2 === 0) : STATIONS;
  const columns = detail === 'high' ? 10 : detail === 'mid' ? 8 : 6;
  const stride = columns + 1,
    layer = rows.length * stride;
  const pos: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  for (const rear of [false, true]) {
    for (const [height, half] of rows) {
      for (let j = 0; j <= columns; j++) {
        const u = (2 * j) / columns - 1;
        const x = u * half * (compact ? 0.955 : 1);
        const lip = T.MathUtils.smoothstep(height, 0.094, 0.143);
        // The guide for the front brake line breaks the top edge on one side.
        const relief = Math.exp(-(((u + 0.44) / 0.21) ** 2));
        const y = height - lip * (0.012 * Math.abs(u) ** 3 + 0.011 * relief);
        const z = mxNumberBoardBack(x, y, compact) + (rear ? 0 : WALL);
        pos.push(x, y, z);
        const s = 0.5 + x / 0.31,
          t = (y + 0.166) / 0.311;
        uv.push(rear ? (4 + 8 * s) / 512 : s, rear ? 0.36 + 0.28 * t : t);
      }
    }
  }
  const edge = (a: number, b: number) => {
    const first = pos.length / 3;
    for (const [i, s, t] of [
      [b, 0, 0],
      [a, 1, 0],
      [a + layer, 1, 1],
      [b + layer, 0, 1],
    ]) {
      pos.push(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
      uv.push((4 + 8 * s) / 512, 0.4 + 0.1 * t);
    }
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  };
  for (let i = 0; i < rows.length - 1; i++)
    for (let j = 0; j < columns; j++) {
      const a = i * stride + j,
        b = a + 1,
        c = b + stride,
        d = a + stride;
      indices.push(
        a,
        b,
        c,
        a,
        c,
        d,
        a + layer,
        d + layer,
        c + layer,
        a + layer,
        c + layer,
        b + layer,
      );
      if (i === 0) edge(a, b);
      if (i === rows.length - 2) edge(c, d);
      if (j === 0) edge(d, a);
      if (j === columns - 1) edge(b, c);
    }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
