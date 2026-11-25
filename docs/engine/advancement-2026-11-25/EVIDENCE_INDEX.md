# Evidence and assignment index

This index connects the implementation, independent reviews, retained measurements
and exact-source acceptance. Start with [README](README.md) for the outcome,
[ENGINE_CHANGES](ENGINE_CHANGES.md) for the current algorithms and resource
contracts, and [REPRODUCING](REPRODUCING.md) for source pins and executable
recipes. [AGENTS.json](AGENTS.json) is the machine-readable assignment ledger;
[CHECKPOINTS](CHECKPOINTS.md) preserves the publication and validation history.

**Current executable acceptance is `774e62fa`: 914 unit tests in 70 files,
full TypeScript checking, the product/full Vite build and all 47 selected native
browser/replay cases passed.** The exact [result manifest](evidence/checkpoint-774e62f/result.json)
records zero native failures, flaky cases, skips or retries. The software backend
still has two independently recorded material-path limitations, and broader
repository CI is not entirely green. Those boundaries are indexed below.

## Identity and reading rules

| Identity                   | Value or evidence                                                                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Original baseline          | `350119e8ec0606e8c5de5b3ab80df41104025679`                                                                                               |
| Accepted executable commit | `774e62fafdfd9ecd84001a2fcdb3b9f6ee973b86`                                                                                               |
| Accepted full tree         | `5f466294eca0b188db58375a1caf4cd76088527b`                                                                                               |
| Production `src` subtree   | `2d1bcc0f9b29f06761b8eb5c650bbbb53dd159a3`; identical at `26efaeef` and `774e62fa`                                                       |
| Final focused workflow     | [45592833399](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45592833399), job `139131185041`                           |
| Original final artifact    | `15012585753`; 1,300,824 bytes; SHA-256 `3ae96693bf5bc12acdbd449592ef36b94bd1d05ffa9a1ce492d24e401cb2598a`                               |
| Locked dependencies        | Package-lock SHA-256 `610c1768c440c202a4e37f62d22467d4cbbddc44a5962e82bb256dcfb8627edf`                                                  |
| Initial baseline check     | [baseline.json](baseline.json): 506 tests in 42 files; the later selection differs, so totals are not a percentage coverage-growth claim |

A worker's report records its own handoff point. A historical “pending” note is
not the final acceptance status; use the later checkpoint and current manifests.
Conversely, a later passing candidate does not turn an earlier failed or
interrupted execution into a pass. The assignment ledger's `complete` status
means its assigned work and report are complete, not that every observed test or
performance comparison was favorable.

Source and runner identities are separate. Retained measurements name the
actual source they executed, while later code can supersede a policy. A later
documentation or CI-report commit also has its own Git identity and does not
create another runtime execution. Final publication is the coordinator's
responsibility, with source/configuration equality checked against the accepted
executable commit.

## Assignment map

**All 60 distinct assignments are complete, in ten waves of six.**
The coordinator confirmed the final spawn as `/root/w10f_final_release_review`
before it was added to the ledger, then updated completion only after that
reviewer released [RELEASE_REVIEW](RELEASE_REVIEW.md) and its
[independent receipt](evidence/w10-release-review.json). Assignment 59's initial
handoff recorded 1–59 complete; this paragraph is the coordinator's final
completion update.
Follow-up turns are not additional agents. Two unsuccessful initial spawn
attempts are excluded.
Assignment 9 is the real nested read-only reviewer under assignment 8; its
contribution is acknowledged in the shared clock report, rather than represented
by an invented standalone report. The programme uses at most three workers beside
the coordinator, with file ownership transferred explicitly.

### Wave 1 — Initial engine audits

| No. | Assignment                                               | Retained report                          |
| --: | -------------------------------------------------------- | ---------------------------------------- |
|   1 | Runtime/startup audit — `w01a_runtime_audit`             | [audit-runtime.md](audit-runtime.md)     |
|   2 | Networking/clock/protocol audit — `w01b_network_audit`   | [audit-network.md](audit-network.md)     |
|   3 | Physics and surface audit — `w01c_physics_audit`         | [audit-physics.md](audit-physics.md)     |
|   4 | Storage, replay and records audit — `w01d_storage_audit` | [audit-storage.md](audit-storage.md)     |
|   5 | Audio and input audit — `w01e_audio_input_audit`         | [audit-devices.md](audit-devices.md)     |
|   6 | Generic rendering audit — `w01f_rendering_audit`         | [audit-rendering.md](audit-rendering.md) |

### Wave 2 — First implementation and clock review

| No. | Assignment                                                                                   | Retained report                                  |
| --: | -------------------------------------------------------------------------------------------- | ------------------------------------------------ |
|   7 | Bounded paved-lane candidates — `w02a_paved_lane_index`                                      | [w02a-lane-index.md](w02a-lane-index.md)         |
|   8 | Monotonic remote presentation clock — `w02b_network_render_clock`                            | [w02b-network-clock.md](w02b-network-clock.md)   |
|   9 | Nested clock-contract review (read-only) — `w02b_network_render_clock/review_clock_contract` | [w02b-network-clock.md](w02b-network-clock.md)   |
|  10 | Circuit/Festival startup exclusion — `w02d_startup_exclusion`                                | [w02d-startup.md](w02d-startup.md)               |
|  11 | Exact surface coefficient reuse — `w02e_surface_coefficients`                                | [w02e-surface.md](w02e-surface.md)               |
|  12 | Shared snapshot car serialization — `w02f_snapshot_batch_encoding`                           | [w02f-snapshot-batch.md](w02f-snapshot-batch.md) |

### Wave 3 — Adjacent algorithms and ownership

| No. | Assignment                                                           | Retained report                                            |
| --: | -------------------------------------------------------------------- | ---------------------------------------------------------- |
|  13 | Loudness coefficient reuse — `w03a_audio_coefficients`               | [w03a-audio-coefficients.md](w03a-audio-coefficients.md)   |
|  14 | Ghost first forward passage — `w03b_ghost_first_passage`             | [w03b-ghost-first-passage.md](w03b-ghost-first-passage.md) |
|  15 | Initial bounded dirty-range union — `w03c_attribute_ranges`          | [w03c-attribute-ranges.md](w03c-attribute-ranges.md)       |
|  16 | Unsupported flashback journal retention — `w03d_flashback_retention` | [w03d-flashback-retention.md](w03d-flashback-retention.md) |
|  17 | Menu gamepad and UI lifetime — `w03e_menu_gamepad_lifecycle`         | [w03e-menu-gamepad.md](w03e-menu-gamepad.md)               |
|  18 | Completed telemetry closing gap — `w03f_telemetry_lap_gap`           | [w03f-telemetry-lap-gap.md](w03f-telemetry-lap-gap.md)     |

### Wave 4 — Remaining prioritized engine work and measurement support

| No. | Assignment                                                                | Retained report                                                  |
| --: | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
|  19 | Lazy exact waveform sine basis — `w04a_audio_sine_basis`                  | [w04a-audio-sine-basis.md](w04a-audio-sine-basis.md)             |
|  20 | Retained-page pause and terminal teardown — `w04b_page_lifecycle`         | [w04b-page-lifecycle.md](w04b-page-lifecycle.md)                 |
|  21 | Exact input encoder capacity — `w04c_input_encoder_capacity`              | [w04c-input-encoder-capacity.md](w04c-input-encoder-capacity.md) |
|  22 | Shared WebGL completion ownership — `w04d_shared_gpu_ownership`           | [w04d-shared-gpu-ownership.md](w04d-shared-gpu-ownership.md)     |
|  23 | Festival presentation admission and pacing — `w04e_festival_frame_pacing` | [w04e-festival-frame-pacing.md](w04e-festival-frame-pacing.md)   |
|  24 | Paired actual-module benchmark harness — `w04f_benchmark_harness`         | [w04f-benchmark-harness.md](w04f-benchmark-harness.md)           |

### Wave 5 — Subsystem composition

| No. | Assignment                                                                 | Retained report                                                              |
| --: | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
|  25 | Lane/surface composition — `w05a_surface_lane_integration`                 | [w05a-surface-lane-integration.md](w05a-surface-lane-integration.md)         |
|  26 | Live network composition and wire equivalence — `w05b_network_composition` | [w05b-network-composition.md](w05b-network-composition.md)                   |
|  27 | Records and telemetry composition — `w05c_records_integration`             | [w05c-records-integration.md](w05c-records-integration.md)                   |
|  28 | Device/page/modal composition — `w05d_device_lifecycle_composition`        | [w05d-device-lifecycle-composition.md](w05d-device-lifecycle-composition.md) |
|  29 | Audio arithmetic and context composition — `w05e_audio_composition`        | [w05e-audio-composition.md](w05e-audio-composition.md)                       |
|  30 | Graphics scheduling and upload composition — `w05f_graphics_composition`   | [w05f-graphics-composition.md](w05f-graphics-composition.md)                 |

### Wave 6 — Native browser contracts

| No. | Assignment                                                                               | Retained report                                                      |
| --: | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
|  31 | Transferred network ownership — `w06a_native_network`                                    | [w06a-native-network.md](w06a-native-network.md)                     |
|  32 | Two retained-page restores and terminal reload — `w06b_native_page_history`              | [w06b-native-page-history.md](w06b-native-page-history.md)           |
|  33 | Native GPU uploads, shared fences and raster diagnostics — `w06c_native_gpu_advancement` | [w06c-native-gpu-advancement.md](w06c-native-gpu-advancement.md)     |
|  34 | Native audio PCM and context replacement — `w06d_native_audio_advancement`               | [w06d-native-audio-advancement.md](w06d-native-audio-advancement.md) |
|  35 | IndexedDB ghosts and transferred CSV export — `w06e_native_records`                      | [w06e-native-records.md](w06e-native-records.md)                     |
|  36 | Native DOM/focus/RAF ownership with scripted gamepads — `w06f_native_device_ownership`   | [w06f-native-device-ownership.md](w06f-native-device-ownership.md)   |

### Wave 7 — Actual-source measurements

| No. | Assignment                                                           | Retained report                                                  |
| --: | -------------------------------------------------------------------- | ---------------------------------------------------------------- |
|  37 | Lane timings and exact-output checks — `w07a_lane_measurement`       | [w07a-lane-measurement.md](w07a-lane-measurement.md)             |
|  38 | Surface timings and exact-output checks — `w07b_surface_measurement` | [w07b-surface-measurement.md](w07b-surface-measurement.md)       |
|  39 | Snapshot/input encoding timings — `w07c_network_measurement`         | [w07c-network-measurement.md](w07c-network-measurement.md)       |
|  40 | Cold/warm audio arithmetic timings — `w07d_audio_measurement`        | [w07d-audio-measurement.md](w07d-audio-measurement.md)           |
|  41 | Original range implementation timings — `w07e_attribute_measurement` | [w07e-attribute-measurement.md](w07e-attribute-measurement.md)   |
|  42 | Combined Simulation timings — `w07f_simulation_measurement`          | [w07f-simulation-measurement.md](w07f-simulation-measurement.md) |

### Wave 8 — Adversarial review and demonstrated repairs

| No. | Assignment                                                                         | Retained report                                                    |
| --: | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
|  43 | Physics/cache edge proof and tradeoff review — `w08a_physics_cache_review`         | [w08a-physics-cache-review.md](w08a-physics-cache-review.md)       |
|  44 | Snapshot crossover and 12-recipient policy — `w08b_network_review`                 | [w08b-network-review.md](w08b-network-review.md)                   |
|  45 | Tiny ghost endpoints and record boundaries — `w08c_storage_records_review`         | [w08c-storage-records-review.md](w08c-storage-records-review.md)   |
|  46 | Reentrant modal/audio/device ownership — `w08d_devices_audio_review`               | [w08d-devices-audio-review.md](w08d-devices-audio-review.md)       |
|  47 | Revised range implementation and frozen follow-up — `w08e_render_resources_review` | [w08e-render-resources-review.md](w08e-render-resources-review.md) |
|  48 | Synchronous startup callback cancellation — `w08f_host_lifecycle_review`           | [w08f-host-lifecycle-review.md](w08f-host-lifecycle-review.md)     |

### Wave 9 — Consolidated acceptance

| No. | Assignment                                                                           | Retained report                                                                    |
| --: | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
|  49 | 70-file unit selection and acceptance — `w09a_consolidated_units`                    | [w09a-consolidated-unit-acceptance.md](w09a-consolidated-unit-acceptance.md)       |
|  50 | Compiler/build/lint/format acceptance — `w09b_build_static_acceptance`               | [w09b-build-static-acceptance.md](w09b-build-static-acceptance.md)                 |
|  51 | Exact-source native artifact and claims audit — `w09c_native_evidence_audit`         | [w09c-native-evidence-audit.md](w09c-native-evidence-audit.md)                     |
|  52 | Baseline versus unresolved broader failures — `w09d_baseline_failure_classification` | [w09d-baseline-failure-classification.md](w09d-baseline-failure-classification.md) |
|  53 | Protected content and all production hunks — `w09e_protected_content_audit`          | [w09e-protected-content-audit.md](w09e-protected-content-audit.md)                 |
|  54 | Publication ancestry and source provenance — `w09f_publication_ancestry_audit`       | [w09f-publication-ancestry-audit.md](w09f-publication-ancestry-audit.md)           |

### Wave 10 — Documentation and final independent review

| No. | Assignment                                                                        | Retained report                                                                                 |
| --: | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
|  55 | Outcome and engine architecture guides — `w10a_engine_architecture_overview`      | [README.md](README.md); [ENGINE_CHANGES.md](ENGINE_CHANGES.md)                                  |
|  56 | Reproduction recipes and source/runner pins — `w10b_reproduction_guide`           | [REPRODUCING.md](REPRODUCING.md)                                                                |
|  57 | Independent recomputation of performance claims — `w10c_performance_claims_audit` | [PERFORMANCE.md](PERFORMANCE.md)                                                                |
|  58 | Resource bounds and lifetime acceptance — `w10d_resource_bounds_acceptance`       | [w10d-resource-bounds-acceptance.md](w10d-resource-bounds-acceptance.md)                        |
|  59 | Actual assignment ledger and evidence index — `w10e_ledger_evidence_index`        | [EVIDENCE_INDEX.md](EVIDENCE_INDEX.md)                                                          |
|  60 | Final integrated release review — `w10f_final_release_review`                     | [RELEASE_REVIEW.md](RELEASE_REVIEW.md); [independent receipt](evidence/w10-release-review.json) |

## Measurements: original, revised and current policy

The eight canonical raw files below retain samples and runtime/source identities.
[PERFORMANCE](PERFORMANCE.md) and its [independent arithmetic audit](evidence/w10-performance-claims-audit.json)
recompute the reported statistics;
[REPRODUCING](REPRODUCING.md) supplies the preserved runner mapping and commands.
Most studies use three warmup and nine measured pairs per case. **Audio uses two
warmup and eight measured pairs.** Warmup equivalence checks are not additional
measured samples.

| Area                  | Source under test                               | Raw measurement and interpretation                                                                                                                                                                                                                                                                                                               |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Paved lanes           | `aaaf5001` against original baseline            | [lane-measurement.json](evidence/lane-measurement.json); [W07A](w07a-lane-measurement.md). Warm, deliberately all-miss, fallback and construction cases are separate.                                                                                                                                                                            |
| Surface evolution     | `aaaf5001` against original baseline            | [surface-measurement.json](evidence/surface-measurement.json); [analysis](evidence/surface-measurement-analysis.json); [W07B](w07b-surface-measurement.md). Live forcing and cache-validity cases retain gains and regressions.                                                                                                                  |
| Network codecs        | `6a1c76fa` against original baseline            | [network-measurement.json](evidence/network-measurement.json); [W07C](w07c-network-measurement.md). This is codec/broadcast preparation, not physical-network timing or the complete dispatch policy.                                                                                                                                            |
| Audio arithmetic      | `6a1c76fa` against original baseline            | [audio-measurement.json](evidence/audio-measurement.json); [operation counts](evidence/audio-measurement-operations.json); [W07D](w07d-audio-measurement.md). Cold and warm costs differ; 40,000,000 of 40,085,160 compared values belong to the zero-gain control.                                                                              |
| Original dirty ranges | `6a1c76fa` against original baseline            | [attribute-measurement.json](evidence/attribute-measurement.json); [W07E](w07e-attribute-measurement.md). Historical coalescer: large disjoint-list regressions triggered the later repair.                                                                                                                                                      |
| Combined Simulation   | `6a1c76fa` against original baseline            | [simulation-measurement.json](evidence/simulation-measurement.json); [W07F](w07f-simulation-measurement.md). Each timed fixture includes 480 steps and 240 frame writes; construction/priming are outside the timer.                                                                                                                             |
| Snapshot crossover    | Both timed arms use current codec at `6cb1c881` | [snapshot-crossover-measurement-6cb1c881.json](evidence/snapshot-crossover-measurement-6cb1c881.json); [W08B](w08b-network-review.md). Original source is an untimed wire oracle. The current server prepares at **12 or more selected ready recipients**, with [separate route validation](evidence/snapshot-crossover-policy-validation.json). |
| Revised dirty ranges  | `26efaeef` against original baseline            | [attribute-review-measurement-26efaeef.json](evidence/attribute-review-measurement-26efaeef.json); [W08E](w08e-render-resources-review.md). This is the current production range implementation; pending-list representation uses the separate review runner.                                                                                    |

The current lane, surface, audio, Simulation and revised-range inputs match the
relevant retained source graphs. Historical network server policy and original
range-helper inputs have deliberate later changes; see the [provenance audit](w09f-publication-ancestry-audit.md).
No result is a whole-game FPS, physical GPU, hardware-controller, process-heap or
GC measurement. The helper-only and complete recording-upload timing scopes
**overlap** and cannot be added. Independent-median changes and medians of paired
ratios are different statistics. Separate old/new range sessions do not form a
direct paired comparison between the two candidate implementations.

### Raw measurement file identities

These hashes identify the retained JSON bytes, not the source trees contained
inside them. The source, dependency and runner records inside each file remain
the provenance of its execution.

| Raw file                                                                                              |     Bytes | SHA-256                                                            |
| ----------------------------------------------------------------------------------------------------- | --------: | ------------------------------------------------------------------ |
| [lane-measurement.json](evidence/lane-measurement.json)                                               |   763,808 | `c737a1765f1fc2f508cd264f57dcee2e5aae516e3381990c5919508fea478fdb` |
| [surface-measurement.json](evidence/surface-measurement.json)                                         |   241,907 | `f1e0566a4c8ecfe89af46491a2c8638eeaad0e27d3f78905cd8faa262c254a79` |
| [network-measurement.json](evidence/network-measurement.json)                                         |   282,456 | `b2cc290ffeaacab10c0db61d35ccc2d114921a06a7764fbda90a171ca94cd65a` |
| [audio-measurement.json](evidence/audio-measurement.json)                                             |   243,875 | `b2f295ae8f54453247cfe50e38a654b50389a512189c91220bdb25acc9bf3791` |
| [attribute-measurement.json](evidence/attribute-measurement.json)                                     | 1,654,036 | `cde8b5e7e66dce0aec19c75f098b266ecfcace0cb7ccf8323921843935ec9a78` |
| [simulation-measurement.json](evidence/simulation-measurement.json)                                   |   463,036 | `cf7d509e876052fe0736fe2e6782b1bc00c52c98b0c8450b20ab75a1b74d1668` |
| [snapshot-crossover-measurement-6cb1c881.json](evidence/snapshot-crossover-measurement-6cb1c881.json) |   436,185 | `e1d81a859d15b1dc6201fb739e7e26d5fd183c487833fb1c9497b0e97da2cac0` |
| [attribute-review-measurement-26efaeef.json](evidence/attribute-review-measurement-26efaeef.json)     | 1,656,174 | `935b2a8cb75308c33b8d8f98151e2d6687212e22f81377a824f0e9d0f12ea62c` |

## Exact-output and composition evidence

| Contract                                  | Entry points and retained result                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual-module paired harness              | [W04F](w04f-benchmark-harness.md), [benchmark-support.mjs](../../../scripts/engine-advancement/benchmark-support.mjs), [benchmark-smoke.mjs](../../../scripts/engine-advancement/benchmark-smoke.mjs). Source stability, complete work units, separate roots, shared dependencies, fresh outputs and cooperative exclusive timing are explicit.       |
| Network packet/composition equivalence    | [W05B](w05b-network-composition.md), [summary](evidence/w05b-network-composition.json), [network-composition-proof.mjs](../../../scripts/engine-advancement/network-composition-proof.mjs). Actual-module packet and prediction checks are distinct from timing and physical transport.                                                               |
| Audio exact supplied inputs               | [W05E](w05e-audio-composition.md), [summary](evidence/w05e-audio-composition.json), [audio-composition-proof.mjs](../../../scripts/engine-advancement/audio-composition-proof.mjs). The historical W05 summary has narrower provenance than the later complete W07 source manifests.                                                                  |
| Water/thermal edge behavior               | [W08A](w08a-physics-cache-review.md), [physics-cache-edge-proof.json](evidence/physics-cache-edge-proof.json), [physics-cache-edge-proof.mjs](../../../scripts/engine-advancement/physics-cache-edge-proof.mjs). Invalid inputs, validation timing, signed zero and mutable coefficients remain checked; an unsafe empty-water shortcut was deferred. |
| Record persistence and closing gaps       | [W05C](w05c-records-integration.md), [W08C](w08c-storage-records-review.md), native ghost/CSV attachments below. Saved poses, first passage and completed-lap validity are separate contracts.                                                                                                                                                        |
| Actual Three uploads and shared ownership | [W05F](w05f-graphics-composition.md), [W08E](w08e-render-resources-review.md), native GPU attachments below. Recording-driver transfer counts are not native GPU-duration measurements.                                                                                                                                                               |

The implementation and adversarial reports link their concrete regression tests.
The consolidated [70-file selection](evidence/w09-unit-selection.json) is the
complete focused gate, not all tests in the repository. Its sorted LF-joined
path-list SHA-256 is
`87b33765d1d495165dee308d7cfbddbffde31b2b5d76b8aaf446fb98fe489e5b`.
The [unit audit](w09a-consolidated-unit-acceptance.md) checks selection identity and
preserves the incomplete local attempt separately.

## Archived integration checkpoints

Each link opens that exact checkpoint's result manifest. Source/tree/lock
receipts and logs live beside it. Seven checkpoint directories are currently
retained; earlier audit or implementation commits also appear in
[CHECKPOINTS](CHECKPOINTS.md) without being represented as additional archive
executions here.

| Executed source | Focused units      | Compiler/build                  | Native outcome                                            | Exact receipt                                      |
| --------------- | ------------------ | ------------------------------- | --------------------------------------------------------- | -------------------------------------------------- |
| `b594cfc`       | 579 / 48 files     | Passed                          | 37 passed                                                 | [result](evidence/checkpoint-b594cfc/result.json)  |
| `955bc20`       | 813 / 62 files     | Passed                          | 37 passed                                                 | [result](evidence/checkpoint-955bc20/result.json)  |
| `9922926`       | 820 / 65 files     | Passed                          | 41 passed, 4 failed                                       | [result](evidence/checkpoint-9922926/result.json)  |
| `6a1c76f`       | 820 / 65 files     | Passed                          | 45 passed, 2 failed                                       | [result](evidence/checkpoint-6a1c76f/result.json)  |
| `6cb1c88`       | 820 / 65 files     | Passed                          | 46 passed, 1 failed                                       | [result](evidence/checkpoint-6cb1c88/result.json)  |
| `26efaeef`      | 914 / 70 files     | TypeScript failed; Vite not run | Skipped after compiler failure                            | [result](evidence/checkpoint-26efaeef/result.json) |
| **`774e62f`**   | **914 / 70 files** | **Passed**                      | **47 passed; no failures, flaky cases, skips or retries** | [result](evidence/checkpoint-774e62f/result.json)  |

Test selections changed across checkpoints. Do not use those totals as a
like-for-like test-count growth rate. The `26efaeef` TS2352 failure occurred in
an intentional constructor-free Interface test fixture. Its explicit `unknown`
cast bridge emits identical JavaScript, and the corrected source received its
own successful full gate. The [static audit](w09b-build-static-acceptance.md)
preserves both the historical failure and the coordinator's final acceptance.

### Current native evidence

The [native audit](w09c-native-evidence-audit.md) and
[current result manifest](evidence/checkpoint-774e62f/result.json) are the primary
interpretation and inventory. The directory contains 24 files, including the
manifest; the manifest hashes its 23 other members. Log copies have declared
ANSI/trailing-whitespace normalization, and attachment JSON has declared
normalization. The original ZIP digest identifies the upstream bytes.

| Evidence                                                                                                                                                                                                                                          | What it establishes and what it does not                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Build identity](evidence/checkpoint-774e62f/BUILD_IDENTITY.json), [job steps](evidence/checkpoint-774e62f/workflow-job.json), [case index](evidence/checkpoint-774e62f/browser-case-results.json)                                                | The accepted source, product/full output and successful selected cases; not a new execution at a later documentation commit.                                                                                                 |
| [Backend](evidence/checkpoint-774e62f/browser-backend.json)                                                                                                                                                                                       | ANGLE/Mesa llvmpipe software renderer; `physicalHardwareValidated` is false.                                                                                                                                                 |
| [GPU attributes](evidence/checkpoint-774e62f/native-gpu-attribute-uploads.json)                                                                                                                                                                   | Complete-buffer comparisons and exact uploaded bytes at the exercised updates.                                                                                                                                               |
| [Shared fences](evidence/checkpoint-774e62f/native-gpu-shared-fences.json)                                                                                                                                                                        | Exact 256-byte red/green images with a test-only explicit `vec4` witness, once-only fence cleanup and no `finish` calls.                                                                                                     |
| [Raster controls](evidence/checkpoint-774e62f/native-gpu-raster-path-diagnostics.json), [annotations](evidence/checkpoint-774e62f/native-diagnostic-annotations.json)                                                                             | MeshBasic and raw `vec3` each still differ in 64/256 bytes through three read methods. Two explicit annotations preserve these limits. Passing ownership cases do not certify these material paths.                          |
| [Page history](evidence/checkpoint-774e62f/native-page-history.json)                                                                                                                                                                              | Two trusted BFCache restores preserve the same document/worker and paused ticks; terminal reload disposes tracked owners once. This minimal host fixture is not whole-game BFCache eligibility proof.                        |
| [Audio PCM](evidence/checkpoint-774e62f/native-audio-advancement-pcm.json), [context suspension/replacement](evidence/checkpoint-774e62f/native-audio-advancement-suspension.json)                                                                | Exact supplied inputs, declared bounded mixed PCM, same-rate controls and a rejected real gain perturbation; native source/context cleanup without waiting forever on an abandoned resume. No physical audio hardware claim. |
| [Network](evidence/checkpoint-774e62f/native-network-advancement.json)                                                                                                                                                                            | 768 native transfers / 94,945 exact bytes, detached senders and preserved receiver ownership. No physical-network latency result.                                                                                            |
| [Ghost before reload](evidence/checkpoint-774e62f/native-ghost-before-reload.json), [after reload](evidence/checkpoint-774e62f/native-ghost-after-reload.json), [closing-gap export](evidence/checkpoint-774e62f/native-records-closing-gap.json) | IndexedDB reload and wrapped CSV/export ownership with the completed-lap closing interval.                                                                                                                                   |
| [Device focus](evidence/checkpoint-774e62f/native-device-focus-ownership.json), [content ownership](evidence/checkpoint-774e62f/native-device-content-ownership.json)                                                                             | Actual native DOM, focus and RAF owners using scripted `getGamepads` samples; no physical controller certification.                                                                                                          |

## Failures, incomplete checks and explicit exclusions

The evidence package keeps unfavorable results visible:

- The [W09D comparison](w09d-baseline-failure-classification.md) reproduces four
  named unit failures at both original baseline and accepted candidate. Its
  [unit comparison](evidence/w09d-baseline-failures/unit-comparison.json), raw
  [baseline](evidence/w09d-baseline-failures/baseline.raw.log) and
  [current](evidence/w09d-baseline-failures/current.raw.log) logs, source inventories
  and [hash manifest](evidence/w09d-baseline-failures/SHA256SUMS) preserve that
  conclusion. It applies to those exact assertions, not all repository failures.
- The [broader CI classification](evidence/w09d-baseline-failures/broad-ci-classification.json)
  and [historical case review](evidence/w09d-baseline-failures/historical-browser-cases.json)
  preserve actual browser assertions/timeouts as well as cancellation. Festival
  map/photo, wheel-pivot and coupled-driver cases are not all classified as
  baseline failures without exact-baseline browser reproduction.
- The local consolidated unit attempt ended by SIGKILL without a final summary;
  [receipt](evidence/w09-unit-local-26efaeef.json) and
  [log](evidence/w09-unit-local-26efaeef.log) remain incomplete evidence.
  The full units passed separately in the exact-source CI artifact.
- A narrow local semantic attempt ended with exit 137. The [static record](evidence/w09-static-acceptance.json)
  preserves that result; successful full CI checking is separate. Scoped ESLint
  passed 89 changed code files, but ten original-baseline files and one frozen
  task-created proof script retain formatting debt. The overall changed-file
  formatting gate is not described as green.
- [W08E](w08e-render-resources-review.md) preserves interrupted local validation
  attempts and all measured disjoint-range costs. The later complete focused
  workflow supplies acceptance; unfavorable timings remain valid measurements.
- Local Chromium was blocked before browser startup by the environment's socket
  policy. Native evidence comes from the existing GitHub workflow's recorded
  software backend, as documented in [PLAN](PLAN.md) and [REPRODUCING](REPRODUCING.md).

## Protected content, resource limits and publication

The [protected-content report](w09e-protected-content-audit.md) and
[full manifest](evidence/protected-content-audit.json) compare **1,758 protected
paths / 263,530,318 bytes** in original Git, candidate Git and the independent
working-tree reads. All match; there are no protected additions, deletions or
renames. The generated supplied-player LOD output is absent, not assigned an
invented unchanged hash. All 25 changed production paths and the renderer scene
recipes were reviewed. This is content preservation, not all-scene pixel or
physical-hardware equivalence.

The [resource review](w10d-resource-bounds-acceptance.md) and its
[source/evidence inventory](evidence/w10-resource-bounds.json) separate bounded
structures, per-owner lifetimes and finite cleanup witnesses from unperformed
heap or long-running soak measurements. The [architecture guide](ENGINE_CHANGES.md)
explains the fixed 280 KiB-per-Track surface payload, lazy 640 KiB waveform basis,
bounded lane candidates, range list and ghost index, plus lifecycle ownership.

The [publication audit](w09f-publication-ancestry-audit.md) and
[provenance record](evidence/publication-audit.json) verify the audited candidate's
ancestry, available publication receipts, preserved report-bot history and
measurement source inputs. The initial baseline descends directly from the prior
implementation `9119c768`. A later final documentation publication must preserve
intervening report commits and verify its actual remote tip. A Git ancestry
receipt is not independent proof of the precise transport lease flags used.
This index does not claim a future publication has already happened.

## Index audit

Assignment 59 reads and organizes existing evidence. It does not rerun benchmarks,
compiler/build, unit tests or browsers; it changes no production/test/protected
content and performs no Git mutation. Its checks cover **60 sequential unique
ledger records and ten waves of six**,
report existence for the 59 completed assignments, source/result identities, the
eight raw-file hashes above, all 23 current manifest member lengths/digests and
local link resolution. Assignment 9's nested contribution is independently
acknowledged in assignment 8's report. Historical actual-start classification
uses the coordinator's preserved execution ledger and reports; this review does
not claim an independent complete platform spawn-event log. The final review's
completion and actual publication remain open at this handoff, without delaying
or being counted as additional agents.

### Coordinator completion update

Assignment 60 has released its independent review and supporting receipt with
no new blocking finding. The coordinator has promoted its actual deliverables
and verified that all 60 ledger entries are complete in ten waves of six.
The final [release review](RELEASE_REVIEW.md) preserves the earlier source and
staging observation as such, and specifies the remaining guarded publication
and remote-tree checks. The commit containing this index is documentation and
evidence integration; executable acceptance remains tied to `774e62fa` and its
recorded workflow, rather than being presented as another runtime execution.
