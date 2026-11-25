# W01A — Runtime, worker and session audit

Baseline: `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`. Assignment 1/60; production read-only.

Read the preceding advancement handoff, current worker clocks/channels/pools, circuit and Festival workers, session lifetimes/startup, Festival controller, records, replay clock, performance capture and radio arbiter. Previously repaired startup exclusion, BFCache retention, flashback eligibility, worker credits and frame pacing are not counted as new work. No protected source was modified.

## Recommended implementation assignments

| Priority | Finding | Narrow ownership |
| --- | --- | --- |
| Medium, hot path | Race radio copies every car's full packed snapshot to remember nine scalar fields | `src/core/radio.ts`; focused existing/new radio regression |
| Medium, data integrity | Local leaderboard updates have a read/modify/write race; delayed records callbacks outlive their session | `src/session/time-trial-records.ts`; focused records regression |
| Medium, failure recovery | Startup cleanup exceptions suppress the host recovery callback and replace the original failure | `src/session/session-start-owner.ts`; startup ownership regression |
| Lower, cancellation | Cancelling an unresolved module load does not settle the returned startup promise | Same startup-owner assignment, if contract is extended |

## 1. Eliminate the radio's full-frame copy without retaining transferred buffers

`RadioArbiter.observe` stores `this.previous = frame.slice()` on every accepted driving snapshot. The production caller is `GameApp.accept` in `src/main.ts`. Previous-state reads use only car count, safety-car phase, local flag, cumulative penalty, warnings, pit state, laps and fuel; the complete per-car wheel/motion blocks and every opponent are unused.

**Executed probe:** imported the current production class with Node's TypeScript transform and intercepted `Float32Array.prototype.slice` only around 600 ordinary 24-car observations. Result: **600 copies, 19,123,200 bytes**, exactly **31,872 bytes/sample**. At 60 accepted samples/s this is 1,912,320 copied bytes/s, an arithmetic rate rather than a measured runtime/FPS gain. Frame size is `(HEADER + cars * CAR_STRIDE) * 4`, currently `(24 + cars * 331) * 4`.

Retain a fixed compact scalar state and validity marker instead. Preserve the first-observation and changed-field-count semantics, and capture before callers can mutate or recycle the supplied frame. Do not retain the source frame reference; it becomes detached when the host recycles it. Verify identical captions for safety-car transitions, flags, penalties, warnings, pits, final lap and fuel, including in-place reused frames and detached buffers.

The radio also retains every distinct `lastSent` key until session reset. Keys include incrementing yellow-control, penalty and warning sequence numbers. Retire expired cooldown entries while retaining active cooldown semantics. Avoid a speculative cap that silently suppresses valid race-control captions. A timeline rewind needs an explicit policy; the current caller resets radio for a new session but not for every presented timestamp.

## 2. Serialize leaderboard mutations and own asynchronous records callbacks

`TimeTrialRecords.recordLeaderboard` independently starts `store.read(key) -> insertLeaderboard -> store.write(key, board)` for each valid lap. With storage delayed, two laps can read the same prior board and then replace each other's result. `Store.write` serializes individual IndexedDB write transactions, but this does not make the separate reads and writes one atomic operation. A slow or blocked store is enough; the observations themselves do not need to occur in one task.

Give each key a serialized mutation chain (or use a suitable transactional store boundary), preserving legitimate writes after an old session closes and allowing recovery after a failed write. Capture the entry/session/category at enqueue time. Keep new sessions from waiting for unrelated board keys.

Separately, `prepare` emits its storage-error toast before testing `current()`, and ghost/leaderboard completion callbacks show toasts without a lifetime/generation check. `clear()` resets synchronous data but does not invalidate these callbacks. A new session can therefore receive old-session success/error notices. Suppress only stale UI effects; already accepted records should still persist. Exercise two deferred reads/writes, failure followed by a succeeding update, and session replacement before load/save settlement.

This records finding is source-confirmed; a storage race test was not run in this audit. The coordinator was notified so the storage owner can integrate it.

## 3. Preserve startup failure and execute host recovery despite cleanup faults

`SessionStartOwner.start` catches an owned startup failure and calls `this.cancel(); task.failed(); throw error;`. If the adopted session's `dispose()` throws during `cancel`, the recovery callback is skipped and the cleanup exception replaces the original startup failure. `FestivalSession.dispose()` intentionally continues cleanup and then throws its first collected cleanup error, so the contract permits this case. In the real host, `failed()` restores Festival/circuit presentation ownership.

**Executed production-class probe:** `ready()` threw `ready fault`; session `dispose()` threw `cleanup fault`. Observed rejection was **`cleanup fault`**, `failed()` calls **0**, owner session `null`, and starting `false`. Thus ownership is revoked but host recovery is skipped.

Run host recovery even if cleanup fails, and define which error is authoritative without discarding the original startup cause. A focused test should cover ready failure plus disposal failure, ordinary failure, stale-session failure after replacement, and a recovery callback that itself throws. No main or renderer changes are needed.

## 4. Cancelled imports leave their returned operation pending

`SessionStartOwner.start` directly awaits `task.load()`; cancellation revokes the run but does not race the wait against its abort signal. An import that remains pending keeps the returned startup operation pending. Existing tests settle the deferred import after cancellation before awaiting the returned operation, so they do not cover prompt settlement.

**Executed production-class probe:** an unresolved load followed by `cancel()` reported `starting=false`, but the returned promise was still unsettled after a 20 ms task delay. This is a bounded observation, not a claim that actual browser imports usually hang forever.

If addressed, cancel only the owned wait, keep late loader rejection observed, never adopt a stale module/session, and settle cancellation consistently with the existing resolved-on-cancel behavior. This is lower priority than the first three findings.

## Scope and validation limits

Only this report was written. The radio copy-count and two startup-owner probes imported exact production classes; no test suite, browser, whole-game benchmark, install, git mutation, authored asset or animation change was performed. Tile-worker queue ownership is already bounded by the terrain host's live-request accounting; no new queue limit is recommended without evidence that the caller can exceed it. Existing flashback full-history retention is a known architectural limitation rather than a newly discovered defect.
