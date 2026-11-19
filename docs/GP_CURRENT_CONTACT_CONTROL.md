# GP steering uses the current rear contact

Assignment 20, wave 7. This change corrects the rider controller's force prediction; it does not change the tire force law, grip, contact support, steering-rate limits, or incident thresholds.

## Demonstrated inconsistency

The GP roll controller asks the front contact for the total lateral force it needs, minus the rear contact's contribution and its yaw correction. Previously that subtraction used `gp.rearFy` from the preceding contact evaluation, even after the road suspension had supplied a new front/rear load pair.

A frozen regression isolates the defect without a racing line or speed plan. The bike is upright, with zero yaw and zero requested lateral acceleration. Its old front/rear carcass forces are −400/+400 N. The rear then unloads to zero. The old controller asks the front inverse for **−400 N** to cancel a rear force that no longer exists. The corrected request is **0 N**. The actual forward plant also produces zero rear force with zero rear support.

The mixed Vellamar reproduction supplied the practical context. The previously fastest GP entrants lost valid laps around station 3,680 m. The first recorded fall reached the existing 2.5 rad/s yaw guard and approximately −31.8 m/s of sideslip. Both contacts had regained support by the final fall, so treating that final frame as a simple airborne event would miss the preceding unload/reload transient.

## Bounded correction

`MotoGPChassis.rearForceFor` predicts the rear force for the supplied current load, friction, lean, speed, longitudinal force, and timestep. It uses exactly the forward contact's order:

1. Prepare the existing motorcycle slick with current load and camber-adjusted friction.
2. Calculate the rear contact velocity from body sideslip and yaw.
3. Evaluate the existing combined-slip force and longitudinal friction budget.
4. Apply the existing distance-based carcass relaxation.
5. Immediately clamp the result to the current contact's friction limit.

The preview owns separate slip-state scratch. It does not advance tire deflection, yaw, sideslip, wheel rotation, slip-angle telemetry, or sliding heat. An unloaded rear returns zero immediately.

The sprung-contact GP rider uses this prediction in its existing front-force request. Standalone callers without the road contact opt-in retain the preceding behavior. The front steering inverse remains the existing current-load **steady-contact** inverse; the physical front carcass still relaxes in the forward plant, and the established roll controller still predicts that finite response.

### Longitudinal timing

The rider computes steering before the step resolves its brake and drive forces. The preview therefore uses the preceding applied rear longitudinal force, just as the front inverse uses the preceding front brake force. The new prediction is exact for its supplied contact inputs; it does not claim to anticipate a later brake/drive change. In particular, the zero-support result is exact regardless of that longitudinal estimate. This change does not reorder the longitudinal assist or introduce an implicit joint brake/steer solve.

## Rejected alternatives and causal checkpoints

The checks used the same frozen contact-ownership correction from assignment 17. No acceptance thresholds were changed.

| Checkpoint | Mixed GP/SBK result | Ardennes result |
| --- | --- | --- |
| Received assignment 14/17 checkpoint | 3 falls; best GP 92.667022 s versus SBK 89.020460 s; pace gate fails | Both tested hairpin seeds pass |
| Scratch probe removing only the planning recovery reserve | 7 falls; GP 89.783600 s versus SBK 89.696361 s; fails | Not a release candidate |
| Current rear prediction plus an experimental transient front inverse | 2 falls; GP 88.010734 s versus SBK 89.429292 s | Both hairpin seeds regress; rejected |
| Current rear prediction with the existing steady front inverse | 0 falls; GP 89.754538 s versus SBK 90.212993 s; margin 0.458455 s | Seed 1000 completes with zero falls; seed 1037 still has one hairpin fall at station 3142.178980 m |

The recovery reserve remains unchanged. Removing it worsened incidents and did not establish the required GP pace margin. The experimental front inverse was also removed. Its compensation for physical front relaxation interacted with a controller that already predicts a finite response; double compensation is a plausible explanation, not a proven isolated cause. Although its force inversion was accurate, it was not a safe integrated controller change. Its four new experimental tests were removed with that unused feature; assignment 14's existing ten front-inverse tests and every original race gate remain intact.

The rear-only checkpoint closes the demonstrated mixed-class pace issue. **It does not by itself pass final combined release acceptance.** The remaining seed 1037 trace has approximately 13.3 m/s actual speed against a 10.8 m/s plan while the roll-arrest demand consumes the available friction and ABS releases. The independently identified current-pose braking geometry correction from assignment 23 must be integrated and the complete race gates rerun.

## Verification and evidence

Seven new tests in `tests/gp-current-contact-control.test.ts` cover the real rider's unloaded-rear request and six forward/preview comparisons: zero support, unloading, reloading, lower friction, rear drive, and rear braking beyond available grip. They compare the **actual relaxed rear force**, not a raw force with relaxation divided out, and verify that the preview leaves physical and thermal state unchanged.

Before the rear-only refinement, the wider 56-test checkpoint passed the current-contact, inverse, paired momentum, contact reaction, riding control, MotoGP plant, and recovery-budget suites. The complete 14-test bike-session suite passed, as did Montejaral and all three cooldown cases; the two Ardennes hairpin regressions triggered rejection of the transient front feature. The associated Vitest process also reported an `onTaskUpdate` RPC timeout, so that whole invocation is recorded as failed, not green.

The retained rear-only source passed **27/27 tests in four files**: current-contact control (7), front steering inverse (10), paired contact momentum (5), and contact reaction (5). Prettier and ESLint passed for `bike.ts`, `motogp-physics.ts`, and the new current-contact test after assignment 23's separate brake-geometry integration. These focused results do not certify the pending full combined races.

The final combined results are recorded by the coordinating release report. Scratch evidence in `/workspace/scratch/d611aefdb08c` includes:

- `w07-current-rear-before.log`: the frozen −400 N erroneous request.
- `w07-gp-pace-baseline.json` and `w07-gp-pace-zero-probe.json`: recovery-reserve isolation.
- `w07-gp-onset-baseline.json`: the Vellamar yaw/sideslip onset.
- `w07-rear-only-mixed.json`: six finishes, zero falls, and the class pace margin.
- `w07-rear-only-1000.events` and `w07-rear-only-1037.events`: exact remaining race outcomes.
- `w07-rear-current-invariants.log`: rear-only force and momentum regressions.

The original 19-scenario `scripts/bike-race.ts` was also launched on the earlier experimental-front checkpoint, writing to a scratch directory. The coordinator requested that this obsolete run stop; it was interrupted with exit 130 after 13 completed scenarios. The partial `w07-road-race-matrix.log` is historical integration evidence and cannot certify the later rear-only source. The final combined source needs a complete new matrix.

## Frozen handoff to independent review

Assignment 20 has stopped production edits. Its retained changes are confined to the rear preview in `motogp-physics.ts`, its use inside `Bike.gpSteer`, `tests/gp-current-contact-control.test.ts`, and this report. No AI planning, recovery reserve, skill, tire law, gain, incident threshold, or original race assertion was changed.

| File/checkpoint | SHA-256 |
| --- | --- |
| Rear-only `bike.ts` used by the traces, before assignment 23's geometry integration | `6535f762dbfe3882e5a99c5739c75f35027ccec3905b0c82cf27b2cdc381d940` |
| Current `bike.ts`, including assignment 23's distinct braking geometry change | `74ac0f0e3844dcb2e77d7cc9d4d404f2f02932716656ac62208803339445b8f5` |
| Retained `motogp-physics.ts` | `c571841bfa76e9ab1e10d6d8d320df84b840f075f4f1bc6b9369a499945aac48` |
| `tests/gp-current-contact-control.test.ts` | `31bbe661946e1ebbaf6653b56beb7a77fd3cdac51462857df2c79d98b6ad83c0` |

The remaining failure is Ardennes, GP rules, four GPR1 riders, one lap, seed 1037, outer timestep 1/120 s. Full per-sample evidence is `w07-rear-only-1037.trace`; all incidents and finishes are in `w07-rear-only-1037.events`. The probe is `w07-rear-only-checkpoint.mjs` (arguments `1037 3090 3190 600`). Its scratch wrapper passed zero to the then-experimental front transient argument, reproducing the retained steady front inverse. That unused argument has since been removed. The repo diagnostic `scripts/studio/tools/gp-contact-checkpoint.mjs` can now reproduce the case directly without that wrapper, on whatever source is currently loaded.

Selected rider 1 samples before its first fall:

| Time (s) | Station (m) | Speed / target (m/s) | Front / rear support (N) | Lean / roll rate (rad, rad/s) | Lateral demand (m/s²) | Applied front / rear brake (N) |
| --- | --- | --- | --- | --- | --- | --- |
| 86.808333 | 3100.791166 | 13.456039 / 12.872408 | 1894.645660 / 592.809196 | −0.057052 / −0.504896 | 0.909980 | 1045.761494 / 100.553990 |
| 87.308333 | 3106.951620 | 12.433741 / 13.950219 | 1319.574247 / 1069.182706 | −0.164377 / 0.188905 | 3.306387 | 231.361270 / 0 |
| 88.158333 | 3118.837859 | 12.947705 / 12.624964 | 812.759795 / 706.944779 | 0.473062 / 0.806358 | 3.254788 | 0 / 30.464420 |
| 88.358333 | 3122.345112 | 13.024077 / 11.452776 | 1606.083394 / 359.913104 | 0.618305 / 0.566973 | 19.613300 | 0 / 0 |
| 88.658333 | 3127.302777 | 12.981231 / 12.765033 | 966.062982 / 636.773300 | 0.732045 / 0.216112 | 6.188208 | 0 / 64.287147 |
| 88.958333 | 3132.709625 | 13.070616 / 12.696335 | 1036.337693 / 678.563824 | 0.809376 / 0.311955 | 14.162432 | 0 / 61.125303 |
| 89.258333 | 3137.737343 | 13.175847 / 12.026873 | 963.194207 / 697.503447 | 0.952961 / 0.694438 | 19.613300 | 0 / 0 |

At time **89.508333 s**, rider 1 falls at station **3142.178980 m**. The captured state immediately before the fall reset is: speed 13.30914308011567 m/s; lean 1.2569732799317075 rad; roll rate 1.8784357502289868 rad/s; yaw rate 0.8164477561422893 rad/s; sideslip velocity 0.548140120959522 m/s; actual lateral acceleration 12.30820665075729 m/s²; lateral demand 19.6133 m/s²; lean target 0.7835156147020651 rad; front/rear lateral force 1762.6356213433207 / 1252.3485348523232 N. The after-step event contains reset roll/yaw telemetry, so use its `beforeFall` object for the failure state.

This differs from the Vellamar yaw/sideslip runaway: yaw stays bounded while speed remains above the plan and rolling demand uses the braking friction budget. The race still finishes, with two additional later falls outside the hairpin (rider 2 at station 6747.070631 m, rider 3 at 6753.521155 m). All three occurred before the flag. The zero-hairpin-incidents assertion is therefore still a blocker at this checkpoint.

One independent-review lead from the coordinator: `gpSteer` uses `measured = gp.lateralAcceleration` from the previous contact evaluation while `reaction` and `supportedLimit` already use the current suspension loads. Its `rolling`, `rateAhead`, and `ahead` predictor can therefore combine different contact states during support transitions. This is an explicitly **unproven cause** to test against the trace, alongside the support assumptions in the approach speed plan. The rear preview regression proves a separate force-subtraction defect; it does not prove that every lag-prediction input is coherent.

Assignment 23 has now integrated its separately demonstrated current-pose braking force cap. No combined full-race result is claimed here. Required remaining gates are the unchanged complete `tests/bike-session.test.ts` and `tests/gp-ai-braking-plan.test.ts` (including all hairpin and cooldown cases), the focused current-contact/force invariants on the final source, and the original full 19-scenario bike race matrix. The coordinator owns final source hashes and acceptance.
