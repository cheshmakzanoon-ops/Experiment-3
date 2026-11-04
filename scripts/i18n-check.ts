/**
 * The dictionary gate. Every language dictionary (src/i18n/dict/*.ts) is checked against the
 * English catalogue read from the source (scripts/i18n-catalogue.ts):
 *
 *   keys        same keys as the catalogue: none missing, none left over from a deleted string
 *   values      none empty, no stray leading or trailing space
 *   message     parses (balanced braces, `plural` has `other`)
 *   placeholders the same `{names}` and plural variables as the English
 *   plurals     every plural has the branches the language needs (Polish: one, few, many, other)
 *   untranslated  no long string left as a copy of the English
 *   script      only letters the bundled Saira subsets draw (latin, latin-ext, vietnamese);
 *               a stray Cyrillic look-alike or CJK character is an error
 *   case        a source in capitals stays in capitals (the board is stencilled)
 *   ip          nothing the release IP guard (scripts/ip-denylist.mjs) would refuse in the shipped
 *               chunk, and no "Moto GP" (the series name; say "GP bike" in the language)
 *
 *   node --experimental-transform-types scripts/i18n-check.ts            # all languages
 *   node --experimental-transform-types scripts/i18n-check.ts pl tr      # some
 *   node --experimental-transform-types scripts/i18n-check.ts --counts   # per-language string counts
 *   node --experimental-transform-types scripts/i18n-check.ts --tsv de   # review sheet: key, English, German
 *
 * Exit code 1 when any error is found. Warnings (very long translations) do not fail.
 */
import { pathToFileURL } from 'node:url';
import { catalogue, type Entry } from './i18n-catalogue.ts';
import { TRANSLATED_LOCALES, type Locale } from '../src/i18n/locales.ts';
import { dictionaryLoaders, type Dictionary } from '../src/i18n/index.ts';
import { compile, pluralBranches, placeholders, requiredCategories } from '../src/i18n/message.ts';
// The release IP guard (scripts/ip-guard.mjs) scans every shipped chunk, dictionaries included:
// a word that is ordinary in a language but a team, sponsor or game name in the denylist (the
// German "sauber", the Italian "forza", the Portuguese "fim") fails the build. Check it here, at
// the translator's desk, with the same matcher.
import { SOFT, findBrands } from './ip-denylist.mjs';

export interface Problem {
  locale: Locale;
  key: string;
  kind: string;
  detail: string;
  warning?: boolean;
}

/** Ranges the shipped Saira faces cover: latin, latin-ext and vietnamese (@fontsource-variable/saira). */
const SAIRA_RANGES: readonly [number, number][] = [
  [0x0000, 0x00ff],
  [0x0100, 0x02ba],
  [0x02bb, 0x02bc],
  [0x02bd, 0x02c5],
  [0x02c6, 0x02c6],
  [0x02c7, 0x02cc],
  [0x02ce, 0x02d7],
  [0x02da, 0x02da],
  [0x02dc, 0x02dc],
  [0x02dd, 0x02ff],
  [0x0300, 0x0301],
  [0x0303, 0x0304],
  [0x0308, 0x0309],
  [0x0323, 0x0323],
  [0x0329, 0x0329],
  [0x1d00, 0x1dbf],
  [0x1e00, 0x1eff],
  [0x2000, 0x206f],
  [0x20a0, 0x20c0],
  [0x2113, 0x2113],
  [0x2122, 0x2122],
  [0x2191, 0x2191],
  [0x2193, 0x2193],
  [0x2212, 0x2212],
  [0x2215, 0x2215],
  [0x2c60, 0x2c7f],
  [0xa720, 0xa7ff],
];
const covered = (code: number) => SAIRA_RANGES.some(([a, b]) => code >= a && code <= b);
/** Symbols the English already uses that the face may not draw but the system font fallback does. */
const SYMBOLS = /[→←↑↓✕×÷≤≥★☆¤°·—–…«»„“”‘’‹›]/u;

export async function loadDictionary(locale: Exclude<Locale, 'en'>): Promise<Dictionary> {
  return (await dictionaryLoaders[locale]()).default;
}

export function checkDictionary(
  locale: Exclude<Locale, 'en'>,
  dictionary: Dictionary,
  entries: readonly Entry[],
): Problem[] {
  const problems: Problem[] = [];
  const add = (key: string, kind: string, detail: string, warning = false) =>
    problems.push({ locale, key, kind, detail, warning });
  const known = new Set(entries.map((e) => e.key));
  for (const key of Object.keys(dictionary))
    if (!known.has(key)) add(key, 'keys', 'not in the catalogue (a deleted or reworded string)');
  const needed = requiredCategories(locale);
  for (const entry of entries) {
    const { key, source } = entry;
    const value = dictionary[key];
    if (value === undefined) {
      add(key, 'keys', `missing: ${source.slice(0, 60)}`);
      continue;
    }
    if (!value.trim()) {
      add(key, 'values', 'empty');
      continue;
    }
    if (value !== value.trim() && source === source.trim()) add(key, 'values', 'stray space at an end');
    let ok = true;
    try {
      compile(value);
    } catch (error) {
      ok = false;
      add(key, 'message', error instanceof Error ? error.message : String(error));
    }
    if (ok) {
      const a = placeholders(source),
        b = placeholders(value);
      if (a.params.join() !== b.params.join())
        add(key, 'placeholders', `English {${a.params.join(', ')}} vs {${b.params.join(', ')}}`);
      for (const variable of a.plurals) {
        const have = pluralBranches(value).get(variable);
        const lacking = needed.filter((c) => !have?.has(c));
        if (lacking.length) add(key, 'plurals', `{${variable}} lacks ${lacking.join(', ')}`);
      }
      for (const variable of b.plurals)
        if (!a.plurals.includes(variable)) add(key, 'plurals', `{${variable}} is not a plural in English`);
    }
    // A long string identical to the English was not translated. Short ones (units, names such as
    // "Hypercar" or "GT Sport", a bare placeholder line) are legitimately the same.
    const letters = source.replace(/\{[^}]*\}/g, '').replace(/[^\p{L}]/gu, '');
    if (value === source && letters.length >= 14) add(key, 'untranslated', source.slice(0, 60));
    for (const char of value) {
      const code = char.codePointAt(0)!;
      if (/\p{L}/u.test(char)) {
        if (!/\p{Script=Latin}/u.test(char) || !covered(code))
          add(key, 'script', `${char} (U+${code.toString(16).toUpperCase()}) is not drawn by the shipped fonts`);
      } else if (code > 0x24f && !covered(code) && !SYMBOLS.test(char) && !/\p{M}/u.test(char))
        add(key, 'script', `${char} (U+${code.toString(16).toUpperCase()}) is not drawn by the shipped fonts`);
    }
    for (const hit of findBrands(value)) add(key, 'ip', `"${hit.word}" (${hit.label}) in ...${hit.around}...`);
    if (new RegExp(SOFT.source, 'i').test(value.replace(/[^\p{L}\p{N} ]/gu, ' ').toLowerCase()))
      add(key, 'ip', 'contains "moto gp"');
    const sourceLetters = source.replace(/\{[^}]*\}/g, '').replace(/[^\p{L}]/gu, '');
    if (
      sourceLetters.length >= 3 &&
      sourceLetters === sourceLetters.toUpperCase() &&
      !key.includes('.') // data-table lines are sentences, not stencilled labels
    ) {
      const plain = value.replace(/\{[^}]*\}/g, '').replace(/#/g, '');
      if (plain !== plain.toLocaleUpperCase(locale) && !/^\d/.test(plain))
        add(key, 'case', `source is in capitals: ${value.slice(0, 50)}`);
    }
    if (value.length > source.length * 2.4 + 14 && source.length > 20)
      add(key, 'length', `${value.length} characters for ${source.length} (layout risk)`, true);
  }
  return problems;
}

export async function checkAll(locales: readonly Exclude<Locale, 'en'>[] = TRANSLATED_LOCALES) {
  const entries = await catalogue();
  const problems: Problem[] = [];
  const counts: Record<string, number> = {};
  for (const locale of locales) {
    const dictionary = await loadDictionary(locale);
    counts[locale] = Object.keys(dictionary).length;
    problems.push(...checkDictionary(locale, dictionary, entries));
  }
  return { entries, problems, counts };
}

async function main() {
  const args = process.argv.slice(2);
  const wanted = args.filter((a): a is Exclude<Locale, 'en'> =>
    (TRANSLATED_LOCALES as readonly string[]).includes(a),
  );
  if (args.includes('--tsv')) {
    const entries = await catalogue();
    for (const locale of wanted.length ? wanted : TRANSLATED_LOCALES) {
      const dictionary = await loadDictionary(locale);
      console.log('key\tEnglish\t' + locale);
      for (const e of entries)
        console.log([e.key, e.source, dictionary[e.key] ?? ''].map((s) => s.replace(/\t|\n/g, ' ')).join('\t'));
    }
    return;
  }
  const { entries, problems, counts } = await checkAll(wanted.length ? wanted : TRANSLATED_LOCALES);
  console.log(`catalogue: ${entries.length} strings`);
  for (const [locale, n] of Object.entries(counts)) console.log(`  ${locale}: ${n} entries`);
  if (args.includes('--counts')) return;
  const errors = problems.filter((p) => !p.warning);
  const warnings = problems.filter((p) => p.warning);
  for (const p of [...errors, ...warnings].slice(0, 120))
    console.log(`${p.warning ? 'warn ' : 'FAIL '}[${p.locale}] ${p.kind}: ${p.key.slice(0, 70)} :: ${p.detail}`);
  console.log(`${errors.length} errors, ${warnings.length} warnings`);
  if (errors.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
