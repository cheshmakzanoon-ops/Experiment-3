import { trackPoint } from '../track.ts';
import { hash01 } from './noise.ts';
import { ROAD_FLAG, roadCandidates, type RoadNetwork } from './road-network.ts';
import { TILE_SIZE } from './terrain-tiles.ts';
import { footwayHeight, footwaySlope, footwayBand, townFootways } from './town-footways.ts';

export interface StreetTree {
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  grade: number;
  crossfall: number;
  height: number;
  yaw: number;
  tint: number;
}

const cached = new WeakMap<RoadNetwork, StreetTreePlan>();
const tileKey = (ix: number, iz: number) => ix * 65536 + iz;
const empty: readonly StreetTree[] = [];

/** Municipal planting shares the pavement's station, grade and crossfall.
 * Both workers reconstruct this layout, including the clear sight triangles
 * at junctions. Coordinates are rounded once to match the packed colliders. */
class StreetTreePlan {
  readonly sites: StreetTree[] = [];
  private readonly tiles = new Map<number, StreetTree[]>();

  constructor(network: RoadNetwork) {
    const p = trackPoint(),
      candidates = roadCandidates(),
      footways = townFootways(network);
    for (const edge of network.edges) {
      if (edge.roadClass !== 'town') continue;
      for (const side of [-1, 1]) {
        let segment = edge.first;
        for (let bay = 0; ; bay++) {
          // Keep crowns between the lamp stations and stagger the two kerbs.
          const seed = edge.index * 17 + side * 3;
          const varied = hash01(bay, seed, 811);
          const s = 26 + 32 * bay + side * 2.8 + (varied - 0.5) * 4;
          if (s > edge.length - 15) break;
          if (hash01(bay, seed, 217) < 0.14) continue;
          network.at(edge.offset + s, p);
          while (segment + 1 < edge.last && network.s[segment + 1] <= p.s) segment++;
          if ((network.flags[segment] | network.flags[segment + 1]) & ROAD_FLAG.BRIDGE) continue;
          const t = (p.s - network.s[segment]) / (network.s[segment + 1] - network.s[segment]);
          if (footways.strength(edge, segment, t, side) < 0.999) continue;
          const offset = 1.04;
          const lateral = side * (edge.spec.halfWidth + offset);
          const x = Math.fround(p.x + p.nx * lateral),
            z = Math.fround(p.z + p.nz * lateral);
          const count = network.covering(x, z, p.y, 7.5, candidates);
          let junction = false;
          for (let i = 0; i < count; i++)
            if (network.edgeOf[candidates.segment[i]] !== edge.index) junction = true;
          if (junction) continue;
          const y =
            network.surfaceHeight(
              p,
              side * edge.spec.halfWidth,
              edge.spec.halfWidth,
              edge.spec.crown,
            ) + footwayHeight(offset, 1);
          const site: StreetTree = {
            x,
            y,
            z,
            tx: p.tx,
            tz: p.tz,
            grade: p.gradient,
            crossfall: side * footwaySlope(footwayBand(offset), 1),
            height: 5.3 + varied * 1.7,
            yaw: 2 * Math.PI * hash01(bay, seed, 381),
            tint: hash01(bay, seed, 514),
          };
          const key = tileKey(Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE));
          let tile = this.tiles.get(key);
          if (!tile) this.tiles.set(key, (tile = []));
          tile.push(site);
          this.sites.push(site);
        }
      }
    }
  }
  inTile(ix: number, iz: number): readonly StreetTree[] {
    return this.tiles.get(tileKey(ix, iz)) ?? empty;
  }
  rootHeight(x: number, z: number) {
    return this.inTile(Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE)).find(
      (site) => site.x === x && site.z === z,
    )!.y;
  }
}

export function streetTrees(network: RoadNetwork) {
  let plan = cached.get(network);
  if (!plan) cached.set(network, (plan = new StreetTreePlan(network)));
  return plan;
}
