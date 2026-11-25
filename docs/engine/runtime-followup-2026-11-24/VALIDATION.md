# Validation and evidence matrix

[Report index](README.md) · [Implementation](IMPLEMENTATION.md) · [Wave 9](WAVE09.md)

**Final verification status, 25 November 2026:** final expanded units, all five local static/build checks, all 37 local native/replay cases and focused CI for checkpoint 9 have passed. All sixty distinct assignments and the final source, claim and acceptance reviews are complete. Checkpoint 9 remains the tested code/test revision; checkpoints 8/9 preserve checkpoint-7 production source. The documentation-only publication and its subsequent remote verification are identified separately in [commit history](COMMIT-HISTORY.md#documentation-publication). Latest inspected broader-CI status is dated 05:06:13 UTC.

## How to read the evidence

A **physical file** is a selected test file, not a nested Vitest suite. Totals below belong to individual runs/selections. Repeated gates, their constituent domain runs, browser cases and measurement fixtures overlap or use different units; do not add them into a unique programme total.

“Exact baseline” means actual source from task commit `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`. “Task-equivalent baseline CI” means the verified predecessor whose root entries differ only in `ci-reports`. “Native” means actual Chromium APIs, including software WebGL; it does not mean physical-device validation.

## Published and local gate matrix

| Source / gate | Observed result | Scope and primary evidence |
| --- | --- | --- |
| Checkpoint 2, `5185010` | Compiler/build and 13 prior native/replay cases passed | [Exact CI job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45524663222/job/138904894928); early tests were a smaller selection than later gates |
| Checkpoint 3, `25a8375` | Compiler/build and 13 native/replay cases passed | [Exact CI job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45529184065/job/138919948043) |
| Checkpoint 4, `f4d41b0` | Compiler/build and 13 prior native/replay cases passed | [Exact CI job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45534027941/job/138936089887) |
| Local initial consolidated gate before checkpoint 5 | 381 passed / 2 failed of 383, 32 files | Retained in [Wave 6](WAVE-06.md#focused-ci-gate); two obsolete post-terminal publication expectations were corrected with clock conservation retained |
| Local corrected gate before checkpoint 5 | 383/383, 32/32 files | 73.84 s; separate rerun, not relabeling the failed run |
| Checkpoint 5, `0f7fecf` | 383/383 unit cases, 32 files; 37 browser cases, nine files; TypeScript/build passed | [Exact CI job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45537564336/job/138947807393); [retained metadata](validation/checkpoint5-ci.json) |
| Checkpoint 7, `6a6bf02`, focused CI | **449/449 unit cases, 38 files; 37/37 browser cases, nine files; TypeScript/build passed** | [Exact job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501843/job/138970726127); independently checked source/build/artifact identities |
| Checkpoint 7, initial expanded local gate | **1,803 passed / 34 failed of 1,837**, 124 passing / three failing files, 127 selected | No skips/retries/duplicate or unexpected selected files; [raw result summary](validation/w09a-initial-results.json) |
| Exact task baseline, original three failing files | 42/42 passed | Source reconstructed from 1,124 blob-verified files; [baseline result](validation/w09a-baseline-results.json) |
| Corrected three fixture files, subsequently checkpoint 8 | **42/42 passed**, scoped lint passed | No production differences; [correction result](validation/w09a-corrected-fixtures.json) |
| Checkpoint 8, unchanged surface file | 13/14 passed, one failure | Guarded run at 04:31:13 UTC; [comparison receipt](validation/w09a-surface-comparison.json) |
| Exact task baseline, unchanged surface file | 14/14 passed | Guarded run at 04:31:24 UTC; same receipt; baseline reconstruction contains 1,125 verified files |
| Surface fixture correction, subsequently checkpoint 9 | **15/15 passed**, scoped lint passed | New direct SurfaceChannel/actual deformed Simulation case; [targeted receipt](validation/w09a-surface-correction.json) |
| Checkpoint 9, final expanded local gate | **1,852/1,852 passed, 128/128 unique physical files** | Zero failures/skips/TODOs/retries; completed 04:42:19 UTC in 330.01 s including guard; [exact result](validation/w09a-final-results.json) |
| Final local static/build gate, checkpoint 9 | **All five checks passed**, completed 04:49:09 UTC | Full configured ESLint, TypeScript, direct Vite product build, bundle/IP checks; exact product/full build identity and unchanged guarded inputs; [manifest](validation/w09b-static-build-manifest.json) |
| Final local native/replay gate, checkpoint 9 | **37/37 cases, nine files; zero failures/skips/flaky/retries** | Exact worker50 product dist, SwiftShader, original assertions/deadlines; [gate receipt](validation/w09c-native-gate-manifest.json) |
| Checkpoint 9 focused CI | **506/506 unit cases, 42 files; 37/37 native/replay; TypeScript/build/source guards passed** | [Exact job 138981642796](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850414/job/138981642796); [metadata](validation/checkpoint9-ci.json) |
| Checkpoint 9 broad units, retained in the 05:06:13 UTC inspection | **9,594 passed / four failed of 9,598**, 901 files; 897 passing / four failing files | Only the four baseline-established content/i18n failures remain; none of the 35 task-associated differences remains. [Independent reconciliation](validation/w10e-broad-unit-reconciliation.json) |
| Wave 10 final acceptance | **Completed for the frozen engine implementation and bounded evidence claims; all 60 original assignments complete** | [Final acceptance](reviews/w10f-final-acceptance.md), [source review](reviews/w10d-final-engine-review.md), [claim audit](reviews/w10b-performance-claims.md), [synchronized ledger](TASKS.md). Documentation publication receives separate subsequent verification. |

The local expanded gate and focused CI are distinct completed selections with overlapping cases. Their 1,852 and 506 counts must not be added together. The two completed browser runs exercise the same 37 cases on different software backends; they are not 74 unique cases.

## Retained fixture failures and corrections

The initial 34 failures are not independently established baseline failures: every original failed assertion passes on the actual task baseline.

| Original file | Initial candidate | Exact baseline | Correction |
| --- | --- | --- | --- |
| [circuit-frame-transport](../../../tests/circuit-frame-transport.test.ts) | 3 passed / 2 failed | 5/5 | Require terminal failure with no stale publication/resume, then successful fresh initialization and valid buffer-return recovery |
| [circuit-preparation-lifetime](../../../tests/circuit-preparation-lifetime.test.ts) | 5 passed / 14 failed | 19/19 | Supply a real owned OutputPass and retain cleanup/error/cancellation assertions |
| [festival-renderer-loader-lifecycle](../../../tests/festival-renderer-loader-lifecycle.test.ts) | 0 passed / 18 failed | 18/18 | Supply owned sky geometry/material, near-shadow and output pass; assert exactly-once disposal |
| [surface-channel-backpressure](../../../tests/surface-channel-backpressure.test.ts), outside initial 127-file selection | 13 passed / 1 failed | 14/14 | Align worker recovery with terminal ownership while preserving direct full-rebase behavior on the same actual deformed terrain |

The three-file correction retains 42 cases. The surface correction adds a fifteenth case rather than removing the direct same-terrain contract. No production source, quality, retry or timeout adjustment is needed for these corrections. [Worker49 final handoff with retained history](reviews/w09a-consolidated-gate.md); [per-failure baseline classification](validation/w09a-failure-classification.json). Worker55 independently correlates all 39 observed broad failures with zero unmatched names. [Review](reviews/w10a-regression-triage.md); [correlation](validation/w10a-failure-correlation.json).

## Checkpoint-9 completed gate identity

| Identity | Value |
| --- | --- |
| Commit / tree | `9119c7683d821d145f15ed64a03ee3406595b58d` / `3b704f846c3283c21e73f8f5c3febf670a773c63` |
| Local expanded run | 04:36:49–04:42:19 UTC; 1,852 passed / zero failed, 128 unique physical files |
| Guarded inputs | 3,396 unchanged; digest `ed8f00d74c656abd95f0e5d54fcdafe31a222baec37bc0846c3d123ee943006b` |
| Production identity | All 1,116 src files still match checkpoint 7 |
| Published focused run / job | [45547850414 / 138981642796](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850414/job/138981642796), completed/success |
| Focused unit result | 506 passed in 42 files; 97.03 s |
| Browser result | 37 passed in 2.5 minutes; verified ANGLE Mesa llvmpipe LLVM 20.1.2, OpenGL 4.5 |
| Compiler / product build / guards | Passed |
| Artifact | [14993021540](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850414/artifacts/14993021540), 1,178,621 bytes |
| Independently downloaded artifact SHA-256 | `8653a669dac50a9d0d8ffce104b1b703b0083e227960f0f922bbbbb6aeb5297f`; API, upload log and downloaded bytes agree |

The retained coordinator [CI summary](validation/checkpoint9-ci.json) and [local consolidated record](validation/w09a-consolidated-validation.json) identify these completed results. Worker59 subsequently downloaded and independently hashed the **exact checkpoint-9 artifact**, verified outer and embedded ZIP CRCs, and matched its commit/tree, product/full identity, build fingerprint and lockfile hash. It also independently fetched the 121,523-byte job log and checked every detailed browser result: 37 expected, zero unexpected/flaky/skipped/errors, one passing attempt at retry zero per case. [Independent review](reviews/w10e-publication-verification.md); [archive manifest](validation/w10e-artifact-archive-manifest.json); [focused evidence receipt](validation/w10e-focused-evidence-review.json).

The final Mesa browser run took 149.156 seconds, including a 106.465-second replay. Its 8,500 ms stall retained telemetry 420→960 and replay 6.9333333969→15.9333343506 seconds without warnings; its first seek advances frames **21→22**. The separate local SwiftShader run below advances **9→10**. These source-pinned correctness observations are kept with their own backend/run and are not combined into additional unique cases. [Mesa stall receipt](validation/w10e-recording-stall-continuity.json); [parsed browser report](validation/w10e-playwright-report.json).

## Completed local static and build gate

Worker50's raw manifest records a successful sequence from **04:47:36 to 04:49:09 UTC** on exact checkpoint 9. All five guarded commands returned exit 0: ESLint over src/tests/e2e/scripts, `tsc --noEmit`, direct Vite product build, bundle budget and IP guard. No guarded source path changed. The product/full build's commit matches checkpoint 9 and its fingerprint is `c504fad0736d361bbeb79bf6ef4d64bafe2200329c064525c5dc60066729d7fe`.

The dist receipt contains **266 files / 135,848,008 bytes**, manifest SHA-256 `78d3adc808eda6f274157a8d7a51146e02cdf508d5454217b2c3a5684b9cea65`. Vite reports 13.57 seconds for its build and retains the existing >500 kB chunk warning. The bundle report gives 3.78 MiB initial gzip against the unchanged 4 MiB budget (the script labels these units MB). The IP check is certified with no problems across 75 scanned text/GLB-name inputs and 113 tolerated internal-identifier hits. These are build/budget results, not runtime performance measurements.

Runtime was Node 24.22.3 / V8 13.6 with a 4,096 MiB old-space limit. The configured compiler retains existing `skipLibCheck`; no broader dependency-declaration checking is implied. [Raw manifest](validation/w09b-static-build-manifest.json), [build log](validation/w09b-build.log), [bundle](validation/w09b-bundle.log), [IP](validation/w09b-ip.log). The [final worker50 handoff](reviews/w09b-static-build.md) reconciles its original preparation state with these completed results. Each runner's aggregate source digest uses its documented serialization; before/after equality and file identities are the relevant invariants, not equality between differently serialized aggregates.

## Completed local native and replay gate

Worker51 ran the unchanged **37 cases across nine files** once against worker50's exact product build. All passed, with zero unexpected, skipped, flaky or retried cases. Playwright recorded **175.753 seconds** total; the full-game replay took **133.586 seconds**, within its unchanged 300-second deadline. The served commit and build fingerprint match checkpoint 9; all **3,396 guarded source paths** and **266 dist files** are byte-identical before and after. The worker stopped only its own direct Vite preview. [Final handoff](reviews/w09c-native-final.md); [manifest](validation/w09c-native-gate-manifest.json); [case results](validation/w09c-case-results.json).

Chromium **140.0.7339.186** verified ANGLE Vulkan SwiftShader WebGL2 with probe pixel `[64,128,191,255]` and GL error zero. The native cases cover actual workers, structured transfers, IndexedDB, Canvas/WebGL resources and AudioContext behavior. A genuine suspended-to-running resume schedules the fresh audio request and suppresses the stale one. Exact CSV output, transfer, cancellation and replacement ownership checks pass. These are fixture-scoped native API and software-renderer observations, not physical-device performance results. [Backend receipt](validation/w09c-browser-backend.json).

During the deliberate **8,500 ms main-thread stall**, worker recording continued: telemetry **420 → 960 rows** and replay **6.9333333969 → 15.9333343506 seconds**, with no recording warnings. Seeking to **0.75 seconds** submitted exactly one new presentation frame (**9 → 10**) with **zero presentation-time error**. The existing low-quality, zero-opponent rainy-practice workload, seek assertions, deadlines and zero-retry policy were unchanged. [Stall evidence](validation/w09c-recording-stall.json); [replay ownership evidence](validation/w09c-replay-ownership.json).

## Checkpoint-7 focused CI identity

Independent inspection completed on **25 November 2026 at 04:28:40 UTC**, with whole-run status fetched at about **04:26:12 UTC**.

| Identity | Value |
| --- | --- |
| Commit / tree | `6a6bf02eb2d89eeb6aeff32769ef3deb4a49f17c` / `e6d37727eb695278c4934fa11365d6d014c40db6` |
| Run / attempt / job | `45544501843` / 1 / `138970726127` |
| Completed update | 2026-11-25 04:13:07 UTC |
| Artifact | [14991351752](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501843/artifacts/14991351752), 1,177,991 bytes |
| Downloaded artifact SHA-256 | `2608ddd2b50c5ac52600f8c3a273b47c9b266418cca7df276c7b7363571eafaa` |
| Product build fingerprint | `c504fad0736d361bbeb79bf6ef4d64bafe2200329c064525c5dc60066729d7fe` |
| Node / backend | Node 22.23.5; ANGLE Mesa llvmpipe LLVM 20.1.2, OpenGL 4.5 |
| Browser result | 37 expected, zero unexpected/flaky/skipped; 36 native cases plus one full replay |
| Unit duration | 82.81 seconds; a validation duration, not engine throughput |

The replay retains its **300,000 ms deadline**, **8,500 ms genuine main-thread stall**, and low-quality/zero-opponent rainy-practice settings. The exact checkpoint-7 attachment observes telemetry 480→960 rows and replay 7.9333333969→15.9333343506 seconds during the stall, with no recording warnings. The first requested 0.75-second seek submits one presentation frame. Earlier local replay observations have different starting counts and are not mixed into this CI run.

The workflow uses direct installed executables, source guards, `--allowOnly=false --retry=0` for units, and `--workers=1 --retries=0 --forbid-only` for browser tests. [Full independently retained CI review](reviews/w09d-published-ci.md).

## Broader repository CI

### Latest checkpoint-9 result

All four broad unit shards for [run 45547850446](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850446) completed before the initial **04:55:10 UTC** unit snapshot. Worker59 independently retained and reconciled the result in its latest **05:06:13 UTC** inspection: **9,594 passed / four failed, 9,598 total cases across 901 physical files**, with 897 passing / four failing files. The remaining failed files are `apx01-livery`, `vehicle-catalogue`, `i18n` and `vehicle-catalogue-growth`; they are the same four baseline-established cases discussed below. All 35 observed task-associated fixture/terminal-contract failures are absent from this final result.

| Shard | Observed cases | Physical files | Exact job |
| ---: | --- | ---: | --- |
| 1 | 2,431 passed / two failed | 226 | [138981755573](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850446/job/138981755573) |
| 2 | 2,418 passed | 226 | [138981755831](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850446/job/138981755831) |
| 3 | 2,494 passed / two failed | 226 | [138981755850](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850446/job/138981755850) |
| 4 | 2,251 passed | 223 | [138981755930](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850446/job/138981755930) |

The coordinator fetched the shard logs, and worker59 independently parsed and hashed them. At **05:06:13 UTC**, the complete 28-job snapshot had six successes (validate, offroad-scenarios, scenarios, wet-presentation and unit shards 2/4), two failures (unit shards 1/3), and **16 browser plus four owner-QA jobs still active**, with none queued. This is not an all-green repository conclusion. [Latest status](validation/w10e-broad-status-summary.json); [log review](validation/w10e-broad-unit-log-review.json); [failure reconciliation](validation/w10e-broad-unit-reconciliation.json). These broad cases overlap the 1,852-case local selection and 506-case focused CI and are never added to them.

### Historical checkpoint-7 result and classification

The checkpoint-7 status snapshot is **not a whole-repository pass**. Four completed broad unit partitions report **9,558 passed / 39 failed across 901 physical files**, with eight failing files. Those partitions are disjoint within that run, but overlap the focused/local gates above. [Partition summaries](validation/w09d-broad-unit-summary.json); [broad workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501716).

The 39 failures split into:

| Count | Classification |
| ---: | --- |
| 32 | Partial renderer fixtures missing the newly disposed resource owners |
| 2 | Circuit frame expectations that allowed resuming after fatal worker failure |
| 1 | Surface publication expectation after terminal worker failure |
| 4 | Livery, catalogue/calibration and i18n assertions with matching task-equivalent baseline failures |

Exact task baseline has no workflow run. The reviewer verified its source-equivalent predecessor `a3f4d81900a07700c128ee84a588dcfd20659ee4`: all **31 root entries** match except `ci-reports`. This supports using [baseline run 45473620366](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366) for those source/test comparisons. [Equivalence receipt](validation/w09d-baseline-source-equivalence.json).

| Checkpoint-7 browser symptom | Current evidence | Baseline comparison and disposition |
| --- | --- | --- |
| High graphics journey: expected paused, received loading at the same 90 s predicate | [Job 138970725628](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501688/job/138970725628) | [Baseline job 138730047979](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/job/138730047979) has the same symptom |
| Escape pause: expected paused true, observed false at 60 s | [Job 138970725874](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501688/job/138970725874) | [Baseline job 138730047969](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/job/138730047969) matches |
| Terrain morph quarter maximum error 0.3416664796083448 versus <0.001 | [Job 138970726025](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501688/job/138970726025) | [Baseline job 138730047822](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/job/138730047822) has the identical numeric result |
| Aurel normal/garage startup remains loading after 240 s | [Job 138970724672](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501476/job/138970724672) | [Baseline browser 10](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/job/138730047877) and [browser 12](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45473620366/job/138730047932) match the respective cases |
| Night scenery survey times out at 300,000 ms inside `page.evaluate` | [Job 138970724148](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45544501263/job/138970724148) | Task-equivalent baseline and checkpoint 4 night jobs passed; an earlier prebaseline run failed similarly. **Mixed history; cause unresolved** |

The night trace narrows the unfinished operation to the full `window.ShadowBudget.sceneryShadowBudget("night")` invocation, without a recorded error identifying the inner cause. It does not distinguish environmental/performance timeout from a production defect. Day and sunset scenery passed. No quality, timeout or tolerance was weakened.

At that dated snapshot, all twenty workflow runs comprised six successes, three failures, two cancellations, two skips, five in progress and two queued; two successes were report publishers. A report-publisher success, skipped release, canceled run or queued run is not validation/deployment success. Older checkpoint-1–6 broad runs were canceled. [Complete dated review, artifact references and trace limitations](reviews/w09d-published-ci.md).

## Native correctness evidence

These domain rows describe retained coverage, largely contained within the 37-case focused browser gate. They are not extra case totals to add to it.

| Boundary | Native observation | Limit |
| --- | --- | --- |
| Audio previews | 48 kHz stereo; canceled future tone windows peak at zero; replacement PCM has zero differences across 96,000 channel samples | No physical speaker/OS latency measurement |
| Keyboard/worker | Trusted keyboard and iframe blur events reach real controller, production pump and DedicatedWorker; exact FIFO consumption | No physical gamepad/vibration proof |
| Worker channels | One diagnostics packet while 360 ticks advance; 64 Festival credits; 200 overloaded pauses; bounded recovery | Test-controlled clock/scheduler points |
| GPU/source ownership | 1,025 wrappers / three source groups; exact CPU/GPU pixels; six stable Festival disposal cycles and a usable borrowed renderer | SwiftShader/Mesa, not physical GPU performance; vendor retained resources identified |
| IndexedDB/replay | Real page eviction/read/reopen/append; zero differing pose words; double surface cutoff retained; session rows deleted on disposal | No browser-restart persistence claim |
| CSV transfer | Actual sender detachment; recording continues; exact output; canceled/replaced/invalid jobs retain correct promise owner | Maximum configured capacity and browser peak memory unmeasured |
| Full replay | Modal/seek/focus/audio/recording ownership and a real main-thread stall | One existing game journey/settings combination |

Primary records: [Wave 6](WAVE-06.md), [audio](validation/w06a-metrics.json), [channels](validation/w06c-native-evidence.json), [GPU](validation/w08e-native-metrics.json), [storage](validation/w06e-evidence.json), [replay](validation/w06f-replay-ownership.json).

## Measurement boundaries and unfavorable evidence

| Report | Measured boundary | Retained limitation or unfavorable observation |
| --- | --- | --- |
| [BVH](measurements/w07a-bvh-measurement.md) | Complete warmed constructor on two actual mesh sizes | Order effect; no query/cold-start/FPS timing; default paired reduction 33.1075%, not the 37.11% ratio-of-medians reduction |
| [Contact/math](measurements/w07b-contact.md) | Isolated mesh stores, road frame, explicit clutch, short natural vehicle loops | Constructor timing mixed; initial natural rl2 +9.96455%; AWD branch dormant |
| [Independent simulation](measurements/w07e-simulation.md) | 127 fresh processes, longer warmup, attribution control, finite exact traces | Natural rl2 approximately neutral and variable; original signal's cause unresolved |
| [Network](measurements/w07c-network.md) | Real capture/codec/queue methods with deterministic boundary data and inert transport | Four/twelve-recipient improvement; one-recipient no demonstrated benefit; zero-recipient fixed overhead; no live network/physics |
| [Telemetry snapshot](measurements/w07d-telemetry.md) | Actual recorder ring allocation/copy | Same full payload, outliers up to 79.476 ms; one smaller fixture slower; 216,000 rows not allocated |
| [CSV memory](measurements/w08c-csv-memory.md) | Five fresh Node pairs / three native worker pairs | Node high-water through export precedes verification; candidate RSS up to 471.395 MiB retained; no browser peak or constant-memory claim |
| [Texture registration](measurements/w07f-texture.md) | Actual traversal/wrappers with simplified Node canvas boundary | No rasterization/GPU timing; already-shared storage; initialization disposal events increase |

Most performance runs use Node 24.22.3 / V8 13.6 on one shared host under exclusive team compute ownership. That is distinct from CI Node 22 and from physical hardware. Independent medians and medians of paired ratios are retained as different statistics. No overall FPS, universal latency, heap/GC or device gain is inferred.

## Source stability, scope and final reconciliation

The initial expanded local gate observed the same **3,396 inputs** before/after, digest `11041c91ffa0cda9058da63c6f39b17e11770b1fa6658e5d2cd0910f63e6387e`. Source stability checks one invocation's inputs; it does not independently prove historical authored-content identity.

The unchanged guard excludes `public/models/supplied-player-lods.bin.gz` and root browser receipts. Outputs such as dist/node_modules lie outside its source directory set. The independent [scope audit](reviews/w09e-protected-scope.md) covers committed tree identities separately: 29 production files, 107 reviewed hunks, 3,883 protected leaves, seven named checkpoints and 18 reachable first-parent trees. Binary equality is Git object/mode/type identity; shallow history and untracked/transient outputs remain outside the proof.

Final source, claim and acceptance reviews found no new engine defect or need to reopen the completed gates. The synchronized [ledger](TASKS.md) records sixty distinct completed assignments in ten waves of six. Worker57 extended protected-content checks to checkpoint 9; worker59 independently verified remote source/fixture continuity. Checkpoints 7/8/9 and the inspected main share src tree `ad28ec3acb55feb301e13232614a14c4230abcae`. [Ledger/source audit](reviews/w10c-ledger-audit.md); [final engine review](reviews/w10d-final-engine-review.md); [source continuity](validation/w10e-source-and-fixture-continuity.json); [acceptance](reviews/w10f-final-acceptance.md).

The documentation/evidence update carries these completed results without changing tested checkpoint-9 executable inputs. Its own revision is identifiable in Git history; no circular self-hash or future publication receipt is claimed. The coordinator publishes that update and the same worker59 then verifies the actual remote commit/tree and ancestry. [Publication distinction](COMMIT-HISTORY.md#documentation-publication); [evidence and archive index](EVIDENCE.md). Dated historical handoffs retain their original failures and then-pending observations.
