# W04A — Native atomic storage acceptance

## Scope

Added three Playwright cases in `e2e/engine-native-atomic-storage.spec.ts`, with
the production `SaveStore` bundled by
`e2e/fixtures/engine-native-atomic-storage.ts`. No production, existing test,
configuration, model, rendering, animation, or environment files were changed.

These cases extend W02D's controlled transaction tests with browser acceptance
for the IndexedDB scheduler, native structured cloning, and separate database
connections. They do not repeat the full unit failure matrix.

## Native contracts

1. **`native atomic updates across two tabs retain every concurrently queued append`**
   creates two pages in one isolated browser context. Each loads its own module
   graph and production `SaveStore`, and opens its own connection to the same
   origin's `apex-formula` database. A third native connection holds a
   `readwrite` transaction active using successive native read requests. Both
   pages queue twelve atomic appends before that lock is released. The case
   asserts all 24 transactions are already `readwrite`, with zero updater calls
   or settled promises at the barrier. After release, both pages must read the
   same complete set of 24 unique tokens. The updater inputs must cover lengths
   0–23 and results lengths 1–24 exactly, without assuming an inter-tab order.
   Each native update must perform one `put` and complete successfully.

2. **`native atomic updater and clone failures roll back before another connection recovers`**
   opens two production store connections. An updater mutates its native read
   clone and throws while the other connection has an update queued. The
   follower must see the retained committed value and append successfully. An
   uncloneable result then exercises the browser's actual `DataCloneError` and
   abort path. A subsequent update on the original connection must commit and
   be visible to the second connection. The trace requires native `put`
   success, transaction completion, and only then promise resolution. The
   backup and an unrelated saved value must remain intact.

3. **`native atomic identity no-ops commit without a put or an absent-key insertion`**
   returns the same read reference after mutating it, and separately returns
   `undefined` for an absent key. Each operation must complete its native
   transaction before resolving, with zero `put` calls. A second store
   connection must observe the unchanged stored array, and the missing key
   must remain absent from the key list.

The fixture observes `IDBDatabase.transaction`, `IDBObjectStore.put`, and native
completion/abort events while delegating every operation to the original
browser method. It supplies no replacement IndexedDB implementation and does
not alter `SaveStore`. The contention barrier uses a real additional
transaction; it expires after 15 seconds and is released during cleanup.
Database deletion exercises the production version-change connection cleanup.

The spec retains JSON attachments for the queued barrier, completed cross-tab
operations, rollback, and no-op witnesses. The queued witness is attached before
its assertions so a scheduling regression still leaves diagnostic evidence.

## Verification actually performed

- **Passed:** esbuild browser IIFE bundle of the fixture. The metafile contains
  `src/storage/data.ts`; the bundle contains 85 input modules and is 405,229
  bytes in this working tree. The spec also transpiled successfully for Node.
- **Passed:** ESLint on the two added TypeScript files.
- **Passed:** Prettier check on the two added TypeScript files and this report.
- **Passed:** Playwright discovery only: **3 tests in 1 file**. Discovery used
  `--list --reporter=list` and did not launch a browser or start the web server.

Scoped commands, each limited to a 512 MB Node heap:

```sh
NODE_OPTIONS=--max-old-space-size=512 node_modules/.bin/eslint e2e/engine-native-atomic-storage.spec.ts e2e/fixtures/engine-native-atomic-storage.ts
NODE_OPTIONS=--max-old-space-size=512 node_modules/.bin/prettier --check e2e/engine-native-atomic-storage.spec.ts e2e/fixtures/engine-native-atomic-storage.ts docs/engine/runtime-2026-11-25/w04a-native-atomic.md
NODE_OPTIONS=--max-old-space-size=512 node_modules/.bin/playwright test e2e/engine-native-atomic-storage.spec.ts --list --reporter=list
```

## Deferred acceptance and limits

**The three native cases have not been executed locally.** This session's
browser launch is blocked by an OS socket `EPERM`; this worker did not retry
launch or attempt to bypass that restriction. Full TypeScript and actual native
execution remain assigned to the root hosted workflow. Its existing
`e2e/engine-native-*.spec.ts` selection includes the new file automatically.
No dependencies were installed and no compiler-wide, build-wide, or unit-suite
gate was run by this worker.

The cases cover browser IndexedDB and two same-origin tabs in one Chromium
browser context. They do not establish desktop mirror/file durability,
cross-device synchronization, quota exhaustion, process-crash recovery, or
other browsers' behavior. Local static checks are not a native pass claim.
