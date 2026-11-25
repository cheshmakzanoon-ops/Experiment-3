# W07F — Native desktop revision recovery

Assignment 42/60, wave 7. This assignment adds two browser acceptance cases and
their fixture. It changes no production code or existing test.

## Source and decision

The companion storage change is published at
[e2d1fec2ff3b38a2cf962e9974cfe0622259823b](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/e2d1fec2ff3b38a2cf962e9974cfe0622259823b).
The candidate originally reviewed for this assignment is tree
0b15fbd9e33b7f9ed45e4897d8811c619eeda2d1, with production blobs
c0199dcabd76d50b0e417695f4d77f77c1c6bf3d for SaveStore and
f19a3e7d066b7b768184e23f918dcfbc760fe461 for DesktopMirror.

The [W07A report](w07a-save-recovery.md) documents the defects and implementation.
Its sixteen unit cases control IndexedDB request delivery while exercising the
real desktop mirror classes. This assignment closes the native transaction
composition gap for two specific recovery sequences.

The authored tests are
[engine-native-desktop-recovery.spec.ts](../../../e2e/engine-native-desktop-recovery.spec.ts)
and
[its browser fixture](../../../e2e/fixtures/engine-native-desktop-recovery.ts).

**Execution remains pending the coordinator's hosted gate.** Local execution is
unavailable. No new TypeScript, Playwright, Electron, filesystem-crash or
performance pass is claimed here. All numeric values below are encoded
acceptance expectations until that gate runs.

## Actual and substituted boundaries

Each owner runs the actual SaveStore and DesktopMirror in a separate Chromium
page. Pages share one origin and browser context, so they access one real
IndexedDB database through independent native connections. The fixture observes
the actual database name, version, object-store list, connection object and
document identity.

A Playwright binding forwards the saves API to the actual production
SaveMirror and saveMirrorService, loaded from
[desktop/src/save-mirror.cjs](../../../desktop/src/save-mirror.cjs).
That service uses ordinary Node filesystem operations in a unique temporary
directory. Flush and restart use its public API and fresh production loaders;
the test does not fabricate file contents, checksums or completion certificates.

The binding is an **explicit test bridge**. It is not Electron preload, Electron
IPC, an Electron application window or Steam Cloud. This test establishes
browser storage plus file-service composition under that bridge, not full
desktop-shell acceptance.

The fixture forwards native IDB transaction, get and put calls unchanged. It
does not replace requests, scheduling, the clone algorithm, completion events,
clocks, the updater, revision allocation or the native file service's predecessor
checks. No private mirror state is read or changed.

Bridge promises are tracked at the external call boundary. After they settle,
a MessageChannel task lets the production mirror's derived promise chain finish
before an observation. No fixed sleep is used to infer transaction completion or
to advance storage work.

## Case 1: independent owners and a returning writer

Two pages establish separate save owners at the same empty revision before
either writes. Their initialization is sequential, deliberately avoiding the
separate unresolved problem of simultaneous full reconciliation.

The sequence uses all three public write forms:

| Operation | Required persisted revision | Required file-service behavior |
| --- | --- | --- |
| A writes career data | 1 | Accept A's complete batch from predecessor 0 |
| B updates ghost data | 2 | Send no incremental batch after observing A's foreign revision |
| A writes career with backup | 3 | Send no later batch that could conceal B's intervening ghost |
| Fresh owner reconciles | 4 | Seed career, recovery backup and ghost together |
| Recovered owner updates settings | 5 | Resume incremental commit from complete predecessor 4 |

Each changed write must use exactly one native readwrite transaction. Its data
keys and revision key are observed in that same transaction. The revision read
must report the preceding committed value, the revision put must report the
new value, and the complete event must precede the public promise's resolution.

Before fresh recovery, the service must remain a complete but older revision 1
containing only A's first career value. The test flushes and recreates both
production mirror loaders from real files and verifies that this older prefix
survives restart accurately. It does not call an incomplete prefix up to date.

The fresh browser owner must recover every locally committed value, including
the ghost split into the separate ghost file and the recovery backup created by
writeWithBackup. After another healthy write, a second file restart must load
a complete profile revision 5 linked to ghost revision 4. Both primary files must
exist, their production loaders must read primary sources, and no transient
.tmp file may remain after successful flush.

The returning A operation is essential. Unique local revisions alone would not
prevent A from certifying a later batch while omitting B. The test requires that
only A's first batch is sent before complete recovery.

## Case 2: failed full seed followed by a partial update

A browser-only owner first persists career and settings using ordinary
SaveStore.write calls. It has no desktop bridge and creates no desktop revision
request or mirror call. This represents existing local data before desktop
mirroring starts.

A new page opens a desktop owner over that native database. The test bridge
returns false for exactly the first full seed, before invoking the native
service. This is an explicit injected refusal, not a simulated filesystem crash
or a claim that the native service itself returned false.

The full-seed reservation must persist revision 1 locally. A later real update
to settings must persist revision 2 but send no incremental commit. Flushing
and reopening the file service must still produce its true empty revision 0;
the partial update must not create a complete certificate omitting career data.

A fresh owner then seeds revision 3 with both career and the newer settings.
Its subsequent writeWithBackup must commit revision 4 from predecessor 3,
preserving the new settings as the recovery copy. Reopening real files must
recover all three values and a valid complete certificate.

## Evidence and cleanup

Each case attaches native-desktop-recovery.json with document identities,
native transaction observations, local snapshots, every test-bridge call,
file restart results, cleanup receipts and page errors. Failed cases retain
the observations completed before the failure.

The transaction observer records only calls and events; it does not use a
private transaction-state substitute. Promise settlement is asserted after the
actual complete event. Every owner closes its observed native database
connection during cleanup, restores the original IDB methods and desktop
property, and requires no outstanding bridge promise or unhandled rejection.

Temporary native files are removed after evidence attachment. The native
service's public flush retires its debounce timers before directory removal.
No application save directory or existing user data is used.

## Limits

These cases do not establish concurrent full reconciliation with intervening
writes, arbitrary Electron IPC failures, crash timing between profile and ghost
file writes, cross-browser behavior or Steam Cloud synchronization. Existing
desktop crash-recovery tests cover separate file interruption cases. W07A
explicitly retains simultaneous reconciliation as a remaining architecture
boundary.

The current application ordinarily creates one shared SaveStore and one desktop
window. The independent-owner case exercises the reusable storage/recovery API;
it does not establish that normal gameplay routinely creates those owners.

No model, character, animation, environment, renderer, main entry, protocol,
offroad module, vehicle data, native IPC schema, file format or database version
is changed by this assignment.

## Reproduction

The existing focused workflow selects the new native spec through its
engine-native-*.spec.ts glob. A targeted command is:

~~~sh
npx playwright test e2e/engine-native-desktop-recovery.spec.ts --workers=1 --retries=0
~~~

Use the coordinator's accepted source SHA, compiler result and exact hosted
native result when describing these cases as passed.
