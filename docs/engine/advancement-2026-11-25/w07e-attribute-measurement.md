# W07E — attribute range CPU and transfer measurement

Assignment 41/60, wave 7. **Completed: the first reserved measurement passed
all 624 paired equivalence checks across 52 workloads.** The results show
substantial transfer savings for repeated or overlapping dirty regions and
material CPU penalties for disjoint regions. Both findings are retained below.
This assignment changes only its workload, evidence, and this report. Original
and current production helpers are loaded from their actual trees; no
production optimization was added during this assignment.

## Workload and separate CPU scopes

`scripts/engine-advancement/measure-attributes.mjs` prepares 26 cases. Each case
has an independent untimed transfer/version/bounds audit and two paired CPU
workloads:

1. **Helper scope:** clear pending ranges, then dispatch actual `markItems` and
   `markAll`. The public-range case also performs three public API writes.
2. **Mark and recording-upload scope:** dispatch the same marks, then execute
   the installed Three `WebGLAttributes.update`, including its merge, version,
   and clearing logic and a JavaScript copy at the recording GL boundary.

Both scopes exclude fixture allocation, source loading, CPU producer writes,
hashes, readback, assertions, and transfer/object counters. They include the
production allocations made by the operations themselves. The helper scope
also includes pending-list clearing and both scopes include loop/dispatch
costs. Recording-driver copies are **CPU work, not GPU time**.

The cases cover 17 and 1,000 duplicates; contained, adjacent and overlapping
marks; a seventeenth mark bridging a full 16-entry budget; every genuinely
disjoint count from 1 through 16; 17-disjoint fallback; full then partial marks;
unsorted public ranges followed by an enclosing helper mark; and an empty
mark. Every audit checks unchanged-version suppression, post-upload clearing,
narrow reuse, exact versions, component bounds, byte equality and guards around
a Float32 view starting 20 bytes into its allocation.

Pending entry object identities are counted in an **untimed** audit after each
real call. This is a count of observable pending-entry objects, not allocated
bytes, total allocations, GC, or retained heap. Splice result arrays and VM
sort/iterator allocations are not measured.

## Source identity and producer evidence

The original source is pinned to
`350119e8ec0606e8c5de5b3ab80df41104025679`. The script uses the existing
benchmark harness for actual module loading, exact static input hashes,
matching locked dependencies, raw AB/BA ordering, and source/workload stability
checks. The actual installed `BufferAttribute.js` and `WebGLAttributes.js`
graphs are separate explicit manifests; both helpers receive the same class
and uploader. The actual FestivalTrails graphs record the producer's package
Three implementation as well.

A bounded, untimed producer audit runs both original and current
`FestivalTrails` over identical 182 snapshots. It publishes at update indices
40, 180, and 181, comparing all three uploaded attribute buffers and exact
versions at each boundary. This exercises deferred contiguous writes, ring
wrap, and subsequent narrow publication. It is a controlled publication
workload, not a claim that Festival poses while its presentation is GPU-gated.

## Running and remaining validation

All three paths are explicit, and existing output files are refused. The
default is an untimed smoke; every workload duration is null. Preparation
diagnostics reported by the shared harness are not performance measurements.

```sh
node --no-warnings --experimental-transform-types \
  scripts/engine-advancement/measure-attributes.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --output /absolute/new/attribute-measurement-preflight.json
```

Only after the coordinator grants exclusive local compute, add `--measure`,
`--exclusive`, `--expected-current FULL_COMMIT`, and the shared
`--lock /tmp/aeebac160835-engine-wave7.lock`. The default measurement aims for
250,000 helper invocations per side/sample/case, using three warmup pairs and
nine sample pairs. `--target-marks` explicitly changes that target. Absolute
nanoseconds per helper invocation and per batch, relative costs, paired
ratios, all raw samples, and every observed CPU regression are retained.

The earlier W03C disjoint result was concurrent exploratory work and is not an
accepted baseline. Transfer savings must be reported alongside any increased
helper or complete recording-upload CPU cost. No FPS, native GPU latency,
physical-device, energy, or retained-heap improvement is implied.

The coordinator reports that the native upload case passed at commit
`9922926e786c35e84810efc8b15e75bcfaba5372`; the unrelated shared-fence pixel
comparison has its own diagnostic follow-up. Neither result is substituted for
this workload's separate byte audits or CPU measurements.

## Executed preflight

The coordinator released its compute window before this preflight ran. The
script loaded original commit `350119e8ec0606e8c5de5b3ab80df41104025679` and
current commit `6a1c76fae3736e4d814ab6d0a354f6837320731c`, with clean relevant
inputs and stable source identities throughout. The report is
`evidence/attribute-measurement-preflight-6a1c76fa.json` (821,806 bytes, no raw
buffers). It retains the explicit BufferAttribute graph (10 manifest inputs)
and WebGLAttributes graph (4), including project configuration files.

**All 26 case audits and all 104 paired comparisons passed**, across 52
workloads. Each workload ran two smoke pairs in AB then BA order, with two
batches per side. All workload durations and CPU comparison fields are null;
every `timing.validForComparison` and `concurrency.exclusiveCompute` is false.
Every pair compares complete 49,152-byte buffers with `Buffer.equals`, exact
version counts, expected dirty bounds, and intact view guards. It does not
substitute hash equality for byte comparison.

The untimed actual-uploader results are:

| Mark workload                                     | Original upload bytes | Current upload bytes | Original → current new pending objects |
| ------------------------------------------------- | --------------------: | -------------------: | -------------------------------------: |
| 17 duplicates                                     |                49,152 |                   48 |                                 17 → 1 |
| 1,000 duplicates                                  |                49,152 |                   48 |                              1,000 → 1 |
| 25 contained marks                                |                49,152 |                  144 |                                 25 → 1 |
| 17 adjacent marks                                 |                49,152 |                  816 |                                 17 → 1 |
| 17 overlapping marks                              |                49,152 |                   84 |                                 17 → 1 |
| Bridge after 16 disjoint entries                  |                49,152 |                  732 |                                17 → 16 |
| Each disjoint count 1–16                          |            12 × count |           12 × count |                          count → count |
| 17 disjoint marks                                 |                49,152 |               49,152 |                                17 → 17 |
| Full then 16 partial marks                        |                49,152 |               49,152 |                                 17 → 1 |
| Three unsorted public ranges, then enclosing mark |                 2,436 |                2,436 |                                  4 → 3 |
| Empty mark                                        |                     0 |                    0 |                                  0 → 0 |

The disjoint 1–16 cases retain exactly one upload per disjoint span on both
sides. Other nonempty table rows issue one upload on both sides. The public
range row includes three caller-created objects in both object totals. These
object witnesses exclude temporary arrays returned by `splice`; unchanged
object counts in disjoint cases do **not** establish unchanged allocation cost.

All 26 cases also passed the subsequent empty-mark and unchanged-version
checks with zero additional uploads. After clearing, two adjacent item marks
produced exactly 24 bytes at destination offset 840, with exact CPU and
recorded-buffer bytes and two version increments. Source offset 20 and all
guards were preserved.

The actual producer evidence passed all three publication checkpoints:

| Snapshots processed | Segments | Version of each attribute | Original bytes | Current bytes |
| ------------------: | -------: | ------------------------: | -------------: | ------------: |
|                  41 |      320 |                        40 |         81,920 |        25,600 |
|                 181 |    1,024 |                       181 |         81,920 |        81,920 |
|                 182 |    1,024 |                       182 |            640 |           640 |

Every checkpoint issued three transfers on each side and compared all three
buffers exactly. Draw ranges and versions matched. Birth times proved ring
slots were overwritten by the second checkpoint, and the third returned to
narrow publication. The first checkpoint's 56,320-byte reduction is an upload
argument-volume result only; neither producer CPU time nor GPU time was timed.

Executed commands, without npm lifecycle hooks:

```sh
node --max-old-space-size=512 --no-warnings --experimental-transform-types \
  scripts/engine-advancement/measure-attributes.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --output /tmp/aeebac160835-engine/Experiment-3/docs/engine/advancement-2026-11-25/evidence/attribute-measurement-preflight-6a1c76fa.json

node --max-old-space-size=384 node_modules/eslint/bin/eslint.js \
  scripts/engine-advancement/measure-attributes.mjs
```

The script and report were formatted with the installed Prettier. No broad
compiler/build, browser, Git mutation, production source, authored asset,
model, character, environment, dependency, or tuning edit was performed.

## Executed reserved measurement

After explicit coordinator authorization, the first canonical measurement ran
against the same original and current commits as the preflight. Other active
agents had acknowledged a read/edit/research-only window and no local commands
were running for those agents. The root also held source and Git changes. The
script held the shared lock, checked every source graph and workload identity,
and released the lock on successful exit. **COMPUTE RELEASED** was reported to
the coordinator immediately afterward. No calibration, rerun, source patch,
forced GC, or outlier removal occurred.

The immutable first report is
[`evidence/attribute-measurement.json`](evidence/attribute-measurement.json)
(1,654,036 bytes). It retains all 156 warmup pairs and 468 sample pairs, for
**624 checked pairs**, with three warmup and nine sample pairs per workload.
All 52 workloads have `timing.validForComparison: true`; all byte, version,
dirty-bound, guard and final source checks passed. The declared loops execute
**312,002,832 actual helper invocations** across both sides and both scopes.
The public-range fixture additionally executes its three public API writes
per batch. Source preparation, audits, and the final identity checks remain
outside workload intervals.

The recorded environment is Node **v24.22.3**, Linux x64, with CPU string
**AMD EPYC 9V74 80-Core Processor** and **9 logical CPUs visible**. The interval
from lock acquisition to the report creation timestamp is **46.682 seconds**,
including unmeasured setup and audits. That interval is not an engine timing.
The cooperative reservation excludes known collaborating workload commands;
it cannot establish that a shared host had no unrelated activity.

The exact measurement command was:

```sh
node --max-old-space-size=512 --no-warnings --experimental-transform-types \
  scripts/engine-advancement/measure-attributes.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --output /tmp/aeebac160835-engine/Experiment-3/docs/engine/advancement-2026-11-25/evidence/attribute-measurement.json \
  --measure --exclusive \
  --expected-current 6a1c76fae3736e4d814ab6d0a354f6837320731c \
  --lock /tmp/aeebac160835-engine-wave7.lock
```

### Full helper CPU results

Values below are sample medians in **nanoseconds per helper invocation**.
Delta is current minus original. The paired ratio is the median of the nine
matched current/original duration ratios, so it need not equal the ratio of
the two displayed medians. `Slower pairs` counts sample pairs whose current
side took longer. The public-range row includes three public writes plus one
helper invocation; its unit is also one complete batch. Empty-mark costs
include loop/dispatch and pending-list reset.

| Case                           | Original ns | Current ns | Delta ns | Median paired ratio | Slower pairs |
| ------------------------------ | ----------: | ---------: | -------: | ------------------: | -----------: |
| duplicate-17                   |       25.69 |      15.70 |    -9.99 |              0.638× |          1/9 |
| duplicate-1000                 |       24.02 |      11.51 |   -12.51 |              0.481× |          0/9 |
| contained-25                   |       23.55 |      14.92 |    -8.63 |              0.610× |          0/9 |
| adjacent-17                    |       24.82 |      36.97 |   +12.15 |              1.509× |          9/9 |
| overlap-17                     |       25.76 |      20.01 |    -5.75 |              0.778× |          0/9 |
| bridge-at-16                   |       24.72 |     206.01 |  +181.30 |              8.330× |          9/9 |
| disjoint-1                     |       68.73 |      90.87 |   +22.15 |              1.301× |          8/9 |
| disjoint-2                     |       42.74 |      63.96 |   +21.22 |              1.484× |          9/9 |
| disjoint-3                     |       35.74 |      90.20 |   +54.47 |              2.635× |          9/9 |
| disjoint-4                     |       31.91 |     110.67 |   +78.76 |              3.469× |          9/9 |
| disjoint-5                     |       28.87 |     124.04 |   +95.17 |              4.366× |          9/9 |
| disjoint-6                     |       27.12 |     128.49 |  +101.37 |              4.705× |          9/9 |
| disjoint-7                     |       26.06 |     137.47 |  +111.42 |              5.361× |          9/9 |
| disjoint-8                     |       26.04 |     155.94 |  +129.89 |              6.034× |          9/9 |
| disjoint-9                     |       26.68 |     154.58 |  +127.91 |              5.771× |          9/9 |
| disjoint-10                    |       23.99 |     159.51 |  +135.52 |              6.689× |          9/9 |
| disjoint-11                    |       25.57 |     175.44 |  +149.87 |              7.123× |          9/9 |
| disjoint-12                    |       23.75 |     179.03 |  +155.28 |              7.597× |          9/9 |
| disjoint-13                    |       24.11 |     186.35 |  +162.25 |              7.558× |          9/9 |
| disjoint-14                    |       23.00 |     184.91 |  +161.91 |              8.001× |          9/9 |
| disjoint-15                    |       22.53 |     189.58 |  +167.04 |              8.398× |          9/9 |
| disjoint-16                    |       22.26 |     193.07 |  +170.82 |              8.643× |          9/9 |
| disjoint-17                    |       26.80 |     207.63 |  +180.83 |              8.204× |          9/9 |
| full-then-partials             |       26.31 |      15.92 |   -10.39 |              0.609× |          0/9 |
| public-unsorted-then-enclosing |      106.98 |     405.59 |  +298.61 |              3.811× |          9/9 |
| empty-mark                     |       41.92 |      42.21 |    +0.28 |              1.026× |          5/9 |

The current helper has a higher median in **21 of 26 cases**. The small empty
mark difference, **+0.285 ns** with only five of nine slower pairs, is retained
but does not establish a meaningful regression. All disjoint counts from 2
through 17 were slower in all nine matched helper pairs. Disjoint-1 was slower
in eight, with one large original-side stall retained.

### Full mark and recording-upload CPU results

The denominator and paired-ratio definitions are the same. Each batch includes
all helper calls followed by actual Three upload processing and the recording
boundary copy. These results overlap the helper work; **do not sum the scopes
or subtract their medians to infer driver/GPU cost**.

| Case                           | Original ns | Current ns | Delta ns | Median paired ratio | Slower pairs |
| ------------------------------ | ----------: | ---------: | -------: | ------------------: | -----------: |
| duplicate-17                   |       95.01 |      23.99 |   -71.02 |              0.247× |          0/9 |
| duplicate-1000                 |       24.48 |      11.69 |   -12.79 |              0.476× |          0/9 |
| contained-25                   |       78.09 |      19.50 |   -58.59 |              0.250× |          0/9 |
| adjacent-17                    |      103.92 |      48.49 |   -55.43 |              0.477× |          0/9 |
| overlap-17                     |       95.12 |      29.56 |   -65.56 |              0.312× |          0/9 |
| bridge-at-16                   |       97.90 |     227.00 |  +129.10 |              2.315× |          8/9 |
| disjoint-1                     |      195.10 |     227.93 |   +32.83 |              1.173× |          9/9 |
| disjoint-2                     |      180.53 |     231.84 |   +51.31 |              1.293× |          9/9 |
| disjoint-3                     |      154.89 |     243.27 |   +88.39 |              1.575× |          8/9 |
| disjoint-4                     |      134.63 |     245.51 |  +110.89 |              1.824× |          9/9 |
| disjoint-5                     |      130.51 |     252.25 |  +121.74 |              1.992× |          9/9 |
| disjoint-6                     |      118.67 |     264.76 |  +146.09 |              2.176× |          8/9 |
| disjoint-7                     |      108.03 |     233.68 |  +125.65 |              2.163× |          9/9 |
| disjoint-8                     |      109.51 |     247.60 |  +138.09 |              2.261× |          9/9 |
| disjoint-9                     |      108.38 |     255.18 |  +146.80 |              2.308× |          9/9 |
| disjoint-10                    |       97.86 |     251.98 |  +154.12 |              2.557× |          9/9 |
| disjoint-11                    |      102.53 |     264.17 |  +161.64 |              2.629× |          9/9 |
| disjoint-12                    |       97.19 |     263.82 |  +166.62 |              2.686× |          9/9 |
| disjoint-13                    |       97.36 |     275.12 |  +177.76 |              2.769× |          9/9 |
| disjoint-14                    |       97.97 |     286.49 |  +188.52 |              2.990× |          9/9 |
| disjoint-15                    |       92.27 |     280.42 |  +188.15 |              2.979× |          8/9 |
| disjoint-16                    |       98.90 |     296.53 |  +197.63 |              2.936× |          9/9 |
| disjoint-17                    |       95.93 |     293.62 |  +197.70 |              3.064× |          9/9 |
| full-then-partials             |       98.93 |      87.37 |   -11.56 |              0.874× |          1/9 |
| public-unsorted-then-enclosing |      448.69 |     691.49 |  +242.81 |              1.494× |          9/9 |
| empty-mark                     |       21.33 |      20.65 |    -0.68 |              0.980× |          3/9 |

The current path has a higher median in **19 of 26 cases**. Every disjoint
count from 1 through 17 has a higher median in both scopes, despite unchanged
transfer bytes and upload-call counts. The enclosing-public-range and
bridge-at-16 cases also regress in both scopes. The empty-mark difference in
this scope is small and mixed across pairs; it is not a useful performance
claim.

### CPU, transfer, and allocation tradeoffs

For **16 disjoint marks**, helper median cost rises from **22.26 to 193.07
ns/mark**, with a median paired ratio of **8.643×**. The absolute 16-mark batch
cost is **0.356 to 3.089 microseconds**, an increase of **2.733 microseconds**.
The complete recording-upload scope rises from **98.90 to 296.53 ns/mark**,
paired **2.936×**; its batch cost rises **1.582 to 4.744 microseconds**, an
increase of **3.162 microseconds**. Both versions still issue 16 transfers
and copy 192 bytes, with 16 observable new pending entries. These CPU penalties
receive no offsetting byte or pending-entry-count benefit in this case.

For **17 disjoint marks**, both versions take the same full-buffer fallback:
49,152 bytes, one upload, and 17 observed new pending entries. Helper median
cost rises **26.80 to 207.63 ns/mark** (paired **8.204×**) and complete
recording-upload cost rises **95.93 to 293.62 ns/mark** (paired **3.064×**).
The complete 17-mark batch costs **1.631 to 4.992 microseconds**.

For **17 adjacent marks**, helper CPU rises **24.82 to 36.97 ns/mark** (paired
**1.509×**) while complete recording-upload CPU falls **103.92 to 48.49
ns/mark** (paired **0.477×**). Transfer volume falls **49,152 to 816 bytes**,
and observed pending entries fall **17 to 1**. This case demonstrates why
helper and complete recording-upload costs must be reported separately.

For a **bridge after 16 disjoint entries**, transfer volume falls **49,152 to
732 bytes** and observed entries fall **17 to 16**, but helper CPU still rises
**24.72 to 206.01 ns/mark** (paired **8.330×**). Complete recording-upload CPU
rises **97.90 to 227.00 ns/mark** (paired **2.315×**), or **1.664 to 3.859
microseconds per 17-mark batch**. Lower transfer volume does not by itself
prove a CPU improvement.

For **17 duplicate marks**, both scopes improve at their medians: helper
**25.69 to 15.70 ns/mark** and complete recording-upload **95.01 to 23.99
ns/mark**, with paired ratios **0.638×** and **0.247×** respectively. Transfer
volume falls **49,152 to 48 bytes**, and observed entries fall **17 to 1**.
The 1,000-duplicate, contained, overlapping, and full-then-partial cases also
improve at their median in both scopes, as the complete tables show.

Inspection of the actual helper explains a plausible tradeoff: the current
path normalizes and scans pending spans on each disjoint insertion, whereas
the original primarily appends and defers merging to Three. The current path
also calls `splice`, whose temporary result allocations are not counted by
pending-object identity witnesses. This is a source-based explanation, not an
instrumented attribution of nanoseconds or allocated bytes. No external
ownership cache or speculative production optimization was introduced.

### Variation and boundaries of the conclusions

All raw samples remain present, including unusually long individual samples.
For example, original helper/disjoint-1 durations range **15.60–113.28 ms**,
and current complete/disjoint-16 durations range **71.01–236.82 ms**. The latter
still has all nine paired ratios above one, ranging **2.825–9.028×**, with the
reported median **2.936×**. No cause is assigned to these stalls, and no tail
was discarded or rerun. Single-digit nanosecond differences and mixed paired
outcomes are not treated as statistically established wins or losses.

These are specific warmed Node CPU workloads with explicit dispatch/reset and
JavaScript recording-copy costs. The transfer and producer results establish
exact argument volume and bytes, not native upload latency. The real producer
was exercised untimed. No result establishes physical-GPU behavior, an FPS
change, frame-time impact in the running game, energy use, or retained-heap
savings. Native upload correctness and the shared-fence pixel acceptance remain
separate CI evidence. The complete raw report and all CPU regressions are
available for the coordinator's production acceptance decision.
