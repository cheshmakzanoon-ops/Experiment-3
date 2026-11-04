'use strict';
/**
 * Where the Steam demo's WISHLIST button goes.
 *
 * The page never supplies a URL and the web build never opens one: it asks the shell (preload
 * `shell.openStore(source)`), and the shell builds the address itself from the full game's
 * store app id and checks the result against a strict allow-list before `shell.openExternal`.
 * The app id is not in the repository (it belongs to the owner's Steamworks account, see
 * STEAM.md): `desktop/scripts/stage-web.cjs` writes it into `web/STORE_LINK.json` from
 * MOTOBOUND_STORE_APPID at packaging time, and the same variable overrides it at run time.
 * With no id configured the placeholder is returned and nothing is opened, so a player is never
 * sent to a broken page.
 */

const STORE_HOST = 'store.steampowered.com';
/** The placeholder shape shown in logs and docs; it is never opened. */
const STORE_PLACEHOLDER_URL = `https://${STORE_HOST}/app/<FULL_GAME_APP_ID>/`;
const APP_ID = /^[1-9][0-9]{0,9}$/;
const SOURCE = /^[a-z0-9-]{1,32}$/;
const UTM_KEYS = new Set(['utm_source', 'utm_medium', 'utm_campaign']);

/** A Steam app id as a string, or null. Accepts a number or a digit string. */
function parseAppId(value) {
  const text =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  return APP_ID.test(text) ? text : null;
}

/** Campaign label from the page: lowercase letters, digits and dashes, else `demo`. */
function cleanSource(value) {
  return typeof value === 'string' && SOURCE.test(value) ? value : 'demo';
}

/**
 * The store address for an app id and campaign label, or null when no valid id is configured.
 * `https://store.steampowered.com/app/<id>/?utm_source=motobound-demo&utm_medium=in-game&utm_campaign=<source>`
 */
function buildStoreUrl(appId, source) {
  const id = parseAppId(appId);
  if (!id) return null;
  const query = new URLSearchParams({
    utm_source: 'motobound-demo',
    utm_medium: 'in-game',
    utm_campaign: cleanSource(source),
  });
  return `https://${STORE_HOST}/app/${id}/?${query}`;
}

/** The only addresses `openExternal` may receive: https, the Steam store host, /app/<id>/, utm query only. */
function isAllowedStoreUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== STORE_HOST) return false;
  if (parsed.username || parsed.password || parsed.port || parsed.hash) return false;
  if (!/^\/app\/[1-9][0-9]{0,9}\/$/.test(parsed.pathname)) return false;
  for (const key of parsed.searchParams.keys()) if (!UTM_KEYS.has(key)) return false;
  return true;
}

/** The configured app id: the environment first, then the staged `STORE_LINK.json`. */
function configuredAppId(env, config) {
  return parseAppId(env?.MOTOBOUND_STORE_APPID) ?? parseAppId(config?.appId);
}

/**
 * Open the store page. Never throws.
 * @param {{env?: Record<string,string|undefined>, config?: {appId?: unknown}|null, source?: unknown,
 *   openExternal: (url: string) => Promise<void>|void, log?: (message: string) => void}} options
 * @returns {Promise<{opened: boolean, reason: string|null}>}
 */
async function openStore(options) {
  const log = options.log ?? (() => {});
  const url = buildStoreUrl(configuredAppId(options.env, options.config), options.source);
  if (!url) {
    log(`store page not opened: no store app id configured (${STORE_PLACEHOLDER_URL})`);
    return { opened: false, reason: 'not-configured' };
  }
  if (!isAllowedStoreUrl(url)) {
    log('store page not opened: address failed the allow-list');
    return { opened: false, reason: 'refused' };
  }
  try {
    await options.openExternal(url);
    log(`store page opened (${cleanSource(options.source)})`);
    return { opened: true, reason: null };
  } catch (error) {
    log(`store page failed: ${error instanceof Error ? error.message : String(error)}`);
    return { opened: false, reason: 'failed' };
  }
}

module.exports = {
  STORE_HOST,
  STORE_PLACEHOLDER_URL,
  parseAppId,
  cleanSource,
  buildStoreUrl,
  isAllowedStoreUrl,
  configuredAppId,
  openStore,
};
