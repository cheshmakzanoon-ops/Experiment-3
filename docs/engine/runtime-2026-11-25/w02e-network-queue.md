# W02E — bounded server input expiry

Implemented only `src/net/input.ts` and
`tests/engine-input-queue-expiry.test.ts`. Baseline:
`dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`.

## Caller and change

`RaceServer.tick()` calls `player.queue.take(t)` at each 120 Hz physics tick.
The former expiry loop visited every pending Map key on every call, even
when only the next slot could expire. The queue now keeps one scalar lower
bound, `expireFrom`, for pending ticks. Newly admitted older slots rewind
that bound; empty queues reset it to `Infinity`.

Sequential consumption deletes one cursor slot. Skipped calls choose the
shorter of the inclusive cursor-to-tick span and the pending Map size. Thus
large wire-range jumps scan the existing entries instead of iterating through
billions of absent ticks. Backward reads below the bound do no expiry work.
The additional retained state is one number, with no auxiliary per-slot data.

## Preserved contracts

The lower-bound invariant guarantees every pending key is at or above the
cursor. Both expiry branches therefore delete exactly the original keys at
or below `tick`, after capturing the requested slot. This also preserves
nonmonotonic public `accept(..., now)` calls: newly admitted older slots
rewind the cursor and remain readable. The unchanged ACK-gap walk still runs
on every valid `take`, including empty queues and backward reads.

Admission/rejection, duplicates, partial and fully late commands, overlapping
first-writer ownership, exact control references, first-command edge flags,
all counters, slack/reset behavior and unsigned wire endpoints are retained.
No wire codec, sanitization, control semantics or client input code changed.

## Executed evidence

The new suite contains a frozen copy of the original queue and its guards.
It compares every public state/output after operations in three seeded
1,200-operation mixed streams plus directed overlap, reordering, late
admission, ACK-gap, skipped/backward, resend and wire-endpoint cases.

| Actual queue workload | Frozen original | Revised queue |
| --- | ---: | ---: |
| 31 eight-tick commands at server tick 0; takes 0–247 | 30,876 pending-key visits; 248 deletes | 0 pending-key visits; 248 deletes |
| Delivered slots / first-command edges / final depth | 248 / 31 / 0 | 248 / 31 / 0 |

A separate sparse test retains ticks 5, 2,000,000,000 and 4,294,967,294.
Taking the middle tick visits three keys and deletes two. A backward read
does no additional work; admitting tick 4 then consumes it with one direct
delete. The final jump visits the sole remaining key. An operation budget
fails promptly if a regression attempts an unbounded numeric walk.

Executed focused command:

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/engine-input-queue-expiry.test.ts tests/net-command-queues.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
```

**63 tests passed in two files**: seven new expiry tests and 56 existing
command-queue/decoded-flow boundary tests. Vitest reported 2.27 seconds total.

## Limits

These counts establish expiry work, not wall-time, heap/GC, physical-network
or game-FPS gains. Independent paired timing remains assigned to a later
measurement agent. The Map fallback intentionally remains for skipped or
rewound public streams; its iteration count is bounded by the existing
pending size. Existing queue admission bounds and ACK-gap work are unchanged.
No full compiler/build, broad test suite, dependency or Git mutation ran here.
