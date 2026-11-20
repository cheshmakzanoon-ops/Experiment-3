# Current accepted main: bounded validation checkpoint

This package preserves the raw-API job snapshot taken at **2026-11-20 01:20:43 UTC** for accepted source **93c4c55469ecc2fe44157e74d4e81f3d6c9055c4**, tree **183094280b5c0f3ec40ef5c29537477c7150c204**. Every recorded job reports that exact source. This is a cutoff snapshot, not a claim about subsequent job outcomes.

| Workflow | Successful jobs | Failed jobs | Unfinished jobs |
| --- | ---: | ---: | ---: |
| Main 44650977053 | 7 | 1 | 20: 18 running, 2 queued |
| Graphics 44650976953 | 2 | 1 | 0 |
| MotoGP 44650976917 | 7 | 1 | 0 |

Main's build/validation, road scenarios, off-road scenarios, wet presentation and unit shards 1, 2 and 4 passed. Unit shard 3 failed the unchanged mixed GP/superbike pace assertion. The [complete current unit package](../complete-main-units-93c4c55-20261119/README.md) independently reconciles all four native reports: 697 files, 6,801 cases, 6,800 passed and one failed. Its original contact file passes 22/22, including the corrected rain race. The twenty unfinished jobs cover the original browser and owner-QA matrix; their eventual results are not represented here.

The completed Graphics run passes seven component cases and the complete driving/capture/replay journey. High still fails the original 90,000 ms readiness assertion: expected `paused`, received `loading`. Detailed source, setup and result evidence is in the [build/Graphics summary](../accepted-wet-path-node22-20261119/main-build-and-graphics.json).

MotoGP's build and unit jobs passed, as did five browser groups: course construction (2 cases), dry riding (1), rider contact (7), wet riding (1) and menu entry (7). The presentation group passed eight cases and failed the original fresh-context image-hash equality assertion at `e2e/41-motogp-reference.spec.ts:230:21`: expected `4193071955`, received `3908797941`. These hashes do not establish the magnitude of the current pixel difference. Per-job counts are kept separate and are not summed across overlapping workflows.

`checkpoint-run-job-snapshot.json` retains all captured job identities and terminal/pending status. `motogp-summary.json` preserves separate terminal group outcomes and the presentation failure evidence. The full failed presentation log and its excerpt are included; other MotoGP log filenames named by the acquisition summary refer to the acquisition workspace and are not included here. The full included presentation log is 63,332 bytes with SHA-256 `3d29b5025683671bdc6e50918ab931773bcabccf2afb8f5d4f9450d1c29c5d66`.

`manifest.json` covers every other retained file. Copied evidence bytes match their acquisition sources. No test, threshold, deadline or workflow gate is modified by this package.
