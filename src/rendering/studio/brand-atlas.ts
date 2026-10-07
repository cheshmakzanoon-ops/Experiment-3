import * as T from 'three';

/**
 * Brand atlas (D06 vehicle-paint, producer decision P13/P19): the one shared
 * source of fictional sponsor marks for cars, tyres, crew kit and trackside art.
 *
 * Every mark is drawn with canvas paths from the geometric stroke font below,
 * never with a system font: output is identical on every machine, needs no font
 * loading, and contains no real-world wordmark or logo. Only names in `BRANDS`
 * (or invented names added to this file) may appear in textures.
 *
 * Glyphs are centre-line polylines in a unit box (x 0..1 across the advance,
 * y 0 baseline .. 1 cap height). They are stroked at `weight` x cap height with
 * square caps, corners filleted with `arcTo` (per-vertex factor, 0 = sharp), and
 * clipped to their advance box, which gives the flat-cut terminals of a modern
 * squared racing face. Nothing here reads time or randomness.
 */
export const BRANDS = Object.freeze([
  'VOLTEX',
  'NORDFIN',
  'KESTREL TIME',
  'HALCYON AIR',
  'ORBITEL',
  'MERIDIAN OIL',
  'AUREL BANK',
  'VANTA',
  'NORTHLINE',
  'OBSIDIAN',
  'APEX CORSA',
  'SLICK 18',
] as const);
export type Brand = (typeof BRANDS)[number];

type Vertex = readonly [number, number] | readonly [number, number, number];
interface Glyph {
  /** Advance width in cap heights (before the width scale). */
  readonly a: number;
  readonly s: readonly (readonly Vertex[])[];
}
const RING = '.5,0 0,0 0,1 1,1 1,0 .5,0';
/**
 * The glyph table: advance width, then strokes separated by `|`, each a list of
 * `x,y` vertices in the unit box. A `!` after a vertex makes that corner sharp
 * (no fillet). Coordinates slightly outside 0..1 run into the clip box, which
 * cuts diagonal terminals flat.
 */
const GLYPH_SOURCE: Readonly<Record<string, readonly [number, string]>> = {
  A: [0.68, '0,0 .34,1! .66,1! 1,0 | .08,.3 .92,.3'],
  B: [0.64, '0,0 0,1! .8,1 .8,.54 0,.54! | 0,.54 1,.54 1,0 0,0!'],
  C: [0.62, '1,1 0,1 0,0 1,0'],
  D: [0.66, '0,0 0,1! 1,1 1,0 0,0'],
  E: [0.58, '1,1 0,1! 0,0! 1,0 | 0,.52 .84,.52'],
  F: [0.56, '1,1 0,1! 0,0 | 0,.5 .84,.5'],
  G: [0.64, '1,1 0,1 0,0 1,0 1,.48! .5,.48'],
  H: [0.66, '0,0 0,1 | 1,0 1,1 | 0,.52 1,.52'],
  I: [0.24, '.5,0 .5,1'],
  J: [0.58, '1,1 1,0 0,0 0,.34'],
  K: [0.64, '0,0 0,1 | 1.04,1 0,.38 | .4,.62 1.04,0'],
  L: [0.54, '0,1 0,0! 1,0'],
  M: [0.84, '0,0 0,1! .5,.4! 1,1! 1,0'],
  N: [0.7, '0,0 0,1! 1,0! 1,1'],
  O: [0.68, RING],
  P: [0.62, '0,0 0,1! 1,1 1,.46 0,.46!'],
  Q: [0.68, `${RING} | .58,.3 1.06,-.04`],
  R: [0.64, '0,0 0,1! 1,1 1,.48 0,.48! | .5,.48 1.04,0'],
  S: [0.62, '1,1 0,1 0,.52 1,.52 1,0 0,0'],
  T: [0.62, '0,1 1,1 | .5,1 .5,0'],
  U: [0.66, '0,1 0,0 1,0 1,1'],
  V: [0.68, '0,1.04 .42,0! .58,0! 1,1.04'],
  W: [0.96, '0,1.04 .2,0! .5,.64! .8,0! 1,1.04'],
  X: [0.66, '-.02,0 1.02,1 | -.02,1 1.02,0'],
  Y: [0.66, '-.02,1.04 .5,.46! 1.02,1.04 | .5,.46 .5,0'],
  Z: [0.62, '0,1 1,1! 0,0! 1,0'],
  '0': [0.64, RING],
  '1': [0.42, '0,.76 .64,1! .64,0'],
  '2': [0.62, '0,1 1,1 1,.52 0,.52 0,0! 1,0'],
  '3': [0.62, '0,1 1,1 1,0 0,0 | .28,.52 1,.52'],
  '4': [0.64, '.74,0 .74,1! 0,.32! 1,.32'],
  '5': [0.62, '1,1 0,1! 0,.56! 1,.56 1,0 0,0'],
  '6': [0.62, '1,1 0,1 0,0 1,0 1,.56 0,.56'],
  '7': [0.58, '0,1 1,1! .32,0'],
  '8': [0.64, `${RING} | 0,.53 1,.53`],
  '9': [0.62, '0,0 1,0 1,1 0,1 0,.44 1,.44'],
  ' ': [0.34, ''],
  '.': [0.24, '.5,0 .5,.02'],
  '-': [0.46, '0,.5 1,.5'],
  '/': [0.46, '0,-.02 1,1.02'],
};
function parseGlyph([a, source]: readonly [number, string]): Glyph {
  const strokes = source
    .split('|')
    .map((stroke) => stroke.trim())
    .filter(Boolean)
    .map((stroke) =>
      stroke.split(/\s+/).map((vertex): Vertex => {
        const sharp = vertex.endsWith('!');
        const [x, y] = vertex.replace('!', '').split(',').map(Number);
        if (!Number.isFinite(x) || !Number.isFinite(y))
          throw new Error(`Bad glyph vertex ${vertex}`);
        return sharp ? [x, y, 0] : [x, y];
      }),
    );
  return { a, s: strokes };
}
const GLYPHS: Readonly<Record<string, Glyph>> = Object.freeze(
  Object.fromEntries(Object.entries(GLYPH_SOURCE).map(([c, g]) => [c, parseGlyph(g)])),
);
/** Characters the stroke font draws; anything else is drawn as a space. */
export const BRAND_FONT_CHARACTERS = Object.freeze(Object.keys(GLYPHS).join(''));

export interface WordmarkStyle {
  /** Stroke weight in cap heights (0.08 hairline .. 0.24 black). */
  weight?: number;
  /** Horizontal scale of every advance (0.8 condensed .. 1.4 extended). */
  width?: number;
  /** Extra space between glyphs, in cap heights. */
  tracking?: number;
  /** Forward lean as a shear (0.2 is about 11 degrees). */
  slant?: number;
  /** Corner fillet radius in cap heights. */
  corner?: number;
}
const DEFAULT_STYLE: Required<WordmarkStyle> = {
  weight: 0.17,
  width: 1,
  tracking: 0.12,
  slant: 0,
  corner: 0.2,
};
function resolve(style?: WordmarkStyle): Required<WordmarkStyle> {
  const s = { ...DEFAULT_STYLE, ...style };
  if (
    !Object.values(s).every(Number.isFinite) ||
    s.weight <= 0 ||
    s.weight > 0.4 ||
    s.width <= 0 ||
    s.corner < 0
  )
    throw new Error('Invalid wordmark style');
  return s;
}
function glyph(character: string) {
  return GLYPHS[character] ?? GLYPHS[' '];
}
/** Width in pixels of `text` at cap height `height` (no slant overhang). */
export function wordmarkWidth(text: string, height: number, style?: WordmarkStyle) {
  const s = resolve(style);
  const chars = [...text.toUpperCase()];
  if (!chars.length) return 0;
  let width = 0;
  for (const c of chars) width += glyph(c).a * s.width * height;
  return width + (chars.length - 1) * s.tracking * height;
}

/**
 * Draw `text` with its cap box from y - height/2 to y + height/2 (vertically
 * centred on `y`), horizontally aligned on `x`. Uses the context's current
 * strokeStyle. Returns the drawn width.
 */
export function drawWordmark(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  height: number,
  style?: WordmarkStyle,
  align: 'left' | 'center' | 'right' = 'center',
) {
  if (![x, y, height].every(Number.isFinite) || height <= 0)
    throw new Error('Invalid wordmark placement');
  const s = resolve(style);
  const chars = [...text.toUpperCase()];
  const total = wordmarkWidth(text, height, s);
  let pen = align === 'left' ? 0 : align === 'right' ? -total : -total / 2;
  const w = s.weight * height;
  context.save();
  context.translate(x, y + height / 2);
  if (s.slant) context.transform(1, 0, -s.slant, 1, 0, 0);
  context.lineWidth = w;
  context.lineCap = 'square';
  context.lineJoin = 'miter';
  context.miterLimit = 6;
  for (const c of chars) {
    const g = glyph(c);
    const advance = g.a * s.width * height;
    if (g.s.length) {
      context.save();
      context.beginPath();
      context.rect(pen, -height, advance, height);
      context.clip();
      context.beginPath();
      const px = (u: number) => pen + w / 2 + u * Math.max(0, advance - w);
      const py = (v: number) => -(w / 2 + v * (height - w));
      for (const stroke of g.s) {
        const points = stroke.map(([u, v, r = 1]) => [px(u), py(v), r] as const);
        context.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length - 1; i++) {
          const [cx, cy, factor] = points[i];
          const [ax, ay] = points[i - 1];
          const [bx, by] = points[i + 1];
          const span = Math.min(Math.hypot(cx - ax, cy - ay), Math.hypot(bx - cx, by - cy));
          const radius = Math.min(factor * s.corner * height, span * 0.5);
          if (radius > 0.01) context.arcTo(cx, cy, bx, by, radius);
          else context.lineTo(cx, cy);
        }
        const last = points[points.length - 1];
        context.lineTo(last[0], last[1]);
      }
      context.stroke();
      context.restore();
    }
    pen += advance + s.tracking * height;
  }
  context.restore();
  return total;
}
/** Largest cap height (<= maxHeight) at which `text` fits `maxWidth`. */
export function fitHeight(
  text: string,
  maxWidth: number,
  maxHeight: number,
  style?: WordmarkStyle,
) {
  const unit = wordmarkWidth(text, 1, style) + Math.abs(resolve(style).slant);
  return unit > 0 ? Math.min(maxHeight, maxWidth / unit) : maxHeight;
}

export type MarkKind =
  | 'wordmark'
  | 'two-line'
  | 'oval'
  | 'oval-fill'
  | 'roundel'
  | 'shield'
  | 'orbit'
  | 'kestrel'
  | 'boxed';
/** One original mark: what to draw and in which colours. */
export interface MarkArt {
  kind: MarkKind;
  /** Text lines (one for wordmarks; two for stacked marks). */
  lines: readonly string[];
  /** Main ink colour (CSS). */
  ink: string;
  /** Secondary ink: accent letter, outline or emblem trim. */
  accent?: string;
  /** Badge fill behind the ink (ovals, shields, boxes). */
  fill?: string;
  style?: WordmarkStyle;
  /** Index of a letter drawn in the accent colour (wordmarks only). */
  accentLetter?: number;
}

/** House style of each canonical brand, so every department draws it alike. */
export const BRAND_ART: Readonly<Record<Brand, MarkArt>> = Object.freeze({
  VOLTEX: {
    kind: 'wordmark',
    lines: ['VOLTEX'],
    ink: '#ffffff',
    accent: '#f5c400',
    accentLetter: 5,
    style: { weight: 0.2, width: 1.18, slant: 0.2, tracking: 0.1 },
  },
  NORDFIN: {
    kind: 'wordmark',
    lines: ['NORDFIN'],
    ink: '#ffffff',
    style: { weight: 0.16, width: 0.96, tracking: 0.14, corner: 0.26 },
  },
  'KESTREL TIME': {
    kind: 'two-line',
    lines: ['KESTREL', 'TIME'],
    ink: '#ffffff',
    style: { weight: 0.15, width: 0.9, tracking: 0.16 },
  },
  'HALCYON AIR': {
    kind: 'wordmark',
    lines: ['HALCYON AIR'],
    ink: '#ffffff',
    style: { weight: 0.14, width: 1.04, slant: 0.12, tracking: 0.12 },
  },
  ORBITEL: {
    kind: 'wordmark',
    lines: ['ORBITEL'],
    ink: '#ffffff',
    style: { weight: 0.15, width: 1.08, tracking: 0.16, corner: 0.34 },
  },
  'MERIDIAN OIL': {
    kind: 'boxed',
    lines: ['MERIDIAN', 'OIL'],
    ink: '#ffffff',
    accent: '#e8202a',
    style: { weight: 0.19, width: 0.92, tracking: 0.08 },
  },
  'AUREL BANK': {
    kind: 'wordmark',
    lines: ['AUREL BANK'],
    ink: '#ffffff',
    style: { weight: 0.15, width: 1.02, tracking: 0.14 },
  },
  VANTA: {
    kind: 'wordmark',
    lines: ['VANTA'],
    ink: '#ffffff',
    style: { weight: 0.21, width: 1.36, tracking: 0.12, corner: 0.12 },
  },
  NORTHLINE: {
    kind: 'wordmark',
    lines: ['NORTHLINE'],
    ink: '#ffffff',
    style: { weight: 0.12, width: 1.12, tracking: 0.2 },
  },
  OBSIDIAN: {
    kind: 'wordmark',
    lines: ['OBSIDIAN'],
    ink: '#ffffff',
    style: { weight: 0.18, width: 1, tracking: 0.1 },
  },
  'APEX CORSA': {
    kind: 'wordmark',
    lines: ['APEX CORSA'],
    ink: '#ffffff',
    style: { weight: 0.2, width: 1.04, slant: 0.24, tracking: 0.08 },
  },
  'SLICK 18': {
    kind: 'wordmark',
    lines: ['SLICK 18'],
    ink: '#ffffff',
    style: { weight: 0.2, width: 1.06, slant: 0.24, tracking: 0.1 },
  },
});

function ellipse(
  context: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
) {
  context.beginPath();
  context.ellipse(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2);
}
function line(
  context: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  maxHeight: number,
  style: WordmarkStyle | undefined,
  ink: string,
  accent?: string,
  accentLetter?: number,
) {
  const height = fitHeight(text, maxWidth, maxHeight, style);
  context.strokeStyle = ink;
  if (accent === undefined || accentLetter === undefined) {
    drawWordmark(context, text, cx, cy, height, style);
    return height;
  }
  // Draw the run before, the accent letter and the run after at their own pens.
  const chars = [...text];
  const total = wordmarkWidth(text, height, style);
  const tracking = resolve(style).tracking * height;
  let x = cx - total / 2;
  const parts = [
    chars.slice(0, accentLetter).join(''),
    chars[accentLetter] ?? '',
    chars.slice(accentLetter + 1).join(''),
  ];
  parts.forEach((part, i) => {
    if (!part) return;
    context.strokeStyle = i === 1 ? accent : ink;
    const width = drawWordmark(context, part, x, cy, height, style, 'left');
    x += width + tracking;
  });
  return height;
}

/** Draw `art` centred in the box (x, y, width, height), keeping a margin. */
export function drawMark(
  context: CanvasRenderingContext2D,
  art: MarkArt,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0)
    throw new Error('Invalid mark box');
  const cx = x + width / 2,
    cy = y + height / 2;
  const [first = '', second = ''] = art.lines;
  context.save();
  switch (art.kind) {
    case 'wordmark':
      line(
        context,
        first,
        cx,
        cy,
        width * 0.94,
        height * 0.74,
        art.style,
        art.ink,
        art.accent,
        art.accentLetter,
      );
      break;
    case 'two-line': {
      const h = Math.min(height * 0.36, height);
      line(context, first, cx, cy - h * 0.68, width * 0.92, h, art.style, art.ink);
      line(context, second, cx, cy + h * 0.68, width * 0.6, h, art.style, art.accent ?? art.ink);
      break;
    }
    case 'oval':
    case 'oval-fill': {
      const rx = width * 0.47,
        ry = height * 0.45;
      if (art.kind === 'oval-fill') {
        ellipse(context, cx, cy, rx, ry);
        context.fillStyle = art.fill ?? art.accent ?? '#f0b51e';
        context.fill();
      }
      ellipse(context, cx, cy, rx - height * 0.03, ry - height * 0.03);
      context.lineWidth = height * 0.045;
      context.strokeStyle = art.accent ?? art.ink;
      context.stroke();
      line(context, first, cx, cy, rx * 1.5, ry * 0.86, art.style, art.ink);
      break;
    }
    case 'roundel': {
      const r = Math.min(width, height) * 0.46;
      ellipse(context, cx, cy, r, r);
      context.lineWidth = r * 0.035;
      context.strokeStyle = art.accent ?? art.ink;
      context.stroke();
      const h = r * 0.36;
      line(context, first, cx, cy - h * 0.42, width * 0.84, h, art.style, art.ink);
      line(context, second, cx, cy + h * 0.78, r * 1.2, h * 0.7, art.style, art.ink);
      break;
    }
    case 'shield': {
      const w = Math.min(width * 0.92, height * 0.78),
        top = y + height * 0.04,
        bottom = y + height * 0.96;
      const left = cx - w / 2,
        right = cx + w / 2,
        shoulder = top + (bottom - top) * 0.72;
      context.beginPath();
      context.moveTo(left, top);
      context.lineTo(right, top);
      context.lineTo(right, shoulder);
      context.lineTo(cx, bottom);
      context.lineTo(left, shoulder);
      context.closePath();
      context.fillStyle = art.fill ?? '#0d3b33';
      context.fill();
      context.lineWidth = w * 0.03;
      context.strokeStyle = art.accent ?? art.ink;
      context.stroke();
      const h = w * 0.2;
      line(context, first, cx, top + (bottom - top) * 0.28, w * 0.84, h, art.style, art.ink);
      line(context, second, cx, top + (bottom - top) * 0.52, w * 0.6, h, art.style, art.ink);
      break;
    }
    case 'orbit': {
      // A planet inside a tilted orbit: ORBITEL's emblem. The far half of the
      // orbit passes behind the planet; the near half crosses it over a cut gap.
      const r = Math.min(width, height) * 0.27;
      const orbit = (from: number, to: number, lineWidth: number) => {
        context.save();
        context.translate(cx, cy);
        context.rotate(-0.42);
        context.beginPath();
        context.ellipse(0, 0, r * 1.62, r * 0.52, 0, from, to);
        context.lineWidth = lineWidth;
        context.stroke();
        context.restore();
      };
      context.strokeStyle = art.accent ?? art.ink;
      orbit(Math.PI, Math.PI * 2, r * 0.12);
      ellipse(context, cx, cy, r, r);
      context.fillStyle = art.ink;
      context.fill();
      context.globalCompositeOperation = 'destination-out';
      orbit(0, Math.PI, r * 0.3);
      context.globalCompositeOperation = 'source-over';
      orbit(0, Math.PI, r * 0.12);
      ellipse(context, cx + r * 1.2, cy - r * 0.95, r * 0.15, r * 0.15);
      context.fillStyle = art.accent ?? art.ink;
      context.fill();
      break;
    }
    case 'kestrel': {
      // A swept falcon wing in three feathers, trimmed: KESTREL's emblem.
      const s = Math.min(width / 2.6, height);
      const ox = cx - s * 1.3,
        oy = cy - s * 0.5;
      const P = (u: number, v: number) => [ox + u * s, oy + v * s] as const;
      const feathers = [
        [P(0.02, 0.86), P(1.02, 0.12), P(2.58, 0.02), P(1.44, 0.4), P(0.6, 0.94)],
        [P(0.72, 0.96), P(1.56, 0.5), P(2.36, 0.4), P(1.62, 0.7), P(1.16, 0.98)],
        [P(1.3, 0.98), P(1.8, 0.78), P(2.12, 0.76), P(1.78, 0.98)],
      ];
      for (const feather of feathers) {
        context.beginPath();
        context.moveTo(feather[0][0], feather[0][1]);
        for (const [px, py] of feather.slice(1)) context.lineTo(px, py);
        context.closePath();
        context.fillStyle = art.ink;
        context.fill();
        context.lineWidth = s * 0.035;
        context.lineJoin = 'miter';
        context.strokeStyle = art.accent ?? art.ink;
        context.stroke();
      }
      break;
    }
    case 'boxed': {
      // First word, then the second in a solid box (an accent-coloured tab).
      const h = fitHeight(`${first} ${second}`, width * 0.86, height * 0.6, art.style);
      const tracking = resolve(art.style).tracking * h;
      const a = wordmarkWidth(first, h, art.style),
        b = wordmarkWidth(second, h, art.style);
      const pad = h * 0.32;
      const total = a + tracking * 3 + b + pad * 2;
      let pen = cx - total / 2;
      context.strokeStyle = art.ink;
      drawWordmark(context, first, pen, cy, h, art.style, 'left');
      pen += a + tracking * 3;
      context.fillStyle = art.accent ?? art.ink;
      context.fillRect(pen, cy - h / 2 - pad, b + pad * 2, h + pad * 2);
      context.strokeStyle = art.fill ?? art.ink;
      drawWordmark(context, second, pen + pad, cy, h, art.style, 'left');
      break;
    }
  }
  context.restore();
}

/** Supplied-car decals that are not commercial marks and stay as authored. */
export const KEPT_DECALS = Object.freeze(['race_number', 'player', 'tyre_barcode']);
/**
 * Original art for each sponsor sheet on the supplied car, keyed by the
 * `Decal | <key>` material name. Keys only identify which authored sheet is
 * replaced; the art drawn is fictional and keeps the sheet's colour role
 * (white ink, red ink, a yellow badge, a dark shield) so the car's design
 * language survives. Unknown sponsor sheets fall back to `FALLBACK_DECAL_ART`.
 */
export const SUPPLIED_DECAL_ART: Readonly<Record<string, MarkArt>> = Object.freeze({
  a1: BRAND_ART.NORTHLINE,
  esso: { kind: 'oval', lines: ['MERIDIAN'], ink: '#ffffff', style: { weight: 0.17, width: 0.94 } },
  rauch: {
    kind: 'oval-fill',
    lines: ['NORDFIN'],
    ink: '#0f5a3a',
    accent: '#0f5a3a',
    fill: '#f0b51e',
    style: { weight: 0.18, width: 0.96 },
  },
  hard_rock: {
    kind: 'roundel',
    lines: ['AUREL', 'BANK'],
    ink: '#ffffff',
    style: { weight: 0.15, width: 1, slant: 0.14 },
  },
  bybit: BRAND_ART.VOLTEX,
  charging_bull: { kind: 'kestrel', lines: [], ink: '#e3202b', accent: '#f2c200' },
  hrc: BRAND_ART.OBSIDIAN,
  mobil: BRAND_ART['MERIDIAN OIL'],
  infinitum: BRAND_ART.ORBITEL,
  pirelli: BRAND_ART['APEX CORSA'],
  arctic_wolf: { ...BRAND_ART['HALCYON AIR'], kind: 'two-line', lines: ['HALCYON', 'AIR'] },
  zoom: BRAND_ART.VANTA,
  att: { kind: 'orbit', lines: [], ink: '#ffffff', accent: '#ffffff', fill: '#0b1430' },
  cash_app: BRAND_ART.NORDFIN,
  tag_heuer: { ...BRAND_ART['KESTREL TIME'], kind: 'shield', fill: '#0d3b33' },
  oracle: {
    ...BRAND_ART.VOLTEX,
    accentLetter: undefined,
    style: { weight: 0.16, width: 1.3, tracking: 0.16 },
  },
  front_red: {
    kind: 'wordmark',
    lines: ['VANTA'],
    ink: '#e3202b',
    style: { weight: 0.24, width: 1.1, tracking: 0.06 },
  },
  front_bull: {
    kind: 'wordmark',
    lines: ['VOLTEX'],
    ink: '#e3202b',
    style: { weight: 0.24, width: 1.0, tracking: 0.06 },
  },
  redbull_wordmark: {
    kind: 'wordmark',
    lines: ['VOLTEX'],
    ink: '#e3202b',
    style: { weight: 0.22, width: 1.0, slant: 0.2, tracking: 0.04 },
  },
  honda: { ...BRAND_ART['HALCYON AIR'], lines: ['HALCYON'] },
  rokt: BRAND_ART['AUREL BANK'],
  siemens: BRAND_ART.NORTHLINE,
  tyre_pirelli: BRAND_ART['APEX CORSA'],
  tyre_pzero: BRAND_ART['SLICK 18'],
});
export const FALLBACK_DECAL_ART: MarkArt = BRAND_ART.OBSIDIAN;

/** The decal key of a supplied material name (`Decal | oracle` -> `oracle`), or null. */
export function decalKey(materialName: string) {
  const match = /^Decal \| ([^|]+?)\s*(?:\|.*)?$/.exec(materialName);
  return match ? match[1].trim() : null;
}
/** Original art replacing the named decal sheet, or null when it is kept as authored. */
export function suppliedDecalArt(materialName: string): MarkArt | null {
  const key = decalKey(materialName);
  if (key === null || KEPT_DECALS.includes(key)) return null;
  return SUPPLIED_DECAL_ART[key] ?? FALLBACK_DECAL_ART;
}
function sourceSize(texture: T.Texture) {
  const image = texture.image as { width?: number; height?: number } | null | undefined;
  const width = image?.width ?? 0,
    height = image?.height ?? 0;
  return width > 0 && height > 0 ? { width, height } : { width: 1024, height: 256 };
}
/**
 * A canvas texture with `art` drawn at the source's pixel size (so its aspect,
 * and therefore every UV on the authored sheet, is unchanged) and every
 * sampling property of `source` copied: flipY, colour space, wrapping, UV
 * channel and transform. Transparent outside the ink, like the source sheet.
 */
export function markTexture(source: T.Texture, art: MarkArt) {
  const { width, height } = sourceSize(source);
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(2048, width);
  canvas.height = Math.min(2048, Math.round((height * canvas.width) / width));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D unavailable');
  context.clearRect(0, 0, canvas.width, canvas.height);
  drawMark(context, art, 0, 0, canvas.width, canvas.height);
  const texture = new T.CanvasTexture(canvas);
  texture.name = `Fictional ${art.lines.join(' ') || art.kind} mark`;
  texture.flipY = source.flipY;
  texture.colorSpace = source.colorSpace;
  texture.wrapS = source.wrapS;
  texture.wrapT = source.wrapT;
  texture.channel = source.channel;
  texture.offset.copy(source.offset);
  texture.repeat.copy(source.repeat);
  texture.center.copy(source.center);
  texture.rotation = source.rotation;
  texture.matrixAutoUpdate = source.matrixAutoUpdate;
  if (!source.matrixAutoUpdate) texture.matrix.copy(source.matrix);
  texture.anisotropy = Math.max(source.anisotropy, 4);
  texture.premultiplyAlpha = source.premultiplyAlpha;
  texture.userData.fictionalMark = art.lines.join(' ') || art.kind;
  texture.needsUpdate = true;
  return texture;
}
