# W02B — accepted record updates and presentation ownership

Implemented the three W01C findings in `src/session/time-trial-records.ts` and
`src/storage/leaderboard.ts`. Added focused public-lifecycle coverage in
`tests/engine-records-transaction-order.test.ts`.

## Behavior

- Leaderboard offers use optional `RecordsHost.store.update(key, updater)`.
  Simple read/write hosts use a module-level WeakMap keyed by the actual store,
  with one serial operation queue per key. Different keys proceed independently;
  both read and write rejection release the queue; idle keys are removed.
- Equal-time entries are inserted after existing equal entries. Rank follows
  this position, including repeated identical driver/session/time tuples, the
  tenth/eleventh boundary, and normalized long driver names. Stored schemas and
  keys are unchanged.
- Clear and prepare revoke the previous presentation generation. Prepare,
  leaderboard and ghost callbacks check their captured generation and the host's
  `current()` predicate. A failure toast or synchronous lap/name callback can
  clear or replace the session without a later stale HUD mutation or message.
- Already accepted save work survives that revocation. Options, leaderboard
  fields and private ghost samples/sectors are captured before external
  callbacks. Mutating the publicly exposed player buffers cannot alter a queued
  ghost save. Ghost updates compare the current valid stored record atomically,
  so an older/slower offer cannot replace the faster compatible ghost.
- Updaters return the original stored reference for no admission/no improvement,
  matching the coordinated SaveStore no-op contract. They return new values for
  writes and do not mutate stored data.

## Verification

- New transaction/ownership suite: **17/17 passed**.
- Related existing suites reported **30/30 Steam leaderboard** and **6/6 records
  board** passes before their combined run lost its worker IPC channel. This
  combined command was unsuccessful overall, not an acceptance pass.
- A separately started existing flashback/recording suite completed **4/4 passed**.
- ESLint for both production files and the new test file passed. Prettier applied
  to these files; `git diff --check` for the assigned paths passed.
- A concurrent full TypeScript process exited **137 without diagnostics**.
  The combined existing-suite run exited 1 with `ERR_IPC_CHANNEL_CLOSED` before
  the remaining ghost suite completed. Neither is reported as a code/test pass;
  root owns the bounded, integrated compiler/test gate after edits settle.

## Boundaries and coordination

The new tests use controlled storage scheduling and the actual GhostRecorder /
TimeTrialRecords path, not native IndexedDB scheduling or full-game rendering.
The fallback coordinates callers sharing the same store object; separate store
objects/tabs require atomic `update`. W02D owns that SaveStore implementation,
native transaction evidence, and the existing integration fake's request-success
repair. Save completion does not force a replacement session to reload its HUD;
a later prepare reads the committed best normally.

No protected files, existing tests, storage implementation, schema definitions,
dependencies or Git state were modified by this worker.
