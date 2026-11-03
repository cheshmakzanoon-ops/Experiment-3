import { LIVERIES } from '../../simulation/config.ts';
import type { BodySheet } from './body-sheet.ts';

/** Default colourways for the catalogue (D7). Every machine had been painted
 * with the player's team red and a white stripe, so the showroom and the
 * festival read as one car in 37 proportions. A colourway is plain data, in the
 * same terms the paint machinery already uses: a primary colour, a secondary
 * and an accent, where the secondary goes (`layers`, see body-livery.ts) and the
 * helmet to match. The finish (gloss, metallic, satin) stays the body sheet's.
 *
 * Which entrant wears it: the player's machine (entrant 0). Rivals keep their
 * team colour (config LIVERIES, which the HUD, tower and minimap also use), so a
 * grid still reads by team. The player's own livery edit (Photo / Livery
 * editor) overrides the machine colourway as soon as it differs from the default
 * identity (`liveryCustomised`), exactly as it overrides the supplied car's
 * authored navy. */
export type LiveryLayer = 'roof' | 'lower' | 'bonnet' | 'nose' | 'stripes' | 'flash';
export interface Colourway {
  primary: number;
  secondary: number;
  accent: number;
  /** Where the secondary (or, for `flash`, the accent) replaces the primary.
   * Closed bodies only; open-wheel, kart and buggy bodies are one colour plus
   * their sheet's accent stripe. */
  layers?: readonly LiveryLayer[];
  /** Accent pinstripe along the roof and lower-band edges. */
  pin?: boolean;
}
const cw = (
  primary: number,
  secondary: number,
  accent: number,
  layers: readonly LiveryLayer[] = [],
  pin = false,
): Colourway => Object.freeze({ primary, secondary, accent, layers: Object.freeze(layers), pin });

const INK = 0x121416;
const BONE = 0xf2f1ec;
/** By vehicle id. Hue families are spread across the catalogue on purpose: no
 * two machines of one class share a primary, and the dark second colour is
 * shared only where it is carbon or black. */
export const COLOURWAYS: Readonly<Record<string, Colourway>> = Object.freeze({
  // Touring and club
  tc1: cw(0x1c4fb8, INK, BONE, ['roof']),
  tc2: cw(0xee6a14, INK, BONE, ['roof']),
  tc3: cw(0x2d6a4f, 0x0f1412, 0xc9f23a, ['lower']),
  hh2: cw(0x38a5e8, INK, 0xe02a2a, ['roof']),
  cr1: cw(0x19b4c4, INK, BONE),
  // Rally and off-road
  rl2: cw(0xf0f1ee, INK, 0xff5a1f, ['roof']),
  rcx6: cw(0xd9267d, INK, 0x27e1d9, ['bonnet']),
  rl7: cw(0xc8861c, 0x1b1b1b, 0xf2eee0, ['lower']),
  gb4: cw(0xb02a1c, INK, 0xf2e9d0, ['roof']),
  rxe: cw(0x2e5266, 0x0e1418, 0xb7ff3c, ['bonnet']),
  dx8: cw(0x2f4a38, 0x1a1a1a, 0xf08a1c, ['lower']),
  bg2: cw(0xe58a2a, 0x1c1c1c, 0x1c8a8a),
  // GT and GT sport
  gt8f: cw(0x0c4f36, INK, 0xf0e6c4),
  gt10m: cw(0xb7bcc2, 0x25282c, 0xd0242a, ['lower']),
  gs4: cw(0x0b7f7c, INK, BONE, ['roof']),
  gs6m: cw(0x62704f, 0x181a17, 0xe7ff3a, ['lower']),
  gt6r: cw(0x5b2f96, 0x15121c, 0xdadde2, ['roof']),
  gt6s: cw(0xeef0f1, 0x13264d, 0x13264d, ['lower']),
  // Prototype, hypercar and experimental
  hy9: cw(0x9fb4c8, 0x15233a, 0xff6a00, ['lower']),
  hy11: cw(0x1b1e22, 0x0d0e10, 0xe0232a),
  pr2: cw(0x1e3a9c, INK, BONE, ['lower']),
  pr3: cw(0x2ec4a6, 0x0f2433, 0x0f2433, ['lower']),
  sp71: cw(0xe8dfc8, 0x2a5a3a, 0x2a5a3a, ['lower']),
  xf2: cw(0xa6e22e, INK, INK, ['lower']),
  xe1: cw(0x1f46e8, 0x0a0d1a, 0x7df9ff, ['roof']),
  xh3: cw(0xb4e8ee, 0x1a3140, 0x2a7fd6, ['lower']),
  xt1: cw(0xc4122a, 0x0f1012, BONE, ['roof']),
  // Road cars
  eh3: cw(0xe7eaec, 0x14171a, 0x39d7ff, ['lower', 'roof'], true),
  sc7: cw(0xf2b705, INK, INK, ['roof', 'bonnet']),
  rh3: cw(0x3ac1a0, 0x16181a, BONE, ['roof']),
  rs5: cw(0x7a1530, 0x1a1a1a, 0xcdb27a, ['lower']),
  rm8: cw(0xf0561a, 0x0e0f10, 0x0e0f10, ['stripes']),
  rg63: cw(0xe9dfbf, 0x7a1e1e, 0x7a1e1e, ['lower']),
  rp6: cw(0xc9b184, 0x4a3a2a, 0xe05a1f, ['lower']),
  rr4: cw(0x4b5258, INK, 0xe3b100, ['roof']),
  lx12: cw(0xcdb68e, 0x16171a, 0xf5efe0, ['roof']),
  rd2: cw(0xf06a50, INK, BONE),
  vc62: cw(0x8fae8a, 0x2c3a2b, 0xf3ecd6),
  // Open-wheel
  jf2: cw(0xf1f1ef, 0x1f4fd0, 0x1f4fd0),
  hf67: cw(0x1e5a3c, 0x1e5a3c, 0xf0e6c8),
  fx26: cw(0xc1c6cc, 0x1a1c20, 0xff5a1f),
  fr3: cw(0x1d3fb0, 0x1d3fb0, BONE),
  fe4: cw(0xff7a1a, INK, BONE),
  hf76: cw(0xd4912a, 0x3b2418, 0x3b2418),
  hf86: cw(0x14a3a8, 0x14a3a8, 0xe8399c),
  // Karts
  sk125: cw(0x1a6ef0, INK, BONE),
  dk100: cw(0xb4e620, INK, INK),
});
export const COLOURWAY_IDS = Object.freeze(Object.keys(COLOURWAYS));
export function colourwayFor(vehicleId: string): Colourway | null {
  return COLOURWAYS[vehicleId] ?? null;
}

/** What `carMaterials` paints one entrant's body with. */
export interface BodyLook {
  primary: number;
  secondary: number;
  accent: number;
  layers: readonly LiveryLayer[];
  pin: boolean;
  /** Helmet shell colour (the livery colour; its band is the accent). */
  helmet: number;
  /** Race suit: the body colour, or the second colour when the body is pale
   * (a white suit in a white car loses the driver in the cockpit). */
  suit: number;
  /** Race number on the boards. */
  number: number;
  /** Where the look came from. */
  source: 'team' | 'colourway' | 'livery';
}
/** The player's editable livery, in the terms the look needs (storage/livery.ts). */
export interface LiveryInput {
  primary: string;
  accent: string;
  number: number;
  pattern: 'sweep' | 'split' | 'minimal';
}
const channel = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
/** Relative luminance (0..1) of an sRGB hex colour. */
export function luminance(hex: number) {
  return (
    0.2126 * channel((hex >> 16) & 255) +
    0.7152 * channel((hex >> 8) & 255) +
    0.0722 * channel(hex & 255)
  );
}
const suitFor = (primary: number, secondary: number) =>
  luminance(primary) > 0.45 && luminance(secondary) < 0.2 ? secondary : primary;
const ACCENTS = [0xf2f2ef, 0x101113, 0xf2c200, 0xe9e9eb, 0xb3121e, 0x111111];
const hexNumber = (css: string, fallback: number) =>
  /^#[0-9a-f]{6}$/i.test(css) ? parseInt(css.slice(1), 16) : fallback;
/** `a` toward `b` by `t`, per sRGB channel. */
export function mixHex(a: number, b: number, t: number) {
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const x = (a >> shift) & 255,
      y = (b >> shift) & 255;
    out |= Math.round(x + (y - x) * t) << shift;
  }
  return out;
}
/** The default livery identity (storage/livery.ts DEFAULT_LIVERY): a player who
 * has not changed it keeps the machine colourway. Kept as numbers here so this
 * module needs no storage import. */
const DEFAULT_PRIMARY = 0xc97235,
  DEFAULT_ACCENT = 0xe3ddc9;
export function liveryOverrides(livery: LiveryInput | null | undefined): livery is LiveryInput {
  if (!livery) return false;
  return (
    hexNumber(livery.primary, DEFAULT_PRIMARY) !== DEFAULT_PRIMARY ||
    hexNumber(livery.accent, DEFAULT_ACCENT) !== DEFAULT_ACCENT
  );
}
const PATTERN_LAYERS: Record<LiveryInput['pattern'], readonly LiveryLayer[]> = {
  split: ['lower'],
  sweep: ['flash'],
  minimal: [],
};
/** The team look of entrant `id`: its team colour (config LIVERIES) and accent. */
export function teamLook(id: number): BodyLook {
  const primary = LIVERIES[id % LIVERIES.length];
  const accent = ACCENTS[id % ACCENTS.length] === primary ? 0x101113 : ACCENTS[id % ACCENTS.length];
  return {
    primary,
    secondary: accent,
    accent,
    layers: [],
    pin: false,
    helmet: primary,
    suit: primary,
    number: id + 1,
    source: 'team',
  };
}
/** Look of entrant `id` on machine `vehicleId`. Team colour for rivals, the
 * machine colourway for the player, the player's edit over both. */
export function bodyLook(
  vehicleId: string,
  id: number,
  sheet: BodySheet,
  livery?: LiveryInput | null,
): BodyLook {
  if (id === 0 && liveryOverrides(livery)) {
    const primary = hexNumber(livery.primary, DEFAULT_PRIMARY),
      accent = hexNumber(livery.accent, DEFAULT_ACCENT);
    return {
      primary,
      secondary: mixHex(primary, 0x0a0c10, 0.72),
      accent,
      layers: sheet.kind === 'closed' ? PATTERN_LAYERS[livery.pattern] : [],
      pin: false,
      helmet: primary,
      suit: primary,
      number: Math.max(1, Math.min(99, Math.round(livery.number) || 1)),
      source: 'livery',
    };
  }
  const way = id === 0 ? colourwayFor(vehicleId) : null;
  if (way)
    return {
      primary: way.primary,
      secondary: way.secondary,
      accent: way.accent,
      layers: sheet.kind === 'closed' ? (way.layers ?? []) : [],
      pin: !!way.pin && sheet.kind === 'closed',
      helmet: way.primary,
      suit: suitFor(way.primary, way.secondary),
      number: id + 1,
      source: 'colourway',
    };
  return teamLook(id);
}
