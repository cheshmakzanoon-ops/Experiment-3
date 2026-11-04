# Release engineering + marketing capture, wave 2 (demo, leaderboards, CI matrix, store shots)

Branch `studio/release-demo-ci-shots`, cut from `main` at `c818caa`. Owner: Release Engineer.
Honesty rule as in `release.md`: **verified** means a command was run in this sandbox and is listed;
everything else says what was not run and why. Sandbox facts that matter: 4 shared CPUs at load 6-13
(other agents), software GL only (SwiftShader), no Steam client, no Windows or macOS machine, no GitHub
runners, no GPU.

## Scope and result

| # | Deliverable | Status |
| --- | --- | --- |
| 1 | Demo build (`MOTOBOUND_DEMO=1`, `npm run build:demo`) with a data-driven content slice, FULL GAME plates, a wishlist button through the desktop bridge, tests, desktop packaging | **Done and verified** on Linux. Windows/macOS demo packages not built. Wishlist never run against a real store page (no app id exists). |
| 2 | Steam leaderboards and rich presence polish | **Pipeline, local screen and presence done and unit-tested; Steam upload is blocked by the binding.** steamworks.js 0.4.0 (the latest release) has no leaderboard API (read from its `client.d.ts`), so nothing can reach Steam today. See "Leaderboards: the gap". Rich presence not run against Steam. |
| 3 | CI packaging matrix and the `build:qa` job splits | **Written and validated statically only** (real YAML parse of all 61 workflows, 73 workflow tests). Never run on GitHub. Linux package + smoke were run by hand. |
| 4 | Store screenshot director | **Done: tool plus 10 shots captured and kept** (one is not a jump, one fog frame is weak; see "Store screenshots"). All on software GL, none on a GPU. |

## 1. Demo build

**What it contains** (`src/release/demo.ts`, one table, `DEMO_SLICE`): 3 venues (Aurel and Vellamar
circuits, Valley Ridge motocross), 4 machines (APX-01 and FX-26 formula cars, GP-R1, MX-450), 5 Wildcard
events (descent in the cloud: fog, formula on the wall, knobblies on the banking, prototypes and the
flyover, desert trucks on the iced col: snow), the first licence (braking), and a 15-minute visit to the
Solvane coast in an EH-3 or RD-2 (the festival lends road cars; the circuit machines are for circuits).
All weather, light, replay, photo studio and settings stay open. An open Wildcard event loans its own
venue and machine for that event only, exactly as the full game does.

**How it is gated (a policy, not scattered ifs).** `demoPolicy()` is null in the full game and every gate
is `!policy || policy.x(id)`, so the full game takes the same code path as before.

| Gate | Where |
| --- | --- |
| any session start (paddock form, CONTINUE, career, Wildcard board, meeting, first lap) | `main.ts` `start()` and `startFestival()` call `demoSessionLock` (`src/release/demo-gates.ts`) |
| the paddock form's "Cannot start" and rules lines | `ui/interface.ts` `formOptions`, `ui/machine-options.ts` `sessionRulesSummary` |
| venue and machine lists per discipline plate, entry defaults | `ui/disciplines.ts` (`venuesFor`, `machinesFor`, `entryDefaults`) and `ui/launch-board.ts` `sync` (disables locked options and motocross chips) |
| `<option>` lists | `ui/circuit-menu.ts`, `ui/machine-options.ts` list locked entries disabled with "FULL GAME" |
| Wildcard board and tally | `ui/wildcard-board.ts` (open events first, locked rows and a FULL GAME panel, no start button) |
| career | `career/registry.ts` `liveRegistry` cuts the registry to the slice, `licenceAvailability` locks four licences, tier reasons say FULL GAME (`career/ladder.ts`), hub labels (`ui/career-hub.ts`) |
| festival | a clock that counts only driving seconds (`festivalClock`), a HUD chip, an end screen (`main.ts`) |
| plates and the wishlist button | `ui/demo-plate.ts` (+ css); the button exists only where the desktop shell offers `shell.openStore` |

**Honest limits.** The demo gates availability, not bytes: the locked content's code and data are still in
the bundle (dist-demo is 129 MB, the same as the game; the heavy assets are the Aurel venue every circuit
uses). The EVENTS, CHAMPIONSHIP and DRIVING ACADEMY screens still list the full catalogues; starting
anything locked from them is refused at the session start with a toast. A save from the full game is not
carried into the demo (different app, different userData folder).

**Build and identity.** `vite.config.ts` defines `__DEMO_BUILD__` from `MOTOBOUND_DEMO=1` and writes
`edition: "demo"` into `BUILD_IDENTITY.json`; `variant` stays `"product"`, so the IP guard certifies it
(inside `vite build`, again in `scripts/build-demo.mjs`, again in `desktop/scripts/stage-web.cjs`). Output
goes to `dist-demo/` (git-ignored). `scripts/publish-validated-release.sh` refuses any edition but `full`,
and `tests/ip-guard.test.ts` pins the identity shape.

**Desktop.** `shell.openStore(source)`: the page sends only a campaign label; `desktop/src/store-link.cjs`
builds `https://store.steampowered.com/app/<id>/?utm_...` from `MOTOBOUND_STORE_APPID`, checks it against a
strict allow-list (https, that host, `/app/<digits>/`, utm query only) and opens it; with no id staged it
opens nothing and says the page is not live. `stage-web.cjs --demo` refuses a build of the other edition.
`electron-builder.demo.yml` extends the base config with its own appId, product name, executable and output
folder. **Bug found by reading the packaged `app.asar`:** the builder's `productName` does not rename the
userData folder (Electron reads the `package.json` inside the app), so the first demo package would have
shared `MOTOBOUND/` (saves, logs, Steam Cloud root) with the game. Fixed with `extraMetadata`
(`productName: MOTOBOUND Demo`), re-packaged, asar re-read, and pinned by a test.

**Verified.**

| Command | Result |
| --- | --- |
| `npm run build:demo` | pass: tsc, vite, IP guard clean (twice), `BUILD_IDENTITY.json` `variant: product, edition: demo`, title "... · DEMO", 129 MB |
| `npm run build` (default) | pass: IP guard clean, `edition: full`; the full game's output is otherwise unchanged |
| real browser on `dist-demo` (`scripts/studio/tools/demo-check.mjs`, Chromium + SwiftShader) | board plate "44 more circuits, 51 more machines, 16 more wildcard events, 4 more licences"; 3 venues and 4 machines selectable, 44 + 54 listed as FULL GAME; festival plate offers EH-3 and RD-2 only; a locked circuit is refused ("Cannot start: RIVIERA / HARBOUR STREETS is in the FULL GAME") and the game stays in the menu; Wildcard board "5 OF 21 IN THE DEMO", 5 start buttons, 16 locked plates, locked page has no start button; licences: braking open, 4 FULL GAME; **0 console or page errors**. Evidence: `docs/studio/reports/release-2-screens/demo-*.jpg` (retaken on the final build) |
| `npm --prefix desktop ci`, `npm run desktop:pack:demo` (Linux) | pass; `release-demo/linux-unpacked/motobound-demo` 414 MB; asar `package.json` productName "MOTOBOUND Demo" |
| `npm --prefix desktop run dist:demo:linux` | pass: `MOTOBOUND-Demo-0.1.0-linux-x86_64.AppImage` 204 MB, `MOTOBOUND-Demo-0.1.0-linux-x64.zip` 197 MB, and `linux-unpacked` is kept (the CI smoke path exists) |
| `node desktop/scripts/smoke.cjs --app desktop/release-demo/linux-unpacked/motobound-demo` (xvfb, software GL), on the final package | write phase ok (46.3 s), restore phase ok (42.1 s), **zero console errors**, mirror and typed-array restore pass, and the new `release-bridge` step passes in both phases (`shell.openStore` exposed; leaderboard status answers "unavailable: Steam client not running"; a bad board name is refused). `openStore` itself is not called by the smoke (with an app id staged it would open a browser). Reports: `release-evidence/packaged-demo-linux-smoke-*.json` |
| `npm run lint`, `npx tsc --noEmit` | pass (no findings, exit 0) after the last code change |
| real browser on the final `dist-demo` (`demo-check.mjs`) | rerun on the final build: same results, 0 errors (RECORDS is in the demo paddock) |
| `tests/demo-edition.test.ts` (29), `tests/demo-desktop.test.ts` (10) | pass: slice exists in the catalogues and matches the plan, full game ungated, session gate (default field, GP bike, mixed grids, festival loans, Wildcard loans matched on content), lists/options/plates, career registry and licences, clock, wishlist outcomes, build wiring |

## 2. Steam leaderboards and rich presence

**Leaderboards: what exists.** Two board families, both lowest-time-wins and **per physics version**
(`tt.<circuit>.<machine>.p<n>`, `wc.<event>.p<n>`): time trial (best valid lap per circuit x machine) and
Wildcard (best valid lap of a classified, player-driven run). `src/steam/leaderboards.ts` is the pure part:
names (slug-checked, <= 128 bytes), integer-millisecond scores with a 3 s to 30 min plausibility range,
stable detail codes, a validated bounded outbox (keep-best, three tries per launch, oldest first) and a
submit loop that treats "Steam away" as not-a-failure. `leaderboard-runtime.ts` listens for two new game
events (`timetrial.lap` from `TimeTrialRecords`, `wildcard.result` from the career controller, AI-driven
runs excluded), seeds from the local boards, persists through the SaveStore (so it is mirrored and
Steam-Cloud synced) and is inert in a browser or a shell without the calls. The shell side
(`desktop/src/steam.cjs` `makeLeaderboards`, `steam:lb:*` IPC, preload) validates names and scores again.
`SaveStore.keys(prefix)` was added for the screens.

**Local fallback UI (all builds).** Paddock -> **RECORDS**: per circuit and machine the local top ten
(driver, time, weather, assists, a GHOST mark when the personal best is saved as a ghost) and the
Wildcard best lap, medal and finish per event; in the desktop build each board also shows ON STEAM or
QUEUED and the top line says whether Steam is taking scores. The paddock now has ten entries, so three
pinned counts changed (`tests/frontend-menus.test.ts`, `e2e/30-menu-access.spec.ts`,
`e2e/44-motocross-interface.spec.ts`: 9 -> 10, the e2e specs not run here).

**Leaderboards: the gap.** The brief assumed steamworks.js can do leaderboards. It cannot: version 0.4.0
is the latest on npm and its `client.d.ts` has achievements, stats, cloud, rich presence, callbacks,
lobbies, workshop and input, and no `FindOrCreateLeaderboard` / `UploadLeaderboardScore`. So the adapter
reports "unavailable" with that reason (shown on the RECORDS screen) and scores wait in the outbox. The
adapter is written against the SDK call shape and tested with a fake client; **it has never run against
Steam**. The way out is an owner decision (extend a steamworks.js fork with the three calls, switch the
Steam layer to an FFI binding that has them such as `steamworks-ffi-node` which I did not install or
vet, or keep boards local); `desktop/STEAM.md` "Leaderboards" has the options, the dashboard setup
(on-demand boards, ascending, time in ms, trusted writes OFF), and the trust caveat (client-submitted
times are unverified; `src/net/records.ts` is the path to trusted boards).

**Rich presence.** Ten statuses (adds `TimeTrial` and `Wildcard`), names instead of ids ("Aurel Grand
Circuit", "APX-01 Formula", "The Descent In The Cloud"), a generated localisation file
(`docs/studio/store/RICH_PRESENCE.vdf`, `npm run export:presence`) pinned by a test, and a test that
every `%key%` a status text uses is always set (Steam shows an unset key as an empty word).

**Verified.** `tests/steam-leaderboards.test.ts` (30: names for every real circuit x machine and event,
scores, outbox, submit loop, runtime with a fake bridge and store including offline, restart, queueing and
failing storage, adapter with a fake client, IPC wiring), `tests/steam-presence.test.ts` (7),
`tests/records-board.test.ts` (6, including the demo and escaping), the existing achievements and
steam-integration suites (34) all pass. RECORDS rendered in a DOM-only browser
(`release-2-screens/dom-records*`, 0 errors); not rendered in the WebGL game after the last build.

## 3. CI packaging matrix and QA job splits

- `.github/workflows/desktop-packages.yml`: a `web` job builds `npm run build` and `npm run build:demo`
  once, runs the IP guard on both, checks each `BUILD_IDENTITY.json` (`variant: product`, right edition)
  and uploads them; a `package` job (6 legs: full and demo on `windows-latest`, `ubuntu-latest`,
  `macos-latest`, `fail-fast: false`) downloads the matching build, re-checks it, installs the desktop
  shell, packages (Windows NSIS + portable + zip, Linux AppImage + zip, macOS zip), runs the **Linux smoke
  as a gate** and the **Windows smoke as information only** (`continue-on-error`, never run), refuses an
  owner-asset or `NOT_FOR_RELEASE` leftover, and uploads installers and archives only (14 days). No
  release, Pages, store or QA step; `permissions: contents: read`. `MOTOBOUND_STORE_APPID` comes from a
  repository *variable*.
- The first dry parse **found a real YAML error** in my own file (an unquoted `: ` in a step name); fixed.
- `settings-validation.yml` gets a `qa` job (the two review specs, 08 and 07:243) and
  `tyre-blankets-validation.yml` a `replay-qa` job (the review-only replay case, 3 repetitions, no
  retries), each on its own `npm run build:qa`, never uploaded, never through `npm run build`, `check:ip`
  or the guard; the product jobs are unchanged (nothing was removed or weakened). **Not split:**
  `phase27h-production.yml` is a one-off recovery workflow pinned to a historic run id and source patch;
  a QA job there would have to replay that recovery (noted for the PM; it only runs on its own file).
- `ci.yml` `validate` also builds and certifies the demo in `dist-demo` (never uploaded as
  `apex-formula-web`, never published).
- `desktop/electron-builder.yml`: NSIS and portable get distinct artifact names (they shared one global
  name, so the second `.exe` would have overwritten the first); `dist:win` now builds `nsis portable zip`.
- `tests/ci-workflow.test.ts` (73 tests, all pass) gains a real YAML parse of **every** workflow (jobs,
  steps, `needs`, tabs), the QA-job constraints for the two new splits (and the allowed-owner list now
  names four workflows), and the packaging matrix constraints (6 legs, runners, edition per script,
  smoke gating, upload globs, no publish and no QA variable anywhere in the file).

**Cannot be validated here (said plainly).** Nothing in these workflows has run on GitHub: runner images,
`apt` package names on `ubuntu-latest` (24.04 `t64` names), Windows PowerShell quoting, macOS arm64
packaging, the `windows-latest` smoke, artifact sizes (each package is about 240-450 MB) and the 45-minute
timeouts are all unproven. Windows and macOS packages are unsigned and unnotarised.

## 4. Store screenshots

`scripts/studio/tools/store-shots.mjs` boots the real game (the FULL build, render preset High) in
headless Chromium on SwiftShader and writes 1920x1080 JPEGs (q88) to `docs/studio/store/screenshots/`
with `manifest.json` (alt text, status, a note per shot), `progress.log` and a `--markdown` shot list
(pasted into `docs/studio/store/STORE_PAGE.md`). It is resumable (`--only`, `--force`, `--list`,
`--reject id --reason`, `--manifest-only`, `--budget-minutes`), runs one browser, and a failed shot
does not stop the run. Every kept image was opened and looked at.

**Result: 10 shots captured and kept, 0 failed in the final runs, 2.7 MB.** (Wall time: 01:18 to 04:43 UTC
including debugging, machine load 5-13; the last full run took 1.6 hours, one shot 8-17 minutes and one
1080p screenshot 2-9 minutes.)

| Shot | Verdict |
| --- | --- |
| `menu-board`, `wildcard-board`, `photo-studio`, `results-board` | good, the UI reads at 1080p. `results-board` comes from a race the in-game AI driver drove, a layout shot; `menu-board` was retaken after RECORDS was added |
| `gp-corner` | good: rider hung off the bike, motion blur, mountains behind |
| `snow-pass` | good: snow on the road and the pines, a DX-8 truck |
| `festival-dawn` | good: EH-3 in the festival town, low sun, event beacon. **The open world did render and screenshot on SwiftShader**; the earlier studio note (vehicle-drive.mjs) said it could not |
| `night-street-rain` | acceptable: wet street, lamps and lit windows, but it reads as dusk |
| `formula-fog-golden` | weak: dense, flat beige fog; kept as the fog shot, replace on a GPU |
| `motocross-jump` | **not a jump**: the rider is on the start straight at the crest of a roller; titled and captioned accordingly |

**What went wrong on the way (kept in the tool's comments and the page notes).** The first plan
(pick the moment by scanning the recorded replay, then seek to it) failed twice: three identical frames
of the start grid, because at the High preset the replayed frame redrew a car stuck on the grid while
the time advanced; the cause was found by exposing the *presented* car in `apexDiagnostics()` (a small
additive diagnostics field in `main.ts`, since `frame` is the live snapshot, not the replayed one). The
tool now polls the presented car at a small viewport, presses the game's own pause on the lean or the
take-off, then grows the viewport to 1080p and waits for the redraw. A first fog frame (Col d'Argent
start straight, car still rolling off the line) was rejected and retaken at Vellamar at speed. The
motocross start button leaves the form when the motocross layout docks it; the selector was widened.

**Not captured:** a Wildcard run in progress, a replay camera, festival drift and jump zones. No hero
shot was taken on a GPU, so none shows real bloom or reflection quality (gate G8).

## Not verified (summary)

- Any Steam interaction: achievements, Cloud, overlay, presence, leaderboards, the wishlist button
  against a real store page. No app id exists.
- Windows and macOS packages, the NSIS installer, the portable exe, signing, every GitHub Actions run.
- The demo's real festival clock in a running festival (unit-tested only; the clock chip and end screen
  were not screenshotted), controller navigation of the new plates and the RECORDS screen (native
  buttons and `<details>`, so the menu pad should reach them; not tried), the three e2e specs whose
  pinned paddock count changed from 9 to 10 (not run), RECORDS with real laps in the WebGL game (the
  DOM-only render used synthetic laps; the real game showed the RECORDS entry in the paddock only).
- Whether a Steam demo app may use achievements (documented as unverified in `STEAM.md`).
- The `store-shots.mjs` retake path on a GPU host (not available).

## Mistake to report

At about 01:34 UTC I killed a Chromium process (pid 21089) that belonged to another agent's
`content2-capture.mjs`, taking it for an orphan of my own earlier run. I told the orchestrator at once.
Their capture may need a rerun; nothing else of theirs was touched.

## Recommended next tasks (ranked)

1. **Decide the leaderboard binding** (fork steamworks.js, or an FFI binding, or stay local) and run it
   against a real client with a test app: until then do not claim Steam leaderboards on the page.
2. **A real Steam pass on the demo app**: app id, depots, wishlist button, Cloud root
   `MOTOBOUND Demo/saves`, rich presence file upload, whether demo achievements are allowed.
3. **Run `desktop-packages.yml` once on GitHub** (workflow_dispatch) and fix what the runners say;
   promote the Windows smoke to a gate once it passes.
4. **Demo polish on a GPU**: the 15-minute coast clock in play, the end screen, the EVENTS/CHAMPIONSHIP
   screens (hide locked entries instead of refusing at start), a demo-length playtest (the plan wants
   30-45 minutes).
5. **Replace the Wildcard presence names with a data field** (`titleCase` of the uppercase title is a
   stopgap) and add a Steam Deck defaults pass.
6. **Trim the demo bytes**: per-venue lazy assets would let the demo ship less than the game.
7. Update `RELEASE_GATES.md` (G9 packaging matrix written, G10 leaderboards blocked by the binding,
   G11 screenshots) and the 46 versus 47 circuit count in `STORE_PAGE.md` (the catalogue has 47 ids
   including the four dirt venues and reverse layouts).
