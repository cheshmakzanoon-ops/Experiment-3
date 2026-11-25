# Wave 8 independent storage and records review

Assignment 43 of 60 · 25 November 2026

## Conclusion

No blocking regression was found in the reviewed candidate. The changes close two specific completeness failures: a returning desktop mirror owner certifying a delta that omits another owner's committed local write, and a failed full seed being concealed by a later incremental native commit. The fix preserves IndexedDB as the source of committed local truth and stops incremental forwarding when an owner cannot establish a complete native predecessor.

This is an independent source review. It does not claim that the candidate compiled, passed Vitest, or passed a native browser acceptance run. Those outcomes must be attached to the actual integrated commit by the coordinating agent.

## Reviewed identities and scope

The comparison baseline is repository commit `92e2dc2ed2f4959011bb84816e90506cefed774d`. Agent 37's candidate is unreferenced tree `0b15fbd9e33b7f9ed45e4897d8811c619eeda2d1`.

| Source | Reviewed identity |
| --- | --- |
| `src/storage/data.ts` | Candidate blob `c0199dcabd76d50b0e417695f4d77f77c1c6bf3d` |
| `src/storage/desktop-mirror.ts` | Candidate blob `f19a3e7d066b7b768184e23f918dcfbc760fe461` |
| `tests/engine-desktop-revision-ownership.test.ts` | Candidate blob `ca565bbb60476c71e346c02b8005af028ebff765` |
| `tests/engine-save-atomic-update.test.ts` | Candidate blob `16b92eaa9021b1075e09440e82274ab0d5e08294` |
| `tests/save-store-lifecycle.test.ts` | Candidate blob `be2e1d20c8c0e39165dea3681412c54d539ab33d` |
| `desktop/src/save-mirror.cjs` | Baseline commit above |
| `src/session/time-trial-records.ts` and `src/storage/leaderboard.ts` | Baseline commit above |
| Desktop consistency, recovery, and crash-recovery suites | Baseline commit above |

The review inspected the actual Node save service, not an assumed IPC contract. It also checked the atomic update callers, fallback queue, accepted lap ownership, and equal-time leaderboard behavior. This assignment changes only this report.

## Transaction and revision boundaries

The three mutation APIs—`write`, `writeWithBackup`, and changed `update`—now read `REVISION_KEY` from the same readwrite transaction that stores their data. The revision callback invokes `DesktopMirror.stamp` and queues the revision put synchronously. There is no intervening await or deferred updater inside an active request event. A revision-read failure, synchronous stamp failure, or exhausted safe-integer counter invokes transaction abort, rolling back already queued profile, backup, or updated-record writes.

The mirror's committed-state notification remains in `tx.oncomplete`. A request success is consequently insufficient to advance the mirror's committed local revision or forward its value. This matters when a later request or transaction commit fails.

The IndexedDB specification supports this ordering: success events allow additional requests in their transaction; overlapping readwrite transactions are ordered; successful commit marks the transaction finished and fires its completion event within the database task. In the same renderer execution context, the completion handler runs before a subsequent transaction's request event can update this mirror. The separate reservation and committed-state counters therefore do not require speculative advancement before local commit. See the primary [transaction lifecycle and scheduling specification](https://w3c.github.io/IndexedDB/#transaction-lifecycle) and [commit algorithm](https://w3c.github.io/IndexedDB/#commit-transaction).

An identity no-op from `SaveStore.update` returns before the data put and revision read. It neither consumes a revision nor forwards a desktop batch. Browser-only stores also avoid the new metadata request. A changed desktop write pays for one additional IndexedDB get; this is a bounded correctness cost, not a measured performance improvement.

The existing synchronous-updater contract remains intact. Thenable results are rejected and their eventual rejection is observed. Updated values have a separate structured clone for native forwarding, so caller mutations of the returned value cannot alter the mirror's pending payload.

## Ownership and abort analysis

Three counters have distinct meanings:

| Counter | Meaning |
| --- | --- |
| `revision` | Highest observed or locally reserved number; gaps are permitted |
| `localRevision` | Last local commit or completed reconciliation known to this owner |
| `acceptedRevision` | Complete native predecessor acknowledged to this owner |

`stamp` compares the transaction's persisted revision with `localRevision`, not with the reservation counter. A mismatch blocks forwarding and releases pending deltas. Allocation then uses the larger of the persisted revision and the owner's high-water mark. `written` advances committed knowledge only after the local transaction completes, including while native forwarding is blocked.

For example, after both owners observe revision 6:

1. Owner A commits revision 7 and forwards a complete native prefix.
2. Owner B sees persisted 7 but knows local 6. Its new revision 8 remains committed locally while its native forwarding is blocked.
3. Owner A returns and sees persisted 8 but knows local 7. Its revision 9 also remains local.
4. A successful full reconciliation seeds all local data at revision 10, then permits incremental revision 11.

The returning-owner check is necessary even though the native service checks its predecessor. Without it, A could submit revision 9 against native predecessor 7 and certify a snapshot that omits B's revision-8 value.

An aborted reservation does not advance `localRevision`. A single owner can therefore skip a reserved number without falsely detecting a foreign commit. Conversely, another owner can commit the same number that was previously reserved and aborted; comparing persisted state against the committed counter still detects that ownership change.

The explicit `request.result ?? 0` argument is appropriate. Missing persisted metadata must mean zero, rather than selecting the helper's optional direct-caller default. Production paths supply actual transaction state; the default exists only for compatible direct single-owner use.

## Native failure and recovery behavior

The actual `saveMirrorService.commit` requires a complete native snapshot, an exact predecessor revision, a strictly increasing safe revision, and a bounded nonempty batch. It validates and encodes both file categories before installing updates. Completion certificates associate profile state with the corresponding ghost checksum and revision. These checks complement the renderer fix but cannot independently discover omitted IndexedDB writes.

The candidate's reconciliation catch now sets `blocked` and clears pending data. If a full seed reserved a local revision but native seeding failed, a later one-key write can no longer turn the incomplete native contents into an apparently complete newer snapshot. Local writes continue, preserving their newer durable revision for recovery.

In-flight IPC is awaited before reconciliation. A foreign-owner detection clears queued deltas but does not invalidate an already sent complete predecessor; its eventual completion cannot drain new data while blocked. IPC rejection or a rejected acknowledgement also blocks forwarding. A successful seed or restore establishes new committed-local and accepted-native boundaries and re-enables draining.

Legacy bridges retain their conservative behavior: whole transaction batches are serialized, every legacy key settles before recovery proceeds, and equal-revision contents are compared during reconciliation. The candidate's foreign-owner and failed-reconciliation blocking applies to legacy forwarding as well. It does not claim that legacy per-key IPC acquires the modern completion certificate.

At `Number.MAX_SAFE_INTEGER`, allocation fails before an invalid revision is written or sent. Failed reservations can leave harmless gaps; neither reuse nor rounding beyond the safe range is introduced.

## Records and leaderboard composition

`TimeTrialRecords` uses the atomic `store.update` API when present. Its compatibility fallback serializes the entire read/transform/write operation per store object and key. A failed operation settles the queue rather than poisoning later laps, and idle cleanup checks ownership before deleting a successor's queue entry.

Ghost updates compare the accepted lap against the value read inside the atomic operation. A slower or equal candidate returns the stored object unchanged, exercising the no-op path. Accepted ghost sectors, samples, options, and store references are captured before application event callbacks can replace the session. Persistence can complete after session replacement while presentation callbacks remain generation guarded.

Leaderboard insertion finds the new entry's actual insertion position after existing equal times. Rank therefore refers to the inserted lap, including duplicate driver/session tuples and truncated driver names. An excluded eleventh equal-time lap returns rank zero; its atomic updater preserves the stored value rather than causing a needless write. The existing board and incoming entry are copied rather than mutated.

## Evidence and remaining boundaries

The new revision-ownership test source contains 16 parameter-expanded cases. They cover modern and legacy A→B→A recovery, aborted-reservation ownership, ordinary aborted gaps with delayed IPC, failed seed recovery, safe-integer exhaustion, each of the three SaveStore write APIs, and missing metadata. Its mirror tests use the actual native save service and temporary files. Its IndexedDB delivery is controlled; that is not equivalent to executing native browser scheduling.

The existing atomic-update harness now delivers the additional queued revision read. The lifecycle harness likewise advances that request before completion. Their assertion changes reflect the new required persisted-revision argument; the independent commit/abort checks remain.

No generic multiwriter reconciliation guarantee is asserted. The application currently uses one shared SaveStore and one desktop window; simultaneous full reconciliation and writes remain outside this change's atomic boundary. Leaderboard and ghost updates are separate keys and may succeed independently. The fallback queue only orders callers sharing its store object. These are acknowledged scope limits, not newly discovered blockers to the two targeted fixes.

The coordinating agent should attach CI results for the integrated source, including the native IndexedDB acceptance work, before describing this candidate as runtime verified. This review required no production change.
