import { clamp } from '../../core/math.ts';
import type { TrackPoint } from '../track.ts';
import { ROAD_CLASSES } from './region-data.ts';
import { ROAD_FLAG, roadCandidates, type RoadEdge, type RoadNetwork } from './road-network.ts';

/** Section of the Port Ilse footway measured out from the asphalt edge.
 * The slot drain is followed by a mountable bevel, the stone cap, a shallow
 * crossfall and a sloping return to the existing carved terrain. */
const width = ROAD_CLASSES.town.shoulder;
export const FOOTWAY_OFFSETS = [
  0,
  0.14,
  0.19,
  0.22,
  0.3,
  0.345,
  0.48,
  width * 0.65,
  width * 0.85,
  width,
] as const;
const outer = -0.06 - width * 0.03;
const levels = [-0.005, -0.012, -0.011, 0.001, 0.064, 0.081, 0.084, 0.1, 0.002, outer];
const baseSlope = (-0.055 - width * 0.03) / width;
const slopes = levels
  .slice(1)
  .map((y, i) => (y - levels[i]) / (FOOTWAY_OFFSETS[i + 1] - FOOTWAY_OFFSETS[i]));
export function footwayBand(distance: number) {
  let band = 0;
  while (band < slopes.length - 1 && distance > FOOTWAY_OFFSETS[band + 1]) band++;
  return band;
}
export function footwayRise(distance: number, band = footwayBand(distance)) {
  const d = clamp(distance, 0, width);
  return levels[band] + (d - FOOTWAY_OFFSETS[band]) * slopes[band] - (-0.005 + baseSlope * d);
}
export function footwayHeight(distance: number, strength: number, band = footwayBand(distance)) {
  return -0.005 + baseSlope * clamp(distance, 0, width) + strength * footwayRise(distance, band);
}
export function footwaySlope(band: number, strength: number) {
  return baseSlope + (slopes[band] - baseSlope) * strength;
}

export function footwayVertex<P extends { x: number; y: number; z: number }>(
  p: TrackPoint,
  edgeWidth: number,
  side: number,
  edgeHeight: number,
  distance: number,
  strength: number,
  out: P,
) {
  const lateral = side * (edgeWidth + distance);
  out.x = p.x + p.nx * lateral;
  out.y = edgeHeight + footwayHeight(distance, strength);
  out.z = p.z + p.nz * lateral;
  return out;
}

/** Admission belongs to each side separately. A T-junction lowers the kerb
 * on the joining side. Bridge decks and dead ends meet the original shoulder.
 * Both the renderer and all four tyre casts interpolate these same stations. */
export class TownFootways {
  private readonly strengths = new Map<RoadEdge, Float32Array>();
  constructor(network: RoadNetwork) {
    const near = roadCandidates();
    for (const e of network.edges) {
      if (e.roadClass !== 'town') continue;
      const values = new Float32Array((e.last - e.first + 1) * 2);
      this.strengths.set(e, values);
      for (const side of [-1, 1]) {
        const slot = side > 0 ? 1 : 0;
        let lastClear = network.s[e.first];
        for (let i = e.first; i <= e.last; i++) {
          const index = (i - e.first) * 2 + slot;
          const l = side * (e.spec.halfWidth + width * 0.5);
          const norm = Math.hypot(network.tx[i], network.tz[i]);
          const x = network.x[i] + (l * network.tz[i]) / norm,
            z = network.z[i] - (l * network.tx[i]) / norm;
          const count = network.covering(x, z, network.y[i], width * 0.5 + 2.0, near);
          let open = i === e.first || i === e.last || !!(network.flags[i] & ROAD_FLAG.BRIDGE);
          for (let k = 0; k < count && !open; k++)
            open = network.edgeOf[near.segment[k]] !== e.index;
          if (open) lastClear = network.s[i];
          values[index] = network.s[i] - lastClear;
        }
        lastClear = network.s[e.last];
        for (let i = e.last; i >= e.first; i--) {
          const index = (i - e.first) * 2 + slot;
          if (values[index] === 0) lastClear = network.s[i];
          const t = clamp(Math.min(values[index], lastClear - network.s[i]) / 7.5, 0, 1);
          values[index] = t * t * (3 - 2 * t);
        }
      }
    }
  }
  strength(edge: RoadEdge, segment: number, t: number, side: number) {
    const values = this.strengths.get(edge);
    if (!values) return 0;
    const i = (segment - edge.first) * 2 + (side > 0 ? 1 : 0);
    return values[i] + (values[i + 2] - values[i]) * t;
  }
}

const cache = new WeakMap<RoadNetwork, TownFootways>();
export function townFootways(network: RoadNetwork) {
  let result = cache.get(network);
  if (!result) {
    result = new TownFootways(network);
    cache.set(network, result);
  }
  return result;
}
