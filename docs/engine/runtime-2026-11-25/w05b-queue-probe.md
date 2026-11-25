# W05B — actual-source ServerInputQueue probe

## Status

**Not executed during authoring.** The local execution environment was unavailable.
The probe is ready for a hosted checkout; this report does not claim a new passing
run, measured duration, or observed operation count. The dense figures below are
explicit assertions to reproduce the earlier W02E result against actual Git
source. A successful run emits its own observations and timings as one JSON
document. Any compatibility, operation-budget, or expected-count failure throws
and exits unsuccessfully.

Deliverable: [queue-probe.mjs](../../../scripts/engine-runtime-probes/queue-probe.mjs).
It uses the shared [support.mjs](../../../scripts/engine-runtime-probes/support.mjs)
helper authored with W05A.

## Source provenance and isolation

The historical implementation is loaded from `git show` at
`dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc:src/net/input.ts`. The candidate is
`src/net/input.ts` from the executing checkout. The helper bundles both in
memory; only this path is substituted in the baseline bundle. Both variants
resolve the same candidate dependencies, including configuration and constants.
This isolates the queue file change; it is not a reconstruction of the entire
historical engine.

Authoring inspected:

| Source | Revision / Git blob |
| --- | --- |
| Historical `src/net/input.ts` | Commit `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`; blob `b5dcfa89afb9263eca30c68f3dd1673f5dc434d2` |
| Candidate `src/net/input.ts` | Commit `b3b8ec09183734287b71406f8894d07c91eb48c9`; blob `c394f4b7e358f64f7a42d8d44215218560a49fb0` |
| Existing compatibility suite | [engine-input-queue-expiry.test.ts](../../../tests/engine-input-queue-expiry.test.ts), blob `5f898dbaa52c9cc27d39780aff3a917728c201b2` |
| Prior change report | [w02e-network-queue.md](w02e-network-queue.md), blob `ce86686bb8813049da34b2eb31e8911af7e52df3` |

Unlike the existing test suite's frozen reference class, this probe contains no
queue implementation. Its constructors are the two namespaces returned by
`variants(entry, ['src/net/input.ts'])`. Runtime JSON includes the helper's
exact source SHA-256 digests, candidate HEAD, baseline ref, Node version, esbuild
version, entry hash, and source byte lengths. The executing candidate may be a
later integration commit; use the emitted provenance to identify the run.

## Comparison coverage

All commands, controls, operation records, and operation arrays are frozen.
Both queues receive the same command and control references. The generated
operation stream does not consult either implementation.

After **every operation**, the probe compares the actual returned value and
public state: depth, remembered sequences, contiguous ACK, and every statistics
field. Returned slots include the complete controls and `first` flag; successful
takes also require identical control-object references. Explicit slack operations
check both the current margin and its reset to `Infinity`.

| Workload | Coverage |
| --- | --- |
| Dense sequential | 31 eight-tick commands admitted at tick 0, takes 0–247, then two slack reads |
| Reordered and late | Overlap with first-writer ownership, out-of-order commands, duplicates, partial/full late arrival, ACK gap retirement, rejected-then-accepted resend, repeated and backward reads |
| Backward take and admission | Advance consumption, read older ticks, admit newly received older slots, then skip forward and drain |
| Large sparse jumps | Retain ticks 5, 2,000,000,000 and 4,294,967,294; take the middle, read backward, admit tick 4, and drain the far endpoint |
| Unsigned endpoints | Valid tail commands, overlapping final slot, reserved sequence, tick overflow, NaN and fractional sequence rejection, repeated maximum-tick reads |
| Seeded traces | Seeds 17, 0x1234abcd and 0xfedcba98; 1,200 generated operations each plus final drain and two slack reads |

The seed generator mixes reordered batches, duplicate delivery, sequence gaps,
early/late admission, excessive lead/sequence rejection, invalid duration,
forward jumps, backward clock movement, takes and slack reads. It is bounded and
deterministic; it is not an exhaustive exploration of the input space.

The JSON records each operation count, method totals, trace SHA-256, observation
SHA-256, maximum depth/remembered count, delivered slots, first edges, missing
slots, and final ACK/statistics. Non-finite numbers and negative zero receive
explicit tags when hashing, avoiding JSON's usual loss of those distinctions.
The observations are compared again with uninstrumented queues; their hashes
must match the instrumented pass.

## Operation counts and bounded work

Counters attach only to each queue's existing `pending` Map instance. No global
prototype is changed. Iterator wrappers advance the real native iterators, so
deletion during iteration retains native Map behavior. Counts distinguish
`keys()` visits, other iteration APIs, and get/has/set/delete calls. Recording
all iteration APIs prevents a switch to `entries()`, direct iteration, values,
or `forEach` from appearing as eliminated scanning.

These are **pending Map operation counts**, not total CPU instructions or
allocation counts. The unchanged `seen` Map / ACK-gap walk is not instrumented.

For each take, the counted pass enforces at most twice the starting pending
depth in iteration visits plus delete calls. The baseline can visit N keys and
delete at most N; the candidate's numeric branch can issue at most N deletes.
The budget is checked inside every visited entry and delete call. A sparse
jump regression therefore fails promptly instead of walking billions of absent
tick values before any timing pass starts.

### Required dense reproduction

| Observation asserted by this probe | Actual-source baseline target | Candidate target |
| --- | ---: | ---: |
| Delivered slots | 248 | 248 |
| First-command edges | 31 | 31 |
| Applied ticks | 248 | 248 |
| Pending key visits | 30,876 | 0 |
| All pending iteration visits | 30,876 | 0 |
| Pending delete calls | 248 | 248 |
| Final pending depth | 0 | 0 |

The baseline target is the sum 248 + 247 + … + 1 = 30,876. This arithmetic
explains the expected count; only an executed counter pass establishes the
observed count for the recorded sources. Assertion failure displays the actual
and expected values. The dense batch matches W02E's public queue API fixture;
it does not imply that 31 commands fit in one encoded network packet.

The sparse fixture also asserts 7 versus 4 key visits and 4 deletes in both
variants across its full trace. The candidate intentionally retains a Map scan
for sparse jumps. Reordered/late counters additionally require one fully late
command, five late ticks, two duplicates and one rejection. Endpoint admission
requires five rejected malformed commands.

## Timing method

Only after all compatibility, instrumentation-parity, budget, and count checks
pass does the probe measure fresh, uninstrumented queues. Each workload receives
two warmup batches per variant and seven paired samples. Baseline/candidate
execution order alternates. Batch repetition count is
`max(1, min(64, floor(4096 / operationCount)))`, making the amount of scheduled
work finite without allowing arbitrary command-line workload inflation.

Timing uses `node:perf_hooks.performance.now()`. The measured region includes
queue construction, operation dispatch, accept/take/slack calls and a small
result checksum. It excludes bundling, fixture generation, Map instrumentation,
deep assertions and SHA-256 hashing. Checksums are compared outside each paired
timed region. Raw batch durations, repetition counts, and per-replay minimum,
median and maximum are emitted separately from the operation counts.

The baseline/candidate median ratio is diagnostic only. There is no wall-time
pass/fail threshold. Seven pairs cannot remove JIT, scheduler, CPU frequency,
thermal, background-load or GC variation, and short workloads may be close to
clock resolution. Use the raw samples and emitted runtime/source provenance
when assessing the results. The measurement is a complete queue workload,
including admissions and checksums, rather than a pure expiry-loop duration.

## Hosted reproduction

Run from the repository root with its locked dependencies installed and a Node
version satisfying the repository's `>=22.12.0` requirement. The shared helper
requires the installed esbuild dependency. Fetch the exact baseline object
before executing, including on a shallow CI checkout:

~~~sh
git fetch --no-tags origin dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc
node scripts/engine-runtime-probes/queue-probe.mjs > queue-probe.json
~~~

The command emits one JSON document on standard output after success. Preserve
that document as the run artifact; a report of actual results should quote its
provenance and raw measurements. Assertion errors are failures, not skipped
workloads. This authoring session did not run the command or the existing
Vitest suite.

## Limits

The probe measures only the actual queue implementations for these fixtures.
It provides no whole-engine, game-FPS, renderer, physical-network, allocation,
heap, or GC improvement claim. Controls are compared at the queue boundary;
downstream application of edge controls and network codec behavior are outside
this probe. Queue-state equality is checked through its public observations;
the cursor's internal representation is deliberately not part of compatibility.
Private `pending` property access is used solely for instrumentation and will
fail explicitly if that test seam changes.
