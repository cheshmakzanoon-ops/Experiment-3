# Historical GP support and integration acceptance review

Assignment 25, wave 9. This review made **no production physics or controller
edits**. It preserves the current rear-force preview, exact steady front-force
inverse, path-distance correction, path-recovery reserve, physical suspension,
contact ownership, and the separate braking geometry / ordinary-road controller
work. Every experimental controller variant described below was rejected.

At the frozen checkpoint examined here, the original Ardennes seed 1037 GP
hairpin gate remains a release blocker.
Passing an isolated controller invariant does not replace that unchanged race
gate. No grip, rider skill, gain, crash threshold, timeout, or incident allowance
was changed.

## Source boundary

The acceptance snapshot contains 173 TypeScript files under `src/core` and
`src/simulation`. Its sorted path/content SHA-256 manifest is recorded in
`evidence/gp-support-acceptance.json`; the aggregate is:

`b203fd368750f746c659bb8372c115f3b95a6b8450da0ce9a1bc4dde6aedb307`

Important file hashes:

| File                                     | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `src/simulation/bike.ts`                 | `6a997eeb6d8455c1f4ae2ee76e70a9682f09d12c3b676ab839b7695aa60a5c44` |
| `src/simulation/motogp-physics.ts`       | `c571841bfa76e9ab1e10d6d8d320df84b840f075f4f1bc6b9369a499945aac48` |
| `src/simulation/bike-ai.ts`              | `4f9fc34126eb124dc18c57c3cdce7fc04e132c532e2cfb554ce61eab0f542854` |
| `src/simulation/bike-vehicle.ts`         | `9564df64bbb78e53bd8145f44732cdbdfd5b4bc003b98a3c2fedd2c5c200cada` |
| `src/simulation/road-bike-suspension.ts` | `f2a0787ea34795ad4f826cfd8e33c07048e8251651b39052a0806cae835904f1` |
| `src/simulation/contact.ts`              | `004ca3566893be27745e5047b976e57a6f8404e055b8b5baa7c804d2df114db1` |

The GP regions did not change during the diagnostic trials. Assignment 23
separately completed its ordinary-road controller work before this acceptance
snapshot; that work does not explain differences between the GP prototypes.

## Retained-source reproduction

The current source reproduces exactly the assignment 20 rider 1 failure:
Ardennes, seed 1037, four GPR1 riders, 1 lap, 120 Hz world / 240 Hz motorcycle
steps. At **89.508333 s**, the rider falls at **3142.178980 m**. Immediately
before the incident reset:

| Quantity                    |               Value |
| --------------------------- | ------------------: |
| Speed                       |   13.3091430801 m/s |
| Planned speed               |       10.827180 m/s |
| Lean                        |   1.25697327993 rad |
| Roll rate                   | 1.87843575023 rad/s |
| Yaw rate                    | 0.81644775614 rad/s |
| Body lateral speed          |   0.54814012096 m/s |
| Actual lateral acceleration |  12.3082066508 m/s² |
| Requested lateral reserve   |        19.6133 m/s² |
| Combined lean target        |   0.78351561470 rad |

This is unchanged after the separate current-pose braking-capacity correction.
The `beforeFall` object is authoritative for incident state: the ordinary
after-step fields include intentional crash resets.

## The apparent sustained support loss was sampling aliasing

The earlier diagnostic wrote one sample every six world steps, or 20 Hz. Its
1.1–1.7 kN samples suggested that the motorcycle was continuously supported by
much less than its approximately 2.4 kN weight. Logging every suspension step
and all three internal contact evaluations disproved that interpretation.

Between 88 and 89.5 seconds, 358 suspension steps produced these means:

| Contact evaluation within a step | Mean total normal force |
| -------------------------------- | ----------------------: |
| Initial                          |           2381.681373 N |
| Midpoint                         |           2383.227707 N |
| Final                            |           2384.801089 N |

External vertical velocity changes were exactly zero throughout this window.
The measured heave velocity change was −0.14970731488043554 m/s. Integrating
the solver's actual normal, gravity and downforce accelerations independently
gave −0.14970731488043573 m/s.

Support has substantial short fluctuations. For example, around station 3125
the initial force rises from 1803.932 N to 2690.407 N, 2963.498 N, 3641.564 N
and 4100.028 N over five successive 1/240 s intervals. The contact height
derivatives change at the same time. These are not proof of sustained crest
unloading. A speed margin that holds the low 20 Hz support sample throughout
the planning horizon would have been based on the wrong diagnosis.

The detailed trace records the exact front/rear start and predicted heights,
contact arguments, internal loads, body heave, pitch and zero external impulse
for follow-up. The adapter currently predicts the next wheel-sample positions
by translating each current contact point by chassis planar velocity; it does
not rotate the front/rear moment arms through the interval's yaw. That is a
specific untested integration lead. This review did not change those samples
or establish that adding wheel-arm yaw closes the race failure.

For 357 consecutive intervals in this window, predicted next height minus the
following actual contact sample has a front RMS error of **0.036823 mm** and
maximum absolute error of **0.082061 mm**; rear values are **0.016097 mm** and
**0.036610 mm**. Their RMS vertical-rate errors are 0.008838 and 0.003863 m/s.
This quantifies the observed prediction mismatch; its small size is not proof
that it causes the much larger normal-force fluctuations.

## Rejected controller experiments

All experiments were runtime wrappers in scratch scripts. The production
forward tyre law, suspension, collision geometry and acceptance assertions
were unchanged. Each race trial was stopped at 110 simulation seconds to
inspect the original hairpin, so these trial summaries are not full race or
cooldown certifications.

| Trial                                                                                                                               | Hairpin outcome by 110 s                                | Decision         |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------- |
| Retained source                                                                                                                     | Rider 1 falls at 3142.178980 m                          | Baseline blocker |
| Replace preceding measured lateral acceleration with exact current-contact forward preview at existing bars and preceding Fx        | 3 falls                                                 | Rejected         |
| Preserve AI requested lateral acceleration and reinterpret its lean against each current 240 Hz support sample, starting after 80 s | Rider 1 falls at 3138.368480 m                          | Rejected         |
| Reserve finite rate-loop travel in tracking error and stopping energy, starting after 80 s                                          | Original rider 1 clears; rider 3 falls at 3164.753309 m | Rejected         |
| Same rate-response preview from the start                                                                                           | Rider 0 falls at 3160.270702 m                          | Rejected         |
| Reserve finite rate-loop travel only in stopping energy; preserve tracking error                                                    | 2 falls                                                 | Rejected         |

### Current-force preview

At the original fall, the preceding measured lateral acceleration was
11.1342251777 m/s², while the exact current-contact preview at existing bars
was 12.6359938697 m/s². The temporal mismatch exists. Replacing only that input
in the lag predictor nevertheless regressed the race, so its existence is not
sufficient evidence for that proposed fix. The preview used an independent
chassis copy and did not advance production tyre, wheel, heat or pose state.

### Rate-loop response distance

For the existing rate controller `omega' = rateGain * (omegaCommand - omega)`,
a zero-rate command still travels `omega / rateGain` as its exponential
response decays. This is distinct from the retained 60 ms tyre-force preview.
With held feasible full intent, the original GP assist fell in three isolated
zero-damping fixtures: full static support, 18% front support and 18% rear
support. Reserving response distance derived from the existing rate gain
prevented all three falls, and retained riding for the corresponding authored
0.6 and 1.2 damping cases.

That mathematical fixture did not establish a safe race improvement. Both
ways of inserting the reserve still failed the original hairpin gate, so
neither is present in production. Sign reversals, low-speed exits, changing
support, and the entire path/steering interaction need a coherent solution.
The isolated no-crash result must not be cited as final acceptance.

## Acceptance and handoff

The unchanged complete 14-test `bike-session` and 9-test
`gp-ai-braking-plan` suites completed on the manifest above. All 173 source
hashes remained unchanged after the run. **21 tests passed and 2 failed**:

| Suite                | Result              | Failure                                                                               |
| -------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| `gp-ai-braking-plan` | 8 passed, 1 failed  | Rider 1 falls at 3142.178980299498 m in the original Ardennes 1037 hairpin window     |
| `bike-session`       | 13 passed, 1 failed | Mixed Vellamar GP best lap 92.13344943086413 s is slower than SBK 90.72731608645105 s |

All three full cooldown cases passed. In the mixed race, the preceding
completion, bounded incidents, rider classification and stationary-time
assertions passed before the pace assertion failed. This does not assert zero
mixed-race incidents. The mixed result includes assignment 23's final
ordinary-road changes; prior faster GP/SBK ordering from the earlier rear-only
checkpoint does not substitute for this combined result.

Vitest also reported an unhandled worker RPC timeout calling `onTaskUpdate`.
The process exited 1 after 121.98 seconds; the entire invocation is recorded as
failed, with the reported harness error retained alongside both substantive
assertion failures.

The frozen snapshot separately passed **37/37 focused tests in 7 files**:
current rear-contact preview, steady front inverse, paired contact momentum,
contact reaction, path reaction, shared steering/braking preview, and path
recovery force budgeting. The run exited 0. These force and controller
contracts are useful independent evidence; they do not erase either full-race
failure.

The original 19-scenario `scripts/bike-race.ts` sweep ran from
`/workspace/scratch/d611aefdb08c/w09-acceptance-baseline`, an immutable copy
matching this source manifest. The coordinator stopped this already failing
historical run after assignment 27 found a separate, physically justified
force-history candidate, so the next complete acceptance run could use that
corrected frozen source. **This baseline run terminated with exit 130 after
6 of 19 scenarios. It is incomplete and is not a matrix pass.** The original
19-scenario gate remains required; no assertion or allowance was relaxed.

The six emitted rows establish the following observations:

| Scenario                                    | Race finished | Total crashes | Best lap, rounded |
| ------------------------------------------- | ------------- | ------------: | ----------------: |
| Aurel, GPR1, clear, seed 3303               | Yes           |             0 |           66.08 s |
| Vellamar, SBK, clear, seed 77               | Yes           |             1 |           88.63 s |
| Aurel, mixed GP/SBK, rain, seed 2024        | Yes           |             0 |           86.37 s |
| Vellamar, mixed GPR1/GPR2, clear, seed 8624 | Yes           |         **7** |           86.26 s |
| Aurel, SS600, clear, seed 8725              | Yes           |             1 |           69.76 s |
| Vellamar, CR750, clear, seed 8826           | Yes           |             0 |          104.37 s |

The mixed GPR1/GPR2 row exceeds the unchanged maximum of six crashes; its
per-rider counts are `[0, 1, 0, 0, 0, 3, 2, 1]`. The script writes its full JSON
and accumulated classification/stationary-time failures only after all races,
so those outputs were not produced before termination. The displayed finish
and incident observations must not be expanded into a claim that every gate
for those six rows passed. The repository's existing `docs/bike-race.json`
was not replaced by this partial run.

Primary scratch evidence, all under `/workspace/scratch/d611aefdb08c/`:

- `w09-current-1037.trace` and `.events`: retained-source reproduction.
- `w09-support-detail.trace` and `.events`: 240 Hz support and internal-contact
  values, including the independent heave impulse accounting.
- `w09-shadow-baseline.trace` and `.events`: unchanged plant with a read-only
  current-force shadow, useful for force-state comparisons.
- `w09-shadow-preview`, `w09-ai-reaction-local`, `w09-response-local`,
  `w09-response-full`, and `w09-energy-full` trace/event pairs: rejected trials.
- `w09-gp-rate-response.mjs` and `w09-energy-fixture.log`: isolated rate-response
  investigation; these scripts are not production modules or acceptance tests.
- `w09-acceptance-source.json`: full source manifest.
- `w09-full-acceptance.log`: complete unchanged suite output.
- `w09-force-invariants.log`: 37 passing focused regressions on the frozen
  baseline.
- `w09-road-race-matrix.log`: six completed rows of the terminated historical
  sweep; no final `bike-race.json` was produced.

Compact source hashes, exact before-fall states and high-rate statistics are
also retained in `evidence/gp-support-acceptance.json`. The next integration
review should use the frozen production source and the 240 Hz contact evidence,
not promote any of the rejected trial wrappers.

Assignment 27 owns the later force-history correction and its final release
verification. Results from that later source must be recorded separately;
neither its candidate improvement nor this baseline's failures are evidence
about an untested intermediate source.
