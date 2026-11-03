'use strict';
/**
 * Optional Steamworks integration through `steamworks.js` (an
 * optionalDependency, loaded dynamically).
 *
 * Contract: this module NEVER throws and NEVER blocks start-up. Without the
 * package, without a running Steam client, with `MOTOBOUND_STEAM=0` or
 * `--steam=0`, every method is a harmless no-op and `available` is false.
 * No app id is committed to the repository: Steam supplies it when it launches
 * the game (SteamAppId), or developers pass MOTOBOUND_STEAM_APPID / provide an
 * untracked steam_appid.txt next to the executable (see desktop/STEAM.md).
 */

const DISABLED = (reason) => ({
  available: false,
  reason,
  appId: null,
  name: null,
  activate: () => false,
  isActivated: () => false,
  setPresence: () => {},
  clearPresence: () => {},
  shutdown: () => {},
});

/**
 * @param {{env?: Record<string,string|undefined>, enabled?: boolean,
 *   requireFn?: (id: string) => any, log?: (message: string) => void}} options
 */
function loadSteam(options = {}) {
  const env = options.env ?? process.env;
  const log = options.log ?? (() => {});
  const requireFn = options.requireFn ?? require;
  if (options.enabled === false || env.MOTOBOUND_STEAM === '0')
    return DISABLED('disabled by MOTOBOUND_STEAM=0 / --steam=0');

  let sw;
  try {
    sw = requireFn('steamworks.js');
  } catch (error) {
    return DISABLED(`steamworks.js not available (${shortError(error)})`);
  }

  const parsed = Number.parseInt(env.MOTOBOUND_STEAM_APPID ?? '', 10);
  const appId = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
  let client;
  try {
    // With no id, steamworks.js defers to the SteamAppId set by the Steam
    // launcher or to an untracked steam_appid.txt (development).
    client = appId === undefined ? sw.init() : sw.init(appId);
  } catch (error) {
    return DISABLED(`Steam client not running or app not owned (${shortError(error)})`);
  }

  if (env.MOTOBOUND_STEAM_OVERLAY !== '0') {
    try {
      // Must run before the app is ready; main.cjs calls loadSteam() early.
      sw.electronEnableSteamOverlay?.();
    } catch (error) {
      log(`steam overlay hook failed: ${shortError(error)}`);
    }
  }

  const guard = (fn, fallback) => {
    try {
      return fn();
    } catch (error) {
      log(`steam call failed: ${shortError(error)}`);
      return fallback;
    }
  };
  let name = null;
  guard(() => {
    name = client.localplayer.getName();
  });

  return {
    available: true,
    reason: null,
    appId: appId ?? null,
    name,
    activate: (id) => guard(() => Boolean(client.achievement.activate(id)), false),
    isActivated: (id) => guard(() => Boolean(client.achievement.isActivated(id)), false),
    /** Rich presence: `steam_display` selects a localisation token (see STEAM.md). */
    setPresence: (values) =>
      guard(() => {
        for (const [key, value] of Object.entries(values))
          client.localplayer.setRichPresence(key, value === null ? null : String(value));
      }),
    clearPresence: () => guard(() => client.localplayer.setRichPresence('steam_display', null)),
    shutdown: () => {},
  };
}

function shortError(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n')[0].slice(0, 160);
}

module.exports = { loadSteam, DISABLED };
