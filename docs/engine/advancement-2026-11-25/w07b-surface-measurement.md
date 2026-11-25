# Wave 7 / assignment 38: actual-baseline surface measurement

## Result

**Complete: actual-source correctness passed, and the reserved local measurement found both improvements and regressions.** Steady rain used 37.8% less time by the ratio of elapsed-time medians; the mutable-weather workload used 24.7% less. Default clear, storm, first rainy ticks and the changing-solver-timestep workload were slower in most or all pairs. Snow/thaw was mixed and near neutral. These findings support a steady-rain benefit, not a general surface-engine speedup.

The coordinator ran the canonical command under an explicit exclusive-compute reservation and shared timing lock on 2026-11-25, beginning at 08:38:12 UTC and producing its report at 08:38:28 UTC. The real original source tree was `350119e8ec0606e8c5de5b3ab80df41104025679`; the measured current tree was `aaaf5001a9e13e3e6839fc7ecada7b542a4005bc`. The earlier untimed preflight used current commit `9922926e786c35e84810efc8b15e75bcfaba5372`. This assignment reviewed the completed run without rerunning it or editing production source.

Both native module graphs contain 63 recorded source/configuration files. The shared helper records each file's exact SHA-256, the locked dependencies, source commits, loader/build details, runtime, helper and workload identities, and checks source stability again before reporting. Supplemental imports of `surface-thermal.ts` and `weather.ts` are already members of the recorded Track graph. There are no rewritten production files or reconstructed baseline equations. The three relevant working source files still matched their recorded measurement hashes during this review.

Files:

- Workload: `scripts/engine-advancement/measure-surfaces.mjs`.
- Canonical timed evidence: [surface-measurement.json](evidence/surface-measurement.json), SHA-256 `f1e0566a4c8ecfe89af46491a2c8638eeaad0e27d3f78905cd8faa262c254a79`.
- Derived statistics and all nine raw pair values per case: [surface-measurement-analysis.json](evidence/surface-measurement-analysis.json). This is analysis of the canonical report, not another engine run; it records the input report hash.
- Current script preflight: `evidence/surface-measurement-preflight.json`.
- Initial preparation smoke: `evidence/surface-measurement-smoke.json`. This earlier report preserves its own workload hash; the later preflight additionally rejects non-finite array observations and uses the final measurement defaults.
- Coordinator command log: `/tmp/aeebac160835-engine/validation/w07b-surface-measurement.log`.

The earlier W02E proof and W05A integration tests supplied fixture ideas. This workload imports each complete actual source graph independently; it does not reuse the older proof's adapted modules or private-state accessor.

## Measured time and pair consistency

These are elapsed times for the entire bounded sample. A grid step advances 3,584 cells; the direct solver case advances 3,584 Float64 columns. **Negative time change means less current time.** The separate-median change is `100 × (median(current) / median(original) − 1)`. The paired change is the median of `100 × (current / original − 1)` computed within each AB/BA pair. These statistics can differ when the samples drift or have asymmetric spikes, so both are reported.

| Workload                    | Grid steps/sample | Original median, ms | Current median, ms | Difference of medians, ms | Separate-median change | Median paired change | Current faster pairs |
| --------------------------- | ----------------: | ------------------: | -----------------: | ------------------------: | ---------------------: | -------------------: | -------------------: |
| Default clear               |               128 |              42.626 |             47.446 |                    +4.820 |                 +11.3% |                +2.9% |                  1/9 |
| Steady rain                 |               128 |              79.557 |             49.484 |                   −30.073 |                 −37.8% |               −38.4% |                  9/9 |
| Exposed storm               |               128 |              83.645 |             89.733 |                    +6.088 |                  +7.3% |                +6.5% |                  2/9 |
| Mutable weather             |               176 |             111.677 |             84.075 |                   −27.603 |                 −24.7% |               −24.6% |                  8/9 |
| Snow/thaw                   |               128 |              41.770 |             42.439 |                    +0.669 |                  +1.6% |                +0.5% |                  4/9 |
| First rainy tick, 32 Tracks |                32 |              20.989 |             23.428 |                    +2.439 |                 +11.6% |               +16.9% |                  0/9 |
| Variable solver dt          |               128 |              61.962 |             73.952 |                   +11.990 |                 +19.4% |               +20.6% |                  2/9 |

For scale, the median per-grid-step times were 0.3330→0.3707 ms for clear, 0.6215→0.3866 ms for rain, 0.6535→0.7010 ms for storm, 0.6345→0.4777 ms for mutable weather, 0.3263→0.3316 ms for snow/thaw, 0.6559→0.7321 ms for a first rainy tick, and 0.4841→0.5778 ms for the direct variable-dt solver. These are surface/column workload units, not simulation-frame or rendering times.

All raw samples and warmups are retained. The following range includes every paired sample; no outlier was removed. AB means original first; BA means current first. There are five AB samples and four BA samples in each case.

| Workload           | Paired time-change range | AB median change | BA median change | Interpretation within this session                                      |
| ------------------ | -----------------------: | ---------------: | ---------------: | ----------------------------------------------------------------------- |
| Default clear      |          −9.8% to +92.1% |            +5.3% |            +2.0% | Slower in 8/9 pairs; small typical penalty with substantial noise.      |
| Steady rain        |         −40.9% to −34.7% |           −39.0% |           −37.7% | Strong, consistent reduction across both orders.                        |
| Exposed storm      |          −7.9% to +13.5% |            +6.5% |            +3.3% | Slower in 7/9; meaningful regression signal despite overlapping ranges. |
| Mutable weather    |          −29.5% to +8.9% |           −24.6% |           −21.9% | Faster in 8/9; one slow pair remains included.                          |
| Snow/thaw          |          −15.6% to +6.6% |            +3.1% |            −1.9% | Mixed signs and order medians; no established improvement or penalty.   |
| First rainy tick   |          +5.8% to +41.0% |           +16.9% |           +13.3% | Slower in all nine pairs and all three warmup pairs.                    |
| Variable solver dt |         −14.2% to +27.4% |           +20.6% |           +18.9% | Slower in 7/9; large penalty in both order groups.                      |

### What the noisy cases do and do not show

**Clear:** The median within-pair absolute penalty was 1.216 ms per 128 ticks, rather than the 4.820 ms difference between separately selected medians. Samples 4–7 were each 1.3–2.9% slower; sample 9 jumped from 41.511 ms original to 79.728 ms current, while sample 8 was slow on both sides at 71.240/78.043 ms. The current sample range was 42.410–79.728 ms versus 41.511–71.240 ms original. Eight slower pairs and positive AB/BA group medians make a small default-path penalty plausible, but this session does not support treating 11.3% as its stable magnitude. No improvement can be claimed.

**Storm:** Seven pairs were slower, and all three warmup pairs were slower. The two faster-current pairs coincide with relatively slow original durations of 99.789 and 88.997 ms. The median within-pair penalty was 5.300 ms per 128 ticks. The original/current ranges overlap (78.908–101.099 / 85.981–106.252 ms), but positive median penalties in both orders and repeated slower pairs support investigating a real regression. They do not establish a profiler attribution.

**Variable dt:** Seven pairs were 15.4–27.4% slower. The two reversals contain the highest original durations, 86.160 and 73.040 ms, versus an original median of 61.962 ms. The median within-pair penalty was 12.009 ms, and each order group's median penalty was approximately 19–21%. This is a stronger regression signal than clear: the ordinary current samples are consistently above most original samples. It describes deliberately changing solver parameters/timesteps, not Track's fixed internal timestep.

**Cold rainy ticks:** All nine pairs slowed, including both execution orders. The median within-pair penalty was 3.389 ms per bank of 32 Tracks. Original/current sample ranges were 18.539–22.248 / 22.260–26.362 ms. These samples are shorter than the aspirational 50 ms minimum, which limits precise magnitude claims, but their consistent direction and non-overlapping ranges warrant retaining the cold-path regression. Construction is outside this timer.

**Snow/thaw:** The 0.219 ms median within-pair difference is small relative to its 1.659 ms median absolute deviation. Pair directions and order-group medians disagree. Its original warmup durations were unusually variable (60.509, 129.219 and 71.432 ms); the raw evidence retains them. The appropriate result is near-neutral/noisy, not a claimed improvement or a firm 1.6% regression.

**Rain and mutable weather:** Rain is consistent even at the extremes: every current sample is below every original sample. Mutable weather shows a substantial paired reduction in eight pairs, with one 132.151→143.888 ms reversal retained. Its reduction must be scoped to this schedule: 130 of 176 timed surface endpoints occur at or after the final weather keyframe at 24 seconds. Shelter, drainage and traffic changes continue, but this is not a benchmark of continuously changing weather for the entire sample. Similarly, 118 of 128 snow/thaw endpoints occur at or after its final keyframe at six seconds; the workload includes a short thaw transition followed mostly by settled weather.

### Plausible source costs to investigate

The following are **inferences from the recorded source and the workload patterns**, not measured cache hit counters, instruction profiles or proven causal attribution. All three reviewed source files match the hashes in the timed report.

In `SurfaceThermalStep.prepareMatrix` and `refreshMatrixInputs` (`src/simulation/surface-thermal.ts`), a change of timestep, air coefficient or matrix parameters invalidates the per-cell rainfall bank. A changing rainfall still checks the signature per cell. A cache miss then computes the unchanged matrix and writes a rainfall key plus six Float64 coefficients. Steady rain can reuse this work across ticks, matching its consistent gain. During the storm sample, rain, wind and gusts evolve continuously, limiting useful matrix reuse while signature checks, bank clearing, lookup checks and writes remain. The direct variable-dt workload deliberately changes those inputs, and also invalidates the water bank when dt changes. Miss-path bookkeeping is therefore a credible candidate for both observed penalties.

The default clear thermal path already returns immediately when its zero rainfall matches the current single-rain matrix. It does **not** read and rewrite six matrix coefficients for each dry cell. `advanceWater` and `WaterStepCoefficients.gain` (`src/simulation/weather.ts`) still add cache dispatch, slot checks, timestep/drainage checks and an array read per applicable cell, while avoiding an exponential. These checks, extra method arguments and changed call shapes are plausible default-path overhead; the present report cannot isolate them from JIT/host noise. A validated dry-film shortcut or a cheaper cache-hit path would require its own correctness and paired evidence before being accepted.

The first rainy tick populates the per-cell water and thermal caches without a previous tick from which to reuse them. Its consistent penalty matches that cold miss/write cost. It is distinct from the retained 280 KiB payload and from whole Track construction. A possible follow-up is to avoid expensive cache admission or writes during continuously invalidating regimes, preserving the current exact equations, mutable-parameter invalidation and array bounds. Another is to reduce redundant signature work for the frozen default parameters while preserving the mutable-parameter contract. No such change was made here, and none is claimed to be a demonstrated fix.

The next engineering decision should consider these specific regressions alongside the separate combined-simulation evidence. The current evidence does not justify presenting the surface caches as an unconditional engine improvement or hiding the default/first-tick costs behind the steady-rain result.

### Measurement limits

The run used Node v24.22.3 on Linux x64, V8 13.6.233.17-node.63, an AMD EPYC 9V74 host reporting nine logical CPUs, native TypeScript transformation, and reused module instances. The coordinator recorded exclusive local compute and held one cooperative lock for the full suite. This does not prove isolation from unrelated host activity. No CPU affinity, GC trace, instruction profile or independent-machine/browser repetition is claimed.

Cases ran in a fixed sequence in one process. Samples within a case use identical deterministic fixtures, so nine pairs are repeat measurements rather than nine independent workloads. The paired range, directions and median absolute deviations are descriptive; no confidence interval or formal significance claim is made. Some warm clear/snow samples and every cold bank sample fell below 50 ms; all stayed bounded and were retained. No rerun was requested to select a more favorable result.

## Workloads and boundaries

| Case                  | Actual work in a timed sample                                                                                                                                                                                                                             | Work outside the timer                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `clear-default`       | Real default clear-weather `Track.evolve`; dry/zero-rain fast path remains exercised.                                                                                                                                                                     | Default Track construction and one warm surface tick.                  |
| `rain-steady`         | Real rainy preset; exposed per-cell rainfall/depression and water/thermal evolution.                                                                                                                                                                      | Track construction and one warm tick.                                  |
| `storm-exposed`       | Actual storm preset including its changing air and weather inputs.                                                                                                                                                                                        | Track construction and one warm tick.                                  |
| `mutable-weather`     | Wet/dry/wet weather timeline, row shelter changes, mutable drainage including zero and near-zero values, eight traffic interactions per caller update, and fragmented caller dt. Fixture staging remains inside the timer and is identical on both sides. | Track construction, keyframe cloning and one warm tick.                |
| `snow-thaw`           | Actual snow-to-thaw weather timeline, thermal, water and frozen phase evolution.                                                                                                                                                                          | Track construction and one warm tick.                                  |
| `rain-first-tick`     | One first surface tick on each of 32 fresh rainy Tracks, including their first cache-fill work.                                                                                                                                                           | All 32 Track constructors; no surface warmup.                          |
| `thermal-variable-dt` | Actual thermal/water solver across 3,584 Float64 columns, changing solver dt, mutable local copies of thermal parameters, weather, rainfall, shelter and drainage. All grid writes and fixture staging remain inside the timer.                           | Column/cache arrays and parameter copies; one eight-step warmup cycle. |

The default measurement uses three warmup pairs and nine sample pairs, alternating AB/BA within each phase. Both members of each pair receive the same fixture. Six warm cases use 16 iterations; a normal iteration contains eight surface or solver grid steps. The fragmented caller schedule `[0.1, 0.4, 0.3, 0.7, 1.5, 0.125, 0.375, 2]` advances eleven fixed surface ticks per iteration. The first-tick case always uses one bank of 32 Tracks per sample. The command permits explicit case/count overrides, which are recorded in the output; no sample is silently discarded.

Track always advances its surface physics in fixed 0.5-second steps. Fragmenting caller dt tests cadence, accumulated traffic heat and remainder behavior, **not a variable internal solver timestep**. The direct column workload separately changes actual solver dt through `0.5`, `0.25`, `1`, and `0.125` seconds. Its local mutable parameter object does not edit authored tuning.

Iteration counts were bounded to target meaningful subsecond samples. Actual short samples and noisy results are disclosed above. Any future measurement must use a new explicit output filename, retain all raw samples, and obtain a fresh exclusive-compute reservation; no concurrent engine build, browser run, broad test job or other benchmark should overlap it.

## Exact-equivalence oracle

The untimed audit runs before paired samples. For every Track boundary it compares the complete arrays `water`, `rubber`, `marbles`, `frozen`, `temperature`, `substrateTemperature`, `drainage`, and `sheltered`, preserving their native Float32/Uint8 bytes. It also compares every weather/clock scalar used here with `Object.is`: `surfaceClock`, `rain`, `cloud`, `ambient`, `windX`, `windZ`, `visibility`, `dust`, `gust`, `moisture`, `fogCover`, and the cold flag. Fixture time and stage are checked too. Array shape, finite values and exact bytes are checked before compact SHA-256 digests are retained.

During this separate audit, each actual thermal prototype is temporarily wrapped to observe six semantic `advanceWet` input values and four raw output values per cell. The wrapper calls the saved actual implementation unchanged. It records the raw Float64 surface/substrate/water/rainfall/drainage/consumed-heat inputs and surface/substrate/water/evaporated outputs in invocation order. All wrappers are restored in `finally`, and function identity is verified before paired workloads begin. The source graphs remain untouched.

The audit covers six Track scenarios: default clear, rain, storm, mutable weather/shelter/drainage, snow/thaw, and thin-film dry-out. Every initial state and each of eight fragmented evolve calls is checked. Results:

- **54 Track boundaries** passed exact public-state comparison.
- **66 complete surface grid ticks**, containing **2,365,440 raw Float64 input/output values**, matched exactly.
- The Track audit compared **24,376,224 bytes** across public states and raw thermal traces, with zero unequal bytes or unequal scalars.
- The direct solver compared six complete Float64 arrays plus solver/parameter scalars after each of eight steps: **1,377,024 bytes**, with zero unequal bytes or unequal scalars.
- All **seven paired smoke cases** passed their final complete-array comparison. The cold bank compares all 32 independent Track states.
- The canonical timed run repeated the same exact untimed audit and passed **all 84 paired boundaries** (21 warmup and 63 measured pairs). The paired boundaries compared **46,892,928 bytes**, with zero unequal bytes or unequal scalars; all seven harness reports mark source stability and equivalence as passed.

Each warmup and sample in the timed run also compared the full public Track state or full direct solver arrays at its boundary. The raw thermal trace was confined to the untimed audit. Reports retain checksums, compared-byte/value counts and mismatch counts, not full surface grids.

The private `Track.#surfaceHeat`, `#cellArea` and private caches are **not directly inspected**. The heat flux consumed by the real thermal solver is observed exactly at its call boundary; the final fragmented update consumes accumulated heat. This is not a claim that every private internal array has been directly compared. No production accessor or alternative implementation is introduced to expand visibility.

## Additional retained logical storage

The surface optimization adds **286,720 bytes = 280 KiB** of typed-array payload per 3,584-cell Track:

| Added storage                            |           Elements |       Bytes |
| ---------------------------------------- | -----------------: | ----------: |
| Precomputed cell depression              |      3,584 Float64 |      28,672 |
| Cached water drainage                    |      3,584 Float64 |      28,672 |
| Cached water gain                        |      3,584 Float64 |      28,672 |
| Cached thermal rainfall                  |      3,584 Float64 |      28,672 |
| Six thermal matrix coefficients per cell |     21,504 Float64 |     172,032 |
| **Total**                                | **35,840 Float64** | **286,720** |

The workload verifies the actual standalone thermal/water cache allocation shapes, and derives the private depression payload from its recorded Track allocation expression and actual exported cell count. This is a logical retained-array payload accounting, **not a retained-heap or RSS measurement**. Object/array headers and scalar cache keys are excluded.

First-tick evolution cost is a separate case. Whole Track construction stays outside every evolution timer; helper setup diagnostics remain in the raw report. For the first-tick case, the median outside-timer setup for a bank of 32 fresh Tracks was **55.751 ms original / 61.329 ms current**, separately from the **20.989 / 23.428 ms** first-tick medians. These setup diagnostics include unrelated existing constructor work and the lane-index changes, so they cannot isolate surface cache construction. The other warm fixture setup diagnostics also include their priming tick or column cycle. There is no isolated constructor-speed claim here.

## Commands and constraints

Untimed preflight, using a new output path:

```sh
node --no-warnings --experimental-transform-types \
  scripts/engine-advancement/measure-surfaces.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --output /absolute/new-surface-preflight.json
```

After an explicit exclusive-compute reservation and a stable local HEAD:

```sh
node --no-warnings --experimental-transform-types \
  scripts/engine-advancement/measure-surfaces.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --output /absolute/new-surface-measurement.json \
  --mode measure --exclusive \
  --lock /tmp/aeebac160835-engine-wave7.lock
```

All roots and the output must be explicit absolute paths. The command refuses output overwrite. The shared cooperative lock detects cooperating benchmark overlap; it cannot prove the absence of unrelated host activity. Source graph, workload, helper and HEAD stability are checked by the shared harness. Smoke mode leaves workload durations and timing summaries null, even though fixture/import preparation diagnostics are recorded outside the workload.

Scoped ESLint and Prettier pass for the prepared workload; report formatting was checked after analysis. No production source, models, character models, environment authoring, art, assets, circuits or tuning have been changed by this assignment. There are no whole-game, browser, renderer or FPS claims. Assignment 38 is complete with the gains, regressions, uncertain cases and retained-storage cost documented; candidate fixes remain a separate proof and measurement task.
