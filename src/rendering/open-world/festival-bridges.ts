import type { TrackPoint } from '../../simulation/track.ts';
import {
  ROAD_FLAG,
  roadBarrierFace,
  type RoadEdge,
} from '../../simulation/open-world/road-network.ts';

type Point = readonly [number, number, number];
interface BridgeBatch {
  vertex(
    x: number,
    y: number,
    z: number,
    u: number,
    v: number,
    nx?: number,
    ny?: number,
    nz?: number,
  ): number;
  quad(a: number, b: number, c: number, d: number): void;
  triangle(a: number, b: number, c: number): void;
}
type Height = (p: TrackPoint, lateral: number) => number;
const at = (p: TrackPoint, lateral: number, y: number, station = 0): Point => [
  p.x + p.nx * lateral + p.tx * station,
  y,
  p.z + p.nz * lateral + p.tz * station,
];

/** Hard edges keep a distinct wet highlight at the coping, drip edge and
 * concrete webs. UVs run in metres along the structure. */
function face(
  batch: BridgeBatch,
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
) {
  const ax = c[0] - a[0],
    ay = c[1] - a[1],
    az = c[2] - a[2];
  const bx = b[0] - a[0],
    by = b[1] - a[1],
    bz = b[2] - a[2];
  const nx = ay * bz - az * by,
    ny = az * bx - ax * bz,
    nz = ax * by - ay * bx;
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-8) return;
  const vertex = (p: Point, u: number, v: number) =>
    batch.vertex(p[0], p[1], p[2], u, v, nx / length, ny / length, nz / length);
  batch.quad(vertex(a, u0, v0), vertex(b, u1, v0), vertex(c, u0, v1), vertex(d, u1, v1));
}

/** A continuous closed outer profile from the inner tyre-contact face, over
 * the coping, down the slab edge and through the haunched box girder.
 * Cross-sections use each station's own normal on a curved span. */
export function festivalBridgeSection(
  batch: BridgeBatch,
  edge: RoadEdge,
  p: TrackPoint,
  q: TrackPoint,
  height: Height,
  rails: number,
  startCaps: number,
  endCaps: number,
) {
  const half = edge.spec.halfWidth + edge.spec.shoulder;
  const contact = roadBarrierFace(edge.spec, true);
  const shoulderDrop = 0.005 + 0.055 + 0.03 * edge.spec.shoulder;
  const level = (pt: TrackPoint, l: number) => {
    const out = Math.max(0, Math.abs(l) - edge.spec.halfWidth);
    return (
      height(pt, l) -
      (out > 0 ? 0.005 + (shoulderDrop - 0.005) * Math.min(1, out / edge.spec.shoulder) : 0)
    );
  };
  const ribbon = (section: (readonly [number, number])[], pt: TrackPoint) =>
    section.map(([l, h]) => at(pt, l, level(pt, l) + h));
  const sweep = (section: (readonly [number, number])[]) => {
    const a = ribbon(section, p),
      b = ribbon(section, q);
    let u = 0;
    for (let k = 0; k + 1 < section.length; k++) {
      const next =
        u + Math.hypot(section[k + 1][0] - section[k][0], section[k + 1][1] - section[k][1]);
      face(batch, a[k], a[k + 1], b[k], b[k + 1], u, next, p.s, q.s);
      u = next;
    }
  };
  // The vertical tyre-height face agrees with the physical barrier. The
  // upper break and coping retreat towards the outside of the deck.
  const parapet: [number, number][] = [
    [contact, -0.025],
    [contact, 0.62],
    [contact + 0.045, 0.81],
    [contact + 0.048, 0.955],
    [contact + 0.075, 0.99],
    [half - 0.035, 0.99],
    [half, 0.96],
    [half, 0.105],
    [half + 0.048, 0.072],
    [half + 0.048, -0.19],
    [half, -0.23],
    [half, -0.39],
  ];
  for (const side of [-1, 1]) {
    const bit = side < 0 ? ROAD_FLAG.BARRIER_LEFT : ROAD_FLAG.BARRIER_RIGHT;
    const section = rails & bit ? parapet : [[half, 0], ...parapet.slice(8)];
    const oriented = section.map(([l, h]): [number, number] => [side * l, h]);
    sweep(side < 0 ? oriented.reverse() : oriented);
    if (!(rails & bit)) continue;
    // Close the exposed rail ends at road connections. The slab and its
    // underside continue across the whole bridge underneath the opening.
    const cap = (pt: TrackPoint, start: boolean) => {
      const ledges = [
        [0, contact, half],
        [0.62, contact, half],
        [0.81, contact + 0.045, half],
        [0.955, contact + 0.048, half],
        [0.99, contact + 0.075, half - 0.035],
      ];
      for (let k = 1; k < ledges.length; k++) {
        const a = ledges[k - 1],
          b = ledges[k];
        const v = (row: number[], index: number) =>
          at(pt, side * row[index], level(pt, side * row[index]) + row[0]);
        const left = side > 0 === start ? 2 : 1,
          right = 3 - left;
        face(
          batch,
          v(a, left),
          v(a, right),
          v(b, left),
          v(b, right),
          0,
          half - contact,
          a[0],
          b[0],
        );
      }
    };
    if (startCaps & bit) cap(p, true);
    if (endCaps & bit) cap(q, false);
  }
  sweep([
    [half, -0.39],
    [half * 0.79, -0.46],
    [half * 0.6, -0.59],
    [half * 0.49, -1.36],
    [half * 0.455, -1.5],
    [-half * 0.455, -1.5],
    [-half * 0.49, -1.36],
    [-half * 0.6, -0.59],
    [-half * 0.79, -0.46],
    [-half, -0.39],
  ]);
}

/** Two chamfered columns widen at their ground footings and meet a tapered
 * crosshead and bearing pads beneath the girder. Everything is merged into
 * the same streamed concrete batch as the deck. */
export function festivalBridgePier(
  batch: BridgeBatch,
  edge: RoadEdge,
  p: TrackPoint,
  height: Height,
  ground: (x: number, z: number) => number,
) {
  const half = edge.spec.halfWidth + edge.spec.shoulder;
  const girder = Math.min(height(p, half * 0.41), height(p, -half * 0.41)) - 1.5;
  const capBottom = girder - 1.07;
  const ring = (centre: number, y: number, x: number, z: number) => {
    const chamfer = Math.min(x, z) * 0.29;
    return [
      [-x + chamfer, -z],
      [x - chamfer, -z],
      [x, -z + chamfer],
      [x, z - chamfer],
      [x - chamfer, z],
      [-x + chamfer, z],
      [-x, z - chamfer],
      [-x, -z + chamfer],
    ].map(([l, t]) => at(p, centre + l, y, t));
  };
  const column = (centre: number, sections: (readonly [number, number, number])[]) => {
    const rows = sections.map(([y, x, z]) => ring(centre, y, x, z));
    for (let row = 0; row + 1 < rows.length; row++)
      for (let k = 0; k < 8; k++) {
        const j = (k + 1) % 8;
        face(
          batch,
          rows[row][k],
          rows[row][j],
          rows[row + 1][k],
          rows[row + 1][j],
          0,
          Math.hypot(rows[row][j][0] - rows[row][k][0], rows[row][j][2] - rows[row][k][2]),
          sections[row][0],
          sections[row + 1][0],
        );
      }
    // Cap the visible horizontal shoulders without overlapping coplanar sides.
    const close = (r: number, up: boolean) => {
      const vertices = rows[r].map((t) =>
        batch.vertex(t[0], t[1], t[2], t[0] - p.x, t[2] - p.z, 0, up ? 1 : -1, 0),
      );
      for (let j = 1; j + 1 < vertices.length; j++) {
        if (up) batch.triangle(vertices[0], vertices[j + 1], vertices[j]);
        else batch.triangle(vertices[0], vertices[j], vertices[j + 1]);
      }
    };
    close(0, false);
    close(rows.length - 1, true);
  };
  for (const side of [-1, 1]) {
    const centre = side * half * 0.32,
      foot = at(p, centre, 0);
    const base = ground(foot[0], foot[2]) - 0.25;
    if (capBottom - base < 1.3) continue;
    column(centre, [
      [base, 0.83, 0.88],
      [base + 0.38, 0.83, 0.88],
      [base + 0.67, 0.49, 0.55],
      [capBottom - 0.55, 0.49, 0.55],
      [capBottom + 0.06, 0.66, 0.61],
    ]);
    column(centre, [
      [girder - 0.23, 0.51, 0.47],
      [girder + 0.055, 0.51, 0.47],
    ]);
  }
  column(0, [
    [capBottom, half * 0.41, 0.63],
    [girder - 0.51, half * 0.55, 0.75],
    [girder - 0.22, half * 0.55, 0.75],
  ]);
}
