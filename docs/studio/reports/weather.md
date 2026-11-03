# Environment Art: Weather and Time of Day

Branch `worktree-agent-a6b1a8c9a07926b77` (cut from `main` at `ebf691d`). Port 4203 for previews.

## Scope

Before: three presets (`clear`, `changeable`, `rain`). After: six (G6 asks for at least six weather
states): **`fog` ("Dawn fog")**, **`storm` ("Thunderstorm")** and **`dust` ("Dust storm")** were added
through the existing keyframe machinery. Each changes how the game looks, sounds and drives.
Snow/ice was **not** built (reasons below). Time of day is reported as already supported, with one gap.

| Preset | What it is | Numbers that matter |
| --- | --- | --- |
| `fog` | Cold radiation fog that burns off | visibility 110 m at the start, 130 m at 3 min, 280 m at 7 min, 900 m at 12 min, 4.2 km at 17 min, 18 km at 25 min (log-linear); 8 C rising to 18 C; 0.3 mm/h fog drip keeps a ~0.03 mm film |
| `storm` | Convective cell | 60 to 76 mm/h (rain preset is 24), mean wind 8.5 to 10.5 m/s plus 7 to 11 m/s gusts (peak ~21 m/s), 900 to 1800 m visibility, lightning above 40 mm/h |
| `dust` | Hot desert haboob | 39 C, 9.5 to 12 m/s plus 6 to 9 m/s gusts, visibility 320 m falling to 170 m, dust-laden air that settles a loose film on the tarmac |

## Pipeline map (config to ear and eye)

1. **Options.** `SessionOptions.weather` (`src/simulation/config.ts`) is now `WeatherId` from the
   new data table `src/simulation/weather-catalogue.ts` (ids, menu text, loading word, event-card
   note, HUD tag, suggested tyre). `validateOptions` accepts any catalogue id, else `clear`.
2. **Timeline.** `weatherKeyframes(preset)` to `WeatherTimeline` (`weather.ts`). Keyframes gained four
   optional channels (`visibilityM`, `dust01`, `gustMS`, `moistureMmHr`). Omitted means the original
   clear-air, gust-free values, so old presets/replays are unchanged. Sampling is a pure function of
   session time (seekable). Visibility interpolates in the log domain. The gust envelope is three
   incommensurate sines thresholded into surges.
3. **Track state.** `Track` (`track.ts`) samples the timeline into `rain/cloud/ambient/wind/visibility/dust/gust/moisture`.
   `evolve()` (0.5 s fixed ticks) now adds fog drip to the per-cell water source, and for dust relaxes
   the per-cell `marbles` coverage toward a target (thinner on the rubbered line). Starting pavement
   per preset comes from `weatherSurfaceStart`. Originals keep their numbers exactly.
4. **Grip.** Unchanged machinery, new inputs: `Track.sample` gives `water/temp/rubber/marbles`;
   `tire.ts peakGrip` multiplies compound mu, temperature window, water penalty, aquaplaning,
   `rubberGrip`, marbles (-14 % at 1.0) and tread dirt (`contamination.ts`). Fog works through the
   water film and cold tyres, dust through marbles plus tread dirt, storm through film depth.
5. **Aero/handling.** `vehicle.ts` already used wind for drag/yaw. New: lateral crosswind force
   (`CROSSWIND` in `weather.ts`), zero below 4.5 m/s and full from 7 m/s, so the three original
   presets (wind <= 4.2 m/s) are bit-identical. Bikes (`bike-vehicle.ts applyCrosswind`) had no wind
   model at all; the side acceleration now feeds the contact-slide state and a heading kick.
6. **Snapshot.** `world.ts writeFrame` and `open-world/session.ts` write two header slots that were
   reserved zeros: `H.EXTINCTION` (22) = particulate extinction per km beyond clear air and `H.DUST` (23)
   = dust share. `HEADER` stays 24, protocol version stays 15, old recordings read as clear air.
   `frame-state.ts` blends both between snapshots.
7. **Render.** `renderer.ts` (and `festival-renderer.ts`) call `weather-atmosphere.ts`:
   `adjustDaylight` (sun/fill/exposure/fog colour), `tintLights`, `bindWeatherAtmosphere`, which feeds the
   existing Beer-Lambert aerial perspective (`studio/aerial-perspective.ts`, now with a fog/dust spectrum,
   a per-weather scale height) and a horizon veil + lightning flash in the sky dome shader (`daylight.ts`).
   `wetRoad.frag` reads a 0.004 to 0.05 mm film as damp and the settled dust film as sand (shared
   `roadDustUniform`). Rain streaks/spray/lens drops are the existing ones, driven by `H.RAIN` and wind.
8. **Audio.** `audio/weather-ambience.ts` (pure) feeds `audio/engine.ts`: gale howl at standstill,
   sand grit band, deterministic thunder (distance delay), and a fog low-pass on the master bus.
9. **UI.** Menu `#weather` options come from `weatherOptionsHtml()` (one line in the template; ids and
   `change` behaviour kept, suggested tyre is data). HUD `#weatherLabel` and race briefing show
   `FOG 110 M` / `DUST 170 M` and `WIND 12 M/S` (`ui/presentation.ts airReadout`). Loading line,
   event cards and career calendar use the catalogue.
10. **AI.** Unchanged envelope already derives grip from `peakGrip`, so water, cold and dust flow in
    automatically. New: `DriverBrain.pace` is scaled by `visibilityPace` (1.0 from 600 m to 0.8 at <= 60 m).
    Tyre decisions still follow track water.
11. **Race control.** DRS is locked out below 250 m visibility (`DrsContext.visibility`). The safety car
    director only reacts to marshal obstructions and was not changed.

## Physics numbers and evidence

All from `scripts/weather-matrix.ts` (production `Simulation`, AI driver, Aurel, 120 Hz, seed 4417):
`docs/studio/reports/weather-matrix.json`. Solo practice stint (3 timed laps after the out lap) and an
8-car 3-lap race per preset on its suggested tyre. The Vitest assertions in `tests/weather-states.test.ts`
pin the model numbers below.

| weather | tyre | mean lap | vs dry medium | min view | mean water | front-left grip | tyre T |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| clear | medium | 49.87 s | 0 % | 30 km | 0 mm | 0.98 | 93 C |
| rain (24 mm/h) | wet | 68.05 s | +36.4 % | 2.4 km | 1.09 | 0.71 | 35 C |
| rain | medium | 78.56 s | +57.5 % | | | 0.71 | |
| **fog** | medium | 62.14 s | **+24.6 %** | 110 m | 0.029 | 0.84 | 68 C |
| fog | intermediate | 70.58 s | +41.5 % | | | 0.84 | |
| **storm** (60 to 76 mm/h) | wet | 71.33 s | **+43.0 %** | 483 m | 2.11 | 0.64 | 25 C |
| storm | intermediate | 75.47 s | +51.3 % | | 2.15 | 0.45 | |
| storm | medium | 82.81 s | +66.0 % | | 2.45 | 0.63 | |
| **dust** | medium | 59.74 s | **+19.8 %** | 170 m | 0 | 0.90 | 89 C |
| dust | intermediate / wet | 68.9 s | +38 % | | | 0.90 | |

Races (8 cars, 3 laps, suggested tyre): every car finishes, 0 retirements, max impact <= 0.01, all state
finite in every preset: clear 172 s, changeable 237 s (3 pit stops), rain 230 s, fog 203 s, storm 237 s,
dust 198 s. A GP-motorcycle field (4 bikes, 2 laps, Aurel) finishes the storm 179 s vs 136 s dry (4/4,
0 retirements), `weather-matrix.ts --vehicle gpr1`.

How the deltas decompose (so they can be tuned honestly):

* **Fog +24.6 %.** About two thirds is the AI's sight limit (`visibilityPace(110 m)` = 0.80), the rest is
  grip: a 0.03 mm film costs a slick ~16 % (front-left 0.98 to 0.84; `wetPenalty` 0.63 x 0.03/(0.03+0.1)
  plus cold tyres 68 C vs a 92 C window, -9 %). A human driver is only limited by the grip and what he can see.
  Intermediates are *slower* than slicks here (+41 %): the film is too thin for them, which is why the
  menu suggests Medium for fog.
* **Storm +43 % on wets.** 2.1 mm mean standing water and 25 C tyres. Slicks lose +66 %, intermediates
  show front-left grip 0.45 (aquaplaning). Deeper water barely hurts wets in this tyre model
  (waterTolerance 3.2 mm), so the storm is only ~7 points slower than 24 mm/h rain for the AI; the
  difference a human feels is the gusts, the dark, the lightning and the aquaplaning margin. Not tuned
  further because the tyre model owns that.
* **Dust +19.8 %.** Grip 0.90 (-8 % on the line, from marbles + tread dirt), the rest is the sight limit
  at 170 m. Soft is fastest on the hot road (57.0 s vs medium 58.1 s vs hard 59.4 s, 2-lap check) since
  the tyres stay in their window at 39 C; Medium is the suggested default for wear.
* **Crosswind.** `crosswindForce`: 1/2 rho |V| (0.55 x 4 hy hz) w. Formula car, 70 m/s, 12 m/s across:
  ~1.1 kN, 0.14 g. A real car integrated 0.7 s at 60 m/s in a 14 m/s gust gains > 0.2 m/s toward the wind
  (tyres resist most of it), exactly 0 difference in a 4.2 m/s breeze.
* **Dust film.** Target coverage 0.09 at 170 m (`DUST_FILM`), x0.4 on the rubber line. 6 s at 60 m/s on the
  settled film costs the same tyre 3 to 20 % grip (asserted).

Determinism: frame hashes (SHA-256 of the full snapshot at 50/100/150 s, 3 cars, seed 4417) of the *baseline
commit* and this branch are **identical** for clear, changeable, rain and a rain bike field. The new
presets replay bit for bit twice in `tests/weather-states.test.ts`.

## Rendering (what the shader does, not placeholder slabs)

* Fog and dust reuse the sky's Beer-Lambert aerial perspective on every lit material: exact
  `exp(-sigma d)` per colour channel (droplets flat, dust blue-heavy 0.84/1/1.34), height falloff 240 m
  for a fog bank, 650 m for the dust column, so towers and the sky above stay readable. 110 m of fog is
  sigma = 35.5/km, 97 % haze at the visibility (asserted).
* The dome gets a horizon veil in the haze colour (fog), amber (dust) or dark steel (storm deck) so it
  does not cut out against the near fog. Lightning adds a flash to sky, fill, environment and sun light.
* Dust warms the sun/sky light, smothers the sun (x0.14), brightens scattered light; fog x0.45 sun,
  x1.35 sky light; storm darkens (x0.55 sun, x0.86 exposure).
* Road: fine films read as damp (new), dust reads as sand on the asphalt, thin on the line (new).

SCREENSHOTS_PLACEHOLDER

## Time of day

Already supported (no code needed): `LightingMode` = `day | sunset | night` (`rendering/sky-light.ts`),
selected through GARAGE & SETTINGS, Driving Academy "circuit lighting" buttons (`lighting:day|sunset|night`,
`main.ts`), plus **LIVE** (real sun/moon/stars at the player's location and clock, `live-sky.ts`).
Catalogue meaning of the circuit flags (`docs/CIRCUIT_CATALOGUE.md`): `night` venues (Ramla x2, Lantern Bay,
Gantry Point x2, Neon City x2) open floodlit; `dayNight` venues (Hochwald, Loirette, Loirette Club) open in
daylight and carry floodlights for the whole lap so the player can run into the night. The new weather works
under all three modes (fog under `sunset` is the dawn look: a low warm sun through a milky bank). **Gap:**
there is no time-of-day control in the session form; there is no separate dawn (it is the sunset sky).
Recommended next task for the UX Director: a TIME select in the form (day, golden hour, night, live) wired to
`renderer.lighting` at session start; the weather catalogue could carry a suggested lighting
(fog: sunset, dust: day). Not done here because the brief said not to restructure the menu markup.

## Why no snow or ice

The circuit surface model emits only circuit ids (`SURFACE` 0 to 5) from `Track.sample`. Snow and ice exist as
materials (`surface-material.ts` ids 9, 10, `meltSensitive`) but only for terrain/festival ground, where
loose sinkage is deep (Bekker, 6 cm on snow). Making a credible frozen road needs: a per-cell frozen-water
state (the thermal solver has the temperature but drainage and aquaplaning would have to switch off below
0 C), a `peakGrip` branch for glaze ice (mu ~ 0.1 to 0.3 at -1 to 0 C, packed snow 0.25), the cold-tyre window
(the tyre solver already follows ambient), a new worker-to-main surface channel (temperature) so the road
shader can show ice, snow particles (rain pool with slow fall) and scenery whitening. That is a feature on
its own (days), and a half version (a white tint over normal grip) would mislead. Ranked as the next task.

## Verified

Commands run on this branch (all in the worktree):

* `npx tsc --noEmit`: pass (no output), run after the final source edits of the physics/render/UI work.
* `npx eslint` on every changed/added `.ts`/`.mjs` file: pass.
* `npx vitest run tests/weather-states.test.ts`: **39 tests pass** (new: catalogue, original presets unchanged,
  visibility maths, gusts, crosswind, dust film, fog film, storm lightning, DRS/AI hooks, atmosphere state,
  ambience, HUD words, road shader inputs, determinism).
* Existing suites, all pass: `weather`, `aerial-perspective`, `drs`, `driver-brain`, `audio`,
  `phase27f-atmosphere-audio`, `daylight-environment`, `wet-presentation`, `weather-reconciliation`, `core`,
  `frontend-retail`, `surface-thermal`, `surface-material`, `meeting-flow`, `events`, `career`,
  `career-session`, `championship`, `catalogue-menu-events`, `endurance-mode`, `camera-dynamics`,
  `effects-upload`, `festival-effects-integration`, `airborne-audio`, `photoreal-wet`, `wet-detail`,
  `wet-broadcast-fidelity`, `material-library`, `offroad-meeting`.
* `node --experimental-transform-types scripts/weather-selftest.ts`: 14/14 oracles pass.
* `scripts/weather-matrix.ts`: table above; finite everywhere; all races classified.
* **Pre-existing failure (not caused by this work):** `tests/bike-session.test.ts` "WP35 seeded AI bike race ...
  GP faster than superbike": 83.281 vs 83.123 s. The *baseline commit* fails with the identical numbers.

## Not verified / known gaps

* Lightning flash and thunder are verified as pure functions (timing, range, determinism) but were not
  listened to or watched in motion.
* The open-world (festival) renderer and sim take the new presets (header slots, atmosphere binding, wet
  start) but only the circuit renderer was screenshot-checked.
* No e2e (Playwright) specs were run; DOM contracts (`#weather` and its option values, `#weatherLabel`,
  `#compound`) were kept and grepped against `e2e/`.
* Menu text for the three new options is English only like the rest of the form.
* Fog is aerial extinction only: no drifting mist wisps near the ground and no fog-lit headlamp/brake-light
  glow; a night fog would also want volumetric floodlight cones.
* Safety-car/red-flag for near-zero visibility is not implemented (the director reacts only to obstructions).
* The sunset+fog "dawn" look and the night variants were not captured (capture was slow, see below).
* `public/models/supplied-player-lods.bin.gz` is a gitignored generated asset that a fresh worktree lacks;
  the app fails to boot ("Player LOD integrity check failed") until it is copied from the main checkout.

## Files

New: `src/simulation/weather-catalogue.ts`, `src/rendering/weather-atmosphere.ts`,
`src/audio/weather-ambience.ts`, `tests/weather-states.test.ts`, `scripts/weather-matrix.ts`,
`scripts/studio/weather-capture.mjs`, `docs/studio/reports/weather-matrix.json`.
Edited: `simulation/{weather,track,config,protocol,world,vehicle,bike-vehicle,driver-brain,drs,race}.ts`,
`simulation/open-world/{open-world-track,session}.ts`, `rendering/{renderer,daylight,frame-state,materials,
weather-presentation}.ts`, `rendering/studio/aerial-perspective.ts`, `rendering/open-world/festival-renderer.ts`,
`shaders/wetRoad.frag`, `audio/engine.ts`, `ui/{interface,presentation,race-briefing,event-cards,career-hub}.ts`.

## Recommended next tasks (ranked)

1. Time-of-day select in the session form (see above) plus catalogue-suggested lighting.
2. Snow/ice: frozen-film cell state, glaze-ice grip branch, temperature in the surface message, flakes, white
   road/scenery response. Needs an owner for the worker message schema.
3. Weather-aware event content: a "Wildcard" series pairing vehicles with new weather (desert venues with dust,
   Dawn fog on the long rings), and career/championship calendars that use the new ids.
4. Ground mist layer and light cones in fog/dust (volumetrics for floodlights and headlamps), spray and
   dust kick-up tuned for the new surface states.
5. Race control: a visibility safety-car/red-flag rule and a weather message in the timing tower.
6. Human-tuning pass of the storm against real play (the AI numbers understate the human difficulty).
