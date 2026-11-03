# QA — Bikes & Dirt (GP motorcycles, motocross, supercross)

Branch `studio/qa-bikes-dirt`, cut from `main` @ a074ea5. Everything below was run in this worktree on a
4-CPU host shared with other agents (one vitest worker, one browser at a time). Scratch probes live outside
the repo; the commands that reproduce each finding are given inline.

## Summary

1. Eight bike/dirt vitest files (19 failing tests) and one e2e spec (2 failing tests) were red on `main`.
   **Eight of the nine files are green now** (18 vitest tests and both `e2e/48` tests fixed). One test is **still
   red**: `bike-session` "finishes a mixed GP/superbike race". Several further defects found while playtesting are
   documented but **not fixed** (see "Still broken").
2. **One root cause explains 18 of the 19 red vitest tests.** Commit `0e23cec` ("Restore main exactly to the latest
   pre-Babylon checkpoint") copied the tree of `20e0716` over `main`. That tree is a half-migrated moment of the
   motocross contact model, and the fixes that finished it lived only on the Babylon line the restore discarded.
   `dirt-bike-vehicle.ts`, `contact-impulse.ts`, `bike-ai.ts`, `ai.ts`, `traffic.ts` and four test files were
   rolled back together. They are re-landed here verbatim from `ec93c56`, the last commit where all of them
   passed: 10 tests needed the code back, 8 needed their stale expectations replaced. The 19th (mixed-class
   pace) and the two e2e tests are unrelated to the restore.
3. Playtesting with the repo's headless harnesses found a **real stuck-rider bug that the red list did not
   contain** (a GP rider stopped for ever on wet tarmac) and fixed it with a failing-then-passing test.
   Three further defects were demonstrated but not safely fixable in this pass (Montejaral GP hairpin falls,
   Arena Nord turn-one deadlock, mixed-class traffic).
4. Nothing was weakened or skipped. Four existing test files were replaced with the Babylon-era versions and one
   added; every changed expectation is listed with its evidence below. One of them (exact zero slip) was restated
   as a tolerance and is called out as such.

## Why the files were red

| Fact | Evidence |
| --- | --- |
| `main` = the `20e0716` checkpoint tree | `0e23cec` commit message: "Restore the complete tracked tree of 20e0716 ... All code, assets ... match that tree". |
| Besides the Wildcard content, only six `src/simulation` files differ between the Babylon-era tip and `main`, and they are exactly what the red tests exercise | `git diff --stat ec93c56 a074ea5 -- src/simulation` lists `ai.ts`, `bike-ai.ts`, `traffic.ts`, `vehicle.ts`, `offroad/dirt-bike-vehicle.ts`, `offroad/contact-impulse.ts` (deleted) plus the Wildcard additions (`config.ts`, `events.ts`, `track.ts`, `world.ts`, `wildcard-rulesets.ts`, `circuit-catalogue/*`). `git log` shows `dirt-bike-vehicle.ts` was only ever touched by `395d7df` (import) and `0e23cec` (restore). |
| The checkpoint was not green | Its own `docs/CURRENT_STATUS.md`: "Full unit tests are still running. No all-green claim yet." Its tests fail against its own sources (run on `a074ea5`, which is byte-identical for these files). |
| The fixes were done afterwards on the discarded line | `ec93c56:docs/maintenance/development-history-2026-10-31.md`: "The latest complete local motocross suite passes 572/572 after physical fixes and explicitly documented finite-inertia test-contract corrections", "Deep motocross overlap recovery exchanges forward/heave/pitch momentum through a passive contact impulse ... AI/supermoto touchdown no longer arms an obsolete one-frame pickup flag", "GP overtaking reserves enough target-lane room for finite lean response". Full CI at that time: 5,482 passed / 1 failed (the mixed GP/superbike pace case). |
| Last good / first bad | `ec93c56` good for every file below (run). `0e23cec` is the first bad commit and the only one that changes these files after `395d7df`, so the bisect is one step wide. The clone is shallow (58 commits, root `395d7df`); `20e0716` itself is not in it, so it could not be run. |

Why the old tests failed against the old source (the checkpoint's `mx-ground-physics.ts`, unchanged since, is a
finite-inertia brush solver, docs/motocross-physics-model.md): the glue code around it still had defects, and
four test files still asserted the previous kinematic-clamp behaviour (instant forces, bit-identical forces
between different contact histories, exactly zero slip).

## Test by test

Status is from the final consolidated run (see "Verification"). "Real" = the code was wrong; "Stale" = the
expectation was wrong. The split was measured by applying the Babylon-era source alone to the old tests: whatever
still failed is a stale test.

| Test | Failures on a074ea5 | Cause | Fix | Status |
| --- | --- | --- | --- | --- |
| `motocross-wheel-pickup` | 5 | 4 real, from three defects in the glue code (I did not attribute each test to one of them): AI/supermoto touchdown armed the obsolete player-only pickup flag (front wheel 7.23 m/s against 10.05 m/s road speed after landing); tyre slip was withheld while a wheel was unloaded; brake-force telemetry reported rotor respin from ground drag as a brake the rider never applied. 1 stale: "keeps a real pickup ... when the contact substep is halved" asserted slip exactly 0 | `dirt-bike-vehicle.ts` re-landed (touchdown flag, slip telemetry, brake-force reporting). Stale test restated as: mismatch below 0.1 %, reported slip equals the measured mismatch to 1e-12, and the two substeps agree to 1e-4 | **Green** (11/11) |
| `motocross-collision` | 2 ("projects a deep manual terrain contact without an impossible launch", raw and sport) | Real. Deep-overlap recovery injected heave without removing approach speed; after the deep contact the bike rose to a CG height of 6.15 m against the test's 6 m bound | `contact-impulse.ts` + `hardStopImpulse` in `dirt-bike-vehicle.ts`: one passive impulse over the contact Jacobian removes the closing speed without adding energy (270 analytic combinations in `motocross-contact-impulse.test.ts`) | **Green** (11/11). Test file unchanged |
| `bike-setup` | 1 ("dirt bike gearing holds in the air ... the limiter through the same ratio") | Real. A full-step drive pulse overshot the selected gear's limiter (rear spin 76.03 against the limit 75.38 at gearing 0.92) | Rear-spin drive integrated only up to the limiter headroom, existing overspeed momentum kept | **Green** (12/12). Test file unchanged |
| `motocross-tyre-contact` | 4 | Stale. The tests asserted bit-identical drive/brake force between a front-mud and a dry contact (280.6193 N against 280.6208 N, 428.4231/428.4241, 368.648/368.641, 393.056/393.050). Forces are coupled through chassis velocity and rotor inertia, so two different contact histories cannot be identical; applying the new source alone left all 4 red | Test replaced: the independently sampled grip coefficients must still be exactly equal, the 40 N force contrast is kept, every intermediate force over the 4 ticks must stay inside mu x grip x supported load, and slip must be honest | **Green** (6/6) |
| `motocross-contact-traction` | 3 | Stale. Asserted a full rear brake force (> 300 N) and a lifted-front/forward-stroke contrast after a single 240 Hz step; the rotor has finite inertia, so force builds over a few ticks (new source alone left all 3 red) | Test measures the same contrasts over four ticks, and additionally asserts the rear rotor torque acts at once and a lifted front never produces brake force on any tick | **Green** (10/10) |
| `motocross-shoulder-recovery` (not red on main) | 0 | Needed alongside the source: the recovered 250 now covers the 800 m target faster and crosses the line (station wraps at 919.7 m), which the old `bike.s > 800` read as a failure | Test accumulates unwrapped progress and also rejects any station step of 2 m or more (stricter than before) | **Green** (2/2) |
| `gp-tyre-contact` | 2 (poggio-alto, 8 riders: clear 0.0001, rain 0.983 impact) | Real racecraft. An upright GP lane left 0.35 m of target-lane room, so a rider that could not track its lane matched the slower target for ever, and the braking plan promised deceleration the GP lever (8 /s apply rate) cannot yet give | `ai.ts`, `bike-ai.ts`, `traffic.ts` re-landed: `trackingMargin` of 1 m for upright GP lanes only, `leverResponseDistance` in the approach plan, wet-contact line correction scaled by grip | **Green** (22/22, 78 s). Test file unchanged |
| `gp-riding-control` | 1 ("completes a real catch-and-pass without contact") | Real, same cause: the pass never completed | Same re-landing | **Green** (12/12). Test file unchanged |
| `e2e/48-motocross-practice.spec.ts` | 2 (HUD showed `BERM PRACTICE ... QUARRY 2 M` / `TURN ONE 5 M` instead of `TARGETS 0/5` / `Last takeoff ...`) | Stale fixture, not a regression of the restore: the spec fails identically on `ec93c56`. The fixture's "riding" (landing + 45 m) and "approach" (start - 45 m) stations sit 1.6 m / 5 m before a berm start. Since the berm-practice card was added the HUD gives it priority there on purpose (asserted by `tests/motocross-hud.test.ts` "recall ... QUARRY" and `e2e/54`) | `e2e/fixtures/motocross-interface.ts` searches from the nominal station for the first one the HUD reads as plain riding (same rule as `OffroadHud`). No assertion in the spec changed | **Green** (2 passed, 1.8 min) |
| `bike-session` "finishes a mixed GP/superbike race" | 1 (GP best 83.281 s, superbike 83.123 s) | Not a restore effect: fails identically on `395d7df` and `ec93c56` (83.576 against 83.123 s). Traffic: see "Still broken" | None | **Still red** |

New tests: `tests/gp-standstill-launch.test.ts` (4 tests, 3 of them red on `a074ea5`, see next section) and
`tests/motocross-contact-impulse.test.ts` (restored from `ec93c56`).

## Fixed from playtesting (not on the red list)

**A stopped GP rider can never pull away on wet tarmac.** Reproduce:
`node --experimental-transform-types scripts/bike-race.ts` (it reported "aurel rain seed 2024: a rider was not
classified" and "a rider was parked 555.7 s" on `a074ea5` and `ec93c56` alike).

- Symptom: in the seeded wet 8-rider mixed race at Aurel, car 6 (a GP-R1) sat at 0 km/h with full throttle from
  t = 28 s to the end and was never classified; the field spent 375 s neutralised under a safety car (race 571 s;
  the committed `docs/bike-race.json` has the same race at 422 s with no safety car, and there is none after the
  fix).
- Cause: `Bike.gpSteer` (the GP roll assist) only runs above 3 m/s and leaves `motoGP.leanTarget` and
  `lateralDemand` at their last values. The traction controller reads both as the roll reserve it must protect.
  The AI swerved back onto the track as it crossed 3 m/s, freezing a demand of 11.6 m/s2; at standstill the
  reserve exceeded the wet rear friction circle (mu 0.42, about 490 N), drive was cut to zero (`intervention`
  1.00), and the bike could not regain the speed that would refresh the demand. Dry grip hides it.
- Fix: `src/simulation/bike.ts` uses the assist's target and demand only on steps where it ran
  (`gpAssistLive`). Behaviour above 3 m/s is unchanged (guarded by a test).
- Evidence: `tests/gp-standstill-launch.test.ts` fails on `a074ea5` (3 of 4: neither GP reaches 6 m/s in 12 s,
  drive force 0 against a ~780 N friction-circle limit) and passes now. The race is back to 421.9 s, no safety car,
  all eight classified.

## Playtest with the headless harnesses

| Harness | Result on the final code | Baseline `a074ea5` |
| --- | --- | --- |
| `scripts/offroad-calibration.ts` | 0-60 m 4.53 / 4.50 / 4.43 s, 20 jump runs, **0 band failures** | same bands; every number within 0.005 of the committed run |
| `scripts/offroad-races.ts` MX moto (8 riders, seed 41001) | 283.59 s, 0 crashes, longest stop 9.4 s | 286.88 s, 2 crashes, 13.5 s |
| same, supercross main (seed 41003) | 282.96 s, 4 crashes (0.17/rider-lap, bound 0.75), longest stop 16.4 s | 294.89 s, 3 crashes, 16.3 s |
| `event valley-ridge-mx-moto-1` / `-moto-2` | 397.1 s, 0 crashes / 717.0 s, 3 crashes (0.07/rider-lap) | not run |
| `event valley-ridge-supermoto` | 316.3 s, 3 crashes, longest stop 13.6 s | not run |
| `event arena-nord-supercross` | **FAIL: car 0 parked 21.1 s** (limit 20); 531.7 s, 7 crashes | **FAIL: car 0 parked 26.7 s** (537.7 s, 11 crashes) |
| `scripts/wildcard-races.ts` bike/dirt events (knobblies-on-the-banking, red-canyon-scramble, supermoto-after-dark, supermoto-meets-the-joker, supermoto-on-the-roof, grand-prix-bikes-on-the-runway) | 6/6 PASS, impact <= 0.097 | not run |
| `scripts/bike-race.ts` (19 races) | 1 failure: the Montejaral GP event ("too many crashes", 32). The wet Aurel race is fixed (421.9 s, 0 crashes, all eight classified) | 3 failures: wet Aurel (not classified, parked 559 s) and the Montejaral GP event (27 crashes) |
| `scripts/bike-clearance.ts montejaral` | gp-bike **FAIL** (8 falls, parked 12.9 s), superbike pass (2 falls), supersport pass, classic **FAIL** (22 falls); the committed `docs/bike-clearance.json` records 0 falls for gp-bike and superbike | not run (the Montejaral GP event shows 27 falls on `a074ea5`) |
| Fuzz: random seeded held inputs for 90 s on a human-driven bike, 3 machines x 2 venues x 2 seeds (12 runs); dynamics and body state scanned for non-finite values once per simulated second | **no NaN or non-finite state**; top speed 74-131 km/h; air time <= 1.81 s; 3-6 falls per run (expected under random input) | not run |

The race-time differences against the baseline come from the re-landed dirt-bike changes as a whole (I did not
isolate them one by one; the most likely contributor is that AI riders no longer lose front-wheel speed at every
landing). MX/SX AI races are 1-4 % quicker and the MX field falls less. That is a behaviour change for AI
motocross, not only a test repair.

### Observations that did not reach "demonstrable bug"

- Dirt-bike `body.velocity.y` shows a one-tick spike of 40-90 m/s when a fall starts and again when the rider
  separates (position changes by only 0.05 m, so it is a derived-velocity artefact). Nothing visible was
  attributed to it; contact between bikes during a fall would read it.
- One 1.32 m single-tick position step (mx250, Arena Nord, 7.5 m/s, lateral -6.1 m at the boundary): a
  collision push-out, seen once in 12 fuzz runs.

## Still broken (not fixed)

1. **`bike-session` mixed GP/superbike pace.** Red on `395d7df`, `ec93c56` and `a074ea5`; the re-landing makes the
   margin worse (GP 83.576 s against superbike 83.123 s, was 83.281 s; most likely the lever-response braking
   reserve, not isolated). Causes found (`node --experimental-transform-types` probes kept out of the repo):
   - Solo, the GP is 3.5 s a lap quicker (79.34 against 82.83 s) and 320 against 280 km/h at the end of the
     straight, so the pace order is right. In the mixed race the GP riders are traffic-limited 63-72 % of their
     racing time, never reach more than 283 km/h, and **complete 0 passes** (3 seeds, 2 laps).
   - A GP rider launches slightly worse than a superbike from the same row (47 against 56 km/h at 2 s, 9 m behind
     at 4 s), loses a place at the start and then follows.
   - The planner cannot turn following into passing at speed: the follow reserve is 7 + 0.45 v = 41 m at 75 m/s,
     and in the lane scores printed for a GP rider following at that gap on the main straight, staying behind
     scores 3.7-5.3 while the pass lane scores 8.5-10.2 (a lane change costs about 5 before any penalty), so a
     straight-line pass is never chosen. Passes that are chosen, in corners, are aborted: of 54 aborted attempts
     in the seed-3303 race, 30 are "NOT CLOSING" and 17 "GAP OPENED". The follower is still inside the 3 m follow
     corridor, and therefore speed-limited to the leader's speed, for the ~2 s a 1.6 m/s lane change needs.
   - Tried and reverted: longer abort grace (1 to 3 s and effectively never), a gap-open threshold that scales with
     speed, dropping the follow limit while committed to a pass, and pricing the speed a lane gives up behind slower
     traffic (three weights). None is robust: the outcomes flip individual seeds green or red non-monotonically
     (seed 3303 green at weight 0.4 with a crash, 77 green at 1.0, 3303 green at 2.0) with 0-1 completed passes. Tuning
     to the test seed would be the "green after an unrelated crash" outcome the development history already rejected.
2. **Montejaral GP final hairpin.** `event montejaral-gp-motorcycle` (seed 30104, 5 laps, 8 riders): 32 falls on
   this branch (27 on `a074ea5`; the bound in `scripts/bike-race.ts` is 6). 27 of the 32 are in the one twentieth of
   the lap that holds the last hairpin (stations 3981-4202 m; most at 4134-4160 m, 286 m before the line, line
   radius about 19 m). A **one-rider** GP-R1 session (4 laps, seed 30104) falls there on lap 2, so it is not traffic. Reproduce with
   `node --experimental-transform-types scripts/bike-clearance.ts --jobs 1 montejaral` (restore
   `docs/bike-clearance.json` afterwards). The AI's own target at the hairpin is 47 km/h but the bike
   arrives at 75 km/h: it takes the preceding corner at 115 km/h against a 93-99 km/h target with the brake held at
   the 0.30 friction-circle floor, then runs 6-10 m beyond the road edge before the fall (lean beyond 1.25 rad on
   the gravel, grip 0.40). The brake law is `-error x 0.18` (a 20 km/h excess is needed for full brake) with the
   friction-circle and front-use reductions in `AIDriver.update` on top. The behaviour is identical on `395d7df`,
   so it predates every commit in this clone, and the committed `docs/bike-clearance.json` (0 falls for gp-bike) is
   from an older epoch. Experiment (reverted): a brake gain of 0.4 takes the superbike (2 to 0) and the classic class
   (22 to 0) clean through Montejaral but makes the GP worse (8 to 14), so the GP also has its own cause.
   `CircuitDefinition.bikeClasses` still declares gp-bike cleared there.
3. **Arena Nord supercross turn-one deadlock** (the "traffic stall" the development history lists as open).
   Five bikes (cars 0, 2, 3, 5, 6) wedge within 5 m of station 106-111 with `trafficSpeed` 0 and wait on each other
   (the planner's `waiting`/`bypass` ids point at one another and at the downed rider, car 7). Car 7 is gone by
   46 s, but the cluster is still creeping at under 4 km/h at 64 s. `MarshalControl` also flags any car under 3 m/s
   for 2 s as an OBSTRUCTION (double yellow, 12 m/s cap, no overtaking), so queued riders become hazards for each
   other. `scripts/offroad-races.ts` fails this event on `a074ea5` (26.7 s) and here (21.1 s, the harness counts
   continuous time below 1 m/s). Reproduce: `OFFROAD_RACE="event arena-nord-supercross" node
   --experimental-transform-types scripts/offroad-races.ts` (then restore `docs/offroad-races.json`).
4. **Dirt-bike AI has no recovery for a wedged but upright bike.** `BikeAIDriver` forces `command.reverse = false`
   after the shared stuck handler ran, so the 5-9 s "RECOVERY" decision that shows in the log does nothing; only
   fallen riders (BIKE_RECOVERY) and the dirt AI's push logic recover.

## Judgement calls for the PM

- **Source of the fix.** I re-landed the Babylon-era files instead of re-deriving them. They were developed,
  documented and CI-validated on a branch the owner chose not to continue; `0e23cec` states the intent was to stop
  the *Babylon migration* on `main`, and these files are not Babylon code. If the owner meant to drop the physics
  fixes too, revert `ae59700` and accept the nine red items; I found no evidence for that reading.
- **Physics identity.** `SIMULATION_VERSION` stays 18 (`tests/session-identity.test.ts` pins it), as in the
  Babylon line for these files. The player motocross hard-stop and limiter fixes and the GP traction fix change
  motion compared with v18 records. Bump it (and that test) if replays or leaderboards must not mix.
- **Not taken from `ec93c56`:** the car-only automatic-shift change in `vehicle.ts` (v19-v21) and
  `ghostCategoryKey`; they belong to the circuit department. The bike classes have their own `drive()`.
- **The one loosened expectation** is the exact-zero slip in the halved-substep wheel-pickup test (now < 0.1 %
  with exact telemetry). Under the documented brush law `s_long = (R w - u) / max(0.9, 0.075 u)` (docs/
  motocross-physics-model.md) a free rotor can only follow changing road speed through a small non-zero mismatch,
  so exactly zero slip cannot hold; the measured value was 7e-4 (mismatch divided by max(3 m/s, speed)).

## Verification (commands, results)

| Command | Result |
| --- | --- |
| `npx vitest run` on the 11 originally red files plus the two new ones (`tests/motocross-wheel-pickup`, `-tyre-contact`, `-contact-traction`, `-collision`, `-contact-impulse`, `-shoulder-recovery`, `tests/gp-tyre-contact`, `bike-session`, `bike-setup`, `gp-riding-control`, `gp-standstill-launch`) | 10 files pass, 104 tests; 1 failure: the mixed GP/superbike race |
| 38 other files that import the changed modules (bike-animation ... vehicle-definitions), after the first commit | 373 tests pass |
| 26 further bike/GP files that import `bike.ts` / `bike-vehicle.ts`, after the traction fix | 257 pass, the same 1 mixed-race failure |
| `node .../playwright test e2e/48-motocross-practice.spec.ts` (DOM fixture, no game boot) | 2 passed (was 2 failed on `a074ea5` and `ec93c56`) |
| `npx tsc --noEmit` | 0 errors (45 s) |
| `npx eslint` on every changed file; `prettier --check` on the new/edited fixture, test and `bike.ts` | clean |
| Scripts in the table above | as listed; none of the committed `docs/*.json` baselines were rewritten |

Not run: the full vitest suite (by instruction), `npm run build`/`lint` on the whole tree, any real-GPU or full-game
browser run (nothing here exercises rendering of the bike models), `scripts/vehicle-calibration.ts`, and the
car/Formula suites touched by the shared `ai.ts`/`traffic.ts` change (the new `trackingMargin` parameter defaults to
0, so cars are unchanged by construction, but I did not run the car race scripts). `main` has moved on to `7f2d2ed`
(weather, performance, release engineering) since this branch was cut. No file changed on both sides, but the
weather commits touch `bike-vehicle.ts`, `weather.ts` and `track.ts`, so a wet-weather bike check after merging
(the Aurel rain race and `gp-standstill-launch`) is worth one run.

## Recommended next tasks (ranked)

1. Decide the physics-identity question (bump to 19 with the tests) before the Steam build ships, since saves and
   leaderboards are keyed on it.
2. GP braking envelope: make the AI's brake command follow the planned profile (feed-forward from the required
   deceleration, honouring the friction-circle cap) and re-clear gp-bike on Montejaral; then re-run
   `bike-clearance.ts` for all circuits and refresh `docs/bike-clearance.json` and `docs/bike-race.json` (both are
   from an older physics epoch, the wet Aurel race in particular).
3. Break the stalled-wait cycle in `TrafficPlanner` (a stalled-by-queue bike should not stall the one behind it
   for longer than a few seconds) and exempt queue-held riders from `MarshalControl`'s OBSTRUCTION rule; closes the
   Arena Nord event and the "dirt AI wedge" item.
4. Mixed-class racecraft: price the speed a lane gives up behind slower traffic, make the abort rules depend on the
   follow reserve, and give the faster class a better start; measure by completed passes over many seeds, not by one
   lap-time assertion. Consider seeding mixed grids by class pace as a game-design decision.
5. Clamp the derived `body.velocity.y` at fall start/separation and look at the 1.3 m push-out near the Arena Nord
   boundary.
6. Browser playtest of the three disciplines on real hardware (not done here): landing feel after the re-landed
   touchdown change, and the practice HUD with the repaired stations.
