import { smoothstep } from './noise.ts';
import { clamp } from '../../core/math.ts';
import { snapToNetwork } from './route-path.ts';
import type { RoadEdge, RoadNetwork } from './road-network.ts';
import type { FestivalPaintLine } from './festival-markings.ts';
import type { XZ } from './region-data.ts';

/** A horizontal slice of a painted numeral. Lateral edges vary linearly
 * across the slice; the same four corners are used for tread contact and drawing. */
export interface RunwayGlyphBand {
  from: number;
  to: number;
  left0: number;
  right0: number;
  left1: number;
  right1: number;
}
export interface AirfieldSection {
  strip: { from: number; to: number } | null;
  lines: FestivalPaintLine[];
  glyphs: RunwayGlyphBand[];
}
const DIGIT_START = 43,
  DIGIT_LENGTH = 11;
type Polygon = readonly XZ[];
const box = (x0: number, y0: number, x1: number, y1: number): Polygon => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const outline: Polygon = [
  [0.16, 0],
  [0.84, 0],
  [1, 0.1],
  [1, 0.9],
  [0.84, 1],
  [0.16, 1],
  [0, 0.9],
  [0, 0.1],
];
const upper = box(0.24, 0.57, 0.76, 0.84),
  lower = box(0.24, 0.16, 0.76, 0.43);
/** Block numerals drawn for the Kestrel tarmac. Each counter is an actual
 * hole, and the seven and two carry a continuous diagonal stroke. */
const NUMERALS: Readonly<Record<string, readonly Polygon[]>> = {
  '0': [outline, box(0.24, 0.16, 0.76, 0.84)],
  '1': [
    [
      [0.4, 0],
      [0.66, 0],
      [0.66, 1],
      [0.43, 1],
      [0.17, 0.84],
      [0.17, 0.66],
      [0.4, 0.79],
    ],
  ],
  '2': [
    [
      [0, 0],
      [1, 0],
      [1, 0.16],
      [0.27, 0.16],
      [0.27, 0.27],
      [1, 0.64],
      [1, 0.9],
      [0.84, 1],
      [0.16, 1],
      [0, 0.9],
      [0, 0.7],
      [0.24, 0.7],
      [0.24, 0.84],
      [0.76, 0.84],
      [0.76, 0.71],
      [0, 0.33],
    ],
  ],
  '3': [
    [
      [0.12, 0],
      [0.83, 0],
      [1, 0.1],
      [1, 0.43],
      [0.84, 0.5],
      [1, 0.57],
      [1, 0.9],
      [0.84, 1],
      [0.14, 1],
      [0, 0.9],
      [0, 0.75],
      [0.24, 0.75],
      [0.24, 0.84],
      [0.76, 0.84],
      [0.76, 0.58],
      [0.35, 0.58],
      [0.35, 0.42],
      [0.76, 0.42],
      [0.76, 0.16],
      [0.24, 0.16],
      [0.24, 0.25],
      [0, 0.25],
      [0, 0.1],
    ],
  ],
  '4': [
    [
      [0.64, 0],
      [0.88, 0],
      [0.88, 0.28],
      [1, 0.28],
      [1, 0.44],
      [0.88, 0.44],
      [0.88, 1],
      [0.57, 1],
      [0, 0.44],
      [0, 0.28],
      [0.64, 0.28],
    ],
    [
      [0.23, 0.44],
      [0.64, 0.44],
      [0.64, 0.84],
    ],
  ],
  '5': [
    [
      [0.16, 0],
      [0.84, 0],
      [1, 0.1],
      [1, 0.48],
      [0.84, 0.58],
      [0.25, 0.58],
      [0.25, 0.84],
      [1, 0.84],
      [1, 1],
      [0, 1],
      [0, 0.42],
      [0.75, 0.42],
      [0.75, 0.16],
      [0.24, 0.16],
      [0.24, 0.25],
      [0, 0.25],
      [0, 0.1],
    ],
  ],
  '6': [
    [
      [0.16, 0],
      [0.84, 0],
      [1, 0.1],
      [1, 0.48],
      [0.84, 0.58],
      [0.24, 0.58],
      [0.24, 0.84],
      [0.82, 0.84],
      [0.82, 1],
      [0.16, 1],
      [0, 0.9],
      [0, 0.1],
    ],
    lower,
  ],
  '7': [
    [
      [0.18, 0],
      [0.45, 0],
      [1, 0.84],
      [1, 1],
      [0, 1],
      [0, 0.84],
      [0.73, 0.84],
    ],
  ],
  '8': [outline, lower, upper],
  '9': [
    [
      [0.16, 0],
      [0.84, 0],
      [1, 0.1],
      [1, 0.9],
      [0.84, 1],
      [0.16, 1],
      [0, 0.9],
      [0, 0.52],
      [0.16, 0.42],
      [0.76, 0.42],
      [0.76, 0.16],
      [0.16, 0.16],
    ],
    upper,
  ],
};
function digitBands(label: string, station: number, direction: number) {
  const bands: RunwayGlyphBand[] = [];
  const digitWidth = 3.55,
    spacing = 1.08,
    digitLength = DIGIT_LENGTH;
  for (const [index, digit] of [...label].entries()) {
    const contours = NUMERALS[digit];
    if (!contours) continue;
    const ys = [...new Set(contours.flatMap((c) => c.map((p) => p[1])))].sort((a, b) => a - b);
    const across = (x: number) =>
      -direction *
      ((index - (label.length - 1) / 2) * (digitWidth + spacing) + (x - 0.5) * digitWidth);
    for (let row = 0; row + 1 < ys.length; row++) {
      const y0 = ys[row],
        y1 = ys[row + 1],
        mid = (y0 + y1) / 2;
      const cuts: { a: number; b: number }[] = [];
      for (const contour of contours)
        for (let i = 0; i < contour.length; i++) {
          const a = contour[i],
            b = contour[(i + 1) % contour.length];
          if (mid <= Math.min(a[1], b[1]) || mid >= Math.max(a[1], b[1])) continue;
          const x = (y: number) => across(a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]));
          cuts.push({ a: x(y0), b: x(y1) });
        }
      cuts.sort((p, q) => p.a + p.b - q.a - q.b);
      for (let i = 0; i + 1 < cuts.length; i += 2) {
        const l = cuts[i],
          r = cuts[i + 1];
        if (direction > 0)
          bands.push({
            from: station + y0 * digitLength,
            to: station + y1 * digitLength,
            left0: l.a,
            right0: r.a,
            left1: l.b,
            right1: r.b,
          });
        else
          bands.push({
            from: station - y1 * digitLength,
            to: station - y0 * digitLength,
            left0: l.b,
            right0: r.b,
            left1: l.a,
            right1: r.a,
          });
      }
    }
  }
  return bands;
}

/** Resolve the two declared thresholds onto the actual spline. Only the long
 * straight between them receives landing aids. The return loop is taxiway. */
export function airfieldSection(network: RoadNetwork, edge: RoadEdge): AirfieldSection | null {
  const spec = edge.road.landingStrip;
  if (!spec) return null;
  const a = snapToNetwork(network, ...spec.ends[0]),
    b = snapToNetwork(network, ...spec.ends[1]);
  const strip =
    a.edge === edge.index && b.edge === edge.index
      ? { from: Math.min(a.s, b.s), to: Math.max(a.s, b.s) }
      : null;
  const half = edge.spec.halfWidth;
  const lines: FestivalPaintLine[] = [],
    glyphs: RunwayGlyphBand[] = [];
  const line = (
    lateral: number,
    width: number,
    from: number,
    to: number,
    layer: FestivalPaintLine['layer'] = 'paint',
    dash = 0,
    period = 0,
  ) => {
    if (to > from) lines.push({ lateral, width, from, to, layer, dash, period });
  };
  const taxi = (from: number, to: number) => {
    line(0, 0.18, from, to, 'yellow');
    for (const sign of [-1, 1]) line(sign * (half - 0.7), 0.16, from, to, 'yellow');
  };
  const mouth = half + 9;
  const start = network.nodes[edge.from].edges.length >= 3 ? mouth : 0;
  const end = edge.length - (network.nodes[edge.to].edges.length >= 3 ? mouth : 0);
  if (!strip) {
    taxi(start, end);
    return { strip, lines, glyphs };
  }
  taxi(start, strip.from);
  taxi(strip.to, end);
  for (const side of [-1, 1]) line(side * (half - 0.65), 0.45, strip.from, strip.to);
  line(0, 0.75, strip.from + 77, strip.to - 77, 'paint', 25, 48);
  for (const [threshold, direction, number] of [
    [a.s, Math.sign(b.s - a.s), spec.numbers[0]],
    [b.s, Math.sign(a.s - b.s), spec.numbers[1]],
  ] as const) {
    const mark = (lateral: number, width: number, lo: number, hi: number) => {
      const first = threshold + direction * lo,
        last = threshold + direction * hi;
      line(lateral, width, Math.min(first, last), Math.max(first, last));
    };
    for (const side of [-1, 1]) {
      for (let key = 1; key <= 6; key++) mark(side * key * 1.88, 1.1, 4, 31);
      for (const distance of [145, 435])
        for (const offset of [7.3, 9.15]) mark(side * offset, 1.05, distance, distance + 18);
      mark(side * 8.15, 3.5, 287, 315);
    }
    glyphs.push(...digitBands(number, threshold + direction * DIGIT_START, direction));
  }
  return { strip, lines, glyphs };
}

/** Clip both sloping sides and both ends against the steered tread segment.
 * Each half-plane is linear in its parameter t in [-1,1]. */
export function glyphCoverage(b: RunwayGlyphBand, s: number, l: number, ds: number, dl: number) {
  const reach = Math.abs(ds);
  if (s + reach < b.from || s - reach > b.to) return 0;
  const span = b.to - b.from,
    left = (b.left1 - b.left0) / span,
    right = (b.right1 - b.right0) / span;
  let lo = -1,
    hi = 1;
  const clip = (value: number, rate: number) => {
    if (Math.abs(rate) < 1e-10) {
      if (value < 0) hi = -2;
    } else if (rate > 0) lo = Math.max(lo, -value / rate);
    else hi = Math.min(hi, -value / rate);
  };
  clip(s - b.from, ds);
  clip(b.to - s, -ds);
  clip(l - b.left0 - left * (s - b.from), dl - left * ds);
  clip(b.right0 + right * (s - b.from) - l, right * ds - dl);
  return clamp((hi - lo) * 0.5, 0, 1);
}

export function airfieldGlyphCoverage(
  section: AirfieldSection | null,
  s: number,
  l: number,
  ds: number,
  dl: number,
) {
  const strip = section?.strip;
  if (!section || !strip) return 0;
  const near = Math.min(s - strip.from, strip.to - s);
  if (near + Math.abs(ds) < DIGIT_START || near - Math.abs(ds) > DIGIT_START + DIGIT_LENGTH)
    return 0;
  let coverage = 0;
  for (const band of section.glyphs) coverage += glyphCoverage(band, s, l, ds, dl);
  return clamp(coverage, 0, 1);
}

/** Broad deposits from repeated main-gear contact, in metres from either end.
 * Surface presentation adds fine streaks inside this same envelope. */
export const RUNWAY_RUBBER = Object.freeze({
  start: 58,
  full: 150,
  fade: 360,
  end: 585,
  inner: 2.75,
  outer: 5.15,
  core: 0.3,
  edge: 1.28,
  coverage: 0.36,
});
export function runwayRubber(distance: number, lateral: number) {
  const r = RUNWAY_RUBBER;
  if (distance <= r.start || distance >= r.end) return 0;
  const envelope =
    smoothstep(r.start, r.full, distance) * (1 - smoothstep(r.fade, r.end, distance));
  const x = Math.abs(lateral);
  const wheel = Math.min(Math.abs(x - r.inner), Math.abs(x - r.outer));
  return envelope * (1 - smoothstep(r.core, r.edge, wheel));
}
