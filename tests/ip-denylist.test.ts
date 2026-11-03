import { describe, expect, it } from 'vitest';
import { canonicalise, findBrands } from '../scripts/ip-denylist.mjs';

/**
 * Release gate G15: the brand deny list matches WORDS, whatever convention joined them
 * (snake_case, kebab-case, spaces, camelCase, digits, case). The rule is documented in the
 * header of scripts/ip-denylist.mjs. The first table is the set a reviewer found the old
 * whole-word list missing (material and node names of the owner-supplied model); every
 * string in it must hit. The second table is ordinary vocabulary of this codebase and of
 * three.js that must not.
 */
const hit = (text: string) => findBrands(text).length > 0;

describe('brand deny list: separator, case and compound handling', () => {
  const reviewerSet = [
    'RB19_BODY',
    'redbull_wordmark',
    'tyre_pirelli',
    'hard_rock',
    'cash_app',
    'tag_heuer',
    'charging_bull',
    'front_bull',
    'arctic_wolf',
    'oracle',
    'honda',
  ];
  it.each(reviewerSet)('MUST MATCH %s (named by the reviewer)', (text) => {
    expect(hit(text), text).toBe(true);
  });

  // The rest of the owner-supplied model's names and the same names in other spellings.
  const mustMatch = [
    // node and material names of the supplied model
    'RB19_FRONT_WING',
    'RB19_MIRROR_0',
    'RB19_spin3',
    'Decal | esso',
    'Decal | rauch',
    'Decal | bybit',
    'Decal | hrc',
    'Decal | mobil',
    'Decal | infinitum',
    'Decal | pirelli',
    'Decal | rokt',
    'Decal | siemens',
    'tyre_pzero',
    'Rear DRS | BYBIT',
    // case, separators, camelCase and digits
    'RedBull',
    'redBullRacing',
    'REDBullRacing',
    'red-bull',
    'Red Bull',
    'RED_BULL_RACING',
    'Red\u2013Bull',
    'Red\u00a0Bull',
    'Red\u200bBull',
    'red.bull',
    'redbull',
    'RB-19',
    'rb 19',
    'rb_19',
    'RB19',
    'supplied-RB19',
    'p-zero',
    'P Zero',
    'PZero',
    'Mobil1',
    'mobil_1',
    'pirelli2024',
    'Pirelli_P_Zero_Soft',
    'hardRock',
    'HARD-ROCK',
    'Hard Rock Cafe',
    'cashApp',
    'Cash App',
    'visa_cash_app',
    'TagHeuer',
    'tagHeuer',
    'TAG-HEUER',
    'chargingBull',
    'frontBull',
    'ArcticWolf',
    'arctic wolf',
    'McLaren',
    'mclaren_f1',
    'aston_martin',
    'AstonMartin',
    'alpha_tauri',
    'shell_v_power',
    'ShellVPower',
    'Shell V-Power',
    'Honda',
    'HONDA_RACING',
    'honda-cb750',
    'hondaLogo',
    'Oracle',
    'oracle_cloud',
    'oracleRedBull',
    'testOracle',
    'f1-22',
    'F1_23',
    'F1 2024',
    'formula_one',
    'FormulaOne',
    'formula1',
    'Formula 1',
    'ea_sports',
    'EASports',
    'ea.com',
    'playstation.com',
    'forza_horizon',
    'Gran-Turismo',
    'NeedForSpeed',
    'iRacing',
    'assetto_corsa',
    'akrapovič',
    'Öhlins',
    'monster_energy',
    'ama-supercross',
    'ducati_panigale',
    'Yamaha',
    // the brand inside longer, separated text
    'public/models/redbull_wordmark.png',
    'material:tyre_pirelli;roughness:0.4',
    '{"name":"RB19_BODY","mesh":3}',
  ];
  it.each(mustMatch)('MUST MATCH %s', (text) => {
    expect(hit(text), text).toBe(true);
  });

  const mustNotMatch = [
    // this game's own names and vocabulary
    'apex',
    'APX-01',
    'apx01-shell',
    'shell',
    'Shell',
    'shell_material',
    'ShellMesh',
    'GP race shell',
    'front_wing',
    'rear_wing',
    'front_paint',
    'sidepod',
    'nose',
    'engine',
    'halo',
    'Decal | race_number',
    'tyre_barcode',
    'PLAYER_WHEEL_0',
    'MOTOBOUND',
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
    'SLICK 18',
    'GT-8F',
    'GP-R1',
    'Aurel',
    'Solvane',
    // generic words that contain, or sit next to, a brand word
    'bull',
    'bullet',
    'bulletTime',
    'bullseye',
    'red',
    'reduced',
    'redraw',
    'bullet_red',
    'hard',
    'hardware',
    'rock',
    'rockfall',
    'hardRockfall',
    'cashmere',
    'application',
    'cash',
    'app',
    'wolf',
    'arctic',
    'charging',
    'charging_station',
    'front',
    'tag',
    'mobility',
    'mobile',
    'automobile',
    'miracle',
    'oracles',
    'weatherOracles',
    'hondas',
    'pumas',
    'zero',
    'p.zero',
    'pole',
    'formula',
    'formula_two',
    'formulation',
    'F1',
    'f1',
    'F1 key',
    'visa',
    'shellac',
    'aston',
    'martin',
    'Mercedesque',
    // punctuation is a hard break (a dot only joins two words of 2+ characters): minified
    // neighbours and one-letter property accesses are not a phrase
    'red,bull',
    'hard;rock',
    'x=cash,app',
    // an opaque base64 / hash blob with brand-shaped fragments is not a brand
    'Ab3Hrc9XyZ1QmP7sKdLw2VnTq5Uj8Ro4Zx',
    'aGVsbG8hrcB3J2xRb19Qm8Zk4PLw0TsXy',
    '3fa91c0b7d2e5f48a6c1b9e07d34a8f5c2b1e60d9a7f35',
  ];
  it.each(mustNotMatch)('MUST NOT MATCH %s', (text) => {
    expect(findBrands(text), text).toEqual([]);
  });
});

describe('canonical form', () => {
  it('unifies separators, case, camelCase humps and letter/digit boundaries', () => {
    expect(canonicalise('RB19_BODY')).toBe('rb 19 body');
    expect(canonicalise('redBullRacing')).toBe('red bull racing');
    expect(canonicalise('Tyre-Pirelli  P_Zero')).toBe('tyre pirelli p zero');
    expect(canonicalise('pirelli2024')).toBe('pirelli 2024');
  });
  it('keeps other punctuation as a hard break and joins a dot only between two words', () => {
    expect(canonicalise('a,b')).toBe('a | b');
    expect(canonicalise('ea.com')).toBe('ea com');
    expect(canonicalise('p.zero')).toBe('p | zero');
  });
  it('reports the matched words in canonical form with context', () => {
    const [found] = findBrands('Decal | hard_rock | 0.4');
    expect(found).toMatchObject({ label: 'F1 team / sponsor', word: 'hard rock' });
    expect(found.around).toContain('decal');
  });
});

describe('scanning real shipped-looking text', () => {
  it('flags a brand buried in a minified bundle but not the words around it', () => {
    const clean = 'function a(t){return t.shell?t.shell.bull:t.rock}const m="apx01-shell";';
    expect(findBrands(clean)).toEqual([]);
    const dirty = clean + 'const d={"redbull_wordmark":1,hard_rock:2};';
    expect(findBrands(dirty).map((h) => h.word)).toEqual(['redbull', 'hard rock']);
  });
});
