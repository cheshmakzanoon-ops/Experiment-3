// Frozen linear-selection route planner from 9dc4811, independent of the production planner.
// Preserve its exact comparisons, directed-state order, snapping and path assembly as an oracle.
import { clamp } from '../../src/core/math.ts';
import { trackPoint } from '../../src/simulation/track.ts';
import type { RoadNetwork } from '../../src/simulation/open-world/road-network.ts';
import type { XZ } from '../../src/simulation/open-world/region-data.ts';

/** One piece of a planned route: part of a network edge, in its forward
 * (dir +1) or reverse (dir -1) direction, between local stations. */
export interface RouteLeg {
  edge: number;
  dir: 1 | -1;
  /** Local stations along the edge (forward metres from its first sample). */
  from: number;
  to: number;
}
interface Position {
  edge: number;
  s: number;
  x: number;
  z: number;
}
/** Snap a world point to the closest network position. */
export function snapToNetwork(network: RoadNetwork, x: number, z: number, height?: number): Position {
  const p = { s: 0, x: 0, y: 0, z: 0, tx: 0, tz: 1, nx: 1, nz: 0, curvature: 0, width: 0, bank: 0, gradient: 0 };
  network.nearest(x, z, p, height);
  const edge = network.edgeOf[network.lastSegment],
    e = network.edges[edge];
  return { edge, s: clamp(p.s - e.offset, 0, e.length), x: p.x, z: p.z };
}
/** A U-turn at an intermediate waypoint costs this much (m). */
const U_TURN = 8000;

/** Shortest legal path between two network positions. Dijkstra over
 * directed edge states (no U-turn at a junction, only at a dead end), with
 * deterministic tie-breaks; `departDir` forces the direction of travel away
 * from `a` (no U-turn after a waypoint) unless only a U-turn reaches `b`. */
function shortest(network: RoadNetwork, a: Position, b: Position, departDir: 0 | 1 | -1) {
  const edges = network.edges,
    states = edges.length * 2,
    state = (edge: number, dir: 1 | -1) => edge * 2 + (dir > 0 ? 0 : 1),
    dist = new Float64Array(states).fill(Infinity),
    prev = new Int32Array(states).fill(-1),
    done = new Uint8Array(states);
  const ea = edges[a.edge],
    eb = edges[b.edge];
  const penalty = (dir: 1 | -1) => (departDir !== 0 && dir !== departDir ? U_TURN : 0);
  // A state's cost is the distance travelled to the END of that directed
  // edge. Starting states: the rest of a's edge in either direction.
  dist[state(a.edge, 1)] = ea.length - a.s + penalty(1);
  dist[state(a.edge, -1)] = a.s + penalty(-1);
  const options: { cost: number; legs: RouteLeg[] }[] = [];
  if (a.edge === b.edge) {
    const dir: 1 | -1 = b.s >= a.s ? 1 : -1;
    options.push({ cost: Math.abs(b.s - a.s) + penalty(dir), legs: [{ edge: a.edge, dir, from: a.s, to: b.s }] });
  }
  for (;;) {
    let u = -1;
    for (let i = 0; i < states; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
    if (u < 0) break;
    done[u] = 1;
    const edge = edges[u >> 1],
      dir: 1 | -1 = u & 1 ? -1 : 1,
      end = dir > 0 ? edge.to : edge.from,
      deadEnd = network.nodes[end].edges.length === 1;
    for (const next of network.leaving(end)) {
      // No U-turn back along the same edge except at a dead end (or on a
      // loop edge that leaves and returns to one node).
      if (next.edge === edge && next.dir === -dir && !deadEnd && edge.from !== edge.to) continue;
      const v = state(next.edge.index, next.dir),
        cost = dist[u] + next.edge.length;
      if (cost < dist[v] - 1e-9) {
        dist[v] = cost;
        prev[v] = u;
      }
    }
  }
  // Arrive on b's edge from either end: the cheapest state ending at the
  // node b's edge starts from in that direction (not b's own reverse).
  for (const dir of [1, -1] as const) {
    const startNode = dir > 0 ? eb.from : eb.to;
    let best = -1;
    for (let u = 0; u < states; u++) {
      if (dist[u] === Infinity) continue;
      const e = edges[u >> 1],
        d: 1 | -1 = u & 1 ? -1 : 1;
      if ((d > 0 ? e.to : e.from) !== startNode) continue;
      if (e === eb && d === -dir && network.nodes[startNode].edges.length > 1 && eb.from !== eb.to) continue;
      if (best < 0 || dist[u] < dist[best]) best = u;
    }
    if (best < 0) continue;
    const legs: RouteLeg[] = [];
    let u = best;
    while (u >= 0) {
      const e = edges[u >> 1],
        d: 1 | -1 = u & 1 ? -1 : 1;
      if (prev[u] < 0) legs.unshift({ edge: e.index, dir: d, from: a.s, to: d > 0 ? e.length : 0 });
      else legs.unshift({ edge: e.index, dir: d, from: d > 0 ? 0 : e.length, to: d > 0 ? e.length : 0 });
      u = prev[u];
    }
    legs.push({ edge: b.edge, dir, from: dir > 0 ? 0 : eb.length, to: b.s });
    options.push({ cost: dist[best] + (dir > 0 ? b.s : eb.length - b.s), legs });
  }
  options.sort((x, y) => x.cost - y.cost);
  if (!options.length) throw new Error('No route between waypoints');
  // Drop zero-length pieces (a waypoint exactly on a node).
  return options[0].legs.filter((l) => Math.abs(l.to - l.from) > 0.05);
}

/** Plan a route through ordered waypoints (closed: back to the first). */
export function referencePlanRoute(network: RoadNetwork, waypoints: readonly XZ[], closed: boolean, departure?: { heading: number; height: number }): RouteLeg[] {
  if (waypoints.length < 2) throw new Error('A route needs at least two waypoints');
  const stops = waypoints.map(([x, z], i) => snapToNetwork(network, x, z, i === 0 ? departure?.height : undefined));
  if (closed) stops.push(stops[0]);
  const legs: RouteLeg[] = [];
  let dir: 0 | 1 | -1 = 0;
  if (departure) {
    const start = stops[0], tangent = network.at(network.edges[start.edge].offset + start.s, trackPoint());
    dir = Math.sin(departure.heading) * tangent.tx + Math.cos(departure.heading) * tangent.tz >= 0 ? 1 : -1;
  }
  for (let k = 0; k < stops.length - 1; k++) {
    const piece = shortest(network, stops[k], stops[k + 1], dir);
    legs.push(...piece);
    if (piece.length) dir = piece[piece.length - 1].dir;
  }
  // Merge consecutive pieces of the same edge and direction.
  const merged: RouteLeg[] = [];
  for (const l of legs) {
    const last = merged[merged.length - 1];
    if (last && last.edge === l.edge && last.dir === l.dir && Math.abs(last.to - l.from) < 0.5) last.to = l.to;
    else merged.push({ ...l });
  }
  // A circuit whose first and last pieces are one edge continues across the
  // start: keep them separate legs (the start/finish line sits between).
  return merged;
}

