# UX/UI Director report, wave 3: the first hour of a Steam player

Branch `studio/ux-wave3` (from `main` @ 1425750, physics v19). Design system:
[ART_DIRECTION.md](../ART_DIRECTION.md) (new sections 14 to 18). Earlier reports: [ux.md](ux.md),
[ux2.md](ux2.md). Screens: `docs/studio/reports/ux3-screens/` (JPEG, 1280x720, each at most 200 KB; files are named
`before-<scene>-1280x720.jpg`, `after-<scene>-1280x720.jpg` for DOM captures and `real-<scene>.jpg` for the real game).
Everything below comes from commands run in this worktree. The host had 4 CPUs at load 10 to 14 shared
with other agents and one browser ran at a time on SwiftShader, so every browser timing is slow and none
is a performance claim. "DOM" below means the real `Interface` and CSS with a synthetic frame and no
WebGL (`scripts/studio/tools/uxdom.mjs`); "real game" means the built game in Chromium on SwiftShader.

## 1. Result at a glance

| # | Task | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Career as the front door | Done (season board) | DOM before/after, real-game screen, 14 new unit tests, `e2e/59` still green |
| 2 | First-run | Done; G3 not proven on hardware | real game: 1 input from the screen to driving, 0 errors; 327 s on SwiftShader (section 4) |
| 3 | Remaining screens on the tokens | Partly: Team HQ, photo studio, replay bar and lower third verified in DOM; festival panels changed but NOT seen; loading board only reviewed | section 5, anti-slop test extended |
| 4 | Results screen | Done in DOM; not seen with a real finishing frame | podium, gaps, pay slip, next step, 1200x630 PNG share card verified in a browser |
| 5 | Settings | Done in DOM and real game; frame rate is the window's, not the race's | preset guide, GPU suggestion, live frame rate, text size, colour-blind palette, reduced motion |

## 2. Career as the front door: the season board

Before: `before-career` is a stat strip, a heading ("Four disciplines. One driver.") and four identical
cards (name, a skill sentence, three facts, a meter, a button). A new player had to read all four to learn
what to do. After (`after-career`, `after-careerPlayed`, `after-careerLadder`, `real-career`, `real-career-ladder`):

* **NEXT UP ticket** with exactly one primary button: for a new driver "START THE BRAKING MARKER TEST" (the
  first licence the Club rung asks for, with the real Aurel line art it runs on), for a returning driver
  CONTINUE (a season in progress first, then the next unraced invitational, then a championship).
* **Three steps** (licence, machine, first race) while nothing is earned, the current one marked NOW. The
  machine step names a real price from the dealership and says when the driver is short of credits.
* **Wallet** (credits in stencil, the last two ledger lines, five medal discs with their names), **garage**
  (the active machine per discipline, or the loaner a new driver gets).
* **Licence ladder**: one lane per discipline with its plate, a reputation meter with a tick where each rung
  asks for it, rungs written CLEARED / NEXT / LOCKED / NO MACHINE, and one line for what the next rung asks
  ("BRAKING MARKER bronze held · CORNERING LINE bronze held · 18 reputation (you have 14)").
* `src/career/next-up.ts` derives all of it from the functions the career itself uses to lock events, so
  the board cannot name a step the career would refuse. A new test starts the event it suggests.

Contracts kept: `e2e/59-career-hub.spec.ts` passes unchanged (four `data-discipline` lanes, OPEN / COMING
with "registered yet" reasons, native buttons only, the nav's single pressed section, Tab order, no authored
motion). `tests/career-hub.test.ts` passes unchanged. The Disciplines tab label stayed (the e2e looks it up).

Critique, honest: at 1280x720 the ladder is below the fold (the ticket, steps, wallet and garage fill the first
screen) and for a new driver the third step is cut by the bottom edge; the board scrolls. The ticket is tall for
one sentence and one button. The CAREER button is still the first of nine paddock actions, not the first thing
the paddock shows: the player has to open it. The other four career pages (events, licences, garage,
dealership) only got the token pass in `screens-board.css`; they are still lists of cards.

## 3. First launch

`src/ui/first-run.ts` and `first-run.css`, opened by `main.ts` over the first menu: two radio groups (INPUT:
keyboard or controller, preselected from a connected pad; DISCIPLINE: the four plates) and DRIVE THE FIRST
LAP. The defaults are chosen, so the shortest path is one input; picking a plate and an input makes three.
The lap is the Driving Academy's programme (`academy` content: five timed laps, solo, dry, medium tyres,
the full on-track guide); the festival plate drops into the open world instead. SKIP TO THE PADDOCK, Escape
and a pad's B leave; a pad's START drives (`menu-gamepad.ts`). The radios are roving (one tab stop per
group, arrows, Home and End, focus selects, so a controller walking the screen chooses as it goes).
`firstrun:v1` in the save store is written when the screen opens, so every way out counts as seen.

A scripted browser (`navigator.webdriver`) does not get the screen unless the URL says `?firstrun=1`:
otherwise every Playwright spec and tool (`journey.mjs`, the vehicle capture) would find a modal over the
menu on a fresh profile. `?firstrun=0` never shows it.

Real game (`scripts/studio/tools/firstrun.mjs`, build of this branch): boot to the screen 64.9 s; one
input (Enter on the focused DRIVE button); `#app[data-mode=driving]` 327.2 s later; the HUD showed
"CONSISTENCY · 0/5 · BANK A CLEAN LAP" and the toast "W throttle · S brake · A / D steer · ESC pause. The
line on the road marks the braking zones."; 0 page or console errors. Screens: `real-firstrun-screen`,
`real-firstrun-driving`, DOM `after-firstRun`.

What this does not show: G3 asks for 90 s on hardware. 327 s is SwiftShader under a loaded host (the
session build alone was most of it) and says nothing about a GPU; no hardware number exists. Only the
CIRCUIT plate was driven in the real game; the GP, dirt and festival plates are verified only as form
options in the DOM spec (`e2e/61`: practice, solo, 5 laps, dry, medium, a bike on the GP plate, an
off-road machine on a different venue on the dirt plate, mode festival). The painted guide chevrons were not
looked at during the lap (the capture is a standing start). A physical controller was not used.

## 4. Results

`src/ui/results-board.ts`, `results-board.css`, `results-card.ts` (before: `before-results`, a table and
a row of six buttons; after: `after-resultsCareer`, DOM).

* Left: the position as a stencil numeral with a medal disc for the top three, the podium of three steps
  (the player's step is the marshal's highlighter), RACE TIME, GAP TO WINNER (or MARGIN OVER 2ND), BEST LAP,
  VS FASTEST LAP. Every figure is read from the final snapshot; a gap that is not positive (order and times
  disagree) is not printed. A test found and pinned that after my first fixture printed "+-2.310 s".
* Under the figures: NEXT UP from the career plan (it first sat under the payment, below the fold at 720p;
  moved up to fill the hole under the facts). The card follows the payment: the career's `changed` hook
  replaces it after the write settles.
* Right: the classification and the career payment as a pay slip (its label column no longer squeezed to
  3 em by the position-numeral rule).
* SHARE CARD (`resultsShare`): a 1200 x 630 PNG drawn on a canvas (paper strip with the wordmark, the
  position, venue, machine, figures, the venue's centreline, the podium) and saved through the browser's
  download. No network: a test fails if the module can reach one, and the DOM spec records zero requests
  while drawing. `after-shareCard` is the PNG itself.

Critique: the right column's payment sits low with empty space above it at 8 cars; no delta against
the player's own personal best (the snapshot does not carry it, and I would not print a guess); "XP" does not
exist in this game (reputation and credits do), so the pay slip shows those. I did not see the screen with a
real finishing frame in the browser (a software-GL race takes tens of minutes); the DOM spec uses a
synthetic frame whose ranks and times agree. The `changed` to NEXT UP refresh and the SHARE CARD button's
call into `main.ts` are type-checked and their parts tested, but that wiring did not run in a browser.

## 5. Remaining screens on the tokens

`src/ui/screens-board.css` (injected last): Team HQ and the career pages' shared parts, photo studio and
livery editor drawer, festival HUD variables and eyebrow, replay bar and lower third. Copy: the slogan
headings (Build something worth racing, Hold the moment, The open road, Find your repeatable lap, Make the
next lap count, ...) became plain titles with a noun or a number (Week 1, Camera and livery, Festival menu,
Five timed laps, Research studies). APEX: the default livery sponsor and decal text, the workshop sign and a
storage error now say MOTOBOUND (an existing test pinned the old default; it now pins the new one). APEX
stays where it is a racing word (the corner phase on the bike HUD, "80 M TO APEX") and in the fictional
tyre and trackside brands of the world art (APEX CORSA).

| Screen | Before | After | Critique |
| --- | --- | --- | --- |
| Team HQ | `before-team` | `after-team`, `real-team` | Stencil heading, an upright pass with a hard edge instead of the skewed orange card, token buttons and 11 px labels. The briefing paragraph is still a 36-venue list: a unit test pins its wording, so I left it. Engineering, personnel and finance pages were not captured. |
| Photo studio | `before-photo` | `after-photo` (DOM over a stand-in background) | Notched asphalt drawer, paper label, amber ranges, 11 px help text. The decal editor inside the drawer and the real 3D scene behind it were not looked at. |
| Replay | `before-replay` | `after-replay` | Paper position box and asphalt name on the lower third, flat bar. The idle-fade and letterbox were not exercised. |
| Festival menu and map | none | none | Variables, eyebrow and flat panels changed; 31 declarations of 9 or 10 px text became 11 px; four decorative gradients flattened (the drift scale is data and stays). **Not seen**: SwiftShader cannot screenshot the open world. `e2e/49` (DOM) passes 11 of 12 (section 7). Raising text sizes may crowd a panel; nobody has looked. |
| Loading | `before-loadingScreen` | `after-loadingScreen` (unchanged) | Already on the tokens from wave 2; I only reviewed it. Its weak point stands: the left column floats with empty space above and the session line wraps. |

## 6. Settings

`src/ui/settings-guide.ts`, `settings-guide.css`, `fps-meter.ts` (before `before-settings`; after
`after-settingsGuide`, DOM, and `real-settings-guide`, real game).

* **Preset guide**: four lines (LOW, MEDIUM, HIGH, ULTRA) with every value read from `graphicsPreset`, the
  chosen one marked NOW.
* **FOR THIS GPU**: the WebGL unmasked renderer name (no network; a throwaway context, released) mapped to a
  preset by family (software, RTX/GTX, Radeon RX, Apple M, Arc, integrated, handheld, mobile), stated on the
  screen as a guess from a name, with USE <preset> setting the select. Unknown names say so and keep Medium.
  The heuristics are unit-tested against name strings only; no real device was tried.
* **Frame rate**: average and 1% low over a one-second window, honest about what it measures. While the
  settings screen is open the game does not draw its own scene (the menu loop skips covered frames), so the
  readout is the rate the window delivers frames, which drops under GPU or machine load; the screen points to
  F3 for the race's own rate. A synthetic GPU test scene would give a better measurement and was not built.
* **Accessibility**: the colour-blind option now also swaps the timing colours to the Okabe-Ito rose, sky
  blue, yellow and orange (`hud-colourblind.css`, its own layer because `hud-identity.css` must not redefine
  timing colours); text size is "Text and interface size" with a percentage, previewed live and restored on
  cancel; the system's `prefers-reduced-motion` counts as much as the in-game switch (renderer shake and
  `data-reduced-motion`), the screen says so when it is on, and every new sheet carries both reduced-motion
  guards. Keyboard: every control is a native element; `e2e/62` tabs through them. The menu gamepad was
  not changed for settings and was not tried with a pad.
* Not done: contrast of the CVD palette on the actual HUD backgrounds was not measured; the palette was not
  looked at in a race HUD.

## 7. Verification (commands actually run)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` (after the last TypeScript change) | 0 errors |
| `npx eslint` on every changed or new .ts/.mjs file (src, tests, e2e, scripts) | no output |
| `npx vitest run` on 26 files: front-end-board, front-end-light-sound, frontend-menus, frontend-retail, hud-identity, career-hub, season-board, first-run, results-settings, wildcard-board, team-career, photo-reference, paint-livery, setup-screen, presentation, menu-presentation, startup, f1-hud, motocross-presentation, catalogue-menu-events, event-cards, replay-photo, settings-transition, reference-depth, career, career-session | 25 passed, 1 failed on the first run: `hud-identity` ("timing colours are not redefined here") caught my colour-blind palette in the identity sheet. Moved it to its own layer; `hud-identity` and `front-end-board` (23 tests) then passed. The other 24 files: 374 tests passed |
| New tests | `season-board` 14, `first-run` 10, `results-settings` 16 (found a wrong RTX threshold and the negative gap), `front-end-board` +6 (the wave-3 anti-slop block) |
| `e2e/60-launch-board`, `44-motocross-interface`, `59-career-hub`, new `61-first-run`, `62-results-settings` (DOM config `pw-dom.config.ts`) | 20 passed (4.2 min). `62` first failed on a real overflow at 390 px (the classification at phone width) and on my own ambiguous locator; fixed the CSS and the locator |
| `e2e/49-festival-menu-access` (DOM) | 11 passed, 1 failed: "festival map: filters, event selection..." expects the copy "Drive near the marker", which exists only in the spec at the base commit (`git grep` on 1425750 finds it in `e2e/` only). Not caused by this branch; not fixed |
| `npx vite build` | exits 0 (twice, after the last CSS and TypeScript change) |
| `node scripts/studio/tools/firstrun.mjs` (real game) | section 3 |
| `node scripts/studio/tools/ux3shots.mjs` (real game) | section 8 |
| `e2e/30-menu-access.spec.ts -g "real interface keeps all actions reachable"` (real build on port 4223, `pw-port.config.ts`) | 1 passed (59.7 s): the menu with the season board's CSS and the new sheets stays reachable by mouse and keyboard, and a scripted browser is not met by the first-launch screen |
| Final re-run after the last edit (results layout): `tsc`, `eslint`, `npx vite build` (exit 0), 7 unit files (88 tests: front-end-board, results-settings, season-board, first-run, career-hub, hud-identity, photo-reference), `e2e/62` (3 tests, DOM) | all pass |
| **Not run** | `npm test` (full suite), `npm run lint` as a whole (eslint ran on the changed files), the other real-game specs, any physical controller, any hardware GPU |

## 8. Real-game run of the paddock screens

One boot of the built game (`scripts/studio/tools/ux3shots.mjs`, SwiftShader, boot 95 s on a host at load 14):

* The scripted browser did not get the first-launch screen (`firstRunShown: false`): the paddock was
  reachable as every existing spec expects.
* CAREER opened the season board: 4 lanes, NEXT UP "BRAKING MARKER LICENCE", primary button "START THE BRAKING
  MARKER TEST" (`real-career`, `real-career-ladder`).
* GARAGE & SETTINGS showed the guide; the GPU name was "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device
  (Subzero)...), SwiftShader driver)" and the suggestion "FOR THIS GPU · LOW" ("a software renderer: there is
  no GPU doing the drawing"), which is right for this host and says nothing about a player's. The frame rate
  read 26 FPS (1% low 15) at 3.5 s and 55 FPS in the screenshot a moment later on the same screen: on a loaded
  shared host the figure moves a lot between one-second windows (`real-settings-guide`).
* Team HQ opened (`real-team`). 0 page and console errors across the run.

## 9. Files

New: `src/career/next-up.ts`; `src/ui/` `career-board.css`, `first-run.ts` and `.css`, `fps-meter.ts`,
`hud-colourblind.css`, `results-board.ts` and `.css`, `results-card.ts`, `screens-board.css`,
`settings-guide.ts` and `.css`; tests `season-board`, `first-run`, `results-settings`; `e2e/61`, `e2e/62` and
their fixtures; tools `firstrun.mjs`, `ux3shots.mjs`; `docs/studio/reports/ux3-screens/`.
Changed: `career-hub.ts` (hub page), `interface.ts` (form options extracted, first-run, results, settings
guide, text-size preview), `main.ts` (first launch, results next step and share, reduced motion),
`launch-board.ts` (sheet injection), `menu-gamepad.ts` (START and B on the first-launch screen),
`presentation.ts` (accessibility copy), `glyphs.ts` (a check mark), `festival-hud.css` and `.ts`,
`team-hub.ts`, `driving-academy.ts`, `photo-studio.ts` (headings), `storage/livery.ts`,
`storage/data.ts`, `rendering/headquarters-stage.ts` (APEX), `tests/front-end-board.test.ts`,
`tests/photo-reference.test.ts` (the default sponsor), `scripts/studio/tools/ux-fixture.ts` and `README.md`,
`ART_DIRECTION.md`.

## 10. Not done, unverified, known issues

* G3 (90 s, three inputs) is not proven: the input count is 1 to 3 by construction and measured at 1 in the
  real game; the time is unmeasured on hardware.
* The first lap is the Academy programme, not a scripted tutorial: nothing coaches the player through the
  first corner. The painted guide was not looked at in motion.
* Results were never seen with a real finished race in a browser; the share-card button and the NEXT UP
  refresh did not run in a browser.
* Festival panels, the decal editor, Team HQ's other three pages and the career's events, licences, garage
  and dealership pages are token-passed but not reviewed visually.
* The tower header in the race HUD truncates the session name ("MOTOBOUND PRAC…", `real-firstrun-driving`):
  a wave-2 item, not touched.
* A vitest "Unhandled Error" did not appear in this wave's runs.
* Pre-existing red: `e2e/49` "festival map" (stale copy).

## 11. Recommended next tasks (ranked)

1. **Measure G3 on a machine with a GPU**: run `firstrun.mjs` there, and play each plate's first lap; add a
   coach line at the first braking zone if the guide alone is not enough.
2. **Play a real race to the flag** (any plate) and look at the results board, SHARE CARD and the NEXT UP
   refresh in the live game; fix what the synthetic frame hid.
3. **Open CAREER by default for a new driver** (the season board as the paddock's first panel or a ticket on
   the board), then bring the events, licences, garage and dealership pages up to the board's level.
4. **A GPU test scene in settings** (a short synthetic load at the chosen preset) so the readout measures the
   game's cost, plus a hardware pass over the name heuristics (Steam hardware survey names).
5. **Look at the festival panels and the decal editor** on a GPU host and tune the 11 px text.
6. **Fix `e2e/49` "festival map"** (copy drifted) and run the whole menu-touching e2e set in CI.
7. **Controller pass on a physical pad** for the first-launch screen, the season board and settings.
