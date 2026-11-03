/** Front-end icons: hand-written inline SVG on a 24 px grid, 2 px stroke, square
 * caps and mitre joins so they read as stencilled marks (art direction
 * section 7). They are decorative: put the meaning in adjacent text, or pass a
 * label for an icon-only control. No icon pack, no emoji. */
const PATHS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  /** Changeable: half sun over a cloud edge. */
  mixed:
    '<path d="M8 11a4 4 0 0 1 8 0"/><path d="M12 3v2M4.5 6.5 6 8M19.5 6.5 18 8"/><path d="M4 21h14l3-3v-3H8l-4 3z"/>',
  rain: '<path d="M5 14h13l2-2V8l-3-2-4 1-3-2-4 2z"/><path d="M8 17l-1 3M13 17l-1 3M18 17l-1 3"/>',
  /** Fog: a cloud with banded mist lines beneath. */
  fog: '<path d="M6 12h12l2-2V7l-3-2-4 1-3-2-4 2z"/><path d="M3 15h18M6 18h12M9 21h6"/>',
  /** Storm: rain cloud with a lightning bolt. */
  storm:
    '<path d="M5 12h13l2-2V6l-3-2-4 1-3-2-4 2z"/><path d="M13 12l-3 5h4l-3 5"/><path d="M6 15l-1 3M18 15l-1 3"/>',
  /** Dust: a low sun over blown grit lines. */
  dust: '<path d="M7 12a5 5 0 0 1 10 0"/><path d="M12 3v2M4 6l2 2M20 6l-2 2"/><path d="M3 15h9M14 15h7M5 18h6M13 18h6M8 21h8"/>',
  /** Light dial: a low sun on the horizon (sunset), a crescent (night), a clock
   * (live: the sky follows your clock) and a map pin (the venue's own light). */
  sunset:
    '<path d="M6 16a6 6 0 0 1 12 0"/><path d="M12 5v3M4.5 8.5l2 2M19.5 8.5l-2 2M2 16h20M6 20h12"/>',
  night: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>',
  live: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/>',
  venue: '<path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z"/><circle cx="12" cy="11" r="2"/>',
  close: '<path d="M5 5l14 14M19 5L5 19"/>',
  tyre: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
  flag: '<path d="M5 3v18"/><path d="M5 4h14v10H5z"/><path d="M5 9h14M10 4v10M15 4v10" stroke-width="1.5"/>',
  laps: '<path d="M4 9h13l-3-3M20 15H7l3 3"/>',
  grid: '<path d="M4 4h7v4H4zM13 9h7v4h-7zM4 14h7v4H4z"/><path d="M13 19h7" />',
  wheel:
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 4v4M12 16v4M4 12h4M16 12h4"/>',
  start: '<path d="M4 4v16"/><path d="M9 12h11M16 7l5 5-5 5"/>',
  chevLeft: '<path d="M15 5 8 12l7 7"/>',
  chevRight: '<path d="M9 5l7 7-7 7"/>',
  caret: '<path d="M6 9l6 6 6-6"/>',
  /** Chevron stack painted on the pit exit: the go mark. */
  go: '<path d="M4 5l7 7-7 7M12 5l7 7-7 7"/>',
} as const;
export type GlyphName = keyof typeof PATHS;
/** Weather id to its glyph (weather-catalogue.ts ids; unknown ids fall back to the sun). */
export const WEATHER_GLYPH: Readonly<Record<string, GlyphName>> = Object.freeze({
  clear: 'sun',
  changeable: 'mixed',
  rain: 'rain',
  fog: 'fog',
  storm: 'storm',
  dust: 'dust',
});
/** Light choice to its glyph (light-choice.ts ids). */
export const LIGHT_GLYPH: Readonly<Record<string, GlyphName>> = Object.freeze({
  auto: 'venue',
  day: 'sun',
  sunset: 'sunset',
  night: 'night',
  live: 'live',
});

export function glyph(name: GlyphName, className = 'glyph') {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}

/** Number-plate silhouettes for the four disciplines (art direction section 2).
 * Each is a real race object, so the shape alone tells them apart. The plate
 * fill comes from `--plate` set by the discipline; the numeral is stencilled. */
const PLATES: Record<string, string> = {
  /** Open-wheel nose roundel. */
  roundel:
    '<circle class="plate-body" cx="32" cy="28" r="25"/><circle class="plate-rim" cx="32" cy="28" r="21"/>',
  /** GP fairing plate: pill with the lower corners cut. */
  fairing:
    '<path class="plate-body" d="M4 20Q4 6 18 6H46Q60 6 60 20V36L52 50H12L4 36Z"/><path class="plate-rim" d="M9 21Q9 11 19 11H45Q55 11 55 21V34L49 45H15L9 34Z"/>',
  /** Motocross front number plate: domed top, flat foot. */
  arch: '<path class="plate-body" d="M6 52V26Q6 4 32 4Q58 4 58 26V52Z"/><path class="plate-rim" d="M11 47V27Q11 9 32 9Q53 9 53 27V47Z"/>',
  /** Road licence plate. */
  licence:
    '<rect class="plate-body" x="2" y="10" width="60" height="36" rx="3"/><rect class="plate-rim" x="6" y="14" width="52" height="28" rx="1"/>',
};
export function plateSvg(shape: keyof typeof PLATES, numeral: string, caption = '') {
  const cy = shape === 'licence' ? 33 : 34;
  return `<svg class="plate" viewBox="0 0 64 56" aria-hidden="true" focusable="false">${PLATES[shape]}<text class="plate-numeral" x="32" y="${cy + 11}" text-anchor="middle">${numeral}</text>${caption ? `<text class="plate-caption" x="32" y="24" text-anchor="middle">${caption}</text>` : ''}</svg>`;
}
