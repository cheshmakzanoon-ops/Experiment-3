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

SMOKE_EVIDENCE_PLACEHOLDER

## Bugs found by running the real thing (and fixed)

1. **Every IPC call from the page was rejected.** The sender check compared `new URL(frameUrl).origin`
   with `motobound://app`, but `URL.origin` is the opaque string `"null"` for a custom scheme. The page
   booted and played normally (all failures are swallowed by design) while no save ever reached the
   mirror, no achievement reached Steam and no presence was sent. Found only because the smoke test waited for
   `saves.json` to exist. Fixed with a protocol+host check (`isTrustedSenderUrl`), regression-tested.
2. **GPU process killed under CPU starvation.** On the shared 4-core machine one run lost the WebGL
   context 55 s after start (every shader program failed validation at the same instant, then "graphics
   context was lost"). The shell now gives software GL the same bounded 120 s GPU watchdog the repository's CI
   uses for llvmpipe, offers `MOTOBOUND_GPU_WATCHDOG_SECONDS`, and reloads a crashed renderer at most twice a
   minute. Real GPUs keep Chromium's default. **This is a hint, not a proof, about real hardware: cold
   shader compilation is synchronous on the GPU process here (no `KHR_parallel_shader_compile`), so a slow
   driver on a weak machine could hit the same watchdog.** Measure on min-spec hardware (G8).
3. Electron's own *dev-only* security probe logs `EvalError` lines under the strict CSP. See Evidence for
   whether they appear in the packaged build.

## Gamepad / Steam Deck (code reading + faked-API Playwright test)

GAMEPAD_PLACEHOLDER

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
