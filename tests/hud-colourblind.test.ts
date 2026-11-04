import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTES, worstPair } from '../scripts/studio/tools/hud-cvd.mjs';
import { TYRE_BANDS, tyreBand, tyreBandName } from '../src/ui/f1-hud.ts';

/** Colour-blind-safe HUD accents (docs/studio/reports/hud-legibility.md section 7). The tyre temperature bands are
 * the HUD's one colour-only code of five states; the colour-blind setting recolours them (hud-colourblind.css) and
 * this keeps the palette it ships apart for protan, deutan and tritan viewers. */
const sheet = readFileSync('src/ui/hud-colourblind.css', 'utf8');
const KINDS = ['normal', 'protan', 'deutan', 'tritan'] as const;

/** The band colours the sheet declares, read back from the CSS so the test judges what ships. */
function sheetBands(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const band of TYRE_BANDS) {
    const m = new RegExp(`\\[data-band='${band}'\\] \\{\\s*--cbt: (#[0-9a-f]{6});`, 'i').exec(sheet);
    if (m) out[band] = m[1];
  }
  return out;
}

describe('tyre temperature bands', () => {
  it('names each band from the carcass temperature and keeps the colours of the Art Bible', () => {
    const at: Record<number, string> = { 40: 'cold', 69.9: 'cold', 70: 'cool', 84.9: 'cool', 85: 'ideal', 104.9: 'ideal', 105: 'warm', 115: 'warm', 115.1: 'hot', 140: 'hot' };
    for (const [celsius, band] of Object.entries(at)) expect(tyreBandName(Number(celsius))).toBe(band);
    expect(tyreBandName(Number.NaN)).toBe('cold');
    expect(TYRE_BANDS.map((band) => tyreBand({ cold: 40, cool: 80, ideal: 95, warm: 110, hot: 130 }[band]))).toEqual([
      '#4fa3ff',
      '#5fd3a0',
      '#4cd964',
      '#ffd60a',
      '#ff3b30',
    ]);
  });
});

describe('the colour-blind palette', () => {
  it('recolours all five bands, for the cluster tiles and the VEHICLE panel tiles', () => {
    const bands = sheetBands();
    expect(Object.keys(bands)).toEqual([...TYRE_BANDS]);
    expect(sheet).toMatch(/html\[data-colorblind='true'\] #hud \.f1-car > i\[data-band\] \{\s*background: var\(--cbt\);/);
    expect(sheet).toMatch(/\.tires > div\[data-band\] \{\s*box-shadow: inset 2px 0 0 var\(--cbt\);/);
    expect(sheet).toMatch(/\.tires > div\[data-band\]::after \{\s*border-color: var\(--cbt\);/);
  });
  it('keeps every pair of bands at CIE76 delta-E 30 or more for normal, protan, deutan and tritan viewers', () => {
    const bands = sheetBands();
    for (const kind of KINDS) {
      const worst = worstPair(bands, kind);
      expect(worst.de, `${kind}: ${worst.pair}`).toBeGreaterThanOrEqual(30);
    }
    // The tool reports the same set (so the report's numbers are the shipped ones).
    expect(PALETTES['tyre bands (colour-blind setting)']).toEqual(bands);
  });
  it('rings the overheating tile, so the state that needs action does not depend on colour, but not a punctured one', () => {
    expect(sheet).toMatch(/\[data-band='hot'\]:not\(\[data-puncture='true'\]\) \{\s*outline: 1\.5px solid #fff;/);
  });
  it('is the answer to a real problem: the default bands collapse for a tritan viewer and strain a deutan one', () => {
    const defaults = PALETTES['tyre bands (default)'];
    expect(worstPair(defaults, 'tritan').de).toBeLessThan(10);
    expect(worstPair(defaults, 'deutan').de).toBeLessThan(25);
    expect(worstPair(defaults, 'normal').de).toBeGreaterThan(30);
  });
});
