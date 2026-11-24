# Persistence integration review — 24 November 2026

## Result

The independent wave 9 review found and fixed a desktop save consistency defect
at the boundary between `SaveStore` and `DesktopMirror`. IndexedDB copied a value
when its put request was queued, but the later desktop mirror callback retained
the caller's original object. If that object changed before transaction
completion, the two persisted copies could contain different data under the
same revision number.

The minimal reproduction stored `{ profile: { laps: 1 } }` in IndexedDB but
forwarded `{ profile: { laps: 2 } }` to the desktop bridge after caller mutation.
Seven new regression cases failed against the pre-fix implementation; six other
cases already passed and preserve existing transaction behavior.

## Change and timing contract

The production change is confined to `SaveStore.write` and
`SaveStore.writeWithBackup` in [`data.ts`](../../src/storage/data.ts). When a
desktop mirror is present, the method takes one private structured clone at the
request-enqueue boundary. IndexedDB receives that value, and the post-commit
mirror receives the same private value. Caller mutation and getters cannot
produce different payloads for the same revision.

The snapshot is taken **after the database connection is ready**, at the existing
write boundary. A caller mutation while opening is still reflected in the value
eventually submitted, preserving the prior IndexedDB timing semantics. In the
backup method, the previous saved value is still queued as the recovery copy
before the new primary. A failed private clone aborts that transaction, including
the already queued backup; no revision or mirror update is published.

Browser-only saves continue to rely on IndexedDB's ordinary clone. Desktop saves
pay for one additional private clone and retain that snapshot until completion.
This is a consistency improvement, not a save-speed or memory-reduction claim.
Database names, schemas, keys, backup policy and revision progression are
unchanged.

## Validation

The new [`engine-persistence-integration.test.ts`](../../tests/engine-persistence-integration.test.ts)
uses the actual `SaveStore` and `DesktopMirror`. A controlled transaction adapter
separates request-time cloning from transaction completion; its IPC stand-in
clones at bridge invocation. This exposes the timing difference that caused the
defect without accessing player saves.

The 13 new cases cover both write methods, nested mutable values, mutation while
opening, successive revisions of one reused object, caller getters, clone
failure, transaction abort, backup preservation and the browser-only cloning
path. The existing backup-failure fixture now expects the primary put not to be
reached after the earlier clone rejection. It explicitly checks the one queued
backup value and retains every prior atomicity, error and non-publication check.

The final direct command passed **134 tests in eight files**:

```sh
NODE_OPTIONS=--max-old-space-size=640 node node_modules/vitest/vitest.mjs run \
  tests/engine-persistence-integration.test.ts \
  tests/save-store-lifecycle.test.ts \
  tests/desktop-mirror-consistency.test.ts \
  tests/indexed-replay-store-lifetime.test.ts \
  tests/session-replay-lifecycle.test.ts \
  tests/replay-seek-preparation.test.ts \
  tests/telemetry-export-lifetime.test.ts \
  tests/telemetry-export.test.ts
```

The broader review checked the existing session-specific replay deletion,
transaction completion, flashback page generations, stale read cancellation,
bounded seek ownership and export worker cancellation paths. Their selected
regressions pass, and no additional production changes were required there.
Scoped ESLint and whitespace checks also passed. The coordinator owns the final
combined TypeScript and publication checks.

## Scope and limits

These are controlled transaction and worker integration tests. They do not claim
native Electron IPC, file-system durability, cross-process compare-and-swap,
browser execution or physical-device behavior. The separate native-browser
fixtures and CI receipts must be assessed independently.

No models, characters, authored environments, art, vehicle tuning, dependencies,
or save-schema definitions changed. No asset-generation lifecycle hooks ran.
