# Wave 9: final engine verification

[Report index](README.md) · [Validation matrix](VALIDATION.md)

**Complete, 25 November 2026:** all six assignments finished. The expanded unit gate, all five local static/build checks, all 37 local SwiftShader native/replay cases and focused CI passed on exact checkpoint 9. Original failures and source-identical baseline comparisons are retained.

## Six distinct assignments

| Worker | Assignment | Observed status |
| ---: | --- | --- |
| 49 | Consolidated engine regressions | Complete; final checkpoint-9 execution passed 1,852/1,852 cases across 128 unique files; initial failures and baseline/correction evidence retained |
| 50 | Full static and product-build gate | Complete; all five checks passed on checkpoint 9; [final handoff](reviews/w09b-static-build.md) |
| 51 | Final native/replay gate | Complete; 37/37 passed on worker50's exact product build, with unchanged source/dist and zero retries; [handoff](reviews/w09c-native-final.md) |
| 52 | Published CI inspection and triage | Complete for the dated checkpoint-7 evidence; independently verified focused artifact and classified broader results |
| 53 | Protected-content/method audit | Complete at checkpoint 7; later checkpoints 8/9 retain identical production and protected content |
| 54 | Implementation/evidence report | Complete; implementation, validation, history and early-wave reconstruction delivered and integrated |

The coordinator owns [TASKS.md](TASKS.md) and [AGENTS.json](AGENTS.json). Execution of a gate and completion of its report/assignment are distinct ledger facts.

## Expanded unit gate and fixture corrections

The first frozen checkpoint-7 run selected 127 files / 1,837 cases and produced **1,803 passes / 34 failures**. All 34 failing names were matched to passing exact-baseline assertions. Two cases expected revival after a terminal worker error; 32 came from partial renderer fixtures omitting newly owned resources. The three corrected files passed **42/42** and were published as checkpoint 8. [Initial/correction evidence](reviews/w09a-consolidated-gate.md).

Broader CI exposed a fourth file: unchanged surface-channel coverage passed 14/14 on exact baseline and 13/14 on checkpoint 8. The correction preserves two distinct contracts: the worker cannot revive after failure without fresh initialization; a direct SurfaceChannel can recover an attached failed post by fully rebasing the **same actual deformed terrain**. The corrected file passes **15/15**, including one added preservation case, with scoped lint/source stability. Checkpoint 9 publishes that test/workflow change. [Surface correction](reviews/w09a-surface-correction.md).

The final checkpoint-9 run completed at **04:42:19 UTC**, with **1,852/1,852 passing cases in 128/128 unique physical files**, zero failures/skips/TODOs/retries and no missing/duplicate/unexpected selected files. It took **330.01 seconds including the guard**. All **3,396 guarded inputs** remained unchanged; all **1,116 src files** still matched checkpoint 7. [Exact final summary](validation/w09a-final-results.json).

These results are not added to 42/42, 15/15 or earlier domain totals; those cases overlap the final selection.

## Published focused gate

Exact checkpoint 9, `9119c7683d821d145f15ed64a03ee3406595b58d`, passed **506 unit cases across 42 files**, full TypeScript and product build, source guards, and **37 native/replay cases** on verified Mesa llvmpipe. Unit duration was 97.03 seconds and browser duration 2.5 minutes. [Job 138981642796](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850414/job/138981642796); [retained metadata](validation/checkpoint9-ci.json).

Worker59 independently downloaded and hashed checkpoint 9's 1,178,621-byte focused artifact, verifying its source/build identity, archive integrity and all 37 detailed passing browser results. Its SHA-256 is `8653a669dac50a9d0d8ffce104b1b703b0083e227960f0f922bbbbb6aeb5297f`. [Final publication/CI review](reviews/w10e-publication-verification.md); [archive receipt](validation/w10e-artifact-archive-manifest.json). Worker52's separate checkpoint-7 artifact inspection remains dated historical evidence. Neither focused pass establishes that all repository workflows are green.

## Broader findings and scope

The latest inspected **05:06:13 UTC checkpoint-9** broader-CI snapshot retains **9,594 unit passes / four failures across 901 files**. Only the baseline-established content/i18n cases remain; all 35 task-associated fixture/contract failures are gone. Validate, offroad-scenarios, scenarios and wet-presentation passed; **16 browser jobs and four owner-QA jobs remained active**. [Latest status](validation/w10e-broad-status-summary.json); [unit reconciliation](validation/w10e-broad-unit-reconciliation.json); [exact run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850446).

Checkpoint-7 broad units produced 39 failures: 35 task-associated fixture/contract differences and four matching inherited content/i18n failures. Worker55 independently joins every observed failing name to its exact-baseline/corrected result or matching baseline failure, with zero unmatched cases. The same review accepts the four fixture corrections. [Regression triage](reviews/w10a-regression-triage.md).

Several graphics/garage symptoms match task-equivalent baseline logs. Night scenery's 300-second survey timeout has mixed prior pass/fail history and remains unresolved. The report retains those results rather than calling the full repository green. [Dated broad-CI matrix](VALIDATION.md#broader-repository-ci).

Worker53 reviewed 29 production files / 107 hunks and 3,883 protected leaves across seven named engine checkpoints. It found no forbidden authored-content/tuning/default-quality/dependency edit. Checkpoints 8 and 9 retain checkpoint-7 production source. [Scope review](reviews/w09e-protected-scope.md).

## Final local native evidence

The local run passed all **37 cases across nine files**, with zero retries/skips/flaky/failures, in 175.753 seconds. The replay passed in 133.586 seconds, retaining its 300-second deadline and genuine 8.5-second main-thread stall. Telemetry continued from 420 to 960 rows; seeking submitted exactly one new frame with zero presentation-time error. The verified SwiftShader build, all 3,396 guarded paths and all 266 dist files retained their exact identities. [Native receipt](validation/w09c-native-gate-manifest.json); [full validation scope](VALIDATION.md#completed-local-native-and-replay-gate).

Wave 10's independent claim/source/acceptance reviews and all sixty original assignments are complete in the synchronized [ledger](TASKS.md). [Final review outcomes](WAVE10.md) and [evidence index](EVIDENCE.md) connect those decisions to their receipts. The documentation-only publication receives a subsequent remote check by the same worker59; the tested checkpoint-9 code remains unchanged. None of these completed gates is relabeled as a whole-repository pass: the four inherited unit failures and the dated broader browser/scene limits remain visible.
