# Assignment 49 — final combined motocross unit acceptance

## Result

**The final frozen working tree passes all 1,836 test cases in the exact 165-file acceptance selection.** This is one combined Vitest invocation: 128 motocross files and the 37 other recording, session, replay and transport contract files selected by [Assignment 34](34-integrated-units.md). All 165 files passed. There are zero failed, skipped, pending or todo cases, and no missing, extra or duplicated test files.

| Selection | Distinct files | Passed cases | Failed cases | Other cases |
| --- | ---: | ---: | ---: | ---: |
| Every `tests/motocross*.test.ts` | 128 | 1278 | 0 | 0 |
| A34's non-motocross recording/session/transport contracts | 37 | 558 | 0 | 0 |
| **One combined final invocation** | **165** | **1836** | **0** | **0** |

The process exited **0**, and the JSON reporter's `success` is `true`. The exact selected-file inventory equals the actual `testResults[].name` inventory. Case totals come from each file's assertion results, identified by file and reporter index, and agree with the JSON header. Vitest's separate suite count includes nested suites; it is not used as the file count. No earlier run, baseline comparison, diagnostic sample, or other assignment's overlapping cases is added to the totals above.

All **2,710 fingerprinted input files** are byte-identical before and after this run. This includes every source file, every test file, every script and public asset, the selected dependency fixtures, package/configuration inputs, and the two installed Three shader source files read by a selected test. The selected tests were not changed while running.

## What the final selection covers

The selection was rebuilt and deduplicated after the coordinator's explicit source/test freeze and GO. A34's follow-up contains 38 files, but its A33 player-dynamics file is already included in the final motocross glob. Removing that duplicate leaves exactly 37 non-motocross contracts.

The late integration changes and the independently strengthened physical oracle are included in this same run:

| Final regression file | Cases passed | Coverage in this run |
| --- | ---: | --- |
| `motocross-shoulder-load-continuity.test.ts` | 2 | A40's Sport and Raw AI shoulder-load continuity regressions. |
| `motocross-shift-extrema.test.ts` | 9 | A44's bounded selector/foot continuation, including canonical strokes and near-extremum interrupted shifts. |
| `motocross-camera-flight-origin.test.ts` | 3 | A46's camera flight origin across unobserved touchdown and relaunch intervals. |
| `motocross-motion-boundary.test.ts` | 9 | A47's final optional-motion reader, including four added malformed-range and valid-boundary cases. |
| `motocross-riding.test.ts` | 27 | A48's independent first-contact heading/yaw observer and preserved held-whip momentum checks. |

All four files implicated by A34's earlier failing batches pass on this single frozen tree: riding **27/27**, collision **14/14**, forgiving handling **18/18**, and wheel-contact recording **10/10**. The forgiving-handling result includes both unchanged player full-lap cases. These are subsets of the 1,836 total, not additional coverage.

The sweep also includes actual existing-rig foot reconstruction, interrupted-shift contact, live pose coherence, suspension and hard-stop physics, analytic free flight, player dynamics, replay interpolation, snapshot/worker ownership, recording publication, session settlement and flashback determinism. The full inventory below identifies the exact coverage. Existing geometry and appearance assertions in the motocross glob ran against the existing content; they did not generate or edit assets.

A49 changed no test assertion, numerical acceptance limit, fixture, timeout, skip or retry setting. The final accepted test-contract migrations and their physical justification are separately reviewed in [Assignment 48](48-oracle-review.md).

## Execution and configuration

| Property | Observed value |
| --- | --- |
| Working directory | `/workspace/scratch/e91efca799c8/motobound-engine` |
| Start UTC | `2026-11-25T19:50:37.449235+00:00` |
| End UTC | `2026-11-25T20:05:07.608150+00:00` |
| Wrapper elapsed time | `870.158894` seconds |
| Vitest displayed duration | 869.17 seconds |
| Node | `v24.22.3` |
| Vitest | `3.2.4` |
| Configured workers | `maxWorkers: 1`, unchanged |
| Configured per-test timeout | `120000` ms, unchanged |
| Build flags in unit configuration | `__SUPPLIED_PLAYER__: true`, `__REVIEW_TOOLS__: true`, unchanged |
| Reporters | Default console reporter and complete JSON reporter |
| Environment override | `NO_COLOR=1` only |
| Exit and status | `0`; JSON `success: true` |

The run used the installed Vitest binary directly. No `npm test`, `pretest`, build lifecycle hook, model generation, calibration regeneration, snapshot update or broad retry was invoked. The coordinator had completed its final TypeScript and ESLint gates before issuing GO; those results are not counted as executions by this assignment. The elapsed time is a shared-host execution receipt, not a frame-rate or performance benchmark.

The raw wrapper receipt records the complete expanded 165-path argument vector. From the repository root, the equivalent command is:

```sh
node_modules/.bin/vitest run \
  tests/motocross*.test.ts \
  tests/bike-session.test.ts \
  tests/career-session.test.ts \
  tests/circuit-frame-transport.test.ts \
  tests/controller-session-ownership.test.ts \
  tests/engine-flashback-diagnostics-state.test.ts \
  tests/engine-flashback-disabled-history.test.ts \
  tests/engine-flashback-state.test.ts \
  tests/engine-recording-composition.test.ts \
  tests/engine-server-snapshot-lifetime.test.ts \
  tests/engine-session-settlement.test.ts \
  tests/engine-snapshot-batch-encoding.test.ts \
  tests/engine-worker-session-adversarial.test.ts \
  tests/festival-session-lifecycle.test.ts \
  tests/flashback-determinism.test.ts \
  tests/flashback-recording.test.ts \
  tests/flashback-work-budget.test.ts \
  tests/open-world-session.test.ts \
  tests/pit-session-eligibility.test.ts \
  tests/recording-publication-ownership.test.ts \
  tests/recording-transport.test.ts \
  tests/recording.test.ts \
  tests/replay-clock.test.ts \
  tests/replay-endpoint-precision.test.ts \
  tests/replay-presentation.test.ts \
  tests/replay-seek-preparation.test.ts \
  tests/road-bike-replay-state.test.ts \
  tests/rotation-interpolation.test.ts \
  tests/session-identity.test.ts \
  tests/session-replay-lifecycle.test.ts \
  tests/session-review.test.ts \
  tests/snapshot-encoding-hotpath.test.ts \
  tests/snapshot-header-contract.test.ts \
  tests/snapshot-interpolation.test.ts \
  tests/wheel-contact-recording.test.ts \
  tests/wheel-pose.test.ts \
  tests/wheel-winding-recording.test.ts \
  tests/worker-rewind-ownership.test.ts \
  --reporter=default --reporter=json \
  --outputFile=/absolute/receipt-directory/vitest.json
```

For exact historical reproduction, use `selection-final.json` rather than rediscovering a later checkout's glob. The destination in the command above is a placeholder for a writable receipt folder. The actual output was `/workspace/scratch/e91efca799c8/validation/final-units-a49/vitest.json`.

## Frozen input identity

Each aggregate is SHA-256 of sorted `relative path + NUL + file SHA-256 + newline` records. Every digest below is identical before and after execution; full per-file membership and hashes are retained in `before.json` and `after.json`.

| Input group | Files | Identical before/after SHA-256 |
| --- | ---: | --- |
| All files under `src/` | 1126 | `5fea93841ed0da6949fe1dc2858c57f38b53595279222ab1550f74bfb6131096` |
| Selected acceptance test files | 165 | `b305e9790821c0849fc910046857d35c646a8be40f6cff56385eb07349270d14` |
| All files under `tests/` | 989 | `4224e460b044fc130bd02a69daa505a9dabc467135b858f288bbfbbd101d1917` |
| All files under `scripts/` | 343 | `7d7067a6e0d7812458b8eb13f23b8843f700b641f7da4dee804e0b5026987855` |
| All files under `public/` | 231 | `6f9a00284081e837412fb06bc26631aeb3faac31567b53a57460744351a08cea` |
| Complete captured input set | 2710 | `f985b369dd9bf56a9165a5134e3952dbba3a4fc22a8ed983b664bbc920c2fc0e` |

The selected-test row is a subset of the all-tests row. The group rows are not independent inventories to add together. The remaining 21 files in the complete set consist of package/configuration files, an imported review-data file, imported e2e helper fixtures and the two installed shader files. The manifest includes only those two specific installed package source files; it is not a hash of the whole `node_modules` tree. Node, Vitest and the unchanged package lock identify the recorded dependency environment.

### Package and configuration identity

| File | Identical before/after SHA-256 |
| --- | --- |
| `vitest.config.ts` | `c330c0a749e72759e4415b48a1a3edb676d12c9e96b0d4bc5bf0b156e1bcdaad` |
| `vite.config.ts` | `7cabe11545e6bca2cb6de84e4a2d0779011605573b7c99bbf8ae43f8417af629` |
| `package.json` | `8b869eba1bd88baa34bf8544e4cf955e055806a2ea6e63d747f62168ad6e9436` |
| `package-lock.json` | `610c1768c440c202a4e37f62d22467d4cbbddc44a5962e82bb256dcfb8627edf` |
| `tsconfig.json` | `3c60d83dfec002bd9a4294aac40331089021b7ded79a18f3a45b20cd1b55d0f9` |
| `eslint.config.js` | `956ed25a88a217e85ac11629a119ad551de49c3721f3020510d648725fb000c8` |

### Final late-regression identity

| Test file | Identical before/after SHA-256 |
| --- | --- |
| `tests/motocross-shoulder-load-continuity.test.ts` | `b8b414421d97c59e005723fb81f8ae4f756ae859a277efb79f01acfdf3754c21` |
| `tests/motocross-shift-extrema.test.ts` | `ce3f5ed0edc32e806509f2e34878d0f4f69f6cb562b2e32b85932e3a3a7cdecf` |
| `tests/motocross-camera-flight-origin.test.ts` | `4f28295c2246ac79e9dbbb646dc6d0f067461aac2d04c9f4293553f554c4163b` |
| `tests/motocross-motion-boundary.test.ts` | `64f7bb33545a2a60946fc06f880329dbeff9a8991af04cb716fdcaf4901cffa9` |
| `tests/motocross-riding.test.ts` | `f1d51d886210baadd8a85dd5b3828178b4954efca4a85b9108a91080c980f468` |

This report certifies the fingerprinted working-tree inputs actually executed. The coordinator is responsible for relating this fingerprint to the final committed and published tree. No Git operation was performed by A49.

## Build-output overlap review

Before the final run, a static TypeScript import/export, literal dynamic-import/require and literal-URL walk traversed **1,131 local files** reachable from the selection. A separate search inspected mutable build-output references and filesystem/process call sites. The selected direct filesystem reads inspect source text in the controller/free-roam contracts and two installed Three shader files. No selected contract was found to consume mutable `dist`, `dist-qa` or `dist-demo` output or invoke a build.

The three build-related textual matches in the local graph are the source `BUILD_IDENTITY` constant and two explanatory comments. They do not read the generated build identity or build output. The scan records two unresolved references to the same existing optional `src/rendering/models/supplied-player.glb.gz` URL; it was not generated or repaired. This static walk is a dependency review, not a claim that all possible runtime-computed imports have been exhaustively proven. All 165 selected files nevertheless collected and passed without such a generated asset.

The coordinator approved overlap with its final build on this evidence. The equal before/after manifests independently show that no recorded source, test, script, public asset, imported fixture or configuration input changed during acceptance. `dist` is intentionally not part of this source-input manifest.

## Evidence and limits

Complete task-local evidence is retained under `/workspace/scratch/e91efca799c8/validation/final-units-a49/`:

| Receipt | Purpose |
| --- | --- |
| `vitest.log`, `vitest.json` | Complete console output and machine-readable results from the one final invocation. |
| `receipt.json`, `environment.json` | Exact command, working directory, UTC interval, elapsed time, exit code, runtime versions and runner identity. |
| `selection-final.json` | The exact 165 selected files. |
| `before.json`, `after.json` | Complete 2,710-file input manifests and aggregate identities. |
| `summary.json`, `inventory.json`, `inventory.md`, `failures.json` | Checked distinct totals, file-level statuses, complete inventory and empty failure list. |
| `dependency-graph-final.json`, `dependency-final.log`, `dependency-scan.json` | Local dependency walk and reviewed build/filesystem references. |
| `run_final.py`, `dependencies.mjs`, `summarize.py` | Reproducible selection, execution, provenance and result-reconciliation tools. |
| `artifact-sha256.json` | SHA-256 of each of the principal raw evidence files. |

The console log SHA-256 is `bd67e2aabb561da66df22829b802b89aa6dc45582c03bca30b678a66722f3b7a`. The complete Vitest JSON SHA-256 is `c54ffca868e2f153423f08247a4e5b886a2e21f24987b634a2705cdda5e41c73`. The checked summary SHA-256 is `4f4d4854acb989f190f1327a1d9a5f4c080fbba4a2da9072b3f61374ad8434ed`.

This acceptance establishes the selected unit and CPU-rig contracts on the recorded source. It does not establish a green whole-repository CI run, native browser/GPU behavior, perceived animation quality, hardware performance or external motorcycle calibration. Those have separate evidence and ownership. [Assignment 42](42-baseline-ci.md) reproduced four unrelated pre-existing failures in APX livery, GP translations and GP catalogue/calibration on both the task baseline and current source; their files are outside this selection and remain disclosed.

A49 authored this report and task-local evidence only. It made no production, test, model, character, vehicle, environment, asset, calibration or Git change. Its one final Vitest process has ended, and assignment ownership is returned to the coordinator.

## Complete final test-file inventory

All rows below come from this invocation's JSON assertion results. The table contains exactly 165 distinct paths; its passed column totals 1,836.

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
| `tests/motocross-camera-flight-origin.test.ts` | 3 | 0 | 0 |
| `tests/motocross-camera-motion-ramp.test.ts` | 15 | 0 | 0 |
| `tests/motocross-camera-ramp.test.ts` | 6 | 0 | 0 |
| `tests/motocross-camera.test.ts` | 16 | 0 | 0 |
| `tests/motocross-castings.test.ts` | 22 | 0 | 0 |
| `tests/motocross-chain-drive.test.ts` | 22 | 0 | 0 |
| `tests/motocross-cockpit-view.test.ts` | 6 | 0 | 0 |
| `tests/motocross-collision.test.ts` | 14 | 0 | 0 |
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
| `tests/motocross-forgiving-handling.test.ts` | 18 | 0 | 0 |
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
| `tests/motocross-motion-boundary.test.ts` | 9 | 0 | 0 |
| `tests/motocross-mouldings.test.ts` | 23 | 0 | 0 |
| `tests/motocross-pass-and-ridges.test.ts` | 6 | 0 | 0 |
| `tests/motocross-photographic-light.test.ts` | 6 | 0 | 0 |
| `tests/motocross-plastic-wear.test.ts` | 1 | 0 | 0 |
| `tests/motocross-player-dynamics.test.ts` | 20 | 0 | 0 |
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
| `tests/motocross-riding.test.ts` | 27 | 0 | 0 |
| `tests/motocross-roost-budget.test.ts` | 1 | 0 | 0 |
| `tests/motocross-roost-contact.test.ts` | 15 | 0 | 0 |
| `tests/motocross-roost-deflector.test.ts` | 3 | 0 | 0 |
| `tests/motocross-rut-contact.test.ts` | 6 | 0 | 0 |
| `tests/motocross-screen-capture.test.ts` | 1 | 0 | 0 |
| `tests/motocross-shift-continuity.test.ts` | 5 | 0 | 0 |
| `tests/motocross-shift-extrema.test.ts` | 9 | 0 | 0 |
| `tests/motocross-shoulder-load-continuity.test.ts` | 2 | 0 | 0 |
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
| `tests/wheel-contact-recording.test.ts` | 10 | 0 | 0 |
| `tests/wheel-pose.test.ts` | 14 | 0 | 0 |
| `tests/wheel-winding-recording.test.ts` | 6 | 0 | 0 |
| `tests/worker-rewind-ownership.test.ts` | 3 | 0 | 0 |
