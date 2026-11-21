import type { RoadEdge, RoadNetwork } from '../../simulation/open-world/road-network.ts';
import { trackPoint } from '../../simulation/track.ts';

/** Road-local decal tolerances (m). Paint is raised 12 mm over the asphalt.
 * Limit the gap to a fraction of that even on a crowned mountain road. */
export const PAINT_TOLERANCE = Object.freeze({ horizontal: 0.0085, vertical: 0.0020, span: 32 });

/** Resolve a single painted span into stations. Test both sides of the ribbon
 * on every underlying road segment and at quarter-metre intervals between them.
 * Preserve dash ends while allowing a level straight to share one quad. */
export function paintStations(net: RoadNetwork, edge: RoadEdge, from: number, to: number, left: number, right: number) {
  const out = [from];
  if (to <= from) return out;
  const point = trackPoint(), row: number[] = [];
  const low = [left, right];
  let first = edge.first, last = edge.last;
  while (last - first > 1) {
    const mid = (first + last) >> 1;
    if (net.s[mid] <= edge.offset + from) first = mid;
    else last = mid;
  }
  let boundary = first + 1;
  const setRow = (i: number, station: number) => {
    net.at(edge.offset + station, point);
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
    setRow(0, start);
    let count = 1, probe = start + 0.25, s = start;
    while (s < end) {
      while (boundary < edge.last && net.s[boundary] - edge.offset <= s + 1e-8) boundary++;
      if (probe <= s + 1e-8) probe += 0.25;
      const nextRoad = boundary < edge.last ? net.s[boundary] - edge.offset : Infinity;
      s = Math.min(end, probe, nextRoad);
      setRow(count++, s);
    }
    simplify(0, count - 1);
    start = end;
  }
  return out;
}
