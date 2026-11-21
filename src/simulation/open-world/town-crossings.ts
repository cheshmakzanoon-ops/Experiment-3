import { ROAD_FLAG, type RoadEdge, type RoadNetwork } from './road-network.ts';
import type { FestivalPaintLine } from './festival-markings.ts';

/** Local stations in metres. Each crossing spans one native road segment,
 * so the two ends of each dropped kerb agree with the road and tyre mesh. */
export interface TownCrossing {
  first: number;
  last: number;
  from: number;
  to: number;
  minPaint: number;
  maxPaint: number;
  lines: FestivalPaintLine[];
}

const cache = new WeakMap<RoadEdge, TownCrossing[]>();
const none: readonly TownCrossing[] = [];

/** Crossings are confined to long streets at urban T and four-way junctions.
 * A junction with a motorway, a bridge deck or a dead end keeps its own layout. */
export function townCrossings(net: RoadNetwork, edge: RoadEdge): readonly TownCrossing[] {
  if (edge.roadClass !== 'town' || edge.length < 55) return none;
  const cached = cache.get(edge);
  if (cached) return cached;
  const sites: TownCrossing[] = [];
  const half = edge.spec.halfWidth;
  for (const atStart of [true, false]) {
    const node = net.nodes[atStart ? edge.from : edge.to];
    if (node.edges.length < 3 || !node.edges.every((i) => net.edges[i].roadClass === 'town'))
      continue;
    const direction = atStart ? 1 : -1;
    const end = atStart ? edge.first : edge.last;
    // Keep the zebra clear of the adjoining footway, even where a split
    // edge has a short stub before its first complete spline segment.
    let near = end;
    const farEnd = atStart ? edge.last : edge.first;
    while (near !== farEnd && Math.abs(net.s[near] - net.s[end]) < half + edge.spec.shoulder + 0.75)
      near += direction;
    if (near === farEnd) continue;
    const first = Math.min(near, near + direction);
    const last = first + 1;
    if ((net.flags[first] | net.flags[last]) & ROAD_FLAG.BRIDGE) continue;
    const from = net.s[first] - edge.offset;
    const to = net.s[last] - edge.offset;
    if (to - from < 2.4 || to - from > 6) continue;
    const lines: FestivalPaintLine[] = [];
    const n = Math.floor((half - 0.3) / 0.88);
    for (let bar = -n; bar < n; bar++) {
      lines.push({
        from,
        to,
        lateral: (bar + 0.5) * 0.88,
        width: 0.46,
        layer: 'paint',
        dash: 0,
        period: 0,
      });
    }
    // The approach line belongs only to the lane heading INTO the junction.
    const stop = atStart ? to + 1.8 : from - 1.8;
    lines.push({
      from: stop - 0.16,
      to: stop + 0.16,
      lateral: (direction * half) / 2,
      width: half - 0.52,
      layer: 'paint',
      dash: 0,
      period: 0,
    });
    sites.push({
      first,
      last,
      from,
      to,
      minPaint: Math.min(from, stop - 0.16),
      maxPaint: Math.max(to, stop + 0.16),
      lines,
    });
  }
  cache.set(edge, sites);
  return sites;
}
