# W07F — actual-baseline combined Simulation measurement

Assignment **42/60**, wave 7, **complete**. The reserved actual-baseline run
preserved every checked state value and frame. Rain and storm have lower paired
times in most samples and in both execution-order groups. Clear weather, the
first-step case and the two controls have more ambiguous results, detailed
below. Production engine code, authored content, models, environments and
tuning remain read-only.

## Deliverables and status

- `scripts/engine-advancement/measure-simulation.mjs` executes the actual
  `Simulation` from each source tree through the shared
  [paired harness](w04f-benchmark-harness.md).
- [simulation-measurement.json](evidence/simulation-measurement.json) is the
  completed reserved run, **463,036 bytes**, including all raw pairs, equality
  checks, manifests and control results.
- [simulation-measurement-preflight.json](evidence/simulation-measurement-preflight.json)
  is the final untimed preflight, **174,493 bytes**. It includes the nonempty
  race-control event audit described below.
- [simulation-measurement-smoke.json](evidence/simulation-measurement-smoke.json)
  retains the earlier successful ordinary-driving preflight, **166,725 bytes**,
  before the event-audit addition. Each report preserves its own workload hash.

Every workload duration and median in the two preflight reports is `null`;
`timing.validForComparison` and `exclusiveCompute` are `false`. Preparation
diagnostics are not physics throughput measurements. An initial preflight
attempt rejected a signed fixture seed before any comparison; the workload now
coerces that XOR-derived seed to uint32. No engine source change was required.

The coordinator reserved local compute and held HEAD at
`6a1c76fae3736e4d814ab6d0a354f6837320731c`. The single measured execution ran
from lock acquisition at **09:00:49.551 UTC** to final report creation at
**09:02:17.055 UTC**, about **87.5 seconds** including setup, audits and reporting.
The lock was removed and compute released at process exit. There was no
calibration run, selective rerun, outlier removal or source change.

## Measured result and interpretation

Times below are **elapsed milliseconds for 480 actual physics steps and 240
complete frame writes**. The interval represents four simulated seconds. It
includes the identical declared command schedule and excludes construction,
priming and observation. These are local synchronous workload durations from
`performance.now`, including any VM or scheduling pauses, not process CPU
profiling, render-frame timing or game FPS.

The independent change is `median(current) / median(original) - 1`. The paired
change is the median of the nine individual paired ratios. Both are shown
because drift and spikes can make them disagree.

| Case                            | Original median ms | Current median ms | Independent change | Median paired change | Current faster pairs |
| ------------------------------- | -----------------: | ----------------: | -----------------: | -------------------: | -------------------: |
| Aurel clear, four cars          |            324.517 |           300.892 |             −7.28% |               −7.28% |                  6/9 |
| Aurel rain, four cars           |            389.822 |           358.152 |             −8.12% |              −11.88% |                  7/9 |
| Aurel storm, four cars          |            359.053 |           315.476 |            −12.14% |              −12.14% |                  8/9 |
| Vellamar first steps, four cars |            470.676 |           456.274 |             −3.06% |               −0.54% |                  5/9 |
| GP clear control, two bikes     |             63.055 |            61.738 |             −2.09% |               +2.17% |                  4/9 |
| MX clear control, two bikes     |             67.671 |            65.504 |             −3.20% |               −2.25% |                  6/9 |

The rain case has lower paired times in seven of nine samples; its two slower
pairs are +0.67% and +1.21%. Median paired changes are −13.29% for AB and −10.89%
for BA. Storm is faster in eight of nine pairs, with corresponding order-group
medians of −13.43% and −10.99%. These results support a local combined-workload
improvement for these two fixtures in this run. They do not isolate how much
comes from lane reuse, surface coefficients or interactions between them.

**Clear weather is less settled than its lower aggregate median suggests.**
Although six pairs are faster, the AB paired median is −7.28% while the BA
paired median is +14.02%. Two BA samples have current-side increases of +40.06%
and +45.90%. The original range is 306.323–389.588 ms and current range is
277.693–490.236 ms. The report retains those samples and does not call the clear
result a repeatable, established gain.

The Vellamar first-step result is mixed and close to unchanged on paired ratios;
its AB and BA medians are −0.58% and +0.56%. GP's paired median is slower despite
its slightly lower independent median, with order-group medians of −5.62% and
+3.67%. MX has lower medians in both orders but mixed pair directions and a
current-side +64.16% spike. **No established performance improvement is claimed
for either control or the first-step workload.** Every case has overlapping
original/current ranges. Native browser, production hardware and broader
workloads would require their own measurements.

All **72 paired warmup/sample observations** passed exact equivalence: 18 warmup
pairs and 54 measured pairs. Including the independent audit, the run compared
**463,357 numeric scalars with `Object.is`**, **44,474,976 typed-array bytes**
(including **361,229 Float64 array elements**), and **81,168,000 packed-frame
bytes** representing **18,000 frames per side**. Those counts include the
documented repeated audit endpoints. The measured output contains every raw
sample and all equality diagnostics; no result is reduced to aggregate hashes.

## Workload and timing boundaries

All scenarios use the actual validated practice-session options, seeded
controls, unchanged vehicle definitions and their real dynamics adapters.

| Case                        | Actual world                                  | Cache and initialization state                                                        |
| --------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `aurel-clear-four`          | Four APX-01 cars, Aurel, clear weather        | Prime 240 real steps before the measured interval.                                    |
| `aurel-rain-four`           | Four APX-01 cars, Aurel, rain                 | The same actual priming interval, including wet surface evolution.                    |
| `aurel-storm-four`          | Four APX-01 cars, Aurel, storm                | The same priming; weather and surface inputs continue evolving.                       |
| `vellamar-first-steps-four` | Four APX-01 cars, Vellamar, clear             | No physics priming. First steps include lazy contact geometry, lane and surface work. |
| `gp-clear-control`          | Two GPR1 motorcycles, Poggio Alto, clear      | Actual GP dynamics and already-existing GP lane indexing; prime 240 steps.            |
| `mx-clear-control`          | Two MX450 motorcycles, Valley Ridge MX, clear | Actual deformable terrain and existing MX indexing; prime 240 steps.                  |

The measured default is **480 physics steps at 1/120 s**, or four simulated
seconds, with one complete packed frame every two steps. Each warm case first
advances its own world through 240 physics steps, or two simulated seconds.
Vehicles continue moving into new spatial cells; priming does not force every
future query to hit a warm cache. The Vellamar case is a fresh Simulation's first
steps in an already-loaded module graph. It is not cold-process startup and
does not isolate any single cache's cost.

The timed callback includes the precomputed input application, actual
`Simulation.step`, actual `writeFrame`, and the same short owner/pit-command
schedule on both sides. The player hands control to autopilot at step 90 and
takes it back at 150. Pit-request API calls occur at 210 and 270. The report
records these attempted API commands and the resulting actual state; it does
not equate a request with a completed pit stop.

Frame writes receive `stepMs = 0` and `dropped = 0` on both actual
implementations. **No frame field is erased or masked after generation.** A
worker's scheduling, drop policy and wall-clock measurement are outside this
Simulation-only workload.

Source preparation, module loading, Simulation construction, priming, input
objects, frame buffers and every frame view are prepared outside the timer.
Reflection, output copying, hashing, equality checks and report writing also
remain outside it. Allocations performed by the actual step/write operations,
and the small identical fixture command log, remain inside. There is no forced
GC. Setup and observation allocations can still affect the VM's later GC;
alternating paired order and raw samples make that limitation inspectable.

Measurement mode uses three warmup pairs and nine sample pairs per case,
alternating AB and BA in each phase. All samples, seeds, orders and declared
counts remain in the report. No outlier removal or selective rerun is built in.
The CLI accepts explicit case, step and pair counts, and records them. A subset
does not change a selected case's base seed. Smoke mode uses one sample pair,
no warmups and 120 steps, and never starts the workload timer.

## Exact state and output oracle

There is no production `captureFlashback` snapshot API to reuse: flashback
reconstructs state through `Resimulation`. This workload therefore observes the
actual Simulation object graph without rewriting source or supplying baseline
equations. It compares:

- Every observed own numeric scalar using `Object.is`, including signed zero
  and deliberate internal nonfinite sentinels.
- Every observed typed array's complete bytes and type, including raw Float64
  tire, suspension, driveline, AI, collision and race bookkeeping arrays.
- Class names, object/array keys, lengths, object aliases and reference order.
- Map and Set insertion order, actual callback source identities, strings and
  booleans.
- The full observed car, rigid-body, AI, race, collision, recovery and off-road
  graph, including the complete terrain depth/compaction arrays and deformation
  sequence.
- Every generated packed frame, all input-command digests, actual race order,
  race-control events and off-road event order.

Checksums supplement direct comparisons. Unequal scalars, array bytes, shapes
or packed-frame bytes fail acceptance with a first-mismatch diagnostic; an
aggregate hash alone is not the oracle. Packed frames, physical body state,
car speed/location/powertrain scalars and public surface grids must be finite.
Identical intentional internal sentinels, such as an unused initial aero `NaN`
or an AI's not-yet-updated `-Infinity`, remain represented and counted.

The Track projection explicitly omits `circuit`, `points`, `hash`,
`stationIntervals`, `gpEdges`, `laneIndex`, `pit` and `contactMesh`. These are
authored geometry or acceleration/cache structures, including the intentionally
changed lane-index contents. Their complete actual source inputs are hashed;
the [lane proof](w07a-lane-measurement.md) independently compares actual query
results. Every other enumerable own Track field remains in the observation,
including query scratch, weather, surface grids and the surface clock.

**ECMAScript private `#fields` and callback closure captures are not reflected.**
In particular, this is not direct access to the private Track heat accumulator,
cell-area array or thermal caches. The workload compares continued actual
physics and the public surface outputs. The separate
[surface proof](w07b-surface-measurement.md) observes the raw Float64 heat input
consumed by the actual thermal solver and its output at the call boundary. This
combined workload does not extend that evidence into a claim that every hidden
field was inspected.

## Nonempty race-control audit

Each of the six scenarios has an independent untimed 240-step audit. It compares
raw state before continuation and after 60, 120 and 240 steps. After 60 steps,
the fixture reports one incident through the actual public
`MarshalControl.report` API. After 120, it applies a one-second penalty through
the actual `RaceDirector.penalize` API. Both worlds then continue their real
physics and race updates.

These controlled reports establish nonempty ordered event, flag and penalty
comparisons. They are **fixture-issued reports**, not claims that a natural
collision occurred. The ordinary timed workloads do not inject them, so
artificial yellow flags do not alter the measured normal-driving cases.

The final preflight observed the incident, actual subsequent `LOCAL YELLOW`
events, and penalty in the same sequence on both implementations. Four-car
audits had five retained events each; the two-motorcycle audits had three each.
The MX audit ended at deformation sequence **13,864**, with its complete terrain
arrays included in the exact comparison.

## Completed correctness preflight

The final preflight passed:

- **Six scenarios and 24 raw-state audit boundaries**, plus six complete audit
  endpoints and six paired ordinary-driving smoke endpoints.
- **158,119 numeric scalar comparisons using `Object.is`.**
- **15,695,940 typed-array bytes**, including **127,358 Float64 array elements**,
  compared exactly across those observations.
- **4,870,080 packed-frame bytes**, representing **1,080 frames per side**.
- Zero unequal scalars, array bytes, object shapes or packed-frame bytes;
  stable source and benchmark identities throughout.

The raw counts include the explicitly repeated audit endpoint comparison; they
are comparison counts, not a count of unique engine state fields. All vehicles
move. For example, the ordinary one-second smoke endpoints move the clear Aurel
cars roughly 19–23 metres and the wet Aurel cars roughly 8 metres after priming;
the first-step Vellamar cars move roughly 3–5 metres. These are fixture movement
checks, not performance results or claims about a complete lap.

The earlier ordinary-driving smoke also passed all six cases. The later report
adds nonempty race-event coverage and hashes the updated workload. Scoped
ESLint and Prettier pass. No compiler, browser, full build, npm lifecycle hook,
dependency installation or Git mutation was part of this assignment.

## Source identity and reproduction

Both the final preflight and reserved measurement execute the actual original source at
`350119e8ec0606e8c5de5b3ab80df41104025679` and candidate source at
`6a1c76fae3736e4d814ab6d0a354f6837320731c`. Both manifests contain **130
source/configuration files**. Supplemental config/protocol imports are asserted
to belong to the already-recorded actual Simulation graph. The world, config,
protocol, vehicle and race implementation hashes must match between the trees;
this workload concerns integrated execution of the changed Track/surface work,
not changed authored dynamics.

Both lockfiles have SHA-256
`610c1768c440c202a4e37f62d22467d4cbbddc44a5962e82bb256dcfb8627edf`.
The shared world implementation has SHA-256
`bfc08c1d8e3237ccf7a4e69eb1234022316eea3540b9e58252eb0d863ca8f6f1`.
Both runs used Node **v24.22.3**, V8 **13.6.233.17-node.63**, and the recorded
AMD EPYC 9V74 CPU model. These identities do not certify browser or physical
hardware performance.

Completed final preflight:

```sh
node --max-old-space-size=768 --no-warnings --experimental-transform-types \
  scripts/engine-advancement/measure-simulation.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --output /tmp/aeebac160835-engine/Experiment-3/docs/engine/advancement-2026-11-25/evidence/simulation-measurement-preflight.json
```

Completed reserved command:

```sh
node --max-old-space-size=768 --no-warnings --experimental-transform-types \
  scripts/engine-advancement/measure-simulation.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --output /tmp/aeebac160835-engine/Experiment-3/docs/engine/advancement-2026-11-25/evidence/simulation-measurement.json \
  --mode measure --exclusive \
  --lock /tmp/aeebac160835-engine-wave7.lock
```

Every output path must be explicit and new; the script refuses overwrite. The
lock is cooperative and requires the coordinator's real local-compute
reservation. Candidate source, HEAD, relevant Git status and workload/helper
hashes must stay stable. No whole-game FPS, native GPU, worker scheduling,
retained-heap or long-session result follows from this workload.
