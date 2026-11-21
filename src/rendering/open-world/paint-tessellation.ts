import type { RoadEdge, RoadNetwork } from '../../simulation/open-world/road-network.ts';
import { trackPoint } from '../../simulation/track.ts';

/** Road-local decal tolerances (m). Paint is raised 12 mm over the asphalt.
 * Limit the gap to a fraction of that even on a crowned mountain road. */
export const PAINT_TOLERANCE = Object.freeze({ horizontal: 0.0085, vertical: 0.0020, span: 32 });

/** Resolve a single painted span into stations. Test both sides of the ribbon
 * on every underlying road segment, including its camber breakpoints.
 * Preserve dash ends while allowing a level straight to share one quad. */
export function paintStations(net: RoadNetwork, edge: RoadEdge, from: number, to: number, left: number, right: number) {
  const out = [from];
  if (to <= from) return out;
  const point = trackPoint(), row: number[] = [];
  const low = [left, right];
  const extent = Math.max(Math.abs(left), Math.abs(right));
  let first = edge.first, last = edge.last;
  while (last - first > 1) {
    const mid = (first + last) >> 1;
    if (net.s[mid] <= edge.offset + from) first = mid;
    else last = mid;
  }
  let boundary = first + 1;
  const setRow = (i: number, station: number) => {
    const i0 = boundary - 1;
    const t = (edge.offset + station - net.s[i0]) / (net.s[boundary] - net.s[i0]);
    net.pointOnSegment(i0, Math.min(1, Math.max(0, t)), point);
    const offset = i * 7;
    row[offset] = station;
    for (let side = 0; side < 2; side++) {
      const l = low[side], k = offset + 1 + side * 3;
      row[k] = point.x + point.nx * l;
      row[k + 1] = net.surfaceHeight(point, l, edge.spec.halfWidth, edge.spec.crown);
      row[k + 2] = point.z + point.nz * l;
    }
  };
  const h2 = PAINT_TOLERANCE.horizontal ** 2, v2 = PAINT_TOLERANCE.vertical ** 2;
  const simplify = (a: number, b: number) => {
    const i0 = a * 7, i1 = b * 7, invSpan = 1 / (row[i1] - row[i0]);
    let worst = 1, split = -1;
    for (let i = a + 1; i < b; i++) {
      const j = i * 7, f = (row[j] - row[i0]) * invSpan;
      for (let axis = 1; axis <= 4; axis += 3) {
        const x = row[j + axis] - (row[i0 + axis] + (row[i1 + axis] - row[i0 + axis]) * f);
        const y = row[j + axis + 1] - (row[i0 + axis + 1] + (row[i1 + axis + 1] - row[i0 + axis + 1]) * f);
        const z = row[j + axis + 2] - (row[i0 + axis + 2] + (row[i1 + axis + 2] - row[i0 + axis + 2]) * f);
        const error = Math.max((x * x + z * z) / h2, y * y / v2);
        if (error > worst) { worst = error; split = i; }
      }
    }
    if (split < 0) out.push(row[i1]);
    else {
      simplify(a, split);
      simplify(split, b);
    }
  };
  for (let start = from; start < to;) {
    const end = Math.min(start + PAINT_TOLERANCE.span, to);
    while (boundary < edge.last && net.s[boundary] - edge.offset <= start + 1e-9) boundary++;
    setRow(0, start);
    let count = 1, s = start;
    while (s < end) {
      const i0 = boundary - 1, segmentStart = net.s[i0] - edge.offset;
      const segmentEnd = net.s[boundary] - edge.offset;
      const stop = boundary === edge.last ? end : Math.min(end, segmentEnd);
      const span = segmentEnd - segmentStart;
      // The centreline is affine. Only normalization bends its offset:
      // a normalized lerp differs from its chord by at most 1-cos(arc/2).
      const dot = Math.min(1, Math.max(-1, net.tx[i0] * net.tx[boundary] + net.tz[i0] * net.tz[boundary]));
      const deviation = extent * (1 - Math.sqrt(0.5 + 0.5 * dot));
      const divisions = Math.max(1, Math.ceil(Math.sqrt(deviation / 0.00036) * (stop - s) / span));
      const db = net.bank[boundary] - net.bank[i0], crown = edge.spec.crown;
      // Crown/absolute camber makes the vertical profile piecewise affine.
      // Include those exact stations even if an entire bend is only a metre long.
      const knots: number[] = [];
      if (Math.abs(db) > 1e-10) {
        for (const bank of crown > 0 ? [-crown, 0, crown] : [0]) {
          const knot = segmentStart + (bank - net.bank[i0]) * span / db;
          if (knot > s + 1e-8 && knot < stop - 1e-8) knots.push(knot);
        }
        if (db < 0) knots.reverse();
      }
      let k = 0;
      for (let d = 1; d <= divisions; d++) {
        const at = d === divisions ? stop : s + (stop - s) * d / divisions;
        while (k < knots.length && knots[k] < at - 1e-8) setRow(count++, knots[k++]);
        if (k < knots.length && knots[k] <= at + 1e-8) k++;
        setRow(count++, at);
      }
      s = stop;
      if (boundary < edge.last && segmentEnd <= s + 1e-9) boundary++;
    }
    simplify(0, count - 1);
    start = end;
  }
  return out;
}
