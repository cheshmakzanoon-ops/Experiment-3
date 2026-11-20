# Complete accepted-main unit evidence: 93c4c55

Exact source **93c4c55469ecc2fe44157e74d4e81f3d6c9055c4**, tree **183094280b5c0f3ec40ef5c29537477c7150c204**, GitHub Actions run **44650977053**.

## Result

All four original native unit shards completed: **697 test files, 6,801 cases, 6,800 passed and one failed**. Every source test file occurs exactly once and every case from the previous complete f80309f audit remains present. Full console file summaries agree with the original native JSON reports. There are no missing, extra or duplicated files and no pending or todo cases.

| Shard | Job ID | Files | Passed cases | Failed cases | Node | Vitest seconds |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| 1 | 136005637231 | 175 | 1,665 | 0 | v22.23.4 | 593.29 |
| 2 | 136005637320 | 175 | 1,833 | 0 | v22.23.5 | 668.58 |
| 3 | 136005636705 | 175 | 1,784 | 1 | v22.23.5 | 409.87 |
| 4 | 136005637089 | 172 | 1,518 | 0 | v22.23.5 | 797.18 |

All shards used npm 10.9.9. The source commit, job identity and artifact digest are independently matched to each terminal job log. The accepted simulation tree is **50ac6526b5049b5dbcfd170d2cd78c8dddbd5338**. No unit reruns or original race assertion/deadline changes were used.

## GP rain improvement and remaining failure

The complete original `gp-tyre-contact.test.ts` now passes **22/22 cases**, including Poggio Alto rain. That rain case was the contact failure in the previous exact-main audit. Its original file remains byte-identical.

The only remaining failure is the unchanged `bike-session.test.ts` mixed GP/superbike pace assertion: **91.13427179346363** was expected to be less than **90.36337145755091**, at line 367. This is the same case and exact numerical failure retained in the previous audit. That complete file has **13/14 passed**. No new failed case identity appears.

`original-race-controls.json` preserves all 36 case results from those two unchanged original files. The full unit gate remains failed because the original mixed-pace assertion remains enforced.

## Exact comparison with f80309f

The prior complete audit, source **f80309fce06e97ada17cde1ef330971d9af6ffd9**, run **44646348452**, had **696 files, 6,780 cases, 6,778 passed and two failed**. Current source adds exactly **21 passing cases**:

- Eight cases in `bike-scaled-path.test.ts`.
- Twelve new rows in `session-identity.test.ts`.
- One generated YAML validation case for `wet-path-validation.yml`.

All baseline cases remain present. The added cases plus the repaired rain case explain the passing-count change: **6,778 + 21 + 1 = 6,800**. The only existing test file changed is `session-identity.test.ts`; the original race files, package and lockfile, Vitest configuration and source guard are unchanged.

## Retention and reproduction

All **6,801** original native case results are recoverable from the four `unit-N.json.gz` files. The four `unit-N-job.log.gz` files preserve complete terminal logs. Existing gzip bytes were copied without recompression. Artifact receipts retain original archive IDs, sizes, SHA256 digests and member hashes; their separate command-log entries describe acquisition data, while this package keeps the complete terminal logs.

The baseline is reused from the adjacent package **`complete-main-units-f80309f-20261119`**, without duplicating its reports. `baseline-reference.json` pins the six required baseline inputs by SHA256. With both packages stored as siblings, run `python reconcile-units.py` in this directory. An explicit baseline directory may alternatively be passed as the first argument. The helper reads retained evidence only, runs no tests, and makes no network requests.

`reproduction-receipt.json` records reproduction of the complete audit. `package-receipt.json` records byte-identical copied inputs. `manifest.json` gives SHA256 and Git blob hashes, plus decompressed hashes for gzip files. The package excludes ZIP duplication, uncompressed logs, redundant command logs, polling snapshots and temporary download metadata.

This is complete unit evidence for the exact accepted source. Browser journeys, owner QA, physics scenario gates, shader GPU comparisons and application startup are documented separately.
