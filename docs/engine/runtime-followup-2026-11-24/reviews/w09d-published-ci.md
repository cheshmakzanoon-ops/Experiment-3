# Worker 52 — published CI verification and comparative triage

Prepared 2026-11-25 04:28:40 UTC. Final whole-run status snapshot fetched at approximately **04:26:12 UTC**; completed-job logs were inspected through 04:28:40 UTC. These are dated observations, not a promise about later queued work.

Assignment: Wave 9, worker 52 of the requested 60. Read-only investigation of published validation. No repository edit, Git mutation, build, test, browser launch, workflow rerun, or external message was performed. Evidence and this handoff are outside the repository.

## Decision and immediate handoff

**Checkpoint 7's focused engine gate is independently verified green, but broader CI is not green.** The four complete broad unit partitions have **9,558 passed / 39 failed tests across 901 files (8 failing files)**. The broader build workflow still has active/queued work. Three other completed workflows failed.

One additional engine contract mismatch was discovered beyond the coordinator's known 34 fixture failures: **`tests/surface-channel-backpressure.test.ts:569` expects a second surface packet after a failed post and acknowledgement; checkpoint 7 produces one**. This unchanged test passed on the source-equivalent task baseline. It needs worker 49/55 triage before claiming the fixture follow-up closes all observed engine failures. This finding was sent to the coordinator immediately. I did not change the test or infer a fix.

The originally reported local 127-file gate remains a separate **1,803 passed / 34 failed** result for this handoff. Fixture corrections and their later validation belong to the coordinator/worker 49. No local green result or future published checkpoint is claimed here.

## 1. Exact source and focused artifact identity

| Identity | Verified value |
| --- | --- |
| Repository | `cheshmakzanoon-ops/Experiment-3` |
| Task baseline | `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb` |
| Published checkpoint 7 | [`6a6bf02eb2d89eeb6aeff32769ef3deb4a49f17c`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/6a6bf02eb2d89eeb6aeff32769ef3deb4a49f17c) |
| Published source tree | `e6d37727eb695278c4934fa11365d6d014c40db6` |
| Focused run / attempt | [45544501843](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501843) / 1 |
| Focused job | [138970726127 — native-and-replay](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501843/job/138970726127) |
| Run conclusion | completed / success; updated 2026-11-25 04:13:07 UTC |
| Evidence artifact | [14991351752](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501843/artifacts/14991351752), `engine-runtime-validation-6a6bf02eb2d89eeb6aeff32769ef3deb4a49f17c` |
| Artifact bytes / SHA-256 | 1,177,991 / `2608ddd2b50c5ac52600f8c3a273b47c9b266418cca7df276c7b7363571eafaa` |
| Artifact expiry | 2026-12-02 04:13:03 UTC, unexpired when inspected |
| Embedded build identity | commit matches checkpoint 7; variant `product`, edition `full` |
| Build fingerprint | `c504fad0736d361bbeb79bf6ef4d64bafe2200329c064525c5dc60066729d7fe` |
| Embedded package-lock SHA-256 | `610c1768c440c202a4e37f62d22467d4cbbddc44a5962e82bb256dcfb8627edf` |

I re-fetched the job log independently. It is byte-identical to the coordinator's `checkpoint7-ci.log`: 118,930 bytes, SHA-256 `f1229539d4bb9bb1ec000d9e93375f912eb429653ba0a95317e4a666251b07bb`. I downloaded the focused ZIP, computed its full SHA-256, inspected its manifest, and read its commit, tree, lock, build-identity and browser receipts. The API digest, uploaded digest and downloaded bytes agree. The replay's attached diagnostic build identity also agrees with the product build.

### Focused completed validation matrix

All rows below refer to the exact [focused job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501843/job/138970726127).

| Gate | Actual evidence | Qualification |
| --- | --- | --- |
| Locked dependency installation | Step succeeded under the source-stability guard | npm ci, no install/test/build rerun by this worker |
| Engine unit contracts | 449 passed, 38 files; 82.81 seconds | `tests/engine-*.test.ts` selection only |
| TypeScript | `tsc --noEmit` completed successfully | Whole-project compiler, 4,096 MB configured heap |
| Production build | Direct Vite production build succeeded; embedded build identity retained | Direct compiler/build invocation bypassed npm prebuild/pretest model-generation hooks |
| Browser contracts and replay | 37 passed across 9 files; report has 37 expected, 0 unexpected, 0 flaky, 0 skipped | 36 native focused cases plus one full-game replay ownership journey |
| Source guards | Guarded dependency, unit, build and browser commands returned success | Guard scope/exclusions below |
| Evidence upload | Successful and independently downloaded | 7-day retention |

The exact unit command is:

```sh
node --experimental-transform-types scripts/source-stability.ts -- \
  node node_modules/vitest/vitest.mjs run tests/engine-*.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0
```

It ran with `NODE_OPTIONS=--max-old-space-size=1024`. The shell used `set -euo pipefail`; piping through tee cannot hide a failing command.

The compiler/build command was:

```sh
node --experimental-transform-types scripts/source-stability.ts -- bash -c \
  'node node_modules/typescript/bin/tsc --noEmit && node node_modules/vite/bin/vite.js build'
```

The browser command selected `e2e/engine-native-*.spec.ts e2e/replay-state.spec.ts`, with `--workers=1 --retries=0 --forbid-only`, under source stability and Xvfb. Neither retries nor a permissive continuation converted failures into success. The replay retains its 300,000 ms deadline and existing low-quality, zero-opponent rainy practice workload; no high-quality/full-grid claim follows from it.

The inspected replay assertions cover an actual 8,500 ms main-thread stall, continued worker recording, first submitted seek-frame ownership, modal and focus suspension, audio state, endpoint pause/restart, unchanged authoritative frame, and zero console/page errors. Artifact observations were telemetry **480 → 960**, replay **7.9333333969 → 15.9333343506 seconds**, and no recording warnings during the stall. The first seek observation saw presentation frames **22 → 23**, position **0.75**, in one callback; final held replay position was 0 with no warnings. These are correctness observations, not throughput measurements.

### Source and capability exclusions

The guard hashes `src`, `public`, `scripts`, `tests`, `e2e`, `docs`, `.github`, and root files, including executable mode and symlink target. It compares each invocation's input and output; it is not a historical baseline content audit. It explicitly excludes `public/models/supplied-player-lods.bin.gz` and root `browser-backend.json`/`browser-progress.json`; output directories such as dist and node_modules are outside its directory set. Consequently, a passing guard must not be described as proof that every possible authored or generated asset remained unchanged.

The CI Node process was **22.23.5**. The verified renderer was **ANGLE (Mesa, llvmpipe (LLVM 20.1.2 256 bits), OpenGL 4.5)**. The artifact says `softwareRendererDetected: true`, `physicalHardwareValidated: false`, with the backend probe returning expected pixel bytes and error 0. This does not establish physical-GPU FPS, frame pacing, VRAM, browser peak heap/GC, gamepad hardware, other browsers, OSes, or whole-engine performance gains.

No authored models, characters, environments, geometry/material/texture definitions, assets, or tuning were changed by this worker. The independent protected-content audit is a different assignment.

## 2. Whole-run status snapshot

All 20 rows below have `head_sha=6a6bf02eb2d89eeb6aeff32769ef3deb4a49f17c`. The API query used an exact SHA and per_page=100; total_count=20. At 04:26:12 UTC there were **6 success, 3 failure, 2 cancelled, 2 skipped, 5 in progress and 2 queued** runs. Two successes are report-generation workflows.

| Workflow / direct link | Run ID | API status | Conclusion |
| --- | --- | --- | --- |
| [CI report](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45545071626) | 45545071626 | completed | success |
| [CI report](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544573876) | 45544573876 | completed | success |
| [Deploy MOTOBOUND playable website](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544572247) | 45544572247 | completed | skipped |
| [Publish validated playable release](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544571926) | 45544571926 | completed | skipped |
| [Settings transition validation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501280) | 45544501280 | completed | success |
| [Settings interaction validation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501165) | 45544501165 | in_progress | — |
| [Focused engine runtime validation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501843) | 45544501843 | completed | success |
| [Graphics advancement GPU evidence](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501688) | 45544501688 | completed | failure |
| [Solvane R2 source validation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501602) | 45544501602 | in_progress | — |
| [Cockpit framing evidence](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501087) | 45544501087 | in_progress | — |
| [A12 secondary-stand validation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501509) | 45544501509 | in_progress | — |
| [Horizon driving and optics review](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501156) | 45544501156 | in_progress | — |
| [Benchmark smoke](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501290) | 45544501290 | completed | success |
| [Scenery shadow budget](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501263) | 45544501263 | completed | failure |
| [Motocross committed-source review](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501596) | 45544501596 | queued | — |
| [Build and validation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501716) | 45544501716 | queued | — |
| [A51-A54 vegetation validation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501657) | 45544501657 | completed | cancelled |
| [MotoGP focused review](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501461) | 45544501461 | completed | success |
| [A22 garage integration validation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501476) | 45544501476 | completed | failure |
| [A55-A60 Quarry validation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501659) | 45544501659 | completed | cancelled |

GitHub's aggregate `queued` status for Build and validation and Motocross does not mean no work ran: both already had completed and active jobs. A successful CI report job publishes a status report; it is not a successful validation suite. Skipped deployment/release workflows are not completed deployment proof. Cancelled vegetation/quarry workflows have no pass conclusion.

### Broad Build and validation: completed jobs and outstanding work

[Run 45544501716](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501716) had 28 materialized jobs at the snapshot:

| Job | Status / result |
| --- | --- |
| [validate / 138970922214](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501716/job/138970922214) | completed / success, including lint/content/typecheck/build, IP guard, demo/static builds and source preservation |
| [offroad-scenarios / 138970921752](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501716/job/138970921752) | completed / success |
| [unit-tests (1) / 138970922124](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501716/job/138970922124) | 2 failed / 2,431 passed; 2 failing files / 226 total |
| [unit-tests (2) / 138970922114](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501716/job/138970922114) | 2,418 passed; 226 files |
| [unit-tests (3) / 138970922195](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501716/job/138970922195) | 16 failed / 2,480 passed; 3 failing files / 226 total |
| [unit-tests (4) / 138970922130](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501716/job/138970922130) | 21 failed / 2,229 passed; 3 failing files / 223 total |
| [scenarios / 138970922103](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501716/job/138970922103) | in progress; no final pass claimed |
| 4 owner-QA jobs | in progress |
| 16 browser partitions | 5 in progress, 11 queued |
| wet-presentation | queued |

The completed unit failures comprise **32 renderer partial-fixture failures**, **2 circuit-frame terminal-worker expectation failures**, **4 independently baseline-established content/i18n failures**, and the **1 newly surfaced surface-backpressure expectation failure**. The first 34 were already assigned to fixture/contract correction; this report does not certify those changes.

The four content failures have actual matching baseline logs: livery `turned-alloy` expectation; gpr1 catalogue/calibration hashes `eca1c71a` versus `5f121c00`; missing i18n keys; and the corresponding frozen catalogue growth hash. Baseline source-equivalent jobs [138728088710](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/job/138728088710) and [138728088792](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/job/138728088792) fail those same assertions. Their test blobs are unchanged. I did not update protected data, hashes, or dictionaries to make the suite pass.

The surface mismatch is in [job 138970922130](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501716/job/138970922130), `tests/surface-channel-backpressure.test.ts:569`: “rebases real terrain after a failed post consumed its incremental change set,” expected 2 packets, received 1. The baseline-equivalent [job 138728088940](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/job/138728088940) passes all 14 tests in that unchanged file. That establishes a new contract/test result difference relative to baseline, without deciding whether the implementation or an obsolete recovery expectation is responsible.

Older broad runs for checkpoints 1–6 were completed **cancelled**, including [45522566622](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45522566622), [45524663074](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45524663074), [45529184009](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45529184009), [45534027944](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45534027944), [45537564277](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45537564277) and [45541153568](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45541153568). They are not whole-suite pass evidence. The broad workflow uses branch-scoped cancel-in-progress concurrency; the focused workflow is commit-scoped and does not cancel an earlier commit's focused run.

## 3. Baseline proof and browser failure comparison

Exact task baseline `1c609...` has **zero workflow runs**. Its ancestry and root tree were fetched through GitHub. Its source-equivalent predecessor is **`a3f4d81900a07700c128ee84a588dcfd20659ee4`**, tree `45e30a68136f4bbbd2738e2446dc22eaf8ba776a`. All **31 root entries** are identical to baseline tree `9be30d69c06ac08f9eec038334ad0f8bbd65b13b` except the `ci-reports` directory. Thus the predecessor's production source, tests, workflows, lockfile, assets and configuration match the task baseline.

That source-equivalent [Build and validation run 45473620366](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366) completed with failure on 2026-11-24. The baseline report itself links it. The four reviewed graphics/scenery specs, race-entry helper, Playwright config, browser-backend implementation/setup, graphics/scenery workflows and lockfile have identical blob IDs across baseline and checkpoints 3, 4, 5, 6 and 7. The two garage specs and four content unit specs were also checked individually.

| Checkpoint 7 symptom | Current exact job | Actual comparison | Classification |
| --- | --- | --- | --- |
| High journey: expected `paused`, received `loading`; 90 s predicate timeout at graphics-high-journey:698 | [138970725628](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501688/job/138970725628) | Baseline-equivalent browser (1), [138730047979](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/job/138730047979), same value/line/deadline | Established on task-equivalent baseline |
| Escape pause: expected `{pending:false, paused:true}`, got `paused:false`; 60 s at compact race journey:85 | [138970725874](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501688/job/138970725874) | Baseline-equivalent browser (3), [138730047969](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/job/138730047969), identical symptom | Established on task-equivalent baseline |
| Terrain morph quarter max error 0.3416664796083448 versus <0.001 at terrain-morph-contract:67 | [138970726025](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501688/job/138970726025) | Baseline-equivalent browser (6), [138730047822](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/job/138730047822), identical numeric result | Established on task-equivalent baseline; current GPU job has 6 other passes |
| Night scenery survey: 300,000 ms timeout inside page.evaluate at scenery-shadow-budget:42 | [138970724148](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501263/job/138970724148) | Baseline-equivalent browser (15), [138730048197](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/job/138730048197), passed; checkpoint 4 night [138936090359](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45534028001/job/138936090359) also passed | Mixed history; cause unresolved, not a proven failing-baseline case |
| Aurel normal startup and garage startup remain loading after 240 s in finishRaceEntry | [138970724672](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501476/job/138970724672) | Baseline-equivalent [browser (10)](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/job/138730047877) and [browser (12)](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/job/138730047932) fail the same respective startup cases | Established on task-equivalent baseline |

All three graphics symptoms also appear at checkpoint 4 [45534027914](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45534027914). Those are prior follow-up failures, separate from the stronger task-equivalent baseline proof above.

The same night timeout occurred **before** the task baseline at source `93416f81c9bfe4f1df894888bd7c03d904b64058`, [run 45469677088 / job 138713911270](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45469677088/job/138713911270). This is evidence of a prior occurrence, not proof that checkpoint 7's cause is environmental or that it was failing on the task baseline. Current day and sunset scenery jobs passed. No tolerance, timeout or quality setting was weakened.

### Night trace inspection without a browser

The current night artifact contains the same 41,092,563-byte trace twice. I used HTTP ranges to extract only the specific test trace and small backend/progress receipts, avoiding a full duplicate archive download. The extracted ZIP passes its member CRC and has SHA-256 **`8227351c0047d0214eb86d386a08baf0f8a86b66673e3fa301f679c7717efbc6`**.

The browser trace identifies the unfinished operation as:

```js
l => window.ShadowBudget.sceneryShadowBudget(l) // argument: "night"
```

Navigation and script injection completed first. The browser trace has that evaluateExpression call without an after event; the test trace ends it with the 300,000 ms deadline error. The browser trace contains no recorded page/console error identifying a smaller failing operation. The backend receipt is the same Mesa llvmpipe software renderer, with physicalHardwareValidated=false. The trace narrows the blocked operation to the full survey invocation, but does not establish the internal stall mechanism or distinguish a performance/environment timeout from a production defect.

Trace: `w09d-work/scenery-night-selected/trace.zip`; parsed evidence: `trace-summary.json`, `trace-manifest.json`, `browser-backend.json`, `browser-progress.json` in the same directory.

## 4. Retained failure artifacts and evidence index

These are direct artifact links and API-reported digests. Except for the focused artifact, the complete outer failure ZIPs were not independently hashed. Only the specific night trace was extracted. Large graphics/baseline trace archives were not downloaded into the worker evidence directory to duplicate already sufficient baseline log evidence.

| Artifact | Bytes | SHA-256 from API |
| --- | ---: | --- |
| [Current high, 14991386515](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501688/artifacts/14991386515) | 107,081,476 | `1abf48345f84d39d5e35613ab57b144f701865865d323d83312b01ae5971113b` |
| [Current gameplay, 14991386875](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501688/artifacts/14991386875) | 129,553,027 | `fd06d6ff67a06fc1ca9c1dcbcab1bfb3f10419593e7dba2682e9c7e19eb03e67` |
| [Current GPU, 14991491705](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501688/artifacts/14991491705) | 3,191,151 | `55bb7bf5981077c4ed233f81a3cc720b7d0e1812463d1124e9676b5c19599217` |
| [Current night, 14990648863](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501263/artifacts/14990648863) | 81,422,108 | `4c68d3b8fb854078ef4885c045de36799b2f54be8e61d2a0da8966e69ebc78cc` |
| [Baseline browser 1, 14964661833](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/artifacts/14964661833) | 691,371,007 | `7059d4200eff082f115ee22e199368563000ab0a6299cce4a1d77b2c73347818` |
| [Baseline browser 3, 14963259410](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/artifacts/14963259410) | 466,148,121 | `07fb4a3e09eb4e877752ee1ba9a8ae0234ba0d02f88d4ac0435f7cbb9211cae1` |
| [Baseline browser 6, 14964731390](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/artifacts/14964731390) | 511,715,506 | `707f52b5c3deb6621defd20a9942e6094dacfe2b8c66cdb1cc15a9cb217dafa9` |
| [Baseline browser 15, 14962906731](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/artifacts/14962906731) | 411,915,874 | `9cf145c00dd95209428fc36e465fc7a32a96ea25964ccfeaef5f5882a491668e` |

All evidence is under `/tmp/engine-c71f32882729/w09d-work/`:

- Exact focused run/jobs/artifact API records, independently fetched raw job log, downloaded focused ZIP, artifact manifest, embedded identity receipts, Playwright summary, stall and replay attachment JSON.
- `checkpoint7-runs-final.json`, `checkpoint7-build-jobs-final.json`, `checkpoint7-unit-summary.json`, and full current unit/garage logs.
- Baseline commit/ancestry, root-tree pair and `baseline-source-equivalence.json`; exact-baseline zero-run response; baseline CI report and all 16 baseline browser logs.
- `spec-identity-comparison.json` and `additional-test-identities.json` contain read-only Git tree blob comparisons, performed with `GIT_NO_LAZY_FETCH=1` and `-c protocol.allow=never`.
- Current graphics/scenery logs, selected prebaseline and checkpoint-4 logs, artifact metadata/URLs/digests, and the specific current night trace.
- Exact checkpoint-7 workflow, source guard, Playwright config, replay spec and broad CI workflow snapshots under `source/`.

No compute lease was requested or consumed. This first handoff is complete; a later fixture checkpoint must receive its own exact-SHA validation and must include the newly observed surface-channel contract before a final engine regression claim.

