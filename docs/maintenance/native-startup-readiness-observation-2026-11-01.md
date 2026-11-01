# Read-only native startup readiness observations

This `babylon-js` checkpoint improves evidence for the distinct Linux timeout on
`6164be1`; it is **not a Linux rendering or startup fix**. Main remains frozen.
See [the failed boundary and facing proof](babylon-procedural-facing-2026-11-01.md).

## Unchanged behavior

- The existing paused-presentation predicate remains exactly settled=true,
  safe positive submitted count, and completed=submitted.
- Its 30-second timeout and 100-ms polling remain unchanged. Application startup
  retains its existing 120-second deadline; no generation gets a renewed budget.
- No added readiness wait, timer, graphics flag, input change, scheduler action,
  driver workaround, private trace or security setting is introduced.
- Existing GPU/process/document health-query failures still fail normally.
  New observation failures are separate and cannot turn a failure into a pass.

The existing `window.babylonGraphicsDiagnostics` query gains detached plain
owner/schedule flags: owner presence/completion/drawability, paused/stopped,
restart/resize state and non-consuming presentation demand/counts. It exposes
no resource handles or callbacks. New metadata collection errors are isolated;
original GPU-query errors remain outside that catch.

## Bounded evidence protocol

`scripts/native-readiness-observation.mjs` owns the dedicated reader, whitelist,
history and failure-preservation helpers. The original native control validators
remain unchanged. The existing poll sends snapshots through a harness-only
binding without awaiting it. Entry/final collection reuses existing health
queries; no additional polling loop is created.

Renderer and host project fixed known fields and reject unsafe/malformed data.
History is capped at 64 entries, 16 KiB per sample and 256 KiB total; eviction and
rejection counters are explicit. Missing values remain unknown/null. Timeout
reports the last retained pre-timeout sample as stale, or explicitly absent;
it does not pretend a later failure screenshot was a pre-timeout observation.

Renderer performance/time-origin data and host invocation/receipt times are
retained. Host brackets are deliberately broad, not exact cross-clock event
times. Late packets use the matching gate's bracket, or null/late labeling when
that gate is unavailable. Diagnostic transport/collection failures do not mask
the original error, including falsy thrown values.

The legacy `babylon-ready` stage name remains for old consumers, with explicit
simulation-entry-started / environment-readiness-not-asserted metadata. That
stage label does not prove rendering readiness.

## Verification scope

New CPU contracts cover non-consuming reads, unknown fields, malformed/accessor/
oversized payloads, bounded history, late-clock attribution, exact predicate and
failure isolation. The current native workflow explicitly selects both new
native observation test files; renderer observation tests remain in the existing
Babylon wildcard selection. Source/path gates stay read-only and branch-only.

An extra historical `electron-runtime-ab-payload.test.ts` suite rejects its
already-baseline-mismatched protected source with `protected-source-mutated`.
Its guard and frozen manifest are preserved; the retired experiment is not
revived or relabeled as a current passing test. This is separate from the active
native/GPU contract selection.

Actual new native observations remain pending until this checkpoint runs. A
subsequent pass or different failure boundary must not be presented as proof
that instrumentation repaired the old application or GPU issue.

The combined active native/GPU contract selection passed 1,169 tests across 92
files, with full lint, types and build. This is an explicit active-gate result,
not a claim that every historical/frozen repository experiment passes. New
native observations still require the exact published checkpoint's runtime.
