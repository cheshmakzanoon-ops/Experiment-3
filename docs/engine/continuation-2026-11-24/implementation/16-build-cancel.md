# Agent 16 — construction queue cancellation boundaries

Date: 2026-11-24. Wave 3. Scope: shared construction scheduling infrastructure.

## Outcome

`BuildQueue.run` now observes cancellation at the externally callable boundaries before yielding, executing a task, or committing readiness. Cancelling inside pending progress can no longer construct the next resource while the slice still has time available. Cancelling inside the final task no longer publishes successful completion.

Owned source/test changes:

- `src/rendering/build-queue.ts`
- `tests/build-queue-cancellation.test.ts` (new)

No authored scene, geometry, model, character, environment, material, track, vehicle configuration, dependency, Git commit, or Git ref was changed by this agent.

## Semantics and implementation

A local cancellation check records `statistics.cancelled` before returning false. It runs around progress, yield, injected clock and task boundaries. The queue keeps its original priority ordering, work timing formula, cooperative slice budget and number of yields on the uncancelled path. There are no extra animation-frame waits and no changes to simulation scheduling.

Readiness commits only after the terminal progress callback returns successfully and cancellation is checked again. The final report still describes all tasks having executed; its callback sees `ready === false` until it returns. A callback that cancels or throws leaves the queue unready. An initially cancelled empty queue returns false, records cancellation, and invokes neither progress nor yield/clock callbacks. A successful empty queue still reports fraction 1 once and becomes ready afterward.

The task-start timestamp is sampled before the final cancellation gate and supplied to the existing executor. This preserves the ordinary clock sampling and elapsed-work calculation while avoiding resource work after an injected clock cancels ownership. Synchronous execution retains its original behavior through the default timestamp argument.

The initial supplied clock read now occurs inside the existing `try/finally`; a thrown clock cannot retain the queued callbacks. Exceptions from progress, yielding, work, completion, clocks and the cancellation predicate remain the original exception rather than being replaced with a cancellation result. `finally` releases remaining task references on success, cancellation and exceptions.

## Verification

All 46 focused tests passed across three suites in 7.95 seconds:

| Suite | Passed |
|---|---:|
| `build-queue-cancellation.test.ts` | 22 |
| `build-queue.test.ts` | 5 |
| `circuit-preparation-lifetime.test.ts` | 19 |

The new cases cover cancellation in first/within-budget pending progress; final/nonfinal work; an outstanding asynchronous yield; initially cancelled and successful empty queues; terminal progress; five injected clock boundaries; exact completed-work statistics; 128 repeated cancellation cycles with released callbacks; and six distinct callback failures that also cancel. Existing ordering, slice cadence, task failures and circuit preparation lifetimes remain passing.

Commands:

```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/prettier --write src/rendering/build-queue.ts tests/build-queue-cancellation.test.ts
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run tests/build-queue-cancellation.test.ts tests/build-queue.test.ts tests/circuit-preparation-lifetime.test.ts --pool=threads --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/eslint src/rendering/build-queue.ts tests/build-queue-cancellation.test.ts
```

Scoped ESLint passed, and both owned files were formatted. No full-project typecheck, browser build, authored-asset generation or physical GPU benchmark was run. This is a cancellation and resource-lifetime repair, not a measured frame-rate improvement.
