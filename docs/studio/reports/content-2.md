# Content Design (tracks and events), wave 2: unexpected places

Branch `studio/content-venues-2`, cut from `main` at `c818caa`. Preview port 4241. Everything below comes from
commands run in this worktree on a shared 4-CPU box (load average 5 to 16 for most of the session); anything not run
is labelled so. Read first: `content.md` (wave 1), `weather-2.md`.

## Scope and result

| # | Task | Result |
| --- | --- | --- |
| 1 | Four new unexpected venues | **Done.** `haut-givre` (ski-resort road), `marram-field` (airport), `kalder-dam` (dam crest over water), `saffron-lane` (night market). Each passes `geometry-checks`, a seeded 6-car Formula race (`catalogue-races.ts --merge`) and unit tests; all four appear in the CIRCUIT menu (data-driven). |
| 2 | Eight more Wildcard events | **Done.** 8 events on the new venues, all passing `scripts/wildcard-races.ts` (snow x2, dawn fog, dust, storm x2, night rain, night clear). The series is **29 events, 17 cross-discipline**; board unit test and e2e counts updated. **Five candidate pairings failed their race and were dropped; four more passed and were not shipped** (table below). |
| 3 | Visual check | **Partly done.** 20 frames (4 venues, 3 events; grid and mid-lap, plus one before-fix frame), 1024x576 JPEG, 36 to 63 KB, critiqued below. Only 3 of the 8 events were looked at, 13 of 20 frames are Low quality, and several things were not seen (list below). One dressing defect fixed and verified in a frame; one **load-blocking bug** found by the capture and fixed. |
| 4 | Checks and docs | `validate:content`, `tsc`, eslint, prettier and 201 targeted unit tests pass. `docs/CIRCUIT_CATALOGUE.md` updated. e2e **not run**. |

## The four venues

All four are authored in `src/simulation/circuit-catalogue/wildcard-venues.ts` with the same DSL and venue-kit spans as
Level Nine (`tunnel`, `rock`, `drop`, `facades`, `stands`, sea level). New code is data: three `VenueTheme` rows
(`airport`, `dam`, `market`) in `rendering/venue-kit/theme.ts` and `rendering/assets/sky-catalogue.ts`, and an optional
advisory `catalogue.suggested` (`{ lighting, weather }`, builder.ts and venue-data.ts) so a venue states the light and weather it
was dressed for. Nothing in the simulation or renderer reads `suggested`; a menu may. No new renderer code except the
one-line fix described under "Bug found by the capture".

| Venue (id) | Lap | Corners / DRS | Elevation, max grade | Character (visual) | Character (driving) | Suggested | Seeded Formula race |
| --- | ---: | --- | --- | --- | --- | --- | --- |
| HAUT-GIVRE / SKI RESORT ROAD (`haut-givre`, alpine theme) | 3650 m | 13 / 2 | 60 m, 10.0% | hotel frontage at the base, rock cuttings on the mountain side, two roofed snow galleries, conifers | six R18 hairpins stacked up a slope, a 700 m ridge run, a steep final descent | snow, midday | PASS best 1:43.0 (127.6 km/h), impact 0 |
| MARRAM FIELD / APRON AND RUNWAY (`marram-field`, `airport` theme) | 3686 m | 9 / 2 | flat | concrete everywhere, floodlight masts, hangar and terminal blocks | 28 m wide, 1.6 km runway, R55 blast-pad turn, two taxiway chicanes, R30 apron slalom | dawn fog (sunset light) | PASS best 1:08.8 (192.8 km/h), impact 0 |
| KALDER DAM / CREST ROAD (`kalder-dam`, `dam` theme, sea -20 m) | 3329 m | 10 / 2 | 3 m, 1.6% | 1 km crest with water on both hands and concrete walls 17 to 20 m down to it, powerhouse yard, spillway gallery, lake-shore road | flat-out crest, R60 corners, a lake-shore slalom | clear, midday (events: storm) | PASS best 1:02.1 (192.9 km/h), impact 0 |
| SAFFRON LANE / NIGHT MARKET (`saffron-lane`, `market` theme, night) | 2016 m | 8 / 0 | flat | 8.8 m lanes, concrete walls 1.2 m off the asphalt, lit frontage, street lamps, two covered halls | three R26 hairpins, a spice-row slalom, tight 90s | clear, night | PASS best 1:00.1 (120.7 km/h), impact 0 |

Authoring notes (what the tools caught):

* `traceSpec` showed the first Haut-Givre cut ending 427 m from the line (the descent column was drawn 400 m too far
  south); the descent was re-cut to two hairpins and a 4% larch sweep and the lap now closes with a 38 m (1%) adjustment.
  Marram Field and Saffron Lane closed within 6 m and 26 m; Kalder within 93 m (2.8%).
* The first Saffron draft summed to 450 degrees of turn and collapsed to 792 m; the second was a 600 x 120 m rectangle
  that read as a corridor, so it became a three-lane serpentine with R26 hairpins.
* Kalder Dam's start is on the powerhouse yard (land), not the crest: the paddock and the default stand sites sit next to
  the start line, and the crest and shore road have `drop` spans. A unit test checks the ground under every stand site and the
  paddock is above the water line.
* **Snow galleries do what they should.** `Track` shelters tunnel rows, so in the snow preset the gallery is bare road between
  two white stretches; `tests/wildcard-venues-2.test.ts` asserts frozen cover is 0 under the roof and positive beside it, before
  and after 60 s of snowfall. The market's covered halls are checked dry in rain and dust (sheltered rows).
* The old venue-kit test suite asserted that "some detail cells are out of range from the start line". That is false for a
  2 km venue, so `tests/venue-kit-suite.ts` now asserts it only for laps over 2.5 km and adds "from 6 km away no detail cell
  is visible" for every venue; it also accepts the street-lamp group name for street-lamp themes (stricter, not weaker).
  All four venues were added to the dressed list of `tests/venue-kit-wave2.test.ts` (kit built from data in Node).

## The eight events

All run exactly as the player loads them (`wildcardSession`), seeded AI at 120 Hz (`scripts/wildcard-races.ts`), evidence merged into
`docs/wildcard-races.json` (29 events, every one passing). The new weather states: snow, dawn fog, dust, storm; plus night rain.

| Event (id) | Kind | Machine | Venue / weather / light | Laps x cars | Best lap | km/h | Worst stop | Max stray | Max impact | Incidents / SC | Pitch |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| SUPERCARS IN THE SKI RESORT (`supercars-in-the-ski-resort`) | class-mismatch | SC-7, RM-8, RD-2, RR-4 | Haut-Givre, snow | 1 x 4 | 373.5 s | 35.2 | 0 s | 1.7 m | 0.24 | 10 / 0 | four road machines on a snowed-in resort road: six hairpins, polished wheel tracks |
| TROPHY TRUCKS ON THE SKI ROAD (`trucks-on-the-ski-road`) | cross-discipline | DX-8 | Haut-Givre, snow | 1 x 5 | 404.3 s | 32.5 | 1.5 s | 0 m | 0 | 27 / 1 | six hairpins, a ridge run, a gallery where the snow stops |
| TROPHY TRUCKS ON THE TAXIWAY (`trophy-trucks-on-the-taxiway`) | cross-discipline | DX-8 | Marram Field, dawn fog, sunset light | 2 x 5 | 135.8 s | 97.7 | 0.2 s | **11.75 m** | 0 | 0 / 0 | runway sprint, blast-pad turn, chicanes, gate slalom |
| HYPERCARS ON THE RUNWAY (`hypercars-on-the-runway`) | class-mismatch | HY-9, HY-11 | Marram Field, dust | 2 x 6 | 88.4 s | 150.1 | 0 s | 0 m | 0 | 0 / 0 | 1.6 km runway through 170 m of amber haze |
| KARTS ON THE DAM ROAD (`karts-on-the-dam-road`) | class-mismatch | SK-125 | Kalder Dam, storm | 3 x 6 | 117.2 s | 102.3 | 5.5 s | 0.7 m | **0.42** | 11 / 0 | parapets, water 20 m below both sides, gusts |
| FORMULA CARS IN A GALE ON THE DAM (`formula-gale-on-the-dam`) | class-mismatch | FX-26 | Kalder Dam, storm, wet tyres | 2 x 6 | 88.2 s | 135.9 | 0 s | 0 m | 0.002 | 0 / 0 | a kilometre of concrete, 20 m of water, gusts |
| KARTS IN THE NIGHT MARKET (`karts-in-the-night-market`) | class-mismatch | SK-125 | Saffron Lane, rain, night | 3 x 6 | 88.9 s | 81.7 | 0 s | 0 m | 0 | 0 / 0 | covered halls stay dry, open lanes do not |
| SUPERMOTO IN THE NIGHT MARKET (`supermoto-in-the-night-market`) | cross-discipline | SM-450 | Saffron Lane, clear, night | 3 x 6 | 85.5 s | 84.9 | 0 s | 0 m | 0 | 0 / 0 | three hairpins, halls, a slalom; 0 rider falls |

Honest notes on the passes: they are single-seed AI runs against the existing bounds (stuck 8 s cars / 20 s riders, stray 12 m,
20% off-road share, no recovery, no retirement, half the field with a valid lap, 0.5 falls per rider-lap). The snow races are
the roughest: 10 and 27 incidents and one safety car, laps of six and a half minutes at 33 to 35 km/h, so both are **one lap**
(two laps of either was 13 minutes). The taxiway trucks stray 11.75 m of a 12 m bound (the blast-pad turn). The dam karts touch
(impact 0.42) and one parks 5.5 s. A human will not match these numbers.

### Pairings that did not hold (and what each did)

Run with the same harness; evidence for these is not kept in `docs/wildcard-races.json` (it only holds the series), so the numbers are from the run logs.

| Candidate | Result |
| --- | --- |
| **Formula car (FX-26) on the ski road in snow, 6 cars x 2 laps** (the brief's own example) | **FAIL.** Three cars stood 19.3 / 10.1 / 11.3 s, three marshal recoveries, 57 incidents, impact 0.73, 0 of 6 valid laps. Winter-grooved wets do not rescue a 0.25 g road on R18 hairpins at 8 to 10%. The physics does not support it, so it is not shipped. |
| Supermoto on the ski road in snow | FAIL: 0 of 6 valid laps, a rider stood 7 s, 17% of racing time off the road (no falls recorded). |
| Hot-hatch racers on the ski road in snow | FAIL: 1 of 6 valid laps (best 413.7 s). |
| Karts on the ski road in snow | FAIL: a kart stood 9.4 s, two strayed 14.6 and 14.9 m, 0 of 6 valid laps. |
| Karts on the runway (`changeable`) | FAIL: a kart stood 17.0 s, four strayed 13.0 to 13.3 m (place not isolated), one retired. |
| GP bikes at dawn on the airport (fog, sunset light) | PASS, **not shipped** (150.6 km/h, 0 falls in 12 rider-laps; the series already has GP bikes on a runway). |
| Hypercars in the night market | PASS, not shipped (107.1 km/h, impact 0). |
| Trophy trucks in the night market in a dust storm | PASS, not shipped (64.5 km/h, impact 0.011). |
| Hot-hatch racers in the night market | PASS, not shipped (85.9 km/h, impact 0.004). |

Pattern: on a snow road with hairpins only high-grip-per-newton machines (supercars on wets, trucks on all-terrain tyres) complete
a race; karts, hatches and bikes run wide or park. Karts on the airport ran 13 m wide (I did not isolate where; the R55 blast-pad turn at the end of the runway is the only tight corner after a flat-out straight, so it is the likely place).

## Visual check (what I saw; honest critique)

Frames: `docs/studio/reports/content2-screens/` (1024x576 JPEG, at most 63 KB, SwiftShader, headless Chromium). Captured with
`scripts/studio/content2-capture.mjs` (a new tool: boots the real menu once, starts a practice session from the form or a
Wildcard event from its board, drives the AI autopilot for N seconds, parks the session on the pause modal, hides it, saves a
frame). **Caveats on every frame:** the player's car stood on the grid for the minutes the software renderer needed to finish
loading, so the "grid" frames show a session clock of 12 to 236 s, no start lights (except the karts) and sometimes a
"double yellow" for the parked car; they are views of the grid, not of the lights. Frames marked `-low` were captured at **Low**
render quality (no shadows, crowd or particles, simpler sky), because at Medium the renderer's 45 s GPU fence timed out under load
(see "Bug found by the capture" and Not verified).

| Frame | What it shows | Verdict |
| --- | --- | --- |
| `haut-givre-snow-grid.jpg` (Medium) | -4 C, 440 m of view, snow on the road, hotel/pit blocks left in the haze, grandstand with snowy firs right | Reads as a snowed-in resort start. The grandstand roof carries the word **AUREL** (the shared grandstand model, not this venue): pre-existing (seen in this one frame), not touched. |
| `haut-givre-snow-climb.jpg` (Medium) | 53 km/h on the climb: white bank left, dark rock cutting right, firs and ridge in haze | Good mountain-road look. A curved structure ahead on the right is either the first cutting or the first gallery; I cannot tell from this frame. |
| `marram-field-dawn-fog-grid.jpg` (Medium) | amber-grey dawn fog, gantry "MARRAM FIELD / APRON AND RUNWAY", floodlight mast, pit blocks, stand | The venue's name board works; the haze reads as dawn. |
| `marram-field-dawn-fog-taxiway.jpg` (Medium) | 142 km/h, low sun at the horizon, glowing fog, masts, terminal blocks, kerb in red and blue | The strongest frame of the set: a believable airport at dawn. The terminal and hangar blocks are plain tan boxes in the fog (no windows visible). |
| `kalder-dam-storm-grid.jpg`, `-shore-road.jpg`, `-shore-bend.jpg` (Medium) | storm: 65 mm/h rain, wind 9 to 14 m/s; yard and powerhouse blocks, then the lake-shore road with a rock cutting left and parapet and catch fence right | Dramatic, but **the lake does not read**: beyond the fence there is a flat grey-brown plane to the hills (the terrain data says it is water 17 m below, `terr.ts`: the ground is -27 m against sea -20 m). |
| `kalder-dam-clear-grid-low.jpg`, `-crest-low.jpg`, `-crest-2-low.jpg` | clear day: powerhouse blocks, stands; then 189 to 211 km/h along the crest with water on **both** hands, green hills, parapets and catch fences, a 150 m board | Reads exactly as a dam crest road. This is why the venue's suggested weather is clear; the storm events do not show the water. |
| `saffron-lane-night-grid-low.jpg`, `saffron-lane-night-hairpin-low.jpg` | lit windows, gantry board, street lamps, concrete walls, a tall-frontage hairpin | A convincing night street, **not a market**: no stalls, awnings or strung lights exist in the kit, so it reads as a generic city. The lamps show as heads only (Low). |
| `event-trophy-trucks-taxiway-grid-low.jpg`, `-run-low.jpg` | trucks on the grid and at 47 km/h in orange fog, flat tan cloud discs above | Low-quality sky; the orange reads closer to dust than dawn (the weather-2 report flagged the same). The truck at 47 km/h after 45 s is the autopilot launching, not a venue defect. |
| `event-karts-dam-grid-low.jpg`, `-shore-road-low.jpg`, `-crest-low.jpg` | karts on the grid with lights, then the shore road and the crest in rain | Same story as the storm frames: parapets, fence posts and hills read; the water does not. |
| `event-supercars-ski-grid-low.jpg` | four road machines on a snowy grid, gantry "HAUT-GIVRE / SKI RESORT ROAD", snowy stands | Good. |
| `event-supercars-ski-hairpin-BEFORE-rock-wall-low.jpg` | the first hairpin dressing | **Defect:** a plain grey wall 7 to 16 m tall wrapping the outside of the hairpin and filling the screen. |
| `event-supercars-ski-hairpin-low.jpg` | after removing `rock` from the six hairpin arcs (it stays on the legs) | Fixed: the outside now opens onto firs and snow slopes behind a guardrail; cars sliding on the polished road with the double yellow. |

Defects looked for and not found in the frames I have: floating props, walls clipping the road, bare ground beside the road. They
do not prove absence elsewhere on the lap.

### Bug found by the capture (fixed): the airbase venues could not load

The first Marram Field session stayed in the `loading` state for 20+ minutes with a console error
`A35 equipment enters pit driving clearance` (thrown by `tyreEquipmentPlacements` in `RacingRenderer.create`). The garage tyre
equipment is anchored at a fixed 35 m from the centreline (the standard 22 m pit lane plus 13 m of bays). On a right-hand paddock
with a **26 m** lane (`gpPit(1, { offset: 26 })`) the equipment lands inside the lane's clearance. A Node script over all 47 road
circuits showed **`salt-flat` (Bright Basin) throws the same error**: that venue, and the existing Wildcard event
`grand-prix-bikes-on-the-runway` on it, cannot have loaded in a browser. Fix (`src/rendering/tyre-trolleys-racks.ts`, 3 lines): for a
right-hand paddock the anchor is `max(35, pit.offset + 13)`, which is exactly where the venue kit puts the bays. Every other circuit
keeps 35 m: the clearance listing for all other circuits is identical before and after. `tests/wildcard-venues-2.test.ts` builds the
placements on every catalogue circuit (Node only) so this cannot return unseen. I did not load Bright Basin in a browser after the fix.

## Verified (commands run in this worktree, results)

* `npx tsc --noEmit`: pass (re-run after the last source edit).
* `npx eslint` on every changed source, test, e2e and script file: pass; `npx prettier --check` on them: pass.
* `node --experimental-transform-types scripts/validate-content.ts`: `Content valid`.
* `scripts/catalogue-races.ts haut-givre,marram-field,kalder-dam,saffron-lane --merge`: 4 PASS (`docs/circuit-catalogue-races.json`, other layouts untouched).
* `scripts/wildcard-races.ts` over 17 candidates in three runs, then the two ski events re-run at one lap: the 8 shipped events PASS, evidence merged
  (`docs/wildcard-races.json`; existing events' evidence is byte-for-byte unchanged, the diff is additions only).
* `npx vitest run` (targeted, `--maxWorkers=2`), **13 files, 201 tests pass**: `wildcard-venues-2` (10, new), `wildcard-series` (50), `wildcard-board` (13),
  `wildcard-career-flow`, `circuit-catalogue`, `circuit-catalogue-wave2`, `circuit-catalogue-wave2-review`, `catalogue-menu-events`, `venue-kit`, `venue-kit-wave2`
  (33, four new venues built into a scene in Node), `tyre-trolleys-racks`, `career-catalogue-growth`, `circuits`. (An earlier batch of six files also passed 73/73 with one
  vitest-worker RPC timeout, "Timeout calling onTaskUpdate", a load artefact and not an assertion.)
* `npx vite build`: pass, IP guard clean (no real-brand names: all venue, corner, event and signage text is original).
* 20 browser frames as above.

**Not run:** `e2e/60-launch-board.spec.ts` (counts edited to 29 / 17 by hand: title, door label, `0 OF 29`, 29 rows, `1 OF 29`), the full vitest suite
and `npm run check` (CPU rule), `npm run lint` over the whole tree, any GPU or hardware frame, any festival frame, any audio.

## Not verified / open (honest list)

* **What I could not see.** The inside of a snow gallery and the hairpin stack from above; the airport runway at speed and the hangar row; the Kalder spillway
  gallery, powerhouse turn and the west-edge slalom; the Saffron covered halls and its Medium-quality (shadowed) look; any of: trucks on the ski road,
  hypercars in dust, the formula gale, karts in the night-market rain, the night-market supermoto (5 of the 8 events were never looked at). Weather and light
  combinations other than the one in each frame (a night ski road, a dust market) are unseen.
* **Medium quality on the night market is unproven.** Four of four Saffron Lane session loads at Medium (one at 800x450) hit "GPU preparation did not complete
  within 45000ms" at load average 8 to 16 and the session never left `loading`; at Low it loaded every time. Six of nine Medium loads failed that way overall
  (also Marram Field once and a truck event once), none of six Low loads. It is a software-GL fence timeout under CPU starvation, not a proven fault of the
  venue, but I could not rule out that the night market is heavier than the others (many lamps and lit windows).
* Saffron Lane has no market props (stalls, awnings, lamps on strings); "market" is a name, a night theme and covered halls.
* Kalder Dam's water is invisible in storms (see frames), so the dam's two storm events show a walled straight and hills; clear weather shows the water.
* The capture frames never include the pit lane or garage.
* Single seed per event; human play will differ (snow in particular: the AI numbers understate how hard a covered road is for a person).
* `catalogue.suggested` is advisory data nobody reads yet; the Paddock Board does not show it and the LIGHT/weather dials do not default from it.
* Pre-existing, seen once (Haut-Givre grid frame), untouched: the grandstand roof text "AUREL" on a non-Aurel venue.

## Recommended next tasks (ranked)

1. **UX:** read `catalogue.suggested` into the venue sheet and pre-select weather/light when a venue is picked (the data and a unit test exist).
2. **Capture the five unseen events and the Medium-quality night market on a quiet machine** (or a GPU host): the capture tool takes `--plan` entries and `--quality`; the
   45 s GPU fence is worth raising or making recoverable (a failed fence leaves `loading` forever with no message).
3. **Load Bright Basin and the `grand-prix-bikes-on-the-runway` event in a browser** to confirm the A35 fix (only the Node placements were checked).
4. **Market and snow props in the kit** (stall rows, awnings, strung lights; a visible dam face from the crest): the venues are data, the props would be a kit task.
5. **Find out why karts run 13 m wide on the airport** (probably the blast-pad turn; not isolated): fixing it would unlock karts on the runway, and snow handling would unlock them on the ski road.
6. **Snow handling for hatchbacks, karts and bikes**: all three failed on the ski road; the AI's pace floor and wheelspin lift were tuned for cars on the pass.

## Files

New: `scripts/studio/content2-capture.mjs`, `tests/wildcard-venues-2.test.ts`, `docs/studio/reports/content2-screens/` (20 JPEGs), this report.
Edited: `src/simulation/circuit-catalogue/{wildcard-venues,venue-data,builder}.ts`, `src/rendering/venue-kit/theme.ts`, `src/rendering/assets/sky-catalogue.ts`,
`src/rendering/tyre-trolleys-racks.ts`, `src/career/wildcard-series.ts`, `tests/{venue-kit-suite.ts,venue-kit-wave2.test.ts,wildcard-board.test.ts}`,
`e2e/60-launch-board.spec.ts`, `docs/{CIRCUIT_CATALOGUE.md,circuit-catalogue-races.json,wildcard-races.json}`.
