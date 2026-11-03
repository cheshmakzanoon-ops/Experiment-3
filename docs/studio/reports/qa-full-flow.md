# QA full-flow report: Circuit and Festival journeys in a real browser

Branch `studio/qa-full-flow-journeys`, department Gameplay QA (Circuit and Festival). Nobody had
driven the merged game through a complete player journey in a browser before this run. This
report says what was driven, what was measured, what was broken, what was fixed and what is still
open. Everything below was run; "not tested" is stated where it applies.

## 1. Method and caveats (read before trusting any number)

| Item | Value |
| --- | --- |
| Build under test | `main` @ `7f2d2ed` (baseline), `npm run build` bundle served by `npx vite preview --port 4214` from this worktree |
| Browser | Chromium 1243 headless, software GL (`--use-angle=swiftshader`), 960x540 viewport, device scale 1 |
| Graphics preset | **LOW** for every circuit journey (set through Garage & Settings, like a player). **MEDIUM (the shipped default)** for the two baseline Festival runs and the after-fix Festival runs, LOW for the third baseline Festival run |
| Host | 4 CPUs shared with other agents, load average 5 to 12 during the runs. The page rendered at **0.1 to 2 frames per second**, so every wall-clock time below is an upper bound for the software path, not a hardware claim. G8 (60 fps on min-spec) is not touched by this report |
| Input | Real keyboard events (`page.keyboard.down/up`) through a closed-loop digital driver (`scripts/studio/tools/keyboard-driver.mjs`, tuned headless on the production `Simulation`). Menu inputs are real clicks and `selectOption` |
| State | `window.apexDiagnostics()` (the existing hook) for the heavy reads, plus a read-only tap on the physics worker's `frame` messages (an init script in the tool, nothing added to the product) so the driving loop reads speed, lap and rank every few milliseconds |

Two tool limits that matter for how to read the driving numbers:

* The keyboard driver holds a **four-wheel car** on the road (headless: 0 to 0.5 s off the edge over
  130 s on Aurel, Kansai East and Arroyo Oro) but cannot hold a **GP bike** (every tuning I tried
  left the bike off the track). On a 0.1 fps page it also gets only one decision per snapshot. When
  the driver is off the track edge for 10 s or stationary for 10 s it switches on the game's own AI
  DRIVER (G), and that is logged as a finding. This is a limit of my driver, **not** evidence about
  bike handling.
* The HUD is drawn once per presented frame, so below about 2 fps it lags the simulation by seconds.
  HUD-versus-simulation comparisons are only made on samples taken at 2 fps or more; none of the
  recorded baseline journeys reached that for long, so "HUD speed matches" is **not tested**.

## 2. Journey table

Times are wall seconds on the loaded software-GL host. "Driving" is click on ENTER until the
session is in the `driving` state; "first frame" is until a new frame was presented. Evidence
directories are under `docs/studio/reports/qa-full-flow/baseline/` (each holds `result.json`,
`progress.log` with every timed step, JPEG screenshots, CPU profiles).

| # | Journey | Result | Boot to menu | Session 1: driving / first frame | Session 2 | Inputs (menu + key events) | Console | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| a | Formula APX-01, Aurel, Free practice, solo | **Completed** both sessions, 30 s of sim time driven, pause/resume, exit, second session | 80.7 s | 157.7 s / 166.6 s | 32.1 s / 40.4 s | 16 + 340 | 0 errors; 1 SwiftShader warning (`KHR_parallel_shader_compile` unsupported) | `baseline/formula-practice/` |
| b | Formula race, 3 laps, 4 cars, Arroyo Oro | **Completed** race to the chequered flag (201.9 s sim), results screen read and checked, exit, second race | 64.0 s | 138.9 s / 144.1 s (race briefing taken: ENTER, then GO STRAIGHT TO LIGHTS) | 27.9 s / 29.5 s | 18 + 604 | same | `baseline/formula-race/` |
| c | Time trial with a stored personal-best ghost | **Completed**; ghost loaded (50.03 s PB), visible, HUD label `DELTA TO PB`, delta format `+3.077 S` | 79.1 s | 195.7 s / 207.3 s | 44.9 s / 57.5 s | 15 + 210 | same | `baseline/time-trial/` |
| d | GP bike race, `gpr1`, Kansai East, 3 laps, 4 bikes | **Completed** (race ended in results). The keyboard could not keep the bike on track, so AI DRIVER was used from sim 62 s; the tool then pressed G a second time at 122 s (it had lost track of the toggle, fixed), which switched the AI off again, so the player bike sat retired and the row reads DNF. That is a tool artifact, not a game result | 109.9 s | 151.6 s / 156.2 s | 48.4 s / 55.9 s | 19 + 762 | same | `baseline/gp-race/` |
| e | Wildcard pairing "Formula on the Wall" (`fx26` on the Mesa Speedbowl) | **Completed**, started through the **menu form** (the series is not wired into the menu, finding W1) | 116.9 s | 159.0 s / 165.1 s | 14.8 s / 18.8 s | 19 + 322 | same | `baseline/wildcard/` |
| f1 | Festival, MEDIUM (shipped default), two runs | World **built and drawn**; car drove (peak 256 km/h within 8 s of free roam, then stopped at the end of the road it was driven straight down); festival menu opened; exit to the menu worked. Rendering then ran at 0.01 to 0.03 fps | 83.8 s and 39.4 s | loading overlay hidden 8.7 to 11.4 s after ENTER; first presented festival frames 100 to 136 s later | not run (single) | 4 + 1 | 0 | `baseline/festival-medium/`, `baseline/festival-medium-2/` |
| f2 | Festival, LOW | **Completed**: ENTER to world visible 75 s (the first festival draw alone held the main thread for 61 s, 46.6 s of it in the bake's `readPixels`), then 0.4 to 0.8 fps, car 304 km/h peak, 1,557 m driven, menu, exit in 2.3 s | 128.6 s | n/a | not run | 7 + 1 | 0 | `baseline/festival-low/` |

Machine-checked results that held on every circuit journey: no console or page error, no failed
request, no non-finite value in any simulation snapshot, race positions unique, no AI car stationary
while still racing (after fixing a false positive in my own check), no AI car overlapping the player,
real-time factor 0.88 to 1.00 of wall time, results table positions 1..N in order with laps and times
consistent (journey b, section 3).

## 3. What each part of the flow did

**Menu and configuration.** All four disciplines and every form control exist; each selected value
read back correctly after setting (a control that a later control had overridden would have been a
finding; none was). Default entry is a complete session: from a cold menu a Formula race is **two
inputs** (ENTER CIRCUIT, then GO STRAIGHT TO LIGHTS in the briefing), practice is one, so the input
half of G3 holds. The time half cannot be judged here (138 to 196 s on this host).

**Time to first frame.** Menu 39 to 117 s after navigation (varies with host load), first paint
0.3 to 2.4 s, first contentful paint 1.4 to 5.3 s. First session 139 to 196 s, second session 15 to
57 s. The page's main thread was blocked for 43 to 83 s in one stretch during every first session
start (`maxGap` 43 s, 52 s, 55 s, 72 s, 84 s) and for 157 to 224 s in total across a journey
(PerformanceObserver long tasks). Profiles of the first session start (`cpu-session-*.cpuprofile.gz`):

| Share of a 156 to 207 s first session start | Time |
| --- | --- |
| main thread idle, waiting on the GPU process | 36 to 47 % (98 s of 207 s time trial; 56 s of 156 s GP race) |
| `drawImage` inside `TextureBudget.apply` (resampling generated canvas textures, `src/rendering/texture-budget.ts:84`) | 19 to 30 % (40 s and 47 s) |
| `getProgramInfoLog` (synchronous shader program links; the extension that would make them parallel is missing on SwiftShader) | 15 to 17 % (31 s and 26 s) |
| all of the application's JavaScript | about 12 % (time trial) |

None of that is a defect proven on hardware: it is where software GL spends the time. It is the list
of places to measure on a real GPU first (open item P1).

**Driving.** Speed rose to 248 to 250 km/h in cars and 193 to 244 km/h on the GP bike; no speed over
a sane bound, the lap counter never went backwards, laps were valid or invalidated by track limits as
expected (invalid laps give an empty best-lap cell). AI cars in the formula race finished 3 laps in
3:49 / 3:57 / 4:07 with best laps 1:12.7 to 1:17.7 on Arroyo Oro (3,602 m).

**Pause and resume** (the five circuit journeys a to e): ESC pauses within 16 to 119 ms of the key event; the pause
menu offers RESUME SESSION, RESTART SESSION, GARAGE & SETTINGS, RETURN TO PADDOCK and the second row;
after the worker acknowledges the pause the simulation clock and the car's position do not move over
three seconds (tick 5909 to 5909, 6225 to 6225, 8633 to 8633, 9016 to 9016); RESUME SESSION resumes with the clock
advancing 2.53 to 2.58 s in 2.5 s and no catch-up jump. The first journey (a) flagged "simulation
advanced while paused (one tick)": that was my check reading before the worker's pause barrier, not a
bug, and the tool now waits for the handshake. **One real defect:** Escape on the open pause menu did
not resume (finding D1, fixed).

**Results screen** (journeys b and d, the two that ended). Formula race: heading "Across the line.",
four rows 1..4, laps non-increasing, same-lap rows in time order, the lapped player row shows 1 lap
and its own race time and is highlighted, buttons WATCH REPLAY / TELEMETRY / PHOTO STUDIO / RACE
AGAIN / PADDOCK. GP race: the player had retired, heading "Session ended.", the row reads `DNF`, the
rest in order. The result of the leader's flag classifying lapped cars after one more crossing is
correct racing procedure, not a bug.

**Exit and start another.** PADDOCK / RETURN TO PADDOCK returned to a clean menu in 13.6 to 50.8 s with
the HUD hidden and no modal open (checked), and the second session started. The second session started from the
form's current values each time (race 2 as a 1-lap race, practice 2 and trial 2 as before); no
stale HUD or modal was left behind that the tool could see.

**Memory across two back-to-back sessions** (`HeapProfiler.collectGarbage` then `Runtime.getHeapUsage`,
renderer counters, process-tree RSS):

| Journey | JS heap after boot to after S1 to after S2 | Textures S1 to S2 | Geometries S1 to S2 | RSS after boot to S1 to S2 |
| --- | --- | --- | --- | --- |
| a practice | 33.7 to 71.8 to 72.1 MB | 203 to 203 | 1,670 to 1,697 | not recorded (tool bug, fixed) |
| b race | 33.7 to 73.2 to 73.3 MB | 149 to 149 | 2,464 to 2,464 | 2,098 to 2,975 to 2,923 MB |
| c time trial | 33.8 to 73.1 to 73.6 MB | 201 to 202 | 1,603 to 1,647 | 2,059 to 3,491 to 3,530 MB |
| d GP race | 33.8 to 72.9 to 73.9 MB | 106 to 106 | 1,815 to 1,815 | 2,046 to 3,007 to 3,077 MB |
| e wildcard | 34.4 to 74.1 to 74.7 MB | 64 to 64 | 2,201 to 2,297 | 2,044 to 2,727 to 2,735 MB |

No leak at this scale: the second session adds 0.1 to 1.0 MB of JS heap and no textures. Geometry
counts creep by 27 to 96 in three journeys; two sessions cannot tell a leak from caching, so this is
an observation, not a finding. The software-GL process tree uses 2.0 GB at the menu and 2.7 to 3.5 GB
after a session (GPU process included); a hardware figure was not measured.

**AI behaviour.** Formula race: all three AI cars completed 3 laps; none stationary, none overlapping
the player. **GP race (finding D5):** the AI bikes crashed 2, 3 and 5 times each in a 3-lap, 4-bike
race on Kansai East (`B.CRASHES`), one was on the ground after the flag. My player's bike was off the
track for the first minute, so I ran an all-AI control (`ai-only-race.mjs`, the player on autopilot
too, three seeds): 6, 4 and 5 crashes among four bikes, 39 to 51 car-seconds below 0.5 m/s while
racing (this includes the standing start). The AI alone crashes about once per bike per race there.

## 4. Festival: hang, or just slow?

The previous performance run reported the open world "stalling at Loading photographed ground…" for
420 s on the baseline. **It is neither a genuine hang nor a stalled build.** Evidence:

1. **The world builds in 9 to 11 s.** In the two MEDIUM runs the loading overlay was hidden 8.7 s
   and 11.4 s after ENTER FESTIVAL (stage log with timestamps in each `progress.log`; at LOW the
   same step reads 75 s only because the tool's own poll was blocked behind the first draw). `Loading photographed
   ground…` is simply the **last** text `host.loading()` is given; `host.loaded()` then hides the
   loading overlay without writing a final text, so the label stays at that stage forever in the DOM.
   `scannedGround.ready()` (15 s) and `photoSky.ready()` (20 s) are both bounded; neither can hang.
2. **What looked like a freeze was the first frames of the world.** After the overlay was gone the
   page presented a frame every 30 to 150 s (rAF count 183 to 189 in 190 s; a screenshot waited 90 to
   157 s). A CPU profile of the main thread across 165 s of that window (`baseline/festival-medium-2/
   cpu-festival-after-load.cpuprofile.gz`, summarised by `profile-callers.mjs`):

   | Main-thread self time in 165 s | | Caller |
   | --- | --- | --- |
   | idle (waiting on the GPU process) | 76.0 s (46 %) | |
   | `getProgramInfoLog` | **58.7 s (36 %)** | WebGLProgram link, from `renderBufferDirect` on the first draw of each material (SwiftShader has no `KHR_parallel_shader_compile`) |
   | `readPixels` | **26.1 s (16 %)** | `ProceduralTextures.bake` (`src/rendering/materials/procedural.ts:376`), a synchronous GPU readback per procedural recipe, run by `UltraPipeline.prepareFrame` inside the first `FestivalRenderer.draw`; a synchronous readback waits for every GPU command queued before it, so this is the GPU backlog, 46.6 s at LOW in the same place |
   | everything else in JavaScript | about 3 s | |

   The GPU process held 140 to 320 % CPU while the renderer process sat at 13 to 26 %, so the page is
   GPU-bound, not looping. The car was driven the whole time (peak 256 km/h, 406 m in 18 s, then
   stationary at x=999, z=-2606; simulation frames arrived through the tap), and the world rendered correctly
   (`baseline/festival-medium/03-festival-1-loaded.jpg`).
3. **Preset matters by 30x.** At LOW (no scanned ground, no shadows, no MSAA, 0.75 resolution) the
   same festival presents 0.4 to 0.8 fps on this host (HUD speed text changes between samples) and the
   drive step took 65 s including three screenshots.

So the answer is **(ii) slow under SwiftShader**, with a precise cause and two related product
defects the investigation exposed. The dominating cost is shader program linking plus a synchronous
procedural-texture bake, and both are paid **after** the loading screen is gone, inside the player's
first frames, because the Festival, unlike the circuit (`Renderer.prepare`: "Compiling circuit and
vehicle materials…", "Warming shadows and scene reflections…"), has no warm-up stage.

**Fix (D2, D3, D4 below).** `FestivalRenderer.prepareGpu()` now bakes the procedural maps, links the
scene programs (`compileSceneTarget`, the circuit's helper) and draws the real view twice behind
labelled loading stages, called from `FestivalSession.boot` before `host.loaded()`. Nothing drawn
changes (same materials, same passes). It is not a speed-up of the total work: it moves the work
behind a progress bar. First version (scene compile only) measured in
`after-scene-compile-only/festival-medium`: the loading stage grew to 88 s with 71 s in
`getProgramInfoLog`, but the first frames still cost 80 s of shader links (60 s in
`getShaderInfoLog`: shadow-depth and post-processing programs the scene compile does not touch), so
the warm-up was extended to draw the real view twice. Final measurement: section 6.3.

Safe speed-up that exists but was **not** done: none that leaves the default visuals unchanged. The
cost is GPU work software GL cannot parallelise; on hardware the same links are tens of milliseconds
each, so the benefit of the move there is a removed first-frame hitch, which I could not measure.

## 5. Defects, ranked

Severity: blocker (cannot complete the flow) · major (flow completes but a core promise is broken) ·
minor · polish. **No blocker was found: all six journeys completed.** "Fixed" means a change on this
branch plus the stated test or journey re-run.

| ID | Sev | Defect | Evidence | Status |
| --- | --- | --- | --- | --- |
| D5 | major | GP bikes crash about once per bike per race on Kansai East even with the player removed (AI-only control: 6, 4, 5 crashes in 4 bikes, 3 seeds; with the player 2, 3, 5, 2); one bike lay on the ground after the flag | `baseline/gp-race/`, `scripts/studio/tools/ai-only-race.mjs` | **Open**, owner QA Bikes & Dirt |
| D3 | major (software GL) / unmeasured on hardware | Festival pays 59 s of shader links and a 26 s synchronous readback inside the first frames, after the loading screen has gone (no warm-up stage) | section 4 | **Fixed in structure** (`prepareGpu`: bake, scene compile and two real draws now precede `loaded()`); 25 s of lazily created programs still link after the overlay on software GL; hardware effect not measured (6.3) |
| W1 | major (feature gap) | The Wildcard series cannot be reached from the menu: `registerSeries()` is never called in `src`, the series strip has no chips, and the grid selector offers 0/3/7/11 rivals while events use 4 to 5 | `baseline/wildcard/progress.log` (`wildcard.ui`, `wildcard.grid-mismatch`) | **Open**, UX wave 2 "Wildcard UI integration" |
| D2 | major | The Festival loading bar stayed at **2 %** for the entire load: none of the festival's stage texts had a mapping in `loadingStage` (`Building ...` matched the circuit rule, the rest returned the previous value) | `baseline/*/festival.stage` lines all `"percent":"2%"` | **Fixed** (`src/ui/loading-copy.ts`, test `tests/frontend-retail.test.ts`, failing before and passing after); journey after: 0 to 8 to 30 to 40 to 55 to 84 to 90 % |
| D4 | minor | `#app[data-mode]` stayed `loading` for the whole festival, so Steam rich presence read "Loading a session" for a player roaming the open world; `#Status_Festival` is documented in `desktop/STEAM.md` but nothing produced it. It also misled the earlier "stall" diagnosis | the tool's probe read `dataMode: "loading"` with `festival` diagnostics absent on an unmodified older bundle (a mis-aimed run, discarded as an "after" measurement because another agent's preview held that port); code reading agrees (`showMode('loading')`, never reset); the baseline runs predate the probe | **Fixed** (`showMode('festival')` on `loaded()`, `MODE_STATUS.festival`, diagnostics `festival.{starting,active}`; test `tests/steam-integration.test.ts` failing before, passing after) |
| D1 | minor | Escape on the open pause menu closed and re-opened it (the browser's Escape default cancelled the menu, and a `cancel` handler re-opened it every time), so only the RESUME button returned to the car | all six journeys (`FINDING resume`) | **Fixed** in two steps (`src/input/controller.ts` preventDefault for the consumed Escape, `src/core/dialog-close.ts`; tests `tests/bindings.test.ts`, `tests/dialog-close.test.ts`); the first step alone made Escape never pause and was caught by re-running the journey (6.2); final build verified |
| T1 | minor (test red on main) | `tests/studio-look-contracts.test.ts` P19 failed on `main`: the Wildcard validator's `BANNED_COPY` denylist names real marks and tripped the brand scan | `vitest run tests/studio-look-contracts.test.ts` before: 1 failed | **Fixed** (only that array exempt, asserted present; any other mention still fails) |
| P1 | minor | First session start blocks the main thread for 43 to 84 s on software GL; `drawImage` in `TextureBudget.apply` (19 to 30 %) and shader links (15 to 17 %) lead | section 3 profiles | **Open**, measure on hardware first |
| P2 | minor | MEDIUM Festival renders at 0.01 to 0.03 fps on software GL (LOW: 0.4 to 0.8 fps). Hardware unmeasured | section 4 | **Open**, needs a hardware run |
| O1 | polish | `#opponents` keeps reading 7 in Time trial and `DISTANCE` keeps "3 laps" in practice (inert, solo) | `baseline/time-trial` `configured` line | Open |
| O2 | info | GP bike first frame at 0 km/h shows another rider's back filling the view (`baseline/gp-race/03-gp-1-first-frame.jpg`). Taken 38 s of sim time after the start on a 0.13 fps page, so it may be an artifact of the slow first frame; **not confirmed** | screenshot | Needs a fast-machine look |
| O3 | info | On a very slow machine the simulation clock (lights, flags) runs while no frame has been presented, so the player sat stationary through the start (race control then showed DOUBLE YELLOW) | race first-frame screenshots | By design of a real-time worker; only matters below about 2 fps |

## 6. Verification after the fixes

### 6.1 Commands run on the final branch state (`6b6f230`)

| Command | Result |
| --- | --- |
| `npm run build` (`tsc --noEmit` + `vite build`) | exit 0 |
| `npm run lint` (`eslint src tests e2e scripts`) | exit 0 |
| `npx vitest run tests/dialog-close.test.ts tests/bindings.test.ts tests/input.test.ts tests/frontend-retail.test.ts tests/steam-integration.test.ts tests/studio-look-contracts.test.ts tests/meeting-flow.test.ts tests/startup.test.ts tests/race-view-continuity.test.ts tests/renderer-resource-lifecycle.test.ts tests/studio-frame.test.ts tests/open-world-session.test.ts tests/wildcard-series.test.ts` | 13 files, 160 tests passed |
| `node scripts/studio/tools/driver-selftest.mjs aurel apx01 130 practice` (and Kansai East, Arroyo Oro) | 1 to 2 laps, 0 to 0.5 s off the track edge in 130 s |

Not run: the full vitest suite, `npm run check`, the Playwright e2e suite (host rules).

Tests that **failed before their fix and pass after** (each run against the old source, then the new):

| Test | Before | After |
| --- | --- | --- |
| `tests/bindings.test.ts` "Escape consumed by the game stops the browser default..." | spy called 0 times | called once; disabled input leaves the default alone |
| `tests/frontend-retail.test.ts` "moves the festival loading bar through every stage..." | `Planning event routes...` titled `Loading` at the previous fraction | titled, strictly increasing 0.02 to 0.95 |
| `tests/steam-integration.test.ts` rich-presence statuses | `statusForMode('festival')` gave `Menu` | `Festival` |
| `tests/studio-look-contracts.test.ts` P19 | `src/career/wildcard-validation.ts: red bull` | passes; only the `BANNED_COPY` array is exempt |
| `tests/dialog-close.test.ts` (new, 5 cases) | n/a (new module); the old behaviour is quoted in the module comment | passes. It pins the pause-menu/sub-dialog/results decision, **not** the browser behaviour; that was verified in the browser |

### 6.2 Escape: a regression I introduced, caught, and fixed

My first Escape fix (`dialog-close.ts` alone, commit `5ecea5d`) passed its unit test and made things
**worse**: Escape never paused. The re-run of the practice journey on that build failed at "pause"
(`regression-caught/formula-practice-escape-never-pauses/`, the keydown probe shows the Escape
reached the page, not default-prevented, target BODY, state still `driving` after 120 s). Cause:
Escape pauses by opening the pause `<dialog>` during the keydown, and the browser's default for the
same Escape (a dialog close request) cancelled it at once. The old `cancel` handler re-opened the
menu every time, which hid that, and also made Escape unable to resume. Final fix: the controller
calls `preventDefault()` on the Escape it consumes while input is enabled (`src/input/controller.ts`),
plus the `dialog-close.ts` decision for Escape on the open menu. Re-run on the final build
(`after/formula-practice/`, port 4233): **0 findings**, ESC paused (clock and position frozen over 3 s,
tick 6149 to 6149), RESUME SESSION resumed (2.51 s in 2.5 s, no jump), the second ESC pair paused then
resumed (`escResume: "resumed"`), exit and the second session worked, 0 console errors.

### 6.3 Festival, MEDIUM, before and after (software GL, 960x540)

The three runs are on different bundles and different host load (load average roughly 7 to 11 for
the baseline, 12 to 14 for the final run), so compare the **structure and the ratios**, not the
absolute seconds.

| | Baseline (`baseline/festival-medium-2`) | Scene compile only (`after-scene-compile-only/`) | Final warm-up (`after/festival-medium`, bundle `f75c477`) |
| --- | --- | --- | --- |
| Loading overlay hidden after ENTER | 8.7 s | 88 s | 38.9 s |
| Loading bar | 2 % flat | 8, 30, 40, 55, 84, 90 % | 14, 30, 40, 55, 84, 90, 95 % |
| Stage labels after the last data load | none (stale `Loading photographed ground...`) | Baking / Compiling | Baking / Compiling / Warming the festival view |
| Main thread in program links *during* loading | 0 s | 71.1 s | 19.9 s |
| Program links + readback *after* the overlay | 58.7 s `getProgramInfoLog` + 26.1 s `readPixels` in 165 s | 80.4 s (60.4 s `getShaderInfoLog`) in 209 s | **25.1 s** `getProgramInfoLog` in 221 s (11 %), no `readPixels` (1.3 s of it happened during loading) |
| Main thread idle after the overlay | 46 % | 60 % | **87 %** |
| `#app[data-mode]` and `apexDiagnostics().festival` | `loading` by code (`showMode('loading')`, nothing reset it; the baseline runs predate the probe) / absent | `festival` / `{starting:false, active:true}` | same |
| First screenshot after the overlay | 103 s | 111 s | 178 s |
| Console and page errors | 0 | 0 | 0 |

What this shows: the festival's compile and bake cost is now paid behind a moving, labelled progress
bar instead of inside the first frames (program links after the overlay fell from 36 % to 11 % of
the main thread, the synchronous readback from 26 s to 1.3 s), and the world is correctly reported
as live. What it does **not** show is a faster festival: after the work moved, the main thread is
87 % idle and every frame still takes minutes. That is the steady-state GPU cost of a MEDIUM
festival frame on SwiftShader (0.01 to 0.03 fps; LOW is 30x faster), which has no safe fix that
leaves the default visuals alone. Whether the warm-up removes a first-frame hitch on a real GPU is
**unmeasured**.


## 7. What I changed

| File | Change |
| --- | --- |
| `src/input/controller.ts`, `src/core/dialog-close.ts` (new), `src/main.ts`, `src/ui/interface.ts`, `tests/bindings.test.ts` | Escape pauses without the browser's close request cancelling the menu, and resumes from the open menu; sub-dialogs, the briefing and results keep their return paths |
| `src/ui/loading-copy.ts`, `tests/frontend-retail.test.ts` | festival stage titles and monotonic progress |
| `src/rendering/open-world/festival-renderer.ts`, `src/session/free-roam.ts` | `prepareGpu()` warm-up behind the loading screen |
| `src/ui/interface.ts`, `src/main.ts`, `src/steam/runtime.ts`, `tests/steam-integration.test.ts` | `festival` UI mode and Steam status; `apexDiagnostics().festival` |
| `tests/dialog-close.test.ts` (new), `tests/studio-look-contracts.test.ts` | new contract test; P19 denylist scoped |
| `scripts/studio/tools/*` | journey tool and helpers (below) |

The two earliest baseline directories (`formula-practice`, `formula-race`) were recorded with earlier
versions of the tool (slower state reads, the one-tick pause false positive, no RSS); the numbers in
them are valid; the findings in them that came from my tool's own checks are explained in section 3.

Tooling added under `scripts/studio/tools/`: `journey.mjs`, `keyboard-driver.mjs`,
`driver-selftest.mjs`, `journey-summary.mjs`, `journey-evidence.py`, `profile-callers.mjs`,
`ai-only-race.mjs` (README updated).

## 8. Not tested, and what is still unverified

* Any wall-clock time on a real GPU: G3 (90 s), G7 load budget, G8 frame rate. All times here are software GL on a loaded host.
* HUD value agreement with the simulation (page below 2 fps in every baseline run).
* Motocross, supercross and rallycross journeys (QA Bikes & Dirt), photo mode and replay, the career hub, an Electron-packaged run.
* Festival events (race cards, skill challenges, travel, map, photo mode) beyond load, free-roam drive, menu and exit; a second festival load in the same page.
* Keyboard handling of GP bikes and MX: my driver cannot hold a bike, so human-driven bike races are unverified.
* The Festival warm-up's effect on a hardware GPU.

## 9. Recommended next tasks (ranked)

1. QA Bikes & Dirt: AI bike crash rate (D5). Start from `ai-only-race.mjs kansai-east gpr1 4 3 <seed>`.
2. UX wave 2: wire the Wildcard series into the Paddock Board and give the grid selector a 5-rival option (W1).
3. Hardware run of `journey.mjs` (all six journeys, `--quality` default and high) on the target GPU: closes P1, P2, O2, G3, G7, G8 with real numbers, and measures the Festival warm-up.
4. Teach the tool to hold a GP bike (a lean-aware controller) so bike journeys are human-input end to end.
5. A festival event journey (open a race card, run a sprint, results) on top of `festivalLoad`.
