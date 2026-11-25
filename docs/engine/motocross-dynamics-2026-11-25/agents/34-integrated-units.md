# Assignment 34 — integrated motocross units and transport contracts

## Acceptance status

**The initial integrated source is not green: 1,234 of 1,240 motocross tests passed; six failed in three existing files.** The original task baseline passes all 59 tests from those same three files. The run identifies a real touchdown publication defect, an old fixture that seeds only the dab mirror, and two full-lap regressions subsequently isolated by Assignment 36 to that same publication defect. The repaired-source follow-up passed 577 of 578 tests; its sole failure is the old all-zero MX-tail oracle described below. This report records observed versions and keeps later focused repairs separate from its broad-run counts.

Assignment 34 changed no production source, existing test, asset, model, environment, vehicle specification, calibration, or git history. Its repository write is this report; all runner, JSON, log, provenance, and diagnostic files are task-local receipts. The coordinator owns all repairs.

## Executed batches and counting

| Batch | Files | Passed | Failed | Other | Tests | Wall seconds | Exit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Current motocross glob | 124 | 1234 | 6 | 0 | 1240 | 569.239 | 1 |
| Original b527 failure-file comparison | 3 | 59 | 0 | 0 | 59 | 18.058 | 0 |
| Original b527 wheel-contact comparison | 1 | 10 | 0 | 0 | 10 | 5.622 | 0 |
| Current contracts plus late A33 player file | 38 | 577 | 1 | 0 | 578 | 221.266 | 1 |

The two current-tree selections contain **162 distinct test files and 1818 executed test cases, identified by file and reporter case index**; their selections do not overlap. The baseline 69 tests and other agents’ focused receipts are comparison evidence and are **not added** to current-tree coverage.

All test processes used the existing `vitest.config.ts` with `maxWorkers: 1`. Heavy runs were sequential. No `npm test`, `pretest`, model-generation hook, full typecheck, browser run, calibration rewrite, or asset-generation command was invoked. The two held-whip diagnostics are small read-only actual-takeoff traces, not additional test counts.

## Exact versions and timestamps

Current repository HEAD at selection: `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`. Original task baseline: `b527a7e01ea247f0233a2ec4f2850639bafbd887`. Baseline `git status --short` showed only the supplied untracked `node_modules` symlink. All four compared test files were byte-identical between the current tree and baseline before their respective executions.

| Batch | Start UTC | End UTC | Source SHA-256 before | Source SHA-256 after |
| --- | --- | --- | --- | --- |
| `motocross-integrated` | 2026-11-25T18:29:44.876072+00:00 | 2026-11-25T18:39:14.241544+00:00 | `89111c3138b310a7da98af2e4456f845c8687086383ffbead89fdd2ba24af067` | `89111c3138b310a7da98af2e4456f845c8687086383ffbead89fdd2ba24af067` |
| `baseline-failures` | 2026-11-25T18:39:28.344240+00:00 | 2026-11-25T18:39:46.505964+00:00 | `b204abfc6ce707669ea4fbad7f60bb81ffa0268e7cd841b8adc3ac210184f684` | `b204abfc6ce707669ea4fbad7f60bb81ffa0268e7cd841b8adc3ac210184f684` |
| `contracts-and-player` | 2026-11-25T18:44:25.912506+00:00 | 2026-11-25T18:48:07.320777+00:00 | `470c10bf0d7d04d2e37be8380b2050cb6a6c6bd986759b5e74526e08a45192be` | `470c10bf0d7d04d2e37be8380b2050cb6a6c6bd986759b5e74526e08a45192be` |
| `baseline-wheel-contact` | 2026-11-25T18:48:40.929637+00:00 | 2026-11-25T18:48:46.644000+00:00 | `b204abfc6ce707669ea4fbad7f60bb81ffa0268e7cd841b8adc3ac210184f684` | `b204abfc6ce707669ea4fbad7f60bb81ffa0268e7cd841b8adc3ac210184f684` |

The source fingerprint is SHA-256 of sorted `relative path + NUL + file SHA-256 + newline` records for every file under `src/`. Per-file source hashes, selected-test hashes, and package/config hashes are retained in each `*.before.json` and `*.after.json` receipt. The initial current source contains 1,126 files and remained unchanged throughout its 569.239-second batch.

Initial selected-test aggregate changed from `fb5e6b781a3025e05e660872df6daa4894824057822db693404cee31e0268613` to `2bf6d4454a613078a9309f44bb0e4cf17117b02ef712380d385129d75ffffaf7` because A32 added diagnostic decomposition to `tests/motocross-live-pose-coherence.test.ts` after selection. Its eight integrated cases passed; final A32 file SHA-256 is `4816049da122be1d3cb43e8f9b872e0d059c721263699f01361cfeb831e6eb06`, and A32 separately reported 8/8 passed on that frozen file. That separate receipt is not counted again. A33’s player test did not exist in the 124-file initial selection.

## Commands and raw receipts

Every batch was launched by `/workspace/scratch/e91efca799c8/motocross-a34-receipts/run_tests.py`, which expands its requested patterns once, records the exact selected files, snapshots hashes, and runs `npx vitest run` with default and JSON reporters. Its `*.receipt.json` contains the complete argument vector and wall timestamps; `*.selection.json` enumerates the actual files. The initial command is equivalent to:

```bash
npx vitest run tests/motocross-*.test.ts --reporter=default --reporter=json --outputFile=/workspace/scratch/e91efca799c8/motocross-a34-receipts/motocross-integrated.vitest.json
```

The baseline command, executed from the original baseline checkout without copying any assertion or source, was:

```bash
npx vitest run tests/motocross-riding.test.ts tests/motocross-collision.test.ts tests/motocross-forgiving-handling.test.ts --reporter=default --reporter=json --outputFile=/workspace/scratch/e91efca799c8/motocross-a34-receipts/baseline-failures.vitest.json
```

All raw files are under `/workspace/scratch/e91efca799c8/motocross-a34-receipts/`: batch `*.log`, `*.vitest.json`, `*.receipt.json`, `*.selection.json`, `*.before.json`, `*.after.json`; `failure-test-provenance.json`; and `held-whip-diagnostic.mjs`, `held-whip-current.json`, `held-whip-baseline.json`, `wheel-tail-diagnostic.mjs`, `wheel-tail-current.json`, and `between-batch-source-changes.json`. Vitest’s printed clock uses its process timezone; the receipt timestamps above are explicitly UTC.

## Failures and causal evidence

### 1. Held-whip world velocity: real publication regression

`motocross-riding.test.ts` fails both “keeps incoming momentum when a raw rider lands a held whip” cases at its unchanged world-direction assertion, `abs(cross / lengths) < 1e-6`. Side −1 produces `0.00020992225040452833`; side +1 produces `0.000027206862350259804`. The original baseline passes all 27 tests.

A scratch-only probe follows the exact real RIDGE TABLE launch and control policy, observing the adapter without editing production source. Immediately before the final `sampleSuspensionContacts()` in A25’s `firstFlightContact()` continuation, the errors are only `2.4750095840420208e-8` and `2.148635011398988e-8`. That final sample changes `roadPitch` while leaving along-ground `d.speed` and lateral `slide` unchanged. The displayed planar speed subsequently becomes `d.speed * cos(new roadPitch)`, perturbing the world bearing after the yaw basis rotation.

| Side | Event road pitch | Endpoint road pitch | Direction error before final sample | Direction error after final sample |
| --- | ---: | ---: | ---: | ---: |
| −1 | −0.1110738140796785 | −0.11504350340046629 | 2.475009584e−8 | 2.099222504e−4 |
| +1 | −0.1177984950513294 | −0.11829066187861519 | 2.148635011e−8 | 2.720686235e−5 |

The coordinator was sent the precise correction boundary: retain resolved planar speed across endpoint terrain resampling and re-express along-ground speed against the new pitch. No force, crash rule, or tolerance change is implied. A34 made no repair.

There is also a separate stale timestamp oracle immediately after the failing assertion: it equates the final-frame lateral component to the earlier event’s `lastLanding.lateralSpeed` at eight decimals. The legitimate remaining yaw rotation changes the former by `+0.00012824593439475507` and `−0.000016342841694161336`. Any repair to that oracle should compare the actual event and endpoint bases explicitly, retaining exact momentum checks. The baseline has event=end-tick and differences of −8.88e−16 and zero.

### 2. Dab collision fixture: synthetic display state no longer initializes the controller

`motocross-collision.test.ts` fails both “builds a finite roll moment when the boot meets the ground” cases. Its setup steps once, directly writes only `bike.dab = side * 0.49`, then steps once more and requires `side * bike.dab > 0.5`. The new A08 posture controller owns position and velocity internally. The next posture update correctly republishes that state, replacing the synthetic display-field seed; both paths therefore report `0.023336201517969224`. This is the analytic two-tick response at 28 rad/s, not a measured supporting-foot state.

The existing finite-roll support and separating recovery law is unchanged. The fixture needs a coherent controller trajectory reaching the support threshold through normal controls or an explicitly initialized actual controller state. The coordinator was told to preserve every support, finite-moment, and separating recovery assertion, and not restore an instantaneous foot snap or lower the threshold. The unchanged baseline passes all 14 collision tests.

### 3. Full ridden laps: introduced regressions resolved by the same basis correction

`motocross-forgiving-handling.test.ts` passes its 16 balance/grip cases but fails both existing player-solver flying-lap cases. These use the normal Simulation planner for ground routing, withhold the AI ownership mark, and release steering/front brake in flight. They use seed 61007, MX450, Sport assistance, two laps, no opponents, and normal 120 Hz outer steps. Both still complete two laps but record one crash instead of none.

| Course | Cause | Course position (m) | Simulation time (s) |
| --- | --- | ---: | ---: |
| valley-ridge-mx | `grip-lowside` | 837.7613822470782 | 148.03333333328086 |
| arena-nord-sx | `crash-flat` | 468.66990111911434 | 59.412500000020316 |

The original test file and original b527 source pass all 18 tests, including both full laps. These are introduced integration failures. [Assignment 36](36-full-lap-regressions.md) subsequently isolated them by removing only the coordinator’s endpoint basis repair in memory: both exact original crash positions and times returned. With the repair, the unchanged 18-test file passes; the two traced laps complete in 158.825 s and 140.525 s with zero crashes. This independent 18-test receipt is not added to A34’s counts. A33’s passing feature sequences use different control phases and do not supersede these whole-lap gates. Crash thresholds, vehicle specifications, terrain and calibration were not changed.

### 4. MX contact tail: old all-zero oracle excludes valid tagged trajectory metadata

The repaired-source follow-up passes 557/558 tests in 37 non-MX contract files and 20/20 in the newly frozen A33 player file. Its only failure is `wheel-contact-recording.test.ts` → “does not label mx450 inherited car states as motorcycle measurements”. The test asserts that all 33 contact-tail floats are zero on the first practice snapshot. Its original b527 source/test pair passes 10/10, while the same unchanged test on current source passes 9/10.

A scratch-only diagnostic independently constructs the exact MX450 and GPR1 fixtures. On MX450, the only nonzero tail offsets are **+21 = 1**, `MX_FOOT_TRAJECTORY.RECORDED`, and **+22 = 1**, its reset event identity. Both are deliberate A27 metadata. The valid-wheel mask at +0 remains zero, `hasRoadBikeContact()` is false, and `snapshotIncompatibility()` returns null. `MX_POSTURE.RECORDED` is zero in this particular no-step fixture. GPR1 retains an entirely zero tail. The direct car-contact consumer is also checked for all four wheels by the diagnostic.

The correct contract update must preserve the zero car-measurement mask and invalid car-contact consumer result, while accepting only the specified tagged MX metadata. It must retain the GPR1/legacy fallback and neutral trajectory values; production must not erase legitimate metadata to satisfy the old byte-zero assumption. The coordinator has reserved an independent transport review. A34 changed no contract assertion or production field.

### Baseline test fingerprints

| Original test | Identical current/baseline SHA-256 | Baseline result |
| --- | --- | --- |
| `motocross-riding.test.ts` | `20ad26c4e42c39a03b8959ddb5bb380734fd9a376a86827207b91e3761cb8894` | 27/27 |
| `motocross-collision.test.ts` | `899e75f02ea8b7666f789e678c6968bf05907930c243a46a6f9a6345e970540b` | 14/14 |
| `motocross-forgiving-handling.test.ts` | `495119af76deed9cbf3cb4f8f8c889bab2aeb1d5e15c510f64e424adafab29d1` | 18/18 |
| `wheel-contact-recording.test.ts` | `84555a22bf9322fd79a028aa137f8e0249566d8c760f5fc410780f8bb07bb555` | 10/10 |

No APX livery, GP catalogue, or translation failure was encountered in this selected sweep. No passing claim is made about the entire repository or browser playability. The coordinator’s final integrated sweep must cover all accepted repairs and late tests on its final frozen source.

## Initial motocross file inventory

| Test file | Passed | Failed | Other |
| --- | ---: | ---: | ---: |
| `tests/motocross-ai.test.ts` | 42 | 0 | 0 |
| `tests/motocross-air-drag.test.ts` | 20 | 0 | 0 |
| `tests/motocross-arena-lighting.test.ts` | 8 | 0 | 0 |
| `tests/motocross-arena-weather.test.ts` | 4 | 0 | 0 |
| `tests/motocross-assembly-occlusion.test.ts` | 3 | 0 | 0 |
| `tests/motocross-authored-kit.test.ts` | 14 | 0 | 0 |
| `tests/motocross-ballistic-timing.test.ts` | 13 | 0 | 0 |
| `tests/motocross-berm-lines.test.ts` | 4 | 0 | 0 |
| `tests/motocross-berm-practice.test.ts` | 24 | 0 | 0 |
| `tests/motocross-body-input.test.ts` | 10 | 0 | 0 |
| `tests/motocross-body-pose.test.ts` | 5 | 0 | 0 |
| `tests/motocross-body-transport.test.ts` | 21 | 0 | 0 |
| `tests/motocross-bodywork.test.ts` | 18 | 0 | 0 |
| `tests/motocross-boundary-tape.test.ts` | 5 | 0 | 0 |
| `tests/motocross-brake-cue.test.ts` | 9 | 0 | 0 |
| `tests/motocross-braking-bumps.test.ts` | 9 | 0 | 0 |
| `tests/motocross-broadcast-controls.test.ts` | 56 | 0 | 0 |
| `tests/motocross-broadcast-placement.test.ts` | 2 | 0 | 0 |
| `tests/motocross-camera-motion-ramp.test.ts` | 15 | 0 | 0 |
| `tests/motocross-camera-ramp.test.ts` | 6 | 0 | 0 |
| `tests/motocross-camera.test.ts` | 16 | 0 | 0 |
| `tests/motocross-castings.test.ts` | 22 | 0 | 0 |
| `tests/motocross-chain-drive.test.ts` | 22 | 0 | 0 |
| `tests/motocross-cockpit-view.test.ts` | 6 | 0 | 0 |
| `tests/motocross-collision.test.ts` | 12 | 2 | 0 |
| `tests/motocross-contact-impulse.test.ts` | 3 | 0 | 0 |
| `tests/motocross-contact-reset.test.ts` | 13 | 0 | 0 |
| `tests/motocross-contact-time-coherence.test.ts` | 13 | 0 | 0 |
| `tests/motocross-contact-traction.test.ts` | 17 | 0 | 0 |
| `tests/motocross-control-animation.test.ts` | 29 | 0 | 0 |
| `tests/motocross-cooling-wheels.test.ts` | 13 | 0 | 0 |
| `tests/motocross-cornering-reserve.test.ts` | 3 | 0 | 0 |
| `tests/motocross-coupled-stops.test.ts` | 5 | 0 | 0 |
| `tests/motocross-course-landmarks.test.ts` | 6 | 0 | 0 |
| `tests/motocross-course-sites.test.ts` | 5 | 0 | 0 |
| `tests/motocross-course-wear.test.ts` | 5 | 0 | 0 |
| `tests/motocross-dab-ground.test.ts` | 4 | 0 | 0 |
| `tests/motocross-dust-ground.test.ts` | 2 | 0 | 0 |
| `tests/motocross-dynamic-suspension.test.ts` | 14 | 0 | 0 |
| `tests/motocross-dynamics-replay.test.ts` | 10 | 0 | 0 |
| `tests/motocross-environment.test.ts` | 16 | 0 | 0 |
| `tests/motocross-equipment-contact.test.ts` | 7 | 0 | 0 |
| `tests/motocross-equipment-surface.test.ts` | 21 | 0 | 0 |
| `tests/motocross-feather-flags.test.ts` | 7 | 0 | 0 |
| `tests/motocross-finish-line.test.ts` | 2 | 0 | 0 |
| `tests/motocross-flow-practice.test.ts` | 16 | 0 | 0 |
| `tests/motocross-foot-boundary.test.ts` | 8 | 0 | 0 |
| `tests/motocross-foot-reconstruction.test.ts` | 11 | 0 | 0 |
| `tests/motocross-forgiving-handling.test.ts` | 16 | 2 | 0 |
| `tests/motocross-garment.test.ts` | 8 | 0 | 0 |
| `tests/motocross-get-up.test.ts` | 5 | 0 | 0 |
| `tests/motocross-grass-tufts.test.ts` | 3 | 0 | 0 |
| `tests/motocross-grid-preparation.test.ts` | 12 | 0 | 0 |
| `tests/motocross-ground-passivity.test.ts` | 5 | 0 | 0 |
| `tests/motocross-ground-physics.test.ts` | 13 | 0 | 0 |
| `tests/motocross-hard-stop-integration.test.ts` | 10 | 0 | 0 |
| `tests/motocross-heading-guard.test.ts` | 6 | 0 | 0 |
| `tests/motocross-hidden-transforms.test.ts` | 4 | 0 | 0 |
| `tests/motocross-hud.test.ts` | 28 | 0 | 0 |
| `tests/motocross-interrupted-shift-contact.test.ts` | 6 | 0 | 0 |
| `tests/motocross-joint-reversal.test.ts` | 30 | 0 | 0 |
| `tests/motocross-landing-challenge.test.ts` | 17 | 0 | 0 |
| `tests/motocross-landing-observability.test.ts` | 9 | 0 | 0 |
| `tests/motocross-landing-prediction.test.ts` | 12 | 0 | 0 |
| `tests/motocross-lane-index.test.ts` | 2 | 0 | 0 |
| `tests/motocross-lever-contact.test.ts` | 4 | 0 | 0 |
| `tests/motocross-live-pose-coherence.test.ts` | 8 | 0 | 0 |
| `tests/motocross-loose-soil.test.ts` | 6 | 0 | 0 |
| `tests/motocross-machine-animation.test.ts` | 5 | 0 | 0 |
| `tests/motocross-meadow-lifecycle.test.ts` | 10 | 0 | 0 |
| `tests/motocross-meadow.test.ts` | 3 | 0 | 0 |
| `tests/motocross-mechanics.test.ts` | 28 | 0 | 0 |
| `tests/motocross-metal-finish.test.ts` | 7 | 0 | 0 |
| `tests/motocross-motion-boundary.test.ts` | 5 | 0 | 0 |
| `tests/motocross-mouldings.test.ts` | 23 | 0 | 0 |
| `tests/motocross-pass-and-ridges.test.ts` | 6 | 0 | 0 |
| `tests/motocross-photographic-light.test.ts` | 6 | 0 | 0 |
| `tests/motocross-plastic-wear.test.ts` | 1 | 0 | 0 |
| `tests/motocross-posture-dynamics.test.ts` | 9 | 0 | 0 |
| `tests/motocross-posture-transport.test.ts` | 15 | 0 | 0 |
| `tests/motocross-presentation.test.ts` | 4 | 0 | 0 |
| `tests/motocross-push-gait.test.ts` | 2 | 0 | 0 |
| `tests/motocross-race-control.test.ts` | 6 | 0 | 0 |
| `tests/motocross-reference-geometry.test.ts` | 10 | 0 | 0 |
| `tests/motocross-reference-review.test.ts` | 2 | 0 | 0 |
| `tests/motocross-rhythm-coach.test.ts` | 11 | 0 | 0 |
| `tests/motocross-rider-blending.test.ts` | 8 | 0 | 0 |
| `tests/motocross-rider-equipment.test.ts` | 10 | 0 | 0 |
| `tests/motocross-rider-motion.test.ts` | 19 | 0 | 0 |
| `tests/motocross-rider-recovery.test.ts` | 2 | 0 | 0 |
| `tests/motocross-rider-sight.test.ts` | 6 | 0 | 0 |
| `tests/motocross-rider-timing.test.ts` | 7 | 0 | 0 |
| `tests/motocross-rider-weight.test.ts` | 14 | 0 | 0 |
| `tests/motocross-riding.test.ts` | 25 | 2 | 0 |
| `tests/motocross-roost-budget.test.ts` | 1 | 0 | 0 |
| `tests/motocross-roost-contact.test.ts` | 15 | 0 | 0 |
| `tests/motocross-roost-deflector.test.ts` | 3 | 0 | 0 |
| `tests/motocross-rut-contact.test.ts` | 6 | 0 | 0 |
| `tests/motocross-screen-capture.test.ts` | 1 | 0 | 0 |
| `tests/motocross-shift-continuity.test.ts` | 5 | 0 | 0 |
| `tests/motocross-shoulder-plants.test.ts` | 9 | 0 | 0 |
| `tests/motocross-shoulder-recovery.test.ts` | 2 | 0 | 0 |
| `tests/motocross-snapshot-cadence.test.ts` | 2 | 0 | 0 |
| `tests/motocross-soil-morphology.test.ts` | 4 | 0 | 0 |
| `tests/motocross-soil-parallax.test.ts` | 7 | 0 | 0 |
| `tests/motocross-soil-pickup.test.ts` | 3 | 0 | 0 |
| `tests/motocross-soil-transition.test.ts` | 8 | 0 | 0 |
| `tests/motocross-spectators.test.ts` | 7 | 0 | 0 |
| `tests/motocross-spine.test.ts` | 6 | 0 | 0 |
| `tests/motocross-sprung-pose.test.ts` | 25 | 0 | 0 |
| `tests/motocross-stadium-crowd.test.ts` | 9 | 0 | 0 |
| `tests/motocross-supported-convergence.test.ts` | 3 | 0 | 0 |
| `tests/motocross-terrain-continuity.test.ts` | 7 | 0 | 0 |
| `tests/motocross-terrain-shadow.test.ts` | 9 | 0 | 0 |
| `tests/motocross-textile-structure.test.ts` | 3 | 0 | 0 |
| `tests/motocross-thermal.test.ts` | 3 | 0 | 0 |
| `tests/motocross-timing-board.test.ts` | 1 | 0 | 0 |
| `tests/motocross-tyre-contact.test.ts` | 7 | 0 | 0 |
| `tests/motocross-tyre-finish.test.ts` | 8 | 0 | 0 |
| `tests/motocross-tyre-traces.test.ts` | 9 | 0 | 0 |
| `tests/motocross-uv-footprint.test.ts` | 7 | 0 | 0 |
| `tests/motocross-venue-integration.test.ts` | 4 | 0 | 0 |
| `tests/motocross-wheel-pickup.test.ts` | 11 | 0 | 0 |
| `tests/motocross-worked-soil.test.ts` | 5 | 0 | 0 |

## Contracts and late A33 file inventory

| Test file | Passed | Failed | Other |
| --- | ---: | ---: | ---: |
| `tests/bike-session.test.ts` | 14 | 0 | 0 |
| `tests/career-session.test.ts` | 6 | 0 | 0 |
| `tests/circuit-frame-transport.test.ts` | 5 | 0 | 0 |
| `tests/controller-session-ownership.test.ts` | 16 | 0 | 0 |
| `tests/engine-flashback-diagnostics-state.test.ts` | 7 | 0 | 0 |
| `tests/engine-flashback-disabled-history.test.ts` | 14 | 0 | 0 |
| `tests/engine-flashback-state.test.ts` | 10 | 0 | 0 |
| `tests/engine-recording-composition.test.ts` | 7 | 0 | 0 |
| `tests/engine-server-snapshot-lifetime.test.ts` | 10 | 0 | 0 |
| `tests/engine-session-settlement.test.ts` | 10 | 0 | 0 |
| `tests/engine-snapshot-batch-encoding.test.ts` | 18 | 0 | 0 |
| `tests/engine-worker-session-adversarial.test.ts` | 6 | 0 | 0 |
| `tests/festival-session-lifecycle.test.ts` | 34 | 0 | 0 |
| `tests/flashback-determinism.test.ts` | 2 | 0 | 0 |
| `tests/flashback-recording.test.ts` | 4 | 0 | 0 |
| `tests/flashback-work-budget.test.ts` | 12 | 0 | 0 |
| `tests/motocross-player-dynamics.test.ts` | 20 | 0 | 0 |
| `tests/open-world-session.test.ts` | 11 | 0 | 0 |
| `tests/pit-session-eligibility.test.ts` | 8 | 0 | 0 |
| `tests/recording-publication-ownership.test.ts` | 22 | 0 | 0 |
| `tests/recording-transport.test.ts` | 16 | 0 | 0 |
| `tests/recording.test.ts` | 37 | 0 | 0 |
| `tests/replay-clock.test.ts` | 27 | 0 | 0 |
| `tests/replay-endpoint-precision.test.ts` | 28 | 0 | 0 |
| `tests/replay-presentation.test.ts` | 4 | 0 | 0 |
| `tests/replay-seek-preparation.test.ts` | 10 | 0 | 0 |
| `tests/road-bike-replay-state.test.ts` | 2 | 0 | 0 |
| `tests/rotation-interpolation.test.ts` | 24 | 0 | 0 |
| `tests/session-identity.test.ts` | 98 | 0 | 0 |
| `tests/session-replay-lifecycle.test.ts` | 7 | 0 | 0 |
| `tests/session-review.test.ts` | 6 | 0 | 0 |
| `tests/snapshot-encoding-hotpath.test.ts` | 14 | 0 | 0 |
| `tests/snapshot-header-contract.test.ts` | 16 | 0 | 0 |
| `tests/snapshot-interpolation.test.ts` | 20 | 0 | 0 |
| `tests/wheel-contact-recording.test.ts` | 9 | 1 | 0 |
| `tests/wheel-pose.test.ts` | 14 | 0 | 0 |
| `tests/wheel-winding-recording.test.ts` | 6 | 0 | 0 |
| `tests/worker-rewind-ownership.test.ts` | 3 | 0 | 0 |

## Original baseline comparison inventory

| Test file | Passed | Failed | Other |
| --- | ---: | ---: | ---: |
| `tests/motocross-collision.test.ts` | 14 | 0 | 0 |
| `tests/motocross-forgiving-handling.test.ts` | 18 | 0 | 0 |
| `tests/motocross-riding.test.ts` | 27 | 0 | 0 |

| Test file | Passed | Failed | Other |
| --- | ---: | ---: | ---: |
| `tests/wheel-contact-recording.test.ts` | 10 | 0 | 0 |

## Version boundary and remaining acceptance

Only `src/simulation/offroad/dirt-bike-vehicle.ts` changed between the initial sweep and the contracts/player follow-up: adapter SHA-256 `d9ca921a1fe09060769622417be2d6a2698773232c9974f0f516e5b3d4fb8e58` became `e04318b7e4c6075d42a6c65cc04664a19e5425e20e50f49a1b1ad4f37084ea17`. The follow-up includes the coordinator’s endpoint planar-speed preservation. Its distinct 38-file selection comprises 37 non-MX transport/session/snapshot/flashback contracts plus A33’s 20-test player-scenario file; there is no overlap with the initial 124-file sweep.

A34 does not rerun the initial 124 files on this later adapter or claim a single green full sweep. The coordinator separately reported 41/41 riding/collision tests after its exact event-basis and authoritative dab-fixture updates; that focused receipt and A36’s 18/18 are not added to A34’s counts. The remaining zero-tail contract review and final frozen-source integration are still required. The final agent must also include any A35/later tests added after A34’s selections.

## Exact follow-up and final baseline commands

From the current checkout:

```bash
npx vitest run tests/bike-session.test.ts tests/career-session.test.ts tests/circuit-frame-transport.test.ts tests/controller-session-ownership.test.ts tests/engine-flashback-diagnostics-state.test.ts tests/engine-flashback-disabled-history.test.ts tests/engine-flashback-state.test.ts tests/engine-recording-composition.test.ts tests/engine-server-snapshot-lifetime.test.ts tests/engine-session-settlement.test.ts tests/engine-snapshot-batch-encoding.test.ts tests/engine-worker-session-adversarial.test.ts tests/festival-session-lifecycle.test.ts tests/flashback-determinism.test.ts tests/flashback-recording.test.ts tests/flashback-work-budget.test.ts tests/open-world-session.test.ts tests/pit-session-eligibility.test.ts tests/recording-publication-ownership.test.ts tests/recording-transport.test.ts tests/recording.test.ts tests/replay-clock.test.ts tests/replay-endpoint-precision.test.ts tests/replay-presentation.test.ts tests/replay-seek-preparation.test.ts tests/road-bike-replay-state.test.ts tests/rotation-interpolation.test.ts tests/session-identity.test.ts tests/session-replay-lifecycle.test.ts tests/session-review.test.ts tests/snapshot-encoding-hotpath.test.ts tests/snapshot-header-contract.test.ts tests/snapshot-interpolation.test.ts tests/wheel-contact-recording.test.ts tests/wheel-pose.test.ts tests/wheel-winding-recording.test.ts tests/worker-rewind-ownership.test.ts tests/motocross-player-dynamics.test.ts --reporter=default --reporter=json --outputFile=/workspace/scratch/e91efca799c8/motocross-a34-receipts/contracts-and-player.vitest.json
```

From the unchanged original baseline checkout:

```bash
npx vitest run tests/wheel-contact-recording.test.ts --reporter=default --reporter=json --outputFile=/workspace/scratch/e91efca799c8/motocross-a34-receipts/baseline-wheel-contact.vitest.json
```
