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
  return printedPlate(rows.length, columns, false, (i, j) => {
    const [height, half] = rows[i];
    const u = (2 * j) / columns - 1;
    const x = u * half * (compact ? 0.955 : 1);
    const lip = T.MathUtils.smoothstep(height, 0.094, 0.143);
    // The guide for the front brake line breaks the top edge on one side.
    const relief = Math.exp(-(((u + 0.44) / 0.21) ** 2));
    const y = height - lip * (0.012 * Math.abs(u) ** 3 + 0.011 * relief);
    const z = mxNumberBoardBack(x, y, compact);
    return { front: [x, y, z + WALL], back: [x, y, z], s: 0.5 + x / 0.31, t: (y + 0.166) / 0.311 };
  });
}

type FacePoint = {
  front: [number, number, number];
  back: [number, number, number];
  s: number;
  t: number;
};

/** The race graphic is printed on the exposed face. The return edge and reverse
 * share a blank strip of the decal atlas. Duplicate rim corners preserve the lip. */
function printedPlate(
  rows: number,
  columns: number,
  reverse: boolean,
  point: (row: number, column: number) => FacePoint,
) {
  const stride = columns + 1,
    layer = rows * stride;
  const pos: number[] = [],
    uv: number[] = [],
    indices: number[] = [];
  const points = Array.from({ length: layer }, (_, i) => point(Math.floor(i / stride), i % stride));
  for (const rear of [false, true]) {
    for (const p of points) {
      pos.push(...(rear ? p.back : p.front));
      uv.push(rear ? (4 + 8 * p.s) / 512 : p.s, rear ? 0.36 + 0.28 * p.t : p.t);
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
  for (let i = 0; i < rows - 1; i++)
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
      if (i === rows - 2) edge(c, d);
      if (j === 0) edge(d, a);
      if (j === columns - 1) edge(b, c);
    }
  if (reverse) {
    for (let i = 0; i < indices.length; i += 3) {
      const b = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = b;
    }
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

// Rearward Z, bottom and top heights of the two tail mouldings in sprung-frame metres.
const SIDE_STATIONS = [
  [-0.753, 0.025, 0.046],
  [-0.704, -0.019, 0.056],
  [-0.59, -0.099, 0.068],
  [-0.505, -0.138, 0.074],
  [-0.449, -0.162, 0.077],
  [-0.402, -0.184, 0.078],
  [-0.346, -0.193, 0.074],
  [-0.271, -0.092, 0.027],
  [-0.226, -0.045, -0.017],
] as const;
const SIDE_ROWS = [0, 0.44, 0.92, 1];

function sidePoint(station: number, v: number, side: number, compact: boolean) {
  const [originalZ, bottom, top] = SIDE_STATIONS[station];
  const tail = T.MathUtils.smoothstep(-originalZ, 0.46, 0.757);
  const z = originalZ + (compact ? 0.022 * tail : 0);
  const y = T.MathUtils.lerp(bottom + (compact ? 0.012 * (1 - tail) : 0), top, v);
  // The port moulding stands away from the silencer and its retaining bands.
  // The starboard panel closes on the airbox. Both draw in under the leading knee.
  const exhaust = side < 0 ? 0.067 * T.MathUtils.smoothstep(-z, 0.34, 0.441) : 0;
  const crown = (compact ? 0.012 : 0.015) * Math.sin(Math.PI * v);
  const nose = 0.007 * (1 - T.MathUtils.smoothstep(-z, 0.23, 0.34));
  return new T.Vector3(side * (0.151 - 0.045 * z + exhaust + crown - nose), y, z);
}

export function mxSideNumberPlate(detail: RiderDetail, side: number, compact: boolean) {
  const stations =
    detail === 'high'
      ? [0, 1, 2, 3, 4, 5, 6, 7, 8]
      : detail === 'mid'
        ? [0, 1, 2, 4, 5, 6, 7, 8]
        : [0, 2, 4, 5, 6, 8];
  const rows = detail === 'far' ? [0, 0.48, 1] : SIDE_ROWS;
  return printedPlate(stations.length, rows.length - 1, side < 0, (i, j) => {
    const { x, y, z } = sidePoint(stations[i], rows[j], side, compact);
    const u = (z + 0.754 - (compact ? 0.022 : 0)) / (compact ? 0.507 : 0.529);
    return {
      front: [x, y, z],
      back: [x - side * WALL, y, z],
      s: side > 0 ? 1 - u : u,
      t: (y + 0.199) / 0.28,
    };
  });
}

/** Upper fasteners pass through the fairing into the airbox and rear subframe. */
export function mxSidePlateMounts(side: number, compact: boolean) {
  return [2, 6].map((station) => sidePoint(station, 0.92, side, compact));
}
