# Arroyo Oro: transient road-bike support admission

## Outcome

The original **Arroyo Oro Superbike event passes with all eight riders classified, zero falls, zero incidents and zero penalties**. It finishes in **495.871027503 seconds**, compared with the unchanged baseline's **588.087694169 seconds and 29 falls**. The longest stopped interval is **0.400 seconds**, below the original 20-second limit. This is the same five-lap event, clear weather, seed 30106, eight SBK-1000s, medium tyres, Sport assistance, default setup and player autopilot. The original script retains its 1/120-second world tick, 1/240-second physics substep, 1,200-second deadline and maximum-six-crash acceptance limit.

This follow-up reopens assignment 23; it does not add another agent assignment. The road-only correction changes controller admission, not measured support or tyre-force capacity. Four affected motorcycle definitions pass all **16 metric pairs / 32 individual design-band checks** at both rates, with **zero crashes in all eight measurements**. All 32 measured values are bit-identical to the earlier calibration report. The focused suite passes **88 tests in five files**, including 11 new regression and reset tests; targeted ESLint passes.

Numerical values, full source hashes, the original event result, rejected hypotheses and negative controls are retained in [arroyo-road-support-admission.json](evidence/arroyo-road-support-admission.json). The prior 57-vehicle calibration remains historical evidence in [engine-advancement-calibration.md](engine-advancement-calibration.md). This follow-up reran the four affected ordinary road bikes; it does not claim a new complete 57-vehicle or 19-race run.

## Observed failure mechanism

The unmodified event originally recorded crashes `[6,5,2,5,1,4,5,1]`. All 29 had zero collision impact at the exit; 28 clustered around stations 2570.77–2619.50 through the crest and descending chicane. Twenty-one were roll-limit exits, five were front-use exits, and three were suspension pitch exits. A tyre being loaded at the final fall did not establish continuous support through the approach.

A non-mutating 240 Hz trace located rider 1's first rear-support loss at **station 2506.647, time 74.200 s**, before its fall at station 2598.765. Around the descending transition, short normal-load peaks repeatedly restored apparent lateral capacity, then disappeared before the rider's finite roll response could complete. At station 2585 the instantaneous lateral capacity was about 13.23 m/s²; intervening low-support samples reduced it to 0–3 m/s² while roll momentum continued increasing. The controller had used the peaks to admit additional lean and to estimate the energy available to stop that roll.

Current versus previously predicted cast heights were continuous to less than 0.154 mm at the front and 0.101 mm at the rear in this traced approach. This was not the separate Vellamar authored-profile discontinuity. No Arroyo road geometry was changed.

Read-only/scratch isolations tested the obvious alternatives first: actual-reaction rear-lift capacity, crest-aware corner/brake planning, path-recovery reservation, and current-load incremental ABS. Each still produced the recurring fall, including attempts that reduced entry speed by approximately 3 m/s. None of those candidate changes was retained. Their failure made a slower target alone insufficient evidence of a correction.

## Controller contract

The physical solver still publishes and uses its current front and rear normal loads unchanged. `roadLateralCapacity` still derives the available lateral acceleration from each actual tyre circle, its friction and the existing camber response. Actual force, force-use telemetry, heave, pitch, yaw, tyre heating and the available force for arresting an existing roll are not smoothed.

A separate private **admitted capacity** controls whether the rider can start or continue a new roll manoeuvre. A loss of capacity is admitted immediately. An increase becomes available over the existing roll-rate tracker's response time:

```text
C_admitted = min(C_actual,
    C_previous + (C_actual - C_previous) * (1 - exp(-rateGain * dt)))
response time = 1 / rateGain = 1 / 9 seconds
```

No new response gain is fitted. The admitted capacity limits the physical target and the stopping-energy reference. The final force demand can still spend the full current recovery budget to arrest an existing roll. This distinction is covered by a landing regression that measures actual lateral force greater than the newly admitted capacity while both actual friction circles remain respected.

The authored nominal 72% lean scale, 96% recovery budget, 10% target headroom, roll gain, rate gain, stopping share, damping, tyre friction, engine/brake hardware and handling bands retain their values. This is a controller admission policy for transient support; it is not a claim that the original tyre force law was wrong.

Both-contact flight sets admission to zero and still applies zero tyre force. Returning contact must earn its new manoeuvre capacity. Explicit placement, free placement, completed remount and leaving the optional road-contact path clear old admission. Initial stable support initializes from its actual capacity. The GP controller and standalone/MX force arithmetic are outside this road-only branch.

## Regression evidence

The independent periodic-contact fixture uses a front contact that is absent for the first fifth of each 100, 200 or 300 ms cycle, then carries 1.5 times static front load; the rear carries its static load. This reproduces the short loss/peak pattern without AI, road geometry or race interactions. It uses full lean/rider input at 30 m/s, no drive or brake, and the existing damping and steering rate.

At both 1/240 and 1/120 seconds, the original instantaneous-admission controller falls in all six cases after **1.61–1.83 seconds**. The corrected controller survives every case for eight seconds, respects actual contact circles and retains the nominal input scale. After four seconds of stable support it recovers the unchanged full-stick lean. Additional tests cover immediate support loss, zero-force flight, retained arrest authority, identical reconstruction from the same fixed-step history, both explicit placement paths, remount and optional-contact exit.

### Affected-machine calibration

Each cell lists **1/240 s / 1/120 s**. These are the unchanged production measurement functions and target bands. The evidence collector additionally checks crash counts, which the original strict CLI does not itself assert.

| Vehicle |      0–100 km/h (s) |        Top speed (km/h) |        100–0 km/h (m) | Lateral acceleration (g) | Crashes |
| ------- | ------------------: | ----------------------: | --------------------: | -----------------------: | ------: |
| sbk1000 | 3.162500 / 3.158333 | 307.634393 / 307.610070 | 41.122867 / 41.100417 |      1.198611 / 1.198611 |   0 / 0 |
| ss600   | 3.479167 / 3.475000 | 265.339047 / 265.328871 | 40.496489 / 40.497327 |      1.147285 / 1.147283 |   0 / 0 |
| nr900   | 3.345833 / 3.341667 | 224.341986 / 224.341140 | 43.714149 / 43.607807 |      0.946472 / 0.946471 |   0 / 0 |
| cr750   | 4.212500 / 4.208333 | 236.984622 / 236.985694 | 49.524769 / 49.509528 |      0.911603 / 0.911602 |   0 / 0 |

Every number above is bit-identical to the corresponding value in the earlier assignment-23 calibration evidence. This directly checks that a transient admission policy has not reduced stable calibrated capability or changed straight-line braking and acceleration.

## Reproduction and source identity

```sh
node --experimental-transform-types scripts/vehicle-calibration.ts --strict --only=sbk1000,ss600,nr900,cr750
./node_modules/.bin/vitest run tests/road-bike-transient-support.test.ts tests/road-bike-intent-capacity.test.ts tests/road-bike-braking-geometry.test.ts tests/road-bike-suspension.test.ts tests/road-bike-low-speed.test.ts
node --experimental-transform-types scripts/bike-race.ts
```

For the bounded original-event run, the scratch harness copied `scripts/bike-race.ts`, resolved its imports to the production checkout, and changed only the race selection to `races.filter((race) => race.event === 'arroyo-oro-superbike')`. All original assertions and limits stayed intact. It wrote into a scratch `docs` directory; the committed full-matrix report was not overwritten.

The immutable calibration snapshot is based on commit `e58013100565cdad93c0806d9da569720405e170` plus this road correction. Its engine aggregate is **`1320fbc5c055ab40e1ac4e40330b22c78f46b5ce4138c23e03d9ce33c2663608`**. The JSON includes every constituent source hash and the aggregate algorithm. The original-event process began before a formatting-only line wrap; its executable road-controller code is identical to the formatted snapshot.

| Frozen road source                       | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `src/simulation/bike.ts`                 | `5bf7c5903f4b33ae306eedffc72e23f58ef85c4b5841f2a86153d80918102d9a` |
| `src/simulation/bike-vehicle.ts`         | `e9c829ad70fa04396f14b065f39366bbc008c787493672619342967a8b8aa2b5` |
| `src/simulation/road-bike-suspension.ts` | `f2a0787ea34795ad4f826cfd8e33c07048e8251651b39052a0806cae835904f1` |

This snapshot precedes assignment 27's separately owned GP-only correction. Assignment 29 owns the final combined source freeze, complete original race matrix and full integration acceptance. The reduced road model still has kinematic lateral/yaw approximations and point-supported heave/pitch; these checks do not certify complete spatial motorcycle dynamics or console rendering performance.
