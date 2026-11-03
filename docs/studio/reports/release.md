# Release engineering report (gates G9, G10, G11)

Branch `worktree-agent-a9301a370581e5ba8` (cut from `main` at `ebf691d`). Owner: Release Engineer.
Honesty rule applied: everything marked **verified** was run in this sandbox and the command is
listed; everything else is **not verified** and says why.

## Gate status after this work

| Gate | Before | After | Basis |
| --- | --- | --- | --- |
| G9 Desktop wrapper, offline, persistent saves, fullscreen, gamepad hot-plug, packaged build launches | N | **P** | Linux x64 unpacked build launches under a virtual display, shows the menu, loads from `motobound://app/` with no network, the real settings screen writes IndexedDB **and** the atomic mirror, and a wiped profile is restored from the mirror (see Evidence). Not verified: Windows, macOS, a real GPU, a real window manager (fullscreen/borderless), real gamepad hardware. |
| G10 Steamworks: achievements, cloud save, rich presence, toggled by env | N | **P** | 54 achievements as data + pure engine (unit-tested), events wired into the game, Steam bridge, rich presence, Steam Cloud auto-cloud documented; `MOTOBOUND_STEAM=0`/`--steam=0` and "no Steam" paths tested (stubbed module) and exercised for real (the native steamworks.js module loads and fails closed with no client). Not verified: anything against a running Steam client. |
| G11 Store page assets drafted | N | **V (drafted)** | `docs/studio/store/` has the page copy, capsule/art brief, trailer storyboard, launch plan, Deck and legal checklists, achievement catalogue. Placeholders are marked; no sales numbers are invented. |

## What was built

**`desktop/` (own `package.json`, own lockfile and `node_modules`; root install, lockfile and web build untouched)**

- `main.cjs`, `preload.cjs`, `src/*.cjs`: Electron 44.9.3 shell. Loads `dist/` through the privileged
  `motobound://app/` scheme (standard, secure, fetch, stream, V8 code cache) with range support, MIME
  table, a strict CSP header and a request allow-list (no http/ws ever leaves the process); fullscreen
  by default, `F11`/`Alt+Enter`, borderless and windowed modes, remembered placement with off-screen
  protection; single instance; no menu / no DevTools / no reload keys in production; denied
  `window.open`, navigation and permissions; photo/export downloads saved without a dialog;
  screen-saver blocker; crash reload; size-capped log; GPU switch policy; `--no-sandbox` only on Linux
  as root / by env / under Steam. Details and rationale: `desktop/README.md`.
- `src/save-mirror.cjs` + `src/codec.cjs`: crash-safe JSON mirror of the IndexedDB profile
  (tmp write + fsync + verified `.bak` copy + atomic rename, SHA-256 checksum, corrupt-file
  quarantine, typed arrays preserved), `ghosts.json` split out so profile uploads stay small.
- `src/steam.cjs`: optional `steamworks.js` (optionalDependency, dynamic require); achievements, rich
  presence, overlay hook; never throws, no-op without Steam or with `MOTOBOUND_STEAM=0`.
- `electron-builder.yml`, `scripts/stage-web.cjs`, `scripts/smoke.cjs`, `src/smoke.cjs`: packaging and the
  release smoke harness. **electron-builder over electron-forge**: one declarative config produces
  nsis + zip + AppImage + mac zip and a plain unpacked folder (what a Steam depot wants); Forge needs a
  maker package per target and has no NSIS maker.
- `STEAM.md`: Steamworks checklist, Steam Cloud auto-cloud rules (`MOTOBOUND/saves/*.json`, `*.json.bak`),
  rich-presence token file, dev-time app id handling (placeholder 480 only in docs, never in code;
  `steam_appid.txt` is git-ignored).

**`src/` (web build still runs without any of it; `window.motobound?.desktop` is feature-detected)**

- `src/desktop/bridge.ts`: typed bridge + detection.
- `src/storage/desktop-mirror.ts` and a ~30-line hook in `src/storage/data.ts` (`SaveStore`): every write is
  stamped with a monotonic revision *inside the same IndexedDB transaction* and forwarded after commit;
  at open, file vs IndexedDB are reconciled by revision (newer file restores - Steam Cloud from another
  PC or a wiped profile; newer IndexedDB re-seeds the file). In a browser `DesktopMirror.detect()` is
  null and `SaveStore` behaves as before.
- `src/steam/events.ts`: tiny typed event bus. `src/steam/achievements.ts`: 54 original achievements as data
  and a pure, deterministic rule engine (`once`, `count`, `streak`, `distinct`, `sum`, `meta`).
  `src/steam/hooks.ts`: converts result frames / festival results / festival status samples into events and
  classifies discipline and Wildcard pairings. `src/steam/runtime.ts`: persists progress through the game's own
  `SaveStore` (so it is mirrored and cloud-synced), toasts unlocks, forwards to Steam, rich presence
  from `#app[data-mode]`.
- **Minimal hooks in existing code (one or two lines each):** `src/main.ts` (8 small hunks, 20 added lines: imports, install in the
  constructor, race finished, lap record, championship complete, photo taken, session started for presence,
  festival start), `src/session/free-roam.ts` (observer field + 1 call), `src/career/controller.ts` (licence
  result). The festival *results* needed no hook at all: the runtime listens to the existing
  `festival-result` window event.
- `docs/studio/store/ACHIEVEMENTS.md` is generated by `scripts/export-achievements.ts`
  (`npm run export:achievements`; `--csv` for the partner site).

**Root `package.json`:** additive scripts only (`desktop:install|start|pack|dist:linux|dist:win|dist:mac|smoke`,
`export:achievements`). `.gitignore`: `steam_appid.txt`.

## Evidence (commands run and results)

All runs were on a shared 4-core Linux sandbox (load average 12-18 from other agents), software
rendering only (SwiftShader), Xvfb with no window manager, no Steam client, no physical GPU, no gamepad.

**Unit and integration tests (vitest, targeted; the full suite was not run, per the brief)**

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 (whole project incl. tests, e2e, scripts) |
| `npx eslint` on every file added or changed (`src/steam src/desktop src/storage/desktop-mirror.ts src/storage/data.ts src/main.ts src/session/free-roam.ts src/career/controller.ts tests/achievements.test.ts tests/steam-integration.test.ts tests/desktop-shell.test.ts e2e/gamepad-basics.spec.ts scripts/export-achievements.ts`) | no findings |
| `npx vitest run tests/achievements.test.ts tests/steam-integration.test.ts tests/desktop-shell.test.ts` (new) | 16 + 18 + 21 tests pass |
| the same three plus existing tests that cover `src/storage` and the files I hooked: `bindings button-actions calibration controller-buttons input core session-identity team-career paint-livery ultra-options career festival-career meeting-flow` | 16 files, 278 tests pass (final run) |
| `career-session` and `offroad-meeting` (slow simulations that import `career/controller.ts`) | 2 files, 13 tests pass (run once, before the last desktop-only edits; no `src/` change since) |
| `node --experimental-strip-types scripts/export-achievements.ts \| diff - docs/studio/store/ACHIEVEMENTS.md` | identical (54 achievements) |

What the new tests pin down: achievement ids/names unique and Steam-API-safe, >= 30 entries, all four
disciplines + weather + clean racing + wildcard + discovery + career + mastery covered, no licensed names,
every rule references a real event field, **every achievement has a witness event stream that unlocks it and
unlocks nothing one event short**, engine determinism and no input mutation, demonstration/practice/AI
sessions never count, streak reset and scope, distinct counting, mastery thresholds; event-bus isolation;
discipline/Wildcard classification against the real vehicle and circuit catalogues; result-frame mapping;
festival status observer (baseline seeding, jump/pass/chain edges); achievement runtime (queued events, persist,
toast, Steam forward, merge from Steam, no-bridge and unreadable-save paths); save-mirror reconciliation
(restore, newer-mirror, re-seed, in-sync, failure); desktop modules (codec round-trip incl. typed arrays, atomic write,
`.bak`, torn-file recovery, checksum corruption, quarantine, debounce, protocol path safety, CSP, IPC sender trust,
launch flags, off-screen window protection, Steam fail-closed paths).

**Packaged Linux x64 build (`npm run desktop:pack`), smoke harness `desktop/scripts/smoke.cjs`**
(raw reports: `docs/studio/reports/release-evidence/packaged-linux-smoke-write.json` and `-restore.json`)

- Launched `desktop/release/linux-unpacked/motobound` (Electron 44.9.3, Chromium 152, `packaged=true`) under
  `xvfb-run`, software GL, fresh profile. **Phase "write": ok.** Menu visible after 99.6 s; page URL
  `motobound://app/index.html`, secure context, WebGL2 context created (SwiftShader), module Web Worker from a blob
  works, AudioContext/Gamepad API/IndexedDB/localStorage present, `window.motobound.desktop` present.
  **Zero console errors**, zero load failures, zero crashes (one warning: `KHR_parallel_shader_compile` unsupported).
- Clicking the real *Garage & Settings -> Apply & Save* wrote the `settings` key to IndexedDB **and** to
  `userData/saves/saves.json` (checksummed, revision 1). A `Float32Array` sent through the bridge round-tripped
  through IPC, was written to `ghosts.json`, and was read back as a `Float32Array`.
- The harness then deleted Chromium's `IndexedDB`, `Local Storage` and `Session Storage` and relaunched.
  **Phase "restore": ok.** The `settings` entry and the `Float32Array` were restored from the mirror into IndexedDB
  as typed data (menu visible after 88.8 s).
- Display round trip through the bridge reports `fullscreen: true` then `false`; there is no window manager under
  Xvfb, so the real fullscreen/borderless/multi-monitor behaviour is unverified.
- Memory at the menu, all processes, working set: **1,418-1,448 MiB** (browser 167, renderer 539-544, GPU/SwiftShader
  637-659, utility 75).
- Chromium phone-home: before `src/flags.cjs` disabled background networking, an idle dev Electron run made
  5 connection attempts to Google hosts (`android.clients.google.com`, `redirector.gvt1.com`; the sandbox proxy
  reported them). After adding `disable-background-networking`, `disable-component-update`, `disable-domain-reliability`,
  `no-pings`, sync/phishing/default-apps off, a 45 s foreground run of the packaged app produced no refused
  connections. (Observed once each way; not a packet capture.)
- **Driving session in the Electron build: not reached, so there are no in-session memory, frame-rate or
  simulation-cost numbers for the desktop build.** Six attempts (7-15 minute allowances) on the loaded software-GL
  machine. The first five never started a circuit because of defects in my own smoke script (it left the settings
  dialog modal, then matched the start button by its exact text when the label is `ENTER CIRCUIT ↗`). The sixth did start
  `Free Practice - Aurel Grand Circuit - 4 cars`: loading reached 94% ("Warming up tyres... Waiting for completed
  cockpit GPU work"), then **the GPU process exited abnormally (`child process gone: GPU abnormal-exit`, exit 512) 7 minutes
  after the start**, the game logged "The graphics context was lost. Reload to recover" and the load sat at 94% until the
  15 minute allowance ended. Machine load average was 15-19 on 4 cores with SwiftShader, so CPU starvation is the likely
  cause, but a defect (watchdog, software-rasteriser memory) is not ruled out and was not investigated further. The shell
  now reloads the window after a GPU-process loss (at most twice a minute; not re-run after that edit). For
  comparison the plain-Chromium Playwright test with the same SwiftShader flags did reach `driving` (about 10 minutes
  including the pad steps under a similar load).
- Observed in the smoke runs but not investigated: after *Apply & Save* with a changed setting the settings dialog stayed
  open for the rest of a 15 minute run on the loaded machine (the save itself landed within a second).

**Other packaging runs**

| Command | Result |
| --- | --- |
| `npm run desktop:pack` | `release/linux-unpacked` 451.5 MiB; game data 166.3 MiB (249 files, source maps excluded) |
| `npm run desktop:dist:linux` | `MOTOBOUND-0.1.0-linux-x64.zip` 236.3 MB and `-x86_64.AppImage` 243.7 MB built |
| AppImage launched with `--appimage-extract-and-run` under Xvfb | starts (`packaged=true`, Steam fails closed, empty save mirror read); not driven further |
| `npm run desktop:dist:win` (from Linux) | `MOTOBOUND-0.1.0-win-x64.zip` 270.2 MB built and inspected (contains `MOTOBOUND.exe`, `resources/web`, only the `win64` Steamworks binaries, `LICENSES.chromium.html`); **NSIS step failed: `spawn wine ENOENT`** (the installer needs Windows or wine). Never run. New script `dist:win:zip` builds the zip alone |
| `npm run desktop:dist:mac` | not attempted (needs macOS for a usable result) |
| clean `npm ci` of `desktop/` in an empty directory | 284 packages in 5 s; Electron 44 downloads its binary on first use (verified) |
| Native `steamworks.js` module loaded inside the packaged app with no Steam running | `init()` threw, the shell logged the reason and continued (`steam: Steam client not running...`) |

## Bugs found by running the real thing (and fixed)

1. **Every IPC call from the page was rejected.** The sender check compared `new URL(frameUrl).origin`
   with `motobound://app`, but `URL.origin` is the opaque string `"null"` for a custom scheme. The page
   booted and played normally (all failures are swallowed by design) while no save ever reached the
   mirror, no achievement reached Steam and no presence was sent. Found only because the smoke test waited for
   `saves.json` to exist. Fixed with a protocol+host check (`isTrustedSenderUrl`), regression-tested.
2. **GPU process killed under CPU starvation (partly mitigated, not solved).** On the shared 4-core machine one run lost
   the WebGL context about a minute after start (every shader program failed validation at the same instant, then
   "graphics context was lost"). The shell now gives software GL the same bounded 120 s GPU watchdog the repository's CI
   uses for llvmpipe, offers `MOTOBOUND_GPU_WATCHDOG_SECONDS`, and reloads the window after a renderer or GPU process
   loss (at most twice a minute, never in smoke runs). **A later session start still lost its GPU process (exit 512,
   7 minutes in) with the 120 s watchdog in place, so the watchdog is not the cure**; the cause was not isolated
   (starved CPU, software-rasteriser memory, or a real defect). Real GPUs keep Chromium's default. Cold shader
   compilation is synchronous on the GPU process here (`KHR_parallel_shader_compile` unsupported), so a slow driver on a
   weak machine could behave similarly: measure on minimum-spec hardware (G8).
3. **Four `EvalError` console errors at start-up in every run, packaged included.** First suspected to be Electron's
   dev-only security probe; a minimal Electron page with the same CSP produced none, and Playwright Chromium with the
   same CSP header reproduced exactly four errors from four blob workers. Cause: three's `KTX2Loader` starts four
   Basis-transcoder workers and the emscripten (embind) glue builds its invokers with the `Function` constructor, which
   the first CSP (`'wasm-unsafe-eval'` only) forbids; KTX2 textures would have been unavailable. The CSP now allows
   `'unsafe-eval'` (documented in `desktop/README.md` and asserted in `tests/desktop-shell.test.ts`); the packaged
   rerun has zero console errors. The residual risk is small (first-party files only, no remote or user HTML, all
   network blocked) but it is a conscious trade; replacing the transcoder build would remove it.
4. **Chromium contacted Google hosts from an idle app** (see Evidence). Fixed with switches; verified by observation only.

## Gamepad / Steam Deck (code reading + faked-API Playwright test)

**What the code does (read, not assumed)**

- `src/input/controller.ts` polls `navigator.getGamepads()` from an `InputPump` (`src/main.ts`), selects the configured
  or first standard-mapping pad, and baselines held buttons on connect so a held button is not a new press. Driving
  defaults: steering axis 0, throttle/brake buttons 7/6 (or axes), shifts 5/4, right stick vertical moves the rider on
  bikes, `pause` = 9 (Start), `camera` = 3 (Y), hybrid mode = 2 (X); pit, telemetry, replay, autopilot, mute, debug,
  reverse, DRS, overtake and flashback are unbound by default. A calibration screen, rumble channels and a
  persisted device choice exist. If the selected pad disappears the session is paused with a device-fault message and
  the keyboard remains usable.
- Outside driving the pad does almost nothing: in the menu `main.ts` runs `pollActions('off')`; when paused only
  `pause` is polled, and only while the pause modal shows a Resume button; in replay only
  pause/camera/replay/mute/debug. The festival HUD polls the pad for its retry and pause actions.
  **No code moves focus or activates a control from a D-pad, stick or A/B button anywhere in the front end.**

**Playwright with a faked Gamepad API** (`e2e/gamepad-basics.spec.ts`, run against `vite preview` on port 4205,
SwiftShader Chromium; the two real checks passed in the final run, 1.3 min and 10.3 min under load 16-22)

1. *A pad connected after load, then disconnected, never breaks the menu*: passes (no page error, still in `menu`).
2. *Start pauses and resumes a live session; unplugging mid-session is handled*: passes. The session had to be
   started with the **mouse** (see gap 1); then pad Start moved the game `driving -> paused -> driving`, R2 (button 7)
   drove for 4 s, and unplugging left the game in `paused` or `driving` with no page error.
3. *D-pad moves focus in the front-end menu*: written as an expected failure (`test.fail`) and it does fail: pressing
   D-pad down twice does not move focus. This is the recorded proof of gap 1; the day it starts passing, Playwright
   reports the test as failing, which is the cue to delete the `test.fail`.

The first run of tests 1 and 2 failed for two defects of the *test*, fixed: `GamepadEvent` cannot be constructed
from a plain object (a plain `Event` carrying a `gamepad` property is used), and the shared `finishRaceEntry` helper's
180 s allowance is too short for a software-GL session start on a loaded host (own 15 min poll).

**Gaps, in priority order**

1. **No controller navigation of any front-end screen** (paddock, setup, career, events, results, modals). A player
   cannot start a race, change a setting or leave a screen with a pad. Blocks "full controller support" and Deck
   Verified. Owner: UX/UI (gate G5).
2. The in-race pause menu opens and closes by pad but its buttons are mouse/keyboard only.
3. No on-screen button glyphs or prompts; the mapping UI shows raw indices.
4. No Steam Input integration (action sets, glyph lookup); the game relies on Steam's default "gamepad" template.
5. No hardware verification: no real pad, no Deck, no OS-level hot-plug, no sleep/resume, no background-focus
   behaviour (Chromium delivers pad state only to the focused window; the Steam overlay will interrupt it).
6. Reconnecting a pad after a device fault: the code pauses the session when the selected pad vanishes (read, not
   observed: the test accepts `paused` or `driving`), and resuming input after a reconnect is not verified.
7. Force feedback for wheels is not implemented (rumble only).

## Not verified / known limits

- Windows and macOS builds: nothing was built or run for them here (see Evidence for any cross-build
  attempted). No signing, no notarisation, no NSIS install test.
- A real GPU: all runs use SwiftShader on a shared 4-core machine. Frame rates, load times and memory
  below are for the software path and say nothing about a player's machine. No G8 evidence.
- Window manager behaviour (fullscreen toggle, borderless, multi-monitor placement): Xvfb has no WM.
- Steam: no client, no app id. Achievements, Cloud, overlay and presence were never run against Steam.
- Gamepads: a faked Gamepad API only; no hardware, no hot-plug on a real OS, no Deck.
- The `--no-sandbox` policy under the Steam Linux Runtime and AppImage (user-namespace restrictions)
  is reasoned, not tested.
- Achievement thresholds marked "tuning" in `achievements.ts` (chain points, drift score) are from
  authored content targets, not playtests.
- Rich presence needs the localisation file uploaded in Steamworks (text in `desktop/STEAM.md`).
- `Wildcard` detection is a heuristic (non-dirt vehicle at a dirt venue, motocross bike on tarmac, or a
  ruleset id containing "wildcard") because the Content department's series did not exist yet. It must
  be replaced by the real flag when that series lands.

## Findings for other departments

- **UX/UI (G5):** the front-end menu has no gamepad navigation at all; see Gamepad section.
- **Docs:** `docs/ASSET_PROVENANCE.md` says "no external font files / system fonts are used", but
  `src/main.ts` imports Saira Variable and `dist/assets/saira-*.woff2` ship (SIL OFL 1.1). The OFL
  text and the three.js / Basis notices are not shipped anywhere (`LEGAL_CHECKLIST.md`).
- **Legal/hygiene:** `src/ui/reference-catalogue.ts` ships URLs and titles of commercial racing
  games in the production bundle (dev-gated behind `?dev`, but present). Legacy "APEX" strings remain in
  exported file names, the credits heading and the IndexedDB name.
- **Performance (G7):** main chunk is 14.6 MB raw / 4.5 MB gzip, above the 4 MB gate.
- **Engine:** cold shader compilation blocks the GPU process (no parallel compile support in Chromium
  on this path); a slow first frame is a real risk on weak GPUs (see bug 2).

## Recommended next tasks (ranked)

1. **Controller-first front end (UX/UI, G5, blocks "full controller support" and Deck Verified):** D-pad/stick
   focus navigation in menu/results/modals, A/B for activate/back, glyph prompts. `e2e/gamepad-basics.spec.ts`
   has an expected-fail test (`test.fail`) that flips when it works.
2. **Run the packaged build on real hardware** (one Windows PC with a discrete GPU, one Steam Deck): frame
   times, cold start, memory, fullscreen/borderless, gamepad hot-plug. Closes G8 and the unverified half of G9.
3. **Steam client pass** with a real app id on a private branch: achievements, Cloud (two machines), overlay,
   presence, launch options (`desktop/STEAM.md` checklist).
4. **CI matrix** (Windows, Ubuntu, macOS) running `npm run build`, `desktop:dist:*` and the smoke harness on the
   Linux job; no workflow was added here to avoid colliding with `tests/ci-workflow.test.ts` and with the PM.
5. **Ship the notices** (OFL font, three.js MIT, Basis Apache-2.0, Electron/Chromium) in the credits and the
   depot, and strip the reference catalogue from production bundles.
6. **Replace placeholders:** app id `io.motobound.game`, `desktop/build/icon.png` (legacy "A" glyph),
   Steam capsule art, achievement icons, the Wildcard detection heuristic.
7. **Menu for display mode** (fullscreen/borderless/windowed) using `window.motobound.desktop.display`.
8. **Deck defaults** (UI scale, quality, 40 fps cap) once measured on a Deck.
9. **Trim the bundle** (G7) before the first public build: the 14.6 MB chunk also inflates cold start in Electron.
