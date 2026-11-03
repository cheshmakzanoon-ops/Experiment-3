import { catmull } from '../simulation/track.ts';
import {
  circuitDefinition,
  type CircuitDefinition,
  type CircuitId,
} from '../simulation/circuits.ts';
import { offroadCourse } from '../simulation/offroad/venues.ts';
import { SOLVANE, type RegionDefinition, type RoadSpec } from '../simulation/open-world/region-data.ts';
import { worldToMap, MAP_SIZE } from './festival-map.ts';
import { mod } from '../core/math.ts';

/** Line art for the menu, drawn from the same data the game races on:
 * the closed Catmull-Rom of `CircuitDefinition.design` (the curve `Track`
 * samples), the authored corner and DRS stations, a terrain venue's jump
 * survey, and the festival region's road network. Nothing here is hand-drawn.
 *
 * Orientation matches the in-race minimap (north up, +x right) for circuits
 * and the festival world map (`festival-map.ts`) for the region. */
export const ART_VIEW = Object.freeze({ width: 200, height: 150, pad: 14 });

export interface ArtPoint {
  x: number;
  y: number;
}
export interface ArtCorner extends ArtPoint {
  n: number;
  name: string;
}
export interface CircuitArt {
  id: string;
  /** Closed centreline path (SVG user units, ART_VIEW box). */
  d: string;
  /** Lap length (m) of the sampled curve; equals `Track.length`. */
  length: number;
  /** Start/finish tick: centre and direction of travel (rad, SVG space). */
  start: ArtPoint & { angle: number };
  corners: ArtCorner[];
  /** One open path per DRS activation zone. */
  drs: string[];
  /** Jump take-offs (terrain venues with a surveyed course). */
  jumps: ArtPoint[];
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The lap polyline exactly as `Track` builds it (chord length included). */
function sampleCentreline(def: CircuitDefinition) {
  const design = def.design,
    n = design.length,
    count = def.samples ?? 1536;
  const xs = new Float64Array(count),
    zs = new Float64Array(count),
    s = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) {
    const t = (i / count) * n,
      k = Math.floor(t),
      f = t - k;
    const a = design[mod(k - 1, n)],
      b = design[mod(k, n)],
      c = design[mod(k + 1, n)],
      d = design[mod(k + 2, n)];
    xs[i] = catmull(a[0], b[0], c[0], d[0], f);
    zs[i] = catmull(a[1], b[1], c[1], d[1], f);
    if (i) s[i] = s[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  }
  // The closing chord back to the first sample completes the lap.
  s[count] = s[count - 1] + Math.hypot(xs[0] - xs[count - 1], zs[0] - zs[count - 1]);
  return { xs, zs, s, count, length: s[count] };
}
/** Sample index whose station is nearest `station` (m, wraps through the line). */
function indexAt(s: Float64Array, count: number, length: number, station: number) {
  const target = mod(station, length);
  let lo = 0,
    hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const cache = new Map<string, CircuitArt>();
/** Line art for one circuit, cached per id (the data is static). */
export function circuitArt(id: CircuitId | CircuitDefinition): CircuitArt {
  const def = typeof id === 'string' ? circuitDefinition(id) : id;
  const hit = cache.get(def.id);
  if (hit) return hit;
  const { xs, zs, s, count, length } = sampleCentreline(def);
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    minX = Math.min(minX, xs[i]);
    maxX = Math.max(maxX, xs[i]);
    minZ = Math.min(minZ, zs[i]);
    maxZ = Math.max(maxZ, zs[i]);
  }
  const { width, height, pad } = ART_VIEW;
  const k = Math.min(
    (width - 2 * pad) / Math.max(1, maxX - minX),
    (height - 2 * pad) / Math.max(1, maxZ - minZ),
  );
  const cx = (minX + maxX) / 2,
    cz = (minZ + maxZ) / 2;
  const X = (x: number) => width / 2 + (x - cx) * k,
    Y = (z: number) => height / 2 - (z - cz) * k;
  const step = Math.max(1, Math.ceil(count / 260));
  const parts: string[] = [];
  for (let i = 0; i < count; i += step) parts.push(`${fmt(X(xs[i]))},${fmt(Y(zs[i]))}`);
  const d = `M${parts.join('L')}Z`;
  const at = (station: number) => {
    const i = indexAt(s, count, length, station);
    return { i, x: X(xs[i]), y: Y(zs[i]) };
  };
  // Direction of travel on screen at a sample, from its neighbours.
  const heading = (i: number) => {
    const a = mod(i - 3, count),
      b = (i + 3) % count;
    return Math.atan2(Y(zs[b]) - Y(zs[a]), X(xs[b]) - X(xs[a]));
  };
  const start = { x: X(xs[0]), y: Y(zs[0]), angle: heading(0) };
  const corners: ArtCorner[] = def.corners.map((corner, index) => {
    const p = at(corner.s);
    // Put the number on the outside of the bend, away from the turn centre.
    const a = mod(p.i - 10, count),
      b = (p.i + 10) % count;
    const h1 = Math.atan2(Y(zs[p.i]) - Y(zs[a]), X(xs[p.i]) - X(xs[a])),
      h2 = Math.atan2(Y(zs[b]) - Y(zs[p.i]), X(xs[b]) - X(xs[p.i]));
    const turn = Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1));
    const mid = heading(p.i),
      side = turn >= 0 ? -1 : 1; // SVG y points down: positive turn is clockwise
    const off = 7.5;
    return {
      n: index + 1,
      name: corner.name,
      x: p.x + Math.cos(mid + (side * Math.PI) / 2) * off,
      y: p.y + Math.sin(mid + (side * Math.PI) / 2) * off,
    };
  });
  const drs = def.drsZones.map((zone) => {
    const from = indexAt(s, count, length, zone.start);
    let to = indexAt(s, count, length, zone.end);
    if (to <= from) to += count;
    const pts: string[] = [];
    for (let i = from; i <= to; i += Math.max(1, Math.floor(step / 2)))
      pts.push(`${fmt(X(xs[i % count]))},${fmt(Y(zs[i % count]))}`);
    return `M${pts.join('L')}`;
  });
  const jumps: ArtPoint[] = [];
  const course = offroadCourse(def);
  if (course) for (const jump of course.jumps) jumps.push(at(jump.takeoff));
  const art: CircuitArt = { id: def.id, d, length, start, corners, drs, jumps };
  cache.set(def.id, art);
  return art;
}

/** Inline SVG for a circuit (decorative unless `label` is given). Colours come
 * from CSS (`.ta-road`, `.ta-line`, `.ta-drs`, `.ta-start`, `.ta-num`), so the
 * art follows the discipline tint and the high-contrast setting. */
export function circuitArtSvg(
  id: CircuitId | CircuitDefinition,
  options: { numbers?: boolean; label?: string; className?: string } = {},
) {
  const art = circuitArt(id),
    { width, height } = ART_VIEW;
  const numbers = options.numbers !== false && art.corners.length > 0 && art.corners.length <= 22;
  const a = art.start.angle,
    nx = -Math.sin(a) * 6.5,
    ny = Math.cos(a) * 6.5;
  const tick = `<path class="ta-start" d="M${fmt(art.start.x - nx)},${fmt(art.start.y - ny)}L${fmt(art.start.x + nx)},${fmt(art.start.y + ny)}"/>`;
  const markers = numbers
    ? `<g class="ta-corners">${art.corners
        .map(
          (c) =>
            `<g transform="translate(${fmt(c.x)} ${fmt(c.y)})"><circle class="ta-bead" r="4.3"/><text class="ta-num" y="1.6" text-anchor="middle">${c.n}</text></g>`,
        )
        .join('')}</g>`
    : '';
  const jumps = art.jumps.length
    ? `<g class="ta-jumps">${art.jumps.map((j) => `<path class="ta-jump" d="M${fmt(j.x - 2.6)},${fmt(j.y)}L${fmt(j.x)},${fmt(j.y - 2.6)}L${fmt(j.x + 2.6)},${fmt(j.y)}L${fmt(j.x)},${fmt(j.y + 2.6)}Z"/>`).join('')}</g>`
    : '';
  const aria = options.label
    ? `role="img" aria-label="${escape(options.label)}"`
    : 'aria-hidden="true"';
  return `<svg class="${options.className ?? 'ta'}" viewBox="0 0 ${width} ${height}" ${aria} focusable="false"><path class="ta-road" d="${art.d}"/><path class="ta-line" d="${art.d}"/>${art.drs.map((d) => `<path class="ta-drs" d="${d}"/>`).join('')}${jumps}${tick}${markers}</svg>`;
}

/** Road weights for the region map (view units): the network reads as a
 * hierarchy, motorway down to track, as on a printed road atlas. */
const ROAD_WEIGHT: Readonly<Record<RoadSpec['roadClass'], number>> = Object.freeze({
  highway: 2.1,
  country: 1.5,
  mountain: 1.3,
  town: 0.8,
  dirt: 0.9,
  runway: 3.2,
  circuit: 1.4,
});
const regionCache = new Map<string, string>();
/** The festival region as a road-atlas sheet: every road, the coast, the event
 * start markers. Orientation and scale come from `festival-map.ts`. */
export function regionArtSvg(region: RegionDefinition = SOLVANE, label?: string) {
  const key = `${region.id}:${region.version}:${label ?? ''}`;
  const hit = regionCache.get(key);
  if (hit) return hit;
  // The region is a square: its own square view, nearly edge to edge.
  const width = 160,
    height = 160,
    pad = 6;
  // Fit the drivable square (not the far coastline) into the view.
  const half = region.half;
  const side = Math.min(width - 2 * pad, height - 2 * pad);
  const k = side / (2 * half);
  const [ox, oy] = worldToMap(0, 0);
  const scale = (2 * 4400) / MAP_SIZE; // map pixel -> metres, as festival-map.ts
  const P = (x: number, z: number) => {
    const [mx, my] = worldToMap(x, z);
    return [width / 2 + (mx - ox) * scale * k, height / 2 + (my - oy) * scale * k] as const;
  };
  const path = (points: readonly (readonly [number, number])[], closed: boolean) => {
    const n = points.length,
      out: string[] = [];
    const steps = 8;
    const last = closed ? n : n - 1;
    for (let i = 0; i < last; i++)
      for (let j = 0; j < steps; j++) {
        const f = j / steps;
        const a = points[closed ? mod(i - 1, n) : Math.max(0, i - 1)],
          b = points[i],
          c = points[closed ? (i + 1) % n : i + 1],
          d = points[closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
        const [px, py] = P(
          catmull(a[0], b[0], c[0], d[0], f),
          catmull(a[1], b[1], c[1], d[1], f),
        );
        out.push(`${fmt(px)},${fmt(py)}`);
      }
    const [ex, ey] = P(points[closed ? 0 : n - 1][0], points[closed ? 0 : n - 1][1]);
    out.push(`${fmt(ex)},${fmt(ey)}`);
    return `M${out.join('L')}${closed ? 'Z' : ''}`;
  };
  const roads = region.roads
    .map(
      (road) =>
        `<path class="ta-rd" data-class="${road.roadClass}" stroke-width="${ROAD_WEIGHT[road.roadClass]}" d="${path(road.points, !!road.closed)}"/>`,
    )
    .join('');
  // Sea: the water south of the coastline, clipped to the square.
  const clampX = (x: number) => Math.max(-half, Math.min(half, x));
  const shore = region.coast.map((p) => P(clampX(p[0]), Math.max(-half, p[1])));
  const pts = (list: readonly (readonly [number, number])[]) =>
    list.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join('L');
  const sea = `M${pts([...shore, P(half, -half), P(-half, -half)])}Z`;
  const coastLine = `M${pts(shore)}`;
  const events = region.events
    .map((e) => {
      const [x, y] = P(e.waypoints[0][0], e.waypoints[0][1]);
      return `<rect class="ta-event" data-kind="${e.kind}" x="${fmt(x - 2)}" y="${fmt(y - 2)}" width="4" height="4"/>`;
    })
    .join('');
  const [fx, fy] = P(-half, half),
    [gx, gy] = P(half, -half);
  const frame = `<rect class="ta-frame" x="${fmt(Math.min(fx, gx))}" y="${fmt(Math.min(fy, gy))}" width="${fmt(Math.abs(gx - fx))}" height="${fmt(Math.abs(gy - fy))}"/>`;
  const aria = label ? `role="img" aria-label="${escape(label)}"` : 'aria-hidden="true"';
  const svg = `<svg class="ta ta-region" viewBox="0 0 ${width} ${height}" ${aria} focusable="false">${frame}<path class="ta-sea" d="${sea}"/><path class="ta-coast" d="${coastLine}"/>${roads}${events}</svg>`;
  regionCache.set(key, svg);
  return svg;
}
