import { ta, th } from '../i18n/index.ts';
import { LANGUAGE_SETTINGS, NATIVE_NAMES, type LanguageSetting } from '../i18n/locales.ts';

/** The LANGUAGE dial: one native `<select>` listing `Automatic` (follow the browser or
 * system) and each language in its own name, so a player can always find theirs whatever
 * the screen currently says. It sits on the first-launch screen and in Settings. Both are
 * marked `data-i18n-ui`, which the English-markup check (e2e/63-i18n-layout.spec.ts) leaves
 * out: they are the controls this feature adds, not strings it localises.
 *
 * Changing the language is applied by the application (main.ts): it stores the setting and
 * restarts the page, so every screen is built in the new language from its first paint. */
export function languageOptionsHtml(selected: LanguageSetting = 'auto') {
  return LANGUAGE_SETTINGS.map(
    (code) =>
      `<option value="${code}"${code === selected ? ' selected' : ''}>${code === 'auto' ? th('Automatic') : NATIVE_NAMES[code]}</option>`,
  ).join('');
}

/** The first-launch screen's dial: a change is announced as `language:<code>`. */
export function languageControl(selected: LanguageSetting = 'auto') {
  return `<label class="fr-language" data-i18n-ui><span>${th('LANGUAGE')}</span><select name="language" data-language-choice aria-label="${ta('Language')}">${languageOptionsHtml(selected)}</select></label>`;
}

/** The Settings row: part of the form, read on APPLY & SAVE. */
export function settingsLanguageRow(selected: LanguageSetting = 'auto') {
  return `<label data-i18n-ui>${th('LANGUAGE')}<select name="language">${languageOptionsHtml(selected)}</select></label><p class="small-note" data-i18n-ui>${th('The game restarts to change the language.')}</p>`;
}
