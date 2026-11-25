# W07C — retire canceled network event handles immediately

Assignment 39/60, wave 7. This change is restricted to the deterministic network
scheduler and its acceptance coverage.

## Finding and decision

A canceled future event already released its callback payload by setting
`Scheduled.fn` to null. It nevertheless remained in the scheduler's
`queued` lookup Map until its original deadline was popped. Repeated
successful joins, connection losses, stopped repetitions and teardown could
therefore leave lookup entries that no longer owned any callable work.

The correction removes that lookup entry immediately after clearing the
callback. The event's small heap record remains at its original position.
This preserves the existing public contract that `pending` counts all queued
heap slots, including canceled ones.

This is a reduction in retained cancellation bookkeeping. It is not a new claim
that callback payloads were retained before this change, and it does not bound
the heap, remove its tombstones, or measure total memory, CPU, energy or FPS.

## Exact source change

Only `EventLoop.cancel` changes in
[src/net/event-loop.ts](../../../src/net/event-loop.ts):

1. Find the handle's currently queued event, as before.
2. Set its callback to null, as before.
3. Remove that handle from the lookup Map.

Unknown, malformed, canceled or already-executed handles remain no-ops.
Scheduling, monotonically issued handles, heap ordering, event times, equal-time
sequence order, `runUntil`, `runWhile`, `every` and `NetRandom` are unchanged.
In particular, cancel does not create or reserve an unknown handle.

The Map entry is unnecessary after cancellation because a second cancellation
has no remaining effect to perform. Heap removal still calls Map.delete when
the due record is eventually popped; deleting an already-absent key is harmless.

## Reentrancy review

There is no user callback between the lookup, callback clearing and Map deletion.
The lookup is the scheduler's own Map. A currently executing event was already
removed from the Map by `pop` before its callback began, so self-cancellation,
a repeating callback stopping itself, and a throwing callback cannot delete a
successor's handle.

A new event receives a new sequence number. Removing an older lookup does not
change that sequence or alias a later event. This patch preserves the existing
number-based handle design; it does not introduce handle recycling.

The inspected consumers use returned numeric handles or stop functions:

- RaceServer owns join, countdown, results and sweep deadlines.
- RaceClient owns ping, input, send and render repetitions.
- SimulatedLink owns deferred reliable-retry timers.
- The network slice schedules its scenario and observation work through the
  same public API.

No inspected production consumer reads the private Map. Existing tests explicitly
preserve canceled heap slots and their `pending` counts; this change keeps those
contracts intact.

## Authored acceptance

[tests/engine-event-retirement.test.ts](../../../tests/engine-event-retirement.test.ts)
adds seven cases after parameter expansion:

| Case | Required observation |
| --- | --- |
| 4,096 future cancellations | All callback fields cleared and zero retained handle records immediately, with 4,096 pending heap slots and unchanged clock; a subsequent live event still executes. |
| Three ordered-list comparisons | Complete event traces, clocks, delivered counts and pending counts equal an independent linear-list scheduler through partial drains, cancellation, ties, newly scheduled same-time events and final tombstone drainage. |
| 256 stopped repetitions | No retained lookup entries before the future due times; one active repetition still runs at exact times 1, 8 and 15, then stops itself once. |
| Cancel then throw | A callback cancels a same-time successor, schedules another, and throws; the canceled lookup is gone while both surviving callbacks remain recoverable. |
| 128 real connection losses | The actual RaceServer, EventLoop and simulated transport return to one live sweep handle after each loss; teardown removes that final lookup without advancing to canceled join deadlines. |

The ordered-list oracle has no heap or handle index. It independently sorts and
searches event records, so the public trace checks do not merely repeat the
candidate's deletion implementation. The retained-index assertions are separate
resource checks.

The tests require a 4,096-to-zero retained-index reduction for the deliberately
all-canceled workload. They do not label that assertion an executed measurement.
Under the old source, the index still held those records until the due-time drain.

The existing
[net-event-loop-ownership suite](../../../tests/net-event-loop-ownership.test.ts)
was also inspected. Its unknown-handle, already-fired-handle, callback-release,
self-stop, throwing callback, invalid clock, exact recurrence and seeded
sorted-reference expectations remain compatible. Existing server deadline
and network recovery tests retain their original assertions.

## Integration identity

The reviewed engine checkpoint is
[`c482ad9ce9fdef02660e4880a027d83326c840c4`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/c482ad9ce9fdef02660e4880a027d83326c840c4).

Before creating this candidate, main was re-read at
`5bed115a9a7e4a9a027a1c6da4ea427511102857`. Its EventLoop bytes still matched
the reviewed checkpoint, with blob
`4d14913956f6094e55bfc205005d7e99d8add99b`. Both new paths were absent from
the complete, untruncated tree.

The candidate includes exactly three owned files: this report, the new test and
the scheduler module. It does not edit other agents' network recovery test,
server/client source, storage, worker scheduling, or any protected rendering,
animation, model, character, environment, offroad, protocol or vehicle content.
No commit or branch/ref update is performed by this assignment.

## Validation status and reproduction

**Source review only; hosted execution is pending.** The local execution
environment is unavailable. No new Vitest, TypeScript, build, browser or
performance pass is claimed.

The new suite is included by the existing focused workflow's
`tests/engine-*.test.ts` glob. A targeted developer command is:

```sh
npx vitest run tests/engine-event-retirement.test.ts tests/net-event-loop-ownership.test.ts tests/engine-server-owned-deadlines.test.ts tests/net-transport-lifetime.test.ts
```

Use the coordinator's final accepted source SHA and hosted results when reporting
the regression's measured counts.
