import { describe, expect, it } from 'vitest';
import { RoadNetwork } from '../src/simulation/open-world/road-network.ts';
import { SOLVANE, type XZ } from '../src/simulation/open-world/region-data.ts';
import { planRoute } from '../src/simulation/open-world/route-path.ts';
import { TerrainField } from '../src/simulation/open-world/terrain-field.ts';
import { trackPoint, type TrackPoint } from '../src/simulation/track.ts';
import { referencePlanRoute } from './helpers/reference-route-planner.ts';

type Link = readonly [from: number, to: number, length: number];

/** Search-only fixture: [edge, local station] waypoints snap without any
 * geometry. Real region tests below separately exercise actual snapping. */
function graphNetwork(links: readonly Link[], reverseExits = false): RoadNetwork {
  const edges = links.map(([from, to, length], index) => ({ from, to, length, index, offset: index * 10000 }));
  const nodes = Array.from({ length: 1 + Math.max(...links.flatMap(([from, to]) => [from, to])) }, () => ({ edges: [] as number[] }));
  for (const edge of edges) {
    nodes[edge.from].edges.push(edge.index);
    nodes[edge.to].edges.push(edge.index);
  }
  if (reverseExits) for (const node of nodes) node.edges.reverse();
  return {
    edges,
    nodes,
    edgeOf: Int32Array.from(edges, (edge) => edge.index),
    lastSegment: 0,
    nearest(this: { lastSegment: number }, x: number, z: number, out: TrackPoint) {
      this.lastSegment = x;
      out.s = edges[x].offset + z;
      out.x = x;
      out.z = z;
      return out;
    },
    at(_station: number, out: TrackPoint) {
      out.tx = 1;
      out.tz = 0;
      return out;
    },
    leaving: RoadNetwork.prototype.leaving,
  } as unknown as RoadNetwork;
}

function compare(network: RoadNetwork, waypoints: readonly XZ[], closed = false, heading?: number) {
  const departure = heading === undefined ? undefined : { heading, height: 0 };
  const expected = referencePlanRoute(network, waypoints, closed, departure);
  expect(planRoute(network, waypoints, closed, departure)).toStrictEqual(expected);
  return expected;
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

describe('route search preserves the frozen linear planner', () => {
  it('matches all authored festival event routes, including circuits and departure headings', () => {
    const network = new RoadNetwork(SOLVANE, new TerrainField(SOLVANE));
    for (const event of SOLVANE.events) {
      if (event.waypoints.length < 2) continue;
      compare(network, event.waypoints, event.kind === 'circuit');
      for (const heading of [-Math.PI, -Math.PI / 2, 0, Math.PI / 2])
        compare(network, event.waypoints, event.kind === 'circuit', heading);
    }
    // Use actual edge samples to cover intermediate waypoints and requests
    // whose first marker is behind the current direction of travel.
    for (let i = 0; i < network.edges.length; i += 7) {
      const edge = network.edges[i];
      const a = network.at(edge.offset + edge.length * 0.25, trackPoint());
      const b = network.at(edge.offset + edge.length * 0.75, trackPoint());
      const heading = Math.atan2(a.tx, a.tz);
      const waypoints: XZ[] = [[a.x, a.z], [b.x, b.z], [a.x, a.z]];
      for (const direction of [heading, heading + Math.PI]) compare(network, waypoints, false, direction);
    }
  });

  it('chooses lower state indices at exact ties even when exits are enumerated backwards', () => {
    const links: Link[] = [
      [0, 1, 10], [1, 2, 10], [1, 3, 10], [2, 4, 10], [3, 4, 10], [4, 5, 10],
    ];
    for (const reverse of [false, true]) {
      const network = graphNetwork(links, reverse);
      const legs = compare(network, [[0, 5], [5, 5]]);
      expect(legs.map((leg) => leg.edge)).toStrictEqual([0, 1, 3, 5]);
      for (let a = 0; a < links.length; a++)
        for (let b = 0; b < links.length; b++)
          compare(network, [[a, 5], [b, 5]], false, a % 2 ? Math.PI / 2 : -Math.PI / 2);
    }
  });

  it('keeps exact distance ordering separate from the 1e-9 relaxation tolerance', () => {
    for (const delta of [0, 0.25e-9, 0.999e-9, 1e-9, 1.001e-9, 2e-9, 1e-7]) {
      for (const sign of [-1, 1]) {
        const links: Link[] = [
          [0, 1, 1], [1, 2, 3], [1, 3, 3 + sign * delta],
          [2, 4, 1], [3, 4, 1], [4, 5, 1], [5, 6, 1],
        ];
        for (const reverse of [false, true]) {
          const network = graphNetwork(links, reverse);
          compare(network, [[0, 0.5], [6, 0.5]]);
          compare(network, [[6, 0.5], [0, 0.5]], true);
        }
      }
    }
  });

  it('preserves dead-end turns, loop directions, parallel edges and zero-length pieces', () => {
    const links: Link[] = [
      [0, 1, 20], [1, 2, 25], [2, 2, 30], [2, 3, 20],
      [1, 2, 25], [3, 4, 0], [4, 5, 10],
    ];
    for (const reverse of [false, true]) {
      const network = graphNetwork(links, reverse);
      for (let a = 0; a < links.length; a++) {
        for (let b = 0; b < links.length; b++) {
          const waypoints: XZ[] = [[a, links[a][2] * 0.2], [b, links[b][2] * 0.8]];
          compare(network, waypoints);
          compare(network, waypoints, true, Math.PI / 2);
          compare(network, waypoints, false, -Math.PI / 2);
        }
      }
      for (const s of [0, 0.05, 0.0500001, 20]) compare(network, [[0, 0], [0, s]]);
    }
  });

  it('decreases an initially penalized departure state without discarding the permitted return path', () => {
    const network = graphNetwork([[0, 1, 10], [1, 2, 10], [2, 0, 10]], true);
    const legs = compare(network, [[0, 5], [0, 2]], false, Math.PI / 2);
    expect(legs.map((leg) => [leg.edge, leg.dir])).toStrictEqual([[0, 1], [1, 1], [2, 1], [0, 1]]);
    // The same direction request at a dead end can legally turn back.
    const deadEnd = graphNetwork([[0, 1, 10], [0, 2, 10]]);
    const returning = compare(deadEnd, [[0, 5], [1, 5]], false, Math.PI / 2);
    expect(returning.map((leg) => [leg.edge, leg.dir])).toStrictEqual([[0, 1], [0, -1], [1, 1]]);
  });

  it('preserves unreachable-route and insufficient-waypoint failures', () => {
    const network = graphNetwork([[0, 1, 10], [2, 3, 10]]);
    for (const planner of [referencePlanRoute, planRoute]) {
      expect(() => planner(network, [[0, 5], [1, 5]], false)).toThrow('No route between waypoints');
      expect(() => planner(network, [[0, 5]], false)).toThrow('A route needs at least two waypoints');
      expect(() => planner(network, [], false)).toThrow('A route needs at least two waypoints');
    }
    compare(network, [[0, 1], [0, 9]]);
  });

  it('matches seeded sparse and dense multigraphs with multiple waypoints and departure penalties', () => {
    for (let seed = 1; seed <= 24; seed++) {
      const rng = random(seed * 982451653);
      const nodes = 12 + seed * 2;
      const links: Link[] = Array.from({ length: nodes }, (_, i) => [i, (i + 1) % nodes, 1 + Math.floor(rng() * 30)]);
      for (let i = 0; i < nodes * (seed % 4 + 1); i++)
        links.push([Math.floor(rng() * nodes), Math.floor(rng() * nodes), 1 + (i % 3 ? Math.floor(rng() * 40) : rng() * 40)]);
      const network = graphNetwork(links, seed % 2 === 0);
      for (let query = 0; query < 20; query++) {
        const waypoints: XZ[] = Array.from({ length: 2 + query % 4 }, () => {
          const edge = Math.floor(rng() * links.length);
          return [edge, links[edge][2] * rng()];
        });
        compare(network, waypoints, query % 3 === 0, query % 2 ? Math.PI / 2 : -Math.PI / 2);
      }
    }
  });

  it('matches a larger grid where many frontier states have equal cost', () => {
    const side = 24;
    const links: Link[] = [];
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const from = y * side + x;
        if (x + 1 < side) links.push([from, from + 1, 10]);
        if (y + 1 < side) links.push([from, from + side, 10]);
      }
    }
    const network = graphNetwork(links, true);
    compare(network, [[0, 5], [links.length - 1, 5], [links.length >> 1, 5]], true, -Math.PI / 2);
  });
});
