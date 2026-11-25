# Wave 2 — shared snapshot car serialization

Assignment 12/60; implements network audit finding 3.

## Behavior

- `RaceServer.snapshot` retains its existing single field capture, recipient selection, latch consumption and queued dispatch. With multiple recipients it prepares car bytes once before assembling every owned packet and invoking any transport.
- `prepareSnapshotCars` writes each car once with a FULL encoding override, then derives compact bytes without changing capture scratch. `encodePreparedSnapshot` writes the recipient header and copies the appropriate compact/FULL spans into an independently owned packet.
- `encodeSnapshot` remains the ordinary scalar encoder and reference API. A single recipient still uses that path; zero recipients perform no capture or encoding. Header quantization is shared through `writeSnapshotHeader`; car assembly remains independent.
- The wire format remains 23 message/header bytes, 39 compact bytes per car and a 12-byte owning-car extension at car offset 28. All other flags, field order and scalar quantization are unchanged.
- Prepared storage is local to one boundary, bounded by `LIMITS.carsPerSnapshot` (32): full plus compact data is at most 2,880 bytes, with a temporary 1,632-byte preparation writer. No encoded cache survives into another tick. Existing reentry coalescing, ownership checks and failure isolation remain in place.

## Verification

New `tests/engine-snapshot-batch-encoding.test.ts` has 14 cases. Real server dispatch is compared byte-for-byte and channel-for-channel with ordinary `encodeSnapshot` across 0/1/4/12 recipients and twelve varied boundaries, including every owning-car position, saturated/rounded values, all phases, flags, ranks, large ACKs, wrapped echo, fractional/clamped hold, missing windows and slack. Further cases cover arbitrary car ordering, the 32-car preparation limit, mutation of source/prepared/retained packets, bounded reentry, event/latch order, snapshot/event send failures and connection replacement. Existing lifetime tests also exercise real timer-driven clients after failures.

Direct command, without package lifecycle hooks:

```sh
./node_modules/.bin/vitest run tests/engine-snapshot-batch-encoding.test.ts tests/engine-server-snapshot-lifetime.test.ts --maxWorkers=1
```

Result: **2 files, 24 tests passed**. After strengthening writer buffer instrumentation, its four relevant cases passed again with `-t 'does bounded scalar work'` (10 unrelated cases skipped).

Instrumentation observes actual exported car writes, scalar writes, writer reserve/backing changes and finished output buffers separately from timing. For a twelve-car field:

| Recipients | Previous car serializations | Current car serializations | Previous snapshot backing buffers | Current snapshot backing buffers |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 0 | 0 | 0 | 0 |
| 1 | 12 | 12 | 2 | 2 |
| 4 | 48 | 12 | 8 | 11 |
| 12 | 144 | 12 | 24 | 27 |

Current counts include preparation and independently owned packet outputs, exclude reliable event encoding, and show no writer growth. The multi-recipient path trades three temporary backing buffers per boundary for the reduced repeated serialization. It still performs the necessary recipient packet allocations/copies. At one recipient the unchanged ordinary path avoids preparation entirely.

Wave 7 owns elapsed-time/throughput measurement, including small-recipient behavior. No browser, frame-rate, heap-pressure or full-race performance improvement is claimed here. Root owns consolidated typecheck/build/gates. Input capacity, client/interpolation, content, assets and tuning were not changed.
