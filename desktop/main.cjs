'use strict';
/**
 * MOTOBOUND desktop shell (Electron main process).
 *
 * Loads the built web game from a privileged custom scheme, keeps the window
 * fullscreen/borderless/windowed with remembered placement, mirrors the game's
 * IndexedDB saves to atomic JSON files, and bridges optional Steamworks.
 * Nothing here is needed to play the game in a browser.
 */
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  powerSaveBlocker,
  protocol,
  screen,
  session,
} = require('electron');

const { parseArgs, planSwitches } = require('./src/flags.cjs');
const {
  SCHEME,
  ORIGIN,
  mimeFor,
  resolveRequest,
  contentSecurityPolicy,
  isAllowedRequestUrl,
  isTrustedSenderUrl,
} = require('./src/protocol.cjs');
const { SaveMirror } = require('./src/save-mirror.cjs');
const {
  MODES,
  MIN_WIDTH,
  MIN_HEIGHT,
  sanitizeState,
  WindowStateStore,
} = require('./src/window-state.cjs');
const { loadSteam } = require('./src/steam.cjs');
const { createLogger } = require('./src/logger.cjs');

const options = parseArgs(process.argv, process.env);
if (options.userData) app.setPath('userData', path.resolve(options.userData));
const devToolsAllowed =
  !app.isPackaged && (options.devtools || process.env.MOTOBOUND_DEVTOOLS === '1');

// ---- Must run before `ready`: privileged scheme, GPU switches, Steam overlay ----------------
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      codeCache: true,
    },
  },
]);

const switches = planSwitches({
  platform: process.platform,
  env: process.env,
  uid: typeof process.getuid === 'function' ? process.getuid() : null,
});
for (const [name, value] of switches)
  value === undefined
    ? app.commandLine.appendSwitch(name)
    : app.commandLine.appendSwitch(name, value);

// A second launch (double click, Steam "play" twice) must neither touch the saves nor
// initialise Steam again: it hands focus to the first window and exits.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.exit(0);

const logger = createLogger(path.join(app.getPath('userData'), 'logs'), {
  echo: process.env.MOTOBOUND_LOG_STDERR === '1',
});
const log = logger.log;
log(
  `start v${app.getVersion()} electron ${process.versions.electron} chrome ${process.versions.chrome} ` +
    `${process.platform}/${process.arch} packaged=${app.isPackaged} switches=${switches
      .map((s) => s.join('='))
      .join(' ')}`,
);

const steam = loadSteam({ enabled: options.steam && primaryInstance, log });
log(`steam: ${steam.available ? `connected as ${steam.name ?? 'unknown'}` : steam.reason}`);

// ---- State ---------------------------------------------------------------------------------
const savesDir = path.join(app.getPath('userData'), 'saves');
const mirrors = {
  main: new SaveMirror({ dir: savesDir, name: 'saves', log }),
  // Ghost laps are large typed arrays: kept in their own file so a profile save
  // (and its Steam Cloud upload) stays small.
  ghosts: new SaveMirror({ dir: savesDir, name: 'ghosts', log }),
};
const mirrorFor = (key) => (key.startsWith('ghost:') ? mirrors.ghosts : mirrors.main);
const stateStore = new WindowStateStore({ dir: app.getPath('userData'), log });
let windowState = stateStore.read() ?? {};

/** @type {import('electron').BrowserWindow | null} */
let mainWindow = null;
let displayMode = 'fullscreen';
let sleepBlocker = null;
let shuttingDown = false;

// ---- Web content ---------------------------------------------------------------------------
function webRoot() {
  if (options.devWeb) return path.resolve(process.cwd(), options.devWeb);
  if (app.isPackaged) return path.join(process.resourcesPath, 'web');
  const staged = path.join(__dirname, 'web');
  return fs.existsSync(staged) ? staged : path.join(__dirname, '..', 'dist');
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start = match[1] === '' ? size - Number(match[2]) : Number(match[1]);
  let end = match[1] === '' || match[2] === '' ? size - 1 : Number(match[2]);
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  return start <= end && start < size ? { start, end } : 'unsatisfiable';
}

function registerProtocol(root) {
  const csp = contentSecurityPolicy();
  protocol.handle(SCHEME, async (request) => {
    const file = resolveRequest(root, request.url);
    if (!file) return new Response('Not found', { status: 404 });
    let stat;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    if (!stat.isFile()) return new Response('Not found', { status: 404 });
    const headers = new Headers({
      'content-type': mimeFor(file),
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache',
    });
    if (file.endsWith('.html')) headers.set('content-security-policy', csp);
    const range = parseRange(request.headers.get('range'), stat.size);
    if (range === 'unsatisfiable') {
      headers.set('content-range', `bytes */${stat.size}`);
      return new Response(null, { status: 416, headers });
    }
    const start = range ? range.start : 0;
    const end = range ? range.end : stat.size - 1;
    headers.set('content-length', String(stat.size === 0 ? 0 : end - start + 1));
    if (range) headers.set('content-range', `bytes ${start}-${end}/${stat.size}`);
    const status = range ? 206 : 200;
    if (request.method === 'HEAD' || stat.size === 0)
      return new Response(null, { status, headers });
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status,
      headers,
    });
  });
}

function destinationFor(filename) {
  const safe = path.basename(filename).replace(/[^\w.\- ]+/g, '_') || 'motobound-export';
  const image = /\.(png|jpe?g|webp)$/i.test(safe);
  let base;
  try {
    base = app.getPath(image ? 'pictures' : 'documents');
  } catch {
    base = path.join(app.getPath('userData'), 'exports');
  }
  const dir = path.join(base, 'MOTOBOUND');
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(safe);
  const stem = path.basename(safe, ext);
  let candidate = path.join(dir, safe);
  for (let n = 2; fs.existsSync(candidate) && n < 1000; n++)
    candidate = path.join(dir, `${stem} (${n})${ext}`);
  return candidate;
}

function hardenSession(ses) {
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isAllowedRequestUrl(details.url);
    if (!allowed) log(`blocked request ${details.url.slice(0, 120)}`);
    callback({ cancel: !allowed });
  });
  const granted = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(granted.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => granted.has(permission));
  ses.setDevicePermissionHandler(() => false);
  // Photo mode and telemetry export use `<a download>`: save to a predictable
  // folder instead of raising a native dialog in the middle of a race.
  ses.on('will-download', (_event, item) => {
    try {
      const target = destinationFor(item.getFilename());
      item.setSavePath(target);
      item.once('done', (_e, state) => log(`download ${state}: ${target}`));
    } catch (error) {
      log(`download refused: ${String(error)}`);
      item.cancel();
    }
  });
}

// ---- Window --------------------------------------------------------------------------------
function persistWindowState(win) {
  if (win.isDestroyed()) return;
  const bounds =
    win.isFullScreen() || win.isMaximized() || win.isMinimized() ? null : win.getBounds();
  windowState = {
    ...windowState,
    ...(bounds && displayMode !== 'borderless' ? bounds : {}),
    maximized: win.isMaximized(),
    mode: displayMode,
  };
  stateStore.save(windowState);
}

function createWindow(requestedMode) {
  const displays = screen.getAllDisplays();
  const state = sanitizeState(windowState, displays);
  displayMode = MODES.includes(requestedMode) ? requestedMode : (options.display ?? state.mode);
  const frameless = displayMode === 'borderless';
  const placement = frameless
    ? screen.getDisplayMatching({
        x: state.x ?? 0,
        y: state.y ?? 0,
        width: state.width,
        height: state.height,
      }).bounds
    : { x: state.x, y: state.y, width: state.width, height: state.height };

  const win = new BrowserWindow({
    ...placement,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    frame: !frameless,
    resizable: !frameless,
    movable: !frameless,
    hasShadow: !frameless,
    fullscreenable: true,
    autoHideMenuBar: true,
    backgroundColor: '#11191c',
    title: 'MOTOBOUND',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: devToolsAllowed,
      spellcheck: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      v8CacheOptions: 'bypassHeatCheck',
    },
  });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      event.preventDefault();
      toggleFullscreen();
    } else if (input.shift && input.key === 'F11') {
      event.preventDefault();
      applyDisplayMode(displayMode === 'borderless' ? 'windowed' : 'borderless');
    } else if (!devToolsAllowed) {
      const key = input.key.toLowerCase();
      const inspector =
        key === 'f12' ||
        ((input.control || input.meta) && input.shift && ['i', 'j', 'c'].includes(key)) ||
        (input.meta && input.alt && key === 'i');
      // A stray reload in the middle of a race would discard the session.
      const reload = key === 'f5' || ((input.control || input.meta) && key === 'r');
      if (inspector || reload) event.preventDefault();
    }
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });
  // Support aid: MOTOBOUND_LOG_CONSOLE=1 copies the page console into main.log.
  win.webContents.on('console-message', (...args) => {
    const first = args[0];
    const p =
      first && typeof first === 'object' && 'message' in first
        ? first
        : { level: args[1], message: args[2], sourceId: args[4], lineNumber: args[3] };
    if (process.env.MOTOBOUND_LOG_CONSOLE === '1' || p.level === 'error' || p.level === 3)
      log(
        `console[${p.level}] ${String(p.message).slice(0, 400)} (${path.basename(String(p.sourceId ?? ''))}:${p.lineNumber})`,
      );
  });
  win.webContents.on('did-fail-load', (_e, code, description, url) =>
    log(`did-fail-load ${code} ${description} ${url}`),
  );
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
  // A crashed renderer is reloaded (at most twice a minute) instead of leaving a dead window; the
  // saves are already on disk. Not applied to smoke runs, which must report the crash instead.
  const reloads = [];
  win.webContents.on('render-process-gone', (_e, details) => {
    log(`renderer gone: ${details.reason} (exit ${details.exitCode})`);
    if (details.reason === 'clean-exit' || options.smokeOut || win.isDestroyed()) return;
    const now = Date.now();
    while (reloads.length && now - reloads[0] > 60000) reloads.shift();
    if (reloads.push(now) <= 2) win.webContents.reload();
  });
  win.on('unresponsive', () => log('window unresponsive'));
  win.on('responsive', () => log('window responsive again'));

  let shown = false;
  const reveal = () => {
    if (shown || win.isDestroyed()) return;
    shown = true;
    if (frameless) win.setBounds(placement);
    else if (state.maximized) win.maximize();
    if (displayMode === 'fullscreen') win.setFullScreen(true);
    win.show();
    win.focus();
  };
  win.once('ready-to-show', reveal);
  const fallback = setTimeout(reveal, 15000);
  fallback.unref?.();

  for (const event of [
    'resize',
    'move',
    'maximize',
    'unmaximize',
    'enter-full-screen',
    'leave-full-screen',
  ])
    win.on(event, () => persistWindowState(win));
  win.on('closed', () => {
    clearTimeout(fallback);
    if (mainWindow === win) mainWindow = null;
  });

  mainWindow = win;
  win.loadURL(`${ORIGIN}/index.html`).catch((error) => log(`load failed: ${String(error)}`));
  if (devToolsAllowed && options.devtools) win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

function toggleFullscreen() {
  if (!mainWindow) return false;
  if (displayMode === 'borderless') {
    applyDisplayMode('windowed');
    return false;
  }
  const next = !mainWindow.isFullScreen();
  mainWindow.setFullScreen(next);
  displayMode = next ? 'fullscreen' : 'windowed';
  persistWindowState(mainWindow);
  return next;
}

/** fullscreen<->windowed switches in place; crossing the frameless boundary rebuilds the window. */
function applyDisplayMode(mode) {
  if (!MODES.includes(mode) || !mainWindow) return displayMode;
  if (mode === displayMode) return displayMode;
  if (mode === 'borderless' || displayMode === 'borderless') {
    const old = mainWindow;
    windowState = { ...windowState, mode };
    stateStore.save(windowState);
    stateStore.flush();
    createWindow(mode);
    old.destroy();
  } else {
    displayMode = mode;
    mainWindow.setFullScreen(mode === 'fullscreen');
    persistWindowState(mainWindow);
  }
  return displayMode;
}

// ---- IPC -----------------------------------------------------------------------------------
const trusted = (event) => isTrustedSenderUrl(event.senderFrame?.url ?? '');
const handle = (channel, fn) =>
  ipcMain.handle(`motobound:${channel}`, (event, ...args) => {
    if (!trusted(event)) throw new Error('untrusted sender');
    return fn(...args);
  });
const ACHIEVEMENT_ID = /^[A-Za-z0-9_]{1,128}$/;
const idList = (value) =>
  Array.isArray(value)
    ? value.filter((v) => typeof v === 'string' && ACHIEVEMENT_ID.test(v)).slice(0, 500)
    : [];

function registerIpc() {
  handle('saves:info', () => ({
    revision: Math.max(mirrors.main.revision, mirrors.ghosts.revision),
    savedAt: Math.max(mirrors.main.savedAt, mirrors.ghosts.savedAt),
    source: mirrors.main.source,
    keys: [...mirrors.main.keys(), ...mirrors.ghosts.keys()],
    path: savesDir,
  }));
  handle('saves:load', () => ({
    revision: Math.max(mirrors.main.revision, mirrors.ghosts.revision),
    entries: { ...mirrors.main.snapshot().entries, ...mirrors.ghosts.snapshot().entries },
  }));
  handle('saves:put', (key, value, revision) => {
    if (typeof key !== 'string') throw new TypeError('key');
    mirrorFor(key).put(key, value, revision);
    return mirrors.main.revision;
  });
  handle('saves:seed', (entries, revision) => {
    if (!entries || typeof entries !== 'object') throw new TypeError('entries');
    const split = { main: {}, ghosts: {} };
    for (const key of Object.keys(entries))
      (key.startsWith('ghost:') ? split.ghosts : split.main)[key] = entries[key];
    mirrors.main.replaceAll(split.main, revision);
    mirrors.ghosts.replaceAll(split.ghosts, revision);
    return true;
  });
  handle('saves:flush', () => {
    mirrors.main.flush();
    mirrors.ghosts.flush();
    return true;
  });
  handle('display:get', () => ({
    mode: displayMode,
    fullscreen: Boolean(mainWindow?.isFullScreen()),
  }));
  handle('display:set', (mode) => applyDisplayMode(mode));
  handle('display:toggle', () => toggleFullscreen());
  handle('steam:status', () => ({
    available: steam.available,
    reason: steam.reason,
    appId: steam.appId,
    name: steam.name,
  }));
  handle('steam:unlocked', (ids) => idList(ids).filter((id) => steam.isActivated(id)));
  handle('steam:unlock', (ids) => idList(ids).filter((id) => steam.activate(id)));
  handle('steam:presence', (state) => {
    const s = state && typeof state === 'object' ? state : {};
    const text = (v) => (typeof v === 'string' ? v.slice(0, 80) : null);
    const status = text(s.status)?.replace(/[^A-Za-z0-9_]/g, '') || 'Menu';
    steam.setPresence({
      steam_display: `#Status_${status}`,
      status,
      venue: text(s.venue),
      vehicle: text(s.vehicle),
      weather: text(s.weather),
      discipline: text(s.discipline),
    });
    return true;
  });
  handle('quit', () => {
    app.quit();
    return true;
  });
}

// ---- Lifecycle -----------------------------------------------------------------------------
function flushAll() {
  mirrors.main.flush();
  mirrors.ghosts.flush();
  stateStore.flush();
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});
app.on('before-quit', () => {
  shuttingDown = true;
  flushAll();
});
app.on('will-quit', () => {
  if (sleepBlocker !== null && powerSaveBlocker.isStarted(sleepBlocker))
    powerSaveBlocker.stop(sleepBlocker);
  steam.clearPresence();
  steam.shutdown();
});
app.on('child-process-gone', (_event, details) =>
  log(`child process gone: ${details.type} ${details.reason} (exit ${details.exitCode})`),
);
app.on('window-all-closed', () => app.quit());
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) event.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});
process.on('uncaughtException', (error) => {
  log(`uncaughtException: ${error?.stack ?? error}`);
  if (!shuttingDown) flushAll();
});

function buildMenu() {
  if (!app.isPackaged) {
    return Menu.buildFromTemplate([
      { label: 'Dev', submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }, { role: 'quit' }] },
    ]);
  }
  // Windows/Linux: no menu bar at all. macOS needs an app menu for Cmd+Q / Cmd+H.
  return process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'windowMenu' }])
    : null;
}

if (primaryInstance) {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(buildMenu());
    const snapshot = mirrors.main.load();
    mirrors.ghosts.load();
    log(
      `saves: ${Object.keys(snapshot.entries).length} keys, revision ${snapshot.revision}, source ${snapshot.source}`,
    );
    registerProtocol(webRoot());
    hardenSession(session.defaultSession);
    registerIpc();
    createWindow();
    sleepBlocker = powerSaveBlocker.start('prevent-display-sleep');
    if (options.smokeOut) {
      require('./src/smoke.cjs').run({
        getWindow: () => mainWindow,
        out: options.smokeOut,
        mirrors,
        savesDir,
        steam,
        log,
        quit: () => app.quit(),
      });
    }
  });
}
