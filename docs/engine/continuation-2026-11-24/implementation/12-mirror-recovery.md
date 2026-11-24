# Agent 12 — desktop mirror transaction recovery

Date: 2026-11-24. Scope: persistence infrastructure only.

## Outcome and changed files

Fixed the audited false in-sync cases: a failed earlier key cannot be hidden by later revisions, and a successful backup cannot certify a failed primary. Restart recovery is based on complete native write prefixes and, for older bridges, verified contents.

Changed only:
- src/storage/desktop-mirror.ts
- src/desktop/bridge.ts
- desktop/src/save-mirror.cjs
- desktop/preload.cjs
- desktop/main.cjs (save-related import, routing helper, IPC registration)
- tests/desktop-mirror-recovery.test.ts (new)

No SaveStore changes, package changes, Git commits/ref writes, authored environment, model, character, or asset changes. Native tests used mkdtemp directories with cleanup; actual player files were never opened.

## Design

### Complete transaction prefixes

The optional saves.commit(entries, revision, previousRevision) IPC carries the entire committed batch. Main-process code validates and encodes every value across both target files before installing any changes. It accepts a batch only when previousRevision names the current complete state; stale or out-of-order requests cannot overwrite newer data. Aborted IndexedDB transactions may leave numeric gaps without requiring fake commits.

The renderer sends one batch at a time. Pending changes coalesce by key to the latest value and revision. The pending map is capped at 256 distinct keys; attempting a 257th clears it and blocks further incremental sends until reconciliation. A rejected/throwing batch has the same effect. This bounds retained slots to one in-flight batch of at most 256 keys plus at most 256 pending keys; it is not a byte bound because individual supported values can be large. Repeated writes to one key do not accumulate transaction objects.

The durable local revision and native complete-prefix metadata survive restart. A failed prefix is not advanced by later incremental writes; reconciliation re-seeds the authoritative IndexedDB snapshot. A lost acknowledgement after a completely accepted native batch remains safe.

### Profile and ghost files

The profile envelope contains a completion certificate naming its revision and the exact ghost-file revision and encoded checksum. A separate checksum binds that certificate to the profile revision and entries checksum. A crash after only one file flushes, or recovery of an older ghost backup, invalidates completeness. With intact local data, reconciliation re-seeds both files.

Version-1 envelopes and their existing codec remain readable. Primary/.bak/.tmp ordering, quarantine, and healing are preserved. Ordinary profile writes update the small profile file and certificate without rewriting ghosts. Whole-batch encoding prevents publication of a valid earlier key when a later value is unsupported.

An absent certificate identifies a historical envelope, while explicit incomplete state is distinguishable. Newer readable legacy/cloud files retain restoration precedence and are certified after restoring, including local-only recovery keys. Unbatched legacy writes explicitly invalidate certification.

### Older bridges and seeding

The existing put/seed API remains. On a bridge without complete transaction support, equal revisions also require recursive equality of codec-supported values: typed-array/DataView bytes, ArrayBuffer, Map, Set, dates including invalid dates, bigint, undefined, NaN, infinities, negative zero, arrays, and objects. This repairs historical equal-counter corruption as well as backup/primary failures.

All legacy key calls settle before another transaction or recovery seed runs. Synchronous throws are captured without leaving other promises unobserved. A full reseed reserves its revision in IndexedDB before IPC; a partial legacy seed or lost reply therefore cannot make its file appear newer than the complete local source on restart. A false seed acknowledgement is reported as failure.

## Verification

After restoring the executor and reconstructing the saved source, all six relevant suites passed: 139/139 tests in 4.57 seconds.

| Suite | Passed |
| --- | ---: |
| desktop-mirror-recovery.test.ts | 30 |
| desktop-mirror-consistency.test.ts | 22 |
| engine-persistence-integration.test.ts | 13 |
| desktop-shell.test.ts | 21 |
| steam-integration.test.ts | 18 |
| save-store-lifecycle.test.ts | 35 |

Command:
```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run --pool=threads --maxWorkers=1 --no-file-parallelism tests/desktop-mirror-recovery.test.ts tests/desktop-mirror-consistency.test.ts tests/engine-persistence-integration.test.ts tests/desktop-shell.test.ts tests/steam-integration.test.ts tests/save-store-lifecycle.test.ts
```

Targeted ESLint passed for src/storage/desktop-mirror.ts, src/desktop/bridge.ts, and tests/desktop-mirror-recovery.test.ts under the same shared lock and 512 MB heap. ESLint initially found an intentionally sparse array literal in one equality fixture; it was replaced with a constructed array containing the same hole. The focused 30-case suite passed again after that fixture-only change (284 ms total).

Node syntax checks passed for desktop/main.cjs, desktop/preload.cjs, and desktop/src/save-mirror.cjs. Prettier parsed/formatted the changed TS, preload, native module, and test file.

Focused cases exercise synchronous/asynchronous rejection; historical masking; backup/primary failures; aborted revision gaps; stale/out-of-order requests; lost acknowledgements; both split-file crash orders; ghost backup recovery; certificate corruption; newer legacy/cloud migration; absent IndexedDB; atomic codec validation; profile-only ghost-write avoidance; a 1,000-write coalesced burst; overflow of the 256-key pending bound; delayed legacy keys; supported-value equality/differences; false seed acknowledgements; and partially accepted legacy seeds.

Earlier broader tests/lint were resource-killed with exit 137 in the executor that was subsequently lost. Those failed attempts are superseded by the explicit passing checks above. No full tsc, npm hooks, native Electron end-to-end execution, or performance/FPS claims.

## Recovery policy and limits

Intact IndexedDB is required to reconstruct missing committed values. When IndexedDB is absent and the files are incomplete, the implementation preserves existing recovery behavior: restore every readable current file value, then certify that recovered local snapshot. It does not claim those surviving values necessarily came from the same original transaction.

Selecting a matching complete older profile/ghost pair from .bak/.tmp files would be a separate recovery-policy change. A proposed patch for that refinement failed before its first file read during executor loss; it was never applied. The root agent explicitly agreed to leave that refinement out of this change and retain the tested salvage policy.

The replacement executor was restored from the repository; source was reconstructed from displayed file contents and exact successful patch history, with formatting differences normalized. All 30 new tests and the 109 existing tests then passed in that restored checkout. Recovery blobs were preserved in GitHub without agent-created commits or ref updates:
- Original tested-source reconstruction JSON: f4bcd6fa30e913e73e022fb2dbac187c7deb954b
- Initial outage-time report: 48f437bd9c5b045fd265cc9c67ee2cad931501c4

The current checkout additionally contains the fixture-only lint correction described above. This final report is saved at /engine-work-4e0075ccccb3/reports/12-mirror-recovery.md.
