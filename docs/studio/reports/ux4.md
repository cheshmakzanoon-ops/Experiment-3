# UX/UI Director report, wave 4: the design-critic pass

Branch `studio/ux-design-critic` (from `main` @ 2ed0ae9, physics v23). Design system:
[ART_DIRECTION.md](../ART_DIRECTION.md) (new section 19). Earlier reports: [ux.md](ux.md), [ux2.md](ux2.md),
[ux3.md](ux3.md). Screens: `docs/studio/reports/ux4-screens/` (JPEG; `showroom-<plate>-before-after.jpg` are
the real game at the four viewports, `changed-<group>.jpg` are before beside after for the screens this wave
changed, `all-<w>x<h>-<n>.jpg` are contact sheets of every screen after the change, `*-1280x720.jpg` are single
captures). Everything below comes from commands run in this worktree on a host at load 10 to 14 shared with
other agents, one browser at a time. "DOM" means the real `Interface` and the real style sheets with a
synthetic frame and no WebGL (`scripts/studio/tools/ux4dom.mjs` over the `ux-fixture.ts` scenes); "real game"
means the built game in Chromium on SwiftShader (`scripts/studio/tools/ux4-real.mjs`). No number below is a
performance claim and no physical controller or GPU was used.

## 1. Result at a glance

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Capture every screen at 1280x720, 1280x800, 1920x1080, 1024x600 | Done, with the gaps in section 8 | 51 DOM scenes x 4 viewports (204 captures), real-game menus (4 plates x 4 viewports), the modals over the real showroom, one real circuit race (loading, briefing, grid presentation, HUD, pause, back to the paddock) |
| 2 | Hostile critique, programmatic size / contrast / focus audits | Done (section 3) | `ux4-audit.page.js`: before (45 scenes at 1280x720, declared sizes) 689 text elements under 11 px and 47 under WCAG AA; after (51 scenes x 4 viewports, 27,321 text elements, 23,535 judged) 0 under 11 px outside the race HUD (408 inside it), 0 under AA; focus 7,580 checks, 0 without a ring |
| 3a | Showroom car cropped by the rail | Fixed | machine centred and fitted in the strip between board and rail at every viewport (section 4.1) |
| 3b | Machine character line hidden below 790 px | Fixed: moved into the nameplate card, drawn from 680 px | `e2e/60` contract rewritten (section 4.2) |
| 3c | Legacy-styled screens | Fixed: pre-race briefing and grid presentation, festival panels, academy, events, fieldsets and links, loading; open: race HUD labels | sections 3.7 and 4.3 |
| 3d | Loading identity per discipline | Done | plate, motto, machine, facts, colour; `e2e/64` pins it |
| 3e | Focus rings, keyboard and gamepad | Verified: 0 of 500+ focusable elements without a ring | `e2e/64`, section 4.5 |
| 3f | Reduced motion | Honoured in every sheet this wave wrote or rewrote | `e2e/64`, `tests/front-end-board.test.ts` |
| 4 | Automated guards | Added | section 6 |

## 2. Method

1. `ux4dom.mjs`: one vite build of `ux-fixture.ts`, one browser, every scene at every viewport, a JPEG each and,
   with `--audit --focus`, the in-page audit (`ux4-audit.page.js`): the size of every visible piece of text as
   the player sees it (declared size times the `transform: scale` of any panel it sits under: the race HUD
   scales whole panels), its WCAG contrast ratio where the background is known (ancestors' backgrounds
   composited; text over the 3D scene or a gradient is counted apart and not judged), and a focus ring check
   (each interactive element focused in turn, under the keyboard and with `#app[data-pad]`).
   `ux4-audit-summary.py` reads the JSON. About 25 fixture scenes were added to `ux-fixture.ts` (briefing x3, grid
   presentation, academy, events, credits, Team HQ pages x3, loading x4, HUD x3, festival x4, telemetry, error
   screen, two demo variants).
2. `ux4-real.mjs`: the real game in one boot: every plate at every viewport (plus a clean frame with the menu
   chrome hidden), the modals over the real showroom, and `race:<plate>` (loading, briefing, grid presentation,
   HUD, pause, back to the paddock).
3. `ux4-smallfonts.py` lists every CSS declaration under 11 px with its selector (the source of `type-floor.css`);
   `ux4-carbox.py`, `ux4-sheet.py`, `ux4-sheets.sh` measure a car in a clean frame and build the contact sheets.
4. I read every capture with the image reader, at 1280x720 first, then the other viewports for the screens that
   have a viewport-dependent layout (the menu, loading, the first-launch screen, the pre-race screens).

## 3. The critique

Ruthless, in the order a Steam reviewer would meet it. **Fixed** means fixed and verified in this wave; **open**
means it is still true and is in section 8 or 9.

### 3.1 First thirty seconds (menu, first launch, loading)

* **Fixed: the hero car was cropped on both sides at 1280 wide.** Rear wing under the rail, nose under the board
  (the camera aimed a fixed 1.35 m left of the car and never knew where the panels are). At 1280x720 the car
  spanned 456 to 1147 px against a 520 to 1064 px strip. The EH-3 hypercar was worse (440 to 1163), and the
  1024x600 laptop cut 161 px off the nose.
* **Fixed: the paddock rail's index numeral broke in two.** "02" over "GARAGE & SETTINGS" wrapped onto two lines at
  1280 (`overflow-wrap: anywhere` reached the pseudo-element). It was in every menu screenshot since wave 1.
* **Fixed: the machine's character line existed only at 790 px and taller** (a layout fold-out added by the e2e
  sweep). A player at 1280x720 (and at every laptop height from 720 to 789) never saw it.
* **Fixed: the loading board was one board for four disciplines.** Only the map's tint changed; the left half
  was a void with a session line floating in it. It now says who is loading (section 4.3).
* **Open: the default livery is violet (#5b2bd6) with lime.** It is the hero car in the menu, the team pass in
  Team HQ, the podium step, the share card, and it is the single most "generated" colour choice on screen. It
  belongs to Vehicle Art and `tests/hero-car-original.test.ts` pins it, so I did not touch it. Four presets
  exist (`glacier`, `nocturne`, ...). Recommendation: ship the house livery in the board's own colours (asphalt
  and amber, or paper and ink) as the default and keep violet as a preset.
* **Open: "ENTER CIRCUIT" on the dirt plate** (a motocross venue is not a circuit). Left as it is: 37 e2e specs
  look the button up by that name.
* **Open: the dirt board scrolls** at 1280x800 (the MACHINE dial sits under the ENTER dock and the session
  dials are below the fold). It is the motocross presenter's own layout (`mx-menu-scroll`), unchanged.

### 3.2 Flow: launch to driving, dead ends, labels

* First launch to driving: one input (Enter on DRIVE THE FIRST LAP), then the Academy practice (no briefing,
  `racingSession()` is false) straight to the lights: unchanged and good.
* A returning player's Grand Prix: ENTER CIRCUIT (1), then the race-day briefing whose focused primary is **WATCH
  GRID PREPARATION** (the long television presentation); the short path is the second button (Tab, Enter) or the
  "Use Quick Start for future races" box below it. So three inputs by default, one once Quick Start is ticked
  (counted from `main.ts` and `e2e/51`, not timed in a run). **Open:** the briefing's default should be the
  short path for anyone who has seen the presentation once.
* **Open: five doors that overlap.** CAREER (the season board), EVENTS (a flat list of rule sets), CHAMPIONSHIP
  (four weekends), the WILDCARD ticket and TEAM HQ (a management game) all promise "progress"; the rail names
  them with one word and the player has to open each to find out. One line under each rail item (or a tooltip
  with the first sentence of the screen) would do; it needs eight-language copy, so I did not add it.
* **Open: dead end in the festival.** The festival's menu, card, results and map speak English only inside an
  otherwise localised game (section 3.6).

### 3.3 Slop tells

| Tell | Where | Status |
| --- | --- | --- |
| F1-era red broadcast bug, translucent navy panels over a gradient, blurred drop shadow, controls at 55 % opacity until hovered | grid presentation (every race start) | Fixed |
| Rounded 6 px navy panel, 9 px labels in `rgba(255,255,255,.5)` | race briefing | Fixed |
| Teal-on-navy skin, rainbow rev bar, soft 100 px shadow, thin outlined buttons, `S COAST` mark in teal | festival menu, card, results, map, HUD | Fixed |
| Green pressed chip, browser-grooved fieldset borders and plain legends | Driving Academy, Sound mix, Audio cues | Fixed |
| Default blue underlined link on asphalt (1.8:1) | credits note | Fixed |
| `ShiftLeft`, `BracketLeft` printed as DOM key codes | controls, settings | Fixed (keycaps: `L SHIFT`) |
| Event tag chip floating beside the title and wrapping it | EVENTS cards | Fixed |
| Identical card grid | EVENTS | Open: a master list and a detail page (as the Wildcard board) would be the board's way |
| Unicode glyphs as icons (`✕`, `◀ ▶`, `Ⅱ`) | close buttons, proximity arrows, pause | Open, minor (the board has SVG glyphs) |
| Centred hero, emoji, lorem, placeholder copy | none found in any screen | clean |

### 3.4 Hierarchy and contrast (computed)

Nine defects (47 elements in the 1280x720 baseline, most of them the 27 locked Wildcard rows; the last three
were found only when the demo scenes ran at the other viewports), all fixed:

| Where | Pair | Ratio before | After |
| --- | --- | ---: | ---: |
| Wildcard tally medal letters (`.wc-tally b` took the disc's own `<b>`) | chalk on gold / silver / bronze | 1.5 / 1.4 / 2.9 | ink: at least 5.9 (asserted at 4.5) |
| RECORDS active tab's count | faint chalk on amber | 1.5 | ink on amber, 10.7 |
| Replay tag | chalk on flag red | 3.5 | ink, 4.7 |
| Timing tower, player holds the fastest lap | ink on timing purple | 3.7 | chalk, 4.5 |
| Locked demo rows (opacity .78) | faint chalk on asphalt-2 | 4.0 | opacity .9: 4.9 |
| Credits note link | default blue on asphalt | 1.8 | amber on asphalt, 9.4 |
| Steam demo: the FULL GAME tag on the chosen (paper) Wildcard row | paper on paper | 1.0 (invisible) | ink on paper |
| Steam demo: the chosen locked row's index and "on" at 90 % opacity | amber-ink on paper | 4.4 | the chosen row is not dimmed |
| RECORDS locked events (opacity .75): caption, bronze medal letter | faint chalk, ink on bronze | 4.2, 4.2 | opacity .9 |

The documented token pairs are now asserted (section 6): chalk, dim and faint on asphalt-0/1/2, ink on
paper / amber / flag / go / wet and the four plates, the signal and plate colours on asphalt-1, the medal discs,
and the high-contrast override (at least 6:1). The text over the 3D scene (masthead, footer hints, the nameplate)
is not computable in the DOM; it sits under a text shadow and the footer's scrim. The new character line has its
own asphalt board (chalk-dim on asphalt: 9.8:1) so it does not depend on the floor behind it.

### 3.5 Tiny text (Steam Deck legibility)

Counted in the 45 DOM scenes at 1280x720, as declared (before) and as the player sees it (after):

* **Before: 689 text elements under 11 px.** Settings 260, credits 96, festival menu 61, pause 35, results 24 (the
  HUD under it), the Wildcard board's FULL GAME tags 24, academy 10, Team HQ 13, events 10 ... The old sheets
  (`style.css`, `motocross.css`, `festival-hud.css`) declare 7 to 10 px for everything a player reads in a
  dialog. At the Deck's 7" 1280x800 that is about 1.4 mm.
* **After: 0 outside the race HUD.** One sheet, `type-floor.css`, lifts every selector the scan found to 11 px
  (labels) or 12 px (sentences of help text); `e2e/64` fails if a screen shows text under 11 px again.
* **Open: the race HUD.** Its panels are drawn at `transform: scale(var(--scale))`, so a 7 to 9 px label is
  6 to 8 px on screen: the unit labels (KPH, RPM), the sector tags S1 to S3 (7.9), the tyre letter (7.6), the
  vehicle-state panel, and the GP bike panel's captions (BRK, THR, LEAN, FRONT, REAR, TUCK: 7). The dock under
  the instruments (CHASE, PIT, ERS, DATA, REPLAY, AI), the VEHICLE toggle and the key caps in them are lifted
  to 11 px (they are not under a scaled panel). The rest needs a HUD type pass of its own because the panels
  are fixed-footprint (section 9, item 1). `e2e/64` exempts exactly `#hud`.

### 3.6 Mixed languages in one screen

`localization.md` section 3 lists what is not translated. Seen on screen, with the paddock set to German: the
**grid presentation** (LIVE, CREW PREPARATION, PLAY PREPARATION, SKIP TO START LIGHTS), the **festival** menu,
card, results and map, **EVENTS**, **CHAMPIONSHIP**'s body, **Driving Academy**, **Team HQ**, **Records**, **Credits**
and the **Photo studio** are English inside translated chrome. The grid presentation is the one on the first-hour
path (every race start); it needs about ten strings by seven languages and the dictionary gate. Not done in
this wave (section 9, item 3). The new loading plate uses existing keys, so it is localised.

### 3.7 Orphaned or legacy screens (the sweep)

Checked every screen in the list against the Paddock Board: main board (four plates), Wildcard board, career
season board and its four other pages, first launch, loading (four), race briefing (circuit and dirt), grid
presentation, pause, results and share card, settings (four scroll pages), controls, credits, Team HQ (four
pages), photo studio, Driving Academy, championship, events, RECORDS, the demo plate and the demo's Wildcard
board, the race HUD (formula, GP bike, dirt), the replay bar, the festival (HUD, menu, card, map), telemetry and
the error screen. On the old skin when I started: the grid presentation, the briefing, the festival (all
four panels), the Academy, the fieldsets, EVENTS (partly), the event-card dl labels, the career facts lists.
All brought onto the tokens. Still on the old skin by design or by cost: the race HUD (identity layer only),
the vehicle setup screen (per-vehicle sliders, token pass only), the reference review (developer only). The
telemetry dialog and the error screen are on the shared dialog tokens (captured as fixture scenes; the
telemetry fixture shows the empty frame, the charts are drawn by `main.ts`).

### 3.8 Alignment, dead space, clipped text

* **Fixed:** the rail index wrap; the EVENTS tag collision; career fact labels (`dt`) on one baseline in caps.
* **Fixed:** venue blurb cut to one line at 800 px tall (it clipped "quarry, orchard..." with an ellipsis); the
  machine line left the board, which gave the 1280x800 board its second line back (it stays one line below 780 px,
  where the board has no height to spare).
* **Open:** the dirt board's blurb ("Brake before the face. Q / Z shift rider weight; release to settle. Tap a
  brake to lower the nose ...") is cut at the dock when the dirt board scrolls.
* **Open:** the career pages other than the season board are tall lists (one event card fills 720 px).
* **Open:** the left column of the loading board still has a gap between the plate block and the session line at
  1280x720 (the map is vertically centred, the left column is not).

## 4. What changed

### 4.1 Showroom framing (item a)

`src/rendering/menu-preview.ts` (`showroomSpan`, `showroomRadius`, `showroomShift`),
`src/rendering/showroom-bounds.ts` (the drawn meshes' extent in the machine's frame, ignoring hidden parts and
flat translucent shadow planes, falling back to the collision box when out of a sane band), `renderer.ts`
(menu branch), `launch-board.ts` (`showroomWindowOf`: board right edge to rail left edge, or to the menu's
right margin where the rail drops under the board), `interface.ts` (a `ResizeObserver` on the menu, board and
rail), `main.ts` (hands the strip to the renderer; `apexDiagnostics().menuShowroom` and `showroomWindow`).

The camera aims so the machine's drawn extent is centred in the strip, and backs off, never closer than the
authored radius, just far enough that the machine at the widest point of its slow orbit fills at most 94 % of it
(`SHOWROOM_FILL`), at most 2.2 times the authored radius. Without a measurement it keeps the authored
composition. Predicted extents from the collision box (pixels, strip 520 to 1064 at 1280):

| viewport | machine | before | after |
| --- | --- | --- | --- |
| 1280x720 | APX-01 | 456 to 1147 (64 under the board, 83 under the rail) | 533 to 1051, clear |
| 1280x720 | EH-3 hypercar | 440 to 1163 (80 / 99) | 533 to 1051, clear |
| 1280x800 | APX-01 | 436 to 1203 (84 / 139) | 533 to 1051, clear |
| 1920x1080 | APX-01 | 685 to 1721 (84 under the rail) | 651 to 1610, clear |
| 1024x600 | APX-01 | 359 to 935 (161 under the board) | 523 to 989, clear |
| 1280x720 | GP-R1 / MX-450 | 559 to 1071 / 526 to 1091 (7 / 27 under the rail) | 537 to 1047 / 532 to 1052, clear |

In the real game (`apexDiagnostics().menuShowroom`: the renderer's own projection of the measured extent,
confirmed by eye on every capture, not pixel-measured; strip 520 to 1064 px at 1280, 624 to 1637 at 1920,
520 to 992 at 1024x600):

| viewport | APX-01 (circuit) | GP-R1 | MX-450 | EH-3 (festival) |
| --- | --- | --- | --- | --- |
| 1280x720 | 546 to 1038, R 13.2 m | 554 to 1030, R 4.8 | 549 to 1035, R 5.8 | 546 to 1038, R 13.2 |
| 1280x800 | 547 to 1037, R 14.7 | 549 to 1035, R 5.7 | 549 to 1035, R 6.4 | 547 to 1037, R 14.7 |
| 1920x1080 | 675 to 1586, R 10.7 | 739 to 1522, R 4.8 | 680 to 1580, R 4.7 | 674 to 1587, R 10.7 |
| 1024x600 | 535 to 977, R 12.7 | 536 to 976, R 5.0 | 537 to 975, R 5.6 | 534 to 978, R 12.7 |

Every machine sits inside its strip with the same margin on both sides (26 / 26 px for the APX-01 at 1280x720, 51 / 51
at 1920x1080, 15 / 15 at 1024x600): the predicted centre is on the strip's middle to the pixel, which is by
construction; the proof that the prediction matches the screen is the captures (`showroom-*-before-after.jpg`),
where the nose clears the board and the rear wing clears the rail at all four sizes. The circuit cars back off
to 1.1 to 1.6 times the authored radius (authored: 9.4 m); the bikes keep theirs at 1920x1080 and back off
by at most 1.4 times in the narrow strips (GP-R1 4.8 to 5.7 m, MX-450 4.7 to 6.4 m).

Two things the first real captures taught me, both fixed:

* The collision box is centred on the origin but the drawn car is about 0.2 m longer in front than behind
  (nose and wing), which left the APX-01 22 px left of centre with its nose touching the board. That is why the
  extent is measured from the meshes (`showroom-bounds.ts`) instead of read from the catalogue.
* **A motorcycle is not the `FormulaCar` that holds its slot.** My first measure read the hidden car's meshes,
  so the GP bike and the MX bike were fitted to a formula car's box: both backed off to the 2.2x cap and shrank
  to about a third of their authored size (a 170 px bike in a 544 px strip). The unit tests could not see it
  (they use boxes). The renderer now measures `BikeShells.drawnRoot(id)` (the visible level of detail of the
  drawn bike), and the diagnostics report the fitted box and the collision half extents beside the placement
  so a wrong box is visible in a capture.

### 4.2 The machine character line (item b)

Decision: **into the hero label area, at every height from 680 px up.** The nameplate (stencil name, class tag,
facts) and the character line are one card, `.car-card`, bottom right, on an asphalt board with a notch. The
line (still `#machineBlurb`, still the MACHINE select's `aria-describedby`) left the entry board, so the board
no longer folds a row out at 789 px, the venue blurb gets two lines back at 780 px and taller, and a screen
reader hears the same description at every size. Below 680 px the nameplate stays and the line is hidden
(the description is read from the hidden element). The motocross presenter rewrites only `.car-label`'s
children, which is why the card wraps the label rather than the label holding the line.
`e2e/60` "machine character line sits in the nameplate card ..." replaces the fold-out contract (the old test
pinned 789/768/761/720 hidden; the new one pins visible at 1280x800, 789, 768, 720 and 1920x1080, the board
fitting at every height, the card clear of the rail and the footer, hidden at 1024x600 with the description kept).

### 4.3 Legacy screens and loading (items c and d)

* **Loading** (`interface.ts` `loadingIdentity`, `loading-board.css`): the plate the player chose (shape,
  numeral, colour, as on the paddock), the discipline's pit-board message, the machine, and the venue's length
  and corners (the festival's events, roads and towns); the plate colour tints the session line's rule.
* **Race briefing and grid presentation** (`grid-presentation.css` rewritten, the inline `BROADCAST_STYLE`
  string removed from `grid-presentation.ts`): see section 3.3. The controls are now always visible; they sat
  at 55 % opacity until hovered, which a pad cannot do.
* **Festival** (`festival-board.css`, imported after `festival-hud.css`): colour, type, border and shadow only;
  the layout contracts of `e2e/49` are untouched.
* **Academy, events, fieldsets, career fact lists** (`screens-board.css`), keycaps (`input/bindings.ts`).
* **Type floor** (`type-floor.css`) and the **contrast fixes** of section 3.4.
* Everything above is flat: no gradient, no blur, no glow, no colour literal outside `:root`.

### 4.4 The files

New: `src/rendering/showroom-bounds.ts`, `src/ui/type-floor.css`, `src/ui/festival-board.css`,
`tests/showroom-framing.test.ts`, `e2e/64-design-critic.spec.ts`, and in `scripts/studio/tools/`: `ux4dom.mjs`,
`ux4-real.mjs`, `ux4-audit.page.js`, `ux4-audit-summary.py`, `ux4-smallfonts.py`, `ux4-carbox.py`,
`ux4-sheet.py`, `ux4-sheets.sh`.
Changed: `src/rendering/menu-preview.ts`, `renderer.ts`, `bike.ts` (`BikeShells.drawnRoot`), `src/main.ts`, `src/input/bindings.ts`,
`src/ui/` `interface.ts`, `launch-board.ts`, `front-end.css`, `grid-presentation.css` and `.ts`,
`loading-board.css`, `screens-board.css`, `hud-identity.css`, `wildcard-board.css`, `records-board.css`,
`demo-plate.css`, `festival-hud.ts`; `tests/front-end-board.test.ts`, `e2e/60-launch-board.spec.ts`,
`scripts/studio/tools/ux-fixture.ts`, `ART_DIRECTION.md` (section 19, token `--mb-f-note`).

### 4.5 Focus and reduced motion (items e and f)

Focus: every interactive element on every screen in the list is focused in turn, under the keyboard (after a Tab,
so `:focus-visible` matches) and with `#app[data-pad]` (the controller): the shared primitive in `front-end.css`
already draws a 2 px amber ring at 2 px offset and the pad rule extends it to `:focus`; the audit found no
element without an outline in either mode (500+ per viewport, 0 failures), so no focus CSS had to change.
The festival's own focus rule (3 px cream, 4 px offset) now agrees with the board (amber, 2 px).
Reduced motion: the lower third's slide and the loading bar's width transition were the only motion this wave
touched; both carry the `prefers-reduced-motion` and `[data-reduced-motion='true']` guards, `festival-board.css`
declares none and silences the old festival sheet's, and `e2e/64` reads the computed `transition-duration`
under `emulateMedia({ reducedMotion: 'reduce' })`. The nameplate card has no motion.

## 5. Intentional changes to pinned contracts

* `e2e/fixtures/i18n-en/paddock.html`: the machine line moved out of the board into `.car-card` (`<div
  class="car-card"><div class="car-label">...</div><p class="machine-blurb" id="machineBlurb">`).
* `e2e/fixtures/i18n-en/hud.html`: the injected HUD identity sheet gained two rules (the dock's 11 px floor, the
  fastest-lap player row's chalk text).
* `e2e/fixtures/i18n-en/settings.html`: the key cap for `ShiftLeft` reads `L SHIFT`.
* `e2e/60-launch-board.spec.ts`: the machine-line contract (section 4.2).
All three baselines were rewritten with `I18N_CAPTURE=1 ... -g "English markup"` and the word-level diff
checked: nothing else moved.

## 6. Guards added

* `tests/showroom-framing.test.ts` (31): the placement maths (centred in the strip through the orbit, inside it
  with the fill margin, never closer than authored, capped backing-off, unmeasured keeps the authored lens) for
  six machines at four viewports, and `measureShowroomBox` (pose-independent, ignores hidden parts and flat
  translucent planes, falls back when implausible).
* `tests/front-end-board.test.ts` (+11): the wave-4 sheets obey the anti-slop rules (no gradient, glass or
  glow; no colour literal outside `:root`; nothing under 11 px; motion only where declared and guarded); the
  legacy red, navy and 9 px strings stay out of the pre-race screens; the type floor is injected last; the
  machine line lives in the card; and **the token pairs meet WCAG AA** (parsed from `:root`, asserted with a
  luminance function).
* `e2e/64-design-critic.spec.ts` (4): every screen (36 + 6 HUD + 4 demo scenes) at 1280x800 and 1280x720: no
  text under 11 px outside `#hud`, no text under AA where the background is known, a focus ring on every
  interactive element under the keyboard and the pad; the four loading boards carry four plates, four colours and
  four names; reduced motion stops the lower third and the loading bar.

## 7. Verification (commands actually run)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` (after the last TypeScript change) | 0 errors |
| `npx eslint` on every changed or new `.ts` / `.mjs` / `.js` file | no output |
| `npx vitest run` on 16 files (front-end-board, front-end-light-sound, frontend-menus, frontend-retail, hud-identity, grid-presentation, bindings, menu-preview, menu-presentation, motocross-presentation, machine-character, startup, festival-presentation, showroom-framing, race-day, motocross-grid-preparation) | 159 passed; after the last change, 14 files (front-end-board 34, showroom-framing 31, hud-identity, front-end-light-sound, frontend-menus, grid-presentation, bindings, menu-preview, motocross-presentation, machine-character, i18n-english-identity, e2e-fixture-bundles 110, menu-presentation, startup): 265 passed |
| `CHROMIUM_PATH=/opt/pw-browsers/chromium APEX_WT=$PWD APEX_OUT=<dir> npx playwright test -c scripts/studio/tools/pw-dom.config.ts e2e/60-launch-board.spec.ts e2e/63-i18n-layout.spec.ts e2e/61-first-run.spec.ts e2e/62-results-settings.spec.ts e2e/59-career-hub.spec.ts e2e/64-design-critic.spec.ts` (first full run) | 23 passed, 3 failed: `e2e/63` "English markup" (expected: the intentional markup changes of section 5) and `e2e/64` twice (a 9 px tyre dot in the pause menu and a 10.8 px replay caption, both fixed in `type-floor.css`) |
| `I18N_CAPTURE=1 ... e2e/63-i18n-layout.spec.ts -g "English markup"` | 1 passed; three baseline files rewritten, word diff checked |
| `npx playwright test -c scripts/studio/tools/pw-dom.config.ts e2e/60 e2e/64 e2e/44-motocross-interface e2e/49-festival-menu-access e2e/59 e2e/61 e2e/62` (after the last changes except the demo fixes) | 36 passed, 1 failed: `e2e/60` "controller: LB/RB switch discipline..." ("controller button 14 was not handled", host load 8 to 12); re-run alone with `--repeat-each=3`: 3 passed. I could not tie the one failure to this wave's code and did not find a cause |
| `e2e/64-design-critic.spec.ts` after the demo-mode fixes (section 3.4) and the demo scenes added | 4 passed |
| **Final run, after every change**: the task's command, `e2e/60 e2e/63 e2e/61 e2e/62 e2e/59` plus `e2e/64` (one process, DOM config) | **26 passed** (5.0 min), including `e2e/63` "every language fits the first-hour screens at 1280x720 and 1024x600" and "English markup is unchanged" against the rewritten baseline |
| `npx vite build` into a scratch directory (the IP guard runs inside it) | exits 0, IP guard clean, five times |
| `node scripts/studio/tools/ux4-real.mjs ... --scenes menus,modals,race:circuit` (real game, build of this branch, preview on port 4298) | boot 55 to 73 s on the loaded host; 16 menu captures, the modals, loading, briefing, grid presentation, HUD and pause of a real Grand Prix at Aurel, back to the paddock: 0 page or console errors in every run; the race took about 25 minutes of wall time on SwiftShader |
| **Not run** | the full vitest suite and `npm run lint` as a whole (targeted files only, as briefed); the other real-game specs; any physical controller or GPU; GP bike, dirt and festival sessions in the real game (section 8) |

## 8. Not done, unverified, known issues

* The race HUD's small labels (section 3.5). Only the dock and the toggles were lifted.
* Real-game HUD frames: the formula HUD (and the loading board, briefing, grid presentation and pause) came from
  a real Grand Prix (`after-race-circuit-*.jpg` in the scratch run; the briefing and the grid presentation are
  also on `changed-prerace.jpg` as DOM fixtures). The GP bike, dirt and festival HUDs are DOM fixtures (synthetic
  frame, no scene behind them): a software-GL race to the HUD took 25 minutes on this loaded host, and the
  festival cannot be screenshotted in the real game on SwiftShader.
* The measured car placement in the real game covers the four menu plates at four viewports with the machine each
  plate selects by default (APX-01, GP-R1, MX-450 and EH-3), not every one of the 57 machines. The fit uses the
  drawn meshes, so a machine whose model is far from its collision box falls back to the box (`measureShowroomBox`
  bands) and could sit a few percent off centre.
* Strings: the grid presentation, festival, events, academy, Team HQ, records, credits and photo studio are English
  only (section 3.6).
* The default livery (section 3.1), the five overlapping doors (3.2), the events card grid (3.3).
* `ENTER CIRCUIT` on the dirt plate, and the dirt board scrolling at 800 px.
* No external art review and no player testing: "feels hand-authored" is my judgement from the captures.

## 9. Recommended next tasks (ranked)

1. **A HUD type pass**: raise the race HUD's labels to 11 px on screen (the panels are fixed-footprint: the
   tyre-state panel, the GP bike panel's captions, the sector tags, the unit labels), then drop the `#hud`
   exemption in `e2e/64`. Needs a look in a real race on a GPU host.
2. **Decide the default livery** (violet and lime today) with Vehicle Art; keep it as a preset.
3. **Localise the grid presentation** (about ten strings) and then EVENTS, the festival and the Academy; they
   are the English patches in a localised game.
4. **Make the short path the default** in the race-day briefing for a player who has watched the presentation once
   (or put one line under the three buttons), so a returning player reaches the lights in two inputs.
5. **One line under each paddock rail item** so CAREER, EVENTS, CHAMPIONSHIP, TEAM HQ stop overlapping; and rebuild
   EVENTS as a master list and a detail page like the Wildcard board.
6. **Real-game HUD and festival frames on a GPU host** for the GP bike, dirt and festival sessions, then look at
   the festival panels over the actual coast.
7. **A controller pass on a physical pad** for the festival menu and the grid presentation (their rings are
   verified; their D-pad order is not).
