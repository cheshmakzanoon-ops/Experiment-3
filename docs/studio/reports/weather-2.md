# Environment Art: Weather and Time of Day, wave 2

Branch `studio/env-weather-2` (cut from `main` at `aecec04`, physics version 19, unchanged). Port 4222 for previews.
Starting point: `docs/studio/reports/weather.md` (six presets, "Not built", "Ranked next tasks").

## Scope and result

| # | Task | Result |
| --- | --- | --- |
| 1 | Snow / ice (`snow`) | Built end to end and verified headlessly: frozen-cover cell state with an enthalpy balance, grip branch with numbers, flakes, white road and scenery, cool light, muffled bus, crunch band, HUD words, glyph, tyre and AI response. 7th preset. 42 unit tests. |
| 2 | Dawn, fog cover, wisps, cones | Separate fog-cover channel built (fog = clear sky over a bank), warm golden-hour dawn grade, ground mist wisps, floodlight shafts at night in fog / dust / snow. Dawn frame captured. **Not built:** car headlamp cones (see below). Lightning: see the screens section. |
| 3 | Visibility rule in race control | Built and tested: virtual safety car / safety car / suspension ladder from view and standing water, with hysteresis, hooked into `SafetyCarDirector` through `RaceDirector`. No shipped preset crosses a line (by design, explained below). |
| 4 | Wildcard pairings | Two events added, each passing `scripts/wildcard-races.ts`: **Desert trucks on the iced col** (snow, alpine pass) and **Haboob in the red canyon** (dust, desert canyon). Series 19 to 21 events. |
| 5 | Captures | See "Screens". 1024x576 JPEG, each at most 150 KB, in `docs/studio/reports/weather-screens-2/`. |

Existing presets stay bit-identical: SHA-256 of the full presented snapshot **and** of the four road state grids at 50 / 100 / 150 s
(`scripts/weather-hash.ts`, 3 cars, seed 4417) match the baseline commit for `clear`, `changeable`, `rain`, `storm`, `dust` and a GP-bike rain/clear
field. `fog` changes by design (its cloud slot now carries the clear sky, 0.12, see item 2); its road temperature matches the baseline to 1e-4 C.
`SIMULATION_VERSION` is therefore not bumped.

## 1. Snow and ice: pipeline map (config to ear and eye)

1. **One precipitation channel, the air decides.** No header slot (HEADER stays 24, protocol 15). `weather.ts PRECIPITATION`: rain at and above 2 C
   (`snowShare` is *exactly* 0 there, so every older preset is untouched), snow at and below 0 C, a smooth sleet blend between. `liquidRain`,
   `snowfallMmHr`, `frameLiquidRain(frame)` are the readers. The `snow` keyframes (`weatherKeyframes`): -3.5 to -4 C, 2.4 to 3.4 mm/h water equivalent
   (heavy snow, ~3 cm/h), 420 to 950 m of view in the squall easing to 16 km by 25 min, 3 to 4 m/s wind.
2. **Cell state.** `Track.frozen` (Float32, mm water equivalent per surface cell, `CELL_ROWS x CELL_COLS`). `Track.cold` is true only when some keyframe is
   below 2 C or the road starts covered; warm presets never enter the phase code. `weatherSurfaceStart('snow')`: road -4.5 C, 1.7 mm of cover
   (1 mm w.e. is about 1 cm of snow), **worn to 0.55 mm along the rubbered racing line** (the wheel tracks), deep beside it.
3. **Phase change is an enthalpy balance** (`settlePhase`, tested): a surface above 0 C with cover melts `C_s T / L` (surface capacity 21 kJ/m2/K,
   latent heat 334 kJ/kg), conserving `C dT = L dm`, and is pinned at 0 C while any cover remains; below 0 C liquid water freezes and the
   latent heat warms the node toward (never past) 0 C. A thaw is slow (2 K melts 0.126 mm of 5), a frost glazes only what the cold road can freeze. Snowfall
   lands first (rate x catchment variation x step). Drainage and evaporation act on the liquid part only.
4. **Grip** (`frozenSurfaceGrip`, `frozenGripFactor`, `peakGrip` branch). Fully covered friction is the existing `MATERIALS` SNOW (0.30 of dry) blended
   toward ICE (0.12) by the *glaze*, which is traffic polish read from the laid-rubber channel (`glazeShare`), half-way at most (`FROST.glazeIce`:
   packed snow is not glare ice), both cold-stiffened by the existing `meltSensitive` rule (-21 % at -4 C, -45 % at 0.5 C), plus a winter-construction
   recovery. The cell's *cover fraction* (`frozenCover`: trace is patchy frost, 0.8 mm is white) blends that with the bare road. Cover also hides the
   rubber and wet-material terms and adds 0.012 plough drag (`Track.sample` resistance). With no cover `peakGrip` multiplies exactly the same terms in the same order (asserted bit-for-bit).
5. **Tyre response.** `tire-families.ts` gains `winterGrip` (share of the snow/ice loss a construction wins back; slicks 0, road 0.06, semi-slick 0.03,
   supermoto 0.03, knobby 0.15, all-terrain 0.18, **gravel rally 0.2** = a studded winter tyre). `tire.ts WINTER_COMPOUND`: soft/medium/hard 0, intermediate 0.05,
   **full wet 0.10** (the deep-grooved compound is this model's winter tyre; `suggestedTyre: 'wet'` in the catalogue). The two stack as
   `1 - (1 - c)(1 - f)`. No new family was added: nothing in the catalogue would carry it.
6. **Worker, replay, texture.** `FromWorker 'surface'` gains optional `frozen` (sent only when `track.cold`, so warm sessions send the same message as before).
   `SessionReplay` records a fourth 16-bit word per cell (`SURFACE_WORDS = 4`, full scale 8 mm) and decodes `surfaceState.frozen`. `CircuitScene.updateSurface`
   writes it to the **alpha of the road-state texture** (previously constant 255, read by nothing) and keeps `meanFrozen`. I did not add a temperature channel:
   the road shader only needs the cover (and the laid-rubber glaze it already has); temperature is derivable and stays in the physics.
7. **Wheels report what they roll on.** `W.SURFACE` carries SNOW (9) or ICE (10) when the cell is at least half covered (`reportedSurface`), so the existing audio
   `snow` layer is the crunch band and the contact bookkeeping (marbles, loose-ground spray colour) behaves. The physics contact keeps its own material.
8. **Render.** `wetRoad.frag` whitens by cover and darkens/glosses where glazed (clearcoat for glaze, matte for fresh snow); `weather-presentation.ts` whitens the
   upward faces of tagged scenery by role (`SNOW_CATCH`: grass/gravel 1, roofs/concrete 0.8 to 0.9, foliage 0.55, paint 0.15, rubber/leather 0) from the mean cover
   of the last recorded keyframe (so a replay shows the session's cover); liquid rain (`frameLiquidRain`) feeds the wet look, lens drops, spray, tread, light
   state, so snow wets nothing. `effects.ts` births flakes in the existing bounded rain pool (55 per mm/h per second, 4 to 6 s, wind-drifted), `rain-streaks.ts`
   has a `flake` uniform (round, broader, brighter). `weather-atmosphere.ts`: soft cool light (`WEATHER_LOOK.snow`), white-ground bounce, cool haze.
9. **Audio.** `weather-ambience.ts`: the master low-pass closes to 55 % of its corner and the level drops 10 % while it snows (muffled ambience); rain hiss follows
   liquid rain only; crunch is the wheel `snow` layer (7).
10. **UI.** `WEATHER_CATALOGUE.snow` (option "Snow and ice", tag SNOW, suggested tyre wet), `snow` glyph in `glyphs.ts` and `WEATHER_GLYPH` (the Paddock Board
    dial and the Wildcard sky row read them), loading tip, HUD: `-4C / VIS 450 M · SNOW 3.3 MM/H · SNOW AND ICE ON TRACK`.
11. **AI.** `DriverBrain.pace` x `frozenPace` (floor 0.7 on a fully covered cell); on a covered cell the driven-axle easing starts at 70 % use (not 90 %) with a
    floor that falls with grip, the throttle lifts fully if a driven wheel spins at twice road speed, strategy treats a covered road as wet-tyre weather (slicks
    pit for wets, wets stay out, the player's default pit call is wets), and marshals recover a car crawling below 6 m/s with no progress for 30 s on a frozen
    road. All of that is gated on the cell being covered, so the other presets are unchanged (hash script).
12. **Festival (open world).** `OpenWorldTrack` carries one reference-column cover (`#frozen`, `meanFrozen`, same enthalpy balance, grip and snapshot reporting);
    biome ground that is already snow or water keeps its own material. **Not screenshot-checked** (SwiftShader cannot finish an open-world frame, see
    `scripts/studio/tools/README.md`), and the festival renderer does not whiten scenery yet.

### Physics numbers (all produced by the shipped code)

Grip is `peakGrip` of a Formula tyre at 2.5 kN, 40 m/s, road at -4.5 C, against a dry warm medium slick (1.813). Tyre temperature is set to what each compound
runs at (medium 85 C, wet 45 C): in a session the tyres run colder (30 to 55 C, see the matrix) and lose another 10 to 20 %.

| surface | medium slick | full wet compound | wet + rally family (0.2) | wet + all-terrain (0.18) |
| --- | ---: | ---: | ---: | ---: |
| deep snow beside the line, 1.7 mm w.e. | 0.44 (24 % of dry) | 0.43 (24 %) | 0.62 (34 %) | 0.60 (33 %) |
| worn wheel tracks, 0.45 mm, polished | 0.93 (51 %) | 0.77 (42 %) | 0.89 (49 %) | 0.87 (48 %) |
| thin frost film 0.2 mm | 1.59 (87 %) | 1.21 (67 %) | 1.24 | 1.24 |

Surface friction factor (relative to dry asphalt), fully covered, by air temperature (`frozenSurfaceGrip`): fresh snow 0.294 / 0.256 / 0.173 / 0.162 at -10 / -5 / -1 / +0.5 C;
polished glaze 0.210 / 0.183 / 0.123 / 0.116; the 0.55 mm wheel track 0.39 / 0.37 / 0.33 / 0.32 (0.45 / 0.44 / 0.39 / 0.39 with the wet compound). Colder is grippier,
and the meltwater collapse near 0 C is the existing material rule. Real figures to hold it against: packed snow 0.2 to 0.3, glare ice 0.05 to 0.15, a
studded winter tyre on ice 0.25 to 0.35. The **worn tracks are the faster line** (about two-fifths of dry against a quarter in the deep snow): "stay in the tracks"
is what the brief and the loading tip say, and the AI does.

`scripts/weather-matrix.ts` (production `Simulation`, AI, Aurel, 120 Hz, seed 4417; `docs/studio/reports/weather-matrix.json` now has all seven presets):

| weather | tyre | mean lap | vs dry medium | min view | front-left grip | tyre T |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| clear | medium | 49.87 s | 0 % | 30 km | 0.98 | 93 C |
| fog | medium | 57.92 s | +16.1 % | 110 m | 0.84 | 73 C |
| storm | wet | 70.99 s | +42.3 % | 483 m | 0.64 | 25 C |
| dust | medium | 56.32 s | +12.9 % | 170 m | 0.88 | 94 C |
| **snow** | medium | **189.90 s** | **+281 %** | 411 m | 0.19 | 32 C |
| **snow** | intermediate | 191.31 s | +284 % | | 0.16 | 35 C |
| **snow** | wet | **181.58 s** | **+264 %** | | 0.18 | 30 C |

Every older row is identical to the wave-1 report. A formula car on a snow road is about 3.7 times slower than dry (a lap of 3 km at 16 m/s); that is the
physics of a 0.2 to 0.45 g road, not a tuning accident. The compound matters little for this car (wet 4 % faster than the slick: the wet compound's lower base mu eats most of the
sipe recovery); the construction matters a lot, which is what the rally and truck pairings use. 8-car, 3-lap Aurel race on wets: **8/8 finish, 0 retirements, max impact 0.00**, 554 s
(clear 172 s, rain 230 s). A 6-car race on slicks also finishes 6/6 with no contact (624 s); the menu pre-selects wets for snow. Before the fixes listed in "How it got there",
the same field finished 0 to 4 of 6 and jammed behind the safety car.

Rally and trucks on the pass (7.3 km ascent, 5 desert trucks `dx8`, all-terrain family): **dry race 287 s (one lap, standing start), snow on the wet compound best lap 729 s**
(about 2.5 times, 36 km/h), impact 0, `scripts/wildcard-races.ts` PASS. One rally car (`rl2`, gravel family) alone on the descent: dry lap 242 s, snow lap 542 s (2.2 times).

### How it got there (so the numbers can be trusted)

* The first grip model blended the cover twice (`peakGrip` lerped toward a value that already contained the cover fraction), which made partly covered cells far too
  grippy; found while reading the wheel-track grip against the table, fixed with `frozenSurfaceGrip`, and the field and wildcard races re-run.
* The first AI field jammed: at 0.4 abs the driven axle sits at its limit before any lateral demand, rear wheels spun at 3 to 5 times road speed with the throttle
  at its floor, cars crawled for minutes. Fixes in item 11. The wheelspin lift is gated on a covered cell **and** low grip: gating on grip alone also changed `rain` and
  `storm` for slick-shod AI (caught by the hash script, not by any unit test).
* Three older test fixtures wrote RAIN into a header whose ambient temperature was 0 (`tests/weather-states.test.ts` x2, `tests/wet-presentation.test.ts`,
  `scripts/weather-oracles.ts`): under the new phase rule that is a snowfall. They now carry a 18 to 20 C header; the assertions are unchanged.

## 2. Fog cover, dawn, mist wisps, floodlight shafts

* **Separate fog-cover channel.** `WeatherKeyframe.fogCover01` (optional, 0 = none): the shade a ground fog puts on the *pavement*. `cloudCover01` is the sky. The surface heat and
  humidity balance read `groundCloud(cloud, fogCover) = 1 - (1-c)(1-f)` (`Track.evolve`, `OpenWorldTrack.evolve`); the snapshot's `H.CLOUD`, and so the sky,
  the sun and the grade, carry the sky alone. `fog` is now a clear sky (0.12) over a bank whose `fogCover01` reproduces the old cover (0.82, 0.82, 0.70, 0.50,
  0.30, 0.20 to three digits): mean road temperature 8.1465 / 8.4532 / 9.4110 / 10.8128 C at 100 / 300 / 600 / 900 s against 8.1466 / 8.4533 / 9.4110 / 10.8128 C on the baseline commit.
  This is also the physically right radiation fog (clear above, shaded below).
* **Dawn grade.** `adjustDaylight(..., golden)` and `tintLights(..., golden)`: under the circuit's sunset lighting a fog bank keeps most of the low sun
  (`WEATHER_LOOK.fog.golden.sun` 0.92 against the 0.45 midday smother), the haze takes a warm peach chroma at its own brightness, the key and sky light are warmed. Clear air, night and the
  other lighting modes return the daylight record untouched (asserted).
* **Mist wisps** (`rendering/mist.ts`, `effects.ts`): 5 births/s in a full bank (extinction >= 8 per km), big (3 to 5 m), faint (alpha 0.1), 6 to 9 s, drifting with the wind
  in the soft-cloud pool, none in clear air, dust or snow, bounded (4 births per call), unit-tested at three render rates.
* **Floodlight shafts** (`rendering/fog-light-shafts.ts`, `venue-lighting.ts`): one instanced open cone per floodlight mast, aimed at the circuit, additive, depth-tested, no depth write,
  density from extinction only (0 in clear air or by day, ceiling 0.34), white / amber (dust) / cool (snow). **Not built:** car headlamp cones (the circuit cars carry no headlamp light sources,
  festival cars do; that is a festival-renderer task) and a volumetric (raymarched) version.
* Race control, **time-of-day select in the session form** (ranked task 1 of wave 1): still not done; the catalogue does not yet carry a suggested lighting. Unchanged.

## 3. Visibility rule in race control

`weather.ts VISIBILITY_RULES / raceHazard / safePaceMS`, `safety-car.ts`, `race.ts`. `safePaceMS(V) = a (sqrt(t^2 + 2V/a) - t)` with t = 1 s, a = 8 m/s2: 100 m of view is
32.8 m/s (the virtual-safety-car pace), 60 m is 24 m/s, 35 m is 17 m/s. Levels from the worse of view (effective, rain included) and mean standing water: **1 reduced pace** (VSC, capped at the
lower of 32 m/s and the safe pace) below 100 m or 3.5 mm; **2 safety car** (deployed at the safe pace) below 60 m or 5 mm; **3 suspended** (the safety car stops, the field queues behind it, marshals
do not recover held cars) below 35 m or 7 mm. A level is released only 25 % clear of its line. The ladder hands back down (suspended, safety car "in this lap", virtual, green). The race
message says why (`VIRTUAL SAFETY CAR · LOW VISIBILITY 80 M · 103 KM/H`, `RACE SUSPENDED · STANDING WATER 7.4 MM · HOLD YOUR POSITION`). With hazard 0 (the default argument) nothing runs.

Test (`tests/race-control-visibility.test.ts`, 6 tests): the thresholds and the stopping-distance identity, hysteresis, and a 4-car race in a synthetic bank that thickens
(80, 50, 25 m) and lifts: VSC at 26 s (speeds below 33 m/s), safety car at 56 s (safety-car speed at most the safe pace), suspension at 100 s (every car under 4 m/s, none retired), back to green by 200 s.
**No shipped preset crosses a line**: Dawn fog opens at 110 m (10 m outside), dust at 170 m, the thunderstorm at 483 m and 2.5 mm: a fog race at the matrix finishes unchanged. I chose the lines from
the stopping-distance physics rather than from the presets, so that Dawn fog stays a race and not a safety-car parade; the rule fires for a denser authored bank or a deluge. I did not invent
a lightning suspension (it would suspend every storm race).

## 4. Wildcard pairings

`src/career/wildcard-series.ts`, data only, both validated before they were kept (`node --experimental-transform-types scripts/wildcard-races.ts <ids>`, evidence merged into
`docs/wildcard-races.json`, `tests/wildcard-series.test.ts` green):

| id | pairing | result |
| --- | --- | --- |
| `desert-trucks-on-the-iced-col` | 5 trophy trucks `dx8`, `alpine-pass` ascent, snow, 1 lap, ruleset `rallycross-heat` | PASS, best lap 729 s (36 km/h), impact 0 |
| `haboob-in-the-canyon` | 5 trophy trucks `dx8`, `desert-canyon`, dust storm, 2 laps | PASS, best lap 197 s (102 km/h), impact 0.99 |

The series is now 21 events (14 cross-discipline): `tests/wildcard-board.test.ts` counts and `e2e/60-launch-board.spec.ts` (title, door label, "0 OF 21 MEDALLED", 21 rows,
"1 OF 21 MEDALLED") were updated; the e2e was **not run** here.

## 5. Screens

`docs/studio/reports/weather-screens-2/` (1024x576 JPEG, 36 to 61 KB each, SwiftShader, Medium quality, practice session on the Formula car with the autopilot, 3 rivals), captured
with `scripts/studio/weather-capture-2.mjs` from a production build on port 4222 (it adds a venue per shot and a replay-parked lightning mode to wave 1's tool). A session took 9 to 19 minutes
to reach its first frame on this box (load average 4 to 8, other agents capturing at the same time), so the set is small. The first pass of each frame is kept where the retake changed the verdict.

| File | Venue, state | What it shows |
| --- | --- | --- |
| `snow-day-alpine-pass.jpg` | Col d'Argent pass, snow, day | -4 C, `VIS 450 M · SNOW 3.3 MM/H · SNOW AND ICE ON TRACK`; white scenery, white road with the dark worn tracks along the line, cool grey light, flakes |
| `snow-night-alpine-pass.jpg` | same, night | Floodlit pass in snowfall: lit snow on the verges, glazed gloss on the road under the lamps, the lamp shafts visible in the falling snow |
| `fog-dawn-pass1-too-orange-hochwald.jpg` | Hochwald forest ring, fog, golden hour, first pass | Warm, but a saturated orange: it read as a sandstorm, not a dawn. Kept as the record of the retune |
| `fog-dawn-hochwald.jpg` | same, after the softer peach chroma | Pale cream-peach haze, the bank glows instead of greying, the grandstand and gantry dissolve into it at 110 m. Reads as a warm dawn mist |
| `fog-night-hochwald-shafts.jpg` | same venue, fog, night | Floodlight shafts in 120 m of fog, `8C / FOG 120 M · DAMP TRACK` |
| `dust-day-desert-canyon.jpg` | Red canyon circuit, dust storm, day | Amber haze, sand-coloured road, tan-tinted trackside, 200 km/h, `DUST` bank (a retake of wave 1's dust at a venue that suits it) |
| `storm-rising-riviera-replay-start.jpg` | Riviera harbour streets, storm, day | Replay start (rain 18 mm/h, wind 11 m/s): not yet at the storm's peak; kept as an honest record of a mis-aimed replay seek, not as a flash |
| `storm-peak-riviera-tunnel-replay-on-strike.jpg` | same, the replay parked 20 ms after the strongest strike of the session (t = 76.13 s, expected flash 0.68) | HUD `RAIN 70.4 MM/H`, 9 m/s wind. **The car was inside the harbour tunnel at that second: no sky, lamps on, so the strike is not visible. It proves the park, not the flash.** |
STORM_AUREL_ROW

What works:

* **Snow** is the strongest result: the cover is white and the dark wheel tracks along the racing line read as a polished path, exactly where the grip model puts the faster line; the HUD says what the road is;
  at night the glaze catches the floodlights and the shafts show the falling snow.
* **Dawn** after the retune. The same fog scene at the same light is no longer the gloomy dusk of wave 1.
* **Shafts** are visible and read as lamp beams in fog and snow.

What does not, or is unproven:

* **The shafts are hard-edged geometric wedges**, with a bright crisp rim where the cone's back and front faces overlap (fog night). They need a softer radial falloff (a higher facing exponent) or a depth-aware pass. Not changed after the capture, so the code is as shown.
* **Mist wisps are not visible in any frame.** They are bounded and faint (alpha 0.1) and the bank is dense around the car; the unit tests prove the births, nothing in a frame proves the look.
* **Flakes are small and sparse** in stills (600-particle pool shared with rain; a slow fall at 4 to 6 s); in motion on a GPU they may read better, which I cannot check. The snow stills are mostly won by the white ground and the haze.
* **Kerbs stay red** through the cover (paint and kerb surfaces are not whitened); the tyre-mark geometry is still drawn over the snow-covered road.
* **The fog frames show the car at 0 to 1 km/h with a double-yellow:** the capture script presses G after the page loads, and the player's car had been standing on the grid road for those 9 to 19 minutes of load. A capture artefact, not a weather effect (the same session driven headlessly runs at 70 m/s).
* The HUD weather label at the top (grey, no plate) is still hard to read on bright skies: UX item, unchanged.
* No dust night frame (a run was stopped to retake the lightning), no festival frame (SwiftShader cannot finish one), no GPU frame-rate evidence.


## Verified (commands run in this worktree, results)

Run in this worktree (`/home/user/Experiment-3/.claude/worktrees/wf_599b5e93-53e-2`), on a shared 4-CPU box:

* `npx tsc --noEmit`: pass (no output), re-run after the final source edit.
* `npx eslint` on all 51 changed or added `.ts` / `.mjs` files (sources, tests, scripts, the e2e spec): pass (no output).
* `npx vitest run --maxWorkers=2` over 33 files: `weather-states weather aerial-perspective wet-broadcast-fidelity wet-detail wet-night-traffic-start wet-presentation wet-reflection wet-review-start
  wet-rubber-grip surface-material surface-thermal drs driver-brain audio frontend-menus frontend-retail front-end-board front-end-light-sound wildcard-series wildcard-board wildcard-career-flow
  weather-snow weather-dawn race-control-visibility recording marbles phase27f-atmosphere-audio photoreal-wet weather-reconciliation daylight-environment material-library tyre-model`:
  **33 files, 425 tests pass**. Earlier in the work also green: `race-control marshal safety gp-race-control motocross-race-control drivetrain physics road-contact wheel-thermal longitudinal-contact open-world
  offroad skid-contact light-pools point-light-work phase27g-venue venue-landmark spray-lighting renderer-resource-lifecycle race-surface-atmosphere festival-atmosphere festival-effects-integration
  effects-upload open-world-session motocross-venue-integration venue-kit replay-seek-preparation flashback-recording`.
* `node --experimental-transform-types scripts/weather-selftest.ts`: 14 / 14 oracles pass.
* `node --experimental-transform-types scripts/weather-matrix.ts` (all seven presets, solo stints and 8-car races): finite everywhere, every race classified 8/8 with 0 retirements; table above, JSON in `docs/studio/reports/weather-matrix.json`.
* `node --experimental-transform-types scripts/weather-hash.ts` against a copy of the baseline sources (`aecec04`): `clear changeable rain storm dust` and the GP-bike `rain`/`clear` field **identical** (frame and road-grid hashes at 50 / 100 / 150 s); `fog` differs (cloud slot, by design).
* `node --experimental-transform-types scripts/wildcard-races.ts desert-trucks-on-the-iced-col,haboob-in-the-canyon`: both PASS (re-run after the grip fix).
* `npx vite build` (production bundle, 13 to 17 s) and the captures above.

Not run: the e2e specs, the full vitest suite, `npm run check` (CPU rule), any GPU or festival frame.

## Not built / unverified

* **Festival (open world):** snow and fog-cover state are in the simulation and the snapshot, but no festival frame exists (SwiftShader cannot finish an open-world screenshot) and the festival renderer does not whiten scenery.
* **Car headlamp cones, volumetric (raymarched) light shafts:** not built. The shafts are cones with a facing falloff, not scattering integrals.
* **Lightning flash capture:** see the screens section for what was achieved. The flash itself remains verified as a pure function; the sound and motion were not watched.
* **Snow audio was not listened to.** The muffle and crunch are pure functions of the snapshot with unit tests, the mix was not auditioned.
* **No temperature channel** in the worker surface message (the shader reads cover and glaze; temperature stays in the physics). Say so if a frost sparkle or slush look is wanted.
* **Snow does not melt on the road in the shipped preset** (it stays sub-zero); the thaw is tested on a custom keyframe table, not shipped as a preset.
* **Tyre marks** (permanent rubber geometry) are still drawn over the snow-covered road; kerbs (paint, not tagged scenery) read red through a thin cover.
* GP bikes and dirt bikes take the same grip branch (`copySample`, `looseGrip` family shares) but I ran only the hash comparison for a GP bike field, no snow bike race.
* The e2e specs were not run (CPU rule). Human tuning of snow against real play is open: the AI numbers understate how hard a covered road is for a person.

## Files

New: `src/rendering/{mist,fog-light-shafts}.ts`, `scripts/weather-hash.ts`, `scripts/studio/weather-capture-2.mjs`, `tests/{weather-snow,weather-dawn,race-control-visibility}.test.ts`,
`docs/studio/reports/weather-screens-2/`. Edited: `simulation/{weather,weather-catalogue,track,tire,tire-families,vehicle,bike-vehicle,world,race,safety-car,ai,driver-brain,protocol}.ts`,
`simulation/open-world/{open-world-track,session}.ts`, `rendering/{effects,rain-streaks,renderer,circuit,materials,weather-atmosphere,weather-presentation,venue-lighting,car,supplied-player}.ts`,
`rendering/studio/lens-effects.ts`, `rendering/ultra/pipeline.ts`, `shaders/wetRoad.frag`, `audio/{weather-ambience,engine,surface-audio}.ts`, `storage/replay-pages.ts`, `workers/physics.worker.ts`, `main.ts`,
`ui/{presentation,glyphs,loading-tips}.ts`, `career/wildcard-series.ts`, test fixtures (see above), `e2e/60-launch-board.spec.ts`, `docs/wildcard-races.json`, `docs/studio/reports/weather-matrix.json`.

## Recommended next tasks (ranked)

1. Festival: scenery whitening and cover in the festival renderer, a festival snow frame on a GPU host, headlamp cones (festival cars have headlamps).
2. A time-of-day select in the session form and a catalogue-suggested lighting (fog: golden hour, dust: day), now that the dawn grade exists.
3. A thaw preset (cover melting into slush through the enthalpy balance is tested but unused) and a frost/ice-only morning (the `frozen` channel with no snowfall).
4. Human tuning pass of snow: wheel-track grip, the AI pace floor, whether the formula car on snow should be offered at all, flake density against a real GPU.
5. Replace the cone shafts with a depth-aware volumetric pass if the frame budget allows; tyre marks fading under cover.
6. Bikes in snow (a GP and a supermoto race) and the physics-version note for any future change to the AI throttle shaping.
