# Complete original main browser and owner-QA audit

[Build and validation run 44617126580](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44617126580), attempt 1, tested immutable source `ffd22598335dfa2a074ebd466e1d53830bb8bb41`. It finished with failure at 2026-11-19 22:44:21 UTC. All 16 ordinary browser jobs and four owner-QA jobs completed with their full native case summaries. Every originally enumerated ID appears exactly once within its execution group; no case is missing, unexpected or duplicated.

| Execution group | Original cases accounted for | Passed | Failed | Original conditional skips |
| --- | ---: | ---: | ---: | ---: |
| Ordinary browser, 16 partitions | 353 | 268 | 73 | 12 |
| Owner QA, four partitions | 42 | 29 | 13 | 0 |

The two groups intentionally overlap. Their results must not be added and described as unique tests. Ten ordinary skips are original owner/review-build conditions; all ten have actual owner-QA outcomes (eight pass, two fail). The other two are the original opt-in cabin-cost and live-ULTRA measurements, which were not executed. Each original skip statement, exact-source hash and corresponding owner result is retained. No skip has been converted to a pass.

All 20 browser jobs finish inside the original 90-minute cap. The longest, ordinary partition 5, takes 84.6166667 minutes including job setup and artifact upload. The remaining failures are original case outcomes, not job truncations or omitted inventory. The ordinary failures comprise 72 deadline-related error records and one exact fresh-construction GP image-hash assertion. All 13 owner failures contain deadline-related errors. These are descriptive error buckets, not proof of a shared root cause. Every complete original error/stack is retained with its unique failed case ID.

## Corrected fixtures

All three published fixture corrections pass their original hosted cases: APX assembly in ordinary partition 10, GP contact effects in ordinary partition 13, and reference depth in owner partition 1. The separate decals/audio case in the reference-depth file fails its input deadline. The GP reference case's final fresh-construction pixel mismatch has its own original-image audit in the sibling `main-gp-reference-ffd2259` directory; its same-instance weather reversal assertions pass.

## Other completed gates and publication

The original validate/build, road scenarios, offroad scenarios and wet-presentation jobs pass; the wet presentation job reports seven passing browser cases. Their complete logs are included in `completed-jobs/`. The complete four-part unit suite and all its artifacts are retained in the sibling `main-unit-ffd2259` package: 694 files, 6,755 passing tests and two original race failures. The workflow's publish job is skipped because the original required gates failed. No unvalidated release is asserted.

## Original evidence and reproducible read-only audit

This package contains all 20 full browser job logs losslessly gzipped, final run/jobs/artifact metadata, each native case result and failed case ID, original assignment inventory, actual post-checkout commit outputs, and committed workflow/partition/configuration/skip-source snapshots. `log-provenance.json` retains raw and compressed sizes/hashes and their original job endpoints. The complete artifact metadata advertises all 29 uploaded artifact identities and digests; the large browser archives were not all downloaded. The separately examined GP-image archive was downloaded and digest-verified, as recorded in its own package.

Run `python audit.py --repo /path/to/Experiment-3` to reconstruct `summary.json` from the original logs and the committed inventory. It runs no browser, application, simulation or test. It requires the repository's reachable `ffd2259` commit. The included `actual-inventories.json.gz` is byte-identical to that committed source. The final script and summary were independently reviewed against all original logs and immutable source. `SHA256SUMS` covers every other retained file in this package.
