# UX/UI: HUD legibility on Steam Deck class screens

Branch `studio/ux-hud-legibility` (from `main` eccc6d0). Scope: the UX-4 design-critic audit found the in-race HUD
still drawing labels at 7 to 9 px; `e2e/64-design-critic` exempted `#hud`. This pass measures every HUD text at the
handheld and TV resolutions, sets a floor, lifts the HUD to it without breaking a footprint contract, adds a HUD
SCALE setting, checks the colour-coded accents for colour-blind viewers, and takes the exemption out of the guard.

## 1. Summary

* **Cause.** The desktop HUD (`f1-hud.css`, used from 1280 x 680 up, so on a 1280 x 800 Deck and every TV) is laid out in
  one unit, `--u = 1 vh of a 16:9 frame` (`min(1vh, 0.5625vw)`). On a 1280 px wide screen that is **7.2 px**, and the
  labels were authored at 0.95 to 1.35 u: 6.8 to 9.7 px. The GP bike panel was fixed px (7 to 9 px labels) and did not
  grow with the window at all (7 px at 4K). The UX-4 report blamed "text under a transform"; in the desktop layout it
  is the unit, not a transform (the transform-scaled panels exist only in the compact layout below 1280 x 680, see
  section 9).
* **Fix.** `--u` is now `hud-k x max(8 px, 1vh | 0.5625vw)`, capped by the window; labels are 1.4 u (11.2 px at the
  8 px floor), readouts at least 2.25 u. The GP panel is sized in `--bp` (a CSS px that grows with the window above
  800 px tall) times the same HUD scale. A **HUD SCALE** setting (automatic / 100 / 115 / 130 / 150 %) drives
  `--hud-k`; automatic is 115 % under 900 px tall.
* **Result (DOM fixtures, every HUD state, 1280x800, 1280x720, 1366x768, 1920x1080, 3840x2160, every HUD scale
  step):** 0 texts under the floor (before: 16 / 30 / 11 under it on a 1280x800 circuit / GP / dirt HUD, smallest 6.8 px),
  0 overlapping panels, 0 panels outside the window or in the sight window, 0 clipped texts. `e2e/64` no longer exempts
  `#hud`; `e2e/65-hud-legibility.spec.ts` holds the floors by tier.
* **Cost.** The panels are bigger: on a 1280 x 800 Deck the always-on panels cover SHARE_BEFORE of the frame before and
  SHARE_AFTER now (automatic 115 %). Section 6 has the numbers and the contracts.

## 2. HUD families and how each is sized

| Family | Where | Sized in | Before | After |
| --- | --- | --- | --- | --- |
| Circuit / formula (and the cluster, tower, lap panel, map, banners of every machine) | `f1-hud.css`, `race-day-hud.css`, `hud-identity.css` | `--u` (1 vh of 16:9) | labels 6.8 to 9.7 px at 1280 px wide | `--u` floor 8 px, labels 1.4 u |
| GP bike panel | `bike-hud.css` | px times the interface size | 7 to 9 px labels, fixed at every window size | `--bp` units: 0.125 vh above 800 px tall times the HUD scale, labels 11 px |
| Dirt / offroad (gate card, ride readout) | `motocross.css` (`.mx-status-stack`) | px, lifted to 11 px by `type-floor.css` | 11 to 18 px, fixed | scales with `--u` (zoom), capped by the room between the tower and the lap panel |
| Open world (festival) | `festival-hud.css` | px, lifted to 11 px by `type-floor.css` | 11 px and up, fixed | the five always-on widgets scale with the HUD scale (up to 130 %) and the window above 800 px tall (zoom) |
| Compact layout (windows under 1280 x 680) | `style.css`, `compact-race-hud.css`, `race-day-hud.css` | `transform: scale(--scale)` of 6 to 10 px type | 6 to 10 px declared times 0.78 to 1.12 | **unchanged** (section 9) |

## 3. Method

`scripts/studio/tools/hud-measure.mjs` (DOM only, no WebGL, one fixture build, one browser) mounts the production
`Interface` and `FestivalHud` through the `ux-fixture.ts` scenes the e2e specs use, plus new `hudState` scenes for the
states a plain frame does not show (race-control banner, pit lane, start lights, vehicle warning, VEHICLE panel,
GP corner guide). For every element it records the computed font size (own text and `::before` / `::after` text)
times every `transform: scale` and CSS `zoom` above it, whether it is on screen, and its tier
(`hud-legibility.page.js` holds the table; unclassified is `secondary`, the strict default):

| Tier | Floor (CSS px at the viewport measured) | Members |
| --- | --- | --- |
| primary | 18 | speed, gear, position, current lap time, the lap numeral |
| secondary | 11 | every other label, caption, unit, button and note |
| tertiary | 10 | none needs it: the HUD's smallest text is 11 px |
| decor (exempt) | none | the MOTOBOUND wordmark only |

`layout()` in the same page script returns the panels on screen as rectangles, and the footprint checks read it:
overlaps, panels outside the window, panels in the sight window (x 38 to 62 %, y 40 to 60 % of the frame: the road
ahead of the car, between the horizon and the bonnet; the start lights are the only panel allowed in it, and only
before the race starts), text clipped by its own box, and the share of the frame the always-on panels cover.

MEASURE_TABLES

## 4. What changed (files)

CHANGED_FILES

## 5. HUD SCALE setting

SETTING_SECTION

## 6. Footprint contracts

FOOTPRINT_SECTION

## 7. Colour-blind check

CVD_SECTION

## 8. Guards added or changed

GUARDS_SECTION

## 9. Not done, unverified, known issues

OPEN_SECTION

## 10. Verification (commands actually run)

VERIFY_SECTION

## 11. Recommended next tasks (ranked)

NEXT_SECTION
