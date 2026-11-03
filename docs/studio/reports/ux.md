# UX/UI Director report: front end ("Paddock Board")

Branch `studio/ux-front-end`. Design system: [ART_DIRECTION.md](../ART_DIRECTION.md).
Screens: `docs/studio/reports/ux-screens/` (before-* and after-*, JPEG, each under 300 KB).

## 1. Audit of the front end as found

Evidence: the `before-menu-*` screenshots (real game, SwiftShader), and a read of
`src/ui/interface.ts`, `style.css`, `circuit-menu.ts`, `machine-options.ts`,
`motocross-presentation.ts`, `career-hub.ts`, `team-hub.ts`, the pause/results/settings builders
and how `main.ts` mounts them.

### Flow and discoverability

1. **The four disciplines were not visible.** Circuit was "the form". GP bikes were 7 options
   inside a 60-item MACHINE dropdown (optgroup "Motorcycles"). Dirt was two small chips labelled
   DIRT SERIES. Festival was one option of the SESSION dropdown, which then left laps, grid, start
   and tyres fully active although they do not apply. A player could not tell the game had bikes,
   dirt or an open world without opening dropdowns.
2. **Nine native dropdowns of equal weight.** No distinction between what you race (venue,
   machine) and how (laps, grid, start slot, assists). The venue was the text "Aurel Grand
   Circuit · 2.97 km"; 46 venues and 60 machines were flat optgroups with no preview.
3. **The primary action was clipped.** At 1280x720 ENTER CIRCUIT was cut off by the bottom of the
   scroll region and PREPARE GRID plus all nine paddock actions (Career, Events, Championship,
   Team HQ...) were below the fold; at 1920x1080 the paddock list was cut mid-row. The progression
   modes were the least visible things on the screen. (`before-menu-1280x720.jpg`,
   `before-menu-1920x1080.jpg`)
4. **Stale numbers.** The footer's length / turns / DRS were refreshed from the *loaded* track, so
   for the two original circuits (Aurel, Vellamar) the stat could show the previous circuit's
   length until a session loaded (code reading: `knownLengths` in `motocross-presentation.ts`).
5. **Irrelevant fields stayed live.** In festival mode distance, grid, tyres and start slot did
   nothing and looked identical to live ones.

### Hierarchy and identity

6. **Not ownable.** The skin was a deliberate F1 25 mimic (italic wide caps, skewed clip-path
   chips, a pink-red flame, "F1 25 pills" in the CSS comments, `ART_BIBLE_B`). It is a settings form
   in somebody else's livery. A hero slogan ("EVERY INPUT. EVERY FORCE.", "Four contact patches")
   sat on top and was hidden under 1200 px of height, so it appeared only on tall screens and
   described cars to a game that is half bikes.
7. **Decoration over information.** Gradient primary button with a coloured glow, `backdrop-filter`
   blur on dialogs, translucent panels over a busy 3D scene (legibility depended on a gradient
   scrim), gradient-clipped headline text.
8. **Brand drift.** The HUD wordmark, Team HQ, Photo Studio and Team Briefing still said APEX in a
   MOTOBOUND game.

### Consistency

9. **Three CSS generations** in `style.css` (base, "Apex broadcast skin", "F1 25 skin"): the paddock
   menu is restyled at lines 163, 2747, 3888 and 4129, dialogs at 863 and 3475, with specificity
   fights and dead rules. Four button treatments (menu list, dialog row, HUD chip, MX chip), two
   eyebrow styles, two table styles.
10. **Filler copy.** "Make it yours." (settings, photo livery), "Take control." (controls), the footer
    promise "GAMEPAD READY" while the menu had no controller navigation at all.

### Controller, keyboard, accessibility

11. **No controller navigation** anywhere except the credits list (`credits.ts` says so: "the paddock
    menu itself is driven by keyboard and pointer"). G5 asks for controller-first.
12. **Keyboard:** Tab order was fine but there was no group navigation, no consistent focus ring
    (browser default, `#f6b290`, `--apex-flame-hot` in three places), and the menu footer advertised
    driving keys that do nothing in a menu.
13. **Type and contrast:** labels at 8-10 px (`.menu-note` 8 px, field labels 10 px, hints 9 px), 50%
    white text over the 3D scene, and `--ui-scale` (Settings) was not applied to the menu at all.
14. **Career hub** shows the four disciplines as a grid of identical cards (the pattern the
    anti-slop checklist rejects). Not changed in this pass (see next tasks).


## 2. What was built

**Concept:** "Paddock Board" (full spec in [ART_DIRECTION.md](../ART_DIRECTION.md)). Ink on paper,
amber on asphalt. Number plates for disciplines, a programme-page venue sheet drawn from the real
centreline, entry-sheet dials, scrutineering stickers, stencil numerals (Saira Stencil One, OFL,
shipped with its licence under `src/ui/fonts/`).

**Paddock menu**

* Four first-class disciplines as race-number plates (CIRCUIT roundel, GP BIKE fairing plate, DIRT
  arch plate, FESTIVAL licence plate), each with its own colour, numeral, motto and counts drawn
  from the registries ("42 VENUES", "18 EVENTS"). Each plate keeps its own entry sheet while the menu
  is open.
* Event, machine, conditions, go: venue sheet (line art, kicker, lap length, turns, DRS/jump count,
  brief), then dials, then a docked GO bar. At 1280x720 the whole entry fits without scrolling.
* Every dial is still the original native `<select>` with its original id. Hands (prev/next) are
  pointer extras. The weather select, its options and its change handler are untouched; the board
  only reads its value for the icon.
* Track art comes from the data: `track-art.ts` samples the same Catmull-Rom as `Track` (its lap length
  equals `Track.length` exactly, asserted in `tests/front-end-board.test.ts`), puts corner numbers at
  the authored corner stations, DRS zones in amber, jump take-offs on terrain venues, and draws the
  festival region from `SOLVANE.roads`, `coast` and event waypoints. The dirt event cards and race
  briefing get the same art (the old control-polygon outline is gone).
* Paddock index (Career, Garage & settings, Events, Championship, Team HQ, Academy, Livery, Controls,
  Credits) is a sticky right rail, visible at 1280x720 (it used to be below the fold).
* Controller: `menu-gamepad.ts` gives D-pad/stick focus movement (spatial), left/right steps dials and
  plates, A activates, B closes a modal that offers a close, LB/RB change discipline, Start launches.
  It also covers every modal (settings, results, pause focus movement, championship). Footer hints
  switch between keyboard and pad glyphs.
* Keyboard: plates are a roving radio group (arrows, Home, End); selects keep native Up/Down/type-ahead;
  Enter on a dial confirms; one tab stop per group; a single amber focus ring.
* Wildcard Series: `registerSeries()` (documented in ART_DIRECTION section 9, contract-tested).
* Sound-cue hook `motobound:cue` (tick, select, confirm, open, close, back, deny): nothing plays yet.

**Pause, results, settings, controls, championship, error:** restyled through tokens only
(`front-end.css`, scoped to `#app dialog`): flat amber primary, paper tabs, timing-sheet results
(amber highlighter row), stencil timing figures in the pause summary, no blur, no gradient. Two real
UX fixes: modals now open scrolled to the top (the controls list opened at its last button with the
heading off-screen) and the controls list flows two pairs per row so it fits a 720p screen.

**Copy:** replaced filler headings ("Make it yours." twice, "Take control.") with what the screen is;
the menu brief line is now the career's own description of each discipline's skill; "APEX /" eyebrows
in Photo Studio, Team HQ and Team Briefing now say MOTOBOUND; the circuit brief no longer repeats the
corner/DRS counts that the sheet shows as numbers.

**Bug fixed on the way:** the length/turns stats for the two original circuits showed the previously
loaded track until a session loaded; the sheet now states the selected circuit's own lap length.

## 3. Files

New: `src/ui/launch-board.ts`, `disciplines.ts`, `track-art.ts`, `glyphs.ts`, `menu-gamepad.ts`,
`ui-cue.ts`, `front-end.css`, `fonts/saira-stencil-one-latin-400-normal.woff2`,
`fonts/OFL-saira-stencil-one.txt`; `docs/studio/ART_DIRECTION.md`; `tests/front-end-board.test.ts`;
`e2e/60-launch-board.spec.ts`, `e2e/fixtures/launch-board.ts`;
`scripts/studio/tools/uxshots.mjs` (real-game screenshots at the four viewports),
`uxdom.mjs` + `ux-fixture.ts` (fast DOM-only screens: pause, results, settings, controls),
`quickstart.mjs` (menu-to-driving probe).
Changed: `src/ui/interface.ts` (menu template, board and pad wiring, modals open at the top, headings),
`motocross-presentation.ts` (plain mottos, real line art, panel placement), `motocross.css` (removed the
polygon-outline rules), `circuit-menu.ts` (brief only), `credits.ts` (typeface licence line),
`photo-studio.ts`, `team-hub.ts`, `team-media.ts` (eyebrows and a heading), `src/simulation/track.ts`
(`catmull` exported, one word). `style.css` is untouched: the new layer wins by specificity and
injection order, so the HUD is unaffected.

## 4. Contracts and tests

No existing test was edited, weakened or skipped. Preserved: every id the e2e specs use (`#sessionForm`,
`#circuit #mode #laps #weather #opponents #compound #assist #startSlot #vehicle`, `#circuitBlurb`,
`#sessionRules`, `#circuitLength/#circuitTurns/#circuitDrs`, `#menuDriver`, `.menu-body`, `.masthead`,
`.menu-footer`, `.car-label`, `.menu-actions` with 9 buttons starting with CAREER, `.mx-entry` buttons
OUTDOOR MX / STADIUM SX, `.mx-setup`, `.mx-menu-scroll`, `.mx-start-dock`), the exact button names
`ENTER CIRCUIT` and `PREPARE GRID START PAUSED`, `#sessionForm > .enter.primary`, and the two CSS
strings `tests/frontend-menus.test.ts` reads from `style.css`. Moved, ids kept: the three stat spans
(footer to the venue sheet) and `#circuitBlurb` (into the sheet; the dirt panel now follows the sheet).
Removed: the `.form-row` wrappers (no test used them). Changed on purpose: `circuitBlurb()` returns
the description only.

## 4b. Verification (commands actually run; host at load average 13-18, so all timings are slow)

Final code unless noted. Playwright runs used `scripts/studio/tools/pw-port.config.ts` (private port
4201, SwiftShader).

| Command | Result |
| --- | --- |
| `npm run build` (tsc --noEmit + vite build), last run after the final edit | exit 0 |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint src/ui tests/front-end-board.test.ts e2e/60-launch-board.spec.ts e2e/28-race-hud-layout.spec.ts e2e/fixtures/launch-board.ts scripts/studio/tools src/simulation/track.ts` | clean |
| `npx vitest run` on the 22 UI-touching files (career-hub, catalogue-menu-events, circuit-catalogue, circuits, event-cards, frontend-menus, frontend-retail, machine-options, menu-presentation, motocross-presentation, motorcycle-presentation, presentation, race-day, setup-screen, startup, studio-qa-tools, team-career, front-end-board, third-party-assets, offroad-meeting, replay-photo, f1-hud) | 22 files, 214 tests pass (before the last CSS-margin edit); `front-end-board`, `frontend-menus`, `motocross-presentation`, `third-party-assets` re-run after it: 34 pass |
| `e2e/30-menu-access.spec.ts -g "real interface keeps all actions reachable"` (7 viewports 320x320 to 1920x1080, real Tab walk, wheel, 9 paddock buttons, ENTER CIRCUIT / PREPARE GRID START PAUSED) | pass (run three times) |
| `e2e/44-motocross-interface.spec.ts` (MX menu geometry, scale 1.35, 375x667, `.mx-start-dock`, fields unobscured) | pass (three runs) |
| `e2e/60-launch-board.spec.ts` (new, 7 tests: quick start, discipline writes, roving radio keyboard, real map, fake controller, Wildcard extension point, fits 1280x720 and type at 11 px or more) | 7 pass (final); an earlier run failed 2: a controller test that raced the first poll on the loaded host (now retries only until handled) and a 4 px overflow caused by my own margin fix (tightened) |
| `e2e/28-race-hud-layout.spec.ts` | first test pass; "menu controls are reachable" 6 of 6 after two fixes (see section 6); the 1920x1080 case once failed a 5 s click stall under load and passed on rerun |
| `e2e/49-hud-footprint.spec.ts`, `e2e/52-vehicle-hud.spec.ts` (HUD, to check the new layer does not reach it) | pass |
| `e2e/48-motocross-practice.spec.ts` | **2 fail, identically on the untouched baseline** (`ebf691d` tree): the HUD shows the berm-practice card where the spec expects "TARGETS 0/5". Unrelated to this work. |
| `node scripts/studio/tools/uxshots.mjs ...` and `uxdom.mjs` | screenshots below; 0 page errors in all runs |
| `node scripts/studio/tools/quickstart.mjs ... circuit` | 2 inputs, 527 s (software GL, loaded host): see section 6 |

### Screens (`docs/studio/reports/ux-screens/`, JPEG, largest 124 KB)

* Menu, real game: `before-menu-` and `after-menu-` at `1280x720`, `1920x1080`, `1024x600`, `390x844`.
* Real game after: `after-gp-1280x720`, `after-dirt-1280x720`, `after-festival-1280x720`, `after-settings-1280x720`.
* DOM fixture before and after (real `Interface` and CSS, synthetic frame): `pause`, `results`, `settings`
  (before only; after is the real-game capture), `controls`; after only: `after-championship`.

## 5. Visual passes

Pass 1 (DOM fixture, then the real game): a first board with half-width machine dial, truncated
values ("Cl...", "M...") in the three-up row, the GO bar covering the rules line, the paddock list
below the fold, the festival map too small to read. Fixed: label moved into the slot's top row so the
value gets the width, hands narrowed on three-up dials, machine dial full width, blurb moved into the
sheet, paddock index promoted to a sticky right rail, fields 46 to 42 px, festival map enlarged and
redrawn square.
Pass 2 (real game at four viewports): the rail overlapped the showroom car's rear wheel at 1280
(rail narrowed to 184 px and rows tightened under 1440 px wide); the pit-board message and brief were
hidden below 1200 px of height by an old rule (now shown from 761/901 px); a missing space in the brief
("line.Find"); leaving DIRT for FESTIVAL kept the motocross panel and "DIRT SERIES" masthead (the
dirt presenter keys on the circuit select; entering the festival now leaves a terrain venue); the
controls modal opened scrolled to its last button (now opens at the top, two columns); text under 11 px
and three contrast failures found by calculation (chalk-faint on asphalt-2 was 4.1:1, flag text 4.2:1)
fixed by token changes.
Critique that remains: the eight dials still read as a form when you look only at the lower half of the
board (the top half carries the identity); a grouping caption (SESSION, CONDITIONS) would help but costs
a row at 720p; the DIRT SERIES strip is shown under every discipline because the existing e2e
specs click OUTDOOR MX from the default menu.

## 6. Not done, unverified, known issues

* **Race HUD untouched.** It still carries the F1-25-derived skin (italic, skewed chips, flame orange)
  and the old APEX wordmark ("APEX RACE" tower header, bike HUD). The migration map is in
  ART_DIRECTION section 11. The new menu and the HUD are visibly two systems until phase 2.
* **Career hub, Team HQ, photo studio, grid presentation, festival menus, loading screen:** only
  inherit tokens where they share `#app dialog`, `.primary`, `.eyebrow` (menu and dialogs only). The
  career hub still shows the four disciplines as a grid of identical cards.
* **Controller:** exercised with a scripted fake pad in a DOM component (`e2e/60-launch-board.spec.ts`);
  no physical controller, no Steam Input, no pad-type glyphs (Xbox/PS), B does not close the pause menu
  (the game's own handler owns Start there).
* **Entry is not remembered across launches** (per-discipline sheets live while the menu is open only);
  it needs a save-store slot.
* **No UI audio.** `motobound:cue` is emitted; nothing listens.
* **Weather coordination:** the glyph maps `clear`, `changeable`, `rain`; any new `#weather` value
  falls back to the sun icon until `WEATHER_GLYPH` in `launch-board.ts` gets an entry. The select, its
  options and its handlers were not changed.
* **Menu under 700 px height** scrolls (GO stays docked); at 390x844 the paddock list is below the
  board. Phone layout is a sanity layout, not a target.
* **Menu-touching e2e specs that boot the whole game** (about twenty: application, 15, 17, 45, 48
  championship, 59 career, motorcycle flows...) were not run: each needs a 45 s+ software-GL boot on a
  host running at load average 13-18. They drive the same select ids and button names, which were
  kept, but that is an argument, not evidence.
* **G3 (first launch to driving, at most 3 inputs):** `scripts/studio/tools/quickstart.mjs` on the final
  build: 2 inputs (ENTER CIRCUIT, then GO STRAIGHT TO LIGHTS in the briefing; 3 with a discipline pick).
  527 s from first input to driving on this software-GL host at load average 18, so the 90 s limit is
  **not** demonstrated and is not claimed; the menu side of the path is one input.
* Screens: pause, results, controls, championship are DOM-fixture captures (real `Interface` and CSS, a
  synthetic frame, the HUD DOM behind), not the 3D game; menu, GP, dirt, festival, settings are the real game.
* `e2e/28-race-hud-layout.spec.ts` "menu controls are reachable" failed on the untouched baseline
  (tree at `ebf691d`): it presses Tab exactly 13 times before expecting GARAGE & SETTINGS, which stopped
  being true when the dirt shortcut buttons became tab stops. I changed that loop to walk the real Tab order
  until settings and assert the same per-stop conditions, plus that all nine selects, ENTER CIRCUIT and
  CAREER were visited. The margin assertion it also makes (menu at least 8 px clear of the masthead)
  caught a genuine regression in my first layout, which I fixed in CSS rather than in the test.

## 7. Recommended next tasks (ranked)

1. **HUD to Paddock Board** (ART_DIRECTION section 11): tokens, MOTOBOUND wordmark, kill the F1 mimic;
   one measured HUD pass against `49-hud-footprint` and `28-race-hud-layout`.
2. **Career as the front door:** replace the career hub's card grid with the plates (reputation and
   next licence test under each), add CONTINUE (last entry, one input) to the board, persist per-discipline
   entries in the save store.
3. **Wildcard Series content** into the strip via `registerSeries()`; decide whether it earns a fifth plate.
4. **Wire `motobound:cue` to the audio engine** (five mechanical sounds, no music bed in menus).
5. **Rich pickers for venue and machine** (46 venues, 60 machines): customizable `<select>` popups
   (`appearance: base-select`, Chromium 135+, the Electron wrapper) with line-art thumbnails and
   type-ahead, native fallback elsewhere.
6. **Physical controller pass:** real devices, Xbox/PlayStation glyphs, results screen with RACE AGAIN
   as the primary action, B in the pause menu, repeat tuning.
7. **Remaining screens:** loading, photo studio, grid presentation, festival menus and results, race
   briefing, in the same system.
8. **Run the full menu-touching e2e set** on this branch in CI (not on this host).
