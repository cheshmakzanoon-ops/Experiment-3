# W09B — Measured engine work and comparison limits

Assignment **50/60**, wave **9** · 25 November 2026.

## Finding

The accepted probes demonstrate substantial reductions in specific repeated engine operations while preserving the outputs checked by their workloads. The strongest evidence is structural: removed frame slices, fewer queue scans, removed eviction iterators, fewer thermal signature refreshes, and fewer codec copies/backing buffers. These results support the scoped implementation changes. They do not establish a percentage improvement in whole-game speed.

This report independently retrieved the six retained JSON reports, the actual hosted run and decoded job log, and the shared loader plus codec/queue probe source. All six retained objects were semantically identical to the corresponding JSON parsed from the actual job log. I independently recomputed the codec and queue medians from their recorded sample vectors. This is analysis of observed evidence; no new executable test or benchmark was run by this assignment.

## Exact evidence identity

| Item | Identity |
| --- | --- |
| Measured candidate | `92e2dc2ed2f4959011bb84816e90506cefed774d` |
| Candidate tree | `53db549abaa5ce3a38421e7c103e3e052a7956d8` |
| Historical target baseline | `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc` |
| Successful focused run / job | [45637677573 / 139287423560][job] |
| Probe runtime | Node v22.23.5; esbuild 0.25.12 |
| Retained structured evidence | [Six probe reports][probes] and [run result][result] |
| Retained decoded evidence | [Complete normalized job log][log] |

The hosted run records **1,135 passing unit tests across 86 files, all six baseline probes, full TypeScript/product build, and 57 native browser cases with no retries**. The browser stage used Mesa llvmpipe software rendering. The six measurements discussed here ran in Node; the graphics backend does not turn them into GPU or gameplay measurements.

The later [e2d1fec run][later-run] failed its unit stage and skipped baseline, build and native stages. I independently checked that run and its job-step conclusions. Its storage and event-loop composition therefore does not inherit a new measurement run from 92e. A subsequent complete gate must identify its own source. The retained reports happen to be stored in e2d1fec; their measured candidate remains 92e.

### What “baseline” means

The [shared helper][support] obtains exact historical bytes with `git show`, substitutes only the declared modules, and builds separately instantiated variants against the **same candidate dependency graph**. This isolates the edited modules; it is not a comparison between two complete historical/current product builds.

| Probe | Historical modules substituted |
| --- | --- |
| Radio | `src/core/radio.ts` |
| Queue | `src/net/input.ts` |
| Codec | `src/net/bytes.ts`, `src/net/codec.ts` |
| Lane | `src/simulation/track-lane-index.ts` |
| Thermal | `src/simulation/surface-thermal.ts` |
| Simulation composition | Lane and thermal modules together |

Every report identifies the pinned baseline, candidate HEAD, source/bundle digests, tool versions and clean tracked state within the declared scope. The helper verifies that each historical target was loaded and that its candidate target bytes, HEAD and tracked status remain stable during bundling. Untracked files are excluded from the clean-state claim; the helper does not separately freeze every transitive dependency.

## Structural results

The following rows use different workloads and units. Their savings must not be summed into a whole-engine allocation total.

| Tested work | Baseline | Candidate | Meaning |
| --- | ---: | ---: | --- |
| Radio: 600 observations, 24-car frames | 600 slices; 19,123,200 copied bytes | 0 slices; 0 copied bytes | Full-frame history copies are eliminated in these observe calls |
| Queue: 248 dense sequential slots | 30,876 pending-key visits; 248 deletes | 0 visits; 248 deletes | Expiry avoids repeatedly scanning the remaining queue |
| Lane: 8,192 primary misses, capacity 2,048 | 6,144 eviction iterators | 0 eviction iterators | Both variants still perform 6,144 successful evictions |
| Thermal: four rain Track updates | 14,349 signature refresh calls | 8 calls | Identical tested temperatures/water; matrix selection and cell advances remain |
| Thermal: four storm Track updates | 14,349 signature refresh calls | 8 calls | Same narrow reduction under a second wet preset |
| Codec: one two-command input packet | 36 counted copy bytes; 2 nonempty backings | 0 copy bytes; 1 backing | Final defensive copy is removed |
| Codec: 12 cars, two ordinary recipients | 1,006 counted copy bytes; 4 backings | 0 copy bytes; 2 backings | Exact-sized recipient output owns its backing |
| Codec: 12 cars, twelve prepared recipients | 12,876 counted copy bytes; 27 backings | 6,228 copy bytes; 14 backings | Finishing copies disappear; prepared assembly copies remain |

Source for all counts: [accepted probe records][probes].

### Radio and queue accounting

The radio counter covers actual `Float32Array.slice` calls and returned byte lengths during synchronous observations. At 600 observations, its one-car case removes 852,000 copied bytes and its 32-car case removes 25,478,400 bytes. Frame construction is outside the measured call. These numbers describe avoided history slices, not every allocation or retained object in the radio subsystem.

The dense queue result represents 31 commands admitted through the public queue API, producing 248 slots. It is not a claim that an input wire packet accepts 31 commands. Combined expiry work—iteration visits plus delete calls—falls from **31,124 to 248** in that trace. The large sparse-jump trace instead falls from seven to four visits, with four deletes in both variants; sparse work retains an existing-key scan when a numeric walk would be excessive.

The three seeded traces demonstrate why reporting only delete counts would be misleading. Numeric expiry may attempt deletion of an empty position. For the three seeds, delete calls rise from 552/577/1,415 to 1,027/838/1,805, while combined expiry work falls from 8,911/7,382/35,521 to 1,240/1,008/2,697. The asserted bound is at most twice the starting pending depth in iteration visits plus delete calls for each instrumented take. The lower scan count is a workload-dependent algorithmic improvement, not a guarantee that every individual map operation decreases.

### Lane and thermal accounting

The lane ring trades a lazily grown array of at most **2,048 resident-key references** plus a cursor for eliminated per-eviction iterators. Evicted slots are overwritten. Neither heap bytes nor GC cost was measured.

The substantial lane stress comes from two cycles through 4,096 distinct Aurel cells. The boundary traces add 425 overpass and 425 speedbowl nearest queries. Of the latter, **422 use the existing full-scan fallback because no populated coarse cell is available**; only three exercise the lane index. Whole-call equality still matters, but those 425 results are not 425 banked cache queries.

Thermal counters measure `refreshMatrixInputs`, not expensive matrix rebuilds. Both variants retain **14,344 matrix-selection requests and 14,336 wet-cell advances** for each four-update Track preset. Direct default-solver refreshes fall from 1,822 to 12; mutable-parameter refreshes remain 24; the clear Track preset changes ten to eight. Exact preservation is achieved by avoiding redundant checks for the actual frozen default while retaining the existing mutable-parameter path.

### Codec copy and backing definitions

The [codec probe][codec] counts deduplicated nonempty backing identities and capacities, plus bytes moved through actual `Uint8Array.slice` and `set` hooks. Its counter calibration exercises real copying methods, wrappers are restored in `finally`, and timing runs before those hooks are installed.

| One measured boundary | Baseline backing bytes | Candidate backing bytes | Baseline slice bytes | Candidate slice bytes | Assembly set bytes, both |
| --- | ---: | ---: | ---: | ---: | ---: |
| Two-command input | 72 | 36 | 36 | 0 | 0 |
| Four-command input | 108 | 54 | 54 | 0 | 0 |
| Twelve-command input | 252 | 126 | 126 | 0 | 0 |
| 12 cars, two ordinary recipients | 2,318 | 1,006 | 1,006 | 0 | 0 |
| 12 cars, twelve prepared recipients | 13,764 | 7,116 | 6,648 | 0 | 6,228 |

Each count is reproduced for three fixture seeds. The prepared case therefore eliminates **6,648 of 12,876 counted copy bytes, or 51.6%**, calculated from the recorded counts. Saying it removes all copying would be incorrect: assembling independent recipient packets still moves 6,228 bytes.

Backing bytes are allocated capacities observed within this boundary, not peak or retained heap. The counters exclude scalar DataView writes, zero-byte buffers, module initialization, JavaScript objects and transport copies. The shared empty reset is initialized before measurement. The existing simulated transport still copies submitted packets and duplicate deliveries. These are codec ownership improvements within a network path that still has copying.

## Behavioral evidence accompanying the counts

| Comparison | Observed coverage |
| --- | --- |
| Radio | Complete offer/caption streams match for 47 scenarios and 1,620 observations per variant, including reuse, detachment, resets, rewinds and changing car counts |
| Queue | Eight traces match returns, control-reference ownership, ACK/depth/remembered state, statistics and slack resets; 3,921 public operations and 723 delivered-control reference checks |
| Codec | 51 input cases over 0–16 commands; 396 ordinary snapshot cases over 0–32 cars; 96 prepared boundaries and 1,584 recipients; exact bytes and ownership checks |
| Lane | 9,045 complete nearest results and 117,585 scalar comparisons match, with candidate/witness/order and fallback checks |
| Thermal | 3,084 default columns/12,336 scalars, 20 mutable columns/80 scalars, and 1,032,192 post-update Track bytes plus 132 weather/clock scalars match exactly |
| Simulation composition | 363 complete frames/369,171 Float32 words, 363 unrounded race-state observations, and 27 checkpoints of eight public surface arrays match |

These comparisons use full checked outputs before producing their evidence digests. The codec prepared path is also compared with the actual baseline ordinary encoder, so it has a separate encoding reference. Counts do not replace byte/behavior assertions.

The real Simulation comparison combines the historical lane and thermal modules in three seeded Aurel practice cases: clear, rain and storm, three cars, 120 ticks at 1/120 second per case. Each includes 104 human player ticks, sixteen automatic player ticks and two AI opponents. Positive controls require movement, loaded paved slip work and two surface updates. Floating values must remain finite; frame/surface bytes and race-state values are compared without rounding.

That composition is deliberately bounded to **one simulated second per case**, completes no lap and retains only **11–12 lane cells**. It does not test cache eviction inside a complete race; the separate lane stress trace supplies eviction evidence. It does not prove every venue/vehicle combination or cross-host floating-point identity.

## Timing observations and interpretation

Only queue and codec probes report time. Both use fresh uninstrumented workload executions, alternate baseline/candidate order within sequential pairs and consume results with checksums. They use seven measured pairs after warmup and have **no timing pass threshold**. The reports contain one hosted process/run, without a confidence interval, repeated independent machine runs or hardware profiling.

Here **C/B** means candidate time divided by baseline time. “Median paired C/B” is the median of seven within-pair ratios; “ratio of medians” divides the separate candidate and baseline medians. These are different summaries and should not be interchanged. Queue paired ratios in this report are independently derived from the retained vectors; the original queue report publishes the inverse ratio of medians.

### Codec

The codec uses three warmup pairs. Timed work includes encoding, preparation once per prepared boundary and checksum reads, excluding fixture construction, bundling, assertions and copy instrumentation. The two snapshot rows time complete recipient boundaries: respectively two and twelve packets per iteration.

| Workload | Encodings/boundaries per timed batch | Baseline median ms | Candidate median ms | Median paired C/B | Ratio of medians C/B |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2-command input | 8000 | 4.924 | 3.510 | 0.7306 | 0.7128 |
| 4-command input | 8000 | 5.011 | 5.152 | 0.9965 | 1.0281 |
| 12-command input | 8000 | 12.921 | 10.761 | 0.8929 | 0.8328 |
| 12 cars, 2 ordinary recipients | 600 | 4.810 | 4.541 | 0.9441 | 0.9441 |
| 12 cars, 12 prepared recipients | 180 | 3.683 | 3.095 | 0.8155 | 0.8404 |

The four-command input case is a useful restraint on interpretation: paired median **0.9965** is close to parity, while the ratio of medians **1.0281** places the candidate median above the baseline. Three of its seven candidate samples are slower than their paired baseline. The prepared-boundary paired ratios range from **0.3363 to 1.2805**, including one slower candidate sample. Other codec workloads also contain slower pairs. A favorable median in this small run is descriptive; it does not justify a universal codec speedup percentage.

### Queue

The queue uses two warmup batches and seven measured pairs. Each replay creates a queue and runs the complete trace, including dispatch and checksum overhead. Batches contain sixteen dense replays, sixty-four short-trace replays or three seeded replays. The per-replay times below divide the batch measurements by those fixed counts.

| Queue trace | Baseline median ms per replay | Candidate median ms per replay | Median paired C/B | Ratio of medians C/B |
| --- | ---: | ---: | ---: | ---: |
| dense-sequential | 0.376507 | 0.030537 | 0.0804 | 0.0811 |
| reordered-late | 0.004217 | 0.003034 | 0.7162 | 0.7196 |
| backward-take-and-admission | 0.002795 | 0.002341 | 0.8332 | 0.8377 |
| large-sparse-jumps | 0.001353 | 0.001312 | 0.9574 | 0.9696 |
| wire-endpoints | 0.002735 | 0.002247 | 0.8262 | 0.8215 |
| seeded-11 | 0.424944 | 0.320958 | 0.7418 | 0.7553 |
| seeded-1234abcd | 0.386114 | 0.282245 | 0.8155 | 0.7310 |
| seeded-fedcba98 | 0.863569 | 0.470865 | 0.5513 | 0.5453 |

The dense trace has the clearest measured contrast: its median complete replay falls from approximately **0.377 ms to 0.0305 ms** on this host, alongside the independently counted scan reduction. This is time for its 248-slot trace, not a per-frame saving or multiplayer latency result.

The sparse-jump trace is close to parity, and one of its seven pairs is slightly slower for the candidate. Several short batches last around a tenth of a millisecond, so small ratios should not be treated as portable performance guarantees. Checksums and trace construction are part of the time; the table does not isolate the expiry method alone.

## Claims suitable for release documentation

The evidence supports saying that the engine removes radio frame-history copies, bounds sequential queue expiry work, avoids FIFO eviction iterators, skips redundant frozen thermal signature checks, and reduces codec copying while preserving the checked outputs. It also supports describing the exact short Simulation comparison and its real AI/thermal composition.

Keep the workload units beside each number. Preserve the ring's bounded-reference cost, retained prepared/transport copies, unchanged mutable thermal work, and one-second Simulation limit. Do not translate these counts into game FPS, hardware CPU savings, lower power use, reduced physical-network latency, measured GC pauses or a claim that the entire engine is allocation-free.

This assignment authored only this measurement report. It did not modify production, tests, visual content, models, characters, environments, animation, branches or refs, and it did not download or inspect the hosted artifact ZIP.

[job]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45637677573/job/139287423560
[later-run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45641670477
[probes]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/docs/engine/runtime-2026-11-25/evidence/92e2dc2/probes.json
[result]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/docs/engine/runtime-2026-11-25/evidence/92e2dc2/result.json
[log]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/docs/engine/runtime-2026-11-25/evidence/92e2dc2/hosted-job.log
[support]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/scripts/engine-runtime-probes/support.mjs
[codec]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/scripts/engine-runtime-probes/codec-probe.mjs
