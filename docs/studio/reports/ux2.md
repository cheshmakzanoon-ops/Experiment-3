# UX/UI Director report, wave 2: the front end a reviewer screenshots

Branch `studio/ux-wave2` (from `main` @ 7f2d2ed). Design system: [ART_DIRECTION.md](../ART_DIRECTION.md)
(updated: sections 8b, 9, 11, 11b, 13). Wave 1 report: [ux.md](ux.md). Screens:
`docs/studio/reports/ux2-screens/` (JPEG, 1280x720, each at most 190 KB). Everything below comes from
commands run in this worktree; anything not run is labelled. The host had 4 CPUs at load 9-14 shared with
other agents and one browser ran at a time on SwiftShader, so every browser timing is slow and none is a
performance claim.

## 1. Result at a glance

| # | Task | Status | Evidence |
| --- | --- | --- | --- |
| 1 | DIRT SERIES chips only on the DIRT plate | Done | e2e/60 test written first and seen failing on the old code, then passing; real-game before/after screens of the Circuit and Festival plates |
| 2 | Wildcard Series as the front door | Done, with two caveats (section 6) | Board of 19 events, door on the paddock board, start from the event, medal and pay on the results screen, persisted by the career save; unit tests drive the real simulation into the real career controller; 3 events re-run headlessly after a weather change |
| 3 | LIGHT dial | Done | Dial on the board, stored per profile, applied at session load; unit and DOM tests; real-game A/B: the same dirt race with the default light and with SUNSET chosen on the dial (`after-race-hud` and `after-light-race-hud`); not measured |
| 4 | HUD identity | Done for tokens, wordmark, numerals, shapes; layout untouched | unit test forbids geometry in the layer; e2e 28, 49, 52 results in section 3 |
| 5 | CONTINUE | Done (the career hub as front door is not) | DOM test: one input relaunches a form entry or a Wildcard event; stored in the save store |
| 6 | Loading screen and menu sounds | Done | loading board with the real venue line art and tips per discipline; six WebAudio sounds wired to `motobound:cue` (autoplay, volume and mute tested in a browser with a counting AudioContext; not listened to) |

## 2. What was built

### 2.1 The bug (DIRT SERIES chips on every plate)

`motocross-presentation.ts` builds the strip, and `launch-board.ts` moved it under the plates for all
disciplines. `sync()` now hides it unless the DIRT plate is active (`mx-entry[hidden]`). The two e2e
specs that clicked OUTDOOR MX from the default menu (44 and 45) now pick the DIRT plate first: that is
the contract change, not a weakened assertion (the chips are `display: none` under the other plates).
Reproduction: `before-menu-circuit` and `before-menu-festival` show the chips under CIRCUIT and FESTIVAL.

### 2.2 Wildcard Series

* **Door** (`launch-board.ts`, `wildcard-board.css`): a ticket stub on the strip under every plate: the
  count of events in stencil, a perforation, WILDCARD SERIES and "N OF 19 MEDALLED" from the career save.
  It takes the row the dirt chips used to take on the other plates, so the 1280x720 entry still fits
  without scrolling (`e2e/60` "board fits 1280x720" passes).
* **Board** (`wildcard-board.ts`, opened by `career:wildcard`): master list and programme page, not a grid
  of identical cards. Each row: number, the venue's real line art (`track-art.ts`), title, machine on
  venue, weather and light glyphs and the player's best medal (a dashed ring when none). The page of the
  chosen event: the venue map with corner numbers, the machine's plate, venue, lap length and turns,
  field, sky, rules, the one-line pitch, the medal ladder (the player's rungs say EARNED), the best
  result and the most it can pay (computed with the career's own `racePayout`, 24,000 for a six-car win).
  The rows are a roving radio group: arrow keys, Home and End select; focus selects, so a controller
  walking the list reads each event (`menu-gamepad.ts` got an up/down rule for it: the roving rows have
  `tabindex="-1"`, which its spatial search skips).
* **Start** is `career:wildcardGo:<id>`: `wildcardSession` over the player's setup, the machine loaned,
  `CareerSession.light` carrying the event's own lighting.
* **Results** (`resultsLead`, `wildcardResultHtml`): the medal earned or why none (not classified, the AI
  drove, outside the ladder), what it asked for, NEW BEST or MATCHED YOUR BEST, and the pay; the career
  payment table follows and a WILDCARD BOARD button returns. Pay, reputation and the record are
  `settleRace` over `wildcardCareerEvent`, saved in `save.results['wildcard.<id>']`: no schema change.
* **A gap I found and fixed:** a Wildcard time attack (event 18) is a time trial, and a time trial never
  reaches the chequered flag (the session stays in phase 2 after its laps: probed with the production
  simulation), so `main.finish` was never called and the event could never be settled. The controller now
  ends it when the laps are done (`CareerController.attackFinished`, called from `main.observe`).
* **New weather states:** fog on THE DESCENT IN THE CLOUD (the title says cloud), a thunderstorm on the
  harbour hypercars, a dust storm on SUPERMOTO MEETS THE JOKER. `compoundFor` now follows the weather
  catalogue (rain and storm ask for wets). Each changed event was re-run with `scripts/wildcard-races.ts`:
  all three PASS, evidence hashes current (rain 195.5 s became fog 164.8 s at 159 km/h; clear 102.1 s became
  storm 139.4 s at 86 km/h; clear 56.5 s became dust 61.6 s at 55 km/h; AI pace, one seed, loaded host).
  The three pitches were edited to match (the pitch is what the board prints).

### 2.3 LIGHT dial

`rendering/light-choice.ts` (pure): `auto` (the venue's own light: floodlit at night venues, as before),
`day`, `sunset`, `night`, `live`. Before this wave the presets were not stored at all and a circuit change rebuilt the
renderer and dropped them; LIVE was stored in `apex.sky.live.v1`. The choice is now stored per profile (LIVE
under its old key, presets beside it), applied by `GameApp.applyLight` after the circuit is built and before
the session reads it (and for the festival), and shared with the driving academy's CIRCUIT LIGHTING buttons.
A Wildcard event that names a light (`lighting`) wins for its own session only. The dial sits beside
WEATHER; to fit it the grid is now 12 columns with START shortened to Pole, Midfield, Back row and the
festival hiding its four irrelevant dials (laps, grid, start, tyres).
Weather does not suggest a light: no weather record carries one, so inventing a pairing would not be
data-driven (left out on purpose). The menu showroom is studio-lit whatever the choice, so the dial's effect
shows in the race, not in the menu (its tooltip says so).

### 2.4 HUD identity

`hud-identity.css` (injected last inside `#hud`: the race-day, compact, F1 and bike sheets are appended
there as the HUD is built, so a head style loses to them; found by the first real-game screenshot, where
only the token changes had landed). Tokens: `--apex-flame` and `--accent` to amber, panels to asphalt,
`--hud-radius` 0, the player's tower row amber with ink text. The tower header is a paper strip with the
MOTOBOUND wordmark in stencil (it replaces APEX in the tower and in the bike HUD); gear, speed, rpm,
position and lap numerals are stencil and upright. Timing, compound and flag colours are untouched.
`tests/hud-identity.test.ts` fails if the layer ever declares a geometry property, and checks it is
last. The pause and results screens had already moved in wave 1; nothing in them says APEX.

### 2.5 CONTINUE

`continue-entry.ts` and the strip: the last entry launched from the board (the form's select values or a
Wildcard event id) in the save store under `board:last:v1`, validated on read, shown as CONTINUE beside the
door and relaunching in one input. The stored value is not a session or a result.

### 2.6 Loading screen and menu sounds

`loading-board.css`, `loading-tips.ts`, `Interface.loadingScene`: a pit board with the venue's real line art
and a tip chosen from the discipline, weather, light and the player's own keys. Every tip is a rule of the
game or a line of its in-game coaching (the motocross technique card, the GP riding cues, the weather
briefs' numbers, `DRS.gap` and `DRS.fromLap`); a discipline with nothing true to add adds nothing.
`audio/ui-sounds.ts` plays `motobound:cue`: six sounds (relay click, stencil-stamp thud, pit-exit chime, latch
open, latch release, buzz), quiet (ceiling 0.35 of the player's volume), only after the first user
interaction, never queued on a suspended context, mute and zero volume respected, key repeat thinned. Modals
now emit `open` and `close`.

### 2.7 Fixed on the way

* **Track line art ignored its discipline tint** (wave 1 bug): `.ta` re-declared `--tint`, overriding the
  venue sheet's per-plate tint, so every map was cream. Removed; GP maps are teal, dirt clay, the festival atlas
  lime, and a Wildcard row takes the machine's colour.
* **The Wildcard board moved the dialog** when an event was selected (`scrollIntoView` scrolls every ancestor),
  leaving a stale strip above it in the first real-game capture. The board now scrolls only its own list.
* **A controller could not walk the board** (the roving rows are `tabindex="-1"`, which the spatial search
  skips): up and down now walk the rows (`e2e/60` has a fake-pad test).
* **HUD layer lost to the older sheets** (see 2.4).
* **A time attack could never be settled** (see 2.2).

## 3. Verification (commands actually run)

Playwright DOM specs ran through `scripts/studio/tools/pw-dom.config.ts` (no server, `CHROMIUM_PATH=/opt/pw-browsers/chromium`),
the game specs through `pw-port.config.ts` on private port 4213 against `dist/` built in this worktree.

| Command | Result |
| --- | --- |
| `npm run build` (tsc --noEmit then vite build), after the last TypeScript change; `npx vite build` again after the last CSS change; `npx tsc --noEmit` and `npx eslint src tests e2e scripts` (the `npm run lint` target) after the very last edit | all exit 0, lint prints nothing |
| `npm run validate:content` | "Content valid" |
| `node --experimental-transform-types scripts/wildcard-races.ts descent-in-the-cloud,hypercars-in-the-harbour,supermoto-meets-the-joker` | 3 of 3 PASS (numbers in 2.2); `docs/wildcard-races.json` merged |
| `npx vitest run` on 33 files: career-hub, catalogue-menu-events, event-cards, f1-hud, front-end-board, front-end-light-sound, frontend-menus, frontend-retail, motocross-hud, motocross-presentation, menu-presentation, menu-startup-sky, setup-screen, startup, team-career, wildcard-board, wildcard-series, wildcard-career-flow, hud-identity, career, career-session, sky-ephemeris, daylight-environment, offroad-meeting, replay-photo, third-party-assets, motorcycle-presentation, presentation, race-day, circuit-catalogue, circuits, events, machine-options | 33 files, 384 tests passed; vitest also printed one "Unhandled Error: Timeout calling onTaskUpdate" (worker RPC starved at load 14); after the flow tests were changed to yield, `wildcard-career-flow`, `front-end-board`, `frontend-menus`, `hud-identity`, `wildcard-board`, `front-end-light-sound`, `wildcard-series`: 7 files, 102 tests, no error |
| New and extended unit tests | `wildcard-series` 38 to 40 tests (weather states, wet tyres); `wildcard-board` 13; `wildcard-career-flow` 4 (a real simulated race and the time attack through the real career controller); `front-end-light-sound` 19; `hud-identity` 5 |
| `e2e/60-launch-board.spec.ts` + `e2e/44-motocross-interface.spec.ts` (DOM) | 14 passed (60: the original 7, the DIRT SERIES test, the door and board, CONTINUE, LIGHT, the controller walk, the sounds; 44 with the DIRT plate picked first). The DIRT SERIES test was written first and failed on the old code (the chip resolved "visible" 62 times under the CIRCUIT plate) |
| `e2e/28-race-hud-layout.spec.ts`, `e2e/49-hud-footprint.spec.ts`, `e2e/52-vehicle-hud.spec.ts` (real build, SwiftShader) | 9 passed in 3.5 min (28: its first test and the six "menu controls are reachable" viewports; 49: footprints at 1280 to 1920 wide, tower 347x263 at 1600x900; 52: vehicle pages and warnings) |
| `e2e/30-menu-access.spec.ts -g "real interface keeps all actions reachable"` (real build) | passed (1.1 min): seven viewports, real Tab walk, with the door and the LIGHT dial in the order |
| `node scripts/studio/tools/ux2shots.mjs` (seven real-game sessions; one died on my own script bug and was rerun) and `uxdom.mjs` | the screens below; 0 page errors in every completed real-game run |
| **Not run** | `npm test` (full suite), `e2e/45` (real motocross gameplay, edited to pick the DIRT plate, not run), the other menu-touching specs, a physical controller |

## 4. Screens (`docs/studio/reports/ux2-screens/`)

Real game (Chromium on SwiftShader, 1280x720, `scripts/studio/tools/ux2shots.mjs`) unless marked DOM
(the real `Interface` and CSS with a synthetic frame, no WebGL: `uxdom.mjs`).

| Screen | Before | After | Critique |
| --- | --- | --- | --- |
| Circuit plate (bug 1) | `before-menu-circuit` | `after-menu-circuit` | The DIRT SERIES row is gone and the ticket takes its place: a paper stub with a perforation reads as a different object from the dials below it, which is the point. The row says "WILDCARD SERIES / 0 OF 19 MEDALLED" and nothing about what the series is; a first-time player learns that only by opening it. Nine dials still read as a form in the lower half. |
| Festival plate (bug 1) | `before-menu-festival` | `after-menu-festival` | Before: motocross chips under a festival, the last dial row under the GO dock. After: no chips, the four dials the festival ignores are gone, SESSION takes the row, and the rules line is two lines; it fits 720p. The region atlas is now lime (the plate colour): coherent, a little loud. |
| Dirt plate | `before-menu-dirt` | `after-menu-dirt` | The chips stay here and the ticket sits below them, so this plate scrolls a little earlier than before (its own scroll region, as it already did). The map line is now clay (the tint fix), with the amber jump marks. |
| LIGHT dial | `after-race-hud` (venue default) | `after-light` (the dial), `after-light-race-hud` (the race with SUNSET chosen) | The dial shows SUNSET with its glyph, and the same dirt race starts under a warmer, directional light with long shadows instead of the soft overcast one: the existing renderer preset, now reachable and remembered. It is a modest change, not a dramatic sunset. The dial does not move the menu. The showroom does not change (it is studio-lit): the dial's tooltip says so, but a player who changes it and sees nothing happen may think it is broken. A swatch of the sky on the dial would fix that. |
| Wildcard door with medals and CONTINUE | none | `after-dom-menu-progress` (DOM) | "5 OF 19 MEDALLED" beside CONTINUE "APX-01 · VELLAMAR COAST": both fit one row of the board. The DOM fixture's data is synthetic (a played career made for the shot). |
| Wildcard board | none | `after-board`, `after-board-selected` (real game, empty career) | A list of 19 with real line art and a programme page, not a card grid; a dirt bike on a circuit map draws a clay line on a circuit outline. Honest weak points: the right column leaves the bottom third empty at 720p, the machine and the venue share one small grey line in each row, and the dashed "no medal" rings repeat 19 times on a new career (a calm list, but nothing to see yet). `after-board-selected` shows KNOBBLIES ON THE BANKING: the clay line of the dirt bike on the oval. |
| Wildcard result | none | `after-dom-wildcard-result` (DOM, the real career controller and `settleRace`, synthetic finishing frame) | The medal, what it asked for, NEW BEST and the pay lead the screen. At 720p the classification and the payment table are below the fold; the medal and the total are not. |
| Loading | `before-race-loading` | `after-race-loading`, `after-wildcard-loading` | Flat asphalt, the real venue line art (with jump marks on a motocross course, floodlit-street corner numbers on the Wildcard night event), a stencil percent, and a tip that is true (the motocross weight keys with the player's own bindings; heavy rain for the wet Wildcard event). Weak: the left column floats in the middle with a lot of empty space above, and the session line wraps to two lines. |
| Race HUD (dirt, same scene) | `before-race-hud` | `after-race-hud` | Same footprint. The tower header is a paper strip with MOTOBOUND in stencil (APEX is gone), the player's row is amber with ink text, the gear numeral is stencil. Still F1-derived: the instrument cluster silhouette and its rings, the S1/S2/S3 panel with its yellow underline and the compact cards; they use the new tokens but keep their old shapes, because their geometry is under test. |
| Race HUD (Wildcard night race) | none | `after-wildcard-hud` | The whole chain in the real game: board, START EVENT, loading, a wet-tyre grid on the neon street circuit at night, the new tower header. The pause and briefing screens say GRAND PRIX, not the event's name (listed below). |
| Briefing and pause | `before-race-briefing`, `before-race-pause` | `after-race-briefing`, `after-race-pause`, `after-wildcard-briefing`, `after-wildcard-pause` | Unchanged chrome (wave 1 had moved them); only the HUD behind them changed. |

Captures taken on earlier builds of the session (the HUD with only the token part of the layer, the board with
the dialog scrolled) were dropped and retaken.


## 5. Files

New: `src/ui/wildcard-board.ts` and `.css`, `continue-entry.ts`, `loading-tips.ts`, `loading-board.css`,
`hud-identity.css`, `src/rendering/light-choice.ts`, `src/audio/ui-sounds.ts`; tests `wildcard-board`,
`wildcard-career-flow`, `front-end-light-sound`, `hud-identity`; tools `scripts/studio/tools/ux2shots.mjs`,
`pw-dom.config.ts`; `docs/studio/reports/ux2-screens/`.
Changed: `src/ui/launch-board.ts` (strip, door, CONTINUE, LIGHT glyphs, HUD layer injection),
`interface.ts` (LIGHT dial, board binding, `resultsLead`, `loadingScene`, cues on modals), `glyphs.ts`
(sunset, night, live, venue, close; weather and light glyph tables), `front-end.css` (12-column grid, festival dials, the track-art tint fix),
`menu-gamepad.ts`, `src/career/controller.ts` (wildcard open/start/finish, `attackFinished`, `changed` hook),
`wildcard-series.ts` (three weather states, wet-tyre rule), `docs/wildcard-races.json` (re-run evidence),
`src/main.ts` (LIGHT, CONTINUE, the door tally, loading scene, time attack end), `live-sky.ts` (key constant),
`f1-hud.ts` and `bike-hud.ts` (wordmark), `ux-fixture.ts` and `uxdom.mjs` (new scenes),
`e2e/44`, `45` (pick the DIRT plate), `e2e/60` and its fixture, `ART_DIRECTION.md`.
`style.css` is untouched (a unit test reads two of its strings).

## 6. Not done, unverified, known issues

* **Career hub as the front door (ux.md next task 2) is not done**: the hub is still four identical cards.
  Wildcard is reached from the paddock board and from the results screen, not from CAREER.
* **Pause and briefing do not name a Wildcard event**: they say GRAND PRIX and the venue.
* **The LIGHT dial shows nothing in the menu** (studio-lit showroom). Its effect in the race is in the A/B screens
  (default light and SUNSET on the same dirt race); NIGHT and DAY were not captured, and LIVE (the real sun) was
  not verified at all: it uses the existing LIVE code with a stored fix or the time zone.
* **Weather does not suggest a light** (no weather data carries one): not invented.
* **Wildcard results in the real game:** the medal banner is verified by the real career controller fed with
  real simulated sessions (a race and the time attack) and by a DOM screenshot; I did not play a Wildcard race
  to the flag in the browser (software GL takes tens of minutes for a race). The time-attack ending in the
  browser (`main.observe` calling `finish`) is therefore unobserved there; its logic is tested.
* **Menu sounds were not listened to.** What is verified: the recipes (length, level, count), the autoplay
  gate, volume and mute, and that a real click builds oscillators on a counting context. Their taste is
  unjudged. There is no separate "menu sounds" setting: only the master volume and the mute key.
* **HUD:** the cluster, sector panel and compact/offroad cards keep their old shapes (see the screens table);
  the festival, replay and photo HUDs were not touched or looked at; Team HQ, photo studio and grid
  presentation still inherit the old skin.
* **A vitest "Unhandled Error: Timeout calling onTaskUpdate"** appeared once in the 33-file run (host load
  of 10-14: the worker was starved while a test stepped the simulation); all 384 tests passed. The flow tests
  now yield between stretches. They take about 30 s together; that is the price of using the real simulation.
* **Not run:** `npm test` (the full suite), the other menu-touching e2e specs (application, 15, 17, 45, 48,
  59, motorcycle flows), a physical controller, any non-Chromium browser, any hardware GPU.
* Screens: the circuit-plate "before" and "after" were captured on different boots; menu lighting and the
  showroom car are the same, but the capture is not pixel-matched.

## 7. Recommended next tasks (ranked)

1. **Career hub as the front door:** replace the four-card grid with the plates plus a Wildcard strip, add
   reputation and the next licence test under each, and open CAREER from CONTINUE when the last entry was a
   career event.
2. **Name the event on pause, briefing and results** when it is a Wildcard event, and put the machine's
   plate on them (one `CareerSession` lookup).
3. **A real Wildcard race to the flag in the browser** on a machine with a GPU (time attack and a race),
   to see the banner and the pay in the live game, and the LIVE sky.
4. **LIGHT preview:** a swatch of the chosen sky on the dial or a lit showroom, so the dial answers when it
   is touched.
5. **Rich pickers** for venue and machine (ux.md next task 5), now that the rows of the board show how well
   line-art thumbnails read.
6. **Finish the HUD:** reshape the instrument cluster and the sector panel inside their footprints, and move
   the festival and replay HUDs onto the layer; run the whole HUD e2e set on a machine that is not loaded.
7. **A "menu sounds" setting** (off, quiet, normal) and a listening pass by someone who is not me.
8. **Run the menu-touching e2e set in CI** (not on this host).
