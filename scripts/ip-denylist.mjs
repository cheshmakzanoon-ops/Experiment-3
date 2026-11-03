/**
 * The real-brand deny list shared by `scripts/ip-guard.mjs` (checks a build's output) and
 * `tests/ip-audit.test.ts` / `tests/ip-denylist.test.ts` (check the shipped authored assets
 * and pin the matching rule). An engineering aid, not legal clearance
 * (docs/studio/reports/ip-audit.md).
 *
 * THE MATCHING RULE (word-aware, separator- and case-insensitive)
 * ---------------------------------------------------------------
 * A name is a brand hit when its WORDS match, whatever the spelling convention that joined
 * them. Text is first canonicalised (`canonicalise`), then the patterns below run on it:
 *
 *  1. Every run of letters and digits is split into words at letter/digit boundaries
 *     (`RB19` -> `rb 19`, `pirelli2024` -> `pirelli 2024`) and, when the run is a clean
 *     camelCase / PascalCase word (`redBullRacing`, `TagHeuer`, `REDBullRacing`), at its
 *     humps. A run that only LOOKS like camelCase because it is random (a base64 or hash
 *     blob: 24+ characters, a digit, a non-word fragment) is kept as one opaque token, so a
 *     brand-shaped fragment inside a hash does not fail a build.
 *  2. Underscores, hyphens, whitespace and (between two words) dots are soft separators and
 *     become one space: `hard_rock`, `hard-rock`, `Hard Rock`, `hard.rock`, `HardRock` are
 *     all `hard rock`. Any other punctuation (and a dot next to a one-letter name, as in the
 *     minified property access `p.zero`) is a hard break (` | `), so `red,bull` in minified
 *     code is not joined into a phrase.
 *  3. Everything is lower-cased. Patterns are written for that form: a space is a word
 *     boundary, ` ?` also allows the compound (`red ?bull` = `red bull` and `redbull`),
 *     and a hit must start and end on a word boundary (so `shell` does not hit
 *     `shell ?v ?power`, `mobility` does not hit `mobil`, `oracles` does not hit `oracle`).
 *
 * Consequences worth knowing (all pinned in tests/ip-denylist.test.ts):
 *  - Bare `oracle` and `honda` are denied as whole words, so `testOracle` or `oracle_feed`
 *    in shipped code is a hit. That is deliberate: shipped output has no reason to carry the
 *    word, and "oracle" in a test or script is not scanned. Plurals and longer words
 *    (`oracles`, `miracle`, `hondas`) are not hits.
 *  - Generic geometry words (`shell`, `bull` in `bullet`, `rock` in `rockfall`) are never
 *    denied on their own. Only the brand phrase is (`shell v-power`, `charging bull`).
 *  - Names that are ordinary words in isolation cannot be caught by name: `zoom`, `att`
 *    and `front_red` (decal keys of the owner-supplied model) stay undetectable here.
 *    They only occur next to detectable keys, and the guard additionally refuses the owner
 *    binaries themselves (`scripts/ip-guard.mjs`).
 */

/** Each entry is [label, pattern source] written for CANONICAL text (see above). */
export const FORBIDDEN = [
  [
    'F1 team / sponsor',
    String.raw`red ?bull|charging ?bull|front ?bull|arctic ?wolf|oracle|honda|hrc|petronas|scuderia|ferrari|mercedes|mc ?laren|aston ?martin|alpine f 1|williams racing|haas f 1|sauber|alpha ?tauri|visa cash ?app|cash ?app|tag ?heuer|rolex|santander|bybit|rokt|siemens|rauch|hard ?rock|kuwait|infinitum|aramco|heineken|puma`,
  ],
  [
    'Fuel / tyre / brake maker',
    String.raw`pirelli|p ?zero|brembo|michelin|bridgestone|goodyear|dunlop|castrol|mobil|esso|shell ?v ?power|akrapovi[cč]|[oö]hlins|yoshimura`,
  ],
  [
    'Motorcycle / car maker',
    String.raw`ducati|yamaha|kawasaki|suzuki|husqvarna|ktm|porsche|lamborghini|bugatti|koenigsegg|rimac`,
  ],
  ['Series / body', String.raw`formula ?(?:1|one)|fia|fim|ama ?supercross|monster ?energy|wrc`],
  ['Real car / driver asset id', String.raw`rb 19`],
  [
    'Commercial game / coverage',
    String.raw`f 1 (?:20)?2[0-9]|ea ?sports|ea com|playstation com|pushsquare|thumbculture|techradar com|topgear com|traxion gg|gamingbolt|gamescreed|maxi ?geek|cgmagonline|gamecritics|noobfeed|vandal elespanol|forza|gran ?turismo|need ?for ?speed|assetto ?corsa|i ?racing|codemasters`,
  ],
];

const WORD_EDGE_BEFORE = String.raw`(?<![\p{L}\p{N}])`;
const WORD_EDGE_AFTER = String.raw`(?![\p{L}\p{N}])`;
export const FORBIDDEN_RE = FORBIDDEN.map(([label, source]) => [
  label,
  new RegExp(`${WORD_EDGE_BEFORE}(?:${source})${WORD_EDGE_AFTER}`, 'gu'),
]);

const HUMPS = /\p{Lu}+(?=\p{Lu}\p{Ll})|\p{Lu}?\p{Ll}+|\p{Lu}+/gu;
/**
 * The words of one run of letters: itself when it has no hump (`redbull`, `RB`), its humps
 * when they are real words (`redBullRacing`, `TagHeuer`, `ShellVPower`, `REDBullRacing`:
 * the average hump is at least three letters), and null when it is not word-shaped
 * (`aGVsbG`, `XyZ`: the casing of random text).
 */
function wordsOf(letters) {
  const humps = letters.match(HUMPS) ?? [letters];
  return humps.length === 1 || letters.length / humps.length >= 3 ? humps : null;
}

/** One run of letters and digits -> its words, space separated (not yet lower-cased). */
function splitRun(run) {
  const segments = run.match(/\p{L}+|\p{N}+/gu) ?? [run];
  const parts = segments.map((segment) => (/^\p{L}/u.test(segment) ? wordsOf(segment) : [segment]));
  // Random base64 / hash text: one opaque token instead of accidental words.
  if (run.length >= 24 && segments.length > 1 && parts.some((words) => words === null)) return run;
  return parts.map((words, i) => (words ?? [segments[i]]).join(' ')).join(' ');
}

const ALNUM = String.raw`\p{L}\p{N}`;
/** Canonical form: words split, separators unified, lower case (see the header). */
export function canonicalise(text) {
  return text
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(new RegExp(`[${ALNUM}]+|[^${ALNUM}]+`, 'gu'), (run, offset, whole) => {
      if (/^[\p{L}\p{N}]/u.test(run)) return splitRun(run);
      if (/^[\s_\-\u2010-\u2015\u2212]+$/.test(run)) return ' ';
      // A single dot between two words (`ea.com`) joins them; `p.zero` (a minified property
      // access) and any other punctuation do not.
      if (
        run === '.' &&
        /^[\p{L}\p{N}]{2}$/u.test(whole.slice(offset - 2, offset)) &&
        /^[\p{L}\p{N}]{2}$/u.test(whole.slice(offset + 1, offset + 3))
      )
        return ' ';
      return ' | ';
    })
    .toLowerCase();
}

/**
 * Every brand hit in `text`: `{ label, word, around }`, `word` and `around` in canonical
 * form (so `RB19_BODY` is reported as `rb 19`). Stops after `limit` hits.
 */
export function findBrands(text, limit = 20) {
  const canonical = canonicalise(text);
  const hits = [];
  for (const [label, re] of FORBIDDEN_RE) {
    for (const match of canonical.matchAll(re)) {
      hits.push({
        label,
        word: match[0],
        around: canonical.slice(Math.max(0, match.index - 16), match.index + match[0].length + 16),
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

/**
 * Not failures: the word is a class or property name inside the code (`motoGP`,
 * `enableMotoGPPhysics`), never shown to a player. Counted and reported so the number can
 * only be driven down deliberately (docs/studio/reports/ip-audit.md, internal identifiers).
 */
export const SOFT = new RegExp(String.raw`moto ?gp`, 'gi');
