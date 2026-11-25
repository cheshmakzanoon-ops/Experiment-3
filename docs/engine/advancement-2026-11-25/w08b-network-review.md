# W08B — network review and snapshot crossover

Assignment 44/60, wave 8. Independent review of W02B, W02F, W04C, W05B,
W06A and W07C, their production diffs, and their regression/composition
coverage. The original baseline is
`350119e8ec0606e8c5de5b3ab80df41104025679`; the frozen review and crossover
candidate is `6cb1c881d19d190f5dbc68adeb9bf8b6c600da1b`.

## Current disposition

**The crossover measurement, approved policy repair and focused verification
are complete.** W07 demonstrated that
preparing shared car bytes at every multi-recipient boundary penalizes small
groups. The reviewed source selected preparation at `recipients.length > 1`.
A new, separately named workload compares the two actual current codecs
directly. The coordinator approved the conservative threshold: production now
prepares shared car bytes at 12 selected recipients and uses ordinary encoding
below that threshold. Original W07 scripts, crossover scripts and their
measurement reports remain unchanged.

## Independent correctness review

### Presentation clock and authority

`RaceClient.view()` applies the new `PresentationClock` only to remote-car
presentation. `targetTick()` continues to use the raw `ServerClock` arrival
estimate plus command lead. Snapshot ACKs, prediction reconciliation,
command issue/resend selection and clock observations remain on their
authoritative paths. No presentation result feeds back into input scheduling.

For a finite target and nonnegative local elapsed time `e`, the implementation
advances by `e + clamp(target - predicted, -0.25e, 0.25e)`. Its advance therefore
lies in `[0.75e, 1.25e]`. Repeated reads at one time spend no correction budget;
backward local reads cannot move the stored local anchor backward. An initial
unsynchronized `-Infinity` target does not initialize presentation state.
The accepted-grid handler resets presentation after cancelling old race
timers, and incompatible grids leave the connection before installing new
timers. This is a presentation correction within the existing client lifecycle,
not a new ability to restart a completed client on an unrelated lower server
tick. No new defect was identified in this path.

Existing W02B drift/lifecycle tests, the 1,228-packet clock parity check and
W05B's seven connection generations directly cover the relevant authority,
reset and playback invariants. Repeating those tests with new names would
add little evidence, so this review adds no duplicate clock test.

### Input lengths and transfer accounting

The input packet capacity is exactly 10 bytes for no commands, and
`18 + 9 × commandCount` otherwise: eight control bytes plus one duration byte
per command. `writeInputPacket()` still performs the protocol-count, sequence,
tick and contiguous-run checks. At the supported maximum of 16 commands the
owned output is 162 bytes. `ByteWriter.finish()` still copies the used range,
so elimination of writer growth does not imply a zero-allocation encoder.
W04C's 544 complete actual-baseline comparisons and explicit growth probes
cover the change more precisely than a timing assertion would.

`sendInputs()` now reads packet length before the transport can detach its
buffer. Counters are updated only after a successful return from `send()`;
the original thrown error still escapes if transfer succeeds but the
transport subsequently throws. This agrees with the existing success-based
accounting contract. W06A checks real transferable ownership and both throw
positions, with native browser evidence owned by the coordinator. No additional
source change is justified by this review.

### Server capture, reentry and connection churn

Recipient identities, shared world capture and every recipient's own packet
are established before external transport callbacks run. Each ordinary
packet restores its temporary FULL flag in `finally`; each prepared packet
copies the selected FULL car and all compact peers into its own final buffer.
Prepared storage is local to the capture call and is not retained in queued
batches. Preparation changes neither snapshot headers nor the ownership of
queued packets.

Slack, missing-input counters, pending events and contacts are consumed before
dispatch. A synchronous nested snapshot captures the next boundary and queues
it behind the active batch. The reentry latch bounds one dispatch to its
initial batch and one follow-up. A second nested request coalesces without
consuming another set of latches. Dispatch checks that the player still owns
the captured connection before both snapshot and event delivery; closed
connections are also rejected by the send path. The threshold change must
remain entirely within packet assembly to preserve these semantics.

Existing server-lifetime, batch-encoding and W05B composition tests exercise
mutation, synchronous replacement, send failures, bounded reentry and
`3 → 2 → 1 → 0 → 1 → 2 → 3` recipient churn. The requested production repair
therefore needs route-boundary assertions and the existing lifetime tests,
not a parallel implementation of the same scenarios.

## Demonstrated performance issue

W07 used actual baseline/current codecs with preparation inside each broadcast.
Its 12-car results establish the reason for this follow-up:

| Recipients | Paired elapsed-time change | Prepared faster pairs | Backing capacity, ordinary → prepared |
| --- | ---: | ---: | ---: |
| 2 | +29.15% | 2/9 | 2,318 → 3,704 bytes |
| 4 | +2.63% | 4/9 | 4,636 → 5,716 bytes |
| 12 | −31.17% | 9/9 | 13,908 → 13,764 bytes |

For a field of `C` cars and `R` recipients, the actual observed allocation
identities give ordinary cumulative backing capacity `(67 + 91C)R` bytes and
prepared capacity `141C + 2(35 + 39C)R` bytes. Preparation adds three backing
buffers per broadcast, while reducing scalar car serialization from `CR` to
`C`. At 12 cars, the prepared backing-capacity total becomes smaller only at
12 recipients. That allocation observation is separate from the CPU crossover;
fewer scalar writes alone do not establish less elapsed time or less memory.

## Separate crossover workload

`scripts/engine-advancement/measure-snapshot-crossover.mjs` declares 22 cases
before any timing: all 1–12 recipient counts with 12 cars, and counts 2–11
with the smallest possible field (`cars = recipients`). This checks the
candidate threshold against both extremes without claiming every intermediate
field size or runtime has been measured.

Both measured arms import the same actual current `src/net/codec.ts` module.
The ordinary arm calls `encodeSnapshot()` per recipient, with FULL set and
restored as in the server. The prepared arm calls `prepareSnapshotCars()` once
inside every broadcast and `encodePreparedSnapshot()` for each recipient.
The real original baseline is an untimed wire/decode/allocation oracle only;
it is explicitly not labeled as a timed arm.

The workload reuses the shared helper for actual-source manifests and stability,
runtime-compatible native imports, cooperative timing lock and exclusive output
creation. Its separate same-source paired runner records runtime identity,
workload/helper hashes, equal seeded fixture hashes, every raw warmup/sample,
and before/after source/commit checks. It randomizes case order per round and
alternates arm order. Fixture/header construction, decoding, equality and
ownership checks, allocation instrumentation and report writing stay outside
timing; production allocation, preparation and packet copies stay inside.

The measured run has three warmup and nine sample pairs per case,
4,096 complete broadcasts per arm per pair, and a bounded 32-fixture output
ring. No output is silently discarded from the final ring, and retained earlier
packets must stay byte-identical after later broadcasts. No sample or case was
dropped to favor a threshold. The coordinator reserved approximately 90 seconds;
the single authorized run completed successfully, and compute was released
immediately afterward. No calibration or selected-case rerun was performed.

### Completed untimed preparation

`evidence/snapshot-crossover-preflight-6cb1c881.json` records:

- All 22 declared cases and 44 untimed comparison pairs passed.
- 4,576 oracle packets and 1,958,528 bytes per encoding variant matched the
  actual original baseline completely, with decoded recipient headers and
  exactly one correct FULL owner also checked.
- Independent output ownership, retained packets after later calls, source
  mutation isolation and prepared-buffer mutation isolation passed.
- Both source manifests contain 66 files; baseline and current commit pins,
  dependency lock, and workload/helper hashes remained stable.
- Actual observed buffer capacities, writer growth, scalar counts, copies and
  views are retained separately from timings. All workload timing fields are
  null in this preparation artifact.
- Scoped ESLint passed for the new script.

### Measured crossover

`evidence/snapshot-crossover-measurement-6cb1c881.json` retains the complete
single execution: 264 warmup/sample pairs, all equivalent; all 22 allocation
probes; the exact seeded case/arm order; Node `v24.22.3` on the local AMD EPYC
9V74 host; and the unchanged 66-file manifests. The cooperative reservation used
`/tmp/aeebac160835-engine-wave7.lock`. Workload and helper hashes match the
untimed preparation artifact. Cumulative measured broadcast time was 72.86
seconds, excluding setup, validation and report writing.

Elapsed values below are independent arm medians in microseconds per complete
broadcast. Change is the median of the nine paired percentage changes, so it
need not equal the percentage ratio of the independent medians. Negative change
means prepared encoding was faster. Every range includes all nine measured
pairs; no outlier was removed.

| Cars | Recipients | Ordinary µs | Prepared µs | Paired change | Prepared faster | Paired change range | Backing bytes, ordinary → prepared |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 12 | 1 | 6.198 | 13.053 | +110.58% | 0/9 | +5.89% to +352.80% | 1,159 → 2,698 |
| 12 | 2 | 12.686 | 13.108 | +15.50% | 4/9 | −38.07% to +157.20% | 2,318 → 3,704 |
| 12 | 3 | 22.020 | 13.642 | −40.35% | 7/9 | −68.01% to +150.55% | 3,477 → 4,710 |
| 12 | 4 | 23.632 | 20.491 | −23.73% | 7/9 | −51.55% to +142.08% | 4,636 → 5,716 |
| 12 | 5 | 28.486 | 22.649 | −23.74% | 5/9 | −69.48% to +12.33% | 5,795 → 6,722 |
| 12 | 6 | 43.032 | 23.946 | −50.25% | 8/9 | −60.72% to +15.18% | 6,954 → 7,728 |
| 12 | 7 | 45.940 | 31.498 | −24.68% | 8/9 | −64.62% to +38.61% | 8,113 → 8,734 |
| 12 | 8 | 55.791 | 36.045 | −33.76% | 7/9 | −65.75% to +27.21% | 9,272 → 9,740 |
| 12 | 9 | 54.462 | 32.818 | −37.31% | 7/9 | −77.23% to +42.12% | 10,431 → 10,746 |
| 12 | 10 | 64.084 | 50.344 | −21.44% | 8/9 | −62.52% to +46.04% | 11,590 → 11,752 |
| 12 | 11 | 73.818 | 37.525 | −48.42% | 8/9 | −63.54% to +22.10% | 12,749 → 12,758 |
| 12 | 12 | 85.350 | 67.498 | −15.66% | 8/9 | −61.13% to +5.95% | 13,908 → 13,764 |
| 2 | 2 | 5.145 | 5.847 | +28.96% | 4/9 | −45.59% to +93.74% | 498 → 734 |
| 3 | 3 | 8.445 | 8.339 | −2.46% | 5/9 | −50.31% to +147.32% | 1,020 → 1,335 |
| 4 | 4 | 15.262 | 9.830 | −26.14% | 5/9 | −64.11% to +76.79% | 1,724 → 2,092 |
| 5 | 5 | 21.883 | 14.717 | −20.18% | 5/9 | −59.53% to +101.14% | 2,610 → 3,005 |
| 6 | 6 | 27.637 | 16.648 | −49.73% | 5/9 | −58.01% to +166.08% | 3,678 → 4,074 |
| 7 | 7 | 38.379 | 20.867 | −46.37% | 6/9 | −62.10% to +68.75% | 4,928 → 5,299 |
| 8 | 8 | 43.643 | 30.044 | −25.17% | 8/9 | −62.89% to +42.71% | 6,360 → 6,680 |
| 9 | 9 | 48.604 | 31.303 | −35.46% | 8/9 | −66.35% to +43.75% | 7,974 → 8,217 |
| 10 | 10 | 66.052 | 30.966 | −45.76% | 8/9 | −70.67% to +7.71% | 9,770 → 9,910 |
| 11 | 11 | 66.928 | 42.542 | −42.38% | 6/9 | −61.52% to +23.86% | 11,748 → 11,759 |

### Adopted conservative threshold

Production uses preparation at **12 or more selected recipients**, retaining ordinary encoding
below 12. This repairs the demonstrated two-recipient regression while retaining
the twelve-recipient gain, the only measured point that also reduces cumulative
backing capacity. Its same-source result is faster in eight of nine pairs and
is corroborated by W07's separately retained actual-baseline comparison, which
was faster in all nine pairs. Preparation still uses three more backing buffers;
fewer cumulative bytes do not imply fewer allocation events or less GC work.

There are plausible CPU gains below twelve. A threshold of eight would use the
first boundary where both field shapes show repeated wins (7/9 and 8/9) and
paired median improvements of 33.76% and 25.17%. It would also increase observed
backing capacity by approximately 5% at that boundary. The smaller field shapes
at three through seven recipients are less consistent, and even eleven recipients
has only six of nine wins in its minimal field. Given the broad pair ranges and
only one execution per declared case, this review does not treat a CPU crossover
at eight as a universal or statistically established threshold. Selecting twelve
intentionally favors the supported allocation boundary and the corroborated full
field result over uncertain medium-group gains.

The timing is local synchronous encoder evidence, not browser, socket, latency,
whole-server or frame-rate evidence. It does not quantify heap allocation, peak
memory or GC pauses. An exclusive local reservation cannot eliminate host noise.
Every raw pair remains available to assess these limitations.

## Production repair and regression proof

The coordinator granted ownership of `src/net/server.ts` and the existing
`tests/engine-snapshot-batch-encoding.test.ts`. The production change replaces
one condition with `recipients.length >= 12` and updates its explanatory comment.
It uses the already filtered recipients array; the filtering rules, world
capture, scratch ownership, header construction, latches, queued dispatch,
connection-replacement checks and send-error handling are unchanged.

The existing byte-parity and observed-cost matrices now cover
**0, 1, 2, 4, 11 and 12 recipients**. Operation assertions distinguish ordinary
per-recipient serialization from one prepared full-field serialization, and
check actual cumulative backing-buffer capacity as well as distinct owned
outputs. The 11/12 boundary therefore checks both exact wire compatibility and
the reason for selecting that route. Existing reentry cases at four and twelve
remain intact, exercising both routes under nested snapshot capture, recipient
mutation and deferred events/contacts/input latches.

The new cost assertions were run before the production change. They failed at
two, four and eleven recipients because `prepareSnapshotCars()` was called once
where zero calls were expected; zero, one and twelve recipients passed. This
was the expected policy regression, not a fixture or compiler failure. The
unchanged assertion set passes after the condition change.

The retained before/after logs, tested-file hashes and check summaries are in
`evidence/snapshot-crossover-policy-validation.json`. Temporary full logs are
`/tmp/aeebac160835-engine/validation/w08b-snapshot-policy-before.log` and
`/tmp/aeebac160835-engine/validation/w08b-network-after.log`.

### Focused acceptance

Direct invocation with one Vitest worker, no lifecycle hooks, no retries:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/engine-snapshot-batch-encoding.test.ts \
  tests/engine-server-snapshot-lifetime.test.ts \
  tests/engine-network-advancement-composition.test.ts \
  tests/engine-network-clock-drift.test.ts \
  tests/engine-input-encoder-capacity.test.ts \
  tests/engine-transfer-transport-accounting.test.ts \
  tests/net-codec.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0
```

**Seven files and 59 tests passed**: 18 batch/ownership cases, 10 server-lifetime
cases, two live network composition cases, 11 presentation-clock cases, five
input-capacity cases, three transfer-accounting cases and 10 codec cases. The
clock integration retained its complete 1,228-packet comparison: 734 input
packets and 494 snapshots matched. Live composition continues to cover owner
replacement, failures, reentry and recipient churn with the repaired route.

Scoped ESLint and Prettier checks passed for the production server, the modified
batch test and the new crossover script. No compiler, full build, browser or
physical-network run was performed in this assignment. No additional timing
was necessary or collected after this route-selection repair; the measured
ordinary and prepared codec implementations themselves are unchanged.

No assets, authored content, handling values, dependencies, Git state, original
W07 files or crossover measurement artifacts were changed. Root owns
consolidated gates and publication. Released files are the server, the existing
batch test, the new crossover script, the three `snapshot-crossover*.json`
evidence artifacts, and this report.
