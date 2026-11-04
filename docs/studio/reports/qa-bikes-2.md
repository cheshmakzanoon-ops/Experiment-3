# QA — Bikes & Dirt, wave 2

Branch `studio/qa-bikes-dirt-2`, cut from `main` @ `aecec04` (physics v19). Scope from the PM: (1) the GP bike AI
crash rate (qa-full-flow defect D5), the red mixed GP/superbike test and the Montejaral GP event; (2) dirt journeys in the
browser (motocross, supercross, rallycross); (3) re-run what I touched. Everything below was run in this worktree on the
shared 4-CPU host (load average 6 to 12 during the runs, so every wall-clock time is an upper bound).

## Summary

1. **D5 is fixed at its root, with one circuit still open.** A four-bike, three-lap, all-AI GP race (player on the
   autopilot too) fell **277 times in 80 races** (8 circuits, 10 seeds each; 0 of 50 races clean on the five worst
   circuits) on the code at `main`. It now falls **6 times in 80 races** (74 clean), and 28 more races on eight further
   circuits are clean. Best laps moved by -4.7 % to +3.0 % (median -0.3 %) on those eight circuits and by +0.2 % to +3.7 % on
   the eight that were already clean: the AI is not made slower in a way that matters. Seven of the eight circuits are now
   clean in 9 or 10 of 10 seeds; **Kansai East** (the circuit D5 was filed on) went from 24 falls to 5 and is the one that
   is still not clean (5 of 10 races have exactly one fall).
2. **Root causes (all in the AI, none in the bike physics)**, each shown with a trace below: (a) the brake law was purely
   proportional, so the rider trailed its own planned braking profile by 8 to 25 km/h and met hairpins 25 to 30 km/h over
   plan; (b) with the lean intent saturated by the corner, the bike's cornering ABS then removed all braking, so a rider
   that was late could not recover; (c) the AI's pedal logic assumes a linear 0..1 pedal, but a GP front lever stops adding
   force at about 0.4 of its travel (the stoppie limit), so a "full brake" only unloaded the rear to 100 N and fishtailed the
   bike: every rider that took the flag fell on the cool-down straight.
3. **Fix** (`src/simulation/ai.ts`, `src/simulation/bike-ai.ts`): the GP rider feeds the planned deceleration forward
   (`brakeDemand` hook, `envelopeProfile` reports the plan at each sample), keeps the lever inside 0.75 of the stoppie
   point, and brakes gently after the flag. Physics version 19 -> **20** (seeded GP AI sessions move differently; rider
   physics unchanged). New `tests/gp-ai-braking-plan.test.ts` (9 tests): its race tests fail on the previous controller.
4. **Mixed GP/superbike race (`bike-session`): still red, and I did not fake it green.** Root cause is traffic, not
   pace: the GP is 2.5 % quicker alone (4.2 % before) but a superbike leads it round for the whole race and no pass is
   completed. The braking plan costs the GP 1.8 % alone, so the margin grew from 0.46 s to 0.60 s. What I tried for it, and
   why it was reverted, is in section 3.
5. **Montejaral GP event:** `scripts/bike-race.ts` (19 seeded 8-rider races): **all 19 pass**; the Montejaral GP event
   (seed 30104, 5 laps, 8 riders) fell 32 times before (bound 6) and **0 times** now; the Poggio Alto GP event 0. `scripts/bike-clearance.ts
   --jobs 1 montejaral`: `gp-bike` was FAIL (8 falls, parked 12.9 s) and is now **PASS** (1 fall, parked 12.3 s), superbike
   PASS (2), supersport PASS (0); classic-bike FAIL (22) as before and correctly not declared for that circuit.
6. **Dirt journeys (browser):** `journey.mjs` now has `motocross`, `supercross` and `rallycross` journeys. All three ran
   menu -> start -> ride -> pause/resume -> results -> exit -> second session with **no console error and no failed
   request**. They ride on the in-game AI DRIVER (the tool cannot hold a dirt bike); rallycross starts on the keyboard
   driver. Defects found are ranked in section 4; two are real game defects (an MX stop at station ~600 every lap, an SX
   turn-one fall in both sessions) and are **not fixed**.
7. Dirt behaviour is unchanged by construction and by measurement: `scripts/offroad-races.ts` Valley Ridge moto is
   the same race time, crash count and longest stop as the previous report (283.59 s, 0 crashes, 9.4 s).

## 1. GP bike AI crash rate

### 1.1 Method

`scripts/studio/tools/bike-ai-sweep.ts` (new, committed; README row added) runs the production `Simulation` at 120 Hz
headlessly with every bike on the production bike AI (`sim.autoPlayer = true`, the same control as
`ai-only-race.mjs`, no browser), counts falls through `BikeDynamics.fall` and, with `--trace`, prints each fall's lap
time, station, speed, lean, tyre use, grip, pedals and the source line that raised it. A 4-bike 3-lap race takes 5 to 12 s.
"Before" is a `git archive` of `main` (`aecec04`), "after" is this branch; same command, same seeds
(`firstSeed + 37 k`). Raw output: `docs/studio/reports/qa-bikes-2/gp-sweep/`.

### 1.2 What was wrong (evidence)

Falls on `main` are never random: they cluster at a handful of stations (Ardennes 3180-3200, Montejaral 4134-4164,
Kansai East 880-930, Fiume Verde 850-900) and on the straight just after the flag (stations 35-210).

**(a) and (b): late by construction, and no brakes once leaning.** Ardennes seed 1000, car 0, last hairpin (centreline k 0.047, plan target 43 to 47 km/h). The
rider reaches the turn-in at 77 km/h:

```
t=70.10 s=3093  v=95 tgt=86  br=0.50 lean 0.34
t=70.70 s=3107  v=80 tgt=67  br=0.61 lean 0.27 lean-target 0.60
t=70.90 s=3112  v=77 tgt=65  br=0.59 lean 0.39 lean-target 0.94   front brake force 0 N
t=71.30 s=3120  v=77 tgt=57  br=0.30 lean 0.77 lean-target 0.99   front brake force 0 N
t=73.60 s=3167  v=77 tgt=36  lat -9.8 (gravel)  ->  fell at 3182, 18 m wide
```

The brake law was `command.brake = clamp(-(target - speed) x 0.18, 0, 1)`: a 20 km/h excess was needed for the full lever,
so on any falling target the rider held a steady 6 to 10 km/h lag, and that lag was the excess speed at the corner. It
also only has authority while the lean is small: as the corner begins the lean intent saturates at the lean limit
(`lean-target 0.99`), the cornering ABS reserves the whole friction circle for it, and the front brake force drops to 0
whatever the pedal says. Late and leaning means no brakes at all.

**The bike is not at fault** (scratch probe over the production GP core, full lever while holding a lean, 30 m/s):

| held lean (rad) | 0 | 0.25 | 0.5 | 0.75 | 1.0 |
| --- | --- | --- | --- | --- | --- |
| deceleration the bike really gives (m/s2) | 11.0 | 9.2 | 7.2 | 4.5 | 0.9 |
| what the AI's envelope plans (0.7 margin) | 7.1 | 7.0 | 6.3 | 4.1 | 0 |

Held steadily, the physics delivers at least the plan at every lean. The shortfall is only in the transient the proportional
law creates.

**(c) The pedal is not linear.** `Bike.step` caps the front force at the lift limit
(`stoppieMargin x static rear load x wheelbase / cg height`), about 2.4 kN, which the GP's 7.6 kN x 0.78 caliper reaches at
about **0.4 of the lever** (2371 N at lever 0.40, 230 km/h). Beyond it the lever adds no stopping force, but the combined
brake still sends 30 % of the pedal to the rear (`rear = max(rear, total x 0.3)`), and the rear wheel carries about 120 N
there. After the flag the AI's cool-down target (137 km/h, a step from 234) put the lever to 1.0 for 1.6 s. Montejaral
seed 1000, car 0, last lap (lever 1.0, front 2.3 to 2.4 kN, rear brake 150 to 340 N on a near-weightless rear): it fell
on the straight beyond the line at t = 348.2 s, 133 km/h, `lean 1.27`. With the lever capped at 0.40 instead (seed 1037,
same place) the rear stays at 114 to 137 N while the bike fishtails (lateral speed -7.7, +6.0, -12.5 m/s) and falls at
t = 348.4 s:

```
t=345.51 v=216 br=0.40 front 2371 N  rear load 120 N  lateral speed  -7.7 m/s
t=346.31 v=177 br=0.40 front 2244 N  rear load 160 N  lateral speed  +3.5
t=346.81 v=161 br=0.40 front 2193 N  rear load 170 N  lateral speed -12.5
t=347.91 v=145 br=0.30                                lateral speed -13.8, yaw 2.4 rad/s
t=348.41 lean 1.18 -> lowside on the straight beyond the line
```

Straight-line braking itself is stable (`brakeprobe`: stick 0, 65 m/s, full lever, 5.5 s: no sideslip); it is the small
steering corrections of the line follower on a rear with no load that start the fishtail. On `main` this was 1 to 2 falls per
race *after the flag* (one-lap races: Ardennes seeds 1000 and 1037 two each, Montejaral 1000 one), the "bike on the ground
after the flag" of the full-flow report.

### 1.3 The fix

* `src/simulation/ai.ts`: `brakeDemand(error)` hook (default unchanged: `-error x 0.18`, so cars and the off-road AI are
  untouched); `envelopeProfile(..., profile?)` can report the plan speed at every sample (the existing result is unchanged,
  a test pins it).
* `src/simulation/bike-ai.ts` (GP riders only; `isGp`):
  * **Feed-forward.** The GP approach plan already solves the braking profile 12 m steps ahead; the rider now brakes for
    `(v^2 - v_plan(+12 m)^2) / 24` as a share of the stoppie-limited stop, expressed as a share of the lever travel that
    reaches the limit (`leverAtLimit()`), on top of the proportional term. No lag, no waiting for an error.
  * **Lever inside the stoppie point.** The pedal is capped at `GP_AI_HANDS.leverShare` (0.75) of the travel that reaches
    the limit, so the rear always keeps about a quarter of its static load.
  * **Cool-down.** After the flag the lever is capped at `GP_AI_HANDS.cooldownBrake` (0.2); the plan's own braking for a
    corner still applies.
* `src/core/session-identity.ts`: `SIMULATION_VERSION` 19 -> 20 with a comment; `tests/session-identity.test.ts` pinned
  to 20 and its range extended to v18-v19.
* `tests/gp-ai-braking-plan.test.ts` (new, 9 tests). Failing on the previous controller: the profile-out parameter and the
  feed-forward / cool-down hooks do not exist there; the race tests fail on `main` with the falls listed in 1.2
  (`no rider falls at the ardennes hairpin` seeds 1000 and 1037, `... montejaral hairpin` 1000, `... after taking the flag`
  Ardennes 1000 and 1037, Montejaral 1000), all passing now (31 tests with `gp-tyre-contact`, 45 s).

### 1.4 Before / after

Four `gpr1`, three laps, seeds 5000 + 37 k, k = 0..9. "Before" = `main`; "after" = this branch.

| Circuit | Seeds | Before: falls total (per race range) | Before: clean races | After: falls total | After: clean races |
| --- | --- | --- | --- | --- | --- |
| kansai-east | 10 / 10 | 24 (1-6) | 0/10 | 5 | 5/10 |
| ardennes | 10 / 10 | 107 (8-14) | 0/10 | 0 | 10/10 |
| montejaral | 10 / 10 | 74 (6-8) | 0/10 | 0 | 10/10 |
| fiume-verde | 10 / 10 | 38 (2-6) | 0/10 | 1 | 9/10 |
| arroyo-oro | 10 / 10 | 15 (1-3) | 0/10 | 0 | 10/10 |
| haarveld | 10 / 10 | 8 (0-3) | 5/10 | 0 | 10/10 |
| kansai | 10 / 10 | 6 (0-3) | 7/10 | 0 | 10/10 |
| poggio-alto | 10 / 10 | 5 (0-2) | 7/10 | 0 | 10/10 |
| **all** | 80 / 80 | **277** | 19/80 | **6** | 74/80 |

Best lap (median over the races of each side that completed a lap; "n" = races with a valid best lap):

| Circuit | Median best lap before (s) | Median best lap after (s) | Change |
| --- | --- | --- | --- |
| kansai-east | 54.86 (n=8) | 54.77 (n=10) | -0.2% |
| ardennes | 158.24 (n=9) | 155.15 (n=10) | -2.0% |
| montejaral | 106.16 (n=10) | 107.57 (n=10) | +1.3% |
| fiume-verde | 107.81 (n=9) | 102.72 (n=10) | -4.7% |
| arroyo-oro | 92.46 (n=4) | 92.22 (n=4) | -0.3% |
| haarveld | 102.12 (n=10) | 105.16 (n=10) | +3.0% |
| kansai | 137.84 (n=4) | 132.88 (n=10) | -3.6% |
| poggio-alto | 114.76 (n=10) | 117.70 (n=10) | +2.6% |

Eight more circuits that were already clean on `main` (3 seeds), re-run after the fix as a no-regression and pace check
(aurel, vellamar, parco-reale, loirette-club 5 seeds; northfield, northfield-classic, texas-hill, cape-wrenna 2 seeds):

| Circuit | Best lap before (mean, 3 seeds) | Best lap after | Change | Falls before / after |
| --- | --- | --- | --- | --- |
| aurel | 62.37 s | 63.18 s | +1.3 % | 0 / 0 |
| vellamar | 78.70 s | 80.12 s | +1.8 % | 0 / 0 |
| parco-reale | 111.00 s | 111.94 s | +0.8 % | 0 / 0 |
| loirette-club | 100.10 s | 102.40 s | +2.3 % | 0 / 0 |
| northfield | 123.90 s | 128.53 s | +3.7 % | 0 / 0 |
| northfield-classic | 106.20 s | 109.60 s | +3.2 % | 0 / 0 |
| texas-hill | 133.50 s | 133.75 s | +0.2 % | 0 / 0 |
| cape-wrenna | 96.40 s | 98.26 s | +1.9 % | 0 / 0 |

**Acceptance (10 seeds, >= 4 circuits, no falls):** met on Ardennes, Montejaral, Arroyo Oro, Haarveld, Kansai and Poggio
Alto (10/10 each; before, Ardennes, Montejaral and Arroyo Oro were 0/10 and the other three 5/10 to 7/10); Fiume Verde is 9/10 and Kansai East 5/10.

**Pace (not absurdly slow).** Median best lap, before -> after (table above): between -4.7 % and +3.0 %. The circuits that
got quicker are the ones where falls used to ruin laps and recoveries lost time. On the circuits that were already clean
the cost is +0.2 % to +3.7 %: that is the price of arriving at the corner at the speed the plan says.

### 1.5 What is still not clean

* **Kansai East, 5 of 10 seeds, one fall each**, always the *last* bike (car 3) on lap 3 at station 877-891, 79-81 km/h,
  lean 1.25 with no brake and 15 % throttle: the right-left chicane before the hairpin, where the racing line crosses the
  track by about 8 m in about 50 m. The lean intent is held at the limit by the lane correction (0.6 g) before the esses begin,
  the cornering ABS cuts the front brake to 0 and the rider is 30 km/h over the plan at the first flick. Same mechanism as
  1.2(a), reached by a different door; it is the next thing to fix (see "Recommended"). It was 0 of 10 with a softer
  pedal map, but that map failed `gp-tyre-contact` (8 riders, Poggio Alto, clear: impact 1.1e-4 from two riders converging
  on the same apex), so it was not kept.
* **Fiume Verde seed 5333**, 1 fall. Montejaral and Ardennes are clean in all ten seeds of this run, but earlier variants
  of the fix still had a rider fall at the Montejaral hairpin while passing in a pack, so read 10/10 as a measurement, not a
  guarantee: a rider that is passing inside a pack at a hairpin is the weak case.

### 1.6 Tried and reverted (so nobody repeats them)

| Idea | What it did | Why dropped |
| --- | --- | --- |
| Plan the corner speed one lean-preview earlier (`BIKE_AI.preview x v` of extra distance) | falls dropped, laps +2 to +7 % (Aurel 62.4 -> 64.8 s, Northfield 123.9 -> 133.3 s) | absurdly slow |
| Higher braking margin (0.7 -> 0.8 or 0.75) to win the pace back | laps back to baseline (Aurel 62.6 s, Vellamar 78.0 s), 7 falls in 12 races (0.8), 5 in 11 (0.75) | falls up |
| Lane correction yields to the lever (`brakePriority`) | Montejaral clean, Kansai East 0 -> 3, 4, 0 falls in three seeds | worse on the circuit that matters |
| Hold the lean intent back when over the plan speed | Kansai East 5 -> 17 falls in 10 races | worse |
| Scale the whole GP pedal to force fractions (soft proportional law) | 13 falls in 80 races, Kansai East 0/10, but the 8-rider Poggio Alto contract in `gp-tyre-contact` failed (impact 1.1e-4: two riders converging on one apex at 60 km/h, t = 20 s) | broke an existing contract; replaced by the 0.75 cap |
| Cap the lever at the full stoppie point (not 0.75) | 29 falls in 80 races (Fiume Verde 7, Kansai 6, Kansai East 5, Ardennes 5) | rear at 8 % load fishtails |
| Equalise the GP standing start with the superbike (lever off and throttle on at once, 8 /s) | GP 4 s distance 59 m -> 70 m (superbike 69 m), but the field then reaches turn one as a train: Ardennes seed 1000 two falls at 138 and 88 km/h, Fiume Verde car 0 at station 700 in 3 of 3 seeds | falls not better, did not turn the mixed test green |
| Pass urgency + speed-scaled "GAP OPENED" (see 3) | test seed 3303 green by 0.17 s, seeds 77, 101, 202, 303 still 1.5, 1.3, 0.1, 0.3 s slower | tuned to one seed |

## 2. Re-run of what I touched

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` (this branch, final code) | 0 errors |
| `npx eslint` on `ai.ts`, `bike-ai.ts`, `session-identity.ts`, the two test files, `bike-ai-sweep.ts`, `journey.mjs`; `npx prettier --check` on `bike-ai.ts`, the new test and the sweep tool | clean (`ai.ts` and `journey.mjs` were already not prettier-clean at `main`; I did not reformat them) |
| `npx vitest run` on 24 files that import the changed modules: `session-identity`, `gp-braking-approach`, `gp-riding-control`, `gp-standstill-launch`, `gp-pit-departure`, `gp-drive-traction`, `gp-tyre-contact`, `bike-session`, `bike-setup`, `motocross-ai`, `offroad`, `vehicle-definitions`, `race-control`, `wildcard-series`, `gp-ai-braking-plan` (new), `motocross-shoulder-recovery`, `motocross-wheel-pickup`, `motocross-collision`, `gp-race-control`, `gp-grid`, `gp-wet-finish-order`, `gp-bike-finish`, `open-world-bikes`, `festival-racecraft-bikes` (one worker, `--no-file-parallelism`) | 23 files pass, **272 of 273 tests pass**; the one failure is `bike-session` "finishes a mixed GP/superbike race" (GP 83.72 s vs superbike 83.12 s), red on `main` too |
| `scripts/bike-race.ts` | all 19 races pass; `docs/bike-race.json` refreshed (it was from an older epoch) |
| `scripts/bike-clearance.ts --jobs 1 montejaral` | gp-bike PASS (1 fall), superbike PASS (2), supersport PASS (0), classic FAIL (22, not declared); `docs/bike-clearance.json` not rewritten (single circuit) |
| `scripts/wildcard-races.ts <6 bike/dirt events> --no-write` | 6/6 PASS (`grand-prix-bikes-on-the-runway` impact 0, `supermoto-meets-the-joker` 0.01) |
| `OFFROAD_RACE="Valley Ridge motocross moto" node ... scripts/offroad-races.ts` | 283.59 s, 0 crashes, longest stop 9.4 s: identical to the previous report (dirt AI untouched); `docs/offroad-races.json` restored |
| `bike-ai-sweep.ts` x 100 races (section 1.4) | 6 falls, 94 clean races |
| `journey.mjs --journey motocross | supercross | rallycross --quality low` on `vite preview --port 4221` | all three completed, 0 console errors, 0 failed requests |
| `npx tsc` and `vite build` | run separately; `npm run build` and `npm run lint` over the whole tree were not run (4-CPU host) |

Local to this report (kept out of the repo): the `trace`, `trailprobe`, `brakeprobe`, `pack`, `follow`, `mx`, `mx2` and `gate`
probes quoted above were scratch `node --experimental-transform-types` scripts over the production modules; the committed
equivalent for the main one is `scripts/studio/tools/bike-ai-sweep.ts --trace`.

## 3. Mixed GP/superbike race (`tests/bike-session.test.ts`): root cause, not fixed

The test: Vellamar, six bikes alternating `gpr1`/`sbk1000`, seed 3303, two laps; the best GP lap must beat the best
superbike lap. Measured here, same seed: `main` GP 83.58 s vs superbike 83.12 s (the PM's 0.45 s); this branch GP 83.72 s vs
83.12 s (0.60 s).

* **Pace is right, racing is not.** Alone, two laps: GP 79.34 s vs superbike 82.83 s on `main` (4.2 % quicker); GP 80.74 s now
  (2.5 % quicker). A free GP lap would win the test by 2 s.
* **The GP is held up all race.** Seed 77 trace (with the pass-urgency experiment below switched on, which only makes it
  try harder): GP car 0 behind superbike car 1 at a gap of 30 to 45 m from the first straight, speed equal to the leader's
  to within 1 km/h at every sample, held below its own pace for 13 to 19 s at a time, **20 pass attempts in two laps and 0
  completed** (the aborts it logged were `NOT CLOSING`, `GAP OPENED`, `COVERED` and `NO SAFE LANE`). On plain `main` the
  previous report counted 0 completed passes over 3 seeds and 54 aborts in seed 3303 (30 `NOT CLOSING`, 17 `GAP OPENED`).
  `GAP OPENED` fires at 45 m while the follow reserve is `7 + 0.45 v` = 41 m at 75 m/s, so it is 4 m above the gap the
  planner itself holds; `NOT CLOSING` is judged while the follower is still inside the 3 m follow corridor, speed-limited to
  the leader, for the ~2 s a lane change takes. Both thresholds are speed-independent and read as authored for cars.
* **The GP also lost the start.** On `main` the GP rider eases the lever off at 4 /s and rolls the throttle on at 2.5 /s: 0.5 s
  behind a superbike off the grid (4 s: 59 m vs 69 m).
* Tried and reverted (1.6): a GP standing start as quick as the superbike's; and a pass urgency (a rider held below its own
  pace for 1.5 s discounts passing lanes by 4 points) with a speed-scaled `GAP OPENED` (`37 + 0.45 v`) and a 3 s lane-change
  grace for `NOT CLOSING`, gated to held-up bikes. Seed 3303 went green (82.98 vs 83.19), seeds 77, 101, 202, 303 did not,
  and the seed-77 trace still shows 0 completed passes. That is tuning to the test seed, exactly what the previous report
  warned about.
* Recommended: judge a mixed-class change by completed passes over >= 20 seeds, not by one lap-time assertion; make the
  aborts depend on the follow reserve; give the planner a closing-speed model (the faster follower can pass in the braking
  zone, not on the straight); decide whether a mixed grid should be seeded by class pace (a game-design call).

## 4. Dirt journeys (browser)

Tool: `scripts/studio/tools/journey.mjs` gained `--journey motocross | supercross | rallycross` (`dirtJourney`), a
`drive({ startAuto: true })` option that presses G at the gate, and the AI-stationary check now separates a rider who is
down or remounting (`bikeState > 0`, logged as `ai.rider-down`) from a stuck one (it had reported a fall as "stationary
but not retired"). **What riding on the AI DRIVER proves:** the menu route (DIRT plate -> venue shortcut -> briefing ->
gate), a session that starts and runs, pause/resume, results, exit and a second session. **What it does not prove:** that a
human can steer a dirt bike (inputs, assists, feel). Software GL, 960x540, LOW preset, build from this branch
(`vite build`, `vite preview --port 4221`), one browser at a time. Evidence (JPEG + `result.json` + `progress.log`):
`docs/studio/reports/qa-bikes-2/{motocross,supercross,rallycross}/`.

| Journey | Result | Boot to menu | ENTER to driving | Session 1 | Results | Exit | Session 2 | Console |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `motocross` OUTDOOR MX, Valley Ridge, 4 riders, 3 laps | **completed** | 50.4 s | 104.2 s (loading), first frame 108 s | 20 s ridden at 0.99x real time, pause/resume (37 s with two screenshots), full race to the flag 211 s sim at 1.0x | 4 rows, PADDOCK button | 14.6 s | started in 16.3 s | 0 errors (1 SwiftShader warning) |
| `supercross` STADIUM SX, Arena Nord, 4 riders, 1 lap | **completed** | 93.3 s | 152.9 s | 20 s ridden, pause/resume, flag after 36.5 s sim | 4 rows | 30.3 s | 21.7 s | 0 errors |
| `rallycross` Kestrel RX, RCX-6, 4 cars, 1 lap | **completed** (keyboard 20 s, then off the edge for 10 s at sim 81 s so the AI DRIVER took over, logged) | 110.2 s | 193.3 s | 78 s sim to the flag, `JOKER 0/1` HUD, joker line in the results | 4 rows | 17.4 s | 14.0 s | 0 errors |

Rallycross **is wired** (`kestrel-rx` plate, `rcx6`, joker lap rule). Every table time is a loaded-host upper bound
(software GL, load average 6 to 12), not a hardware claim. I looked at 9 of the shots (MX menu, gate, paused, in flight, results; SX gate and results; RX in flight and results):
no missing models, no black frames, no overlapping text.

### Defects, ranked

| # | Severity | Defect | Evidence | Status |
| --- | --- | --- | --- | --- |
| M1 | major | **Valley Ridge MX: riders stall around station 575-625 on every lap.** In the browser the autopilot player sat at 0 km/h at s 595 (lap 0) and 600 (lap 1): 18 one-second samples of a 211 s race, and it finished last, 18 s behind third and 30 s behind the winner. Headless (`mx.ts` probe, seed 73021, 4 riders, 3 laps): a rider falls at s 586 inside a pass attempt (`ABORT / FOLLOW`, 26 km/h, no input), the field runs under yellow (43 km/h cap) for ~10 s, and cars 0, 1 and 2 each stood 8 to 15 s in the riding / separated / remount states at stations 575-625 over the race. The 8-rider `offroad-races.ts` moto reports a longest stop of 9.4 s (location not checked). | `motocross/result.json` drive rows (`s` 595 and 600 at 0 km/h) | **Open.** Probably a pass attempted on a slow feature at 570-590; not diagnosed to a cause |
| S1 | major | **Arena Nord SX: the same AI rider (car 2) falls in turn one (s 123-145) in both browser sessions.** Session 1: upright, throttle 0.27, speed 0 at s 145 after its fall (wedged); session 2: down (`bikeState` 3) at s 123. The journey flagged both as "stationary but not retired"; the second was a downed rider (tool false positive, fixed: it now logs `ai.rider-down`). Known from the previous report (turn-one pile-up, no recovery for a wedged upright bike). | `supercross/result.json` findings | **Open** (unchanged since qa-bikes-dirt) |
| D1 | minor | Results "BEST LAP" is `--:--.---` for all four riders in the one-lap SX race and for three of four in the one-lap RX race (only a non-joker lap seems to count). | `supercross/07-results.jpg`, `rallycross/07-results.jpg` | Open (cosmetic: show the race lap, label a joker) |
| D2 | minor | The start button reads **ENTER CIRCUIT** on a motocross venue; the pause card shows **TYRES M 100 %** for a dirt bike. | `motocross/03-configured.jpg`, `05-paused.jpg` | Open (copy) |
| D3 | info | The SX first frame (rider on the gate) already shows `DOUBLE YELLOW / Double yellow ahead. Slow right down, no overtaking`: race control treats the idle player at the gate as an obstruction after the drop (headless, no input: flag 3 on the idle player and on the wedged rider by t = 14 s). By design, but a player who waits two seconds at the gate gets a stop message. | `supercross/04-sx-1-first-frame.jpg`; `gate.ts` probe | Observation |
| D4 | info | The player's AI DRIVER is much slower than the field it runs with (MX 3 laps 4:15.9 vs winner 3:45.6; SX 1:34.9 vs 1:17.0; RX 2:19.4 vs 1:08.4): a demonstration driver, not a benchmark. | results screenshots | Not a defect |
| D5 | info | The keyboard driver, tuned for tarmac cars, leaves Kestrel RX gravel after ~60 s (logged, AI DRIVER takes over). A dirt keyboard/lean controller is a tool task, not a game fix. | `rallycross/progress.log` | Tool limit |

Not tested: a human riding a motocross or supercross bike (no controller in the tool), crash/remount from a human fall,
the career entry to the dirt events, replay and photo studio from the dirt results card, any real-GPU number.

## 5. Verification commands (what I ran)

```
# GP sweep, before (a git archive of main in another directory) and after (this worktree), same command:
node --no-warnings --experimental-transform-types scripts/studio/tools/bike-ai-sweep.ts \
     kansai-east,ardennes,montejaral,fiume-verde,arroyo-oro,haarveld,kansai,poggio-alto gpr1 4 3 5000 10 --trace
node --no-warnings --experimental-transform-types scripts/studio/tools/ai-only-race.mjs kansai-east gpr1 4 3 73021   # the D5 reproduction
npx tsc --noEmit
npx eslint src/simulation/ai.ts src/simulation/bike-ai.ts src/core/session-identity.ts \
     tests/gp-ai-braking-plan.test.ts tests/session-identity.test.ts scripts/studio/tools/bike-ai-sweep.ts scripts/studio/tools/journey.mjs
npx vitest run <the 24 files above> --no-file-parallelism
node --experimental-transform-types scripts/bike-race.ts
node --experimental-transform-types scripts/bike-clearance.ts --jobs 1 montejaral
node --experimental-transform-types scripts/wildcard-races.ts knobblies-on-the-banking,red-canyon-scramble,supermoto-after-dark,\
     supermoto-meets-the-joker,supermoto-on-the-roof,grand-prix-bikes-on-the-runway --no-write
OFFROAD_RACE="Valley Ridge motocross moto" node --experimental-transform-types scripts/offroad-races.ts
npx vite build && npx vite preview --port 4221 &
node --no-warnings --experimental-transform-types scripts/studio/tools/journey.mjs --journey motocross|supercross|rallycross \
     --out <dir> --url http://127.0.0.1:4221 --quality low --sim-seconds 20 --second-sim-seconds 10
python3 scripts/studio/tools/journey-evidence.py <dir> docs/studio/reports/qa-bikes-2/<journey>
```

## 6. Not tested, still broken

* `tests/bike-session.test.ts` mixed GP/superbike race: red, margin 0.60 s (section 3).
* Kansai East 5/10 and Fiume Verde 1/10 seeds still have a fall (1.5). Several variants of the fix cleared Kansai East
  but failed an existing contract; I did not trade one for the other.
* Dirt: M1, S1 (section 4). Dirt behaviour was not changed by this branch.
* Not run: the full vitest suite (by instruction), `scripts/bike-clearance.ts` for all circuits (only Montejaral),
  `npm run build` (tsc and `vite build` were run separately, see section 5), any wet-weather GP sweep (the Aurel rain race
  in `scripts/bike-race.ts` passes), real GPU or hardware numbers.

## 7. Recommended next tasks (ranked)

1. **Chicane-before-hairpin lean saturation** (Kansai East 877-891): stop the lane correction from saturating the lean
   intent while the bike is above its plan speed (the lean-intent clamp I tried was the wrong lever: it made the bike run
   wide), or give the plan a roll-rate term so S-bends are planned as a pair; measure on Kansai East x 20 seeds.
2. **Mixed-class passing** (section 3): speed-scaled abort thresholds, closing-speed pass model, class-seeded grids.
3. **M1/S1**: pack behaviour at the Valley Ridge slow feature and Arena Nord turn one; make queue-held riders exempt from
   `MarshalControl`'s obstruction rule and break the stalled-wait cycle (items 3-4 of the previous report).
4. A dirt keyboard/lean controller for `journey.mjs` so MX/SX are human-input end to end.
5. Refresh `docs/bike-clearance.json` (all circuits) and `docs/bike-race.json` on the v20 physics (they are from an older epoch).
