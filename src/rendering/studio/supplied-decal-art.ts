/**
 * OWNER-ONLY (release gate G15, docs/studio/reports/ip-audit.md).
 *
 * The keys below are the material names of the real-brand decal sheets inside
 * the owner-supplied player model (`public/models/supplied-player.glb.gz`). They
 * exist only so an owner build (`MOTOBOUND_SUPPLIED_PLAYER=1`) can recognise those
 * sheets and replace them with the fictional marks of `brand-atlas.ts`. They are
 * identifiers of somebody else's artwork, not product content: this module is
 * reachable only through `supplied-lookdev.ts`, which is only reachable behind
 * `SUPPLIED_PLAYER_BUILD`, so a product bundle contains none of these strings
 * (`npm run check:bundle` fails the build if one appears).
 */
import { BRAND_ART, type MarkArt } from './brand-atlas.ts';

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
  pirelli: BRAND_ART['MOTOBOUND'],
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
  tyre_pirelli: BRAND_ART['MOTOBOUND'],
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
