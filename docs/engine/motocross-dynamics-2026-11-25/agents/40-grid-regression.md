# Assignment 40 — continuous front-load recovery in the stadium grid

## Result

**The exact Arena Nord clear seed 60724 regression now passes the unchanged full-race acceptance.** All twelve riders finish their two laps, rider 7 has zero crashes, and the whole field has one allowed `crash-front` by rider 6 near station 474 m. The new finite body motion and every physical force, crash criterion, course, vehicle specification and model remain unchanged by this assignment.

The repair removes one binary front-load eligibility check from the existing supercross shoulder guard. The guard still responds only to its existing predicted outward lane crossing, and its existing pedal authority still varies continuously with measured front support. This avoids disabling recovery simply because a moving rider restores a little more front-wheel load.

| Exact seed 60724 | Original b527 baseline | Integrated source before A40 | After A40 |
| --- | ---: | ---: | ---: |
| Classified riders | 12 | 12 | 12 |
| Total crashes | 0 | 3 | 1 |
| Rider 7 crashes | 0 | 2 | 0 |
| Worst rider's crashes | 0 | 2, failed limit | 1, passed limit |
| Race time | 224.94 s | 224.51 s | 228.85 s |
| Longest stopped interval | 10.90 s | 12.91 s | 10.21 s |
| Existing acceptance | Pass | Fail | Pass |

Assignment 38 supplies the untouched original baseline and initial failure receipts. The A40 result is the unchanged `scripts/offroad-races.ts --mx-full-grid` runner filtered to this exact race. The parked limit remains 20 seconds, and all existing classification, retirement, individual/aggregate crash, holeshot and soil-activity checks remain intact. This is not a claim that the repaired race has no crashes or that the entire eight-race matrix has already been rerun; assignment 52 owns the final matrix after all remaining source changes.

## Diagnosis: a legitimate crash after an avoidable lane departure

The initial crash was physically serious. Rider 7 crossed from the start lane into the adjacent, opposite-facing LANE DOUBLE, then traversed it backwards. Its nearest-course station jumped from about 32 m to 186 m and subsequently decreased. The first launch occurred at 10.825 s with pitch 0.605367 rad. A rear-first impact at 11.766667 s carried roughly 9.97 m/s recorded normal speed; the following rebound had pitch rate −8.462872 rad/s. The eventual nose-first landing at 12.604167 s legitimately triggered the existing crash verdict.

The new ground-body response changed the approach, but a changed trajectory alone does not establish a physics defect. Read-only, in-memory comparisons isolated the following:

| Diagnostic change, not shipped | Observation in the first 18 seconds |
| --- | --- |
| Restore only former ground-body response | First launch exactly matches baseline at 11.041667 s / 0.387285 rad; no first crash |
| Restore former stance/dab response only | Bad approach and nose-first crash remain |
| Restore former airborne body response only | Bad approach remains; a later nose-first crash still occurs |
| Restore endpoint gravity stepping | Bad approach and crash remain |
| Restore sequential suspension stops | Entire observed trajectory is identical to the failing integrated source |
| Permit existing adaptive supported refinement for AI | It still selects one stage here; trajectory is identical |
| Extend the existing rough-section body brace to AI | Its rough-section trigger is absent here; trajectory is identical |

A further diagnostic kept the complete precontact history identical through 11.75 s, then forced 8, 32 or 128 local supported force updates per tick around the rear impact. All three encountered a genuine bottom-out verdict at 11.795833 s, with observed bottoming speeds 7.1805, 7.1755 and 7.1830 m/s. These trials do not establish monotonic convergence or a general numerical error bound. They do show that more contact-force resolution is not a justified way to remove this bad approach: it produces an earlier physical failure instead. No such numerical change was retained.

The useful integration defect was upstream in the AI controller. Its existing supercross shoulder recovery was skipped entirely whenever front load reached 0.38 times vehicle weight. At the outward departure around ten seconds, the original baseline carried about 545 N on the front, below the approximately 663 N gate. The new finite body motion carried about 682 N, which disabled that recovery despite an unsafe outward trajectory. The code already had a continuous support-dependent throttle/brake response inside the guard. The outer load cutoff therefore added a separate on/off discontinuity to a response that was already load aware.

## Accepted change

`src/simulation/offroad/ai.ts` now evaluates the existing geometric shoulder threat regardless of that former front-load cutoff. It retains:

- The supercross, knobby-tyre, AI-solver, minimum-speed and race-phase eligibility.
- The existing outward lateral velocity, remaining lane room and projected-path threat calculation.
- The existing inward steering request and support-scaled throttle/brake formulas.
- All constants, input bounds, physical forces and crash criteria.

There is no new force or artificial trajectory correction. The driver requests the existing steering and pedals earlier in the unsafe departure, while the ordinary physics determines the path.

The in-memory single-change trial kept the new body controller and physical solver intact. Rider 7 remained on the correct start lane: station 36.70 m at 11 seconds, 48.84 m at 12 seconds, and 106.26 m at 18 seconds. No rider fell in that initial window. The original backwards double approach did not occur. The same precise change was then applied to the shared source and passed the complete filtered race above.

## Focused regressions and player isolation

The new `tests/motocross-shoulder-load-continuity.test.ts` runs the actual twelve-rider gate start in both Sport and Raw sessions. AI already uses its assisted driving contract in either session; the repair preserves that behavior.

Each run requires all twelve riders to remain crash-free over the initial 18 seconds, rider 7 to make useful forward progress, and its nearest-course station to remain continuous instead of jumping into the adjacent lane. No route, speed, posture, contact force or AI input is assigned to manufacture the successful approach.

Two isolated controller probes use actual observed poses and original requested controls during the same real trajectory. They change only the observed front load for the probe, then restore the original controller output before any physics advances. The probes stay below the separate heading-recovery branch, so they cannot alter a committed jump plan.

- At a real threatened departure, changing the load from `(0.38 − 0.000001) mg` to `(0.38 + 0.000001) mg` must not produce a control discontinuity. Steering, throttle and brake differences stay below 0.0001, and the loaded-side case still requests recovery.
- While the real rider travels inward on the ordinary start straight, both load observations retain exactly the original controls. The guard does not intervene merely because the wheel is loaded.

Selected integration acceptance passes **7 files / 112 tests**:

| Suite | Passed |
| --- | ---: |
| Motocross AI | 42 |
| Heading guard | 6 |
| Cornering reserve | 3 |
| Forgiving handling, including player full laps | 18 |
| Riding and held-whip momentum | 27 |
| Collision and eight-rider stadium start | 14 |
| New shoulder-load continuity | 2 |

The adapter remains byte-identical to the accepted A36 version. In addition, the complete observer artifacts for both A36 player-solver two-lap programmes were regenerated after the AI repair. **Both files are byte-identical to their pre-repair versions**, including transition records, per-second observations, terminal state and the final 720-substep history:

| Player programme | Two-lap time | Full trace SHA-256, unchanged |
| --- | ---: | --- |
| Valley Ridge | 158.825 s | `7fb640a47f7e2134f02229e011f5a5f3fb71e9de9d74c086af7da9b4ff495d19` |
| Arena Nord | 140.525 s | `7ca694b18cd6418253f891b6e0b80fb2e7a68d2a900838e9568833d491c21ba1` |

This is stronger than comparing only lap time or final crash count. It supports the intended AI-only eligibility change on those exact player programmes, while the final integrated suite covers the wider source combination. Focused ESLint passes. The new test file is formatted with Prettier. A full TypeScript/build/native browser rerun is left to final integration because later assignments still own other source changes.

## Ownership and reproduction

The coordinator granted ownership of `src/simulation/offroad/ai.ts` after the precise load-gate discontinuity was identified. That file has four added lines and one removed line: three rationale-comment lines and the eligibility correction. This assignment also adds the focused test and this report. **`src/simulation/offroad/dirt-bike-vehicle.ts` was never changed by A40.** Both production-file ownerships have been returned to the coordinator. No git commit or push was performed.

Source fingerprints:

- Adapter, before and after: `e04318b7e4c6075d42a6c65cc04664a19e5425e20e50f49a1b1ad4f37084ea17`.
- AI before: `9ba826f4d2b0c42d5f98e175ed58a3bdb47a6bae739d29d9a63e6619f2b3b440`.
- AI after: `c6b3279324d8f52c3d29208e466fb61862d63b800b4c89539f5515ebb3ec1a0e`.

The filtered full race was run from its own scratch directory, so it could not overwrite the initial eight-race failure receipt:

```sh
OFFROAD_RACE='arena-nord-sx clear seed 60724' node --experimental-transform-types /workspace/scratch/e91efca799c8/motobound-engine/scripts/offroad-races.ts --mx-full-grid
```

Focused integration:

```sh
npx vitest run tests/motocross-shoulder-load-continuity.test.ts tests/motocross-ai.test.ts tests/motocross-heading-guard.test.ts tests/motocross-cornering-reserve.test.ts tests/motocross-forgiving-handling.test.ts tests/motocross-riding.test.ts tests/motocross-collision.test.ts
```

Receipts are under `/workspace/scratch/e91efca799c8/validation/a40-grid/`: `probe.mjs`, the diagnostic variant JSON/log files, `adapter-before.ts.txt`, `full-race.log`, `full-race/test-results/motocross-full-grid.json`, `targeted-tests.json`, `targeted-tests.log`, `player-trace.mjs`, both player trace JSON/log files, and `summary.json`. The original baseline and failing traces remain under the A38 receipt paths documented in report 38. No rejected trial changed shared production source, assets, models, environments or acceptance limits.
