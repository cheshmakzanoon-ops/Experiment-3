# Engine runtime follow-up — implementation and evidence

This programme improves engine behavior under input bursts, stalled consumers, rewind, peer failure and resource teardown. It also removes repeated work in collision construction, snapshot capture, texture registration and telemetry export. The authored game content remains unchanged in the audited committed trees.

> **Final implementation and evidence report — 25 November 2026.** All **60 distinct worker assignments in ten waves of six** are complete. Tested checkpoint 9, `9119c7683d821d145f15ed64a03ee3406595b58d`, passed **1,852 local unit cases across 128 files**, all five local static/build/bundle/IP checks, **37 local SwiftShader native/replay cases**, and published focused CI with **506 unit cases across 42 files and the same 37 browser cases on Mesa**. Independent source, performance and acceptance reviews approve the implementation and the bounded claims below. Production source remains identical to checkpoint 7; checkpoints 8/9 contain fixture/workflow corrections. Final documentation publication and its subsequent remote verification are recorded separately from the tested code revision.

This summary and [VALIDATION.md](VALIDATION.md) give the latest reconciled status. The dated wave reports and individual handoffs preserve what was known when each was written, including earlier failures and then-pending gates; those historical phrases are not the final status.

## Contents

- [What changed and why](#what-changed-and-why)
- [Validation status](#validation-status)
- [Measured costs](#measured-costs)
- [Protected scope and compatibility](#protected-scope-and-compatibility)
- [Remaining limits](#remaining-limits)
- [Maintainer guide](#maintainer-guide)

Task baseline: [`1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb). The [plan](PLAN.md) defines the engine-only scope; [commit history](COMMIT-HISTORY.md) separates production changes, validation additions and concurrent CI report commits.

## What changed and why

| Engine area | Resulting behavior | Practical benefit and evidence |
| --- | --- | --- |
| Input and authoritative journals | Accepted keyboard/gamepad shift edges retain FIFO order through host acknowledgement. Live network shifts apply once per command, including loss, duplication and AI handback. Archived persistent-shift journals retain their old replay semantics. | Rapid opposite or repeated shifts are no longer collapsed into a level or replayed throughout an extended command. [Implementation](IMPLEMENTATION.md#input-and-authoritative-journals); [shift regression](../../../tests/engine-network-shift.test.ts). |
| Bounded diagnostics, status and ghosts | Engineering diagnostics has one acknowledged packet; Festival status has 64 credits and pauses simulation at sustained saturation; unusable ghost laps release their samples. | A stalled host cannot create an unbounded diagnostics/status queue or retain an indefinitely invalid ghost lap. Diagnostics remains optional and does not pause physics; status delivery preserves accepted achievement transitions. [Ownership table](IMPLEMENTATION.md#bounded-producers-and-consumers). |
| Failure and session ownership | Fatal worker errors remain terminal until successful initialization. Host/session cleanup settles despite exceptions, revokes ownership before callbacks and continues independent release attempts. | Queued resume traffic cannot revive partially mutated state; an error toast, close callback or disposal listener cannot strand unrelated owners. [Lifecycle details](IMPLEMENTATION.md#failure-and-session-ownership); [Wave 8 review](WAVE-08.md). |
| Network snapshots | A snapshot boundary captures each car once, then creates a separate complete packet for each recipient. Reentrant publication is bounded to two batches. | Shared capture removes repeated field/rank work without sharing mutable output packets or losing later events. Healthy peers continue after another peer fails. [Snapshot design](IMPLEMENTATION.md#network-snapshots-and-transport-ownership). |
| Recording and export | Rewind uses the correct clock and stored Float32 pose domain; snapshots copy a ring in at most two spans; completed CSV groups become Blob parts immediately. | Resumed timeline rows remain recordable, boundary poses survive, and large exports retain far fewer completed strings while preserving every output byte. [Storage design](IMPLEMENTATION.md#recording-rewind-and-csv-export). |
| Physics construction and arithmetic | BVH node bounds use scalar accumulation; contact buffers use scalar stores; road frames reuse a validated normal length; the fixed-four AWD slip maximum avoids an array. | The supported numeric domains preserve exact output with less repeated work. Fractional contact-row inputs are explicitly rejected. [Physics proof](IMPLEMENTATION.md#physics-construction-and-exactness). |
| Texture, GPU and audio lifetime | Compatible texture wrappers register as a group; owners restore sources and continue independent cleanup after faults; renderer-owned passes/sky/shadows are released; mute/focus/failed activation revoke previews. | Shared source storage stays shared, borrowed renderers remain usable, and abandoned audio requests cannot start after a later unlock. [Resource design](IMPLEMENTATION.md#texture-gpu-and-audio-ownership). |

These improvements address concrete correctness and cost boundaries. There is no measured whole-game FPS improvement.

## Validation status

The final expanded local gate passed **1,852/1,852 cases across 128 unique physical files** on exact checkpoint 9, with zero failures, skips, TODOs or retries. All 3,396 guarded inputs remained unchanged, and all 1,116 src files matched checkpoint 7. [Final result](validation/w09a-final-results.json); [consolidated validation record](validation/w09a-consolidated-validation.json).

Exact checkpoint 9's [focused CI job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850414/job/138981642796) also passed **506 unit tests across 42 files**, complete TypeScript checking, production build and **37 native/browser cases across nine files** on verified Mesa llvmpipe. Worker59 independently downloaded the 1,178,621-byte artifact, verified SHA-256 `8653a669dac50a9d0d8ffce104b1b703b0083e227960f0f922bbbbb6aeb5297f`, and checked its embedded source/build identities and detailed case results. [Final independent verification](reviews/w10e-publication-verification.md); [artifact receipt](validation/w10e-artifact-archive-manifest.json). The earlier checkpoint-7 gate and its separate artifact inspection remain [historical evidence](reviews/w09d-published-ci.md).

The final local static/build run completed at **04:49:09 UTC** with all five commands passing: full configured ESLint, TypeScript, direct Vite product build, bundle budget and IP scan. Its product/full build identifies checkpoint 9; no guarded source paths changed. The initial JavaScript gzip total is reported as 3.78 MiB against the unchanged 4 MiB budget. The existing large-chunk warning remains; the IP scan reports no problems and 113 tolerated internal-identifier hits. [Build manifest](validation/w09b-static-build-manifest.json); [validation details](VALIDATION.md#completed-local-static-and-build-gate).

The final local browser run passed **37/37 cases across nine files**, with zero retries, skips, flaky cases or failures, using the exact product build above. All 3,396 guarded source paths and 266 dist files remained unchanged. The 8,500 ms main-thread stall retained telemetry **420 → 960** and replay **6.9333333969 → 15.9333343506 seconds**, without warnings. Seeking to 0.75 seconds submitted exactly one new frame, with zero presentation-time error. This run used verified Chromium 140 / SwiftShader; it is separate from the Mesa CI run. [Native handoff](reviews/w09c-native-final.md); [gate receipt](validation/w09c-native-gate-manifest.json).

The expanded local gate is a separate result. Its first execution on checkpoint 7 passed **1,803 tests and failed 34 of 1,837**, across 127 physical files. Exact-baseline execution passed all 42 tests in the three affected files. Of the 34 failures, 32 came from partial renderer fixtures missing newly owned resources and two expected a circuit worker to resume after a now-terminal error. The corrected three-file gate passed **42/42** and was published in checkpoint 8. This does not retroactively turn the initial run into a pass. [Initial result](validation/w09a-initial-results.json); [baseline](validation/w09a-baseline-results.json); [correction result](validation/w09a-corrected-fixtures.json).

Broader CI then exposed one additional surface-channel contract mismatch. The unchanged file passes **14/14 on the exact task baseline** and **13/14 on checkpoint 8**. The corrected file passes **15/15**: the worker requires fresh initialization after failure, while an added direct SurfaceChannel/actual Simulation case preserves full rebase of the **same deformed terrain**. Checkpoint 9 publishes this correction; both completed final gates above include it. [Surface comparison](validation/w09a-surface-comparison.json); [correction](reviews/w09a-surface-correction.md); [Wave 9 status](WAVE09.md).

The latest inspected broader-CI snapshot, **05:06:13 UTC on checkpoint 9**, retains **9,594 unit passes / four failures across 901 files**. None of the 35 task-associated fixture/contract failures remains. The four remaining failures are the same baseline-established livery, catalogue/calibration, i18n and catalogue-growth cases. Validate, offroad-scenarios, scenarios and wet-presentation also passed; **16 browser jobs and four owner-QA jobs were still active**. A whole-repository pass has therefore not been established. [Exact broad run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850446); [latest inspected status](validation/w10e-broad-status-summary.json); [unit reconciliation](validation/w10e-broad-unit-reconciliation.json).

The earlier checkpoint-7 result of 9,558 passed / 39 failed remains in the historical record. Its graphics pause/loading/terrain and garage-start symptoms match task-equivalent baseline logs. Night scenery's mixed-history timeout remains unresolved. [Failure classification and dated evidence](VALIDATION.md#broader-repository-ci).

Test counts in different gates overlap. Unit cases, browser cases, measurement fixtures and repeated runs are kept separate throughout this report and are never added into a programme-wide “tests passed” total.

## Measured costs

Most Wave 7 comparisons use actual task-baseline source and production checkpoint 4, `f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6`. Later checkpoints 5 and 6 add validation and measurement evidence without changing that production source. Wave 8 measures the CSV correction separately. Each report pins source identities and retains raw samples.

These timings remain observations from their pinned measurement sessions. Final-source inspection confirms that the measured BVH, snapshot, quantizer, recorder snapshot, road-frame and texture registration methods remain byte-identical. Later grid/results callback guards and texture unregister changes are outside those timed paths. The contact constructor gained a positive-integer guard after Wave 7 and was not retimed. Wave 8's measured current CSV dependency graph matches the final production source. None of these source-identity checks is a new timing run of the final build. [Independent claim audit](reviews/w10b-performance-claims.md).

| Measured workload | Independent baseline → candidate medians | Supported interpretation |
| --- | --- | --- |
| Aurel BVH, production default 8,192 rows / 229,376 triangles | 216.644 → 136.239 ms | **33.1% median paired construction-time reduction** over ten pairs. The reduction of the two separate medians is a different statistic. All tested tree/query outputs match. [Report](measurements/w07a-bvh-measurement.md). |
| Twelve-car snapshot, twelve recipients | 66.925 → 60.080 µs per complete batch | Capture/rank calls fall from 144 to 12; median paired latency falls 9.79%. One pair is slower. At four recipients, calls fall 48→12 and paired latency falls 5.57%; one recipient has no demonstrated gain, and zero recipients adds about 59 ns fixed overhead. [Report](measurements/w07c-network.md). |
| Direct control quantization plus common checksum | 971.10 → 138.47 ns/call | **7.146× median paired speed ratio**; 283,305 inputs and their wire values match. Eight removed byte-path temporaries are a source-level inventory, not measured heap bytes or GC savings. [Report](measurements/w07c-network.md#control-timing-results). |
| Default 54,000-row telemetry snapshot | Unwrapped: 28.034 → 19.175 ms; wrapped: 29.432 → 20.770 ms | Same 49,248,000-byte payload, one/two copy spans instead of 54,000 row views/copies. Current outliers and a slower smaller partial fixture remain in the evidence. [Report](measurements/w07d-telemetry.md). |
| Default CSV export, five fresh-process Node pairs | Time: 2,210.919 → 1,801.424 ms; high-water RSS through export: **628.602 → 370.602 MiB** | RSS includes startup, fixture construction and warmups, sampled before verification. This is a 258 MiB difference between those medians, not an exact export live-memory peak or browser-memory result. [Report](measurements/w08c-csv-memory.md). |
| Default CSV export, three native Chromium worker pairs | 1,676.0 → 1,561.0 ms | All three candidate completions are faster than their paired baselines; all bytes match. This includes cold worker startup, formatting, reply and release. Browser peak memory was not measured. [Report](measurements/w08c-csv-memory.md#native-browser-latency-and-ownership). |
| 1,024-wrapper registration, generated / imported | 5.178 → 2.169 ms / 7.723 → 1.874 ms | Controlled Node registration with a simplified canvas substitute, excluding rasterization/GPU work. Both versions already share storage. Initial disposal events rise from 1,025 to 2,048 for one shared group. [Report](measurements/w07f-texture.md). |

The contact-buffer rewrite removes **237,583 temporary array literals and their matching typed-array set calls** at the default resolution, but its elapsed constructor measurements are mixed. The AWD branch is dormant in the current authored catalogue and provides no demonstrated present-game gain.

The first natural `rl2` substep experiment recorded **+9.96455% median paired wall time**, an unfavorable result. A separate investigation used 127 sequential fresh processes, longer warmup and a candidate-with-original-frame control. Its `rl2` comparison was approximately neutral: −0.668% paired wall time, −0.007% paired CPU time, with six of twelve pairs faster. The earlier result remains unexplained; it has not been proved to be noise. The road-frame change is retained for exact numerical behavior and reduced local work, without a natural-vehicle throughput claim. [Original experiment](measurements/w07b-contact.md); [independent investigation](measurements/w07e-simulation.md).

At the Wave 7 baseline/candidate source checkpoints, three actual Simulation scenarios—formula, wet motorcycle and motocross—each ran 1,200 ticks / ten simulated seconds, with **617,181,316 serialized trace bytes identical** across the two source graphs. This finite evidence covers packed frames, exposed dynamic state and specified weather/surface/terrain checkpoints; it excludes inaccessible private fields and is not a proof of every gameplay trajectory. The later contact constructor guard was checked separately; these traces were not regenerated on the final build. [Equivalence scope](measurements/w07e-simulation.md#exact-production-world-output).

## Protected scope and compatibility

The independent checkpoint-7 audit reviewed all **29 production files / 107 diff hunks** and compared **3,883 explicitly protected tracked leaves** across seven named programme checkpoints and 18 locally reachable first-parent commit trees. It found no change to authored model/character/environment definitions, geometry/material/texture definitions or assets, vehicle tuning, catalogues, default quality or dependencies. [Scope audit](reviews/w09e-protected-scope.md); [checkpoint matrix](validation/w09e-checkpoint-protection.json).

Final ledger/source reviews and remote continuity inspection extend that protection through checkpoint 9. Checkpoints 7, 8, 9 and the inspected remote main share the complete src tree `ad28ec3acb55feb301e13232614a14c4230abcae`, containing 1,116 tracked source leaves. The independent final engine review accepts the 29-file implementation without a new defect or need for further corrective tests. [Final source review](reviews/w10d-final-engine-review.md); [remote source/fixture continuity](validation/w10e-source-and-fixture-continuity.json).

This claim is about the reviewed code and committed object identities. Five rendering implementation files change for registration/resource ownership; `src/rendering/open-world/festival-renderer.ts` is a deliberate lifecycle-only exception inside an environment folder. “Every environment file is unchanged” would be inaccurate. Sparse checkout and shallow history limits are documented in the audit.

Compatibility also needs precise wording:

- Ghost version/field shape, packed frame layout, control-wire fields, replay pages, telemetry channels and CSV text rules remain unchanged.
- Journal **tag 5** intentionally adds a one-shot shift edge; old tags 0/4 retain persistent-shift replay. Older decoders reject the unknown new tag.
- Internal worker envelopes intentionally gain engineering/status acknowledgements and sequence ownership. Festival's 64-credit backpressure changes prolonged-stall behavior.
- Invalid ghost acceptance and fractional collision-row rejection are intentionally stricter; final record archiving excludes an unsimulated end-tick suffix.

The programme's recorded direct validation commands and focused CI avoid model-generation hooks. The untouched broad repository workflows still contain their pre-existing npm hooks; this report does not claim that no automatic workflow ever invokes a generator. The source guard also has a generated-player-LOD exclusion, so its passing result alone is not the protected-content audit.

## Remaining limits

The final local unit, static/build and native gates and checkpoint-9 focused CI are complete. All sixty original assignments are complete in the synchronized [worker ledger](TASKS.md), with [final acceptance](reviews/w10f-final-acceptance.md) and [Wave 10 review outcomes](WAVE10.md). Broader repository CI retains the dated results and limits above. The evidence does not measure physical GPU/device performance, browser peak heap/GC, maximum 216,000-row CSV export, all browsers/OSes or whole-game FPS. The existing full replay uses its unchanged low-quality, zero-opponent rainy-practice workload.

The tested code/test revision remains checkpoint 9. The documentation/evidence revision carrying this report is identified in Git history and does not change those executable inputs. After its actual publication, the same worker59 will verify its remote commit/tree, ancestry and source continuity; that later publication is not pre-certified here. [Publication identity](COMMIT-HISTORY.md#documentation-publication); [evidence index](EVIDENCE.md).

Resource cleanup is stronger at the reviewed ownership boundaries, but a throwing Three.js listener can still interrupt later vendor listeners. Protected nested planting/BikeShells and vendor cleanup internals were not rewritten. The renderer guarantees independent cleanup attempts and preservation of the first error, not complete draining under every nested callback fault. [Resource limits](reviews/w08e-resources.md).

## Maintainer guide

| Document | Purpose |
| --- | --- |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Engine behavior, ownership rules, compatibility boundaries and regression entry points. |
| [VALIDATION.md](VALIDATION.md) | Exact checkpoint/gate matrix, retained failures, native evidence and performance limits. |
| [COMMIT-HISTORY.md](COMMIT-HISTORY.md) | Actual commit/tree identities and what each checkpoint contains. |
| [WAVE01-02.md](WAVE01-02.md) | Explicit reconstruction of early audit/implementation from committed plan, source and tests. |
| [Waves 3](WAVE-03.md), [4](WAVE-04.md), [5](WAVE-05.md), [6](WAVE-06.md), [7](WAVE-07.md), [8](WAVE-08.md) | Original retained implementation, integration, native, measurement and review reports. |
| [WAVE09.md](WAVE09.md), [WAVE10.md](WAVE10.md) | Completed verification and independent final review outcomes. |
| [TASKS.md](TASKS.md), [AGENTS.json](AGENTS.json) | Synchronized record of sixty completed distinct assignments, ten waves of six. |
| [EVIDENCE.md](EVIDENCE.md) | Readable receipts, retained evidence archives, source identities and explicit exclusions. |
| [Measurements](WAVE-07.md#reproducibility-and-validation-checkpoint), [review outcomes](WAVE-08.md) | Detailed reports, exact source manifests, raw observations and reproduction scripts. |
