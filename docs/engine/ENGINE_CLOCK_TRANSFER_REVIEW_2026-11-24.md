# Independent clock and transfer ownership review

## Finding

Agent 53 reviewed the clock, input, recording-transfer, snapshot-transfer and
session-cancellation work through published commit
`c4e62c642d912037e5e9262b1b89d4fbfd9677fe`. The review found and repaired one
additional snapshot ownership defect: an older publication's failure could
reclaim a buffer already handed to a newer synchronous consumer.

The production change is confined to
[`src/workers/frame-buffer-pool.ts`](../../src/workers/frame-buffer-pool.ts).
Fixed-step timing, physics, vehicle tuning, wire layouts, authored resources,
models and characters remain unchanged.

## Reproduction and repair

`FrameBufferPool` explicitly supports consumers that return an attached buffer
synchronously. The problematic sequence was:

1. Publication A obtains the sole idle buffer and invokes its consumer.
2. That consumer returns the buffer and starts publication B synchronously.
3. B hands the same attached buffer to a newer consumer, which keeps it.
4. A's callback throws after B completes.
5. A's recovery removes B's outgoing ownership and puts B's live buffer in the
   idle reserve.

A subsequent publication could overwrite the newer consumer's snapshot. The
direct Node reproduction reported one available buffer while B still held it;
a third ordinary publication was incorrectly accepted and changed B's test byte
from 53 to 99. Two regression cases reproduced the failure with one and three
nested older callbacks.

Outstanding entries now map a buffer to its publication number. Error recovery
and detached-transfer accounting act only when that number still matches the
publication being completed. Recycling remains buffer-based, and an actual
transfer still retires its detached wrapper into a numeric return credit.

The change adds one counter and a number on each existing outstanding entry.
It does not allocate a separate token object for every frame, add a wire field,
or retain a history of completed publications. A real cross-thread delivery
normally cannot run its recipient synchronously; the defect occurs at the
supported synchronous/non-transferring adapter boundary.

## Regression coverage

The new
[`engine-clock-transfer-integration.test.ts`](../../tests/engine-clock-transfer-integration.test.ts)
contains seven cases. In addition to the two failing reproductions, it checks
successful older callbacks, a newer actual transfer followed by an older
failure, a complete synchronous transfer round trip, and exactly-once reserve
recovery when the newer writer itself fails.

A 2,048-batch integration trace combines the real `FixedStepClock` and
`FrameBufferPool` with variable wall intervals, synthetic CPU overload, delayed
returns, required pause snapshots and 30-second paused intervals. Actual
`structuredClone` transfers detach buffers. Returned snapshots retain their
published ticks, reverse-order and duplicate returns preserve ownership, the
idle reserve stays at or below five buffers, and backpressure does not stop the
fixed simulation tick counter. This is a controlled scheduling/transport test,
not a full simulation or frame-rate benchmark.

Before the fix, the new suite reported **two failures and five passes**. After
the fix, all seven passed. The new suite plus the existing frame-buffer pool,
recording transport and InputPump suites passed **38 tests across four files**.
The existing circuit and Festival worker pool integrations also passed **12
tests across two files**. Those exercise the actual simulation/worker handlers
with controlled scheduling and message transport, including field-size changes,
pause barriers, flashback and ambient traffic pairing. Together these runs
executed 50 distinct tests. Scoped ESLint, Prettier and whitespace checks passed.

## Review boundaries

The read-only review also followed fixed-step rebase/reset behavior, the circuit
and Festival worker pause/snapshot paths, recording page failure recovery,
InputPump stale-run guards, InputController terminal/visibility handling, and
SessionLifetime/SessionStartOwner cancellation ownership. No additional
production rewrite was required by those inspected paths.

The pool's documented limitations remain: required snapshots may allocate
beyond the idle reserve; the current protocol authenticates neither sender nor
session identity for a same-size returned buffer. The numeric credit proves
capacity, not provenance. These tests do not establish browser Worker behavior,
physical device behavior or all possible reentrant host integrations.

## Reproduce

Run direct tools from the repository root so asset-generation hooks do not run:

```sh
NODE_OPTIONS=--max-old-space-size=640 node node_modules/vitest/vitest.mjs run tests/engine-clock-transfer-integration.test.ts tests/frame-buffer-pool.test.ts tests/recording-transport.test.ts tests/input-pump.test.ts

NODE_OPTIONS=--max-old-space-size=640 node node_modules/vitest/vitest.mjs run tests/circuit-frame-transport.test.ts tests/open-world-worker-frame-pool.test.ts

NODE_OPTIONS=--max-old-space-size=640 node node_modules/eslint/bin/eslint.js src/workers/frame-buffer-pool.ts tests/engine-clock-transfer-integration.test.ts
```

No npm hooks, full-project compiler, model generators, commits or remote branch
updates were run by this review.
