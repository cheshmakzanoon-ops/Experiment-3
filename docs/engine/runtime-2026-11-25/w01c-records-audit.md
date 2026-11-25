# W01C — persistence, recording and replay audit

Baseline: `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`.
Read the previous engine advancement handoff and the current storage, ghost, flashback, and time-trial paths. No production, test, protected animation, model or asset files changed.

## 1. Concurrent leaderboard offers overwrite earlier valid laps

**Priority:** high data correctness.
**Files:** `src/session/time-trial-records.ts` (`recordLeaderboard`), optionally `src/storage/data.ts` (`SaveStore`).
**Caller:** `GameApp.accept` → `TimeTrialRecords.observe` → `recordLeaderboard` for each valid completed time-trial lap.

Each offer independently reads the board, inserts one lap, then writes a replacement. If two offers read before either replacement commits, both derive from the same old board. The second write deletes the first newly recorded lap. Delayed storage/opening or independent game tabs can expose this; ordinary fast storage reduces its likelihood without making the operation atomic.

**Executed witness:** actual `TimeTrialRecords.recordLeaderboard` with a controlled delayed store and actual `insertLeaderboard`; only the UI lap-time formatter was substituted to avoid Node CSS imports. Offer 45 s and 44 s laps; release both pending reads with the same empty value. Output:

```json
{"readCount":2,"writes":[[45],[44]],"retained":[44],"toasts":["P1 ON THE LOCAL LEADERBOARD · 45","P1 ON THE LOCAL LEADERBOARD · 44"]}
```

**Repair:** serialize the complete read/insert/write operation per key, retaining successful laps across session transitions and continuing after a rejected operation. A queue on one records instance fixes that instance only. To cover separate tabs/SaveStore instances, add an atomic read-modify-write primitive in one IndexedDB readwrite transaction and use it through an optional RecordsHost store capability; a local serial fallback can retain existing test/embed contracts. Keep mirror revision publication and transaction-completion settlement intact.

**Focused verification:** hold the first storage completion, offer multiple laps before releasing it, verify all eligible laps survive and ranks reflect stable ordering; reject one write and verify later writes continue. For an atomic API, native concurrent independent store instances should preserve both entries and aborted transactions must publish neither data nor mirror revision.

## 2. Old record operations can notify the replacement session

**Priority:** medium lifecycle correctness.
**Files:** `src/session/time-trial-records.ts`.

`prepare` reports a failed read before testing `current()`. Ghost-write and leaderboard-write success/failure callbacks never check the session owner. `clear()` only clears recorder/player/trial state. Consequently a departing session can later display a stale failure or PERSONAL BEST / leaderboard message over a different session. Delayed record persistence should still complete; its presentation callback needs the owning generation.

**Executed witness:** start actual `prepare` with a pending read; set `current()` false, call `clear()`, reject the old read, then await preparation. The toast was `Saved ghost unavailable: Error: late failure` even though that session had departed.

**Repair:** increment a records operation/session epoch on clear/prepare and capture it with the host `current` predicate. Check ownership before every presentation side effect and after external callbacks. Retain already accepted save work across epoch changes, while preventing it from updating the current ghost/HUD or toasts. A synchronous event subscriber or toast callback is also an ownership boundary.

**Focused verification:** resolve/reject delayed prepare and saved-lap operations after clear and after replacement prepare; only the active owner's notifications/state may change. Verify accepted old lap writes still persist and a later active session can reload them.

## 3. Equal lap identities report the wrong insertion rank

**Priority:** lower; small deterministic correctness fix.
**File:** `src/storage/leaderboard.ts` (`insertLeaderboard`).

The stable sort keeps an earlier equal-time lap first, but rank is found by the tuple `(lapTime, session, driver)`, which cannot distinguish two equal laps from the same driver/session. Inserting an equal entry after an existing entry returns rank **1** for the new second-place entry. Inserting an eleventh equal entry into ten identical existing entries returns rank **1** although the new stable-tail entry is excluded. The caller interprets nonzero rank as admission.

**Executed witness:** actual `insertLeaderboard` returned `{rank:1,count:2}` for one existing equal entry, and `{rank:1,count:10}` for ten existing equal entries.

**Repair:** calculate the new entry's stable position explicitly after normalization, or keep an internal insertion identity through sorting; persist the existing schema unchanged. Verify equal times, repeated same-session entries and the tenth/eleventh boundary. A name longer than the existing 24-character normalization also mismatches rank lookup, but current live drivers are shorter; this is secondary API coverage rather than a claimed live failure.

## Other inspected boundaries

No additional verified regression was found in the already improved ghost first-passage lookup, telemetry closing-gap validation, flashback input retention, replay read ownership or bounded recording transport. Their previous improvements are not counted as new work. IndexedReplayStore retains crash-orphaned session keys until explicit cleanup; safe reclamation would require distinguishing live tabs from abandoned sessions and was not established by this audit.

## Reproduction boundary

Witnesses ran on Node v24.22.3 with `--experimental-transform-types`, importing actual production classes. A `node:module` load hook substituted only `src/ui/interface.ts`'s `lapTime` export with `String`; storage was intentionally deferred through the published RecordsHost interface. These establish the operation/rank contracts, not browser transaction scheduling, physical I/O latency, or full-game runtime acceptance. No broad tests or dependency installation were run by this worker.
