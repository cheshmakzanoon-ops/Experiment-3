# W03F — consuming codec buffers

## Change and ownership

Added `ByteWriter.finishOwned()`: an exactly filled, nonempty buffer moves to
the caller; excess capacity is copied into an exact-length result. The writer
then resets to shared empty storage and length zero. Later writes grow into
fresh storage. Empty results are always fresh so transferring an empty result
cannot detach the shared reset storage. No consumed-state branch was added to
`reserve` or any scalar write. Ordinary `finish()` retains its defensive-copy,
nonresetting semantics.

`encodeInput`, `prepareSnapshotCars`, and `encodePreparedSnapshot` consume their
already exact writers. Ordinary `encodeSnapshot` now allocates
`1 + SNAPSHOT_HEADER_BYTES + carCount * CAR_COMPACT_BYTES + fullCount *
(CAR_FULL_BYTES - CAR_COMPACT_BYTES)` and consumes that writer too. Its small
FULL-count pass includes every FULL car; oversize rejection stays ahead of
that pass. Wire writers, decoders, versions, input queues, and the server's
12-recipient preparation policy are unchanged.

## Small paired probe

Node **v24.22.3**, `NODE_OPTIONS=--max-old-space-size=512`, three warmup pairs
and seven measured pairs per case, alternating baseline/candidate order.
Baseline is a captured copy of the pre-edit `bytes.ts` and `codec.ts`; unchanged
scalar wire writers are shared. Input cases use 40,000 packets/sample; the
12-car snapshot cases use 2,000 two-recipient boundaries or 600 twelve-recipient
boundaries/sample. The latter includes shared preparation. Timers cover
encoding and reading output length/bytes, not setup or instrumentation.

| Case | Baseline median ms | Candidate median ms | Median paired change |
| --- | ---: | ---: | ---: |
| 2-command input | 27.445 | 20.263 | −25.20% |
| 4-command input | 33.859 | 26.117 | −21.49% |
| 12-command input | 195.346 | 131.723 | −35.83% |
| 12 cars, 2 ordinary recipients | 13.011 | 12.700 | −3.13% |
| 12 cars, 12 prepared recipients | 30.745 | 17.705 | −33.78% |

These are provisional local microbenchmarks under shared-host load. Some pairs
have substantial timing/GC noise: the ordinary two-recipient ratios span
0.799–1.570; its −3.13% median is not a firm CPU improvement. No main-case
median regressed, and input cases support keeping the branch-free design.
These figures establish no whole-engine, browser, network, heap, or GC gain.
Independent performance work remains necessary before stronger timing claims.

Separate untimed instrumentation counted distinct nonempty backing buffers,
their combined byte capacities, and bytes copied by typed-array `slice`/`set`.
Scalar DataView writes are not counted as copies. The shared zero-byte reset
array/view are module-level objects, not per-packet allocations.

| One packet / boundary | Backing buffers, before → after | Backing bytes, before → after | Copied bytes, before → after |
| --- | ---: | ---: | ---: |
| 2-command input | 2 → 1 | 72 → 36 | 36 → 0 |
| 4-command input | 2 → 1 | 108 → 54 | 54 → 0 |
| 12-command input | 2 → 1 | 252 → 126 | 126 → 0 |
| 12 cars, 2 recipients | 4 → 2 | 2,318 → 1,006 | 1,006 → 0 |
| 12 cars, 12 recipients | 27 → 14 | 13,764 → 7,116 | 12,876 → 6,228 |

The 12-recipient path still copies compact/full car ranges into independent
recipient packets. Eliminated finalization copies are 6,648 bytes/boundary;
remaining copies are 6,228 bytes. Output packet lengths and bytes match the
captured baseline for every untimed probe case (three boundaries per case).

Probe source, frozen baseline copies, and all raw pairs are retained at
`/home/agent/motobound-engine-1a587ba11b3c/tmp/w03f-codec-buffers/` as
`probe.mjs`, `baseline-bytes.ts`, `baseline-codec.ts`, and `probe-result.json`.
Run with `NODE_OPTIONS=--max-old-space-size=512 node
--experimental-transform-types /home/agent/motobound-engine-1a587ba11b3c/tmp/
w03f-codec-buffers/probe.mjs` (join the wrapped path).

## Verification and limits

Added `tests/engine-codec-buffer-ownership.test.ts` for defensive `finish`,
consumption/reuse through every scalar writer, spare-capacity trimming,
retained/output/source independence, whole-buffer transfers (including repeated
empty results), rejected-write recovery, all 0–16 input counts, ordinary FULL
combinations through 32 cars, prepared recipient equality/ownership, and
existing encoder errors. The exact byte references use the unchanged scalar
wire writers with defensive finalization.

Root explicitly authorized minimal allocation-instrumentation updates in
`engine-input-encoder-capacity.test.ts` and
`engine-snapshot-batch-encoding.test.ts`: count the consuming finalizer, expect
the exact writer buffer to become the output, and use the new buffer/capacity
counts. All existing wire, decoder, numerical, and equivalence assertions are
preserved.

The focused three-file Vitest invocation used the required 512 MiB heap and
one thread but was **killed with exit 137 before any test result** during shared
memory pressure. This is an incomplete infrastructure gate, not a passing
suite or assertion failure. Root requested no Vitest retry; hosted verification
must run the new and updated tests. No full compiler/build, install, Git write,
or protected-content modification was performed.

Tradeoffs: consuming finalization deliberately relinquishes spare capacity;
reusing it starts an empty writer and may grow. Reusable accumulation remains
available through `finish()`. Ordinary snapshot encoding adds one short flag
scan to avoid spare capacity and finalization copying. The new owned result
has an exact `ArrayBuffer` type and byte length, with no hidden oversized slab.
