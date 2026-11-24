# Agent 06 — shared rendering/resource audit

Date: 2026-11-24. Wave: NEW60 continuation, wave 1.

## Scope and result

Read-only audit of shared construction, preparation, lazy-data, settings-transition, frame pacing, GPU timer/fence and capture infrastructure. Compared findings against the existing engine development/resource reports and relevant existing tests. Two new, independently repairable defects reproduced by importing current production modules in Node. No production files, tests, dependencies or Git state were changed; this report is the only written artifact. No full-project TypeScript run, browser run or hardware performance claim.

## R06-1 — BuildQueue can construct resources after cancellation and report false readiness

**Priority:** P1 lifecycle correctness. **Repair owner:** `src/rendering/build-queue.ts` only, with a dedicated queue regression test file or additions to `tests/build-queue.test.ts`.

### Evidence

`BuildQueue.run()` checks `cancelled()` at lines 82–85, invokes the externally supplied `progress()` at line 89, then rechecks cancellation only if the budget triggers an awaited yield (lines 90–98). When the current slice has budget remaining, a progress callback that synchronously cancels/disposes its owner is followed immediately by `this.execute(task, now)` at line 99. After the final task, there is no terminal cancellation check before setting `complete = true` and publishing `Scene ready` (lines 101–103).

Direct reproduction against the current module:

- Two tasks, a stable clock of zero and a resolved yield callback.
- The progress callback sets the cancellation flag when `completed === 1`.
- Actual result: both task callbacks run, `run()` resolves `true`, `ready === true`, `statistics.cancelled === false`, and the last progress event is `Scene ready`.
- A second reproduction with a single task that sets the cancellation flag also returns `true` and sets `ready === true`.

Exact first output:

```json
{"case":"progress cancellation","result":true,"work":["first","second"],"reports":["first","cancelled second","Scene ready"],"ready":true,"statistics":{"tasks":2,"yields":1,"workMilliseconds":0,"maximumTaskMilliseconds":0,"cancelled":false}}
```

This violates the queue's existing cancellation contract and permits a resource constructor to run after an externally invoked callback ends ownership. It also records false readiness at the final boundary. Existing `tests/build-queue.test.ts` exercises cancellation before work and during an awaited yield, but not cancellation inside progress or final work. Previous renderer-lifetime fixes do not close this helper's callback boundary.

### Recommended repair

Recheck cancellation after progress reporting, before executing each task, and before committing completion. Preserve stable priorities, existing cooperative budget behavior, timing counts for work actually performed, and the unconditional release of queued callbacks in `finally`. Cancellation must leave `ready` false and set `statistics.cancelled` true.

### Acceptance

1. Cancellation inside the second task's pending progress callback, with no intervening yield: only the first task executes; result false; ready false; no `Scene ready` report.
2. Cancellation inside the last task: result false and no successful readiness publication.
3. Initially cancelled empty queue also remains cancelled instead of publishing ready.
4. Existing synchronous/async ordering, task failure, timing, budget and before/after-yield cases retain their behavior.
5. Repeated small cancelled queues release remaining task references. This is a lifecycle assertion; do not claim a measured frame-rate improvement.

## R06-2 — Whole-frame GpuTimer instrumentation failures can abort frames and retain invalid active ownership

**Priority:** P1 availability / P2 diagnostics lifecycle. **Repair owner:** `src/rendering/gpu-timer.ts` only, with a separate timer regression test scope. No renderer draw/content changes are needed.

### Evidence

The whole-frame timer is distinct from the previously repaired optional per-pass timer in `src/rendering/ultra/pass-ledger.ts`.

In `GpuTimer.begin()`:

- GL extension/status/result/deletion/allocation/start operations have no instrumentation failure containment (lines 42–63).
- `current` is assigned at line 62 before `beginQuery()` at line 63. If beginning the query throws, ownership remains in `current`.
- Later `begin()` calls stop at line 46 because `current` is still non-null, even after the fault has cleared.
- `dispose()` subsequently calls `endQuery()` for that query although its begin never completed.

Direct reproduction used the current GpuTimer with a GL double whose first `beginQuery()` throws. The first call threw `optional instrumentation failed`; after clearing that fault, a second `begin()` allocated no replacement query and deleted nothing. Disposal then ended and deleted the never-started query:

```json
{"case":"failed begin retains current","thrown":"optional instrumentation failed","allocated":1,"deleted":[],"ends":0}
{"case":"dispose attempts end for query that never began","allocated":1,"deleted":[1],"ends":1}
```

The rendering integration increases the impact: `src/rendering/renderer.ts:2666` calls `gpuTimer.begin()` before the rendering `try`, so a timer-only fault skips the frame. `gpuTimer.end()` is called inside the renderer's `finally` at line 2920; a thrown end or disjoint cleanup fault can replace the actual rendering exception and prevent the subsequent `drawLedger.end()` call. In `GpuTimer.end():69–71`, a thrown `endQuery()` also retains `current`.

Current `tests/gpu-lifecycle.test.ts` checks exceptions during terminal disposal, but does not cover these live begin/end fault paths. The prior development report's fault-isolated optional instrumentation repair concerns per-pass timing, not this whole-frame implementation.

### Recommended repair

Keep optional timer errors from escaping live `begin()` and `end()` calls; revoke active ownership before fallible external operations and attempt bounded cleanup of partial/current/pending queries. Either disable instrumentation after a fault or recover on a later frame, with an explicit bounded policy. Invalid or failed samples must remain null and must not increment `sampleSequence`. Retain existing public terminal-disposal behavior unless deliberately specified by regression tests.

### Acceptance

1. Fault injection at extension lookup, status/readback, allocation, begin, end and live query deletion never suppresses a surrounding render callback or masks its original exception.
2. A failed query begin cannot leave an active query that blocks later work; allocated queries are retired at most once, with no end call for a query known not to have begun.
3. An end failure clears local active ownership and does not accumulate queries under repeated frames.
4. After a live instrumentation fault, rendering accounting still completes; a representative frame wrapper with its own thrown sentinel retains that exact sentinel.
5. Existing four-query bound, numeric validity, disjoint/lost-context handling, sample sequencing, idempotent disposal and cleanup-failure tests remain valid.

## Commands and limits

Read relevant files using `rg`, `cat`, `sed` and `nl`. Ran one inline Node reproduction with `node --experimental-transform-types --input-type=module`; imports were only `src/rendering/build-queue.ts` and `src/rendering/gpu-timer.ts`. The observed outputs above came from that execution. No permanent test/reproduction source was created. These are deterministic controlled-callback/GL-double findings; they do not establish the frequency of real driver exceptions or quantify physical GPU performance.
