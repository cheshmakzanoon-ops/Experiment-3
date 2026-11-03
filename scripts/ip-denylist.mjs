/**
 * The real-brand deny list shared by `scripts/ip-guard.mjs` (checks a build's output) and
 * `tests/ip-audit.test.ts` (checks the shipped authored assets). Whole words,
 * case-insensitive. An engineering aid, not legal clearance (docs/studio/reports/ip-audit.md).
 */
/** Whole-word, case-insensitive. Each entry is [label, pattern source]. */
export const FORBIDDEN = [
  [
    'F1 team / sponsor',
    String.raw`red ?bull|redbull|oracle (?:red|racing|cloud)|honda racing|\bhrc\b|petronas|scuderia|ferrari|mercedes[- ]?(?:amg|benz)?|mclaren|aston martin|alpine f1|williams racing|haas f1|sauber|alphatauri|visa cash app|cash ?app|tag[- ]?heuer|rolex|santander|bybit|rokt|siemens|rauch|hard rock|kuwait|infinitum|aramco|heineken|puma`,
  ],
  [
    'Fuel / tyre / brake maker',
    String.raw`pirelli|p ?zero|brembo|michelin|bridgestone|goodyear|dunlop|castrol|\bmobil ?1\b|\besso\b|\bshell v-power|akrapovi[cč]|[oö]hlins|yoshimura`,
  ],
  [
    'Motorcycle / car maker model',
    String.raw`ducati|yamaha|kawasaki|suzuki|husqvarna|\bktm\b|honda cb|porsche|lamborghini|bugatti|koenigsegg|rimac`,
  ],
  [
    'Series / body',
    String.raw`formula ?(?:1|one)\b|\bfia\b|\bfim\b|\bama supercross|monster energy|\bwrc\b`,
  ],
  ['Real car / driver asset id', String.raw`\brb19\b|rb19_|\bsupplied[- ]rb19`],
  [
    'Commercial game / coverage',
    String.raw`\bf1 ?2[0-9]\b|f1-2[0-9]|ea sports|ea\.com|playstation\.com|pushsquare|thumbculture|techradar\.com|topgear\.com|traxion\.gg|gamingbolt|gamescreed|maxi-geek|cgmagonline|gamecritics|noobfeed|vandal\.elespanol|forza|gran turismo|need for speed|assetto corsa|iracing|codemasters`,
  ],
];
export const FORBIDDEN_RE = FORBIDDEN.map(([label, source]) => [
  label,
  new RegExp(String.raw`\b(?:${source})\b`, 'i'),
]);
/**
 * Not failures: the word is a class or property name inside the code (`motoGP`,
 * `enableMotoGPPhysics`), never shown to a player. Counted and reported so the number can
 * only be driven down deliberately (docs/studio/reports/ip-audit.md, internal identifiers).
 */
export const SOFT = new RegExp(String.raw`moto ?gp`, 'gi');

/** Substrings that merely contain a forbidden word and are known to be harmless. */
export const ALLOW = [/hrc[a-z0-9]{3,}/i /* base64 / hash fragments */];
