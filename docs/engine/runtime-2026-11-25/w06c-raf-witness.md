# W06C — Native rAF ownership witness

## Evidence and diagnosis

Source reviewed: `b3b8ec09183734287b71406f8894d07c91eb48c9`.

The decoded logs for [workflow run 45628545692, job 139255184399](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45628545692/job/139255184399) show checkout of that source and a failure at `e2e/engine-native-device-ownership.spec.ts:178` on 2026-11-25 at 14:03:09 UTC. The failing owner comparison had:

| Counter | Observed |
| --- | ---: |
| `duplicateTimestamps` | 1 |
| `maxPending` | 1 |
| `pending` | 0 |
| `listeners` | 0 |
| `released` | true |
| `scheduledAfterRelease` | 0 |
| `deliveredAfterRelease` | 0 |

The fixture incremented `duplicateTimestamps` whenever an owner's current callback argument equalled its preceding callback argument. It then treated any such equality as duplicate ownership of a native frame. That inference is the concrete defect addressed here: a timestamp number is not a unique callback-batch identifier.

The logs do not contain the earlier collision's two frame identities. They cannot establish whether browser clock coarsening, reused rendering timestamps, or another browser mechanism produced the equal numbers. This change does not claim a confirmed browser-specific cause, label the failure as flakiness, or prove that the old run had no production defect. It supplies the independent observation the old assertion lacked. The uploaded evidence ZIP, artifact `15029393700`, was identified in the job logs but was not unpacked in this environment.

### Platform contract

[HTML's animation-frame algorithm](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#animation-frames) stores callbacks in an ordered map, snapshots its handles, removes each selected callback, and invokes it with the batch's timestamp. A callback registered during that iteration is outside the snapshot. Equal arguments therefore follow within a batch, but the algorithm does not assign those numbers as unique batch identities.

[HTML's rendering steps](https://html.spec.whatwg.org/multipage/webappapis.html#update-the-rendering) obtain the callback argument through relative high resolution time. [High Resolution Time's coarsening algorithm](https://www.w3.org/TR/hr-time-3/#dfn-coarsen-time) permits implementation-defined coarser resolution and jitter; its [monotonic clock](https://www.w3.org/TR/hr-time-3/#dfn-monotonic-clock) does not decrease. These contracts do not imply strict numerical increase for every successive exposed callback timestamp.

### Production ownership review

Read-only review covered `MenuGamepad` in `src/ui/menu-gamepad.ts` and `CreditsGamepad` in `src/ui/credits.ts`:

- Both reject scheduling while disposed, inactive, or already holding a pending handle. A generation check rejects obsolete callbacks.
- Both clear the consumed handle before polling. Menu polling schedules one successor at entry; credits polling schedules through its applicable exit paths.
- Disposal invalidates the generation, cancels a pending handle, clears it, and removes the respective eight or six listeners.
- The reentrant credits replacement disposes the old owner; its later scheduling guard cannot rearm it.

No reachable double-scheduling defect was identified in the exercised paths from this source review. That conclusion is limited to inspection, rather than a new runtime result.

The two production blobs also match the earlier `acd525f` source exactly:

| Production file | Blob at both sources |
| --- | --- |
| `src/ui/menu-gamepad.ts` | `045966e66acf9cae17deff69a7d4fb3b47616f9b` |
| `src/ui/credits.ts` | `5e730074f136460c08cdd1875ff8ef8c2165a91a` |

The earlier 47-native-test result was supplied in the assignment; this work independently verified the matching source blobs, not that earlier execution.

## Replacement witness

The fixture starts one native rAF sentinel before scheduling any monitored owner. On each native delivery, the sentinel increments a serial and schedules its successor before any monitored owner can schedule a continuation. Ordered callback snapshots preserve this relation for subsequent batches. Here, a “frame” means one run of this document's native rAF callback list, not proof of a compositor presentation.

Every production request, cancellation, and timestamp is still forwarded unchanged. The sentinel uses the captured native APIs directly; it is not charged to a production owner and does not coalesce, suppress, retry, or manually deliver an owner request.

Each owner now reports:

- `duplicateFrames`: repeated delivery for that owner under one sentinel serial.
- `unwitnessedDeliveries`: delivery before the first sentinel or after it has stopped.
- `timestampMismatches`: an owner argument that differs from the sentinel's argument in the same batch.
- The existing `duplicateTimestamps` and `lastTimestamp`, retained as diagnostics.
- `lastFrame` and `timestampCollisions`, including the actual timestamp and previous/current serials, so a future collision can be classified from evidence.

Both native tests require zero duplicate frames and zero integrity failures. They also require at least one delivered callback per production owner and reconcile `scheduled = delivered + cancelled` after release. All existing input, focus, scrolling, submitter, modal replacement, reentrant replacement, pending-count, listener-count, release, late-input, and repeated-disposal assertions remain.

The sentinel is cancelled when all owners are disposed. The fixture's existing native frame waits continue after disposal; an unexpected late owner callback still increments `deliveredAfterRelease` and fails witness integrity. Stopping the sentinel also keeps repeated-disposal snapshots stable. Final API-restoration assertions now include a stopped sentinel with no pending request.

## Native negative control

Startup queues two real, synchronous `window.requestAnimationFrame` requests through the same forwarding wrapper under `raf-witness-negative-control`. The diagnostic callbacks do not call the production owners. They release their owner after the second delivery.

Before either scenario proceeds, the test requires this separate `rafControl` record to show exactly two scheduled/delivered callbacks, `maxPending: 2`, `duplicateFrames: 1`, and `duplicateTimestamps: 1`, with zero integrity failures, no pending work, no listeners, and a released owner. This establishes that the observer can detect a genuine duplicate in a native batch, rather than accepting an always-zero detector. Only that named diagnostic owner is separated from the production `owners` acceptance set. Early disposal also cancels either control request if still pending.

## Focused tests and execution status

Added `tests/engine-raf-witness.test.ts` with an ordered queue model for four observer checks:

1. Two different callback-list snapshots with an identical numeric timestamp retain the collision but report zero duplicate frames.
2. Two deliveries for one owner in a batch report a duplicate even with another owner interleaved.
3. Delivery before the sentinel and a changed timestamp fail independent integrity counters.
4. Repeated stop cancels once, a retained stale sentinel cannot rearm, and late owner delivery is unwitnessed.

The model tests check observer classification; they do not claim native-browser behavior. The Playwright negative control exercises the actual browser separately. No browser clock override, timeout increase, retry, or production scheduling change was introduced.

Local execution was unavailable. No new TypeScript, lint, Vitest, Playwright, or hosted-CI pass is claimed. Root review and actual hosted validation are required, including the focused witness tests and both `engine-native-device-ownership.spec.ts` scenarios.

## Change boundary

Only these owned paths are included in the proposed unreferenced tree:

- `e2e/engine-native-device-ownership.spec.ts`
- `e2e/fixtures/engine-native-device-ownership.ts`
- `tests/engine-raf-witness.test.ts`
- `docs/engine/runtime-2026-11-25/w06c-raf-witness.md`

Production gamepad sources and protected assets, rendering, main, protocol, off-road, and model files are unchanged. The tree has no base, commit, or ref update.
