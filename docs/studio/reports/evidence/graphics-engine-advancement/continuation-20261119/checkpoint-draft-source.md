# Resumed graphics and engine acceptance

## Source and disposition

This continuation resumes the completed thirty-assignment implementation. It preserves remote main through `cd9f2f50b0655ee548c0fc943af15083693f42b5`, including the intervening automated CI reports, and integrates the previously unpushed High inspector correction. The combined application and test source is frozen at local commit `4c9b858452fbf099509e471c3db619a7a4b33717`. It uses simulation identity **28** and snapshot protocol **17**.

The frozen source includes only the seventeen explicitly reviewed physics files, the startup fixture correction, the previously reviewed inspector correction and the identity change. Recovered experimental trees were not copied wholesale. The four original race-gate test files are byte-identical to remote main. No grip, controller gain, AI skill, incident bound, race deadline or existing acceptance assertion was relaxed.

**Commit `4c9b858` is rejected for integration.** Its original 51-case race/planner gate completed 49/51: mixed Vellamar seed 5222 and Montejaral seed 5111 each produce one fall where zero is required. The complete unfiltered full-unit run confirms exactly these two failures: **702 of 703 test files pass, 6,860 of 6,862 tests pass**, exit 1, source stable. Passing the broader matrix, calibration and native fixtures does not override those failures.

The independently reviewed graphics/startup boundary is `5fb2edd84daf81f3ff9516040bdecf4ef4e7ef50`. Relative to recorded remote `cd9f2f5`, its non-documentation changes are limited to `e2e/graphics-high-journey.spec.ts`, `tests/high-fragment-inspector.test.ts`, and `tests/startup.test.ts`. Its production source remains the published source. It is a recoverable clean integration base, not a claim that the two existing published GP failures are resolved.

## Corrections and evidence

### GP force and control phases

The GP rider previously combined current support loads with lateral-force history measured under the preceding load. The new read-only observer interprets existing tyre strain at current stiffness and current friction capacity, including the signed longitudinal-force projection, without advancing relaxation, wheel motion, heat or reporting state. The early observer uses only information available before the current pedal allocation.

Roll planning captures the current pose, target and effort envelope, then provides the requested force reserve to the existing pedal controls. The stopping-energy limit and steering inverse resolve after those controls have produced the signed force pair and speed used by the upcoming plant step. The physical steering actuator, trim and tyre state still advance once. The standalone GP controller and non-GP physical-force branches retain their prior arithmetic; shared road-AI changes are described separately below. A fresh guarded parity comparison on the exact current-history `bike.ts` 8aaa and `motogp-physics.ts` 2a3 hashes passes all 5,760 paired steps against recorded remote production. It covers standalone GP, non-GP road and non-GP standalone modes with both signs and alternating 120/240 Hz steps. It compares JSON-serialized enumerable state, excluding only the added observer scratch. Changed road-contact GP control, traffic and race acceptance are outside that comparison's scope.

The AI throttle reserve decodes the lateral demand already encoded in its steering intent using the same support reaction. It no longer adds the path correction a second time. These are consistency corrections; no higher friction coefficient or more permissive crash rule is introduced.

Two analytic fixture updates preserve the original assertions. A prescribed-force roll-balance fixture supplies that same prescribed force to the new observation path. A rear-allocation fixture prescribes zero roll-prediction acceleration to keep that isolation meaningful. The latter is not evidence that an actual rear-unload transient needs zero steering: independent native checks establish the residual front-force response, and new current-history tests cover the real plant without those mocks.

### Current and wet road paths

The shared driver now supplies the lane offset selected during its current update to the GP speed planner. Previously that planner read the previous published offset while steering used the newly selected path. The existing publication order is retained.

Road-bike steering, heading reference and approach sampling now share the authored wet-line width already used by the base planner. Dry full-width data retains the original exact path. Curvature uses the existing base planner's width blend; it is not presented as an exact geometric reconstruction of an arbitrary scaled curve. Offroad overrides retain their own path behavior.

The slower passing observation captures authored width with the same station, speed, tactical offset, grip, aero, recovery reserve and mass snapshot as its ordinary approach solve. Wet-to-dry and dry-to-wet native tests require the extended plan to preserve that snapshot's existing physical-path prefix, while the next ordinary solve must adopt the changed water. Both tests fail when only the explicit snapshot-width arguments are removed.

### Passing opportunity and braking deadline

The original traffic continuation rule reserves 220 metres before braking. Pass admission now subtracts that same reservation when calculating how much closing distance can be gained; the reservation cannot fund a pass and remain available for braking simultaneously.

The GP passing observer also no longer treats the absence of a braking crossing in a short approach profile as proof of a full 720-metre opportunity. At the existing 12 Hz tactical cadence, it extends the same physical/path solve over the requested straight plus a conservative stopping tail, within the existing 128-sample bound. Only the inspected prefix outside that tail is available for passing. Road already travelled since the saved snapshot is deducted. The extra 12 Hz query does not overwrite the already computed 120 Hz pedal plan. The native solver arithmetic is retained, with the corrected path inputs described above.

A complete observed run of the unchanged seed-3303 mixed race on the five simulation-file hashes of rejected candidate `4c9b858` gives GP **89.79625796049714 seconds** versus Superbike **89.96929120074012 seconds**, a fastest-lap margin of **0.1730332402429724 seconds**, above the original 0.15-second requirement by 0.0230332402429724 seconds. All six riders complete two laps with zero falls and zero impact. The longest stopped interval is 0.525 seconds. The Superbike rider still wins the race and no rider completes a recorded pass in this observation. This is a passing individual pace gate on a rejected composition; it does not establish accepted racecraft or increased completed overtaking, and the margin cannot be transferred to other source combinations.

### Startup fixtures and High diagnostics

The completed full-unit CI job on published `2d67572` had 24 failures: two GP race assertions and 22 startup fixture errors. The renderer fixture now supplies stable per-material program ownership and the retained-program list used by the production preparation code. All thirty original startup cases remain; two new cases verify metadata-before-draw ordering and error propagation before any draw or GPU wait. The guarded startup/preparation/inspector invocation passes 47 cases. Bypassing only the retained metadata initializer makes both new cases fail.

The High inspector caches fragment-output locations after an existing successful native link-status read. Failed links, relinking, missing outputs, current draw-buffer checks, first-draw fallback and native calls remain covered. It preserves the original High quality, 960×600 dimensions, readiness predicate, timeout and actual GPU-completion requirement.

Local Chromium aborts before creating a page because the environment denies its process-singleton socket. Zero browser test bodies execute. The command's request for elevated sandbox permission was also rejected before execution. No actual changed-test High pass or physical-GPU performance result is claimed. Historical component and Low results remain attributed to their original published sources.

## Rejected alternatives

The frozen source excludes the rider-offset phase, steady gyro-mapping and directional-stopping race candidates: their native proofs did not consistently satisfy the unchanged original races. Measured-spin and trim/yaw observations remain diagnostic leads, not implemented and race-accepted alternatives. Historical failing logs remain evidence; they are not relabeled as passes on the combined source.

Further causal controls preserve every original gate:

| Immutable composition | Vellamar 5222 | Montejaral 5111 | Mixed 3303 |
| --- | --- | --- | --- |
| Current-history foundation | Pass, zero falls | Pass, zero falls | Fails margin: GP advantage 0.0262019737 s |
| History plus current-path handoff only | Not repeated | Fails, one fall | Earlier pace control also fails |
| History plus 220 m admission reserve only | Pass, zero falls | Pass, zero falls | Fails: GP 91.33198363 s versus SBK 89.71691286 s |
| Full `4c9b858` composition | Fails, one fall | Fails, one fall | Pass, advantage 0.17303324 s |
| Full composition with separate following horizon | Fails | Fails | Fails |
| Selected-path geometry without temporal heading | Fails, one fall | Pass | Fails |
| Selected path, temporal heading and retained relative intent | Fails, two falls | Fails, two falls | Fails incident bound, four falls |

The selected-path controls expose valid native defects: reconstructing a current target from a clamped future target can shift it by metres; a path moving sideways needs a temporal heading term; and storing an absolute tactical choice while the authored line moves creates artificial lane-rate jitter. Their native positive and mutation-negative tests are retained. Correcting those defects together still produces falls during genuine lane changes, so these changes remain separate research work. The latest onset does not establish generic curvature clipping as its cause.

The isolated finite-profile investigation preserves the history foundation and existing lane controller, excluding the current-path handoff, later selected-path geometry and temporal heading. Four real-track native full-update comparisons establish that its ordinary control plans and six profile arrays are bit-identical before the passing extension. It still fails Vellamar 5222 while passing Montejaral 5111 and mixed 3303. Its original Ardennes 1037 hairpin also fails; an exact immutable history control reproduces the same rider/station failure, so that failure predates the profile extraction. The candidate remains rejected.

A smaller cache-only investigation changes only the GP road-relative tactical-intent cache on the history foundation. It adds no selected-path geometry, temporal-heading term, current-path handoff, wet-width change, passing forecast or admission change. It passes the original Vellamar 5222, Montejaral 5111 and mixed 3303 trio, 90 focused checks, TypeScript and scoped lint. Independent negatives fail on both mirrored diagonal paths when only the old cache consumption is restored, and fail pit cancellation when only the road-only capture restriction is removed. Its full 51-case gate is still running and has already found an Ardennes 1000 hairpin fall, although Ardennes 1037 passes. Thus this smaller source also remains unaccepted pending diagnosis; three passing selected races are not full acceptance.

## Validation receipts

Completed guarded receipts for rejected commit `4c9b858` establish:

- Original 51-case gate: **49 pass, 2 fail**, source stable.
- Original 19-scenario motorcycle matrix: **19/19 pass**, all 158 rider starts classified and finished, 12 total falls across seven scenarios, maximum four in one scenario, longest stopped interval 11.258333 s. These matrix bounds differ from the stricter zero-fall regressions above.
- Strict GP calibration: **pass**, both GP models at 120 and 240 Hz, eight pairs and sixteen band checks.
- Lint, content validation, production build, bundle check and IP check: **all pass**, source stable. Initial JavaScript is 3.57 MB gzip against the unchanged 4 MB limit.
- Native focused model/planner suite: **122/122 pass** on the recorded candidate hashes. These are not 122 full races.
- Unfiltered `npm test`: **6,860 pass, 2 fail across 703 files**, exit 1, all protected inputs unchanged. It includes the original `pretest`, original source guard and every original test file. The command took 3,512.12 seconds including its wrapper; the Vitest duration is 3,502.29 seconds. Raw log SHA-256: `489a8510961308441644a62dc653bcf4132c2896a84590dbd8a843a4b294d84d`.

All logs are generated outside the immutable source tree. The matrix runs the original script through an external working directory so its report cannot rewrite protected input documentation. `continuation-engine-evidence` and `continuation-native-evidence` preserve the completed source-specific logs, hashes and rejected controls. Their results cannot be relabeled as evidence for a later candidate.

## Publication and remaining visual acceptance

These continuation commits are local. Automatic approval review rejected direct publication to main and required explicit authorization in the current chat; the historical user instructions recovered from prior context did not satisfy that review. No alternative publication route was used.

After publication is authorized, the unchanged graphics workflow must execute the corrected High test on these application bytes. Completed High/Ultra appearance and named physical-hardware performance remain separate outstanding evidence. No console-equivalence or minimum-device frame-rate claim follows from the CPU tests or prior software rendering.
