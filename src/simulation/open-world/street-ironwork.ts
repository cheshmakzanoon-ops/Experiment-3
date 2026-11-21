import { clamp } from '../../core/math.ts';
import { townCrossings } from './town-crossings.ts';
import { townFootways } from './town-footways.ts';
import { ROAD_FLAG, type RoadNetwork } from './road-network.ts';

export type IronKind = 'cover' | 'gully';
export const IRON_DIMENSIONS = Object.freeze({
  cover: { along: 0.369, across: 0.369 },
  gully: { along: 0.329, across: 0.17 },
});
export interface StreetFitting {
  kind: IronKind;
  /** Both positions in the road's own metre frame. */
  station: number;
  lateral: number;
}
export function ironGrip(water: number) {
  return 0.89 - 0.23 * clamp(water / 1.35, 0, 1);
}

function part(f: StreetFitting, s: number, lateral: number, ds: number, dl: number) {
  const u = s - f.station,
    v = lateral - f.lateral;
  const size = IRON_DIMENSIONS[f.kind];
  if (Math.abs(u) > size.along + Math.abs(ds) || Math.abs(v) > size.across + Math.abs(dl)) return 0;
  let lo = -1,
    hi = 1;
  if (f.kind === 'cover') {
    const a = ds * ds + dl * dl,
      c = u * u + v * v - size.along ** 2;
    if (a < 1e-12) return c <= 0 ? 1 : 0;
    const b = u * ds + v * dl,
      disc = b * b - a * c;
    if (disc <= 0) return 0;
    const root = Math.sqrt(disc);
    lo = Math.max(lo, (-b - root) / a);
    hi = Math.min(hi, (-b + root) / a);
  } else {
    if (Math.abs(ds) > 1e-9) {
      const a = (-size.along - u) / ds,
        b = (size.along - u) / ds;
      lo = Math.max(lo, Math.min(a, b));
      hi = Math.min(hi, Math.max(a, b));
    }
    if (Math.abs(dl) > 1e-9) {
      const a = (-size.across - v) / dl,
        b = (size.across - v) / dl;
      lo = Math.max(lo, Math.min(a, b));
      hi = Math.min(hi, Math.max(a, b));
    }
  }
  return Math.max(0, hi - lo) * 0.5;
}

export class StreetIronworkLayout {
  readonly edges: readonly (readonly StreetFitting[])[];
  constructor(net: RoadNetwork) {
    const footways = townFootways(net);
    this.edges = net.edges.map((edge) => {
      const out: StreetFitting[] = [];
      if (edge.roadClass !== 'town') return out;
      const crossings = townCrossings(net, edge);
      const segmentAt = (station: number) => {
        if (crossings.some((c) => station > c.minPaint - 3 && station < c.maxPaint + 3)) return -1;
        const distance = edge.offset + station;
        let lo = edge.first,
          hi = edge.last;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (net.s[mid] <= distance) lo = mid;
          else hi = mid;
        }
        return (net.flags[lo] | net.flags[lo + 1]) & ROAD_FLAG.BRIDGE ? -1 : lo;
      };
      const hw = edge.spec.halfWidth,
        pitch = 46 + (edge.index % 7);
      for (let s = 23 + (edge.index % 13); s < edge.length - 20; s += pitch) {
        const index = segmentAt(s);
        if (index < 0) continue;
        const t = (edge.offset + s - net.s[index]) / (net.s[index + 1] - net.s[index]);
        for (const side of [-1, 1]) {
          if (footways.strength(edge, index, t, side) < 0.85) continue;
          out.push({ kind: 'gully', station: s, lateral: side * (hw - 0.57) });
        }
      }
      for (let n = 0, s = 38 + ((edge.index * 7) % 25); s < edge.length - 21; n++, s += 97) {
        if (segmentAt(s) >= 0)
          out.push({ kind: 'cover', station: s, lateral: (n + edge.index) % 2 ? -0.98 : 0.98 });
      }
      return out.sort((a, b) => a.station - b.station);
    });
  }
  coverage(edge: number, station: number, lateral: number, ds = 0, dl = 0) {
    const fittings = this.edges[edge];
    if (!fittings?.length) return 0;
    const reach = 0.37 + Math.abs(ds);
    let lo = 0,
      hi = fittings.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (fittings[mid].station < station - reach) lo = mid + 1;
      else hi = mid;
    }
    let sum = 0;
    for (let i = lo; i < fittings.length && fittings[i].station <= station + reach; i++)
      sum += part(fittings[i], station, lateral, ds, dl);
    return Math.min(1, sum);
  }
}
const cache = new WeakMap<RoadNetwork, StreetIronworkLayout>();
export function streetIronwork(net: RoadNetwork) {
  let layout = cache.get(net);
  if (!layout) {
    layout = new StreetIronworkLayout(net);
    cache.set(net, layout);
  }
  return layout;
}
