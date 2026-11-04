import { startLocale, validateLanguage, type Locale } from './index.ts';

/** First-paint language. Reads the saved `language` setting straight from the save store
 * (the settings record is validated field by field elsewhere; only this field matters here)
 * and loads the dictionary before the interface is built. A missing, unreadable or unknown
 * value is `auto`: the browser's language ranking, then English. Never throws, never waits
 * longer than `timeoutMs` for storage, so a stuck database cannot hold the menu back. */
export async function startupLocale(
  store: { read(key: string): Promise<unknown> },
  timeoutMs = 1500,
): Promise<Locale> {
  let saved: unknown;
  try {
    const record = await Promise.race([
      store.read('settings'),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
    ]);
    saved = record && typeof record === 'object' ? (record as { language?: unknown }).language : undefined;
  } catch {
    saved = undefined;
  }
  return startLocale(validateLanguage(saved));
}
