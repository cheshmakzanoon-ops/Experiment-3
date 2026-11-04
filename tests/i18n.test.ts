import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCALES,
  TRANSLATED_LOCALES,
  adopt,
  currentLocale,
  decimalMark,
  detectLocale,
  fixed,
  formatDate,
  formatLapTime,
  formatNumber,
  formatUnit,
  matchTag,
  resolveLocale,
  setLocale,
  startLocale,
  t,
  ta,
  th,
  tx,
  upper,
  validateLanguage,
  type Dictionary,
} from '../src/i18n/index.ts';
import { compile, format, placeholders, pluralBranches, requiredCategories } from '../src/i18n/message.ts';
import { startupLocale } from '../src/i18n/startup.ts';
import { DEFAULT_SETTINGS, validateSettings } from '../src/storage/data.ts';
import { catalogue } from '../scripts/i18n-catalogue.ts';
import { checkAll, checkDictionary, loadDictionary } from '../scripts/i18n-check.ts';
import { firstRunHtml } from '../src/ui/first-run.ts';
import { boardPlatesHtml, dialHtml } from '../src/ui/launch-board.ts';
import { lapTime } from '../src/ui/interface.ts';
import { languageControl, settingsLanguageRow } from '../src/ui/language-control.ts';
import { loadingStage } from '../src/ui/loading-copy.ts';

afterEach(async () => {
  await setLocale('en');
});

describe('messages: placeholders and plurals', () => {
  const laps = '{n, plural, one {# lap} other {# laps}}';
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(format('Press {key} to go', { key: 'C' }, 'en')).toBe('Press C to go');
    expect(format('Press {key} to go', {}, 'en')).toBe('Press {key} to go');
    expect(format('No braces', undefined, 'en')).toBe('No braces');
  });
  it('picks plural branches by the language rules', () => {
    expect(format(laps, { n: 1 }, 'en')).toBe('1 lap');
    expect(format(laps, { n: 5 }, 'en')).toBe('5 laps');
    const pl = '{n, plural, one {# okrążenie} few {# okrążenia} many {# okrążeń} other {# okrążenia}}';
    expect(format(pl, { n: 1 }, 'pl')).toBe('1 okrążenie');
    expect(format(pl, { n: 3 }, 'pl')).toBe('3 okrążenia');
    expect(format(pl, { n: 5 }, 'pl')).toBe('5 okrążeń');
    expect(format(pl, { n: 22 }, 'pl')).toBe('22 okrążenia');
    expect(format(pl, { n: 12 }, 'pl')).toBe('12 okrążeń');
    // French counts zero as singular.
    expect(format('{n, plural, one {# tour} other {# tours}}', { n: 0 }, 'fr')).toBe('0 tour');
  });
  it('supports exact matches and nested text around plurals', () => {
    const m = 'GARAGE · {n, plural, =0 {EMPTY} one {# MACHINE} other {# MACHINES}} !';
    expect(format(m, { n: 0 }, 'en')).toBe('GARAGE · EMPTY !');
    expect(format(m, { n: 2 }, 'en')).toBe('GARAGE · 2 MACHINES !');
  });
  it('reads placeholders and plural branches back for the gate', () => {
    expect(placeholders('{a} and {n, plural, one {# x {b}} other {# y}}')).toEqual({
      params: ['a', 'b', 'n'],
      plurals: ['n'],
    });
    expect([...pluralBranches(laps).get('n')!].sort()).toEqual(['one', 'other']);
  });
  it('rejects malformed messages', () => {
    expect(() => compile('{n, plural, one {# a}}')).toThrow(/other/);
    expect(() => compile('{unclosed')).toThrow();
    expect(() => compile('{n, select, a {b} other {c}}')).toThrow(/Unsupported/);
  });
  it('knows which plural categories each language needs', () => {
    expect(requiredCategories('en')).toEqual(['one', 'other']);
    expect(requiredCategories('de')).toEqual(['one', 'other']);
    expect(requiredCategories('tr')).toEqual(['one', 'other']);
    expect(requiredCategories('pl')).toEqual(['few', 'many', 'one', 'other']);
  });
});

describe('language choice', () => {
  it('maps browser tags to supported languages', () => {
    expect(matchTag('de-AT')).toBe('de');
    expect(matchTag('pt-PT')).toBe('pt-BR');
    expect(matchTag('pt')).toBe('pt-BR');
    expect(matchTag('PL')).toBe('pl');
    expect(matchTag('en_GB')).toBe('en');
    expect(matchTag('ru-RU')).toBeNull();
    expect(matchTag('')).toBeNull();
  });
  it('takes the first supported language of the ranking, else English', () => {
    expect(detectLocale(['ru-RU', 'tr-TR', 'en'])).toBe('tr');
    expect(detectLocale(['zh-CN', 'ja'])).toBe('en');
    expect(detectLocale([])).toBe('en');
    expect(detectLocale(undefined)).toBe('en');
  });
  it('resolves auto and explicit settings', () => {
    expect(resolveLocale('auto', ['fr-CA'])).toBe('fr');
    expect(resolveLocale('es', ['fr-CA'])).toBe('es');
    expect(resolveLocale(undefined, ['it'])).toBe('it');
  });
  it('validates the stored setting', () => {
    expect(validateLanguage('de')).toBe('de');
    expect(validateLanguage('auto')).toBe('auto');
    expect(validateLanguage('ru')).toBe('auto');
    expect(validateLanguage(7)).toBe('auto');
    expect(validateLanguage(undefined)).toBe('auto');
  });
  it('is part of Settings: older saves and unknown codes read as auto', () => {
    expect(DEFAULT_SETTINGS.language).toBe('auto');
    expect(validateSettings({ version: 6 }).language).toBe('auto');
    expect(validateSettings({ version: 5, language: 'pl' }).language).toBe('pl');
    expect(validateSettings({ version: 6, language: 'klingon' }).language).toBe('auto');
  });
});

describe('t() and the dictionaries', () => {
  it('is the English text itself under en, with or without a dictionary', () => {
    expect(currentLocale()).toBe('en');
    expect(t('GARAGE & SETTINGS')).toBe('GARAGE & SETTINGS');
    expect(th('GARAGE & SETTINGS')).toBe('GARAGE &amp; SETTINGS');
    expect(ta('say "hi" & <go>')).toBe('say &quot;hi&quot; &amp; &lt;go&gt;');
    expect(tx('wildcard.nope.title', 'THE ENGLISH')).toBe('THE ENGLISH');
  });
  it('escapes the message text but never the parameters', () => {
    expect(th('A & {x}', { x: '<b>1</b>' })).toBe('A &amp; <b>1</b>');
  });
  it('loads a dictionary on demand and switches back', async () => {
    expect(await setLocale('de')).toBe('de');
    expect(t('Silver')).toBe('Silber');
    expect(tx('machine.apx01', 'English line')).not.toBe('English line');
    expect(await setLocale('en')).toBe('en');
    expect(t('Silver')).toBe('Silver');
  });
  it('falls back to English for a string a dictionary does not have, with English plurals', async () => {
    adopt('fr', {});
    expect(t('{n, plural, one {# lap} other {# laps}}', { n: 0 })).toBe('0 laps');
    expect(t('Not in any dictionary')).toBe('Not in any dictionary');
  });
  it('keeps the current language when asked for an unknown one', async () => {
    await setLocale('tr');
    expect(await setLocale('xx' as never)).toBe('tr');
  });
  it('starts from the saved setting and survives unreadable storage', async () => {
    expect(await startupLocale({ read: async () => ({ language: 'pl' }) })).toBe('pl');
    await setLocale('en');
    expect(await startupLocale({ read: async () => ({ language: 'bogus' }) })).toBe('en');
    expect(
      await startupLocale({
        read: async () => {
          throw new Error('no storage');
        },
      }),
    ).toBe('en');
    expect(await startupLocale({ read: () => new Promise(() => undefined) }, 10)).toBe('en');
    expect(await startLocale('tr')).toBe('tr');
  });
  it('loads every shipped dictionary', async () => {
    for (const locale of TRANSLATED_LOCALES) {
      expect(await setLocale(locale)).toBe(locale);
      expect(t('Silver')).not.toBe('Silver');
    }
  });
});

describe('numbers, units and dates in the language', () => {
  it('keeps toFixed under English and swaps the decimal mark elsewhere', async () => {
    expect(fixed(1.2345, 3)).toBe((1.2345).toFixed(3));
    expect(lapTime(83.456)).toBe('1:23.456');
    expect(formatLapTime(83.456)).toBe('1:23.456');
    await setLocale('de');
    expect(decimalMark()).toBe(',');
    expect(fixed(2.5, 1)).toBe('2,5');
    expect(lapTime(83.456)).toBe('1:23,456');
    expect(formatLapTime(5.5)).toBe('0:05,500');
    await setLocale('en');
    expect(decimalMark()).toBe('.');
  });
  it('formats numbers, units and dates by the language', async () => {
    expect(formatNumber(12345.6)).toBe('12,345.6');
    expect(formatDate(Date.UTC(2026, 10, 3, 12))).toBe('3 Nov 2026');
    await setLocale('de');
    expect(formatNumber(12345.6)).toBe('12.345,6');
    expect(formatUnit(12.5, 'kilometer', 1)).toMatch(/12,5\s?km/);
    expect(formatDate(Date.UTC(2026, 10, 3, 12))).toMatch(/3\. Nov\.? 2026/);
    await setLocale('tr');
    expect(upper('i')).toBe('İ');
  });
});

describe('the catalogue and the dictionary gate', () => {
  it('finds every string, with unique keys that all parse', async () => {
    const entries = await catalogue();
    expect(entries.length).toBeGreaterThan(1000);
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
    for (const e of entries) expect(() => compile(e.source), e.key).not.toThrow();
    // Data tables are keyed by id, so rewording the English cannot orphan a translation.
    expect(entries.some((e) => e.key === 'achievement.circuit_first_finish.name')).toBe(true);
    expect(entries.some((e) => /^wildcard\..+\.pitch$/.test(e.key))).toBe(true);
    expect(entries.some((e) => e.key === 'machine.apx01')).toBe(true);
  });
  it('passes for all seven dictionaries', async () => {
    const { problems, counts, entries } = await checkAll();
    expect(problems.filter((p) => !p.warning)).toEqual([]);
    for (const locale of TRANSLATED_LOCALES) expect(counts[locale]).toBe(entries.length);
  });
  it('supports exactly the seven Latin-script languages besides English', () => {
    expect([...LOCALES]).toEqual(['en', 'de', 'fr', 'es', 'pt-BR', 'it', 'pl', 'tr']);
  });
  it('catches the defects it exists for', async () => {
    const entries = await catalogue();
    const real = await loadDictionary('pl');
    const bad: Record<string, string> = { ...real };
    const pick = (test: (e: (typeof entries)[number]) => boolean) => entries.find(test)!;
    const plural = pick((e) => e.source.includes('plural') && e.source.includes('MACHINES'));
    const holder = pick((e) => e.source.includes('{name}') && e.source.length > 20 && !e.key.includes('.'));
    const long = pick((e) => e.source.length > 60 && !e.key.includes('.'));
    const label = pick((e) => /^[A-Z ]{8,}$/.test(e.source));
    const gone = pick((e) => e.source === 'Silver');
    bad[plural.key] = '{n, plural, one {# POJAZD} other {# POJAZDÓW}}';
    bad[holder.key] = real[holder.key].replace(/\{name\}/g, '{imie}');
    bad[long.key] = long.source;
    bad[label.key] = real[label.key].toLowerCase();
    delete bad[gone.key];
    bad['achievement.circuit_first_finish.name'] = 'Первый финиш'; // Cyrillic: the fonts do not draw it
    bad['An old deleted string'] = 'Stary';
    bad[entries[7].key] = '   ';
    const problems = checkDictionary('pl', bad, entries).map((p) => `${p.kind}:${p.key}`);
    expect(problems).toContain(`plurals:${plural.key}`);
    expect(problems).toContain(`placeholders:${holder.key}`);
    expect(problems).toContain(`untranslated:${long.key}`);
    expect(problems).toContain(`case:${label.key}`);
    expect(problems).toContain(`keys:${gone.key}`);
    expect(problems).toContain('script:achievement.circuit_first_finish.name');
    expect(problems).toContain('keys:An old deleted string');
    expect(problems).toContain(`values:${entries[7].key}`);
  });
  it('gives Polish the plural branches it needs everywhere', async () => {
    const entries = await catalogue();
    const pl = await loadDictionary('pl');
    for (const e of entries.filter((x) => x.source.includes('plural'))) {
      const forms = pluralBranches(pl[e.key]);
      for (const [, set] of forms) for (const c of ['one', 'few', 'many', 'other']) expect(set.has(c), e.key).toBe(true);
    }
  });
});

describe('localised surfaces', () => {
  it('translate the first-launch screen and keep the language dial out of the English markup contract', async () => {
    const en = firstRunHtml({ device: 'keys' });
    expect(en).toContain('DRIVE THE FIRST LAP');
    expect(en).toContain('data-i18n-ui');
    await setLocale('de');
    const de = firstRunHtml({ device: 'keys', language: 'de' });
    expect(de).toContain('ERSTER START');
    expect(de).toContain('DIE ERSTE RUNDE FAHREN');
    expect(de).toContain('<option value="de" selected>Deutsch</option>');
    expect(de).toContain('role="radiogroup"');
    expect(de.match(/role="radiogroup"/g)).toHaveLength(2);
  });
  it('translate the paddock plates, the dial labels and the loading stages', async () => {
    await setLocale('pl');
    expect(boardPlatesHtml()).toContain('<b>TOR</b>');
    expect(dialHtml('laps', 'DISTANCE', null, '<select></select>')).toContain('DYSTANS');
    expect(loadingStage('Scene ready').title).toBe('Prawie gotowe');
    await setLocale('en');
    expect(loadingStage('Scene ready').title).toBe('Almost ready');
  });
  it('offer every language under its own name', () => {
    const row = settingsLanguageRow('tr');
    for (const name of ['Deutsch', 'Français', 'Español', 'Português (Brasil)', 'Italiano', 'Polski', 'Türkçe', 'English'])
      expect(row).toContain(name);
    expect(row).toContain('<option value="tr" selected>');
    expect(languageControl()).toContain('data-language-choice');
  });
});
