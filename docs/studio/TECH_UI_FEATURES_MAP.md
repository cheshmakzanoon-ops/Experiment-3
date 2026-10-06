# TECH UI + FEATURES MAP: HUD, front end, photo mode and F1 25 feature gaps

Authors: Lead UI Engineer and Lead Game Designer (studio pre-production). This is analysis only: no source file
was changed. Line numbers refer to commit `3a6036d`.

**Companion docs.** `ART_BIBLE_B.md` §0.3 (tokens), §1 (HUD visual spec) and §4 (menus) give the target *look*:
sizes, hex colours and layout fractions. This doc gives the *wiring*: which node, function and test each
change touches, and which contracts block it. Where Art Bible B quotes a line number that has moved, the
numbers below are the current ones.

**Evidence viewed.** Baseline captures `00-menu`, `10`, `11`, `12`, `20` (SwiftShader 1280×720, Medium).
F1 25 references viewed for this doc: 085 (race chase), 089 (race + objectives), 094 (cockpit at the start
lights), 095 (pit lane panel), 097 (full map + virtual mirror), 070 (time-trial delta + MFD), 011, 015 and 017
(My Team and driver select, AVIF converted in `scratchpad/conv`). The references are described in words
only and were not copied.

---

## 1. Current architecture

### 1.1 Application flow (`src/main.ts`)

`type State = 'menu'|'loading'|'driving'|'paused'|'results'|'replay'|'photo'|'pregame'` (L108). Flow:

1. `GameApp` constructor (L208): `new Interface(#app, track, callbacks)` (L211). Then `PhotoStudio` (L250),
   `InputController`, `InputPump` (L275) and the window listeners. Then `boot()` (L374). It loads settings, team
   and championship from IndexedDB (`SaveStore`), builds the renderer (`buildRenderer` L345), and sets
   `current = menuPreview(track)` (a static one-car frame, `rendering/menu-preview.ts` L18). Then
   `state='menu'`. `ui.ready()` runs after the first drawn frame (L867-871).
2. Menu form submit (`interface.ts` L219-240) → `callbacks.start(options, holdOnGrid)` → `GameApp.start()`
   (L425). This switches circuit, spawns `PhysicsWorker`, posts `init`, waits for the first frame, calls
   `renderer.prepare()` (warm-up), sets up `SessionReplay` and `TelemetryRecorder`, and runs
   `prepareTimeTrial()` (L627). Then `state='driving'` and `ui.showMode('driving')` (L605-609).
3. A race without Quick Start, or PREPARE GRID, calls `pause()` (L1206) and then `openRaceBriefing()` (L1221,
   `ui/race-briefing.ts`). WATCH GRID PREPARATION → `beginGridPresentation()` (L1234, `state='pregame'`,
   `GridPresentationPanel`). GO STRAIGHT TO LIGHTS → `raceDaySkip` (L1466) → `resume()` (L1299). The worker
   then runs `PHASE.LIGHTS` (5 lamps, green at 5.6–6.5 s, `race.ts` L164 and L181-197).
4. A worker frame arrives → `accept()` (L700). This feeds `programme`, the time-trial ghost and
   `observeSession`. It calls `finish()` (L1314) at `H.PHASE===3` → results modal. Then replay
   (`enterReplay` L1351) and photo (`openPhoto` L1165).
5. RAF loop `frame()` (L734). It runs `renderer.draw(a,b,alpha,…)` (L852), then `ui.update(frame, renderer,
   auto, ers)` (L953; in replay it uses `renderer.presented.value`), then the programme and guide readouts
   (L959-966) and `audio.update`.
6. `action(name)` (L1441) is the single command bus for every `[data-action]` click (`interface.ts`
   L186-189), keyboard binding and gamepad button. The cases are at L1574-1897: camera L1695, pit L1701,
   ers L1709, autopilot L1728, replay L1740, telemetry L1752, team L1602, championship L1605, photo L1643.
   Lighting (`lighting:day|sunset|night`) is at L1551 and is only reachable from the Academy panel.

### 1.2 DOM tree (built once in `Interface` constructor, `src/ui/interface.ts` L134-177)

```
#app
├─ #loading .loading (#loadingText)                                    L135
├─ section#menu .menu                                                  L136-151
│   header.masthead (.brand, #circuitEdition)
│   .menu-body[role=region "Race setup and tools"] (#circuitEyebrow, h1, .intro)
│     form#sessionForm: #circuit #mode #laps #weather #opponents #compound #assist #startSlot
│       button.primary.enter "ENTER CIRCUIT" | button.enter[name=prepareGrid] "PREPARE GRID START PAUSED"
│     .menu-actions: 8 buttons data-action = settings controls championship team photo references sessionReview academy
│   .car-label (APX–01) ; footer.menu-footer (#circuitLength, #buildIdentity)
├─ section#hud .hud                                                    L152-166
│   .hud-top: .brand.small | .position-badge(#positionBadge,#positionField) | .session-status(#lapLabel,#flag,#weatherLabel) | [VEHICLE]* | [RACE INFO]* | .icon-button pause
│   aside.timing[aria "Live race classification"]: .panel-heading(#towerColumn) + #tower (.tower-row × cars: b,i,span,small)
│   .lap-panel: #lapDeltaLabel #lapDelta | #lapTime | #bestLap | #lastLap
│   #startSequence (#lights: 5×i, #startText)
│   #proximityLeft / #proximityRight (.proximity, data-proximity)
│   #raceMessage (role=status, aria-live)
│   .minimap: canvas#minimap 250×240 + #minimapCaption
│   .instruments: #vehicleAlert* #programmeHud #guideReadout #rpmLights(16 i) .dash-main(#gear #speed #rpm #ersMode) .pedals(#brakeBar #throttleBar) .resources(#battery #batteryBar #fuel)
│   aside.car-status → #vehicleMfd*: .vehicle-tabs (TYRES/ENERGY/DAMAGE) + #vehiclePage0..2 (#tires, #mfdFuel #mfdBattery #mfdMotor #mfdRegen #mfdBrakeBias, .health #health #lateralG #penalty, #mfdFloor #mfdRear #mfdStops)
│   nav.hud-actions: camera(#cameraLabel) pit ers telemetry replay autopilot(#autoLabel)
│   .touch-controls ; #raceInfoPanels* (compact drawer)
├─ #replayBar (#replayPlay #replayTime #replaySeek #replaySpeed, camera, photo, academy, replayExit)   L167
├─ #debug, #toast ; dialog#modal > #modalContent ; dialog#telemetryModal (#telemetryView, canvas#graph)
├─ section#photoStudio (PhotoStudio, appended by main.ts)
└─ section#gridPresentation (GridPresentationPanel, appended in beginGridPresentation)
```
`*` = injected at install. `installCompactRaceHud(hud)` (`compact-race-hud.ts` L7, called at `interface.ts`
L184) moves `.timing`, `.lap-panel`, `.minimap` and `.car-status` into `#raceInfoPanels`
(`display:contents` on desktop) and adds the RACE INFO toggle. `installRaceDayHud(hud)`
(`race-day-hud.ts` L21, `interface.ts` L185) turns `.car-status` into `#vehicleMfd`. It builds 3 tabs (the
tab count is hard-coded: `names` L35, keyboard wrap `%3` L79-85), adds the VEHICLE toggle (L90-96) and
prepends `#vehicleAlert` to `.instruments` (L121-127).
Rule in both modules: **reflow the existing nodes; never clone telemetry or add a second reader.**

### 1.3 CSS stack and cascade (the most common trap)

The order the browser sees:
1. `src/ui/style.css` (3,650 lines, imported in `main.ts` L36). Layers inside the file:
   - L1-1500: base geometry (`.hud-top` L361, `.timing` L407, `.lap-panel` L468, `.start-sequence` L506,
     `.minimap` L555, `.instruments` L577, `.car-status` L713, `.hud-actions` L768) and the base menu
     (L141-315).
   - L2401-2512: desktop "telemetry band" (`@media (min-width:1280px) and (min-height:680px)`).
   - L2514-3516: **APEX BROADCAST SKIN**. Tokens at L2520-2537 (`--font-display: 'Saira Variable'`,
     `--apex-flame #ff5a2a`). Italic `.brand` (L2618), the skewed `clip-path` chips, the orange
     `.tower-row.player` (L2994) and the white `.gear` tile (L3100).
   - L3422-3443: in-race restraint (no `backdrop-filter`, action bar at opacity 0.3).
   - L3517-3650: compact desktop broadcast sizes (tower 180 px, rows 22 px, gear 42 px, speed 38 px).
2. `compact-race-hud.css`, injected as a `<style>` inside `#hud` (imported `?inline`). Its
   `@media (max-width:1279px),(max-height:679px)` blocks win only on small screens.
3. `race-day-hud.css`, injected last, with selectors `.hud[data-race-day]…` at specificity ≥ (0,2,1). **This file
   wins on desktop.** It is why the cluster sits at the bottom right: `right:18px; bottom:52px; width:340px`
   (L30-42, gold top border `#d5aa72`), the tower is 174 px at `top:76px` (L120-137), the lap panel is
   196 px at the top right (L138-152) and the minimap is 174 px at the bottom left (L153-164).

Gotchas the HUD team must know:
- **The action-bar opacity bug.** `.hud[data-race-day] .hud-actions{opacity:.8}` (race-day L356-358) beats
  `[data-mode='driving'] .hud-actions{opacity:.3}` (style L3435). So the CHASE/PIT/ERS/DATA/REPLAY/AI OFF
  bar shows at 80% in every baseline driving frame (20-driving-a, 11, 12).
- **DOM fixtures load only `style.css` plus the bundled script.** The e2e/28, 35, 49 and 52 fixtures call
  `page.addStyleTag(style.css)` and bundle `e2e/fixtures/race-hud-layout.ts` with Vite lib mode. Any new HUD
  stylesheet **must** be imported `?inline` and injected from its `install…()` function, as race-day does.
  Otherwise the layout tests measure an unstyled DOM. A plain `import './x.css'` is not seen by the fixtures.
- Desktop/compact breakpoint: `max-width:1279px` or `max-height:679px`. The baseline 1280×720 uses the
  **desktop** layout.
- `--ui-scale` (0.8–1.35, `Settings.uiScale`) is applied as `--scale` and via `calc(Npx * var(--ui-scale))`.
- High contrast and colourblind are `html[data-high-contrast]` and `html[data-colorblind]` (style L3444-3458,
  L1482-1504 patterned flags, L2196). Keep them.

### 1.4 Update loop and data source

- Data comes from one `Float32Array` per frame (`simulation/protocol.ts`). `HEADER=16` is fully used by `H.*`
  (0-15). `F.*` per car is fully used (0-95; `WHEEL_BASE=96`). Then come 4 wheels × `W` (26), debris and
  skid, giving `CAR_STRIDE=249`. **There is no free slot for new race state** (see §3).
- `Interface.update()` (L317) runs each presented frame. Proximity and `observeGaps` (GapTimer, 10 m timing
  loops, L307-316) run every frame. Then `if (tick % 3) return` (L329-330): all text, bars, tower and
  minimap refresh at **1/3 of the frame rate**. Tower intervals refresh every 0.5 s of sim time (L449).
- `setText` (L303) only writes on change. Keep using it. Never set `innerHTML` per frame. (Today the tower rows
  are built once per field size, L435-441.)
- `drawMap()` (L509-555) clears and re-strokes the whole circuit polyline (about 1,537 points) on a
  250×240 canvas every third frame. The canvas is drawn at 1× and CSS-scaled to 174 px, so it looks soft and
  is not DPR-aware.
- Rev lights: 16 `<i>`, lit if `RPM > 5800 + i*465` (L386-388). `VEHICLE.shiftRPM=12300`,
  `limiterRPM=13700` (`config.ts` L97-99).
- Tyres: `W.CARCASS_TEMP` and `W.WEAR` (shown as `100*(1-wear)`), with the colour band hard-coded at
  `>120 #ed6847 / <60 #84acbe / else #75b7a1` (L389-399).

### 1.5 Baseline HUD as seen at 1280×720 (20-driving-a)

| Element | Measured position | Problem against F1 25 refs |
|---|---|---|
| Top bar | APEX + white skewed "P7/8" badge, then the "PRACTICE / LAP 1 · GREEN FLAG · 24°C / DRY TRACK" chips, VEHICLE, pause | F1 25 has no top bar: position and lap live in the tower header and the sector panel |
| Tower | x18–192, y76–280, 8 rows of 22 px, 3-letter codes, orange player row, italic | F1 25: 5-row window, surnames, team glyph, tyre ring, separate interval column, grey player row |
| Lap panel | x1066–1262, y76–216, four stacked labels | F1 25: an S1/S2/S3 tab strip, "pos / field" with the lap time, and a BEST row |
| Cluster | x922–1262, y536–668 rectangle, white gear tile, BRK/THR bars, yellow "BALANCED" chip | F1 25: a bottom-centre twin-pod "binocular" cluster with a BATT arc, a large gear and speed/RPM |
| Minimap | x18–192, y490–668, white ribbon, orange player dot, italic caption | F1 25: sector numbers, DRS tint, chequered S/F, yellow player triangle |
| Action bar | bottom centre at 80% opacity | absent in F1 25 |
| Proximity | red triangle + "CAR RIGHT" text at about 46% height | a red chevron at the car edge, with no text |
| Race message | top-centre italic strip, "DOUBLE YELLOW · 43 KM/H · NO OVERTAKING" | a flag banner with a swatch, auto-hidden after 4 s |

Note: in `10-chase` (grid) the HUD showed "P1 / 1" with an empty tower and no car dots. The root cause is
unverified (it may be a capture-timing artefact). QA should recheck it once the HUD is rebuilt.

---

## 2. Feature inventory vs F1 25

Status: **HAVE** = shipped and wired; **PARTIAL** = exists but below F1 25 scope or hidden; **MISSING**.

| Area | F1 25 | Apex today | Status | Where |
|---|---|---|---|---|
| Grand Prix race | yes | 1–10 laps (endurance 15/25), 1–12 cars, start slot | HAVE | `config.ts` L114-206, `world.ts` |
| Practice | yes | open practice, consistency programme via Academy | HAVE | `practice-programme.ts` |
| Qualifying → race weekend | Q1-Q3 / one-shot | 2 timed laps, spread field, grid from best lap | PARTIAL (no knockout, no sprint) | `race.ts` L218-236, `championship.ts` L153 |
| Championship / season | 24 rounds, standings, calendar | 4-round calendar (Aurel/Vellamar ×2), 25-18-…-1 points | PARTIAL | `core/championship.ts` L32-37 |
| Career / My Team | facilities, departments, finance, drivers, R&D | Team HQ: week loop, 3 departments, research → setup presets, ledger, driver signing, local rival | PARTIAL (modal UI, no 3D hub, no ratings) | `storage/team-career.ts`, `ui/team-hub.ts` |
| Story mode (Braking Point) | yes | — | MISSING (out of scope) | |
| Time trial + ghost | yes, leaderboards | saved per-circuit PB ghost, live delta | HAVE (no online boards) | `core/ghost-lap.ts`, `main.ts` L627-699 |
| Endurance + mandatory stop | n/a | yes | HAVE (extra) | `config.ts` L148-162 |
| Circuits | 24 + reverse layouts | Aurel 2.973 km, Vellamar 3.997 km | PARTIAL | `simulation/circuits.ts` |
| Weather | dynamic, forecast | clear / changeable / heavy rain, live water film | HAVE (no forecast UI) | `simulation/weather.ts`, `presentation.ts` L83 |
| Time of day | session option | day/sunset/night, reachable only in Academy | PARTIAL (hidden) | `main.ts` L1551-1560 |
| Tyre compounds | S/M/H/I/W with coloured sidewalls | 5 compounds, sidewall ring colour from `COMPOUNDS.color` | HAVE | `config.ts` L79-83, `rendering/car.ts` L653-656 |
| Tyre wear/temp/damage | yes | wear, surface/carcass temp, blistering, graining, pressure, puncture | HAVE (sim) / PARTIAL (HUD) | `W.*`, `#tires` |
| Fuel | yes | real mass, endurance top-up | HAVE | `F.FUEL` |
| ERS | none/medium/hotlap/overtake + overtake button | harvest / balanced (0.55) / attack (1.0), key E cycles | PARTIAL (no overtake button) | `vehicle.ts` L230, `main.ts` L1709 |
| DRS | zones, 1 s detection, flap animation | none (the player glb has an unused `PLAYER_DRS` node) | **MISSING** | §5.1 |
| Slipstream | yes | wake: −16% drag, −20…43% downforce | HAVE | `aero.ts` L31-37, `world.ts` L107-118 |
| Damage | wings, floor, sidepods, suspension | front/rear/floor/sidepod/suspension/puncture, detachable wing | HAVE | `simulation/damage.ts` |
| Pit stops | strategy, compound choice, manual limiter, box timing | pit request toggle, AI pit assist drives in, auto compound (medium if dry) | PARTIAL | `world.ts` L87-98, `race.ts` L315-359 |
| Penalties | track limits, collisions, unsafe release, speeding | track limits (5 s every 4th warning), jump start, overtaking under yellow, pit speeding, give-back | HAVE | `race.ts` L115-128, `marshal.ts` |
| Flags | green, yellow, double yellow, blue, red, chequered | green, local yellow, double yellow, blue, chequered | PARTIAL (no red) | `marshal.ts` L7 |
| Safety car / VSC | yes | — | **MISSING** | §5.3 |
| Formation lap | yes | grid presentation (38 s crew clearing), no lap | **MISSING** | §5.5 |
| Start | lights, clutch launch prompt | physical gantry + HUD echo, manual clutch | HAVE | `#startSequence`, `F.CLUTCH_*` |
| Flashback | yes | — | **MISSING** | §5.4 |
| Replay | broadcast cams, scrub | seek, ¼–2×, camera cycle, telemetry | HAVE | `replay-pages.ts`, `#replayBar` |
| Photo mode | free cam, filters, frames, time of day, logos | orbit/native views, focal, exposure, roll, DOF, studio/HQ backdrops, livery | PARTIAL | §4.9 |
| Livery / decals | yes | colour, number, wordmark, pattern, decal editor | HAVE | `photo-studio.ts`, `decal-editor.ts` |
| HUD MFD | strategy, tyres, ERS, damage, setup (live BB/diff) | 3 read-only tabs (TYRES, ENERGY, DAMAGE) | PARTIAL | `race-day-hud.ts` |
| Mini-map | full + local, DRS, sectors | full map, plain | PARTIAL | `drawMap` L509 |
| Name tags / virtual mirror | yes | — | MISSING | §4.7 |
| Racing-line assist | 3D coloured line | Academy road-centre chevrons ("not an optimal line") | PARTIAL | `rendering/driving-guide.ts` |
| AI difficulty | 0–110 slider | fixed `0.92 + (id%4)*0.014` | MISSING | `world.ts` L65 |
| Telemetry | via app | in-game channel plots, CSV, lap compare | HAVE (extra) | `#telemetryModal` |
| Radio / engineer | yes | — | MISSING | |
| Online / multiplayer | yes | — | out of scope | |

---

## 3. Protocol extension required for new race features

`F` (0-95) and `H` (0-15) are both full. `tests/wheel-alignment.test.ts` L56-67 locks the layout:
`PROTOCOL_VERSION===10`, `max(F)<WHEEL_BASE`, `SKID_BASE+SKID_STRIDE===CAR_STRIDE`.
Plan (one PR, owned by Gameplay):
- **Car tail block.** `RACE_BASE = SKID_BASE + SKID_STRIDE` (249), `RACE_STRIDE = 8`, `CAR_STRIDE = 257`, and
  `export const R = { DRS:0 /*0 off,1 available,2 open*/, DRS_ELIGIBLE:1, TYRE_AGE_LAPS:2, NEXT_COMPOUND:3,
  OVERTAKE:4, SECTOR_STATUS:5 }`.
- **Header.** `HEADER = 24` with `H.SC_PHASE:16` (0 none, 1 VSC, 2 SC deployed, 3 SC in this lap),
  `H.SC_S:17`, `H.SC_SPEED:18`, `H.DRS_ENABLED:19`, `H.LAP_LEADER:20`, `H.FORMATION:21`, and 22-23 spare.
- `PROTOCOL_VERSION = 11`. Update the wheel-alignment assertion to
  `SKID_BASE+SKID_STRIDE+RACE_STRIDE===CAR_STRIDE`.
- Every consumer uses `carBase()`, `HEADER` or `CAR_STRIDE` symbolically (`proximity.ts` L15,
  `pit-presentation.ts` L119, `race-review.ts` L94 and others). Replay pages store `version` and `stride` and
  reject mismatches (`replay-pages.ts` L147-155, L299-300). Ghost laps use their own 11 fields
  (`ghost-lap.ts` L8) and are unaffected. Write the new fields in `Simulation.writeFrame` (`world.ts`
  L129-311, next to the `F.SECTOR*` writes at L233-237).

---

## 4. Extension points: F1 25-style HUD and front end

**Structural recommendation.** Add `src/ui/f1-hud.ts` with `installF1Hud(hud)`/`updateF1Hud(hud, frame,
state)` and `src/ui/f1-hud.css?inline`. Call install **after** `installRaceDayHud` (`interface.ts` L185) and
update from `Interface.update()` next to `updateRaceDayHud` (L373). Scope every rule under
`.hud[data-race-day][data-f1]` so it beats race-day's (0,2,1) without `!important`. In `style.css`, delete the
italic and skew skin rules for the HUD (L2852-3345). Keep the tokens. Put Art Bible B §0.3 tokens on `:root`
(L2520). Keep all existing ids: tests and `GameApp` read them (§6).

### 4.1 Timing tower (sector colours, gaps, tyre, 5-row window)
- **Nodes.** `aside.timing` (L154). Rows are built at L435-441 as `<div class="tower-row"><b></b><i></i><span></span><small></small></div>`
  and filled at L454-484 through `querySelector('b'|'i'|'span'|'small')`. **Append** new children:
  `<em class="tyre" data-c>` (compound ring), `<u class="flag">` (fastest-lap or penalty badge). Do not reorder
  the existing ones.
- **Header.** Move the `#lapLabel` node (L153) into a new tower header: "APEX | RACE" plus "LAP 3 / 10". Move
  the node; do not duplicate it. `#lapLabel` text must still contain `TIME TRIAL` and `QUALIFYING` (e2e/47 L100,
  48 L77). `.session-status` must still exist (e2e/49 queries it). It may be emptied or visually hidden.
- **Names.** Replace `driverCode()` (L467, `gap-timer.ts` L103) with the surname `name.split(' ').at(-1)`
  (`DRIVERS` in `config.ts` L230: 'A. MOREAU' → MOREAU). Keep `title` set to the full name.
- **Tyre ring.** Use `frame[carBase(id)+F.COMPOUND]` → `Object.keys(COMPOUNDS)[i]` → `COMPOUNDS[k].color`
  (`config.ts` L79-83: soft `#e7444f`, medium `#f6cf45`, hard `#e1e1db`, inter `#49bb82`, wet `#529bea`).
  These are **the same colours the car sidewalls use** (`rendering/car.ts` L656, `supplied-player.ts` L456).
  Expose them as CSS vars `--tyre-soft…` from TS at install time, so the HUD and the cars never diverge.
  Art Bible B's `--tyre-*` hexes differ slightly. Pick one and change `config.ts` if art wants the B values.
- **Gaps.** Race: keep `GapTimer.interval(ahead,id)` and `formatInterval` (L483). Add a "to leader" mode with
  `interval(order[0], id)`, toggled by clicking the header. Qualifying/practice: best lap minus pole best
  (L477-480 already shows best laps). Status words: `PIT` (`F.IN_PIT`), `FIN`, `DNF` (`F.RETIRED`, not shown
  today), and `+5s` in orange when `F.PENALTY` > 0.
- **Fastest lap.** `argmin F.BEST_LAP>0` over cars → that row gets `data-fastest` (purple `#b418cc`).
- **5-row window without breaking tests.** e2e/28 L102 and L153, 35 L88 and L127 and 36 L73 and L114 assert
  `.tower-row` **count == cars**. e2e/28 L85-160 needs the tower to **scroll on End** at 1280×680 ×1.35.
  Solution: keep every row in the DOM and mark rows outside `[playerRank-2, playerRank+2]` with
  `data-window="out"`. Then use CSS `.timing:not(:focus-within) .tower-row[data-window=out]{display:none}`.
  Keyboard focus expands to the full scrollable list, so the scroll test still passes.
- **Sector colours** need per-sector session bests, which the sim does not publish. Add
  `src/ui/sector-timing.ts` `class SectorBoard { observe(frame) ; state(car, sector): 'none'|'yellow'|'green'|'purple' }`.
  On each car's `F.SECTOR` change (0→1→2→0), read the completed time from `F.SECTOR_1..3` (world.ts L234-236;
  current lap or else last lap), discard it if `F.LAP_VALID` is 0, and compare it with that car's personal
  best and the overall best. Own it in `Interface` next to `gaps` (L123) and reset it in `observeGaps` when
  `cars` changes (L309-313). Sectors are **equal thirds of the lap** (`race.ts` L101).

### 4.2 Sector / position / lap panel (top right)
- Node: `.lap-panel` (L155). Keep `#lapDeltaLabel`, `#lapDelta`, `#lapTime`, `#bestLap` and `#lastLap`. Tests:
  e2e/47 L98-102 expects `#lapDeltaLabel` = "DELTA TO PB", `#lapDelta` matching `/^[+-]\d+\.\d{3} S$/`, and
  `#bestLap` containing "m:". Prepend `<div class="sector-tabs"><i data-s=0><i data-s=1><i data-s=2></div>`.
  Fill the current tab by `((F.S mod (L/3)) / (L/3))`. Add a `<b class="pos">6<small>/ 20</small></b>`. This
  replaces the top-bar `.position-badge`, which must stay in the DOM because e2e/49 measures it. Hide it with
  `display:none` (zero area is fine).
- Delta row (time trial and practice): the green/red hatch from Art Bible B §1.4. The data attribute
  `#lapDelta[data-ahead]` (L359) already exists.
- Geometry contract: `lap.bottom < instruments.top` (e2e/28 L77).

### 4.3 Speed / gear / ERS / DRS cluster
- Node: `.instruments` (L160-162). Keep `#speed #gear #rpm #battery #fuel #ersMode #rpmLights #brakeBar
  #throttleBar #batteryBar #programmeHud #guideReadout` and the `#vehicleAlert` prepend.
  `#speed` must read `162` at 45 m/s (e2e/28 L79, 35 L82); the `padStart(3,'0')` at L334 may be dropped.
  `#fuel` and `#battery` **must stay visible** (e2e/28 L80-82, 35 L83-84, 36 L67-68). F1 25 does not show fuel,
  so keep it as a small 9 px line under the right pod.
- Build the binocular shape as **inline SVG** in `installF1Hud`. Use two `<circle>` arcs with
  `stroke-dasharray` driven by CSS vars set in `updateF1Hud`: `--batt = F.BATTERY/VEHICLE.maxBatteryJ`
  (4e6) and `--rpm = (RPM-idleRPM)/(limiterRPM-idleRPM)` (4200…13700).
- Rev LEDs: change the L386-388 thresholds to `shiftRPM*(0.80 + i*0.0143)`, which makes the last LED
  ≈ shiftRPM. They blink blue at `RPM >= limiterRPM`. Keep 16 children, or update both the template (L160)
  and the update loop together.
- ERS mode `#ersMode` (L377-379) maps `['HARVEST','BALANCED','ATTACK'][ers]`. Under the gear, show the F1 25
  status line: HARVESTING (`F.REGEN_POWER>1kW`) or DEPLOYING (`F.MOTOR_POWER>1kW`).
- DRS pill: needs `R.DRS` (§3, §5.1). States are 0 = `#2a2d36` dim, 1 = outline `#a6e04a`,
  2 = filled `#a6e04a` with glow.
- **Blocking geometry contracts.** e2e/28 L72-79 requires `instruments.top > 0.5·vh`, **`left > 0.5·vw`**,
  `bottom ≤ vh-48`, `right ≤ vw-10`, and `resources.right ≤ instruments.right`. e2e/52 L62 requires the open
  MFD to sit **left of** the dash. A bottom-centre cluster (Art Bible B: x .392–.605) **fails** the `left>0.5vw`
  rule. The HUD lead must change these deliberately in the same commit:
  28 L74 becomes `a.left > vw*0.3 && a.right < vw*0.7`, and 52 L62 becomes a no-overlap check between the MFD
  and the dash rectangles. All other assertions stay.
- Footprint budget (e2e/49 L10-12): `.timing + .lap-panel + .car-status + .instruments + .position-badge +
  .session-status` < **12%** of 1600×900 and 1920×1080. The F1 25 proportions (5-row tower 0.235×0.294 = 6.9%,
  sector panel 1.3%, cluster 0.213×0.142 = 3.0%) total about 11.2%. That leaves little margin: hide the badge and
  the session strip.

### 4.4 Tyre wear widget
- Data: per wheel `W.WEAR` (0..1), `W.SURFACE_TEMP`, `W.CARCASS_TEMP`, `W.BLISTERING`, `W.GRAINING` and
  `W.PUNCTURED`, at `carBase(0)+WHEEL_BASE+i*WHEEL_STRIDE`. Wheel order is `FR, FL, RR, RL` (`protocol.ts` L12).
  Lay them out as **FL FR / RL RR** on screen.
- Add an always-on mini widget (a car outline with 4 rounded tyres, filled by temperature band, plus a 2 px wear
  bar) inside `.instruments` to the right of the speed pod. Being inside `.instruments` means it costs no
  separate footprint. Temperature bands follow Art Bible B §1.7 (<70 `#4fa3ff` … >115 `#ff3b30`).
- Keep the existing `#tires` grid as MFD page 0 (`race-day-hud.ts` L52). It is the data the e2e/52 TYRES tab
  shows.
- MFD pages: to add STRATEGY (next compound, laps on the tyres) and SETUP (live brake bias / diff), generalise
  `names` (L35) and the hard-coded `2` and `%3` (L79-85) to `names.length`. e2e/52 L54-56 expects
  ArrowRight from ENERGY to land on DAMAGE, so append new pages **after** DAMAGE.

### 4.5 Mini-map
- `drawMap` (L509-555) and `minimapFrame` (L61-80). Keep `minimapFrame(Aurel)` returning
  `{cx:0,cz:0,scale:0.24}` (`tests/circuits.test.ts` L83). Keep `#minimapCaption` with the circuit name (e2e/46
  L33, L62 use `toHaveText`). It can be visually hidden during driving.
- Upgrades:
  - **Cache the track path.** Build a `Path2D` once in `setTrack()` (L497) instead of 1,537 `lineTo` calls
    every third frame.
  - Size the backing store at `devicePixelRatio`. Keep the drawing in a 250×240 logical space via
    `ctx.setTransform(dpr,…)`.
  - Sector numbers at s = 0, L/3, 2L/3 via `track.at(s)`, a chequered S/F glyph, and DRS zones (§5.1) tinted
    `#3fae49`.
  - Car dots 10 px with a team-colour fill (`LIVERIES[id]`, `config.ts` L244) and a 1.5 px `#0b0c10` outline,
    drawn in reverse race order. The player is a `#f5e11c` triangle along the tangent.
  - Yellow-flag sectors pulse (`F.LOCAL_FLAG`).
- Optional "local snake" mode (F1 25 085/089): draw ±350 m around the player, rotated so travel is up, behind a
  setting.

### 4.6 Banners, flags, penalties, start lights, proximity
- Race message: L404-432 builds one string, written to `#raceMessage` (role=status). Change it to a banner
  component `{swatch, title, sub}` with `data-kind` (flag/penalty/pit/info) and a 4 s auto-hide. Keep
  `#raceMessage` as the aria-live text node. Sources: `H.FLAG`, `F.CAUTION_SPEED`, `F.BLUE_CAR`, `F.PIT_PHASE`,
  `F.WARNINGS` (track limits), `F.PENALTY` deltas, and `vehicleWarning()` (`race-day-hud.ts` L4-17).
- `#flag` chip (L360-361) → the banner swatch. Art Bible B §1.9 gives the colours.
- Pit lane panel (F1 25 095): show it when `F.IN_PIT`. It shows `F.PIT_CLOCK`, plus phase words from
  `F.PIT_PHASE` 1-6 (the strings at L415-423).
- Start lights `#startSequence` (L156, CSS L506-539 and L3249-3276): 5 × 5.6 vh lamps centred at y 0.31.
  Contract: `lights.bottom < instruments.top` (e2e/28 L76; 35 L75-76 allows "left of" instead).
- Proximity (`proximity.ts` `nearbyTraffic` returns `clear|near|overlap`): `#proximityLeft/Right` (L157)
  become red chevrons at the screen edge. Drop the "CAR LEFT/RIGHT" text but keep it in `aria-label`. Keep the
  colourblind outline rule (style L2196).
- **Name tags (new).** Add a `#nameTags` layer under `#hud`. In `update()` the `renderer` is already passed:
  project `renderer.cars[i].root.position + (0,1.25,0)` with `renderer.camera`. Show at most 5 tags (all on the
  grid, only the car ahead while racing, hidden beyond 120 m). Use `transform: translate3d`, never `top/left`.

### 4.7 HUD hygiene
- Top bar `.hud-top` (L153): hide the brand, badge and session chips while driving. Keep the pause
  `.icon-button`, the VEHICLE toggle (e2e/52 clicks it by name on desktop) and RACE INFO (compact).
- Action bar `.hud-actions` (L164): fix the opacity bug (§1.3). In `data-mode=driving`, set `opacity:0` and
  restore it on `:focus-within`/`:hover`. `applyBindings` (L628-633) keeps writing `kbd` labels.
- Remove `.hud-top:before` scrim (style L370-376 and L2817).

### 4.8 Front end: menu polish and My Team-style hub
- **Menu** (`interface.ts` L136-151; CSS base L141-315, short-height L1095-1125, skin L2664-2811; 3D backdrop
  camera `renderer.ts` L975-984: orbit radius 6.8 m, height 2.45, fov 45, sway ±0.12 rad at 0.07 rad/s;
  menu redraw capped at 15 fps for idle states, `main.ts` L791-797).
  - At 1280×720 the form overflows: the headline and CIRCUIT row are scrolled out in `00-menu`.
  - F1 25 direction: a left list with a red-pink active pill (`#fc4854`), cards and a cinematic backdrop.
  - Feasible within the contracts: tabbed panels inside `.menu-body`. **RACE** holds the 8 selects and both
    start buttons. **CAREER** holds championship and team. **GARAGE** holds settings, controls and photo.
    **TOOLS** holds references, sessionReview and academy, styled small. Use CSS-only tabs (radio +
    `:has()`) so the buttons stay in the DOM in source order.
  - For the backdrop: a slower orbit, a lower camera (h 1.2 m, fov 32), and a photo-style DOF focus on the car.
    `renderer.setPhoto` already drives a BokehPass-like `photoFocus` (`renderer.ts` L799-807).
  - **Contracts:**
    - `#menu .menu-actions button` count **8**, each clickable (e2e/30 L70-76).
    - From `.menu-body` focus, **11 Tabs** reach GARAGE & SETTINGS (e2e/28 L279: 8 selects + ENTER + PREPARE
      + settings). Adding a select (time of day, AI level) must update that loop count.
    - Region name "Race setup and tools" sits between `.masthead` and `.menu-footer`, with no horizontal
      scroll (e2e/28 L241-251, 30 L45-51).
    - Exact button names: ENTER CIRCUIT, PREPARE GRID START PAUSED, GARAGE & SETTINGS, CONTROLS, CHAMPIONSHIP,
      TEAM HQ, PHOTO / LIVERY, REFERENCE REVIEW, SESSION 146 EVIDENCE, DRIVING ACADEMY.
    - `#circuitLength` text (e2e/46 L34).
    - The supplied player car shows real sponsor marks in the menu (BYBIT/ORACLE in `00-menu`; glb node names
      `RB19_*`). This is flagged in GAP_ANALYSIS for the producer; it is not a UI decision.
- **My Team hub** (`ui/team-hub.ts` `teamHub()` L36-85, rendered into `#modal`, CSS `#modal:has(.team-hub)`
  style L1514-1640; `main.ts` `openTeam` L1118, `teamAction` L1124).
  - F1 25 (011-016) look: full-bleed 3D HQ or office backdrop, top-left tab pills (active `#fc4854`), translucent
    cards with 8 px radius, big tabular numerals, and an income/outgoings bar (`#58e06a` / `#fc4854`).
  - Plan: before `modalContent(teamHub…)`, set `renderer.setPhoto({...DEFAULT_PHOTO, backdrop:'headquarters',
    view:'orbit', depthOfField:true})`. Force one redraw (`renderedState=null`), then open the dialog with a
    transparent `::backdrop`. Restore with `setPhoto(null)` on close.
  - **Contract:** e2e/07 L107-114 expects `presentation.menuCovered === true` and **no new frames** while the
    hub is open. Keep the hub in `#modal`, and draw the backdrop once before the modal opens.
  - Keep the page buttons named Headquarters, Engineering, Personnel, Finance, ADVANCE ONE WEEK, COMMISSION
    STUDY, APPLY TO NEXT SESSION, and `data-action="team:staff:engineering:2"` (e2e/07 L116-130).
  - Keep `.team-hub[aria-busy]`. The vitest suites check that the HTML has no `<img>` or `<script>`
    (`team-career.test` L153-158) and keep the `teamCalendar` text ("Projection only", "/ DUE",
    `reference-depth.test` L427-447).
  - Driver select (017): an `.driver-card` with RTG plus EXP/RAC/AWA/PAC stats would need new `DRIVERS` fields
    in `team-career.ts` L5-38.

### 4.9 Photo mode upgrades
- UI: `ui/photo-studio.ts` (`sliders` L13-23, template L120-126). Model: `rendering/photo-camera.ts`
  (`PhotoSettings` L3-21, `DEFAULT_PHOTO` L22-38, `validatePhoto` L40-73, `photoOffset` L79, `photoLens` L91).
  Renderer: `setPhoto` L782-814, exposure `toneMappingExposure = daylight.exposure * 2**photo.exposure`
  (L940), grade `this.grade.apply(...)` (L1302). Capture: `main.ts` L902-940 → `renderer.capturePhoto()` (L932).
- Upgrades, in priority order:
  1. **Filters.** Add `filter: 'neutral'|'vivid'|'cinematic'|'mono'|'warm'|'cool'` and `vignette`, `grain`
     and `saturation` sliders. Implement them as a *photo-only* `GradeProfile` override in
     `BroadcastGradePass` (`broadcast-grade.ts` `apply()` L184-198). **Do not** change `GRADE_PROFILES`:
     gameplay grain, fringe and sharpen are tested as zero.
  2. **Free-roam camera.** Add `panX/panY/height` offsets on the orbit target in `photoOffset`, plus a "camera
     on track" mode.
  3. **Time of day / sun angle.** Lighting is fixed per mode (`daylight.ts` `SUN_OFFSET` L7, `SUNSET_OFFSET`
     L8). Add a photo-only sun-azimuth override. Note that this triggers a far-shadow rebake (0.4–0.7 s
     software GL).
  4. **Frames, borders and logo stamp.** Composite them in the capture path on a 2D canvas after
     `capturePhoto()`. Keep the PNG filename `apex-photo-<ms>.png` (e2e/07 L52).
  5. Hide driver, crew and other cars.
  6. Rule-of-thirds overlay (DOM only, never captured).
- Contracts:
  - IDs used by e2e/07, 08, 09 and 15 and `scripts/reference-ui-check.mjs` L125-169: `#photoStudio`,
    `#photoTarget`, `#photo-focalLength`, `#photo-distance`, `#photo-elevation`, `#photo-depthOfField`,
    `#photo-focusMode`, `#photo-focusDistance`, `#photo-survey`, `#photoBackdrop`, `#photoStatus` (texts
    "Livery saved", "REFERENCE 005"), `#photoReference` ("Reference 002 linked"), `.photo-drawer`, and the
    "DOWNLOAD PNG" button.
  - Slider ids are generated as `photo-${key}`, so new sliders get new ids automatically.

---

## 5. Top missing features (feasible, ranked by player impact ÷ effort)

### 5.1 DRS (impact 9, effort 3, owner Gameplay + HUD + Car art)
- **Circuit data.** Add `drsZones: readonly {detect:number; start:number; end:number}[]` to
  `CircuitDefinition` (`circuits.ts` L16-38). Proposed values come from the measured straights (radius >180 m,
  sampled from `Track.points` curvature; re-check against the AI speed trace):
  - **Aurel** (2,972.7 m): main straight 2,255 → 505 (wrapping through S/F) → `{detect:2180, start:2300,
    end:470}`. Optional second zone on the 578–1,071 run: `{detect:520, start:620, end:1000}`.
  - **Vellamar** (3,997.3 m): 3,381 → 679 → `{detect:3330, start:3420, end:640}`, and 1,862–2,785 →
    `{detect:1800, start:1900, end:2720}`.
- **Rules** (RaceDirector, `race.ts`):
  - Enabled from race lap 3 (`laps[i].completed >= 2`). Disabled when `track.meanWater() > 0.3` (the same
    threshold as the intermediates call in `world.ts` L93), during yellow in the zone (`control.flags[i]`),
    and in practice and time trial (always available there, as in F1 25).
  - Eligibility: at `detect`, the interval to the car ahead is under 1.0 s. Store per-car detect crossing
    times, the way `LapTracker` interpolates gates (L64-76).
  - Closes on brake > 0.05, at zone end, or on a flag change.
- **Physics.** `Vehicle` gets a `drs` flag. In `aero()` (`aero.ts` L15-39) apply
  `out.rear *= (1 - 0.22*drs)` and `out.drag *= (1 - 0.11*drs)`. Pass the flag from `vehicle.ts` L395. The AI
  opens it whenever eligible (`ai.ts` update). The player gets a new binding **KeyF**
  (`input/bindings.ts` DEFAULT_BINDINGS L1-18) and a gamepad `drs` button action
  (`input/button-actions.ts` L3-14). Write `R.DRS` and `H.DRS_ENABLED` (§3).
- **Visuals.** Rotate the player glb node `PLAYER_DRS` (present, not yet in `requiredNames`,
  `supplied-player.ts` L44-57) about its lateral axis. Check the pivot; aim for about −0.5 rad open in 0.15 s.
  Rivals (`a61-rival-*.glb`) have no separate flap: add one in the rival rebuild, or skip it.
- **HUD.** Cluster pill (§4.3), minimap zone tint, banner "DRS ENABLED", and the wheel LCD
  (`steering-display.ts` L16-51).
- **Tests.** Add a vitest for detection (1.0 s gate), the wet lockout and the aero deltas. Keep
  `scripts/validate.ts` and the dynamics benchmarks green: DRS must be off in single-car benchmark laps unless a
  benchmark opts in.

### 5.2 Pit strategy + tyre compound choice + MFD STRATEGY page (impact 7, effort 2)
- `world.ts` `requestPit()` L87-98 hard-codes `'medium'` in the dry. Extend `{type:'pit'}` to carry
  `compound?: Compound` (`workers/diagnostics.ts` ClientMessage L32, worker L92-94).
- Add an MFD STRATEGY page (§4.4) with `‹ SOFT | MEDIUM | HARD | INTER | WET ›` coloured by `COMPOUNDS.color`,
  plus laps on the current set. Laps on the set need tyre-age tracking (a `Vehicle` field written to
  `R.TYRE_AGE_LAPS`).
- Tower tyre rings (§4.1) then reflect each car's real compound changes after stops.

### 5.3 Safety car + VSC (impact 8, effort 5)
- **VSC first (effort 2).** In `MarshalControl.update` (`marshal.ts` L128-295), when VSC is active set every
  car's `zoneDistance=0` and `zoneSpeed = 0.6 × its free-running reference`, or a flat 32 m/s for a first cut.
  The AI already obeys `control.targetSpeed()` (L112-117). Trigger it from a severity-2 incident lasting >8 s.
  Banner "VIRTUAL SAFETY CAR" with a `#ffd21f` "VSC" board. Overtaking under VSC → existing
  `OVERTAKE_UNDER_YELLOW` logic.
- **Physical SC (effort 3 more).**
  - RaceDirector state `{phase, s, speed}`, written to `H.SC_PHASE/H.SC_S` (§3). The SC enters ahead of the
    leader at the pit exit (`s≈330`), runs at 45 m/s, and the field queues. The per-car target is the car
    ahead at a 25 m gap, through `zoneDistance/zoneSpeed`.
  - "SC in this lap" → the SC peels into the pit at `entry = length-210` (`race.ts` L322).
  - Render it with a presentation-only car modelled on the ghost hook: `renderer.setGhost`/`ghost.update`
    (`renderer.ts` L553-565, L1140) → `setSafetyCar(pose)`. Reuse the A61 rival far/mid LOD with an original
    livery and an amber light bar (`MeshBasicMaterial`, emissive ×6 so bloom catches it, 2 Hz alternation).
    **No real-brand marks.**
  - Tests: the field never passes the SC, and lap counting continues.

### 5.4 Flashback (impact 8, effort 5; highest technical risk)
- The sim is deterministic per tick: fixed 1/120 s (`core/math.ts` FixedStepper L132-160), seeded `Random`,
  and no `Math.random` or wall clock in `src/simulation/` (verified by grep).
- Design: **input log + deterministic re-simulation.**
  1. In the worker (`physics.worker.ts`), log `{tick, controls}` on every `setInput`, including the watchdog
     input `brake:0.4` at L124 (wall-clock driven, so it **must** be logged). Also log `{tick,'pit'}` and
     `{tick,'autopilot',v}`.
  2. New `{type:'flashback', tick}`: rebuild `new Simulation(options)`, replay the log to `tick` in slices
     (≈2,000 steps per `setInterval` turn, with a progress message), truncate the log, send a snapshot.
  3. Main thread: add `SessionReplay.truncate(time)` and `TelemetryRecorder.truncate(time)`. Neither exists.
     `SessionReplay.append` rejects non-increasing time (`replay-pages.ts` L160-190), so truncation is
     mandatory.
  4. UI: a pause-menu FLASHBACK button opens the replay scrubber limited to the last 30 s. "RESUME FROM HERE"
     posts flashback. Show a 5-per-race counter. Bind **KeyX**.
- Prove determinism first with a vitest: run 2 × 3,000 ticks with the same logged inputs and compare
  `writeFrame` buffers bitwise. Cost is unmeasured: a 3-lap Aurel race is about 19,000 ticks to replay. Add
  periodic re-sim checkpoints only if the measured time exceeds 2 s.

### 5.5 Formation lap (impact 6, effort 6)
- `PHASE` values are consumed widely (`H.PHASE<2` = grid in renderer, grid-preparation, pit and HUD), so do
  **not** renumber them. Add `H.FORMATION` (§3) as a sub-state of `PHASE.GRID`. The AI drives the whole field
  around at ≤ 30 m/s in grid order, with weaving allowed. The player drives (or uses the pit-assist autopilot)
  and must stay in order. Cars then stop in their own grid boxes using the existing grid slot coordinates
  (`world.ts` L60-63: `length-32-floor(slot/2)*10`, lateral ±2.2).
- Stopping precisely in the box needs an AI "park at s,l" controller. That is the main cost.
- Gate it behind the race briefing ("FORMATION LAP" button next to WATCH GRID PREPARATION, `race-briefing.ts`
  L24). e2e/51 checks the existing buttons by name.

### 5.6 Smaller feasible items
- **Time of day in session setup** (effort 1). Add a `#timeOfDay` select to `#sessionForm` (L139-146) that
  dispatches the existing `lighting:*` action (`main.ts` L1551). Update the e2e/28 L279 tab count 11 → 12.
- **AI difficulty** (effort 1). `SessionOptions.aiLevel` (0.85–1.0) replaces the constant `0.92` in
  `world.ts` L65. `validateOptions` is at `config.ts` L183. Same tab-count note.
- **Overtake button** (effort 1). A momentary ERS mode 2 with a 4 s cap. HUD "OVERTAKE" prompt under the
  cluster (F1 25 094/095).
- **Pit box timing mini-game** (effort 2, F1 25 095). On `F.PIT_PHASE` 1→2, rate how close the stop came to
  the box centre: `|s-box|` < 0.5 m OPTIMAL, < 1.2 m GOOD, else LATE (`race.ts` L321-330). This is
  presentation only.
- **Virtual mirror** (effort 2). Reuse a mirror feed render target (`rendering/mirrors.ts`) blitted to a DOM
  `<canvas>` in T-cam and chase. It adds draw cost (≈300–575 draws per mirror update, per the gap matrix).

---

## 6. UI tests that must keep passing

Total: `npm run check` covers lint, about 1,432 vitest cases and the build. e2e runs in 8 browser shards.

**DOM-fixture e2e** (no WebGL; fixture `e2e/fixtures/race-hud-layout.ts`, which loads only `style.css` plus the
bundled TS and its `?inline` CSS):
| Spec | Asserts (ids, text, geometry) |
|---|---|
| `e2e/28-race-hud-layout.spec.ts` (test 1) | For 7 viewports × 4 cameras × 3 scales × guidance: `timing.bottom < minimap.top`; instruments top > 0.5vh, **left > 0.5vw**, bottom ≤ vh−48, right ≤ vw−10; `lights.bottom < instruments.top`; `lap.bottom < instruments.top`; `.resources` inside `.instruments`; `#speed`=`162`; `#battery #fuel #rpm` visible. The 12-row tower scrolls on End/Home with focus; keydown is swallowed and keyup still fires; `.panel-heading` is sticky; `.tower-row` count 12 across resizes. PREPARE GRID / ENTER CIRCUIT pass identical options with `holdOnGrid` true/false |
| `e2e/28-race-hud-layout.spec.ts` (6 menu tests) | Region "Race setup and tools" between `.masthead` and `.menu-footer`; no horizontal overflow; wheel and keyboard scroll; **11 Tabs → GARAGE & SETTINGS focused**; settings `[name=quality]` → APPLY & SAVE; buttons CONTROLS (→UNDERSTOOD), TEAM HQ, PHOTO / LIVERY, REFERENCE REVIEW, SESSION 146 EVIDENCE, DRIVING ACADEMY dispatch their actions; "Close settings" |
| `e2e/35-aurel-race-quality.spec.ts` | Compact: RACE INFO `aria-expanded=false`, `.timing` hidden, instruments below `.hud-top`, `#speed #gear #rpm #battery #fuel` in viewport and inside instruments; region "Live race information"; Escape refocuses RACE INFO; `.tower-row`=12; nodes retained across resizes; at ≥1280 `.race-info-toggle` hidden, `.timing` and `.minimap` visible |
| `e2e/49-hud-footprint.spec.ts` | Area of `.timing .lap-panel .car-status .instruments .position-badge .session-status` < 12% at 1600×900 and 1920×1080 (chase and cockpit). **All six selectors must exist** |
| `e2e/52-vehicle-hud.spec.ts` | `#vehicleAlert` visible with "PUNCTURE"; VEHICLE (desktop) / RACE INFO (compact) buttons; tabs TYRES/ENERGY/DAMAGE (role=tab); `#mfdFuel`="24.0 KG", `#mfdBattery`="80%", `#mfdFloor`="100%"; ArrowRight ENERGY→DAMAGE; desktop `#vehicleMfd` y>60, **right edge < `.instruments` x**, bottom ≤ vh−48; Escape hides it and refocuses the toggle |
| `e2e/30-menu-access.spec.ts` | `#menu .menu-actions button` **count 8**; each click dispatches its `data-action`; focus stays inside `.menu-body`; ENTER CIRCUIT → start:race; PREPARE GRID START PAUSED |

**Full-app e2e touching UI**:
- `application.spec` (ENTER CIRCUIT, GARAGE & SETTINGS, APPLY & SAVE, RESUME SESSION, `#debug` texts,
  `#telemetryModal`, `#graph[data-view]`, EXPORT CSV, WATCH REPLAY, `#replayPlay` PLAY/PAUSE, `#replaySpeed`,
  RETURN, RETURN TO PADDOCK, `#toast` "saved" / "Import rejected" / "already assigned" / "Preferences saved",
  `[data-bind=camera]`=C, `.results` without RUNNING).
- `07/08/09/15` (team hub and photo ids, §4.8–4.9).
- `36-compact-race-journey` (`.tower-row`=8, RACE INFO / CLOSE INFO, `#replayBar`, PERFORMANCE CAPTURE,
  TOGGLE AI DEMONSTRATION, `#modal [data-action=academy|lighting:sunset|modalClose]`).
- `46-vellamar-circuit` (`#circuit`, `#mode`, `#opponents`, `#minimapCaption`, `#circuitLength`).
- `47-time-trial-ghost` (`#opponents` disabled, `#lapDeltaLabel`, `#lapDelta`, `#lapLabel`, `#bestLap`).
- `48-championship-weekend` (CHAMPIONSHIP, `.championship-calendar li.next`, "START ROUND 1 · QUALIFYING",
  `#lapLabel` QUALIFYING, `#modal` "QUALIFYING / CLASSIFICATION", "START RACE FROM THIS GRID",
  `.championship-note` "ROUND 1 OF 2" / "PTS", STANDINGS, `#laps`/`#opponents` enable rules).
- `50-grid-presentation` and `51-race-day` (`#raceBriefing` with compound and fuel text, WATCH GRID
  PREPARATION, `.grid-timeline` hidden, PAUSE PREPARATION, BACK TO BRIEFING, `#raceDayQuickStart`,
  PRE-RACE PRESENTATION, `#gridPresentation`).
- `replay-state`, `presentation`, `settings-transition`, `30-menu-access` test 2.
- `e2e/race-entry.ts` helper (`#raceBriefing`, GO STRAIGHT TO LIGHTS).

**Vitest touching UI**:
- `tests/circuits.test.ts` (`CIRCUIT_MENU_LABELS` km text, `minimapFrame`).
- `gap-timer.test.ts` (GapTimer, `driverCode`, `formatInterval`).
- `proximity.test.ts`.
- `race-day.test.ts` (`raceBriefing` contains P3/HARD/fuel; `vehicleWarning` strings LOW FUEL / AERO DAMAGE /
  PUNCTURE).
- `presentation.test.ts` (settings migration to **version 6**: new Settings fields need defaults, not a version
  bump, unless this test changes).
- `reference-depth.test.ts` (`teamCalendar`, audio accessibility controls).
- `team-career.test.ts` (`teamHub` escaping).
- `wheel-alignment.test.ts` L56-67 (protocol layout, §3).
- Bindings: adding DEFAULT_BINDINGS keys (KeyF DRS, KeyX flashback) must not break saved bindings.
  `validateBindings` throws on a collision. Copy the clutch fallback pattern at `bindings.ts` L47-53 (pick
  the first free key) for every new action.

**Deliberate test edits the HUD lead must own** if the F1 25 layout is adopted:
- e2e/28 L74: centre band instead of the right half.
- e2e/52 L62: no overlap instead of left-of.
- e2e/28 L279: the tab count, if menu selects are added.
- wheel-alignment L59 and L67: the protocol bump.

Every other assertion stays as written.

---

## 7. Suggested UI/feature tickets (for the producer's wave plan)

| # | Ticket | Files | Effort (agent-days) |
|---|---|---|---|
| U1 | Token and type reset: remove HUD italics, skew and orange; Art Bible B tokens; fix action-bar opacity; remove scrim | `style.css` L2514-3443, `race-day-hud.css` L356 | 0.5 |
| U2 | `f1-hud.ts` + `f1-hud.css?inline` scaffold; binocular SVG cluster; rev LEDs; ERS arc; status line; test edits 28/52 | `interface.ts` L160-162, L185, L373, L386 | 1.5 |
| U3 | Timing tower v2: header with `#lapLabel`, surnames, tyre rings, windowed rows, fastest-lap row, `SectorBoard` | `interface.ts` L154, L433-484; new `sector-timing.ts` | 1.5 |
| U4 | Sector/lap panel + delta hatch | `interface.ts` L155, L353-370 | 0.5 |
| U5 | Mini-map v2 (Path2D cache, DPR, sectors, DRS, triangle) | `interface.ts` L497-555 | 1 |
| U6 | Banners, flags, penalties, pit-lane panel, chevrons, start lamps | `interface.ts` L156-158, L404-432 | 1 |
| U7 | Tyre widget + MFD pages generalised (STRATEGY, SETUP) | `race-day-hud.ts` L35-89 | 1 |
| U8 | Menu tabs + cinematic backdrop; My Team hub on the HQ stage | `interface.ts` L136-151, `team-hub.ts`, `main.ts` L1118, `renderer.ts` L975 | 2 |
| U9 | Photo mode filters, free-roam, sun angle, frames | `photo-studio.ts`, `photo-camera.ts`, `broadcast-grade.ts`, `renderer.ts` L782, L1302 | 1.5 |
| G1 | Protocol v11 (header 24, car tail block) | `protocol.ts`, `world.ts` L129, wheel-alignment test | 0.5 |
| G2 | DRS end to end | `circuits.ts`, `race.ts`, `aero.ts`, `vehicle.ts`, `ai.ts`, bindings, `supplied-player.ts` | 2 |
| G3 | Pit compound choice | `world.ts` L87, `diagnostics.ts`, worker | 0.5 |
| G4 | VSC, then physical SC | `marshal.ts`, `race.ts`, `renderer.ts` L553 pattern | 1 + 2 |
| G5 | Flashback (determinism test first) | worker, `world.ts`, `replay-pages.ts`, `recorders.ts`, `main.ts` | 3 |
| G6 | Time of day + AI level in session form | `interface.ts` L139-146, `config.ts` L114-206, `world.ts` L65 | 0.5 |
| G7 | Name tags | `interface.ts` update, `renderer.camera` | 0.5 |
| G8 | Formation lap | `race.ts`, `ai.ts`, briefing | 3 |

Order: G1 → (U1 ∥ G2 ∥ G3) → U2/U3/U4 → U5/U6/U7 → G4 → U8/U9 → G5 → G8.
After each HUD ticket, re-run e2e 28, 35, 49, 52, 30, 36 and 47 locally before pushing.
