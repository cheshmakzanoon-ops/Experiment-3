# Engine advancement — 25 November 2026

The engine now does less repeated work in physics, audio and large snapshot
broadcasts; owns asynchronous startup, input, UI and rendering resources more
strictly; and handles ghost, telemetry and flashback boundaries correctly.
The implementation changes **25 production files**. Authored models,
characters, environments, materials, vehicle specifications and handling values
are protected and passed the independent content audit.

**The focused acceptance run for `774e62fa` passed: 914 tests in 70 files,
full TypeScript checking, the product/full Vite build, and all 47 native
browser cases.** This is focused engine acceptance. Broader repository CI has
known unit failures and unresolved browser assertions/timeouts, and native
graphics acceptance uses software rendering. The distinctions below are part
of the result, not exceptions omitted from it.

Start with [ENGINE_CHANGES](ENGINE_CHANGES.md) for behavior, ownership,
compatibility and source navigation, [PERFORMANCE](PERFORMANCE.md) for the
independently recomputed gains and costs, or [REPRODUCING](REPRODUCING.md) for
pinned sources and exact commands. [CHECKPOINTS](CHECKPOINTS.md) retains
successful and failed integration results; [AGENTS.json](AGENTS.json) is the
execution ledger, with reports and artifacts mapped in
[EVIDENCE_INDEX](EVIDENCE_INDEX.md).

## Current source and acceptance

| Item                          | Current evidence                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original baseline             | `350119e8ec0606e8c5de5b3ab80df41104025679`                                                                                                                                                                          |
| Accepted executable candidate | `774e62fafdfd9ecd84001a2fcdb3b9f6ee973b86`                                                                                                                                                                          |
| Focused workflow              | [45592833399](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45592833399), artifact `15012585753`                                                                                                  |
| Focused units                 | **914 passed in 70 files**                                                                                                                                                                                          |
| Compiler and production build | **Full TypeScript and product/full Vite build passed**                                                                                                                                                              |
| Native contracts              | **47 passed; zero failed, flaky or skipped** — [retained result and attachments](evidence/checkpoint-774e62f/result.json)                                                                                           |
| Native graphics backend       | ANGLE/Mesa llvmpipe software rendering; no physical-hardware acceptance                                                                                                                                             |
| Protected content             | **1,758 paths / 263,530,318 bytes** identical in baseline Git, candidate Git and the independently read working tree                                                                                                |
| Programme completion          | **All 60 distinct assignments completed in ten waves of six.** The [final independent release review](RELEASE_REVIEW.md) accepts the engine checkpoint and final evidence package within the documented boundaries. |

The previous candidate, `26efaeef`, passed the same 914 tests but failed
TypeScript at a constructor-free UI test fixture cast; build and native stages
did not execute. Its failed artifact is preserved. The corrected candidate
adds the explicit test-boundary conversion and formatting/evidence updates;
the two candidates have the **same entire production `src` subtree**. The
successful new run supplies its own compiler, build and native evidence.
See the [unit](w09a-consolidated-unit-acceptance.md),
[static/build](w09b-build-static-acceptance.md),
[native](w09c-native-evidence-audit.md) and
[publication](w09f-publication-ancestry-audit.md) audits.

## What improved

| Engine area        | Resulting behavior                                                                                                                                                                                                                  | Design and evidence                                                                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Physics            | Paved tracks reuse conservative lane candidates; water and thermal solvers reuse exact coefficients while refreshing live forcing and invalidating changed parameters.                                                              | [Physics and caches](ENGINE_CHANGES.md#physics-and-surface-state); [independent review](w08a-physics-cache-review.md)                                             |
| Networking         | Remote presentation advances monotonically through clock corrections. Snapshot bytes and recipient ownership are captured before transport callbacks. Shared car serialization is used at **12 or more selected ready recipients**. | [Network contracts](ENGINE_CHANGES.md#network-clocks-protocol-and-broadcasts); [crossover and policy](w08b-network-review.md)                                     |
| Audio              | Repeated filter and waveform mathematics reuse exact intermediate values. UI contexts and sources cannot be revived by stale asynchronous callbacks.                                                                                | [Audio](ENGINE_CHANGES.md#audio-arithmetic-and-context-ownership); [measured costs](w07d-audio-measurement.md)                                                    |
| Graphics           | Renderers sharing a WebGL context share one completion gate. Festival prepares only admitted presentation frames. Dirty spans merge before unnecessary whole-buffer fallback.                                                       | [Graphics](ENGINE_CHANGES.md#render-admission-and-buffer-publication); [final range policy](w08e-render-resources-review.md)                                      |
| Host, input and UI | Circuit/Festival startup has one admitted owner. Retained-page suspension revokes callbacks without destroying retained resources. Device changes and modal replacement reset the correct input/resource owner.                     | [Runtime ownership](ENGINE_CHANGES.md#host-input-and-ui-ownership); [host review](w08f-host-lifecycle-review.md); [UI/audio review](w08d-devices-audio-review.md) |
| Records            | Reversal ghosts use first forward passage; exact indexed endpoints return their recorded time. Completed laps check the closing telemetry gap. Unsupported flashback modes retain no input journal.                                 | [Records](ENGINE_CHANGES.md#ghosts-telemetry-and-flashback); [boundary review](w08c-storage-records-review.md)                                                    |

These changes concern engine algorithms and resource ownership. The
[protected-content audit](w09e-protected-content-audit.md) independently checks
the authored content and the engine-only scope of every changed production
file. Generic renderer changes do not establish identical pixels for every
scene; the acceptance cases identify the outputs they actually check.

## Measured gains and costs

The frozen reports compare actual source, retain all samples and document what
was inside each timer. The following are selected results, not a new benchmark
or a whole-game speedup estimate. Paired changes compare corresponding timed
runs; a change between independent medians is labelled separately.

| Workload                    | Observed improvement                                                                                                                                                                               | Material cost or qualification                                                                                                                                                                                                      | Frozen evidence                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Repeated paved lane queries | Warm-query original/current time ratios **1.76–3.70×** across four fixtures                                                                                                                        | A deliberately all-miss 4,096-cell stream exceeds the 2,048-entry cache and is **2.19–2.67× slower**. Construction and existing-index controls are mixed.                                                                           | [W07A](w07a-lane-measurement.md)                                    |
| Surface evolution           | Steady rain **−38.4%** paired time; mutable-weather schedule **−24.6%**                                                                                                                            | Clear **+2.9%**, exposed storm **+6.5%**, first wet tick **+16.9%**, variable solver timestep **+20.6%** paired time; fixed array payload grows by **280 KiB per Track**.                                                           | [W07B](w07b-surface-measurement.md)                                 |
| Actual combined Simulation  | Four-car Aurel rain **−11.88%** and storm **−12.14%** paired time                                                                                                                                  | Other cases are mixed. Each sample covers 480 steps and 240 frame writes; construction/priming are outside the timer. This is simulation work, not rendered FPS.                                                                    | [W07F](w07f-simulation-measurement.md)                              |
| Snapshot preparation        | Historical baseline comparison at 12 recipients: **−31.17%** paired time. Separate current-codec crossover: **−15.66%** at 12 recipients                                                           | Two recipients regressed in both experiments. **Current policy uses ordinary encoding below 12**; the crossover compares two current codecs, not two timed baseline/candidate graphs. Preparation still adds three backing buffers. | [W07C](w07c-network-measurement.md), [W08B](w08b-network-review.md) |
| Audio                       | Warm 72-waveform sweep **−92.4%**; cached active-update batch **−69.0%**, changes between independent medians                                                                                      | First full waveform **+104.5%**, first active family **+22.7%**, zero-gain control **+5.2%**; a lazy **640 KiB** sine basis is retained. No blanket startup improvement is claimed.                                                 | [W07D](w07d-audio-measurement.md)                                   |
| Revised dirty ranges        | Seventeen duplicate marks upload **48 instead of 49,152 bytes**; adjacent marks upload **816 instead of 49,152 bytes**. Their complete recording-upload CPU paired ratios are **0.316× / 0.329×**. | Sixteen disjoint marks retain 192 bytes/16 uploads and cost more CPU: helper paired ratio **1.706×**, complete scope **1.215×**. These scopes overlap and must not be added. Recording-driver CPU is not native GPU latency.        | [W08E](w08e-render-resources-review.md)                             |

The original [W07 range result](w07e-attribute-measurement.md) exposed a much
larger disjoint-list regression and led to the final revision. Its historical
numbers remain intact; the final policy and its separate original-baseline
measurement are in W08E. Likewise, the original snapshot policy prepared at
every multi-recipient boundary; W08B supersedes that policy. Neither history
should be read as the current default.

No report establishes a game-wide FPS increase, physical GPU improvement,
physical-network benefit or measured JavaScript heap/GC reduction. Structural
array and buffer counts are reported as those quantities. See
[PERFORMANCE](PERFORMANCE.md) for the independent recomputation of all 175
case/scope rows across eight artifacts, including 1,567 measured pairs and
517 warmup pairs. [REPRODUCING](REPRODUCING.md) distinguishes the timing,
equivalence and native acceptance boundaries; the
[resource audit](w10d-resource-bounds-acceptance.md) separates fixed capacities,
finite cleanup evidence and existing retention that can grow over a session.

## Protected content and remaining acceptance limits

The [protected manifest](evidence/protected-content-audit.json) matches all
1,758 protected paths across the original tree, accepted candidate and worktree.
There are no protected additions, removals or renames. The audit also found
33 geometry/material constructor expressions token-identical and preserved
the renderer scene recipes after separating only completion-gate ownership.
The generated `public/models/supplied-player-lods.bin.gz` is **absent in all
three locations**; it is not described as a hashed unchanged asset. The
tracked supplied-player model is included in the byte comparison.

The 47 native cases establish their stated browser contracts. They do not
certify every material path. The six-path raster diagnostic separately records
the MeshBasic/raw-`vec3` limitation on the software backend; the shared-gate
case uses the verified test-only `vec4` control while retaining exact complete
red/green image comparisons and the original ownership/fence assertions.
Those diagnostics remain visible rather than being counted as material
acceptance. Native audio similarly checks exact supplied graph/automation
inputs and a fixed mixed-PCM error budget, not universal bit-identical mixing.
The [native audit](w09c-native-evidence-audit.md) explains these boundaries.

**Broader repository CI is not green.** Four named unit assertions fail
identically on the original baseline and accepted candidate: APX-01 livery,
two catalogue expectations and i18n dictionary validation. Other retained
browser assertions and timeouts remain unresolved; cancellation alone does
not classify them, and they have not all been reproduced on the exact
baseline. No authored content or expected values were changed to hide them.
The [failure-classification report](w09d-baseline-failure-classification.md)
contains the exact reproductions and outstanding cases.

## Review and continuation map

| Need                                                          | Read                                                                                                                                                                                    |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Understand current algorithms, lifetimes and costs            | [ENGINE_CHANGES](ENGINE_CHANGES.md)                                                                                                                                                     |
| Compare measured improvements and adverse workloads           | [PERFORMANCE](PERFORMANCE.md)                                                                                                                                                           |
| Reproduce checks or interpret frozen source pins              | [REPRODUCING](REPRODUCING.md)                                                                                                                                                           |
| Follow the scope, all assignments and retained artifacts      | [PLAN](PLAN.md), [AGENTS.json](AGENTS.json), [EVIDENCE_INDEX](EVIDENCE_INDEX.md)                                                                                                        |
| Inspect resource capacities and cleanup limits                | [Resource acceptance](w10d-resource-bounds-acceptance.md)                                                                                                                               |
| Assess the integrated release and publication checks          | [RELEASE_REVIEW](RELEASE_REVIEW.md)                                                                                                                                                     |
| Inspect integration history, including failed runs            | [CHECKPOINTS](CHECKPOINTS.md)                                                                                                                                                           |
| Review initial opportunities                                  | [Runtime](audit-runtime.md), [physics](audit-physics.md), [network](audit-network.md), [devices](audit-devices.md), [rendering](audit-rendering.md), [storage](audit-storage.md) audits |
| Verify candidate, authored-content and publication identities | [Native](w09c-native-evidence-audit.md), [protected content](w09e-protected-content-audit.md), [publication ancestry](w09f-publication-ancestry-audit.md) audits                        |

The user requested sixty distinct assignments in ten waves of six. The
coordinator owns integration and publication to `main`; workers have explicit
file ownership. The ledger counts actual starts and distinguishes
implementation, composition, measurement, independent review and acceptance.
Earlier worker notes preserve the status at their handoff. Use the current
acceptance above and the later checkpoint record when a historical note says
that a run or review is still pending.
