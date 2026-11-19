# Main CI unit checkpoint — 2026-11-19

This is a frozen checkpoint at 2026-11-19T16:02:34.139Z. It preserves complete decoded logs for the five finished main jobs and records the other thirteen jobs as still executing. It is not a final main-run verdict.

- Repository: cheshmakzanoon-ops/Experiment-3
- Run: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44553045707
- Published source: `d8d87c73a8f3e921e865acdc02c61e84b8c877a7`
- Exact reviewed tree: `51077ee3c9103d7faf139b622aa806bf8652d1f6`, equal to local `a1e2e385251b94f7cc82e123440a0a4c72611d63`.
- Publication used a new commit identity because the supported connector could preserve the exact tree but not the local author/committer timestamps. Production source is unchanged from the prior main source.

## Completed results

Validate, scenarios, offroad-scenarios and wet-presentation succeeded. Wet-presentation executed all seven tests successfully. All twelve ordinary browser shards and owner QA reached their actual test commands and remain pending in this snapshot; none remains blocked by dependency installation.

Unit job 135661597381 started at 15:17:09 UTC and completed as `cancelled` at 16:02:23 UTC, after 45m14s, close to the unchanged 45-minute configured job cap. The complete returned log says “The operation was canceled.” The available endpoint does not explicitly label its initiating cause. No agent cancelled or reran this job. Tests executed, but Vitest did not finish and printed no global suite summary. The cancelled unit prerequisite prevents successful release publication.

The 528 unique completed file summaries contain 5,960 reported cases: 5,958 passing and two failing. These are partial observed counts, not final suite totals. `tests/startup.test.ts` passed all 32 cases, confirming the corrected fixture on the published source.

The two observed regressions are:

1. `tests/bike-session.test.ts`: mixed GP/superbike race at Vellamar, seed 3303. The best GP lap was 91.13427179346363, while the best superbike lap was 90.36337145755091; the assertion that GP is quicker failed.
2. `tests/gp-tyre-contact.test.ts`: eight GP riders at Poggio Alto in rain, seed 30101. The observed maximum impact was 0.9916666666666667; the unchanged zero-contact assertion failed. Later crash/classification assertions in that case were not reached, so this log does not establish their result.

Source-stability negative-fixture stderr is expected test output: the source-stability test file passed all 19 cases. It does not establish unexpected application-input mutation in this run.

## Evidence contents

Each `*-log-provenance.json` records the source, run/job, decoded log SHA-256 and compressed file SHA-256. Logs are lossless gzip encodings of complete decoded connector responses, not the original GitHub ZIP format. The full unit log remains complete even though the suite was cancelled. `unit-observed-file-summaries.json.gz` contains every matched file-result line supporting the partial counts; `unit-result-summary.json` gives exact failures and count limitations.

`unit-completion-jobs.json.gz` preserves the full jobs API snapshot. `checkpoint-status.json` lists actual start/completion times and unchanged configured caps. Browser and owner caps range from 16:50:43 to 16:54:35 UTC, calculated from their actual start times; these are nominal scheduler caps, not predictions of when tests will finish.

`active-unit-log-unavailable.json` records the single authorized attempt to read the unit log while it was active, which returned 404 BlobNotFound. No active-log retry was made. Publication identity and preflight verify the exact reviewed tree. The report-only publication review is included separately and does not bypass any validation prerequisite.

`MANIFEST.json` and `SHA256SUMS` cover this frozen package. Subsequent browser outcomes must be appended in a separate checkpoint rather than changing this historical snapshot.
