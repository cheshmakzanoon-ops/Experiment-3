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

## First runtime result: `757c162`

[Native run 41323821395](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41323821395)
failed on all three targets before the paused-presentation predicate ran. The
new graphics-health wrapper passed an uninvoked arrow-function **string** to
Playwright `page.evaluate`; evaluating that string returned a function rather
than the intended observation object. Its serialized result was undefined, and
the subsequent `.readiness` access threw. This is a harness regression, not an
established game/GPU failure.

Linux failed at 2.804 seconds, Windows at 3.429 seconds and Apple Silicon macOS
at 5.410 seconds. All histories honestly contain only `gate-failure`, zero
received polls, `absent-before-failure` and a null host start. Screenshots show
preparation, not completed environment readiness. No compatibility journey was
reached. The production fingerprint was
`ad6787e8c2439af3873e985da4b4297343379e2e8db5837e3d88a08113ea048a`.
Artifacts 13091070593 (Linux), 13089869997 (Windows) and 13090418316 (macOS)
retain the failed evidence.

The separate [GPU run 41323821362](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41323821362)
passed all three groups and the aggregate check. Those browser tests do not use
this desktop observation wrapper and cannot certify its runtime semantics.

The correction invokes the existing expression explicitly. New Node VM tests
execute the exact extracted expression, rather than calling a returned function:
they fail on the original source and require the actual health/readiness object.
Original document/Babylon query errors, including falsy thrown values, must still
propagate; only new metadata errors are isolated. No optional-chain fallback,
readiness predicate, timeout or polling adjustment is made. The native workflow
selects the regression test explicitly. Corrected native execution is pending.

## Second runtime boundary: `2fd2604`

[Run 41325609398](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41325609398)
exposed a second evaluation error after the health-query correction. Windows
reached the strict surface receipt at 5.496 seconds and failed on `kind`: the
entry observation recorded a false predicate, zero submitted/completed frames,
and a preparing surface, with no delivered polls. The strict downstream asset
receipt prevented the premature wait from becoming a passing native run.

The pinned Playwright client also marks a string passed to `waitForFunction` as
`isFunction: false`; the server leaves an evaluated function object unchanged,
so an uninvoked arrow is truthy and admits immediately. The earlier CPU helper
manually invoked that function and therefore did not model the actual API.
The first correction did not address this second site. No native readiness or
Linux repair is established by either failed run.

The second correction explicitly invokes the unchanged predicate with
JSON-serialized host-owned gate arguments. The regression now uses the installed
Playwright client's wire serialization and extracted installed server predicate
evaluation: false remains false, ready becomes true, real samples are delivered,
and quoted/backslash/newline arguments stay data. Both string sites are audited;
all other harness evaluation callbacks are actual function objects. The original
30-second timeout, 100-ms polling, exact readiness predicate and diagnostic-error
isolation remain unchanged. The corrected runtime still needs its own CI run.

The run subsequently finished with the same strict receipt failure on Linux
(3.523 seconds) and macOS (8.121 seconds). All three receipts showed 0/0 frames,
settled false and an empty surface; no poll samples or first graphics fault were
recorded. Artifacts 13091466997 (Linux), 13091695515 (Windows) and 13091775138
(macOS) preserve reports/screenshots. The unchanged production fingerprint is
`ad6787e8c2439af3873e985da4b4297343379e2e8db5837e3d88a08113ea048a`.

## CSP failure on repeated polling: `ee10c383`

[Run 41326715565](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41326715565)
exposed the remaining string-evaluation incompatibility with the application's
unchanged strict Content Security Policy. Windows failed at 2.949 seconds with
a `page.waitForFunction` EvalError. One actual false poll was received: surface
preparation had started, draws remained 0/0, later owners were absent and the
presentation schedule was pending. The approximately 113-ms gate did not time
out or establish a GPU fault; the retained poll is correctly labeled stale.

The installed Playwright server caches a function only for its actual-function
path. The invoked string was evaluated initially, then evaluated again by the
poll timer under CSP, which prohibits unsafe eval. Testing single evaluation
semantics had not exercised that second timer invocation. The failed evidence
is retained; security is not relaxed to accommodate the harness.

Both health and polling calls now pass the actual self-contained reader function
with serializable mode arguments. Its nested snapshot reader has no imported
closure dependencies. Default snapshot calls retain their existing behavior;
health mode preserves original query failures outside metadata catches, and poll
mode retains the exact admission predicate and fire-and-forget observations.
No executable string, eval, new Function, CSP exception, driver or timeout change
is added to the application. Tests exercise the installed client's function flag
and the same cached server predicate through repeated false/false/true polls,
with evaluation allowed once and rejected thereafter to model the CSP boundary.
This correction still requires a fresh installed-app run.

All three targets ultimately failed at the same repeated-evaluation CSP boundary:
Linux 109 ms, macOS 111 ms and Windows 113 ms from gate start, with one false poll
each. No native journey completed. Artifacts 13091997053 (Linux), 13092305363
(macOS) and 13091293869 (Windows) retain SHA-verified reports and preparation-UI
screenshots. The production fingerprint remained
`ad6787e8c2439af3873e985da4b4297343379e2e8db5837e3d88a08113ea048a`.

## CSP-safe native result: `e10eefe`

[Run 41327862050](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41327862050)
completed with Windows and Apple Silicon macOS passing their installed-app
checks and all four compatibility journeys. Windows recorded 45/45 draws,
macOS 31/31; both completed 435 preparations. Repeated false-to-true polls now
execute normally. Lamps report five parts/materials, 400 triangles and zero lit
in practice; the gantry reports 4/1/3 resources, 9,520 triangles and its original
SHA. Screenshots show the original gantry and dark lamps.

Linux still failed the unchanged first paused-presentation gate: 289 real polls
and a 30,008-ms host interval. The last pre-timeout sample arrived 26 ms before
failure (renderer time 33,537.4 ms): four draws submitted, three completed;
surface complete; gantry present, drawable but incomplete; lamps absent; all
120 preparations completed, a GPU submission pending for 1.9295 seconds, and
the presentation schedule pending with one preparation owner. No graphics
fault, context loss or CSP error was recorded.

Final collection approximately 24.4 seconds later is not a pre-timeout receipt:
it showed 6/6 draws, gantry ready and lamps preparing (124 started/123 completed),
with the readiness predicate still false. The screenshot shows an intact proxy-
car scene. This identifies the observed startup boundary, not a proven root
cause or repair. The 30-second early-pause gate remains failed; no timeout,
initial-state requirement or graphics/security setting is weakened.

Artifacts 13092541604 (Windows), 13092371532 (macOS), 13092810569 (Linux) retain
SHA-verified logs, reports and inspected screenshots. All targets identify the
unchanged production fingerprint
`ad6787e8c2439af3873e985da4b4297343379e2e8db5837e3d88a08113ea048a`.
The live banner is a subsequent source change requiring its own GPU/native run.
