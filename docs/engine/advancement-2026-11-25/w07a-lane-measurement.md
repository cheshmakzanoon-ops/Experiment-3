# W07A — actual-baseline lane-query measurement

Assignment **37/60**, wave 7, **complete**. The actual-source measurement passed
all **18 cases, 216 warmup/sample pairs, and 124,425,216 exact numeric
comparisons**. The deliberate all-miss paved streams regressed **2.19–2.67×** in
CPU time. Repeated paved queries improved **1.76–3.70×** by the ratio of original
and current medians. Both outcomes and every sample are retained. This
assignment changes only its benchmark script, this report, and its evidence.
Production code, assets, models, environments, and tuning remained read-only.

## Executable and evidence

- `scripts/engine-advancement/measure-lanes.mjs` uses the paired harness described
  in [W04F](w04f-benchmark-harness.md).
- [lane-measurement.json](evidence/lane-measurement.json) is the canonical timed
  evidence: all raw AB/BA pairs, source manifests, runtime metadata, exact
  comparisons, candidate/cache observations, and medians. It records the
  coordinator-authorized exclusive reservation and shared lock ownership.
- [lane-measurement-smoke.json](evidence/lane-measurement-smoke.json) records the
  completed untimed preflight, full source manifests, structural probes, and
  exact equivalence results. Its workload durations and medians are all `null`;
  `exclusiveCompute` is `false`, and every case declares timing invalid for
  comparison.
- [W02A](w02a-lane-index.md) and [W05A](w05a-surface-lane-integration.md) explain
  the production changes and earlier, differently distributed correctness
  probes. Their operation counts are not timings and need not match this
  workload's distribution.

The coordinator reserved exclusive compute and held candidate HEAD
`aaaf5001a9e13e3e6839fc7ecada7b542a4005bc` stable. The lock was acquired at
**2026-11-25 08:35:32.396 UTC**; the last case completed at **08:36:17.769 UTC**,
approximately **45.4 seconds** later. Final stability checks and report writing
followed before the script removed its lock. Compute was released immediately
after completion. One timed execution ran; no calibration, selective rerun,
outlier removal, forced GC, or sample-count change was performed.

## Measured adverse cases and tradeoffs

The four deliberately evicting cold streams were slower on **all nine measured
pairs per venue**. Each query builds a new candidate list, and later passes
also evict existing entries. The smaller final nearest scan does not repay
that construction/eviction work in this workload. This is an observed cost of
the selected cache policy, even though every returned value remains exact.

All query tables report the median **microseconds per nearest call**, including
the identical output-copy work. Time change is `100 × (current/original − 1)`;
positive values mean slower. The JSON also retains absolute milliseconds per
sample and every individual pair.

| Adverse workload             | Original µs/query | Current µs/query | Median time change | Current/original time |
| ---------------------------- | ----------------: | ---------------: | -----------------: | --------------------: |
| Cold stream, Aurel           |             0.892 |            2.063 |           +131.35% |                2.314× |
| Cold stream, Vellamar        |             0.771 |            2.059 |           +167.05% |                2.670× |
| Cold stream, Speedbowl       |             0.737 |            1.967 |           +166.97% |                2.670× |
| Cold stream, figure-eight    |             1.145 |            2.508 |           +119.02% |                2.190× |
| Outside-hash Aurel           |            29.156 |           30.080 |             +3.17% |                1.032× |
| Unproved-height figure-eight |             4.489 |            4.619 |             +2.90% |                1.029× |

The outside-hash and unproved-height results have overlapping sample ranges
and mixed pair directions: current was slower in four and six of nine pairs,
respectively. Their median differences are reported rather than promoted to a
repeatable performance conclusion. The outside-hash case retains a current
149.460 ms sample against a 30.802 ms current median; that sample was not
discarded. The unproved-height case preserves the original candidate scan and
adds an index lookup whose possible cost this workload intentionally exposes.

Two further adverse medians are retained below: the existing GP control is
**11.44% slower**, and Aurel construction is **7.92% slower**. Their sample ranges
overlap and current is slower in only five and six of nine pairs. These results
do not identify the cause or establish an invariant penalty for those cases.
In particular, unchanged lane-operation counts do not prove unchanged CPU time.

## Repeated-query medians

All nine measured pairs for each newly indexed paved fixture favor current.
The four venues together show **43.30–72.96% lower median CPU time** for this
primed, bounded working set. These percentages apply to this query workload;
they are not game-wide frame-time improvements.

| Warm fixture            | Original µs/query | Current µs/query | Median time change | Original/current time |
| ----------------------- | ----------------: | ---------------: | -----------------: | --------------------: |
| Aurel                   |             1.137 |            0.475 |            −58.26% |                2.396× |
| Vellamar                |             1.084 |            0.424 |            −60.89% |                2.557× |
| Speedbowl               |             0.956 |            0.542 |            −43.30% |                1.764× |
| Figure-eight            |             1.655 |            0.448 |            −72.96% |                3.698× |
| Poggio Alto GP control  |             0.351 |            0.391 |            +11.44% |                0.897× |
| Valley Ridge MX control |             0.727 |            0.713 |             −2.05% |                1.021× |
| Kestrel RX control      |             3.674 |            3.623 |             −1.40% |                1.014× |
| Pinewood Stage control  |             1.231 |            1.221 |             −0.87% |                1.009× |

The controls retain identical candidate/cache behavior. Their small apparent
gains are not accepted as established improvements. Ratios of independent
medians and medians of per-pair ratios are different statistics: for example,
Poggio Alto's independent-median time ratio is **1.1144**, while its median
per-pair current/original ratio is **1.0316**, with a pair range of
**0.8099–1.2580**. The JSON preserves the inputs needed to examine that variation.

## Integrated construction medians

These are milliseconds per complete Track construction after module/JIT
warmups, with eight Tracks retained until each sample's observation. They
include all constructor changes, including the separate surface precomputation
and storage; they do not isolate the empty lane-index object's cost.

| Fixture      | Original ms/Track | Current ms/Track | Median time change |
| ------------ | ----------------: | ---------------: | -----------------: |
| Aurel        |             3.779 |            4.078 |             +7.92% |
| Vellamar     |             3.279 |            3.270 |             −0.28% |
| Speedbowl    |             3.458 |            3.265 |             −5.57% |
| Figure-eight |             3.031 |            3.070 |             +1.27% |

The measurements do not establish a consistent construction speedup. For
example, Speedbowl's independent medians favor current, but current is slower
in five of nine matched pairs. All initial geometry and observed surface state
still match exactly. No cold-process startup or heap measurement was performed.

## Workload boundaries

All cases instantiate each root's actual `Track` with its actual unchanged
circuit definition. The four paved fixtures are Aurel, Vellamar, Speedbowl, and
the existing figure-eight overpass test venue. Controls use Poggio Alto GP,
Valley Ridge MX, Kestrel RX, and Pinewood Stage. Every Track uses the normal
1,536-segment constructor and clear initial weather.

| Cases                             | Input and cache state                                                                                                                                                                                          | Measured work per sample           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Eight `warm:*` cases              | 256 seeded road/shoulder queries across 64 stations and four lateral offsets. Prime the complete set outside timing. Include matching local heights and declared no-height calls.                              | 256 passes, 65,536 nearest calls   |
| Four `cold-stream:*` paved cases  | Start with the actual empty cache. Visit 4,096 distinct 4 m cells inside the actual coarse hash. Revisit in the same order, exceeding the 2,048-cell cap so every call remains a cache miss. No height filter. | Eight passes, 32,768 nearest calls |
| `outside-hash:aurel`              | 128 seeded remote positions outside the coarse hash. This exercises the original full-segment scan.                                                                                                            | Eight passes, 1,024 nearest calls  |
| `unproved-height:figure-eight`    | Prime 256 in-hash positions whose 10,000 m query height cannot prove a local road layer. The original coarse candidates must be retained.                                                                      | 128 passes, 32,768 nearest calls   |
| Four `construction:*` paved cases | Warm module/JIT execution, actual full Track initialization, eight retained instances. Compare ribbon geometry and initial public surface state afterward.                                                     | Eight complete constructions       |

Measurement mode declares three warmup pairs followed by nine sample pairs per
case. Each phase alternates AB and BA execution. All raw pairs, seeds, orders,
elapsed durations, per-unit durations, and equality evidence remain in the JSON;
no samples are dropped. Counts remained as prepared. Median sample durations
ranged from **23.01 to 240.81 ms**; some faster and construction cases therefore
ran below the initial 50 ms planning target. The largest retained individual
sample was **399.01 ms** in the current RX control. The repeated-query and
cold-stream directions hold in every measured pair for the changed paved
venues; overlapping smaller control/construction differences are treated
cautiously. Smoke mode uses one pass or construction, one pair, no warmup, and
does not start the workload timer.

## Exact comparison and timing isolation

Each pair derives one seed and supplies independent identical PRNG streams to
the two actual implementations. Query buffers must have identical bytes. Every
nearest call copies its returned lateral and all twelve `TrackPoint` numbers
into a preallocated Float64 output buffer: `s`, `x`, `y`, `z`, `tx`, `tz`, `nx`,
`nz`, `curvature`, `width`, `bank`, and `gradient`. Every number is checked with
`Object.is`, including signed zero; any nonfinite output fails equivalence.
Checksums supplement those comparisons. Raw output arrays are not persisted.

The timed query callback includes the actual nearest operation and the same
output-copy work on both sides. Fixture construction, seeded query generation,
buffer allocation, declared priming, hashing, comparisons, and JSON I/O are
outside that interval. Allocations performed by the production lane index,
including candidate arrays, Map insertion/eviction, and ordinary VM collection,
remain inside. Timed objects have no instrumentation installed.

Separate untimed Tracks instrument the real instance candidate method to count
candidate scans, hits, builds, conservative layer fallback, and resident cache
entries. The instance wrapper is removed afterward. These structural probes
use a separately recorded deterministic query set; their counts do not pretend
to be instrumentation of every timed pair. They explicitly assert warm reuse,
all-miss cold streams, unchanged control structure, and expected fallback paths.

Construction cases compare all ribbon point numbers, twelve public scalars,
and the initial water, rubber, marbles, frozen, temperature, substrate
temperature, drainage, and sheltered arrays. They measure integrated repeated
Track construction, including the separate surface coefficient changes. They
cannot isolate lane-index constructor cost or cold-process startup. Retaining
each sample's objects until observation prevents discarded-construction work.

## Source provenance and reproducibility

Both runs loaded original commit
`350119e8ec0606e8c5de5b3ab80df41104025679` from
`/dev/shm/aeebac160835-engine-baseline`. The smoke used candidate commit
`9922926e786c35e84810efc8b15e75bcfaba5372`, and the timed run used
`aaaf5001a9e13e3e6839fc7ecada7b542a4005bc`, from
`/tmp/aeebac160835-engine/Experiment-3`. The Track implementation hash remained
identical between those candidate checkpoints. The actual native `.ts` imports execute
the source at each root. They do not execute reconstructed baseline functions.

The harness records the complete static graph, extra test-venue input, source
file bytes and SHA-256 values, package/lock/tsconfig identities, relevant clean
Git state, dependency resolution root, build diagnostics, Node/V8/CPU metadata,
and benchmark/helper hashes. The 64-file current manifest includes the actual
Track graph and declared metadata. `test-venues.ts` is an explicit hashed extra
input and imports only the already recorded circuits module. The circuits,
test-venue, and lane-index implementations must have matching baseline/current
hashes. Only the actual integration selecting the index differs for these
queries.

Both runs used Node **v24.22.3** and V8 **13.6.233.17-node.63** on Linux x64,
with the recorded **AMD EPYC 9V74** CPU model. Both lockfiles have SHA-256
`610c1768c440c202a4e37f62d22467d4cbbddc44a5962e82bb256dcfb8627edf`.
Current `track.ts` has SHA-256
`11c4f225e953670d86a75660a128a944a38c4105ccf08e00e52b2d0ed6453bc5`.
Source, HEAD, relevant status, and benchmark hashes are checked across the run;
drift aborts it. Repeated source/runtime manifests are retained once and every
case references that shared manifest. The smoke JSON is approximately 142 kB;
the canonical timed evidence is **763,808 bytes**. All timed cases report stable
sources, successful equivalence, and valid local comparison scope. The timed
run's current source graph was clean even though unrelated notes and native
fixtures were being edited under the coordinator's read/edit-only reservation.

All three source/output paths are required and absolute. Output creation uses
exclusive creation and refuses to overwrite an existing report. `--cases`
accepts an explicit comma-separated subset without changing any case's seed.

Completed smoke command:

```sh
node --no-warnings --experimental-transform-types \
  scripts/engine-advancement/measure-lanes.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --output /tmp/aeebac160835-engine/Experiment-3/docs/engine/advancement-2026-11-25/evidence/lane-measurement-smoke.json
```

Completed reserved measurement command:

```sh
node --no-warnings --experimental-transform-types \
  scripts/engine-advancement/measure-lanes.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --output /tmp/aeebac160835-engine/Experiment-3/docs/engine/advancement-2026-11-25/evidence/lane-measurement.json \
  --measure --exclusive --lock /tmp/aeebac160835-engine-wave7.lock
```

The lock is cooperative. The coordinator must also reserve compute; the flag
alone does not establish exclusivity. No browser, full build, npm lifecycle
hook, dependency installation, or Git mutation is part of this script.

## Completed preflight observations

All **18 paired cases** passed, with **420,832 exact numeric comparisons**, zero
differences, matching query bytes, finite outputs, and stable source identity.
Scoped ESLint and Prettier passed for the workload script. These are correctness
and structural results only.

The separate 256-query warm probes produced these actual candidate counts:

| Fixture                 | Original scans | Current scans | Scan reduction | Current resident cells | Current segment slots |
| ----------------------- | -------------: | ------------: | -------------: | ---------------------: | --------------------: |
| Aurel                   |         14,545 |         2,448 |         83.17% |                    225 |                 2,213 |
| Vellamar                |         11,833 |         2,045 |         82.72% |                    220 |                 1,828 |
| Speedbowl               |         10,142 |         2,556 |         74.80% |                    226 |                 1,741 |
| Figure-eight            |         19,566 |         3,268 |         83.30% |                    223 |                 2,769 |
| Poggio Alto GP control  |          1,506 |         1,506 |             0% |                    232 |                 1,389 |
| Valley Ridge MX control |          7,427 |         7,427 |             0% |                    183 |                 5,597 |
| Kestrel RX control      |         59,296 |        59,296 |             0% |                      0 |                     0 |
| Pinewood Stage control  |         16,433 |        16,433 |             0% |                      0 |                     0 |

Each current paved cold probe performed **8,192 builds, zero hits**, and retained
exactly **2,048 cells** after two passes. The outside-hash probe made 128 full
scans, 196,608 candidate checks per side, and no index calls. Every one of the
256 unproved-height calls used the conservative original candidate list.
Controls had identical complete structural observations across both sources.

Candidate-scan reductions do not include candidate-list construction costs and
are not CPU speedup percentages. The new paved index trades lazy cache storage
and miss-building work for smaller repeated scans. The all-miss stream is
deliberately adverse and must be reported even if it regresses. Likewise,
unproved-height queries can pay cache lookup overhead while retaining the
original scan. The measurements above retain both effects and the control costs.

The 2,048-cell limit bounds entries, not a fixed byte count: retained candidate
array lengths vary by geometry. Reported numeric segment slots do not include
V8 Map, string, array, or object overhead. Existing MX/SX indexing keeps its
original unbounded policy; RX and rally stages remain unindexed. The separate
surface changes add 286,720 bytes of typed-array payload per Track, excluding
headers, so any construction result includes that tradeoff. This workload
supports local CPU query/construction conclusions only; it provides no whole
physics-frame, native GPU, heap-profile, or game-FPS result.
