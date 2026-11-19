# Main ffd2259: complete unit audit and remaining CI boundary

Exact source: `ffd22598335dfa2a074ebd466e1d53830bb8bb41`, tree `cc67121b209279498206e4d575251ff866683ba9`.

Main [Build and validation run 44617126580](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44617126580), attempt 1, used the complete four-partition unit schedule published in this source. All four unit jobs completed. These results supersede the earlier pending unit status; they do not accept the full main workflow.

| Unit partition | Completed files | Passing tests | Failing tests | Vitest duration |
| --- | ---: | ---: | ---: | ---: |
| 1 | 174 | 1,662 | 0 | 592.62 s |
| 2 | 174 | 1,810 | 1 | 976.17 s |
| 3 | 174 | 1,767 | 1 | 410.93 s |
| 4 | 172 | 1,516 | 0 | 512.04 s |
| Total | 694 | 6,755 | 2 | — |

All 694 original source files are represented exactly once, with no missing, extra or duplicate assignments. There are 692 passing files and two failing files. Every one of the 6,757 discovered cases has a completed passing or failing result; there are no pending or todo cases. Complete console file summaries agree with the independent structured JSON reports, including every file's case and failure counts. Native JSON `numTotalTestSuites` includes nested describe groups and is deliberately not presented as a file count.

## Original failures reproduced

- `tests/gp-tyre-contact.test.ts:294`, GP contact grip at Poggio Alto in rain: actual impact `0.9916666666666667`, original required value `0`. The race-finished assertion passed; the later per-rider crash assertions were not reached after this failure.
- `tests/bike-session.test.ts:367`, mixed GP/Superbike race: GP best lap `91.13427179346363` seconds versus Superbike `90.36337145755091` seconds. The first GP-faster-than-Superbike assertion failed. The following original requirement for a greater-than-0.15-second advantage was not reached.

These match the prior published-baseline observations. Partitioning made the complete suite observable; it did not correct or waive either production race failure.

## Remaining workflow status

`jobs-snapshot-01.json` preserves a timestamped GitHub API observation. Validate, road scenarios, offroad scenarios and wet presentation were complete and successful. At this snapshot, all sixteen ordinary browser partitions and all four owner-QA partitions were still running. This package does not count unfinished browser cases or assert that the main workflow is green.

The separate [branch-consolidation run 44617126586](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44617126586) failed its deliberate ancestry preflight at `babylon-js`. See `branch-consolidation/README.md`. This is distinct from application validation.

## Retained evidence and reproduction

- `unit/unit-N-job.log.gz`: complete decoded GitHub job logs, including setup, original test invocation, original source-stability wrapper, complete case summaries, exit status and artifact upload. The original BOM, timestamps and ANSI sequences are retained.
- `unit/unit-N.json.gz`: exact native Vitest report bytes extracted from each uploaded artifact, containing all case titles, statuses, durations and failure messages.
- `unit/unit-N.log.gz`: exact original test-console bytes from the same uploaded artifact, separate from the surrounding job log.
- `unit/artifact-download-receipts.json`: all four ZIP downloads matched GitHub's reported SHA-256 and size; every extracted member has its byte hash. The original ZIPs are not duplicated in this package.
- `unit/source-file-inventory.json`: all matching files at the immutable source, with Git blob identities. `unit/file-results.json` ties each completed file to its partition, case counts and blob identity.
- `unit/summary.json`: exact totals, both complete failure records and reconciliation results.
- `source/`: exact source workflow, Vitest configuration, package script and source-stability implementation with hashes. `source-and-jobs.json` retains source and job metadata.
- `log-provenance.json`: complete decoded-job and gzip hashes, byte counts and roundtrip receipts. `SHA256SUMS` covers the final package.

Run `python3 reproduce-unit-audit.py` from this directory to recompute the unit summary and file results using the retained immutable reports and source inventory. Supplying an existing repository path as an argument additionally regenerates the file inventory from commit `ffd22598335dfa2a074ebd466e1d53830bb8bb41`. This is report reconciliation; no application test body is rerun.

No remote write, workflow cancellation, test retry or application-source modification was performed by this audit.
