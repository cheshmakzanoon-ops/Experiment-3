import { clamp } from '../../core/math.ts';
import type { RoadEdge, RoadNetwork } from './road-network.ts';
import { planRoute, snapToNetwork } from './route-path.ts';

/** Metre-scale circuit paint shared by the road mesh and tyre contacts.
 * Shader scuffs change its appearance, not its material a noise grain at a
 * time. Bare checker cells and the interiors of grid boxes stay asphalt. */
export const FESTIVAL_CIRCUIT_PAINT = Object.freeze({
  edgeInset: 0.65,
  edgeWidth: 0.15,
  lineStep: 2,
});

export interface FestivalCircuitApron {
  readonly segment: number;
  readonly side: 1 | -1;
  readonly width0: number;
  readonly width1: number;
}

export interface FestivalPaintRectangle {
  /** Metres along the race direction from the start line. */
  readonly d0: number;
  readonly d1: number;
  /** Metres across the road in the race direction's lateral frame. */
  readonly l0: number;
  readonly l1: number;
}

export interface FestivalCircuitGrid {
  readonly event: string;
  readonly edge: number;
  /** Global station on the network, before applying race direction. */
  readonly station: number;
  readonly direction: 1 | -1;
  /** Furthest painted distance from the start, for contact-query culling. */
  readonly length: number;
  readonly centres: readonly { readonly distance: number; readonly lateral: number }[];
  readonly rectangles: readonly FestivalPaintRectangle[];
}

/** Both ends matter even when a closed course returns to the same node. */
export function festivalCircuitLineVisible(network: RoadNetwork, edge: RoadEdge, station: number) {
  const mouth = edge.spec.halfWidth + 9;
  return (
    (network.nodes[edge.from].edges.length < 3 || station >= mouth) &&
    (network.nodes[edge.to].edges.length < 3 || edge.length - station >= mouth)
  );
}

/** The flush apex apron occupies at most the outer half metre of asphalt. */
export function festivalCircuitApronWidth(curvature: number) {
  const t = clamp((Math.abs(curvature) - 0.0025) / 0.0035, 0, 1);
  return 0.5 * t * t * (3 - 2 * t);
}

function apronAdmission(network: RoadNetwork, edge: RoadEdge, station: number) {
  const mouth = edge.spec.halfWidth + 9;
  let admission = 1;
  for (const [node, distance] of [
    [edge.from, station],
    [edge.to, edge.length - station],
  ] as const) {
    if (network.nodes[node].edges.length < 3) continue;
    const t = clamp((distance - mouth) / 6, 0, 1);
    admission = Math.min(admission, t * t * (3 - 2 * t));
  }
  return admission;
}

const EMPTY_APRONS: readonly FestivalCircuitApron[] = Object.freeze([]);
const EMPTY_GRIDS: readonly FestivalCircuitGrid[] = Object.freeze([]);
type PaintFootprint = readonly [number, number, number, number, number, number, number, number];

/** The same inner/outer endpoints used by the apron mesh. A normal-offset
 * ribbon does not project exactly back to its centreline station on bends,
 * which matters at the last few millimetres of a taper. */
function apronFootprint(
  network: RoadNetwork,
  edge: RoadEdge,
  apron: FestivalCircuitApron,
): PaintFootprint {
  const i = apron.segment,
    n0 = Math.hypot(network.tx[i], network.tz[i]),
    n1 = Math.hypot(network.tx[i + 1], network.tz[i + 1]),
    nx0 = network.tz[i] / n0,
    nz0 = -network.tx[i] / n0,
    nx1 = network.tz[i + 1] / n1,
    nz1 = -network.tx[i + 1] / n1,
    outer = edge.spec.halfWidth * apron.side,
    inner0 = (edge.spec.halfWidth - apron.width0) * apron.side,
    inner1 = (edge.spec.halfWidth - apron.width1) * apron.side;
  return [
    network.x[i] + nx0 * inner0,
    network.z[i] + nz0 * inner0,
    network.x[i] + nx0 * outer,
    network.z[i] + nz0 * outer,
    network.x[i + 1] + nx1 * outer,
    network.z[i + 1] + nz1 * outer,
    network.x[i + 1] + nx1 * inner1,
    network.z[i + 1] + nz1 * inner1,
  ];
}

function contains(quad: PaintFootprint, x: number, z: number) {
  let positive = false,
    negative = false;
  for (let i = 0; i < 8; i += 2) {
    const next = (i + 2) % 8,
      cross =
        (quad[next] - quad[i]) * (z - quad[i + 1]) - (quad[next + 1] - quad[i + 1]) * (x - quad[i]);
    if (cross > 1e-9) positive = true;
    if (cross < -1e-9) negative = true;
    if (positive && negative) return false;
  }
  return true;
}

/** Authored once per immutable network, with no route planning, allocation
 * or rendering dependency in the four-tyre sampling path. */
export class FestivalMarkings {
  readonly grids: readonly FestivalCircuitGrid[];
  private readonly apronEdges = new Map<number, readonly FestivalCircuitApron[]>();
  private readonly apronFootprints = new Map<number, PaintFootprint>();
  private readonly gridEdges = new Map<number, FestivalCircuitGrid[]>();

  constructor(private readonly network: RoadNetwork) {
    for (const edge of network.edges) {
      if (edge.roadClass !== 'circuit') continue;
      const aprons: FestivalCircuitApron[] = [];
      for (let segment = edge.first; segment < edge.last; segment++) {
        const c0 = network.curvature[segment],
          c1 = network.curvature[segment + 1],
          side = (Math.sign(c0 + c1) || 1) as 1 | -1,
          width0 =
            (Math.sign(c0) === side ? festivalCircuitApronWidth(c0) : 0) *
            apronAdmission(network, edge, network.s[segment] - edge.offset),
          width1 =
            (Math.sign(c1) === side ? festivalCircuitApronWidth(c1) : 0) *
            apronAdmission(network, edge, network.s[segment + 1] - edge.offset);
        // This is also the mesh's degenerate-strip cut-off: omitted paint
        // must not leave an invisible lower-grip sliver in the tyres.
        if (width0 + width1 < 0.005) continue;
        const apron = { segment, side, width0, width1 };
        aprons.push(apron);
        this.apronFootprints.set(segment, apronFootprint(network, edge, apron));
      }
      this.apronEdges.set(edge.index, aprons);
    }

    const grids: FestivalCircuitGrid[] = [];
    for (const event of network.region.events) {
      if (event.kind !== 'circuit' || (event.rivals ?? 0) < 1 || event.waypoints.length < 2)
        continue;
      const start = snapToNetwork(network, event.waypoints[0][0], event.waypoints[0][1]);
      if (
        network.edges[start.edge].roadClass !== 'circuit' ||
        Math.hypot(start.x - event.waypoints[0][0], start.z - event.waypoints[0][1]) > 64
      )
        continue;
      const leg = planRoute(network, event.waypoints.slice(0, 2), false)[0];
      if (
        !leg ||
        network.edges[leg.edge].roadClass !== 'circuit' ||
        Math.abs(leg.to - leg.from) < 27
      )
        continue;
      const edge = network.edges[leg.edge],
        station = edge.offset + leg.from;
      if (grids.some((grid) => grid.edge === edge.index && Math.abs(grid.station - station) < 32))
        continue;

      const rectangles: FestivalPaintRectangle[] = [];
      const rectangle = (d0: number, d1: number, l0: number, l1: number) =>
        rectangles.push({ d0, d1, l0, l1 });
      const half = edge.spec.halfWidth - 0.75,
        columns = Math.max(2, Math.round((half * 2) / 0.8) * 2);
      for (let row = 0; row < 2; row++)
        for (let col = 0; col < columns; col++) {
          if ((col + row) % 2 !== 0) continue;
          rectangle(
            row * 0.4,
            (row + 1) * 0.4,
            -half + (col * half * 2) / columns,
            -half + ((col + 1) * half * 2) / columns,
          );
        }
      const centres: { distance: number; lateral: number }[] = [],
        slots = Math.min(4, (event.rivals ?? 0) + 1);
      for (let slot = 0; slot < slots; slot++) {
        const distance = Math.ceil(slots / 2) * 9 + 4 - Math.floor(slot / 2) * 9,
          lateral = (slot % 2 === 0 ? -1 : 1) * Math.min(2.6, edge.spec.halfWidth - 1.7);
        centres.push({ distance, lateral });
        rectangle(distance - 3.05, distance - 2.95, lateral - 1.45, lateral + 1.45);
        rectangle(distance + 2.95, distance + 3.05, lateral - 1.45, lateral + 1.45);
        rectangle(distance - 2.95, distance + 2.95, lateral - 1.45, lateral - 1.35);
        rectangle(distance - 2.95, distance + 2.95, lateral + 1.35, lateral + 1.45);
      }
      const grid = {
        event: event.id,
        edge: edge.index,
        station,
        direction: leg.dir,
        length: Math.max(...rectangles.map((rectangle) => rectangle.d1)),
        centres,
        rectangles,
      };
      grids.push(grid);
      const edgeGrids = this.gridEdges.get(edge.index) ?? [];
      edgeGrids.push(grid);
      this.gridEdges.set(edge.index, edgeGrids);
    }
    this.grids = grids;
  }

  aprons(edge: number): readonly FestivalCircuitApron[] {
    return this.apronEdges.get(edge) ?? EMPTY_APRONS;
  }

  /** Query in the road's forward station/lateral frame, regardless of the
   * race direction. Both red and white apron bands are the paint material. */
  isPaint(
    edgeIndex: number,
    segment: number,
    station: number,
    lateral: number,
    x: number,
    z: number,
  ) {
    const network = this.network,
      edge = network.edges[edgeIndex],
      half = edge.spec.halfWidth,
      absolute = Math.abs(lateral);
    if (edge.roadClass !== 'circuit' || absolute > half) return false;
    const local = station - edge.offset,
      step = FESTIVAL_CIRCUIT_PAINT.lineStep,
      lineStart = Math.floor(local / step) * step;
    if (
      edge.spec.markings === 'edge' &&
      lineStart >= 0 &&
      lineStart < edge.length - step &&
      Math.abs(absolute - (half - FESTIVAL_CIRCUIT_PAINT.edgeInset)) <=
        FESTIVAL_CIRCUIT_PAINT.edgeWidth / 2 &&
      festivalCircuitLineVisible(network, edge, lineStart)
    )
      return true;

    if (absolute >= half - 0.51)
      // Include adjacent quads at a sample boundary: their offset edges
      // can project just across the nearest centreline segment's endpoint.
      for (
        let i = Math.max(edge.first, segment - 1);
        i <= Math.min(edge.last - 1, segment + 1);
        i++
      ) {
        const footprint = this.apronFootprints.get(i);
        if (footprint && contains(footprint, x, z)) return true;
      }

    for (const grid of this.gridEdges.get(edgeIndex) ?? EMPTY_GRIDS) {
      const d = (station - grid.station) * grid.direction,
        l = lateral * grid.direction;
      if (d < 0 || d > grid.length) continue;
      for (const rectangle of grid.rectangles)
        if (d >= rectangle.d0 && d <= rectangle.d1 && l >= rectangle.l0 && l <= rectangle.l1)
          return true;
    }
    return false;
  }
}

const layouts = new WeakMap<RoadNetwork, FestivalMarkings>();

export function festivalMarkings(network: RoadNetwork) {
  let layout = layouts.get(network);
  if (!layout) {
    layout = new FestivalMarkings(network);
    layouts.set(network, layout);
  }
  return layout;
}
