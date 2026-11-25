# W09A — Repair persistence integration fixture after complete-prefix hardening

Assignment 49/60, wave 9. Review date: 2026-11-25.

## Outcome and execution boundary

This assignment corrects the existing controlled persistence fixture in
[engine-persistence-integration.test.ts](../../../tests/engine-persistence-integration.test.ts).
It does not change production code or relax the new failed-reconciliation
blocking rule.

The candidate preserves all thirteen existing parameter-expanded cases and all
thirty-one existing textual assertions. It adds a successful legacy-load witness
to the two previously failing cases and one negative case requiring a genuinely
failed legacy load to keep subsequent writes local. The authored suite therefore
has fourteen parameter-expanded cases.

**The candidate has not been executed.** Source review and exact GitHub blob
readback are the available checks. Local execution is unavailable; TypeScript,
ESLint, Vitest and native acceptance belong to the coordinator's subsequent
exact-source hosted gate.

## Independently observed failure

I independently fetched [workflow 45641670477](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45641670477)
and its [job 139301674493](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45641670477/job/139301674493).
The workflow identifies source
[e2d1fec2ff3b38a2cf962e9974cfe0622259823b](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/e2d1fec2ff3b38a2cf962e9974cfe0622259823b)
and a failed conclusion. The log reports **1,348 passed and two failed tests in
95 files**, with 94 files passing.

Both failures are the private committed-snapshot case, expanded for
`write` and `writeWithBackup`. Local data still had the expected cloned profile,
but the test could not find the expected desktop forwarding entry at revision 8.
The new sixteen-case desktop revision suite passed in that same run. The
coordinator reports later probe, compiler/build and browser stages skipped after
the failed unit gate; no result from those stages is claimed here.

## Causal trace

The fixture supplies the real SaveStore and DesktopMirror, controlled IndexedDB
requests, and an in-memory legacy bridge. Its initial populated scenario has
profile data and revision 7. The original bridge implemented only `info` and
`put`. Its `info` omitted the modern `complete` field, correctly selecting the
legacy path, but it omitted the mandatory legacy `load` operation.

The actual [reconciliation source](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/src/storage/desktop-mirror.ts)
does not treat equal revision numbers as proof that legacy data matches. For
populated equal revisions it calls `saves.load()`, reads local entries through
`idbKv.entries()`, and compares their contents before admitting incremental
forwarding.

In this fixture, `saves.load()` was not a function. Reconciliation caught that
failure. Before the complete-prefix hardening, the catch allowed subsequent
forwarding to proceed, so the payload tests accidentally passed after failed
startup reconciliation. The new catch correctly blocks forwarding and clears
pending deltas. The absent forwarded profile exposed the fixture's incomplete
setup.

The original controlled object store also lacked `openCursor`. Merely adding
`load` would therefore move the same setup failure to the local snapshot read.
Both missing operations must be modeled; setting `complete: true` would bypass
the legacy comparison this fixture actually selects.

The new production behavior is appropriate: a failed full reconciliation must
not be concealed by a later partial write. No production rollback, fake
certificate, manual private-state reset or bypass is part of this repair.

## Fixture correction

### Independent legacy file contents

The fixture now owns a separate cloned map for the legacy file contents and a
separate file revision. `info` reports that state; `load` returns a structured
clone of its complete snapshot. A legacy `put` records its transport-time clone
and updates the independent file copy. The saves interface also supplies
typed `seed` and `flush` members rather than leaving further required methods
missing.

The fixture intentionally supplies neither a modern completion certificate nor
the optional batch `commit` method. The real legacy comparison and legacy
per-key forwarding remain exercised. It is still an in-memory bridge model,
not a native file-service or Electron IPC test.

The previously failing cases now require one actual legacy-load call. Their
original assertions still require the committed private snapshot after caller
mutation, the expected revision, and correct recovery backup payload/order.
The original delayed-open, reused-object, clone-failure, explicit-abort,
getter-count and browser-only assertions are unchanged.

### Cursor and request delivery

The controlled object store now provides a cursor over its stored string keys
in deterministic key order. Each cursor value is cloned. Calling `continue()`
queues the next success delivery on the same request, including the final null
result, so the actual production `idbKv.entries()` implementation assembles the
snapshot.

The request drain now continues until no pending success callbacks remain or
the transaction aborts. This includes requests admitted by a preceding callback:
cursor continuation and SaveStore's persisted-revision get. A transaction that
aborts during delivery does not subsequently publish a completion event.

These remain manually controlled request callbacks. They preserve the fixture's
specific cloning, callback and commit boundaries; they do not reproduce the
browser event loop, cross-connection serialization or filesystem behavior.
The separate native IndexedDB and desktop-recovery acceptance cases cover those
different boundaries.

## Added negative control

The new case initializes matching profile/file revision 7 but makes the
otherwise valid legacy `load` reject explicitly. It requires:

1. The real reconciliation path attempts the legacy load once.
2. The subsequent SaveStore write still resolves after local commit.
3. Local profile data and its revision advance to the new value and revision 8.
4. No per-key desktop forwarding occurs.
5. The independent file snapshot remains the old complete revision 7.

Together with the healthy populated cases, this distinguishes a working legacy
comparison from either always-blocked forwarding or a bypass that invents
completeness. Reverting the production catch to its earlier permissive behavior
would violate the new negative control; dropping legitimate forwarding would
violate the existing healthy cases.

## Review and integration notes

A structural source comparison removed only the added negative case and the
two small positive-case observation changes, then reproduced the original
describe block exactly. No existing assertion or test scenario was removed.
The changes are confined to this test fixture and this report.

The proposed source must be accepted by the coordinator's lint, unit, probe,
compiler/build and browser gate before being described as passed. This report
retains the actual failed checkpoint rather than reclassifying it as successful.

The fixture repair does not establish generic multiwriter reconciliation,
change database/file formats, touch desktop production code, or alter rendering,
animation, models, characters, environments, offroad modules, vehicle data or
tuning. No commit, branch or ref update was performed by this assignment.
