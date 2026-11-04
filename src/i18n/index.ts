import {
  LOCALES,
  browserLanguages,
  isLocale,
  resolveLocale,
  type LanguageSetting,
  type Locale,
} from './locales.ts';
import { format, type Params } from './message.ts';

export * from './locales.ts';
export type { Params } from './message.ts';

/** Tiny typed localisation core.
 *
 * The English source text is the key: `t('GARAGE & SETTINGS')` is that very text under `en`
 * and for any string a dictionary does not have, so no existing test, e2e or snapshot under
 * English can change. Data tables with stable ids (achievements, Wildcard events, machine
 * lines) use `tx(key, english)` so their ids, not their wording, key the dictionaries.
 * Dictionaries are per-language modules loaded on demand into their own chunks
 * (`setLocale`), so the initial JavaScript does not carry them.
 *
 *   t(text, params?)    plain text (textContent, aria, toasts)
 *   th(text, params?)   for HTML templates: escapes `& < >` of the message text
 *   ta(text, params?)   for HTML attribute values: also escapes the double quote
 *   tx(key, text, params?) id-keyed variants of the above: txh / txa
 *
 * Messages are ICU-lite (message.ts): `{n}` placeholders and
 * `{n, plural, one {# lap} other {# laps}}`. Parameters are inserted verbatim. */
export type Dictionary = Readonly<Record<string, string>>;

const loaders: Record<Exclude<Locale, 'en'>, () => Promise<{ default: Dictionary }>> = {
  de: () => import('./dict/de.ts'),
  fr: () => import('./dict/fr.ts'),
  es: () => import('./dict/es.ts'),
  'pt-BR': () => import('./dict/pt-BR.ts'),
  it: () => import('./dict/it.ts'),
  pl: () => import('./dict/pl.ts'),
  tr: () => import('./dict/tr.ts'),
};
/** Dictionary module loaders by language (the check script imports these directly). */
export const dictionaryLoaders = loaders;

const EMPTY: Dictionary = Object.freeze({});
let active: Locale = 'en';
let dictionary: Dictionary = EMPTY;
const listeners = new Set<(locale: Locale) => void>();

export const currentLocale = (): Locale => active;
/** Run `listener` after every language change (not called for the initial `en`). */
export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const escText = (text: string) => text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
const escAttr = (text: string) =>
  text.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );

function lookup(key: string, source: string, params: Params | undefined, escape?: (s: string) => string) {
  const found = active === 'en' ? undefined : dictionary[key];
  // An untranslated message is English: it follows English plural rules.
  return format(found ?? source, params, found === undefined ? 'en' : active, escape);
}
export const t = (source: string, params?: Params): string => lookup(source, source, params);
export const th = (source: string, params?: Params): string =>
  lookup(source, source, params, escText);
export const ta = (source: string, params?: Params): string =>
  lookup(source, source, params, escAttr);
export const tx = (key: string, source: string, params?: Params): string =>
  lookup(key, source, params);
export const txh = (key: string, source: string, params?: Params): string =>
  lookup(key, source, params, escText);
export const txa = (key: string, source: string, params?: Params): string =>
  lookup(key, source, params, escAttr);
export { N_ } from './mark.ts';
/** True when the active dictionary (or English) has this key. */
export const hasTranslation = (key: string) => active === 'en' || key in dictionary;

/** Switch language: load its dictionary chunk, then publish it. Resolves to the language now
 * active; an unavailable dictionary keeps the current one and resolves to it. */
export async function setLocale(locale: Locale): Promise<Locale> {
  if (!isLocale(locale)) return active;
  if (locale === active) return active;
  let next = EMPTY;
  if (locale !== 'en') {
    try {
      next = (await loaders[locale]()).default;
    } catch (error) {
      console.warn(`Language ${locale} unavailable; keeping ${active}.`, error);
      return active;
    }
  }
  adopt(locale, next);
  return active;
}
/** Install an already-loaded dictionary (tests and the check script). */
export function adopt(locale: Locale, next: Dictionary) {
  active = locale;
  dictionary = locale === 'en' ? EMPTY : next;
  separators = null;
  numberFormats.clear();
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  for (const listener of listeners) listener(locale);
}

/** First-paint language: the saved choice, else the browser's ranking. Never throws. */
export async function startLocale(
  setting: LanguageSetting | undefined,
  languages: readonly string[] = browserLanguages(),
): Promise<Locale> {
  return setLocale(resolveLocale(setting, languages));
}

// --- Numbers, units, dates (Intl, in the active language) --------------------------------
// English formats keep their historic look (`toFixed`, `en-GB` dates), so nothing changes
// under `en`; every other language gets its own decimal mark, grouping and month names.
let separators: { decimal: string } | null = null;
const numberFormats = new Map<string, Intl.NumberFormat>();
const intlTag = (): string => (active === 'en' ? 'en-GB' : active);

/** The decimal mark of the active language ('.' or ','). */
export function decimalMark(): string {
  separators ??= {
    decimal:
      new Intl.NumberFormat(intlTag()).formatToParts(1.1).find((p) => p.type === 'decimal')
        ?.value ?? '.',
  };
  return separators.decimal;
}
/** Swap the decimal point of an already-formatted number for the language's mark. */
export function localizeDecimal(text: string): string {
  const mark = decimalMark();
  return mark === '.' ? text : text.replace('.', mark);
}
/** `value.toFixed(digits)` with the language's decimal mark. Identical to toFixed under English. */
export const fixed = (value: number, digits: number): string =>
  localizeDecimal(value.toFixed(digits));

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  const key = `${intlTag()}|${options ? JSON.stringify(options) : ''}`;
  let format = numberFormats.get(key);
  if (!format) numberFormats.set(key, (format = new Intl.NumberFormat(intlTag(), options)));
  return format.format(value);
}
/** A quantity with its unit written the language's way (`1,5 km`, `12 km/h`). */
export function formatUnit(
  value: number,
  unit: string,
  digits = 0,
  unitDisplay: 'short' | 'narrow' | 'long' = 'short',
): string {
  return formatNumber(value, {
    style: 'unit',
    unit,
    unitDisplay,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
/** A calendar date for the language (`3 Nov 2026`, `3. Nov. 2026`, `3 de nov. de 2026`). */
export function formatDate(
  when: Date | number,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  return new Intl.DateTimeFormat(intlTag(), options).format(when);
}
/** A time of day for the language. */
export function formatTime(
  when: Date | number,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' },
): string {
  return new Intl.DateTimeFormat(intlTag(), options).format(when);
}
/** `m:ss.mmm` with the language's decimal mark (a lap or race time). */
export function formatLapTime(seconds: number, digits = 3): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${fixed(seconds % 60, digits).padStart(digits + 3, '0')}`;
}

/** Upper-case text for the language (Turkish `i` becomes `İ`). Identical to toUpperCase under English. */
export const upper = (text: string): string => text.toLocaleUpperCase(active);

export const SUPPORTED_LOCALES = LOCALES;
