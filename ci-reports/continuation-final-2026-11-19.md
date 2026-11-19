# Completed continuation CI and next corrections — 19 November 2026

The original [Build and validation run 44553045707](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44553045707) on `d8d87c73a8f3e921e865acdc02c61e84b8c877a7` has finished. All nineteen jobs are terminal. Its workflow conclusion is **cancelled**, and publication was skipped. This supersedes the pending browser/owner-QA state in the earlier [continuation checkpoint](continuation-2026-11-19.md); that earlier source-specific evidence remains unchanged.

## Completed source result

| Workload | Result |
| --- | --- |
| Build/lint/content/typecheck/IP validation | Passed |
| Road scenarios | Passed |
| Offroad scenarios | Passed |
| Wet presentation | Passed |
| Eleven completed ordinary browser partitions | 243 passed, 69 failed, 12 existing conditional skips |
| Cancelled ordinary browser partition 2 | 21 completed passes, 6 failures, 2 cases without completed result |
| Owner QA | 16 completed passes, 8 failures, 18 cases without completed result |
| Unit suite | Incomplete: 5,958 passing tests, 2 failing tests in 528 completed files; 166 files without completed result |

All twelve ordinary browser partitions discovered 353 cases. Their completed lines contain 264 passes, 75 failures and 12 existing skips. The cancelled job has no final Playwright summary; the totals do not treat its two unfinished cases as passes or skips. Owner QA uses a different build and remains separate. All relevant install and artifact-download steps succeeded; these are executed test failures.

Thirty-nine ordinary failures are page-evaluation deadlines, and twenty-five are race-readiness deadlines. Other deadlines affect visibility, controls, camera changes and screenshot completion. Three distinct direct defects were identified for correction: the GP effects fixture lacks the current road-contact `cast` method; the APX assembly fixture edits legacy suspension travel without its authoritative recorded hub length; and owner reference-depth polling dereferences a renderer before it is available. Those diagnoses do not explain or close the other startup/survey failures.

The cancelled unit job ran 45m14s against a 45-minute limit; owner QA and browser partition 2 ran about 90m30s against 90-minute limits. This is consistent with the limits, but the decoded logs do not name the initiating actor. No job was cancelled or retried while collecting this final audit.

The [complete audit](evidence/continuation-final-20261119/original-ci/SUMMARY.md) contains per-partition counts and cancellation boundaries. Its JSON includes exact failed-case messages. Fourteen complete decoded logs are preserved losslessly with hashes; large screenshot/trace archives were not duplicated.

## Unit completion correction

The [unit-partition change](unit-partitions-2026-11-19.md) distributes the complete original suite over four workers, with no omitted or duplicated files and no fail-fast cancellation. All original release dependencies remain required. Local release/workflow checks passed 88/88. The [inventory and validation receipt](evidence/continuation-final-20261119/unit-partitions/receipt.json) records the source and scope. Hosted results on that change must be recorded separately from the older failed run.

The same completed run exposed missing owner-QA and ordinary-browser results near their 90-minute limits. The ordinary browser planner now uses sixteen workers instead of twelve, and the unchanged owner-QA file selection uses four native Playwright partitions. The original 90-minute job limits and every test's own deadline are retained. Matrices do not fail fast, artifact names are unique per partition, and every matrix remains a required publication dependency.

Actual Playwright enumeration verified all **353 ordinary cases** against the selected IDs of **every one of the sixteen partitions**, with no omissions or duplicate assignments. Owner QA discovered the original **42 cases**, partitioned **11/11/10/10**, again with exact complete coverage. No browser or test body ran for this inventory check. The subsequent release/workflow/planner check passed **92/92 tests** in four files; scoped ESLint and diff checks passed. [Actual inventories and check receipts](evidence/continuation-final-20261119/browser-partitions/receipt.json) preserve the selection evidence. These scheduling changes make final outcomes observable and do not turn existing failures into passes.

## Isolated graphics follow-up

The [isolated graphics run 44611365105](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44611365105) tested `cc72bfd8117ccad37180093c8ec45d7656810686`, which prepares and retains the actual native PMREM background program owner. Its build passed, all seven component cases passed, all seven menu/settings cases passed, and the original Low driving/replay journey passed. These passing cases had no retries or skips. The candidate remains outside main because the original High GP journey still failed its unchanged 90,000 ms readiness predicate.

The retained High trace progressed past the earlier PMREM background-program stopping point and reached the first chase warmup. Its one late program has the exact adaptive-exposure fragment body and the exposure meter's 16×12 framebuffer. The final observed native command was `getProgramInfoLog`, still in flight in the retained evidence. No completed first-warmup GPU fence or cockpit stage was observed. This identifies the next first-use owner; a native call's wall time can include previously queued driver work and does not establish an infinite stall or isolated compile cost.

The [compact exact-source audit](evidence/continuation-final-20261119/graphics-background-cc72bfd/README.md) preserves all five complete job logs, all passing case results, the original High assertion and diagnostic attachments, source identities, and verified archive digests. Its separate fullscreen source audit identifies other active owners that also lack preparation; those findings are not additional observed test failures. Software-renderer evidence does not establish physical-hardware performance, and Low acceptance does not establish High acceptance.

## Acceptance boundary

The three demonstrated fixture defects are corrected in the continuation source. The GP flat-road fixture now supplies its real bounded plane-contact cast and normal. The APX fixture writes its authored travel into both the legacy field and the authoritative measured hub field; the independent socket calculation and original 2e-6 tolerance are unchanged. The reference-depth poll waits through an unpublished renderer while keeping its original strictly positive count assertion and deadline.

Each original error was reproduced before the patch. The complete APX CPU fixture then passed all 68 poses and 2,176 suspension endpoint checks, including its original asset, memory, LOD, driver, pit, damage, heat, livery and rewind assertions. The GP fixture passed nine native bike poses, and the reference callback rejected pending/empty states before accepting a populated survey. The unchanged related unit suites passed 65/65, with TypeScript, scoped ESLint, format and source-stability checks passing. [Exact fixture proofs and source receipts](evidence/continuation-final-20261119/fixture-corrections/README.md) retain the complete scope and reproduction instructions. These CPU results do not claim WebGL acceptance for the changed browser cases.

These final results do not constitute a green build. The prior rendering and physics candidates remain isolated until their relevant original acceptance gates pass. A partial unit run, a changed fixture, a CPU program-cache proof, or a successful component screenshot cannot substitute for the unresolved full-application and race checks.
