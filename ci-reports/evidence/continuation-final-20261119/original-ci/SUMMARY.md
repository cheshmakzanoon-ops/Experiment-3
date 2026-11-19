# Completed original CI audit — 19 November 2026

Source: `d8d87c73a8f3e921e865acdc02c61e84b8c877a7`. [Build and validation run 44553045707](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44553045707); attempt 1; terminal conclusion **cancelled**. All 19 jobs are terminal. This audit changes no repository or remote state.

## Executed case counts

| Job | Outcome | Discovered | Observed passed | Observed failed | Existing skips | Without completed result |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| browser (1) | failure | 30 | 23 | 7 | 0 | 0 |
| browser (2) | cancelled | 29 | 21 | 6 | 0 | 2 |
| browser (3) | failure | 28 | 23 | 4 | 1 | 0 |
| browser (4) | failure | 30 | 22 | 8 | 0 | 0 |
| browser (5) | failure | 30 | 25 | 4 | 1 | 0 |
| browser (6) | failure | 30 | 25 | 5 | 0 | 0 |
| browser (7) | failure | 29 | 23 | 5 | 1 | 0 |
| browser (8) | failure | 29 | 21 | 6 | 2 | 0 |
| browser (9) | failure | 29 | 19 | 7 | 3 | 0 |
| browser (10) | failure | 30 | 21 | 7 | 2 | 0 |
| browser (11) | failure | 30 | 20 | 9 | 1 | 0 |
| browser (12) | failure | 29 | 21 | 7 | 1 | 0 |
| owner-qa | cancelled | 42 | 16 | 8 | 0 | 18 |

The eleven completed ordinary browser shards report **243 passed, 69 failed, 12 skipped**. Shard 2 adds 21 completed passes and six failures; its final runner summary is absent. Across all twelve ordinary shards, 353 cases were discovered and 351 have completed result lines. Owner QA is a separate build and is not included in those totals.

The unit job retains **528 completed file summaries, 5,958 passing tests and two failing tests**, without a full-suite summary. Its existing mixed GP/Superbike lap comparison and wet GP zero-impact failures remain real failures; scheduling changes do not repair them.

## Failure boundaries

| Ordinary-browser category | Observed failed cases |
| --- | ---: |
| visibility deadline | 3 |
| page evaluation deadline | 39 |
| race readiness deadline | 25 |
| upright joint geometry assertion | 1 |
| locator input deadline | 1 |
| other execution or predicate deadline | 3 |
| missing road cast method | 1 |
| camera transition deadline | 1 |
| screenshot deadline | 1 |

Two ordinary-browser failures are direct exceptions or geometry assertions: `gp-contact-effects.spec.ts` throws `TypeError: e.cast is not a function`; `22-apx01-assembly.spec.ts` throws `Upright joint detached: 0.060000004698496916 != 0`. Owner QA also throws `Cannot read properties of undefined (reading geometrySurvey)` in `09-reference-depth.spec.ts`. These are separate from deadline failures. Exact original messages, locations and assertion excerpts are retained in summary.json.

The remaining observed ordinary-browser failures are deadlines in readiness, UI visibility/input, camera transition, screenshots or scene evaluation. They do not prove a common graphics root cause. Downstream visual assertions were not reached when preparation or evaluation timed out.

## Cancellations and setup

Unit elapsed 45m14s against its committed 45-minute cap. Owner QA elapsed 90m29s and browser shard 2 elapsed 90m33s against their committed 90-minute caps. Each log reports `The operation was canceled` without naming the initiator. Timing is consistent with job caps; this audit does not assert an independently proven initiator. Owner QA was in A31 sunset after 24 completed results; shard 2 was in A12 night after 27 completed results. No agent cancelled or retried a job during this audit.

Every relevant setup/install/build-download step succeeded. The failed browser jobs reached actual tests. Browser matrix fail-fast is false. Publication was skipped. Validate, scenarios, offroad scenarios and wet presentation succeeded.

## Evidence

Fourteen complete decoded job logs are losslessly retained as deterministic gzip, with decoded UTF-8 and compressed SHA-256 values in log-provenance.json. Final run/jobs API payloads, the exact source workflow, extracted complete-case records and this reproducible summarizer are retained. No large browser artifact archives were downloaded.
