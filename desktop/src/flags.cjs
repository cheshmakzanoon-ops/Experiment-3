'use strict';
/**
 * Launch arguments and Chromium switches, as pure functions so the policy is
 * testable and logged. Applied by main.cjs before `app.whenReady()`.
 */

/** Parse the launch arguments the shell understands (Steam launch options). */
function parseArgs(argv, env = {}) {
  const args = argv.slice(1).filter((a) => a.startsWith('--'));
  const value = (name) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const has = (name) => args.includes(`--${name}`);
  let display = null;
  if (has('windowed')) display = 'windowed';
  if (has('borderless')) display = 'borderless';
  if (has('fullscreen')) display = 'fullscreen';
  return {
    display,
    devWeb: value('dev-web'),
    devtools: has('devtools'),
    steam: !(value('steam') === '0' || env.MOTOBOUND_STEAM === '0'),
    userData: value('user-data') ?? env.MOTOBOUND_USER_DATA ?? null,
    smokeOut: env.MOTOBOUND_SMOKE_OUT ?? value('smoke-out'),
    noSandbox: has('no-sandbox') || env.MOTOBOUND_NO_SANDBOX === '1',
  };
}

/**
 * Switch plan: [name] or [name, value] pairs.
 * - Racing needs the discrete GPU and a steady frame clock: ignore the GPU
 *   blocklist (old drivers still run WebGL2 fine), keep timers and renderer
 *   priority when the window is occluded by the Steam overlay, and let audio
 *   start without a prior click (the game starts it from a pad press).
 * - Software GL is opt-in (CI / virtual displays) only.
 */
function planSwitches({ platform, env = {}, uid = null }) {
  const plan = [];
  const add = (name, value) => plan.push(value === undefined ? [name] : [name, value]);
  // The game is offline by design: stop Chromium's own background traffic (component updater,
  // GCM registration, field-trial and domain-reliability pings). Observed in testing: without
  // these an idle Electron process tried to reach Google hosts.
  const disabled = ['OptimizationHints', 'MediaRouter', 'Translate', 'AutofillServerCommunication'];
  add('disable-background-networking');
  add('disable-component-update');
  add('disable-domain-reliability');
  add('disable-client-side-phishing-detection');
  add('disable-sync');
  add('disable-default-apps');
  add('no-pings');
  add('ignore-gpu-blocklist');
  add('enable-gpu-rasterization');
  add('enable-zero-copy');
  add('disable-renderer-backgrounding');
  add('disable-background-timer-throttling');
  add('disable-backgrounding-occluded-windows');
  add('autoplay-policy', 'no-user-gesture-required');
  // A game window partly covered by an overlay must keep rendering.
  if (platform === 'win32') disabled.push('CalculateNativeWinOcclusion');
  if (platform === 'linux') add('ozone-platform-hint', 'auto');
  // Cold shader compilation blocks the GPU process (the renderer has no parallel shader compile
  // here), and Chromium's watchdog kills a GPU process that stays busy too long: every program
  // then fails validation and the game shows "graphics context was lost". Software rendering on
  // a loaded CPU hit exactly that in testing, so it gets the same bounded 120 s the repository's
  // own CI uses for llvmpipe. Real GPUs keep Chromium's default unless the player overrides it.
  const watchdog = Number.parseInt(env.MOTOBOUND_GPU_WATCHDOG_SECONDS ?? '', 10);
  if (env.MOTOBOUND_SOFTWARE_GL === '1') {
    add('use-gl', 'angle');
    add('use-angle', 'swiftshader');
    add('enable-unsafe-swiftshader');
    add('gpu-watchdog-timeout-seconds', String(watchdog > 0 ? watchdog : 120));
  } else {
    if (env.MOTOBOUND_ANGLE) add('use-angle', env.MOTOBOUND_ANGLE);
    if (watchdog > 0) add('gpu-watchdog-timeout-seconds', String(watchdog));
  }
  if (disabled.length) add('disable-features', disabled.join(','));
  // Chromium's Linux sandbox needs a SUID helper or unprivileged user
  // namespaces. Steam's runtime container and AppImages often provide neither,
  // and root cannot use it at all. The renderer only ever loads first-party
  // local content under a strict CSP with no network access.
  const steamed = Boolean(env.SteamAppId || env.SteamGameId);
  if (
    platform === 'linux' &&
    (env.MOTOBOUND_NO_SANDBOX === '1' || uid === 0 || (steamed && env.MOTOBOUND_SANDBOX !== '1'))
  )
    add('no-sandbox');
  return plan;
}

module.exports = { parseArgs, planSwitches };
