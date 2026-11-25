# Engine performance: measured gains, costs and current policy

Assignment **57/60**, wave 10, complete. This is an independent audit of the
eight retained timing artifacts. It introduces no new benchmark run or engine
change. The accepted executable source is
`774e62fafdfd9ecd84001a2fcdb3b9f6ee973b86`; the original source is
`350119e8ec0606e8c5de5b3ab80df41104025679`.

The strongest measured improvements concern repeated paved lane queries,
steady-rain surface evolution, warm audio work, twelve-recipient snapshot
encoding and overlapping dirty-buffer updates. The integrated Simulation
experiment also improved its rain and storm workloads. The costs are concrete:
lane-cache churn, several surface cases, audio first use and disjoint dirty
ranges take longer. Those outcomes determine how the results below should be
used. They do not combine into a defensible whole-game FPS percentage.

## What this audit independently checked

The [recomputed evidence](evidence/w10-performance-claims-audit.json) contains
every **175 case/scope row**, **1,567 measured pairs** and **517 warmup pairs**
from the eight canonical files. All **7,533** recomputed arithmetic, count,
unit-conversion and recorded-equality checks matched. No sample was dropped,
retimed or replaced. These rows share processes, source graphs and sometimes
overlapping work; they are not 175 independent experiments.

The source audit checked **23 distinct retained manifests**, including
**1,035 repository-file entries** and **22 installed-dependency entries**.
Repeated files across different graphs contribute separate manifest entries.
Every recorded source hash and byte count matches its pinned Git blob or
recorded installed dependency. All **nine unique runner/helper files** match
both the accepted commit and the working files. The accepted production `src`
tree equals the preceding `26efaeef` tree. These checks establish source
identity; they are separate from workload execution.

Only the expected later changes distinguish the relevant historical candidate
graphs from the accepted graph: `server.ts` has the twelve-recipient policy,
and the original attribute graphs have the superseded range helper. The
revised attribute measurement already uses the accepted helper. The lane,
surface, audio and Simulation graphs retain their measured implementation.
See the complete graph differences and artifact hashes in the audit JSON.

### Reading the statistics

Tables give elapsed synchronous workload time on the recorded Node 24.22.3 /
V8 13.6 Linux environment with an AMD EPYC 9V74 CPU model. These are wall-clock
intervals, including VM or scheduling pauses, rather than sampled process-CPU
profiles. Setup, observation and ordinary production allocation boundaries
differ by workload and are stated below. There was no forced collection.

| Statistic                    | Definition and interpretation                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Original and current median  | Median elapsed time of each arm separately; absolute units are stated in each table.                                                           |
| Paired time change           | Median of `100 × (current / original − 1)` within corresponding measured pairs. Negative means less time.                                      |
| Paired time ratio            | Median of `current / original` within pairs. A value below one means less time.                                                                |
| Faster pairs                 | Count of pairs with less current time. It describes this run's direction, not a confidence interval or a population-level significance result. |
| Ratio of independent medians | `median(current) / median(original)`. Its inverse is the reported original/current speed ratio. It can disagree with the paired statistic.     |

Audio uses **two warmup pairs and eight measured pairs per case**. The other
seven artifacts use **three warmup pairs and nine measured pairs**. Warmups
remain in the files and equality totals but are excluded from timing medians.
Paired order alternates; the crossover additionally shuffles case order by
recorded seed. Shared-host noise and process/JIT history remain possible.

| Retained artifact                                                           | Candidate pin | Timed comparison                                                     |
| --------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------- |
| [Lanes](evidence/lane-measurement.json)                                     | `aaaf5001`    | Actual original/current Track calls and construction                 |
| [Surfaces](evidence/surface-measurement.json)                               | `aaaf5001`    | Actual original/current surface and thermal work                     |
| [Network](evidence/network-measurement.json)                                | `6a1c76fa`    | Original encoders against the earlier candidate routes               |
| [Audio](evidence/audio-measurement.json)                                    | `6a1c76fa`    | Actual original/current arithmetic with declared cache state         |
| [Original ranges](evidence/attribute-measurement.json)                      | `6a1c76fa`    | Original against the first range implementation, now historical      |
| [Simulation](evidence/simulation-measurement.json)                          | `6a1c76fa`    | Actual original/current combined Simulation                          |
| [Snapshot crossover](evidence/snapshot-crossover-measurement-6cb1c881.json) | `6cb1c881`    | Two actual current-code variants; original is an untimed wire oracle |
| [Revised ranges](evidence/attribute-review-measurement-26efaeef.json)       | `26efaeef`    | Original against the current revised range helper                    |

The pinned commands and installation precautions are in
[REPRODUCING](REPRODUCING.md). Historical pins reproduce historical policy;
running a tool against a later source creates a new experiment.

## Physics: reuse helps bounded working sets

### Lane queries and construction

The repeated-query cases prime a bounded set of 256 queries, then time 65,536
actual nearest calls per sample. Timing includes copying the returned values
into an existing output buffer. Each cold-stream case visits 4,096 distinct
cells repeatedly, exceeding the new 2,048-entry cap and forcing every call to
miss; it times 32,768 calls. Production candidate construction and eviction
remain inside that timer. [W07A](w07a-lane-measurement.md).

| Paved fixture | Warm original → current, µs/query | Original/current warm median ratio | All-miss original → current, µs/query | Current/original all-miss median ratio |
| ------------- | --------------------------------: | ---------------------------------: | ------------------------------------: | -------------------------------------: |
| Aurel         |                     1.137 → 0.475 |                             2.396× |                         0.892 → 2.063 |                                 2.314× |
| Vellamar      |                     1.084 → 0.424 |                             2.557× |                         0.771 → 2.059 |                                 2.670× |
| Speedbowl     |                     0.956 → 0.542 |                             1.764× |                         0.737 → 1.967 |                                 2.670× |
| Figure-eight  |                     1.655 → 0.448 |                             3.698× |                         1.145 → 2.508 |                                 2.190× |

Every warm pair favors current and every all-miss pair favors original for
these four fixtures: nine of nine in each direction. The paired statistics
are also retained; the speed ratios in this table specifically use independent
medians. Candidate-scan reductions of roughly 75–83% are separate operation
counts and should not be substituted for elapsed-time changes.

The unchanged-index controls and fallbacks are less decisive. GP's independent
median rises from 0.351 to 0.391 µs/query, **+11.44%**, while its paired change
is **+3.16%**, with current faster in four of nine pairs. MX and rally controls
have slightly lower independent medians but positive paired changes. The
outside-hash fallback changes 29.156 → 30.080 µs/query yet has five faster
current pairs; the unproved-height fallback changes 4.489 → 4.619 with three.
These observations support reporting variation, rather than attributing all
small differences to the new cache.

Repeated complete Track construction measures **3.779 → 4.078 ms** for Aurel,
3.279 → 3.270 for Vellamar, 3.458 → 3.265 for Speedbowl and 3.031 → 3.070 for
figure-eight. Construction includes the separate surface changes. Speedbowl's
lower independent median coexists with only four faster current pairs; there
is no consistent construction-speedup conclusion. This is warmed repeated
construction, not process startup.

The paved cache bounds **entries**, not bytes. Geometry determines each
candidate-array length, and Map/string/array overhead was not measured.
Existing MX/SX indexing retains its previous unbounded policy; RX and rally
remain unindexed. The 2,048-entry limit therefore must not be described as a
new universal limit on all terrain caches.

### Surface evolution

The following units are milliseconds per complete **3,584-cell surface tick**;
the final row is per **3,584-column direct thermal step**. Track construction,
declared priming and output checking are outside timing. Production evolution,
coefficient work and explicitly staged mutable inputs stay inside.
[W07B](w07b-surface-measurement.md).

| Case                      | Original → current, ms/unit | Paired time change | Faster pairs |
| ------------------------- | --------------------------: | -----------------: | -----------: |
| Clear default             |             0.3330 → 0.3707 |             +2.89% |          1/9 |
| Steady rain               |             0.6215 → 0.3866 |            −38.41% |          9/9 |
| Exposed storm             |             0.6535 → 0.7010 |             +6.53% |          2/9 |
| Staged mutable weather    |             0.6345 → 0.4777 |            −24.62% |          8/9 |
| Snow/thaw                 |             0.3263 → 0.3316 |             +0.54% |          4/9 |
| First wet tick            |             0.6559 → 0.7321 |            +16.91% |          0/9 |
| Variable thermal timestep |             0.4841 → 0.5778 |            +20.57% |          2/9 |

Clear's independent-median increase is **11.31%**, larger than its **2.89%**
paired increase; both belong in a reading of the data. Changing timestep
and first-use coefficient work expose costs that the steady-rain case does
not. Several mutable/snow schedule endpoints occur after the final weather
keyframe, so these are staged schedules, not continuously changing climate
throughout each interval.

The implementation adds **286,720 bytes / 280 KiB of typed-array payload per
Track**: fixed depression, water and thermal caches. This arithmetic excludes
array/object headers, scalar keys and allocator effects. It is a retained
payload cost, not a measured process-memory increase. The separate
[W08A edge proof](w08a-physics-cache-review.md) protects exact arithmetic and
validation behavior; it does not provide additional timing evidence.

### Combined Simulation

Each measured sample applies controls, steps the actual Simulation **480 times
at 1/120 s** and writes **240 complete frames**. That is four simulated seconds.
Construction, priming and comparison are outside the timer. Actual step/frame
allocations remain inside. [W07F](w07f-simulation-measurement.md).

| World                           | Original → current, ms/sample | Paired time change | Faster pairs |
| ------------------------------- | ----------------------------: | -----------------: | -----------: |
| Aurel clear, four cars          |             324.517 → 300.892 |             −7.28% |          6/9 |
| Aurel rain, four cars           |             389.822 → 358.152 |            −11.88% |          7/9 |
| Aurel storm, four cars          |             359.053 → 315.476 |            −12.14% |          8/9 |
| Vellamar first steps, four cars |             470.676 → 456.274 |             −0.54% |          5/9 |
| GP clear control, two bikes     |               63.055 → 61.738 |             +2.17% |          4/9 |
| MX clear control, two bikes     |               67.671 → 65.504 |             −2.25% |          6/9 |

Rain and storm each have lower paired medians in both execution orders. Clear
is less settled: its original-first group has a **−7.28%** median change, while
its current-first group has **+14.02%**, including current-side spikes. The
first-step and control cases have mixed directions. The rain/storm result
supports improvement for those combined workloads; it does not allocate the
gain separately to lanes and surfaces. Their subsystem percentages must not
be added to this integrated result.

The retained comparisons include 463,357 scalar observations, 44,474,976 typed
array bytes and 81,168,000 packed-frame bytes. The observer cannot directly
inspect ECMAScript private fields or callback captures. This is a four-second
Simulation workload, not a browser worker, rendered lap or long-session soak.

## Networking: preparation now starts at twelve recipients

The historical encoding experiment times all packet construction for a
captured twelve-car broadcast, including writers, prepared car bytes and
owned final copies. It excludes world capture, header-object construction,
server dispatch/reentry, transport and physics. Current source uses ordinary
encoding below **12 selected ready recipients**, following the independent
crossover review. [W07C](w07c-network-measurement.md),
[W08B](w08b-network-review.md).

| Historical broadcast                    | Original → earlier candidate, µs/broadcast | Paired time change | Faster pairs |
| --------------------------------------- | -----------------------------------------: | -----------------: | -----------: |
| One recipient, ordinary route           |                              5.103 → 5.196 |             −3.27% |          5/9 |
| Two recipients, earlier prepared route  |                            12.298 → 14.716 |            +29.15% |          2/9 |
| Four recipients, earlier prepared route |                            23.878 → 23.812 |             +2.63% |          4/9 |
| Twelve recipients, prepared route       |                            80.436 → 50.836 |            −31.17% |          9/9 |

The zero-recipient case encodes nothing and measures approximately
0.002 µs of loop/branch work per iteration. It is not a packet-encoding result.
The two- and four-recipient rows describe the superseded routing policy; they
must not be presented as the accepted default.

The separate 22-case crossover times **ordinary versus prepared encoding from
the same current codec source**. Original source supplies an untimed complete
wire/decode oracle. At twelve cars/twelve recipients, independent medians are
**85.350 → 67.498 µs**, paired change **−15.66%**, with eight faster prepared
pairs out of nine. Two recipients yield **+15.50%** paired time in a full
twelve-car field and **+28.96%** in a two-car field. Some intermediate counts
show substantial lower medians, alongside broad pair variation and an
allocation tradeoff. The evidence does not identify a universal optimum at
twelve or rule out benefits below it on other workloads.

Twelve is a conservative policy supported by both experiments and measured
backing capacity. At twelve cars, ordinary encoding allocates cumulative
backing capacity `1,159 × recipients` bytes; preparation uses
`1,692 + 1,006 × recipients`. At twelve recipients those totals are
**13,908 versus 13,764 bytes**. Prepared encoding still creates **three extra
backing buffers**. The totals are allocation observations for the call, not
retained heap or GC measurements. The crossover checks 4,576 complete packets /
1,958,528 bytes per variant against its original-wire oracle.

Input packet capacity is a separate improvement. The elapsed encoding results
below include actual encoding, final owned copies and output-ring writes.

| Commands in packet | Original → current, µs/packet | Paired time change | Faster pairs |
| ------------------ | ----------------------------: | -----------------: | -----------: |
| 0                  |                 0.646 → 0.577 |             −4.90% |          7/9 |
| 1                  |                 1.038 → 0.575 |            −42.16% |          8/9 |
| 4                  |                 1.396 → 0.863 |            −38.14% |          9/9 |
| 12                 |                 3.036 → 2.327 |            −23.37% |          6/9 |
| 16                 |                 4.159 → 4.839 |            −17.31% |          8/9 |

The 16-command independent medians rise **16.34%** even though eight paired
comparisons favor current. This disagreement and the large variation preclude
a firm blanket improvement for that case. Exact capacity removes the observed
writer-growth step; it retains the final owned copy and is not allocation-free.
Presentation-clock monotonicity and transfer accounting are correctness
improvements, not reductions in physical-network latency.

## Audio: substantial warm gains, explicit first-use cost

These are elapsed **milliseconds per declared batch**, using actual arithmetic
and stored outputs. Modules, profiles, argument schedules and trace allocation
are prepared outside timing; lazy basis creation, returned objects and output
writes remain inside where the case requires them. Cold means fresh module
cache state, not a cold process, JIT or CPU cache.
[W07D](w07d-audio-measurement.md).

| Batch                                      | Original → current, ms | Paired time change | Faster pairs |
| ------------------------------------------ | ---------------------: | -----------------: | -----------: |
| First full waveform                        |          2.282 → 4.668 |            +95.67% |          0/8 |
| First active family                        |          6.386 → 7.839 |            +19.32% |          1/8 |
| First family, basis already warm           |          3.502 → 1.238 |            −64.69% |          8/8 |
| 32 fresh profiles, warm basis              |         99.441 → 8.039 |            −91.82% |          8/8 |
| 72 waveforms, initially cold basis         |        71.666 → 13.264 |            −81.33% |          8/8 |
| 72 waveforms, warm basis                   |         69.989 → 5.301 |            −92.44% |          8/8 |
| 8,192 cached active updates, 117 harmonics |        86.436 → 26.763 |            −69.12% |          8/8 |
| 4,000,000 cached zero-gain calls           |        71.060 → 74.738 |             +4.94% |          0/8 |

The first waveform's independent-median increase is **104.55%**; the first
family's is **22.75%** and zero gain's **5.18%**. Those differ from the paired
column. The warm 72-wave sweep and cached-update independent changes are
**−92.43%** and **−69.04%**, respectively, which explains the rounded
independent-median figures in the overview.

The lazy 2,048 × 40 Float64 basis retains **655,360 bytes / 640 KiB** once
created. Arithmetic reuse reduces the separately observed 117-harmonic active
update from 117 sine calls to one and from 819 cosine calls to 235. Those are
operation counts, not additional independent timing experiments. Short cold
spectra and spectra beyond the supported basis retain their declared fallback
behavior; authored profiles and arithmetic ordering remain protected.

The exact comparison total is **40,085,160 numbers**, counting warmup and
measured boundaries. **40,000,000 of those values belong to the zero-gain
control**. The remaining 85,160 comprise 81,920 cached active-update values,
2,880 waveform-sweep values, 320 fresh-profile values and 40 first-use/family
values. This distribution matters: the large total must not imply forty
million independently varied active spectra. Native mixed PCM has its own
fixture-specific error budget and controls; these CPU arithmetic timings do
not measure audio-device latency or audible quality.

## Rendering: fewer uploads, residual disjoint-range CPU cost

The revised range helper uses a constant-time last-span merge/append path and
normalizes the actual public list when capacity is threatened. The original
W07 candidate performed much more repeated normalization. W08E's new
original-versus-current run preserves all 26 cases in two scopes: helper only,
and helper plus the actual Three uploader against a recording GL boundary.
Both scopes include loop/reset/dispatch work. The second also includes real
uploader decisions and JavaScript copies into recorded storage.
[W08E](w08e-render-resources-review.md).

| Current-policy case  | Upload bytes, original → current | Complete scope, original → current ns/mark | Complete paired time ratio | Faster pairs |
| -------------------- | -------------------------------: | -----------------------------------------: | -------------------------: | -----------: |
| 17 duplicate marks   |                      49,152 → 48 |                              99.73 → 30.72 |                     0.316× |          9/9 |
| 17 adjacent marks    |                     49,152 → 816 |                              94.19 → 30.46 |                     0.329× |          9/9 |
| Bridge at 16 entries |                     49,152 → 732 |                              95.55 → 68.01 |                     0.721× |          9/9 |
| 1 disjoint mark      |                          12 → 12 |                            195.73 → 256.49 |                     1.354× |          0/9 |
| 2 disjoint marks     |                          24 → 24 |                            172.11 → 238.52 |                     1.368× |          0/9 |
| 16 disjoint marks    |                        192 → 192 |                             92.52 → 113.32 |                     1.215× |          1/9 |
| 17 disjoint marks    |                  49,152 → 49,152 |                             94.99 → 123.52 |                     1.314× |          0/9 |
| Full then partials   |                  49,152 → 49,152 |                              97.46 → 93.12 |                     0.942× |          7/9 |
| Empty mark           |                            0 → 0 |                              21.05 → 21.89 |                     1.004× |          3/9 |

Every disjoint size from **1 through 17** has a higher current independent
median and paired ratio in both scopes. Complete-scope paired penalties range
from **17.55% to 36.84%**; helper-only penalties range from **53.22% to
111.19%**. The worst percentages do not correspond to the largest absolute
frame cost. These loops repeatedly measure small operations and have no
native-driver/GPU timer.

At sixteen disjoint marks, helper medians are **22.95 → 37.26 ns/mark**, paired
ratio **1.706×**. Independent-median additional batch work is approximately
**0.229 µs** in the helper scope or **0.333 µs** in the complete scope. The
scopes overlap: **do not add those costs**. At the bridge, helper-only CPU
still rises **42.03%** by paired ratio even as the complete scope falls 27.88%
because publication changes. Both measurements describe part of the tradeoff.

The earlier candidate's sixteen-disjoint medians were 193.07 ns/mark for the
helper and 296.53 for the complete scope. The revised candidate's much smaller
numbers come from a **separate session**, with a fresh original arm. They are
not a directly paired old-candidate/new-candidate speedup. Several revised
candidate medians are worse than their old-candidate medians for duplicate,
contained, overlap, full, empty and small-disjoint cases. The old 52 rows and
new 52 rows remain independently accessible; neither run was overwritten.

An untimed actual FestivalTrails composition separately checks equal resulting
buffer contents: after 41 snapshots, **81,920 → 25,600 upload bytes**; at the
181-snapshot ring wrap, **81,920 bytes on both**; the following narrow update,
**640 bytes on both**. Byte counts quantify publication work. They do not
establish a proportional GPU-duration change. Native complete-buffer checks
are additional correctness evidence, not native performance measurements.

## Resource and acceptance boundaries

| Quantity                                          | Supported interpretation                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Paved lane cache: 2,048 entries                   | Bounded entry count for newly indexed paved venues; variable candidate storage and runtime overhead remain.           |
| Surface cache: 280 KiB per Track                  | Additional fixed typed-array payload; constructor work and mutable-key misses have measured costs.                    |
| Audio basis: 640 KiB on first use                 | Retained typed-array payload with measured cold cost and warm benefit.                                                |
| Nonmonotonic ghost index: at most 72,008 bytes    | Added logical index payload for a maximum recording; strict monotonic recordings allocate no index.                   |
| Unsupported flashback journal: 36,000 → 0 entries | Observed retained-entry count in the 600-second worker scenario; it does not quantify heap reclamation.               |
| Snapshot buffers and uploaded bytes               | Directly observed capacities/arguments, with owned final packets and exact content checks; not heap/GC or GPU timing. |

Ghost and journal evidence is detailed in
[W03B](w03b-ghost-first-passage.md) and
[W03D](w03d-flashback-retention.md). The resource table is not a sum: objects
have different lifetimes and may not coexist. No retained-heap profile,
energy measurement or physical GPU/audio/controller experiment was performed.

The accepted focused workflow reports **914 tests in 70 files, full TypeScript
and production build success, and 47 native cases passed**. The native backend
is software ANGLE/Mesa llvmpipe. MeshBasic and raw-`vec3` diagnostic paths still
show **64 differing bytes out of 256**, while the strict shared-gate `vec4`
control passes. Those limitations remain visible; successful gate ownership
does not certify every material or game image. Broader repository browser
assertions/timeouts also remain unresolved. See the
[native audit](w09c-native-evidence-audit.md) and
[failure classification](w09d-baseline-failure-classification.md).

The performance claims in [README](README.md) and
[ENGINE_CHANGES](ENGINE_CHANGES.md) were reconciled against the raw samples and
the current source policies. Their quoted figures are consistent with these
recomputations. Further optimization can use the retained adverse cases as
specific targets; it still needs a fresh source-pinned comparison and must
preserve the existing numerical, ownership and authored-content contracts.
