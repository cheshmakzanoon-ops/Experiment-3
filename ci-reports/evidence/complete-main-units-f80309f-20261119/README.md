# Complete pre-wet-merge unit evidence: f80309f

This package records the complete native unit suite for **f80309fce06e97ada17cde1ef330971d9af6ffd9**, tree **48ec011f2caaf5a68137dd3e02f8b14f26ee427b**, GitHub Actions run **44646348452**. It is evidence for the source before the wet-path merge. The successor main **93c4c55** has a separate CI run and is not covered here.

## Result and complete inventory

All four original shards completed: **696 test files, 6,780 cases, 6,778 passed, two failed**. Every source test file occurs exactly once; every retained baseline case remains present. Console summaries and JSON reports agree, with no missing, extra, or duplicate files and no pending or todo cases. The original unit gate remains failed.

| Shard | Job ID | Passed cases | Failed cases | Node |
| --- | --- | ---: | ---: | --- |
| 1 | 135989810947 | 1,657 | 0 | v22.23.5 |
| 2 | 135989810950 | 1,812 | 1 | v22.23.4 |
| 3 | 135989810741 | 1,766 | 1 | v22.23.4 |
| 4 | 135989810664 | 1,543 | 0 | v22.23.4 |

Each shard ran 174 files and used npm 10.9.9. The simulation tree **9daebdee03486217bf2b930b7ea940d10287daee** matches the retained baseline.

The only failures match the retained baseline case identities and numerical assertions:

- `gp-tyre-contact.test.ts`: Poggio Alto rain impact **0.9916666666666667**, expected zero. The complete file has **21/22 passed**, including the clear race cases, on shard 2.
- `bike-session.test.ts`: mixed GP/superbike pace **91.13427179346363**, expected less than **90.36337145755091**. The complete file has **13/14 passed**, on shard 3.

`original-race-controls.json` retains all 36 original race case results, including their source, job, runtime and report hashes.

## Why the total increased by 23

Baseline run **44617126580**, source **ffd22598335dfa2a074ebd466e1d53830bb8bb41**, had **6,757 cases, 6,755 passed and the same two failures**. Main adds 23 passing cases: five local-fog cases, sixteen weather cases, one generated YAML case for `shader-work-validation.yml`, and one generated fixture-bundle case for `shader-work-proof.spec.ts`. The latter two arise in unchanged existing test modules. No original test file or case was removed or changed.

## Supplemental superseded application job status

`superseded-application-jobs.json` records a separate terminal-status snapshot from the same pre-wet-merge run, after the successor main run superseded it. Scenario, offroad-scenario and wet-presentation jobs succeeded; the 16 browser shards and four owner QA shards were cancelled. Cancelled jobs and unfinished cases count as neither passes nor assertion failures. These 23 job statuses do not change the complete unit totals above and do not establish full-suite acceptance.

The supplement applies only to source `f80309f`. Its `preserved_logs` names refer to the acquisition evidence; those application logs are not included here. The original unit copy receipt, artifact receipts and baseline receipt provenance remain unchanged.

## Retained files and reproduction

The four `unit-N.json.gz` files preserve the complete original JSON reports, making all **6,780** case results recoverable. The four `unit-N-job.log.gz` files preserve full terminal job logs. `baseline/` contains all four original baseline JSON reports and their source inventory and provenance. These binary gzip files can be stored directly as Git blobs.

`summary.json`, `file-results.json`, the source inventory, source verification, terminal statuses and original artifact receipts retain the audit and its provenance. Artifact archive digests, IDs and checkout source were verified against terminal logs. Original artifact receipts still describe both archive members; their separate command-log entries refer to the acquisition directory. Those redundant command logs are omitted here because the full terminal logs are retained.

Run `python reconcile-units.py` from this directory to reproduce the complete case comparison using only retained files. It invokes no tests or network operations. `reproduction-receipt.json` records the successful packaged-input reproduction. `package-receipt.json` records only its enumerated original acquisition copies and remains unchanged. The outer `manifest.json` covers every current package file except itself, including this README and the separately collected `superseded-application-jobs.json`. It provides SHA-256 hashes for retained files and both compressed and decompressed hashes for gzip evidence.

This package excludes duplicate ZIPs, uncompressed logs, stale polling payloads and temporary download descriptors. It establishes complete unit execution and preserves its two failures; browser journeys, owner QA, physics scenarios, GPU comparisons, application startup and the later wet-path main each require their own results.
