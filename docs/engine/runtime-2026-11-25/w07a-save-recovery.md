# W07A — Desktop revision ownership and recovery

## Scope and source

Assignment 37 of 60, wave 7. Reviewed engine checkpoint `c482ad9ce9fdef02660e4880a027d83326c840c4`.

Owned production paths are `src/storage/data.ts` and `src/storage/desktop-mirror.ts`. The coordinator also authorized narrow request-delivery updates in `tests/engine-save-atomic-update.test.ts` and `tests/save-store-lifecycle.test.ts`. The new regression is `tests/engine-desktop-revision-ownership.test.ts`.

The desktop native service, bridge, main entry, and application entry were read only. No rendering, model, character, animation, environment, authored asset, vehicle data, protocol or offroad source changed. This candidate has no commit or branch mutation; the coordinator owns integration.

## Confirmed source-level defects

### Independent owners can falsely share one revision

Each `SaveStore` constructs its own `DesktopMirror`. Before this change, `stamp()` incremented that mirror's private counter without reading the revision held by the write transaction. Two owners that had reconciled at revision 6 could therefore both commit different IndexedDB updates stamped 7.

The actual native `saveMirrorService.commit` requires a complete predecessor with an exact matching revision. It rejects the second owner's stale predecessor. However, `DesktopMirror.reconcile` trusts a native `complete: true` envelope when its revision equals local storage. With both copies marked 7, that equality can hide the second owner's missing data.

Unique revisions alone are insufficient. If the original owner subsequently appends another delta using its still-valid native predecessor, the native service accepts that newer revision while still omitting the other owner's intervening write. The regression explicitly covers this returning-owner sequence.

These conclusions come from the production implementation and a deterministic regression design, not an executed new runtime result. The native contract is read from [desktop/src/save-mirror.cjs at the inspected checkpoint](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/c482ad9ce9fdef02660e4880a027d83326c840c4/desktop/src/save-mirror.cjs).

### A failed full seed can be concealed by a later delta

A second case affects recovery even with one owner. If local data exists but the native mirror is empty, an initial full seed may fail. The old reconciliation catch returned a failure report but left incremental sending enabled. Its accepted predecessor remained zero, matching the empty native service. A later single-key batch could therefore create a complete certificate that omitted the local snapshot whose seed failed.

The new regression uses the actual native service, rejects the initial seed, attempts another local write, then retries complete reconciliation and verifies incremental sending resumes only afterwards.

## Implementation

### Reserve under the existing transaction lock

Every changed desktop `write`, `writeWithBackup` and `update` now reads `REVISION_KEY` within its existing IndexedDB readwrite transaction. A private `SaveStore` helper handles that request and invokes the synchronous stamp method from its success callback.

The reserved revision is greater than both the transaction's persisted value and the owner's in-memory high-water mark. IndexedDB serialization therefore provides the shared ordering; no wall-clock counter, cross-document message, extra transaction or bridge/schema change is introduced.

The updater remains synchronous. Returning its original stored reference still issues no put, no revision read, no revision reservation and no mirror notification. Browser-only stores return from the helper before issuing any extra request.

A failed revision read, synchronous stamp exception, or exhausted safe-integer counter aborts the existing transaction, including any primary and backup writes already queued. Mirroring and the caller's successful settlement remain tied to transaction completion.

### Separate reservations from known committed local state

`DesktopMirror` tracks a committed local revision separately from its reservation high-water mark. Stamp does not advance the committed value. `written()` updates it after commit; completed seed/restore transactions and observed reconciliation state establish it during recovery.

If the transaction sees a persisted revision that differs from this owner's known committed revision, incremental mirroring is blocked and queued deltas are released. Local writes still persist with increasing revisions. A complete reseed is required before this owner can certify further native deltas.

This distinction matters after an abort: an unused reserved number must not make a foreign committed write with that same number look owned. The regression includes that exact collision.

The optional direct-call default on `DesktopMirror.stamp` retains existing single-owner helper callers. Production `SaveStore` always supplies the revision read from its transaction; an absent value is passed explicitly as zero. The production path does not use the compatibility default to skip ownership verification.

### Fail closed during recovery

The reconciliation catch now marks the mirror blocked and clears pending deltas. The existing successful reconciliation paths clear that state. This preserves the complete-prefix rule after a failed full seed or restore.

The common revision allocator rejects `Number.MAX_SAFE_INTEGER` before adding one. It is used for stamps and full-seed reservations. A stamp failure aborts the caller's transaction; a seed failure returns the existing failed reconciliation report without publishing an invalid counter.

## Expected ownership trace

The regression starts both owners in sync at revision 6.

| Operation | Old local revision | Candidate local revision | Candidate native state |
| --- | --- | --- | --- |
| A writes career | 7 | 7 | Accept A's complete batch at 7 |
| B writes ghost data | 7 again | 8 | Block B's incremental batch |
| A writes settings | 8 | 9 | Block A's batch because B advanced local storage |
| Fresh complete reconciliation | Could incorrectly trust equality after A's later batch | 10 | Seed career, ghost and settings together |
| Recovered owner writes again | — | 11 | Resume incremental commit from complete predecessor 10 |

The table describes encoded test expectations. Hosted execution must confirm them before reporting them as passed.

## Regression coverage

The new file contains 16 cases:

- Returning-owner A→B→A sequence with modern and legacy bridges, followed by real-file restart and complete recovery.
- A foreign committed revision equal to another owner's aborted reservation.
- Ordinary single-owner aborted gaps and delayed-IPC coalescing, preserving valid incremental behavior.
- Failed full seed, blocked partial delta, successful reseed and subsequent unblocking.
- Full-seed exhaustion at the safe-integer limit.
- For each of `write`, `writeWithBackup` and `update`: transaction-bound revision reservation, commit-only mirroring, revision-read failure rollback and exhaustion rollback.
- An absent persisted revision passed as explicit zero rather than an owner's direct-call default.

The native mirror side uses the actual `SaveMirror` and `saveMirrorService` over temporary files. IndexedDB transaction delivery in these unit tests is controlled explicitly. This is not a claim of native IndexedDB scheduling or Electron application acceptance; the coordinator is arranging separate native coverage.

The two existing unit harnesses now deliver the extra revision-read request for mirrored writes. Their unrelated assertions remain intact. Existing direct-stamp, single-owner, backup, no-op and clone-failure contracts are preserved.

## Reachability and remaining boundary

At the inspected checkpoint, `src/main.ts` creates one shared `SaveStore`. The desktop shell takes a single-instance lock, denies arbitrary new windows and destroys the previous window during a window-mode rebuild. I did not establish that ordinary gameplay routinely triggers simultaneous independent save owners. The defect is at the reusable storage API and owner/recovery boundary, and the fix makes that boundary safer without changing application flow.

This change does **not** make simultaneous reconciliation and writes globally atomic. `MirrorKv.entries()` and the subsequent seed revision reservation remain separate transactions; independent owners reconciling while others write can still observe or reserve around a stale full snapshot. Supporting that broader mode would require a scoped atomic snapshot-and-reservation design and native acceptance. The application currently uses one shared owner, so that redesign is not included here.

A stale native predecessor may still reject an IPC update, and blocked mirroring still requires successful reconciliation. Local IndexedDB remains authoritative. No native file format, IPC shape, browser database version, migration or automatic retry loop changed.

## Validation status

Local execution is unavailable in this session. This assignment performed source inspection, candidate construction and Git-object read-back only. It claims no new Vitest, TypeScript, ESLint, browser, Electron or performance pass.

Suggested hosted gate:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/engine-desktop-revision-ownership.test.ts \
  tests/engine-save-atomic-update.test.ts \
  tests/save-store-lifecycle.test.ts \
  tests/desktop-mirror-consistency.test.ts \
  tests/desktop-mirror-recovery.test.ts \
  tests/desktop-mirror-crash-recovery.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0
node node_modules/typescript/bin/tsc --noEmit
```

Native acceptance should initialize two independent save owners before interleaved writes, verify persisted revisions and blocked deltas, then open a fresh recovery owner and inspect the complete mirror. It should retain the existing real IndexedDB transaction and abort behavior.

## Integration ownership check

Before preparing this tree, main was `7dad59a67875065038807874337e88d0600227a9`. All four existing edited paths still matched their inspected c482ad9 blobs; the new test and report paths were absent. The candidate therefore contains no intervening source overwrite. The coordinator must repeat the expected-head/owned-path check at publication.
