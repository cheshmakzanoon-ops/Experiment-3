/** Supported interface languages and the pure rules for choosing one.
 *
 * English is the source language: every string in the code base is its own English text,
 * and `en` has no dictionary. The other seven are the Latin-script languages whose glyphs
 * the bundled Saira fonts already cover (latin, latin-ext and vietnamese subsets of
 * @fontsource-variable/saira). Russian, Chinese, Japanese and Korean need font files that
 * are not shipped: see docs/studio/reports/localization.md for the plan. */
export const LOCALES = ['en', 'de', 'fr', 'es', 'pt-BR', 'it', 'pl', 'tr'] as const;
export type Locale = (typeof LOCALES)[number];
/** Every language that has a dictionary (all but the source language). */
export const TRANSLATED_LOCALES = LOCALES.filter((l): l is Exclude<Locale, 'en'> => l !== 'en');
/** What the player stores: a language, or `auto` (follow the browser or system). */
export type LanguageSetting = 'auto' | Locale;
export const LANGUAGE_SETTINGS: readonly LanguageSetting[] = ['auto', ...LOCALES];

/** Each language's name in itself, so a player can always find theirs. */
export const NATIVE_NAMES: Readonly<Record<Locale, string>> = Object.freeze({
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  es: 'Español',
  'pt-BR': 'Português (Brasil)',
  it: 'Italiano',
  pl: 'Polski',
  tr: 'Türkçe',
});

export const isLocale = (value: unknown): value is Locale =>
  typeof value === 'string' && (LOCALES as readonly string[]).includes(value);

/** Settings validation: anything that is not a known language or `auto` is `auto`. */
export const validateLanguage = (value: unknown): LanguageSetting =>
  value === 'auto' || isLocale(value) ? value : 'auto';

/** Map one BCP 47 tag to a supported language, or null. Region-less Portuguese and any
 * Portuguese region (pt-PT included) use the Brazilian dictionary: closer than English. */
export function matchTag(tag: string): Locale | null {
  const lower = tag.trim().toLowerCase().replaceAll('_', '-');
  if (!lower) return null;
  const exact = LOCALES.find((l) => l.toLowerCase() === lower);
  if (exact) return exact;
  const base = lower.split('-')[0];
  if (base === 'pt') return 'pt-BR';
  return LOCALES.find((l) => l.toLowerCase() === base) ?? null;
}

/** First supported language in the browser's preference order, else English. The list is
 * the player's own ranking, so an unsupported first choice (Russian, say) does not stop the
 * search: the first entry that is supported wins. */
export function detectLocale(languages: readonly string[] | undefined | null): Locale {
  for (const tag of languages ?? []) {
    const match = matchTag(tag);
    if (match) return match;
  }
  return 'en';
}

/** The language to show: the player's choice, or the detected one for `auto`. */
export function resolveLocale(
  setting: LanguageSetting | undefined,
  languages: readonly string[] | undefined | null,
): Locale {
  return setting && setting !== 'auto' ? setting : detectLocale(languages);
}

/** The browser's ranked languages (navigator.languages, else navigator.language). */
export function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length
    ? navigator.languages
    : navigator.language
      ? [navigator.language]
      : [];
}
