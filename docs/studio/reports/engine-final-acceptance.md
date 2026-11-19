# Final engine acceptance — assignment 29, wave 10

## Source and current status

The first frozen-candidate acceptance used a detached checkout of local commit `e1c34e2500980129b5edbf4f9a39f880b7f2ad10`. The coordinator published the identical application and tests as [`70822afe3079db4d1daf71dba89a216b8eaee330`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/70822afe3079db4d1daf71dba89a216b8eaee330), preserving intervening automatic CI reports. Its 173 TypeScript files under `src/core` and `src/simulation` have aggregate SHA-256 `977cec4cf15dcebc94c8c9f2d14bf15b45a5a6093dd1ef17b950cf6f09bfdcea`.

**The first GP calibration passes. The first complete original race matrix fails two of 19 scenarios; final engine acceptance remains pending the combined engine corrections and full rerun.** No complete release pass is claimed by this interim report. The first source used simulation identity 26 and snapshot protocol 17. The coordinator subsequently advanced simulation identity to 27 and is preparing identity 28 for the additional GP corrections; the earlier measurements below are not relabeled as a pass on either newer source. The snapshot protocol remains 17.

| Acceptance | Status |
| --- | --- |
| Original 19-scenario motorcycle race matrix | Completed with exit 1: 17 pass, Vellamar GP sprint and Arroyo SBK incident limits fail |
| Original strict GPR1/GPR2 calibration at both timesteps | Passed: 8 metric pairs, 16 individual band checks; source guard exit 0 |
| Supplemental full-precision GP measurements and crash counts | Passed; zero crashes in all four two-rate measurement runs; source guard exit 0 |
| Complete `npm test`, including original pretest | Held for genuine engine corrections; original CI failures retained |
| Application source stability | Enforced for each invocation; final comparison pending |

The race matrix imports the original, unmodified `scripts/bike-race.ts` through a small external wrapper. Only the child working directory changes, so its intended `docs/bike-race.json` output is written outside the immutable checkout. The original source-stability guard still protects every checkout input, including its documentation. No scenario, assertion, incident limit or deadline is filtered or changed.

## Fixture compatibility correction

The older `gp-contact-effects.test.ts` analytic road fixture implemented `sample` and `nearest` but omitted the real track's `cast` capability. The new production road adapter performs a vertical cast before its analytic fallback. The unchanged fixture therefore failed 16 of 17 cases with `track.cast is not a function`, before the relevant geometry or particle assertions ran.

The fixture now supplies the same analytic plane through a finite vertical cast and its matching normal. All existing assertions remain intact. **17/17 cases pass**, including the real GP practice trail and unchanged Formula, touring-car, superbike and motocross particle attributes. Scoped ESLint and Prettier pass.

Other partial track fixtures were inspected. The motocross sprung-pose fixture uses the separate dirt-bike sampling adapter; the continuous-collision fixture does not invoke road placement/stepping; corner-practice fixtures only expose the station geometry they exercise. They do not need fabricated road casts.

## Test-worker acknowledgement correction

The corrected GP plant passed all 102 test cases in its initial 11-file integration run, but that invocation still exited 1 because Vitest reported `Timeout calling "onTaskUpdate"`. It is retained as a failed invocation, not relabeled as passing.

The installed Vitest 3.2.4 runner sends throttled task-update RPCs during each case and does not await the accumulated acknowledgements until file completion. Its bundled RPC implementation has a 60-second deadline. A file containing consecutive synchronous simulations can starve the worker's event-loop callbacks across that deadline even though every individual case completes within its original limit.

An isolated experiment retained every test body and added a real `node:timers/promises.setImmediate` yield in `afterEach`. All nine GP braking-plan cases then passed with **exit 0**, no RPC errors, **78.54 seconds of test execution and 80.79 seconds overall**. The previous failing-report file took 77.67 seconds; the clean exit was not caused by a shorter test workload.

The production test change is scoped to `tests/gp-ai-braking-plan.test.ts`: an import, explanatory comment and the `afterEach` yield. Simulation loops, assertions, seeds, per-case deadlines and RPC error reporting remain unchanged. No global timeout or error suppression was added. Scoped ESLint, Prettier, TypeScript and diff checks pass.

## First frozen-candidate GP calibration

The unchanged strict CLI passes all eight GP metric pairs at 1/240 and 1/120 second, or sixteen individual band checks. A supplementary collector calls the same original `measureBike` functions and authored `BIKE_TARGETS`, preserves full precision, and additionally requires zero crashes. It also exits 0, with zero crashes in all four measurement runs.

| Vehicle | 0–100 km/h, s | Top speed, km/h | 100–0 km/h, m | Lateral acceleration, g |
| --- | ---: | ---: | ---: | ---: |
| GP-R1 | 3.029167 / 3.025000 | 353.678380 / 353.669889 | 38.641593 / 38.686482 | 1.452631 / 1.452639 |
| GP-R2 | 3.070833 / 3.066667 | 342.507228 / 342.526319 | 36.821233 / 36.856554 | 1.455471 / 1.455446 |

Each cell lists 1/240 / 1/120. At that source, the catalogue result retained the previously accepted 48 cars and seven other motorcycles from [assignment 23](engine-advancement-calibration.md), then replaced the two GP measurements with this rerun: **57 vehicles, 228 passing metric pairs, 456 band checks**. The complete registry was not rerun after the GP-only force-history correction. That correction changed the opt-in MotoGP chassis; four-wheel and non-GP force paths were unchanged. Subsequent road-controller and GP corrections require fresh affected-vehicle acceptance before the final result can be claimed.

## Interrupted first matrix invocation

The first final-source matrix invocation was interrupted during the agent's run. On resumption, the execution session was unavailable; its log had not changed since 07:19:13 UTC and the original script had not produced its final JSON. Five scenarios had printed completion observations, including the formerly failing seed 8624 with five crashes. Those observations are not treated as complete scenario acceptance because classification and stopped-time assertions are accumulated in the final JSON. The invocation is **incomplete, with no available exit code**. The complete original 19-scenario restart described below finished without filtering.

## Complete original matrix: two failures

The unmodified 19-scenario script completed in 900.283 seconds with exit 1. Every race finished and all 158 entrants were classified. The longest stopped interval was 11.375 seconds, below the unchanged 20-second limit. The two failures are the unchanged per-scenario incident limit of six:

| Scenario | Actual crashes | Original limit |
| --- | ---: | ---: |
| Vellamar GP motorcycle sprint, seed 3303, four laps | 8 | 6 |
| Arroyo Oro superbike, seed 30106, five laps | 29 | 6 |

The other 17 scenarios pass. No application-input rewrite was reported by the source guard. The machine-readable report retains the full original scenario output, receipt, source identity and log/result hashes. This failed acceptance is preserved while the narrow corrections are developed.

### Arroyo incident classification

A read-only observer reran the exact eight-SBK event and reproduced the same per-rider crash array `[6,5,2,5,1,4,5,1]`, all eight classified, in 588.088 race seconds. All 29 prefall impact values were zero. Stack traces identify 21 roll-limit exits, five front-force-use exits and three suspension-pitch exits. Twenty-eight incidents cluster between stations 2570.77 and 2619.50 across the five laps; the early outlier is rider 0 at station 427.37.

The first recurring incident has an earlier support-loss precursor: the saved 1.5-second approach already begins with zero rear load and an 8.85 cm rear gap at station 2555, before alternating axle support and growing roll. Some later falls occur with both contacts loaded and three roll falls have zero total load, so this is not uniformly a loaded-contact failure. Assignment 23's subsequent [support-admission correction](arroyo-road-support-admission.md) passes the unchanged original Arroyo event with zero falls and all eight classified in 495.871 seconds. Assignment 27's independent [Vellamar profile correction](../../VELLAMAR_PROFILE_CONTINUITY.md) takes the original sprint from eight falls to zero. These focused results do not replace the required final combined 19-scenario run.

## Completed prior full-unit invocation

The complete CI invocation on `8763bfc8e1a811abc93a546d5f8f3179965b4547` finished with **exit 1: 680 of 687 files and 6,684 of 6,692 tests passed**, in 2,133.48 seconds. Its eight failed assertions remain in the retained full log. The coordinator's three proven fixture corrections and the later engine corrections do not retroactively change that result. The normalized complete log and its SHA-256 are referenced in the machine-readable report.

The coordinator subsequently received a complete invocation on `b7540527d9abdfba406aa442bfe9b0a9e372447d`: **exit 1, 688 of 691 files and 6,731 of 6,734 tests passed**, in 2,184.11 seconds, including the original pretest and source guard. The remaining failures are mixed GP/superbike race pace, wet Poggio GP contact, and the historical Vellamar broadcast-control fixture. All six mixed-passing cases pass on this source. Its [complete receipt](evidence/graphics-engine-advancement/unit-b754052-complete.json) and full normalized log are retained; assignment 29 independently verifies the log's 225,448 bytes and SHA-256 `290f63473da468cd63df6bb1e9dda6f72d2b3880c65b3c7d02005526e8fd3d4e`. This later historical result remains separate from the required final-source full-suite gate.

## Motocross player-input fixture correction

The original `motocross-forgiving-handling.test.ts` passed 17 of 18 cases on the first candidate. The Valley Ridge ridden lap fell once at 56.408 seconds, station 561.368, whereas the historical `39fdc61` source passed all 18. A higher-rate observer found a wall impact at station 542.554 before the eventual roll-limit exit. The crash label was `grip-lowside`, but the actual exit occurred at the gross roll limit with zero accumulated grip-overload grace. The recorded tyre temperatures and grip factors did not identify overheating as the cause.

The ridden fixture withheld `aiControlled()` so that it would exercise the player's actual contact and flight solver, but continued to send the ground route planner's controls during flight. Those controls have different meanings for a player: lateral lane correction becomes bank/whip input, and a ground front-brake request becomes nose-down wheel-braking torque. Production AI flight already ignores the ground front brake, requests no whip, and owns its separate predicted-landing rear-wheel control. The fixture therefore needed an explicit player input adapter.

The correction is confined to the fixture. The course planner still drives every supported approach. While already airborne, the fixture releases steer and front brake, as a player riding straight would; throttle, rear brake, the normal Sport body aid and all physical states remain untouched. The AI mark is still withheld. New assertions verify that the player solver remains active and that each completed run actually enters flight. Both courses, seed 61007, the two-lap requirement, the 260-second horizon, the zero-fall assertions and the less-than-one-second stall limit remain unchanged.

**All 45 tests in the forgiving-handling, riding and independently sampled tyre-contact files pass with source guard exit 0.** The existing manual-air-control tests still demonstrate that intentional brake taps lower the nose, left/right player inputs bank the bike, held whips can have landing consequences, and release can recover a whip. Scoped lint, Prettier and full TypeScript checks pass. Production `offroad/ai.ts` and `offroad/dirt-bike-vehicle.ts` remain byte-identical to the first frozen candidate; no rejected AI speed, grip or steering experiment was integrated.

An independent trace confirms identical position, velocity, attitude and wheel spins at the first takeoff. At the first landing both runs retain the same wheel spins, while the original ground steering command is still -0.914 and has introduced a heading change through the player whip semantics. Neutral player steering retains the ballistic heading. The complete corrected Valley run takes 162.792 seconds with zero falls. It still makes rough-corridor wall contacts, so this fixture repair is not evidence that the production route planner's wall-contact behavior has improved. The compact proof and rejected-experiment ledger are retained in [the MX evidence](evidence/engine-final-acceptance/mx-player-input-contract.json).

## Final evidence

The remaining Vellamar seed-5222 mixed-grid launch failure was independently classified on assignment 27's supported-contact scratch candidate. GP-R1 rider 2 first reaches the kerb at 6.650 racing seconds, then falls at the roll limit at 7.525 seconds, station 123.517, without an external collision. A bounded observer reproduces the exact fall time, station, lean and roll rate. Before the kerb, actual front force mostly follows its command; the mean absolute tracking error is 16.37 N over the decisive interval. The route planner deliberately requests near-zero and then negative lateral acceleration while its preview point is clamped to the left lane edge. It reconstructs a relative offset from that clipped point while retaining the raw racing-line heading/slope. The [compact diagnosis](evidence/engine-final-acceptance/gp-5222-route-diagnosis.json) records the actual geometry, forces, source hashes and an independent selected-path invariant proposal. Route correction ownership has returned to assignment 27; this diagnosis is not an accepted production fix.

### Selected-route geometry review

Assignment 27's first bounded-route candidate clears the original seed-5222 launch and complete mixed-passing case, but its mixed-race GP pace regresses to 109.866 seconds against the superbike's 89.753. An independent geometry-only benchmark identifies a separate sampling defect: recomputing curvature with moving two-metre chords changes the native solved racing line even when the selected route has not changed. Among 7,836 exactly unchanged Vellamar path samples, the mean absolute curvature error is 0.0007993 inverse metres and the maximum is 0.0191665. On sections whose native curvature magnitude is at least 0.002, the median relative error is 15.69%, with 53 sign reversals. Reconstructing and interpolating on the original 4.00127-metre solution grid reduces the maximum difference to 0.0000000619, consistent with reconstructing stored Float32 offsets. This comparison proves that the moving stencil changes an otherwise unchanged line; it does not establish that every clipped pursuit target should define new global curvature.

The subsequent grid candidate does preserve that native curvature contract, but its existing launch trace still fails at 9.075 seconds, station 148.641. This is a supported asphalt roll-limit exit after braking and load-transfer yaw oscillations, with no airborne samples in its retained eight-second history. It differs from the original kerb departure. Both global-curvature candidates remain rejected. The parent planner bounds a local pursuit target; it does not author a globally kinked racing line. The narrower candidate therefore retains the solved feed-forward and existing approach curvature, exposes the original tactical and launch displacement, and uses the bounded local target consistently for position and heading feedback. Its original race gates remain pending. The [read-only review evidence](evidence/engine-final-acceptance/gp-selected-route-review.json) records source hashes, exact numerical comparisons, rejected candidate results and the specific trace limitations. No shared production code was changed during this review.

### Same-step GP force ownership

The current investigation returns to the unchanged `b754052` engine, with all 173 archived engine source files independently verified against that commit. The earlier admission, reserve and route experiments are not carried into this candidate. Assignment 27 demonstrates that the front steering inverse and rear-force preview run before the current brake/traction controls resolve their final longitudinal forces. In a zero-to-0.6 front-lever step they see zero longitudinal force, while the same tyre step receives -1,797.174 N at the front and -279.613 N at the rear. A mirrored, independent steady-force round trip requests ±500 N: the stale-force inverse delivers approximately ±449.558 N, while the current-force inverse delivers ±499.99985 N. The probe explicitly separates the fresh carcass's known relaxation factor; it does not claim instantaneous physical force response.

The isolated source correction plans the roll request and pedal reserve once, resolves the existing TC/ABS forces once, then solves the steering inverse using those final forces and the same speed as the tyre plant. The steering actuator and physical contact history advance once. Independent review confirms the runtime observer's reconstruction of the original requested acceleration and finds no new algebraic loop. A partial-contact edge mismatch found during review is corrected: the helper and plant now share the exact same front-contact multiplier. The new phase tests and original inverse, current-contact, relaxation and momentum tests pass **44 cases in five files**, including the new partial-support and one-actuator-step regressions.

The runtime-only counterfactual meets the original mixed-race outcome limits: GP best lap 87.428 seconds versus superbike 90.542, all six classified, two falls within the original limit of three and a maximum stopped interval of 6.95 seconds. However, the isolated production phase-only implementation fails the original mixed test: **GP 90.458371 seconds versus superbike 89.979548**. Its outcome is authoritative. Wet Poggio also still has one rider-6 roll-limit exit. No production race pass is attributed to the runtime counterfactual.

An independent bounded comparison explains why those implementations are not interchangeable as acceptance evidence. The exact wrapper and typed implementation first differ by 0.0000000000000568 N in the inverse request because they group floating-point yaw arithmetic differently. Their slow/fast steering interpolation also uses algebraically equivalent expressions with different rounding. Aligning only those scratch-wrapper expressions to the original typed arithmetic keeps the tracked physical state and plant inputs identical until 6.857533 racing seconds. At that step the front contact is absent and both inverse calls return null: the wrapper retains its earlier fallback steer, while the typed implementation evaluates the same fallback at the current plant speed. The observed bar-angle difference is 0.00000002883 radians. This is a concrete phase-semantic difference in the wrapper. It is not a reason to copy the wrapper's fallback or choose a more favorable floating-point grouping. Three comparisons each end after 12.0075 racing seconds, each covering 12,804 paired GP substeps with unchanged source; no complete race was duplicated by assignment 29. The [force-phase review](evidence/engine-final-acceptance/gp-force-phase-review.json) retains exact source hashes, the numerical probe, full paired observations, original failed production gate and remaining limitations.

### Remaining pace gate: sampled lap comparison

A later isolated minimal candidate completes the original mixed race with all six classified and zero falls, but its fastest GP lap of 90.432651 seconds leads the superbike's 90.481353 by only **0.048701 seconds**, below the unchanged requirement of more than 0.15. Assignment 29 compares existing observation-only traces without rerunning the race. Relative to the earlier reaction candidate's fastest GP lap, about 0.52 seconds of the 1.07335-second loss lies between stations 3200 and 3300. That interval has no braking or active traffic speed cap, but larger tracking corrections and reduced applied drive. Other losses between stations 2500 and 2800 coincide with explicit traffic caps and do not support a physical grip increase.

The recorded lane state rules out reusing the earlier clipped-preview explanation for the late-lap loss. All 18 samples in the 3200–3300 interval keep the selected local target within the parent planner's reach; the original tactical displacement ranges from -0.2095 to -0.0706 metres. Saved and reconstructed targets differ by at most 0.0204 metres, including the observation/update phase offset. The actual lean/course oscillates around a valid changing target. Rear-force preview equals actual rear force at every sampled point of the fastest GP lap. The [pace review](evidence/engine-final-acceptance/gp-phase-pace-review.json) records these negative controls, force observations and interpolation limits. It does not establish a new front-force defect or justify changing controller gains, grip or the race margin.

Final full-unit acceptance remains pending the actual corrections. After the combined source freeze, assignment 29 runs the complete original race matrix and strict GP calibration locally. The coordinator's unfiltered CI `npm test`, including its original pretest and source guard, supplies the full-suite gate when its complete log and exit receipt are available; a redundant full local invocation is unnecessary. The complete failed matrix above, interrupted first attempt and diagnostic counterfactuals remain distinct from any future final-source pass.
