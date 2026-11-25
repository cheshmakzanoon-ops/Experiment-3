# Evidence index

[Final report](README.md) · [Validation matrix](VALIDATION.md) · [Worker ledger](TASKS.md)

The report separates the tested code revision, individual measurements and the later documentation publication. All final runtime gates use commit `9119c7683d821d145f15ed64a03ee3406595b58d`; its production source is unchanged from checkpoint 7. Counts from overlapping runs are not added.

## Readable primary receipts

| Evidence | Scope |
| --- | --- |
| [Consolidated unit result](validation/w09a-consolidated-validation.json) | One invocation: 1,852 cases / 128 unique files; original failure and correction history kept separately. |
| [Static and build manifest](validation/w09b-static-build-manifest.json) | Full configured lint/typecheck/build and unchanged bundle/IP gates. |
| [Local native manifest](validation/w09c-native-gate-manifest.json) | 37 cases / 9 files on SwiftShader; unchanged source and all 266 dist files. |
| [Focused CI receipt](validation/checkpoint9-ci.json) | 506 cases / 42 files and the same 37 browser cases on Mesa, exact source/build identity. |
| [Complete broad unit shards](validation/checkpoint9-broad-unit-summary.json) | 9,594 passed and 4 baseline-established failures across 901 files. |
| [Protected scope review](reviews/w09e-protected-scope.md) | 29 production files and 3,883 protected leaves; explicit finite/tree/history limits. |
| [Independent performance audit](reviews/w10b-performance-claims.md) | 43 workload summaries; 925 arithmetic and 2,380 source/hash checks; precise approved wording. |
| [Final engine review](reviews/w10d-final-engine-review.md) | Cross-domain ownership and numerical invariants accepted without additional repairs. |
| [Remote publication/artifact review](reviews/w10e-publication-verification.md) | Actual remote commits, parent preservation and independently downloaded CI artifact. |
| [Final acceptance](reviews/w10f-final-acceptance.md) | User-goal acceptance, real residual limits and documentation/publication steps. |

The [final strict ledger and link receipt](validation/w10c-final-ledger.json) confirms 60 started / 60 complete, six per wave, unchanged protected content and no unresolved document targets. It keeps the earlier provenance limits and intermediate failures visible.

## Original evidence archives

These archives retain original bytes and directory-relative names. Their [machine-readable manifest](validation/evidence-archives.json) lists every entry, size and SHA-256. Historical failures and then-pending snapshots remain intact; the final report and validation matrix identify the completed results. Archive sizes are compressed byte counts. All 14 archives were reopened and every one of their 425 entries matched its recorded bytes and SHA-256; the standalone CI ZIP also passed its CRC check. [Integrity receipt](validation/evidence-integrity.json).

| Archive | Files | Bytes | Contents |
| --- | ---: | ---: | --- |
| [worker-handoffs-13-48-evidence.tar.gz](validation/worker-handoffs-13-48-evidence.tar.gz) | 36 | 89,175 | Original 36 individual handoffs for workers 13–48 |
| [w09a-initial-evidence.tar.gz](validation/w09a-initial-evidence.tar.gz) | 72 | 3,313,928 | Initial failures, exact-baseline proofs, controlled fixture corrections and source receipts |
| [w09a-final-evidence.tar.gz](validation/w09a-final-evidence.tar.gz) | 37 | 1,682,723 | One final 128-file / 1,852-case invocation and complete source/result receipts |
| [w09b-static-evidence.tar.gz](validation/w09b-static-evidence.tar.gz) | 10 | 350,860 | Full lint, compiler, production build, bundle and IP checks plus dist receipts |
| [w09c-native-evidence.tar.gz](validation/w09c-native-evidence.tar.gz) | 50 | 974,571 | Final 37-case local native/replay run, exported attachments, source/dist receipts and runner |
| [w09d-ci-evidence.tar.gz](validation/w09d-ci-evidence.tar.gz) | 90 | 1,035,533 | Checkpoint7 CI inspection, actual baseline comparisons and unresolved night-timeout evidence |
| [w09e-scope-evidence.tar.gz](validation/w09e-scope-evidence.tar.gz) | 48 | 1,653,746 | Full protected-content, method and checkpoint tree metadata audit |
| [w10a-triage-evidence.tar.gz](validation/w10a-triage-evidence.tar.gz) | 9 | 16,651 | Exact matching of all 39 earlier broad-unit failures and remaining-limit triage |
| [w10b-performance-evidence.tar.gz](validation/w10b-performance-evidence.tar.gz) | 7 | 134,574 | Independent statistics, source/method identities and approved claim audit |
| [w10c-ledger-evidence.tar.gz](validation/w10c-ledger-evidence.tar.gz) | 7 | 48,835 | Initial ledger/link audits, historical pending findings and strict validator |
| [w10d-engine-review-evidence.tar.gz](validation/w10d-engine-review-evidence.tar.gz) | 6 | 86,440 | Final cross-domain engine review and exact production source comparison |
| [w10e-publication-evidence.tar.gz](validation/w10e-publication-evidence.tar.gz) | 45 | 376,920 | Independent remote source/history, artifact and broad-CI verification through checkpoint9 |
| [w10f-acceptance-evidence.tar.gz](validation/w10f-acceptance-evidence.tar.gz) | 3 | 49,224 | Final user-goal acceptance and independent source/receipt checks |
| [checkpoint9-broad-units-evidence.tar.gz](validation/checkpoint9-broad-units-evidence.tar.gz) | 5 | 109,709 | All four complete repository unit-shard logs and their reconciled summary |

## Retained final CI artifact

The complete independently verified [checkpoint 9 CI ZIP](validation/checkpoint9-engine-runtime-validation.zip) is retained beyond the remote artifact retention window. It contains the exact source/tree/lock/build receipts, raw logs and native/replay results. Its 1,178,621 bytes hash to `8653a669dac50a9d0d8ffce104b1b703b0083e227960f0f922bbbbb6aeb5297f`.

## Explicit exclusions and chronology

- Original scratch handoffs for workers 1–12 were lost during an earlier runtime reset. [WAVE01-02.md](WAVE01-02.md) reconstructs their work from committed code, plan and regression tests; it does not fabricate original handoffs, quotations, historical timings or test totals.
- The unchanged baseline source checkout/archive is reproducible from exact commit/blob manifests and is not duplicated here. Dependencies and the full production dist are also excluded; the complete dist hash receipt is retained.
- The 41 MB night trace ZIP is not duplicated. Its artifact URL/digest, retained inspection/event records and absence of an established cause remain documented. The timeout is not relabeled a passing result.
- Generated HTML report presentation and duplicate result-directory exports are omitted where raw JSON/logs and exported attachments carry the same evidence.
- The final strict ledger/link receipt is retained separately after integration. Verification of the actual documentation commit occurs after its non-force publication, using Git metadata and the same remote-verification worker; it is not falsely embedded as a prior completed check.

All archives concern verification and development evidence. They add no model, character, authored environment, texture definition, material definition or vehicle-tuning modification.
