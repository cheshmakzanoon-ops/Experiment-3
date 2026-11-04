# UX/UI: HUD legibility on Steam Deck class screens

Branch `studio/ux-hud-legibility` (cut from `main` eccc6d0; `main` has moved since, to eab1d91, by two commits that touch only
`docs/studio/BOARD.md` and `scripts/start-finish.blend`, so the branch merges cleanly). Scope: the UX-4 design-critic audit found
the in-race HUD still drawing labels at 7 to 9 px, and `e2e/64-design-critic` exempted `#hud` from its type floor. This pass
measures every HUD text at the handheld and TV resolutions, sets a floor, lifts the HUD to it without breaking a footprint
contract, adds a HUD SCALE setting, makes the one colour-only code (tyre temperature) colour-blind safe, and takes the exemption out
of the guard.

## 1. Summary

* **Cause.** The desktop HUD (`f1-hud.css`, used from 1280 x 680 up, so on a 1280 x 800 Deck and on every TV) is laid out in one
  unit, `--u = 1 vh of a 16:9 frame` (`min(1vh, 0.5625vw)`). On a 1280 px wide screen that is **7.2 px**, and labels were authored
  at 0.95 to 1.35 u: 6.8 to 9.7 px. The GP bike panel was fixed px (7 to 9 px labels) and did not grow with the window at all (still
  7 px at 4K). The UX-4 report blamed "text under a transform"; in the desktop layout it is the unit, not a transform (the
  transform-scaled panels exist only in the compact layout below 1280 x 680, which this pass leaves alone, section 9).
* **Fix.** `--u` is now `hud-k x max(8 px, 1 vh | 0.5625 vw)`, capped by the window; labels are 1.4 u (11.2 px at the 8 px floor),
  readouts at least 2.25 u. The GP panel is sized in `--bp` (a CSS px that grows with the window above 800 px tall) times the same
  HUD scale. The dirt gate card and the five always-on festival widgets scale with `zoom`, not a transform. A **HUD SCALE** setting
  (automatic / 100 / 115 / 130 / 150 %) drives `--hud-k`; automatic is 115 % under 900 px tall in the desktop layout.
* **Result (DOM fixtures: 12 HUD states x 4 resolutions, automatic scale):** 2,424 drawn texts, **0 under their floor** (before, on
  the four base scenes at 1280 x 800: 16 / 30 / 11 under it on the circuit / GP / dirt HUD, smallest 6.8 px, and the lap time, a
  primary readout, at 17.3 px). At 1280 x 800 and automatic the smallest label is 12.9 px (circuit) and 12.7 px (GP, dirt, open
  world); at 100 % it is 11.2 / 11.0 px. No panel overlaps another, leaves the window, enters the sight window, or clips its text
  (`e2e/65-hud-legibility.spec.ts`, every state, 5 windows, every HUD scale step).
* **Cost.** The panels are bigger. On a 1280 x 800 Deck the always-on panels' bounding boxes cover **24 %** of the frame at
  automatic (15 % before; 18 % at 100 %; 30 % at 130 %); by `e2e/49`'s own, narrower metric (tower, lap panel, cluster) that is
  15.9 % at automatic and 12.1 % at 100 %, against 9.7 % before and the 12 % pin that `e2e/49` holds from 1600 x 900 up. The
  12 % pin was not raised (it never covered these sizes); a second test now pins the handheld sizes where they are. Section 6.
* **Real game.** One software-rendered (SwiftShader) frame of the formula HUD at 1280 x 800, automatic scale, before and after
  (`hud-screens/before-real-1280x800.jpg`, `after-real-1280x800.jpg`; the first lap of the first-launch path, Aurel Grand
  Circuit): the same measurement run in the real page finds 25 HUD texts on screen; before, 13 were under their floor (smallest
  6.8 px, the FUEL label; the lap time at 17.3 px); after, none, smallest 12.9 px, and no page or console error. I looked at both
  frames; the road ahead is clear in both, and the panels are visibly larger and legible in the after frame.

## 2. HUD families and how each is sized

| Family | Where | Sized in | Before | After |
| --- | --- | --- | --- | --- |
| Circuit / formula (and the cluster, tower, lap panel, map, banners of every machine) | `f1-hud.css`, `race-day-hud.css`, `hud-identity.css` | `--u` (1 vh of 16:9) | labels 6.8 to 9.7 px at 1280 px wide | `--u` floor 8 px, labels 1.4 u |
| GP bike panel | `bike-hud.css` | px times the interface size | 7 to 9 px labels, fixed at every window size | `--bp` units: 0.125 vh above 800 px tall times the HUD scale, labels 11 px and up |
| Dirt / offroad (gate card, ride readout) | `motocross.css` (`.mx-status-stack`) | px, lifted to 11 px by `type-floor.css` | 11 to 18 px, fixed | scales with `--u` (`zoom`), capped by the room between the tower and the lap panel |
| Open world (festival) | `festival-hud.css` | px, lifted to 11 px by `type-floor.css` | 11 px and up, fixed | the five always-on widgets scale with the HUD scale (up to 130 %) and the window above 800 px tall (`zoom`) |
| Compact layout (windows under 1280 x 680) | `style.css`, `compact-race-hud.css`, `race-day-hud.css` | `transform: scale(--scale)` of 6 to 10 px type | 6 to 10 px declared times 0.78 to 1.12 | **not lifted**; only the HUD scale a player chose now reaches it (section 9) |

## 3. Method

`scripts/studio/tools/hud-measure.mjs` (DOM only, no WebGL, one fixture build, one browser) mounts the production `Interface` and
`FestivalHud` through the `ux-fixture.ts` scenes the e2e specs use, plus new `hudState` scenes for the states a plain frame does not
show (race-control banner, pit lane, start lights, vehicle warning, VEHICLE panel, GP corner guide). For every element it records
the computed font size (own text and `::before` / `::after` text) times every `transform: scale` and CSS `zoom` above it, whether
it is on screen, and its tier (`hud-legibility.page.js` holds the table; unclassified is `secondary`, the strict default):

| Tier | Floor (CSS px at the viewport measured) | Members |
| --- | --- | --- |
| primary | 18 | speed, gear, position, current lap time, the lap numeral |
| secondary | 11 | every other label, caption, unit, button and note |
| tertiary | 10 | none needs it: the HUD's smallest text is 11 px |
| decor (exempt) | none | the MOTOBOUND wordmark only |

`layout()` in the same page script returns the panels on screen as rectangles; the footprint checks read it: overlaps, panels
outside the window, panels in the sight window (x 38 to 62 %, y 40 to 60 % of the frame: the road ahead of the car; the start
lights are the only panel allowed in it, and only before the race starts), text clipped by its own box, and the share of the frame
the always-on panels cover (bounding boxes of the tower with its fastest-lap tab, the lap panel, the cluster with the tyre tiles,
the map and the dock, summed over the frame; a bounding box is larger than the ink).

The "before" numbers are the same tool run on a checkout of `main` at eccc6d0 (the four base scenes: the `hudState` scenes did not
exist there). "After" is this branch. Both run in Playwright's headless Chromium at the stated viewport, device scale factor 1,
fonts loaded, DOM only (no WebGL), so they measure the HUD's own layout, not a frame of the game.

### Before and after, automatic HUD scale (one row per HUD family and resolution)

| viewport | HUD | texts drawn | smallest px | texts under floor | always-on panels cover |
| --- | --- | ---: | --- | --- | --- |
| 1280x800 | circuit | 43 | 6.8 -> **12.9** | 16 -> **0** | 15% -> 24% |
| 1280x800 | GP bike | 58 | 7.0 -> **12.7** | 30 -> **0** | 18% -> 29% |
| 1280x800 | dirt | 43 | 6.8 -> **12.7** | 11 -> **0** | 15% -> 24% |
| 1280x800 | open world | 19 | 11.0 -> **12.7** | 0 -> **0** | 0% -> 0% |
| 1280x720 | circuit | 43 | 6.8 -> **12.9** | 16 -> **0** | 16% -> 27% |
| 1280x720 | GP bike | 58 | 7.0 -> **12.7** | 30 -> **0** | 20% -> 33% |
| 1280x720 | dirt | 43 | 6.8 -> **12.7** | 11 -> **0** | 16% -> 27% |
| 1280x720 | open world | 19 | 11.0 -> **12.7** | 0 -> **0** | 0% -> 0% |
| 1920x1080 | circuit | 43 | 10.3 -> **15.1** | 2 -> **0** | 16% -> 17% |
| 1920x1080 | GP bike | 58 | 7.0 -> **14.8** | 19 -> **0** | 16% -> 20% |
| 1920x1080 | dirt | 43 | 10.3 -> **15.1** | 2 -> **0** | 16% -> 17% |
| 1920x1080 | open world | 19 | 11.0 -> **14.8** | 0 -> **0** | 0% -> 0% |
| 3840x2160 | circuit | 43 | 20.5 -> **30.2** | 0 -> **0** | 16% -> 17% |
| 3840x2160 | GP bike | 58 | 7.0 -> **29.7** | 19 -> **0** | 14% -> 20% |
| 3840x2160 | dirt | 43 | 13.0 -> **30.2** | 0 -> **0** | 16% -> 17% |
| 3840x2160 | open world | 19 | 11.0 -> **29.7** | 0 -> **0** | 0% -> 0% |

(Open world has no always-on panels in the share: its widgets are fixed cards, and its labels were already at 11 px.)

Primary readouts at 1280 x 800, circuit HUD (CSS px as the player sees them, before -> after): gear 46.1 -> 58.9, speed
25.9 -> 33.1, position numeral 18.7 -> 23.9, lap numeral 23.0 -> 29.4, **current lap time 17.3 -> 22.1** (the one primary under
18 px before). GP bike: speed 35.0 -> 40.3, gear 48.0 -> 55.2. Open world: speed 77 -> 88.6, gear 31 -> 35.7.

The twelve states measured after (all four resolutions): the four base scenes, the race-control banner, the pit lane, the start
lights, the vehicle alert, the VEHICLE panel (circuit, GP, dirt) and the GP corner guide. Smallest drawn text at 1280 x 800,
automatic: banner / pit / start / alert 12.9 px, VEHICLE panels 11.5 px (the panel's tab buttons), GP corner guide 12.7 px.

### HUD scale steps at 1280 x 800 (circuit / GP / dirt HUD)

| HUD scale | smallest label px | always-on panels cover | note |
| --- | --- | --- | --- |
| 100 % | 11.2 / 11.0 / 11.0 | 18 / 22 / 18 % | `--u` = 8 px, the floor |
| 115 % (automatic here) | 12.9 / 12.7 / 12.7 | 24 / 29 / 24 % | |
| 130 % | 14.3 / 14.1 / 12.7 | 30 / 36 / 30 % | `--u` capped at 0.8 vw = 10.24 px |
| 150 % | 14.3 / 14.1 / 12.7 | 30 / 36 / 30 % | the same as 130 % at 1280 px wide: the cap |

## 4. What changed (files)

* `src/core/hud-scale.ts` (new): the steps, the automatic rule, `validateHudScale`, `resolveHudScale`, `applyHudScale`.
* `src/storage/data.ts`: `Settings.hudScale`, validated, saves without it read as `auto`. `src/main.ts` and `src/ui/interface.ts`:
  applied at boot, on every settings save and live as the dial moves; CANCEL puts the saved value back.
* `src/ui/hud-scale-control.ts` (new) and `src/ui/interface.ts`: the HUD fieldset of the settings screen.
* `src/ui/style.css`: `--hud-k` (interface size x HUD scale), `--hud-kc` (capped at 1.35 for the compact layout), the automatic
  media query. `src/ui/compact-race-hud.css`: `--scale` is `--hud-kc` instead of the interface size alone.
* `src/ui/f1-hud.css`: the unit floor and window caps, every label at 1.4 u, readouts at least 2.25 u, the room (`--f1-room`) that
  the banner, pit panel, vehicle panel and start lamps size to so no scale overlaps two panels, FUEL stacked in the BATT pod.
* `src/ui/bike-hud.css`: the GP panel in `--bp` units, 11 px minimum captions, the panel clears the dock (`--bike-lift`).
* `src/ui/motocross.css`, `src/ui/festival-hud.css`: the dirt gate card and the festival widgets scale with `zoom`.
* `src/ui/hud-identity.css`: stale comment. `src/ui/f1-hud.ts`, `src/ui/interface.ts`: `data-band` on the tyre tiles.
* `src/ui/hud-colourblind.css`: the colour-blind tyre palette (section 7).
* `src/i18n/dict/*.ts`: four strings x seven languages. `npm run check:i18n`: 1,077 strings, 0 errors, 0 warnings.
* Tools: `hud-measure.mjs`, `hud-legibility.page.js`, `hud-real.mjs`, `hud-cvd.mjs` (+ `.d.mts`), `ux-fixture.ts` (`hudState`
  scenes), `ux4-audit.page.js` (skips font-size-0 elements), README rows.
* Tests: `e2e/65-hud-legibility.spec.ts` (new), `e2e/49-hud-footprint.spec.ts` (handheld pins added),
  `e2e/64-design-critic.spec.ts` (exemption removed), `e2e/fixtures/i18n-en/*`
  (baseline, reason in section 8), `tests/hud-scale.test.ts`, `tests/hud-colourblind.test.ts` (new),
  `tests/front-end-board.test.ts` (guard widened, reason in section 8).

## 5. HUD SCALE setting

* **Settings > HUD > HUD SCALE**: Automatic, 100, 115, 130, 150 %. Stored as `Settings.hudScale` (`'auto' | 1 | 1.15 | 1.3 | 1.5`);
  `validateHudScale` maps a number to the nearest step and anything else (missing, a string, junk) to `auto`, so every earlier save
  reads as automatic (`tests/hud-scale.test.ts` runs settings versions 1 to 6 through `validateSettings`).
* **Applied live** through one CSS custom property: a step sets `--hud-scale` on the root, automatic removes it and the style sheet
  decides. The dial applies as it moves and goes back when the screen is cancelled (the settings-dial test in `e2e/65`).
* **Automatic** is 115 % when the window is under 900 px tall **in the desktop layout** (at least 1280 x 680): a media query in
  `style.css`, so a resized or rotated window follows without a reload; `AUTO_HUD_SCALE_BELOW`, `..._MIN_WIDTH`, `..._MIN_HEIGHT`
  in `hud-scale.ts` must match it and `tests/hud-scale.test.ts` reads the style sheet to check. In the compact layout automatic is
  100 %, because every compact contract was measured there (section 9).
* **The layout unit** `--u = min(hud-k x max(8 px, min(1 vh, 0.5625 vw)), 1.55 vh, 0.8 vw)`: a step multiplies every panel, label
  and gap together (type is never scaled by a transform, so a larger step cannot shrink a label under the floor); the caps are the
  window (0.8 vw keeps the tower, the banner and the lap panel side by side, so 130 % and 150 % are the same size on a 1280 px wide
  window, which the dial's help text says as "the largest sizes stop where the panels would meet").
* The unit test in `e2e/65` measures `--u` at 15 window / step / interface-size combinations (8 px floor at 1280 x 800 and
  1280 x 720, 115 % automatic under 900 px, 100 % at 900 and above, a step honoured everywhere up to the cap, the interface size
  multiplying it) and the compact layout's `--scale` at 4 (1 at automatic at 800 x 600 and 640 x 400, 1.15 at a 115 % step, 1.35 at
  150 % at 1024 x 768).

## 6. Footprint contracts

No contract was loosened and no pin raised in `e2e/28-race-hud-layout`, `e2e/49-hud-footprint`, `e2e/52-vehicle-hud` (28 and 52
are unchanged, 49 only gained a test; all pass, section 10).

* `e2e/49-hud-footprint` pins the opaque panels (tower, lap panel, cluster) under **12 % of the frame at 1600 x 900 and 1920 x
  1080**, where `--u` is the same as before: it still reads 10.8 %, the test body and pin are unchanged. It never covered the
  handheld sizes. By the same metric the pass changes them like this (share of the frame):

  | window | before | 100 % | automatic (115 %) | 130 % |
  | --- | --- | --- | --- | --- |
  | 1280 x 800 | 9.7 % | 12.1 % | 15.9 % | 19.7 % |
  | 1280 x 720 | 10.8 % | 13.4 % | 17.7 % | 21.9 % |
  | 1366 x 768 | 10.8 % | 11.8 % | 15.5 % | 19.9 % |

  So on a Deck the HUD is above the 12 % line that holds for bigger windows, even at 100 %: an 11 px label on a 1280 px wide
  screen needs a unit of 8 px where the old unit was 7.2 px. I did not raise the 12 % pin (it was never applied to these sizes);
  I added a second test to `e2e/49` that pins the handheld sizes where they now are (13 / 14.5 / 13 % at 100 %, 17 / 19 / 17 %
  at automatic), with the reason in the file, so the cost can be neither hidden nor grow. Whether the Deck should be nearer 12 %
  is a design decision for the next pass (section 11, item 2).
* At those sizes `e2e/65` holds the checks the older pins do not: no overlap, nothing outside the window, nothing in the sight
  window, no clipped text.
* A larger unit made three things meet, and each was fixed in CSS by sizing to the room between the tower and its mirror
  (`--f1-room`), not by loosening a guard: the race-control banner and pit panel (`max-width`), the start lamps (`--f1-lamp`) and
  the VEHICLE panel (width clamp); the GP panel clears the dock (`--bike-lift`); FUEL stacks inside the BATT pod.
* The compact layout is untouched by the footprint work (section 9).

## 7. Colour-blind check

`scripts/studio/tools/hud-cvd.mjs` (Machado 2009 protan / deutan / tritan simulation at full severity, CIE76 delta-E of the worst
pair per viewer; under about 15 two small tiles are hard to tell apart, under 25 they take effort). The HUD's one colour-only code
is the tyre temperature band (cluster tiles and VEHICLE panel tiles):

| Palette | normal | protan | deutan | tritan |
| --- | --- | --- | --- | --- |
| tyre bands, default (blue, two greens, yellow, red) | 35 | 28.6 | **21.3** | **5.1** (cool and ideal are one colour) |
| tyre bands, colour-blind setting (navy, sky blue, grey, yellow, vermillion) | 37.3 | 32.7 | 33.6 | 30.7 |

Under Settings > Accessibility > colour-blind the five bands become the set with the best worst-pair over the four viewers (an
exhaustive search over 252 sets of the Okabe-Ito colours plus a grey and a navy), and the overheating tile also gets a white ring,
so the one state that needs action does not depend on colour (the temperature is printed in the VEHICLE panel). The default bands
keep the Art Bible colours: under a tritan simulation they are still ambiguous, which is why the safe palette is the colour-blind
setting rather than a silent change of the default look. `tests/hud-colourblind.test.ts` reads the shipped CSS and holds every
pair at delta-E 30 or more for all four viewers. The timing colours under the setting were not changed (worst pair 17 for deutan
and tritan, below the 25 line; the times are always printed, so colour is never the only signal).

## 8. Guards added or changed

* **`e2e/65-hud-legibility.spec.ts` (new).** Every HUD state x 5 windows (1280 x 800, 1280 x 720, 1366 x 768, 1920 x 1080,
  3840 x 2160) x HUD scale steps (all five on the two handhelds): type floors by tier, no overlap, nothing outside the window, nothing
  in the sight window, no clipped text; asserts a scene is not vacuously empty (more than 30 texts, readouts classified, over 1,000
  texts judged); the layout unit; the settings dial. **Checked that it bites:** deleting the 8 px unit floor from `f1-hud.css`
  made the 1280 x 800 test fail with 188 texts under their floor (reverted).
* **`e2e/49-hud-footprint.spec.ts`:** a second test pins the panel share at the handheld sizes (section 6); the existing test and
  its 12 % pin are unchanged.
* **`e2e/64-design-critic.spec.ts`:** the `#hud` exemption is gone: the race HUD is held to 11 px like every other screen at 1280 x
  800 and 1280 x 720. This needed `ux4-audit.page.js` to skip elements at `font-size: 0` (the ERS ring, the label BATT replaces): they
  draw no text, and text a pseudo-element draws is measured by `hud-legibility.page.js`.
* **`tests/front-end-board.test.ts`:** the colour-blind sheet guard said "exactly one rule". It now says what it was for: the
  timing-colour rule is first and unchanged, and every rule in the sheet is under `html[data-colorblind='true'] #hud`. Reason: the
  sheet now also carries the tyre palette.
* **`e2e/fixtures/i18n-en/{hud,paddock,settings}.html`:** the English markup baseline regenerated (`I18N_CAPTURE=1`), reviewed
  token by token: the only differences are the HUD sheets' CSS text that the hud and paddock snapshots inject, and the new HUD
  fieldset in the settings snapshot. No text of any screen changed.
* **`tests/hud-scale.test.ts`, `tests/hud-colourblind.test.ts`:** the setting, its validation and migration, the style sheet rules
  it depends on, the palette.

## 9. Not done, unverified, known issues

* **The compact layout (windows under 1280 x 680) still draws 7 to 9 px labels.** Measured after this pass (circuit / GP / dirt):
  1024 x 768: 15 / 6 / 11 texts under the 11 px floor, 800 x 600: 15 / 6 / 11, 640 x 400: 18 / 9 / 18, smallest 7.0 px. The Steam
  Deck (1280 x 800), a 720p handheld and every TV get the desktop layout, so this is outside the matrix the task set, but it is the
  layout that uses `transform: scale` the UX-4 report described. Lifting it means re-measuring `e2e/28`, `e2e/36`, `e2e/44` at
  640 x 400 and 800 x 600 and trading against a footprint that is already 24 to 28 % of a 640 x 400 frame, and 640 x 400 already has
  panels in the sight window (the cluster, and on the dirt HUD the status card) that this pass did not introduce and did not fix.
  A HUD SCALE step reaches the compact layout through `--scale`, but only the parts sized in `--scale` grow, so it helps there
  partially (it does not lift the 7 px labels). Automatic is 100 % there, so the dial's "Automatic: 115 % on screens under 900 px
  tall" is not true for a window under 1280 x 680.
* **Bigger HUD, bigger footprint.** 24 % (circuit) and 29 % (GP) of a 1280 x 800 frame at automatic, bounding boxes (15.9 % by
  the `e2e/49` metric, above its 12 % line for larger windows). A player who wants the road is one dial step away (100 %: 18 % /
  22 %; 12.1 % by the `e2e/49` metric). No design decision was taken to shrink a panel's content or drop an
  element to buy the room back; that is a design call for the next pass.
* **130 % and 150 % are the same size on a 1280 px wide window** (the cap that keeps the panels apart), and the dial does not
  say so beyond its help text.
* **The default tyre palette is still not safe for a tritan viewer** (delta-E 5.1); only the colour-blind setting is.
* **Hardware.** Measured in desktop Chromium (headless, DOM fixtures, device scale factor 1) and one SwiftShader game frame; not on
  a Steam Deck, not at a Deck's viewing distance. Pixel floors are CSS px at 1 x; the 11 px floor is the studio's, not a measured
  acuity limit. The 18 px primary floor is met at every scale: the smallest primary readout (the lap time) is 22.1 px at
  automatic and 19.2 px at 100 %, 1.2 px over the line.
* **Browser features.** `zoom` and the CSS trigonometric functions (`tan(atan2())`, used to turn a length ratio into a number)
  need Chromium 111 or later; the desktop build ships Electron 44, so this holds for the Steam build and any current browser.
* **The real frame is one still of the plain state** (a one-car practice grid, 1 KPH, no banner or pit panel). Every other state
  (race control, pit lane, start lights, vehicle warning, VEHICLE panel, GP, dirt, open world) is measured in the DOM fixtures
  only; the GP, dirt and festival before / after images (`hud-screens/dom-*`) are fixture frames over a plain background, not the
  game. The software renderer needs tens of seconds per frame, so `hud-real.mjs` stops the game loop (the HUD is DOM and keeps
  its last state) before taking the still.
* **A pre-existing defect the real frame shows:** the tower header reads "MOTOBOUND PRAC..." in the before and the after frame:
  the session name ("PRACTICE", 8 letters) does not fit beside the stencil wordmark and is cut by the declared ellipsis
  (`hud-identity.css`, `.f1-session`). The proportions are in `--u`, so it is the same at every window size and on `main`; it is
  not a floor violation (the text is 11 px and over, and an ellipsis is a declared truncation) so the guard does not count it.
* Not touched: the replay HUD, pause, results and festival dialogs (they are held by `e2e/64` at 11 px and pass); the audio and
  haptic cues; localisation of text lengths at a larger HUD (`e2e/63` passes at 1280 x 720 and 1024 x 600; the HUD is a fixed
  overlay and was measured in English).

## 10. Verification (commands actually run)

VERIFY_BLOCK

## 11. Recommended next tasks (ranked)

1. **Compact layout legibility** (windows under 1280 x 680 and phones): rebuild it in `--u`-style units or `zoom`, not `transform:
   scale`; measure with `hud-measure.mjs --viewports 1024x768,800x600,640x400`; the floor is already enforced for the desktop
   layout, so `e2e/65` can take the compact rows once it passes.
2. **Footprint diet at 1280 x 800**: with the type at 11 px the panels cover 15.9 % of the frame at automatic (12.1 % at 100 %)
   by the `e2e/49` metric, against the 12 % that holds from 1600 x 900; decide what the Deck does not need on screen at once (the
   tower's fifth row, the GP panel's rider-aid line, the map's size, the tower header's padding) and tighten the handheld pins
   `e2e/49` now holds.
3. **Tower header truncation**: "MOTOBOUND PRAC..." (section 9): shorten the wordmark's letter-spacing or give the session name
   its own line in `.f1-tower-head`; the fix needs `e2e/28` and `e2e/65` to confirm nothing moves.
4. **Real handheld check**: a Steam Deck (or a 1280 x 800 7 inch panel) with the three HUD scales at arm's length, to tune the
   automatic default and the floors; this pass could not do it.
5. **Timing colours under the colour-blind setting** (delta-E 17 for deutan and tritan): pick them with the same exhaustive search
   as the tyre bands, or add a glyph to the sector tabs.
6. **Show the cap in the dial**: grey out or relabel 150 % where it equals 130 % (a window about 1280 px wide).
