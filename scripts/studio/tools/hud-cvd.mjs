// Colour-vision-deficiency check of the HUD's colour-coded accents: which pairs of colours that mean different
// things collapse for a protan, deutan or tritan viewer. Machado, Oliveira and Fernandes (2009) matrices at full
// severity on linear sRGB, then CIE76 delta-E in Lab: under about 15 two colours are hard to tell apart as two
// small tiles, under 25 they take effort. Pure arithmetic, no browser.
//
//   node scripts/studio/tools/hud-cvd.mjs            # prints the report
//   node scripts/studio/tools/hud-cvd.mjs --json     # machine-readable
//
// `PALETTES` lists the colour sets that carry meaning by colour alone (tyre temperature bands, flag swatches, the
// timing colours with and without the colour-blind setting). tests/hud-colourblind.test.ts holds the verdicts.
export const MATRICES = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export const parse = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export function simulate(hex, kind) {
  const m = MATRICES[kind];
  const rgb = parse(hex).map(lin);
  return m.map((row) => Math.min(255, Math.max(0, gam(Math.min(1, Math.max(0, row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]))))));
}
export function lab([r, g, b]) {
  const [R, G, B] = [r, g, b].map(lin);
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047,
    Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B,
    Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
export const deltaE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
/** Smallest delta-E between any two colours of a set, for one viewer, and the pair that sets it. */
export function worstPair(colours, kind) {
  const seen = Object.entries(colours).map(([name, hex]) => [name, simulate(hex, kind)]);
  let worst = { de: Infinity, pair: '' };
  for (let i = 0; i < seen.length; i++)
    for (let j = i + 1; j < seen.length; j++) {
      const de = deltaE(seen[i][1], seen[j][1]);
      if (de < worst.de) worst = { de, pair: `${seen[i][0]} / ${seen[j][0]}` };
    }
  return worst;
}
/** Colour sets whose members mean different things. */
export const PALETTES = {
  // tyreBand() in f1-hud.ts: carcass temperature, cold to overheating (the colours before this pass).
  'tyre bands (default)': { cold: '#4fa3ff', cool: '#5fd3a0', ideal: '#4cd964', warm: '#ffd60a', hot: '#ff3b30' },
  // hud-colourblind.css: the best 5-set among the Okabe-Ito colours plus a grey and a navy (an exhaustive search over
  // 252 sets, minimum delta-E over the four viewers): navy, sky blue, grey, yellow, vermillion.
  'tyre bands (colour-blind setting)': { cold: '#1b3a8a', cool: '#56b4e9', ideal: '#9a9a9a', warm: '#f0e442', hot: '#d55e00' },
  'timing colours (default)': { purple: '#c015c0', green: '#2ee66b', yellow: '#f5d90a', red: '#ff3b30' },
  'timing colours (colour-blind setting)': { purple: '#cc79a7', green: '#56b4e9', yellow: '#f0e442', red: '#e69f00' },
};
if (import.meta.url === `file://${process.argv[1]}`) {
  const report = {};
  for (const [name, colours] of Object.entries(PALETTES)) {
    report[name] = {};
    for (const kind of ['normal', 'protan', 'deutan', 'tritan']) {
      const w = worstPair(colours, kind);
      report[name][kind] = { deltaE: Math.round(w.de * 10) / 10, pair: w.pair };
    }
  }
  if (process.argv.includes('--json')) console.log(JSON.stringify(report, null, 1));
  else
    for (const [name, byKind] of Object.entries(report)) {
      console.log(name);
      for (const [kind, w] of Object.entries(byKind)) console.log(`  ${kind.padEnd(7)} worst pair ${w.pair.padEnd(16)} dE ${w.deltaE}`);
    }
}
