# W02D — Atomic SaveStore updates

## Change and caller

`SaveStore.update(key, updater)` reads and transforms a value in one `saved`
IndexedDB `readwrite` transaction. The updater runs synchronously inside the
read request's success callback and queues the replacement before returning.
W02B's leaderboard and best-ghost callers can therefore avoid the separate
read/write window that can discard another store instance's accepted lap.

The API returns the updater's result only after transaction completion. Returning
the exact stored reference is a no-op: no `put`, desktop revision stamp, or mirror
publication. Mutating that reference in place is unsupported and does not save
the mutations. Return a new value for a write. An equal fresh object is a write;
returning `undefined` when the key is absent leaves it absent.

Promise and thenable results abort and reject with an explicit `TypeError`.
Their eventual rejection is observed separately to prevent an unhandled
rejection; their eventual value is discarded. Thrown updater errors, request
failures, clone errors, and revision-stamp failures abort the transaction.
Transaction aborts/errors never publish to the mirror, and a failed update does
not prevent a later update using the same connection.

Real writes retain the existing desktop ordering: clone a private snapshot,
write the value and stamp in the same transaction, and publish after commit.
Neither the updater's retained object nor the returned object owns that mirror
snapshot. Browser writes retain IndexedDB's ordinary request-time cloning.
The database name/version and backup behavior are unchanged.

## Focused verification

- `tests/engine-save-atomic-update.test.ts`: **20 passed**. Controlled requests
  exercise synchronous callback timing, one-transaction composition, completion
  ordering, identity no-ops, mirror ownership, rejected asynchronous results
  without unhandled rejections, rollback, and recovery.
- `tests/engine-advancement-records.test.ts`: **2 passed** with the W02B consumers.
  The only fixture change fires read success before committing queued writes;
  existing assertions are retained.
- ESLint passes for the three affected TypeScript files; Prettier applied only
  to the assigned files.

Commands:

```sh
NODE_OPTIONS=--max-old-space-size=512 node_modules/.bin/vitest run tests/engine-save-atomic-update.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
NODE_OPTIONS=--max-old-space-size=512 node_modules/.bin/vitest run tests/engine-advancement-records.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
NODE_OPTIONS=--max-old-space-size=512 node_modules/.bin/eslint src/storage/data.ts tests/engine-save-atomic-update.test.ts tests/engine-advancement-records.test.ts
```

These tests drive IndexedDB boundary events explicitly. They do not establish
native browser scheduling or cross-tab acceptance; that work is assigned to a
later wave. No full-suite or TypeScript-wide gate was run by this worker.
