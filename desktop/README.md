# MOTOBOUND desktop shell

An Electron wrapper that turns the browser game into an offline Windows / Linux / macOS
product. It has its **own `package.json` and `node_modules`**: the root install, lockfile and
web build never see Electron or Steamworks. Nothing in `src/` requires it; the web build
feature-detects `window.motobound?.desktop` and runs unchanged without it.

```
desktop/
  main.cjs            Electron main: window, privileged protocol, IPC, lifecycle
  preload.cjs         the only bridge (contextBridge) exposed to the page
  src/protocol.cjs    motobound://app/ scheme: path safety, MIME, CSP, request allow-list
  src/save-mirror.cjs atomic, checksummed JSON mirror of the IndexedDB saves (+ .bak)
  src/codec.cjs       JSON codec for typed arrays / Date / Map / Set / NaN
  src/window-state.cjs placement + display mode persistence, off-screen protection
  src/flags.cjs       launch options and Chromium switch policy (pure, tested)
  src/steam.cjs       optional steamworks.js; never throws, no-op without Steam (+ leaderboard adapter)
  src/store-link.cjs  the demo's WISHLIST button: store address from the app id, strict allow-list
  src/smoke.cjs       release smoke test (only active when MOTOBOUND_SMOKE_OUT is set)
  scripts/            stage-web.cjs (copy ../dist or ../dist-demo), smoke.cjs (harness)
  electron-builder.yml        the game
  electron-builder.demo.yml   the Steam demo (extends the above: own appId, name, executable, output)
  STEAM.md            Steamworks setup, Steam Cloud, rich presence tokens
```

## Build and run

From the repository root (`npm run desktop:*` wraps these):

```bash
npm run build                 # the web game -> dist/ (unchanged)
npm run desktop:install       # one-off: installs Electron + electron-builder in desktop/
npm run desktop:start         # run the shell against ../dist (development)
npm run desktop:pack          # Linux unpacked directory -> desktop/release/linux-unpacked
npm run desktop:dist:linux    # AppImage + zip
npm run desktop:dist:win      # NSIS installer + zip ("portable" archive); NSIS needs Windows (or wine)
npm run desktop:dist:win:zip  # zip only: builds from Linux too
npm run desktop:dist:mac      # zip (unsigned unless you configure signing)
npm run desktop:smoke         # virtual-display smoke test (needs xvfb-run); see below
```

### The Steam demo (Next Fest)

The demo is a separate Steam app, so it is a separate build and a separate package. It is cut from
the same source: `npm run build:demo` writes `dist-demo/` (a product build with the demo content
slice, `src/release/demo.ts`; the IP guard certifies it exactly like the game) and the desktop
scripts package it under its own identity (`MOTOBOUND Demo`, appId `io.motobound.game.demo`,
executable `motobound-demo`, output `release-demo/`, so its saves and Steam Cloud files never
collide with the game's).

```bash
npm run build:demo                 # tsc + vite build -> dist-demo (edition "demo") + IP guard
MOTOBOUND_STORE_APPID=<full game app id> npm run desktop:pack:demo     # Linux unpacked -> desktop/release-demo/linux-unpacked
npm run desktop:dist:demo:linux    # AppImage + zip
npm run desktop:dist:demo:win      # NSIS installer + portable exe + zip (NSIS needs Windows or wine)
npm run desktop:dist:demo:mac      # zip
npm --prefix desktop run test:smoke:demo   # smoke test of release-demo/linux-unpacked/motobound-demo
```

`stage-web.cjs --demo` refuses a build whose `BUILD_IDENTITY.json` edition is not `demo` (and the
plain `stage` refuses a demo build), so the wrong build cannot be packaged under the wrong config.
`MOTOBOUND_STORE_APPID` is the **full game's** Steam app id; it is written into the package
(`web/STORE_LINK.json`) and read by the WISHLIST button through `src/store-link.cjs`. Without it
the button is a no-op that says the page is not live yet (the repository never contains an app id).

Electron 44's package no longer downloads its binary at install time: the first `desktop:start`
(or `npx install-electron` inside `desktop/`) fetches it, and `electron-builder` fetches its own
copy for packaging. A clean `npm ci` in `desktop/` was verified to install 284 packages and to
fetch the binary on first use.

Windows and macOS artifacts should be built on those operating systems (CI matrix); NSIS can
be cross-built from Linux but the result is unverified. Code signing and macOS notarisation
are not configured (no certificates exist).

**Why electron-builder, not electron-forge.** One declarative file produces every target the
brief lists (NSIS, zip, AppImage, mac zip) and a plain unpacked directory, which is what a
Steam depot needs. Forge would need a separate maker package per target and has no NSIS maker.

## What the shell does

- **Loads `dist/` through `motobound://app/`**, registered as a privileged standard + secure
  scheme with fetch, streaming and V8 code cache. Module Web Workers, WebAssembly streaming,
  WebGL2, audio, Gamepad API, localStorage and IndexedDB all behave as on `https://`, and the
  origin is stable, so saves survive updates. `file://` would not give the game that.
- **Offline by construction.** A CSP header on the page (`default-src 'self' blob: data:`,
  `connect-src 'self' data: blob:`, no frames or plugins) plus a `webRequest` allow-list cancel any
  http(s)/ws request, and Chromium's own background traffic (component updater, GCM, domain
  reliability, pings, sync) is switched off (`src/flags.cjs`; without those switches an idle
  Electron process was seen trying to reach Google hosts). The game makes no network request.
  `script-src` includes `'unsafe-eval'` on purpose: three's KTX2 Basis transcoder runs in blob
  workers and its emscripten glue uses the `Function` constructor; without it each of the 4
  workers throws an `EvalError` at start and KTX2 textures are unavailable.
- **Window:** fullscreen by default; `F11` / `Alt+Enter` toggle fullscreen; `Shift+F11`
  toggles *borderless windowed* (a frameless window on the current display; this rebuilds the
  window, so use it from the menu). Position, size, maximised state and display mode are
  remembered in `userData/window-state.json`, and a window saved on a disconnected monitor is
  pulled back on-screen. Launch options (also valid in Steam's launch options field):
  `--fullscreen`, `--windowed`, `--borderless`.
- **Single instance.** A second launch focuses the first window and exits without touching
  saves or Steam.
- **Production hardening.** No menu bar (macOS keeps a minimal app menu), DevTools disabled and
  `F12`/`Ctrl+Shift+I` swallowed, reload (`F5`, `Ctrl+R`) blocked so a stray key cannot drop a
  race, `window.open` and navigation outside the scheme denied, `<webview>` denied, all
  permissions denied except fullscreen / pointer lock / clipboard write, WebHID/USB denied,
  context isolation + renderer sandbox on, and Electron fuses flipped (no `RUN_AS_NODE`, no
  `NODE_OPTIONS`, no `--inspect`, app loads only from the asar). `--devtools` works only in
  an unpackaged build.
- **GPU policy** (`src/flags.cjs`): ignore the driver blocklist, GPU rasterisation and
  zero-copy, no renderer/timer throttling when the window is occluded (Steam overlay), audio
  starts without a prior click, Wayland/X11 auto-detect on Linux, occlusion tracking off on
  Windows. `MOTOBOUND_ANGLE=d3d11|gl|vulkan|metal` overrides the ANGLE backend;
  `MOTOBOUND_SOFTWARE_GL=1` selects SwiftShader (CI / virtual displays only).
- **`--no-sandbox` only where Chromium's Linux sandbox cannot start:** running as root, when
  `MOTOBOUND_NO_SANDBOX=1`, or when launched by Steam on Linux (`SteamGameId` present;
  override with `MOTOBOUND_SANDBOX=1`). Windows and macOS always keep the sandbox. On Linux
  the switch is read by the browser process very early; if a distro blocks unprivileged user
  namespaces the safe route is the Steam launch option `--no-sandbox` (see STEAM.md).
- **Crash recovery.** If the renderer or the GPU process dies, the window is reloaded (at most twice a
  minute; saves are already on disk) instead of leaving a frozen "graphics context was lost" screen. Smoke
  runs never auto-reload so they can report the failure. `GPU abnormal-exit` was seen once under heavy CPU
  starvation with software rendering (see the release report).
- **Screens stay awake** while the window exists (`powerSaveBlocker`), because a gamepad-only
  session never trips the OS idle timer.
- **Photo mode and exports** (`<a download>`) are saved without a dialog to
  `Pictures/MOTOBOUND` (PNG) or `Documents/MOTOBOUND` (everything else), de-duplicated by name.

## Saves

The game keeps profiles in IndexedDB (`apex-formula` / `saved`; see `src/storage/data.ts`).
In the shell every completed write is also mirrored to `userData/saves/`:

| file | contents |
| --- | --- |
| `saves.json` | settings, career, team, championship, festival progress, bests, achievements |
| `saves.json.bak` | the previous good state (only a verified file becomes the backup) |
| `ghosts.json` (+ `.bak`) | time-trial ghost laps (large typed arrays, kept apart so profile uploads stay small) |
| `saves.corrupt-<time>.json` | a quarantined unreadable file (last three kept) |

Writes are debounced (400 ms), written to `*.tmp`, fsynced, then renamed over the primary; a
crash at any point leaves a readable file, and `before-quit` flushes synchronously. A monotonic
revision is stored in IndexedDB in the *same transaction* as the data (key `__desktop_revision`),
so at start-up `src/storage/desktop-mirror.ts` can tell which side is newer: a newer file
(Steam Cloud from another PC, or a wiped profile) restores into IndexedDB; a newer IndexedDB
(or a first desktop launch with an existing web profile) re-seeds the file. Only the
`apex-formula` store is mirrored; the replay cache and a few localStorage preferences
(live-sky toggle, ephemeris cache) are not.

Save locations: Windows `%APPDATA%\MOTOBOUND\saves`, Linux `~/.config/MOTOBOUND/saves`, macOS
`~/Library/Application Support/MOTOBOUND/saves`. Logs: `…/MOTOBOUND/logs/main.log`. The demo
uses `MOTOBOUND Demo` in place of `MOTOBOUND` in every path above.

## Release smoke test

`npm run desktop:smoke -- --app desktop/release/linux-unpacked/motobound [--drive]` runs the
packaged game twice under `xvfb-run` with software GL: (1) the menu appears with no console
errors, a setting changed in the real settings screen lands in IndexedDB and in `saves.json`;
(2) after deleting Chromium's IndexedDB the setting is restored from the mirror. `--drive`
also starts a practice session and counts frames. The report (JSON) includes per-process
memory and the observed WebGL renderer. This proves the shell, protocol, bridge and mirror;
it does **not** prove GPU performance, gamepad hardware, Windows/macOS behaviour or Steam.

## Environment variables

| variable | effect |
| --- | --- |
| `MOTOBOUND_STEAM=0` | never load or initialise Steamworks |
| `MOTOBOUND_STEAM_APPID` | dev only: Steam app id to init with (placeholder `480`; see STEAM.md) |
| `MOTOBOUND_STEAM_OVERLAY=0` | skip the in-process-GPU overlay workaround |
| `MOTOBOUND_STORE_APPID` | the full game's Steam app id for the demo's WISHLIST button (packaging time, or run time to override) |
| `MOTOBOUND_NO_SANDBOX=1` / `MOTOBOUND_SANDBOX=1` | force Linux `--no-sandbox` on / off |
| `MOTOBOUND_SOFTWARE_GL=1`, `MOTOBOUND_ANGLE=…` | GPU backend selection |
| `MOTOBOUND_USER_DATA` or `--user-data=DIR` | relocate saves, logs and window state |
| `MOTOBOUND_LOG_STDERR=1` | echo the main log to stderr |
