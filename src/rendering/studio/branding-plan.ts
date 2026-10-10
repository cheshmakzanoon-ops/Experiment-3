import { BRANDS, drawWordmark, fitHeight, type Brand } from './brand-atlas.ts';
import { canvasTexture } from '../geometry.ts';

/**
 * Trackside sponsor plan (D13 trackside-branding). Pure data, deterministic.
 *
 * Every barrier run carries vinyl: the lap is split per side into sponsor
 * spans of `SPAN_METRES` (one sponsor per 80-150 m, never the same sponsor
 * twice in a row), each in one of the house colourways, about 10 % of them LED
 * boards. Panels are the atlas cells (512×128 each) that the barrier vinyl,
 * banner bridges and hoardings sample. Fictional brands only (P19).
 */
export const SPAN_METRES = Object.freeze({ min: 80, max: 150 });
export const LED_SHARE = 0.1;

/** Background and ink of a board (CSS colours). */
export interface Colourway {
  name: string;
  background: string;
  ink: string;
}
export const COLOURWAYS: readonly Colourway[] = Object.freeze([
  { name: 'black', background: '#16181c', ink: '#ffffff' },
  { name: 'blue', background: '#1e2a78', ink: '#ffffff' },
  { name: 'red', background: '#c8102e', ink: '#ffffff' },
  { name: 'yellow', background: '#f5c400', ink: '#16181c' },
]);

/** The sponsor brands seen at the track (the tyre wordmarks stay on tyres). */
export const TRACKSIDE_BRANDS: readonly Brand[] = Object.freeze(
  BRANDS.filter((brand) => brand !== 'APEX CORSA' && brand !== 'SLICK 18'),
);

/** Atlas layout: 2 columns × 16 rows of 512×128 panels in a 1024×2048 canvas. */
export const ATLAS = Object.freeze({
  width: 1024,
  height: 2048,
  panelWidth: 512,
  panelHeight: 128,
});
export const PANEL_COLUMNS = ATLAS.width / ATLAS.panelWidth;
export const PANEL_ROWS = ATLAS.height / ATLAS.panelHeight;

export interface Panel {
  index: number;
  brand: Brand | null;
  colourway: Colourway;
  /** UV origin and size of the cell (v up, three's flipY convention). */
  u: number;
  v: number;
  du: number;
  dv: number;
}
/** Panels: each brand on its house colourway and on a second one; the last
 * cells are plain colour (posts, frames) with no brand. */
export const PANELS: readonly Panel[] = Object.freeze(
  Array.from({ length: PANEL_COLUMNS * PANEL_ROWS }, (_, index) => {
    const pairs = TRACKSIDE_BRANDS.length * 2;
    const brand = index < pairs ? TRACKSIDE_BRANDS[index % TRACKSIDE_BRANDS.length] : null;
    const colourway =
      index < pairs
        ? COLOURWAYS[(index + Math.floor(index / TRACKSIDE_BRANDS.length)) % COLOURWAYS.length]
        : COLOURWAYS[(index - pairs) % COLOURWAYS.length];
    const column = index % PANEL_COLUMNS,
      row = Math.floor(index / PANEL_COLUMNS);
    return Object.freeze({
      index,
      brand,
      colourway,
      u: column / PANEL_COLUMNS,
      v: 1 - (row + 1) / PANEL_ROWS,
      du: 1 / PANEL_COLUMNS,
      dv: 1 / PANEL_ROWS,
    });
  }),
);
/** The plain (brandless) panel of a colourway. */
export function plainPanel(colourway: string) {
  const panel = PANELS.find((p) => !p.brand && p.colourway.name === colourway);
  if (!panel) throw new Error(`No plain ${colourway} panel`);
  return panel;
}

function hash(a: number, b: number) {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export interface BrandSpan {
  side: -1 | 1;
  start: number;
  end: number;
  panel: Panel;
  led: boolean;
}
/** Sponsor spans for both sides of a lap of `length` metres. */
export function brandingPlan(length: number, seed = 0x5eed): BrandSpan[] {
  if (!(length > 0) || !Number.isFinite(length)) throw new Error('Invalid lap length');
  const branded = PANELS.filter((p) => p.brand);
  const spans: BrandSpan[] = [];
  for (const side of [-1, 1] as const) {
    let s = 0,
      k = 0,
      previous = -1;
    while (s < length - 1e-6) {
      const span =
        SPAN_METRES.min + (SPAN_METRES.max - SPAN_METRES.min) * hash(seed + side * 7919, k * 2);
      // Close the lap with one span instead of a sliver.
      const end = length - (s + span) < SPAN_METRES.min ? length : s + span;
      let pick = Math.floor(hash(seed + side * 104729, k * 2 + 1) * branded.length);
      if (branded[pick].brand === branded[previous]?.brand) pick = (pick + 3) % branded.length;
      previous = pick;
      spans.push({
        side,
        start: s,
        end,
        panel: branded[pick],
        led: hash(seed ^ 0x1ed, k * 31 + (side > 0 ? 1 : 0)) < LED_SHARE,
      });
      s = end;
      k++;
    }
  }
  return spans;
}

/** F1-style distance and sector board face (#f2f2f2, black stroke-font
 * numerals; no system font), for the A09 boards' `makeLabel`. */
export function distanceBoardLabel(text: string, width: number, height: number) {
  return canvasTexture(width, height, (context) => {
    context.fillStyle = '#f2f2f2';
    context.fillRect(0, 0, width, height);
    // A thin black keyline inside the edge, as on real marker boards.
    context.strokeStyle = '#111214';
    context.lineWidth = Math.max(2, height * 0.04);
    const inset = context.lineWidth;
    context.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
    const style = { weight: 0.19, width: 0.95, tracking: 0.1 };
    const cap = fitHeight(text, width * 0.8, height * 0.62, style);
    drawWordmark(context, text, width / 2, height / 2, cap, style);
  });
}
