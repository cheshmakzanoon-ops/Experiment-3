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

const NO_LEADERBOARDS = (reason) => ({
  available: false,
  reason,
  submit: async () => ({ ok: false, unavailable: true, reason }),
});

const DISABLED = (reason) => ({
  available: false,
  reason,
  appId: null,
  name: null,
  activate: () => false,
  isActivated: () => false,
  setPresence: () => {},
  clearPresence: () => {},
  leaderboards: NO_LEADERBOARDS(reason),
  shutdown: () => {},
});

/**
 * Steamworks leaderboards (ISteamUserStats), as the game uses them: find-or-create a board by
 * name (lowest time first, shown as a time in milliseconds), then upload a score with "keep best".
 * The enum values are the Steamworks SDK's own.
 */
const LEADERBOARD_SORT_ASCENDING = 1;
const LEADERBOARD_DISPLAY_TIME_MS = 3;
const LEADERBOARD_UPLOAD_KEEP_BEST = 1;
/** Names the game makes (src/steam/leaderboards.ts) and nothing else: checked again at the door. */
const BOARD_NAME =
  /^(?:tt\.[a-z0-9][a-z0-9-]{0,47}\.[a-z0-9][a-z0-9-]{0,47}|wc\.[a-z0-9][a-z0-9-]{0,47})\.p[1-9][0-9]{0,3}$/;
/** Same bounds as src/steam/leaderboards.ts lapScore (milliseconds). */
const SCORE_MIN = 3000;
const SCORE_MAX = 1800000;

/**
 * The leaderboard calls on top of a loaded Steam binding, or a "not available" object saying why.
 * steamworks.js 0.4.0 (the latest release) exposes achievements, stats, cloud, rich presence and
 * callbacks but NO leaderboard calls (checked against its client.d.ts), so with that binding this
 * returns the unavailable object and the game keeps every score in its outbox. A binding that
 * exposes `client.leaderboard.findOrCreate(name, sortMethod, displayType)` and
 * `client.leaderboard.uploadScore(handle, score, method, details)` (both returning promises, the
 * second resolving { scoreChanged, globalRank }) is used as is; see STEAM.md.
 */
function makeLeaderboards(client, log = () => {}) {
  const api = client?.leaderboard;
  if (!api || typeof api.findOrCreate !== 'function' || typeof api.uploadScore !== 'function')
    return NO_LEADERBOARDS(
      'the loaded steamworks.js has no leaderboard API (0.4.0 has none; see desktop/STEAM.md)',
    );
  const handles = new Map();
  const handleFor = (name) => {
    let handle = handles.get(name);
    if (!handle) {
      handle = Promise.resolve(
        api.findOrCreate(name, LEADERBOARD_SORT_ASCENDING, LEADERBOARD_DISPLAY_TIME_MS),
      );
      handles.set(name, handle);
      // A failed lookup must not poison the board for the whole session.
      handle.catch(() => handles.delete(name));
    }
    return handle;
  };
  return {
    available: true,
    reason: null,
    /** Never rejects: the page treats any failure as "keep the score, try later". */
    async submit(name, score, details) {
      if (typeof name !== 'string' || !BOARD_NAME.test(name))
        return { ok: false, reason: 'invalid board name' };
      if (!Number.isSafeInteger(score) || score < SCORE_MIN || score > SCORE_MAX)
        return { ok: false, reason: 'invalid score' };
      const extra = Array.isArray(details)
        ? details.filter((n) => Number.isInteger(n) && n >= 0 && n <= 255).slice(0, 8)
        : [];
      try {
        const handle = await handleFor(name);
        const result = await api.uploadScore(handle, score, LEADERBOARD_UPLOAD_KEEP_BEST, extra);
        return {
          ok: true,
          changed: Boolean(result?.scoreChanged),
          ...(Number.isInteger(result?.globalRank) && result.globalRank > 0
            ? { rank: result.globalRank }
            : {}),
        };
      } catch (error) {
        log(`steam leaderboard ${name} failed: ${shortError(error)}`);
        return { ok: false, reason: shortError(error) };
      }
    },
  };
}

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
    leaderboards: makeLeaderboards(client, log),
    shutdown: () => {},
  };
}

function shortError(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n')[0].slice(0, 160);
}

module.exports = { loadSteam, DISABLED, makeLeaderboards, BOARD_NAME };
