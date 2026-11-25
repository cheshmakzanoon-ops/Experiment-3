# W05E — reproducible codec byte, ownership, copy, and timing probe

## Status and purpose

The probe source is prepared for hosted execution. **Local Node
execution was unavailable in this task, and hosted results are pending.**
No W05E timing, allocation reduction, or passing runtime result is claimed in
this note. The tables below are deterministic expectations checked by the
script, based on the production source and the earlier
[W03F report](w03f-codec-buffers.md); they are not newly measured results.

The deliverable is
[scripts/engine-runtime-probes/codec-probe.mjs](../../../scripts/engine-runtime-probes/codec-probe.mjs).
It prints one JSON result to stdout. Any missing baseline, exact-byte mismatch,
ownership failure, or copy/backing-count mismatch prints failure JSON and
throws, giving the process a nonzero exit. Timing has no pass threshold.

## Actual Git baseline and reproduction

The shared helper loads the exact Git bytes of these two files at
`dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`:

- `src/net/bytes.ts`
- `src/net/codec.ts`

The candidate uses those files from the checkout. Each variant is a separate
in-memory esbuild bundle. Other dependencies, including the scalar input and
snapshot wire writers, come from the same candidate checkout in both bundles.
This is a comparison of the two declared codec files, not a replay of the entire
baseline repository. No handwritten baseline codec or copied historical timing
artifact substitutes for those Git objects.

The helper records the pinned baseline commit, candidate HEAD, tracked checkout
state, entry and bundle hashes, and baseline/candidate source hashes. It fails
if the baseline object is absent or the declared candidate sources/HEAD change
during bundling. See
[support.mjs](../../../scripts/engine-runtime-probes/support.mjs).

From the repository root, with the repository's locked dependencies already
installed:

```sh
git fetch --no-tags origin dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc
NODE_OPTIONS=--max-old-space-size=512 node scripts/engine-runtime-probes/codec-probe.mjs > codec-probe.json
```

CI must stop if fetching the baseline or running the probe fails. The root
integration owns that CI change; this assignment changes only the probe and
this note. Keep the emitted JSON as the evidence for the exact candidate commit.
A successful JSON status means byte, ownership, and deterministic count
assertions passed; it does not classify the timing result as a performance win.

## Exact-byte and ownership coverage

Fixtures cover three deterministic seeds, unsigned timestamp wrapping,
nontrivial control bits and rear brake/lean values, negative and saturated
quantized fields, boundary header values, and reversed car IDs so recipient
index and car ID cannot be confused.

| Coverage | Cases per execution |
| --- | ---: |
| Input command counts 0–16 | 51 |
| Snapshot car counts 0–32, each with none/last/alternating/all FULL cars | 396 |
| Prepared boundaries at every count 1–32 | 96 |
| Prepared recipient positions across those boundaries | 1,584 |

Every ordinary packet is compared byte for byte with the actual baseline
encoder. Every prepared recipient is compared with the actual baseline ordinary
encoder with exactly that recipient's car FULL; both baseline and candidate
prepared paths are checked.

Checks retain packets across later encodes and source mutation, require exact
backing length and zero byte offset, transfer whole backing buffers with
`structuredClone`, and verify sender detachment and received bytes. Prepared
recipient packets must have distinct backing buffers, independent of both
shared car tables; later preparation and deliberate table overwrites must leave
retained packets intact. The consuming writer is checked for exact-buffer
handoff, reuse through every scalar writer, spare-capacity trimming, and repeated
empty-result transfers. Defensive `finish()` behavior and representative existing
encoder errors remain checked.

The source also uses the existing ownership suite as its review reference:
[engine-codec-buffer-ownership.test.ts](../../../tests/engine-codec-buffer-ownership.test.ts).
This standalone probe complements that suite; it does not report Vitest results.

## Untimed copy and backing-buffer instrumentation

A synchronous diagnostic section temporarily wraps the `Uint8Array`
constructor and its `slice`/`set` methods, restoring all original globals and
property descriptors in `finally`. A small known-copy self-check validates the
counter plumbing. It then measures all five workloads, with three separate
boundaries/packets per workload and variant. Exact output bytes are checked
again after the hooks have been removed.

The counters deduplicate nonempty backing-buffer identities, sum their
capacities, and count bytes copied by typed-array `slice` and `set`. Scalar
DataView writes are not copies. Zero-byte backing stores, JavaScript objects,
views, transport copies, total heap, and GC are outside this count. In
particular, the candidate's shared empty reset array and DataView are created
once when its module loads, before instrumentation; they are not charged as
per-packet allocations.

**Expected assertions, pending execution:**

| Packet or boundary | Nonempty backings, baseline → candidate | Backing bytes, baseline → candidate | Copied bytes, baseline → candidate |
| --- | ---: | ---: | ---: |
| 2-command input | 2 → 1 | 72 → 36 | 36 → 0 |
| 4-command input | 2 → 1 | 108 → 54 | 54 → 0 |
| 12-command input | 2 → 1 | 252 → 126 | 126 → 0 |
| 12 cars, 2 ordinary recipients | 4 → 2 | 2,318 → 1,006 | 1,006 → 0 |
| 12 cars, 12 prepared recipients | 27 → 14 | 13,764 → 7,116 | 12,876 → 6,228 |

For the prepared boundary, the expected baseline copy count is 6,648 bytes from
finalization slices plus 6,228 bytes from table construction and recipient
assembly. The candidate is expected to retain the 6,228 assembly bytes while
removing those finalization copies. Each recipient packet is 503 bytes in the
12-car fixtures. These statements become executed evidence only when the JSON
contains the corresponding successful measured counters.

## Bounded paired microtiming

Timing runs before any copy/backing hooks are installed. Setup, bundling,
correctness assertions, ownership checks, and instrumentation are outside the
timed regions. Timed work includes encoding and a small checksum over output
length and bytes; prepared work includes one car-table preparation per boundary.
Equivalent timed checksums are required, but do not replace exact-byte checks.

Each workload has three warmup pairs followed by seven measured pairs.
Baseline/candidate order alternates continuously across warmup and measured
pairs, and the starting order also alternates by workload. There is no adaptive
iteration increase.

| Workload | Iterations per timed sample | Packets per iteration |
| --- | ---: | ---: |
| Input, 2 commands | 8,000 | 1 |
| Input, 4 commands | 8,000 | 1 |
| Input, 12 commands | 8,000 | 1 |
| 12 cars, 2 ordinary recipients | 600 | 2 |
| 12 cars, 12 prepared recipients | 180 | 12 |

This fixed work is intended to take seconds on a normal CI runner. It is a
bound on work, not a hard wall-clock promise on a stalled or heavily contended
host. JSON includes every warmup and measured pair, execution order, raw
milliseconds, per-pair candidate/baseline ratios, baseline and candidate
medians, median paired ratio, ratio of medians, total timing-section duration,
and Node/V8/platform details.

No speedup is required for success, no noisy pair is discarded, and no ratio
is presented as a whole-engine or FPS result. JIT state, GC, CPU scheduling,
host load, and the checksum/harness overhead can affect these small samples.
The probe establishes neither browser, networking, frame-time, memory-residency,
nor production GC performance. Those questions need separate measurements.
