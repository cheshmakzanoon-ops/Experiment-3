# Worker59 / W10E — remote publication and exact final CI verification

Initial handoff completed **2026-11-25 05:06:13 UTC**. This is Wave 10, assignment 5, distinct worker 59 of the requested 60. Final documentation publication is **pending and is not verified by this handoff**.

## Decision

**Accept publication and evidence continuity through tested code/test checkpoint 9, `9119c7683d821d145f15ed64a03ee3406595b58d`, tree `3b704f846c3283c21e73f8f5c3febf670a773c63`.** All nine actual published checkpoint identities match the remote Git objects and the locally retained objects. The remote parent chain includes every checkpoint and the exact task baseline. The final focused CI job and its downloaded artifact are independently verified successful.

The broader workflow remains incomplete and is not green. The four completed full-unit shards have **9,594 passing / four failing tests across 901 files**, with all four failures matching the previously established content/i18n baseline failures. At the latest **05:06:13 UTC** job snapshot, **16 browser jobs and four owner-QA jobs remain in progress**.

I made no repository edit, Git mutation, workflow action, test, compiler, build, benchmark or browser run. Only metadata, source text, retained logs and the small focused artifact were read. New report/evidence files are under the requested external paths.

## 1. Actual published commits and retained concurrent history

Repository: [cheshmakzanoon-ops/Experiment-3](https://github.com/cheshmakzanoon-ops/Experiment-3).

Task baseline: [`1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb), tree `9be30d69c06ac08f9eec038334ad0f8bbd65b13b`.

I fetched each checkpoint with GitHub's Git commit endpoint. These are actual remote commits, not unpublished local equivalents.

| Checkpoint | Actual remote SHA | Remote tree | Actual parent |
| ---: | --- | --- | --- |
| 1 | `85ae215329ee1bd1ccc66540cece0cda72d197f7` | `f0bfcb614006d98d6c8241c8578decf3b323c5fd` | `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb` |
| 2 | `5185010e6538d8a9095aca9c4e7964817147e1a1` | `a0b7a4446dc9f8b477f9d7a34443d044ca560df7` | `74175b6a3ae7f87a4161c6e9774b9326cca4a08d` |
| 3 | `25a837597de0159a32e2e5d8bad2e9ac74977c22` | `40dc98ab64f8b348992e285cd5ec060f0a78596b` | `1bc5a51ecf83b34e35e17a6f4e7a0f52f01a06d1` |
| 4 | `f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6` | `98ae35c4ec253987e6897ebc13a55dee2c1afb21` | `0d6032c0ff2798fe667ec26853806e4b4c9cb0ba` |
| 5 | `0f7fecfda61ea7e669f04eebd138c52543144421` | `831bde9df0759e078ae26c8ca289b1da116bb0ad` | `37d6f5bd52d1444958528ea058383d2dfe5ef09b` |
| 6 | `6314ba3ec7d54a0ba1e79a59b8db8f03117e4520` | `18766f8bf4dbfed1bcec2d2917d760df535f94c8` | `bd1d6e9457556048a7651f468e9eb04a2ab27055` |
| 7 | `6a6bf02eb2d89eeb6aeff32769ef3deb4a49f17c` | `e6d37727eb695278c4934fa11365d6d014c40db6` | `7f4b55d88b5ef22f457e94016537be462dd25f7b` |
| 8 | `811ac2bc92f4494b1ec99d1fc4201101ccf34c66` | `bcb8ac50d931448e1d321f76d5fbb092c89d1cf1` | `011b3db0f7204ea59c4efb3aac0e4f1e77ed3c4e` |
| 9 | `9119c7683d821d145f15ed64a03ee3406595b58d` | `3b704f846c3283c21e73f8f5c3febf670a773c63` | `ec7f7ce0dc4361d27aa0ae141f7ca216d4c261e6` |

The [remote main](https://github.com/cheshmakzanoon-ops/Experiment-3/tree/main) read at 05:06:13 UTC was **`350119e8ec0606e8c5de5b3ab80df41104025679`**, tree **`2224939844137abcd06d1aed0d9618f74e05dc18`**, a direct child of checkpoint 9: its parent is **`9119c7683d821d145f15ed64a03ee3406595b58d`**. It is a `ci-report[bot]` build-report commit, not another engine checkpoint.

I checked the exact **26 parent edges** from that main revision back to the task baseline using the returned remote commit chain. All edges are single-parent, connect to the next recorded SHA, and include all nine programme checkpoints. The remaining **17 commits** are concurrent report-bot updates. Root-tree comparisons confirm that each of those changes only `ci-reports`. At **each of the nine programme commits**, its `ci-reports` tree equals its actual parent's `ci-reports` tree. Thus programme publication retained the intervening report work. The observed main commit similarly changes only that root directory.

Local `git cat-file -p` confirms the remote tree and parent metadata for every programme checkpoint. The remote first-checkpoint parent explicitly proves its connection to the baseline even though local history traversal stops at the shallow boundary. No missing historical report blob was fetched to establish any of these facts.

Evidence: [commit-summary.json](../validation/w10e-commit-summary.json), [checkpoint1-commit.json](../validation/w10e-checkpoint1-commit.json) through [checkpoint9-commit.json](../validation/w10e-checkpoint9-commit.json), [main-history.json](../validation/w10e-main-history.json), `main-snapshot.json`, [main-close-snapshot.json](../validation/w10e-main-close-snapshot.json), [main-tree.json](../validation/w10e-main-tree.json), and [ancestry-and-preservation.json](../validation/w10e-ancestry-and-preservation.json) in `w10e-work/`.

## 2. Exact source and fixture/workflow continuity

The complete production `src` subtree at checkpoints **7, 8, 9 and the observed remote main** is:

```text
ad28ec3acb55feb301e13232614a14c4230abcae
```

It contains **1,116 tracked source leaves**. The same tree identity includes modes, path names and every descendant object identity. There are **29 production files changed from the task baseline**, the same reviewed set established by worker53. No additional production change occurs at checkpoints 8 or 9.

The entire checkpoint-7-to-checkpoint-9 programme delta is exactly these five paths:

| Path | Scope |
| --- | --- |
| `.github/workflows/engine-runtime-validation.yml` | Add the four adjacent fixtures to push triggers and the existing focused unit command |
| `tests/circuit-frame-transport.test.ts` | Fatal-worker terminal ownership and fresh-initialization fixture expectations |
| `tests/circuit-preparation-lifetime.test.ts` | Supply the owned real OutputPass fixture |
| `tests/festival-renderer-loader-lifecycle.test.ts` | Supply the newly owned renderer resources and preserve cleanup assertions |
| `tests/surface-channel-backpressure.test.ts` | Terminal worker expectation and an independent same-terrain full-rebase case |

Checkpoint 8 changes the first workflow plus the first three tests relative to its actual parent: **four paths**. Checkpoint 9 changes that workflow and the surface test relative to its actual parent: **two paths**. Across 7–9, all remaining differences are **31 concurrent `ci-reports/**` paths**. Every other tracked path retains its checkpoint-7 identity.

The workflow diff consists only of four trigger paths and the corresponding four test arguments. Existing direct tool entry points, source guards, the browser selection, single-worker execution, retry settings, deadlines and assertion policies are retained. Worker55's detailed fixture-contract review remains the substantive explanation of the corrected ownership expectations; this worker independently checked the published delta and final outcomes.

This extends worker53's authored-content protection proof to the tested final revision: unchanged after checkpoint 7 are the reviewed production source, authored models, characters, environment definitions, geometry/material/texture definitions and assets, vehicle tuning, catalogues, tracks, lockfiles and broad workflows. The earlier five rendering implementation exceptions remain resource lifecycle changes; a blanket statement that every environment-folder file is unchanged would still be inaccurate.

Evidence: [source-and-fixture-continuity.json](../validation/w10e-source-and-fixture-continuity.json), [focused-workflow.yml](../validation/w10e-focused-workflow.yml), [focused-workflow-after7.patch](../validation/w10e-focused-workflow-after7.patch); detailed earlier reviews [protected scope review](w09e-protected-scope.md) and [regression review](w10a-regression-triage.md). The four inherited failing test files also independently retain identical baseline/final blob identities in [broad-unit-reconciliation.json](../validation/w10e-broad-unit-reconciliation.json).

## 3. Independently downloaded focused evidence

[Focused run 45547850414](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850414), attempt 1, is **completed / success** on exact checkpoint 9. Its only [job 138981642796, native-and-replay](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850414/job/138981642796) completed successfully at **04:41:43 UTC**; the run was updated at 04:41:44 UTC. Every recorded job step concluded success.

| Identity | Independent verification |
| --- | --- |
| Artifact | [14993021540](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850414/artifacts/14993021540), `engine-runtime-validation-9119c7683d821d145f15ed64a03ee3406595b58d` |
| Downloaded archive size | **1,178,621 bytes** |
| Downloaded SHA-256 | **`8653a669dac50a9d0d8ffce104b1b703b0083e227960f0f922bbbbb6aeb5297f`** |
| API/upload/download agreement | API digest, upload log digest and independently hashed ZIP bytes agree |
| Archive integrity | All outer ZIP members and embedded Playwright ZIP members pass CRC checks |
| Artifact expiry | 2026-12-02 04:41:41 UTC; unexpired at inspection |
| Embedded source commit | `9119c7683d821d145f15ed64a03ee3406595b58d` |
| Embedded source tree | `3b704f846c3283c21e73f8f5c3febf670a773c63` |
| Build identity | Same commit, variant `product`, edition `full` |
| Build fingerprint | `c504fad0736d361bbeb79bf6ef4d64bafe2200329c064525c5dc60066729d7fe` |
| Package-lock SHA-256 | `610c1768c440c202a4e37f62d22467d4cbbddc44a5962e82bb256dcfb8627edf`; matches the exact committed lock blob |
| Independently fetched job log | **121,523 bytes**, SHA-256 `523858335536e8fee012c328d58ddaaa1e8c1d074c9f7ec633a87ba9a854ae9e`; byte-identical to coordinator's `checkpoint9-ci.log` |

The embedded Playwright report metadata independently names the same commit and run. Its replay diagnostic also identifies the same build fingerprint and commit. The full artifact was downloaded through the connected GitHub artifact tool and then read from the returned temporary file URL. No large unrelated failure artifact was downloaded.

### Actual focused gate results

| Gate | Verified result | Scope and qualification |
| --- | --- | --- |
| Locked installation | Successful guarded `npm ci` step | No root install generator hook; this is the focused job |
| Focused unit contracts | **506 passed / 42 files**, 97.03 seconds | Existing engine test selection plus all four corrected fixtures |
| TypeScript | Direct `tsc --noEmit` succeeds | Whole-project compiler; followed by build using shell `&&` |
| Production build | Direct Vite build succeeds; IP guard reports clean | Artifact retains exact build identity; existing large-chunk warning remains |
| Native browser and replay | **37 passed / 9 files**, 149.156 seconds | 36 focused native cases plus one full-game replay journey |
| Source guards | Installation, units, compiler/build and browser commands succeed under guard | Guard exclusions below still apply |
| Evidence retention | Upload succeeds and exact archive verified | Artifact expires after the stated retention window |

I parsed every detailed browser result, not only the console summary. There are **37 expected outcomes, zero unexpected, zero flaky, zero skipped, zero report errors**. Each case has **exactly one result**, `status=passed`, `retry=0`, and no result error. All nine file summaries agree.

The final replay case took **106,465 ms**. Its retained stall receipt records an **8,500 ms** main-thread stall, telemetry **420 → 960**, replay availability **6.9333333969 → 15.9333343506 seconds**, and no recording warnings. The first seek presentation advances frames **21 → 22** in one callback. These observations support exercised correctness, not a throughput or physical-hardware claim.

The backend receipt is **ANGLE (Mesa, llvmpipe (LLVM 20.1.2 256 bits), OpenGL 4.5)**. It explicitly records `softwareRendererDetected=true`, `physicalHardwareValidated=false`, expected pixel bytes `[64,128,191,255]` and WebGL error zero.

The unchanged source guard excludes the generated supplied-player LOD output and root browser receipts. A successful guard is not proof that every possible generated/untracked asset remains untouched. The focused commands avoid npm pretest/prebuild generation hooks; unchanged broad repository workflows are a separate execution policy. No physical-GPU FPS/frame-time, peak game heap/GC, other-browser or whole-engine performance result is claimed.

Evidence: `checkpoint9-engine-runtime-validation.zip`, [artifact-list.json](../validation/w10e-artifact-list.json), [artifact-archive-manifest.json](../validation/w10e-artifact-archive-manifest.json), [focused-run.json](../validation/w10e-focused-run.json), [focused-jobs.json](../validation/w10e-focused-jobs.json), [focused-job.log](../validation/checkpoint9-ci.log), [focused-evidence-review.json](../validation/w10e-focused-evidence-review.json), parsed [playwright-report.json](../validation/w10e-playwright-report.json), `playwright-replay-report.json`, [recording-stall-continuity.json](../validation/w10e-recording-stall-continuity.json), `replay-ownership.json`, backend/build receipts and embedded unit/build/browser logs.

## 4. Latest broader CI status and complete unit accounting

[Build and validation run 45547850446](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850446) belongs to exact checkpoint 9. Its run read at **05:02:15 UTC** was `in_progress`, with no conclusion. The refreshed **05:06:13 UTC** job snapshot contains all **28 jobs** (`per_page=100`, response total count equals returned count):

- **Six completed successfully:** validate, offroad-scenarios, scenarios, wet-presentation, unit shard 2 and unit shard 4.
- **Two completed with failure:** unit shard 1 and unit shard 3.
- **Twenty still in progress:** all 16 browser shards and all four owner-QA shards.

There are no queued jobs in this latest job snapshot. Earlier reports of queued browser work are dated earlier observations.

I parsed all four retained final unit logs, hashed the original bytes and independently reconciled their summaries:

| Shard / job | Files passed / failed | Tests passed / failed |
| --- | ---: | ---: |
| [1 / 138981755573](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850446/job/138981755573) | 224 / 2 | 2,431 / 2 |
| [2 / 138981755831](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850446/job/138981755831) | 226 / 0 | 2,418 / 0 |
| [3 / 138981755850](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850446/job/138981755850) | 224 / 2 | 2,494 / 2 |
| [4 / 138981755930](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45547850446/job/138981755930) | 223 / 0 | 2,251 / 0 |
| **Total** | **897 / 4 across 901 files** | **9,594 / 4 across 9,598 tests** |

There are zero reported skipped unit cases. The only four failed named cases are the previously baseline-established livery, vehicle-catalogue/calibration, i18n dictionary and vehicle-catalogue-growth assertions. Their filenames, full failed-case names and baseline/final blob identities are retained in [broad-unit-reconciliation.json](../validation/w10e-broad-unit-reconciliation.json). Worker52 and worker55 supply the actual baseline failure comparisons, not an inference from unchanged test names.

The **35 task-associated fixture/contract failures from checkpoint 7 are absent** from these complete final unit partitions. One additional surface-channel case explains the total rising from 9,597 to 9,598 tests. This supports closure of the observed unit regression set; it does not convert the four inherited failures into passes.

At the exact-SHA workflow query there are five runs: the focused run succeeds, CI-report generation succeeds, broader Build and validation is in progress, and the deployment/release workflows are skipped. A CI-report success is not broad validation success; skipped publication/deployment does not establish a deployed playable release.

The earlier independent browser triage in [earlier published-CI review](w09d-published-ci.md)/[regression review](w10a-regression-triage.md) remains qualified. Matched baseline symptoms remain matched historical symptoms. The night scenery timeout has mixed history and unresolved cause. The newer running browser/owner-QA jobs have no completed pass evidence and must not be described as green.

Evidence: `checkpoint9-runs.json`, `broad-run.json`, `broad-jobs.json`, `broad-jobs-close.json`, timestamps, [broad-status-summary.json](../validation/w10e-broad-status-summary.json), [broad-unit-log-review.json](../validation/w10e-broad-unit-log-review.json), [broad-unit-reconciliation.json](../validation/w10e-broad-unit-reconciliation.json); underlying raw logs remain in `checkpoint9-broad/`.

## 5. Final documentation publication follow-up

This worker is ready to return on the **same assignment** after the coordinator publishes the final documentation/evidence commit. That follow-up is not a new worker and must not be counted as worker61.

The remaining procedure is:

1. Receive the actual final documentation commit SHA and expected tree from the coordinator; fetch that remote Git commit plus a fresh main branch snapshot.
2. Verify its actual parent and complete parent inclusion back through checkpoint 9. If report bots have advanced main, establish that the documentation commit remains in main's parent chain and identify the later report commits.
3. Compare the final documentation commit with its actual parent. Confirm its own delta is the authorized documentation/evidence set and that its `ci-reports` tree equals its parent's tree.
4. Confirm the entire tested production `src` tree remains `ad28ec3acb55feb301e13232614a14c4230abcae`; compare tests, e2e, scripts, workflows, dependencies, configuration and authored assets with checkpoint 9. Explain any documentation-tree change separately from executable inputs.
5. Read the actual published report/ledger metadata needed to connect the sixty-worker record and the final source/evidence identities. Distinguish the documentation commit's full tree from the exact checkpoint-9 tree that produced the validated artifact.
6. Take a final dated broader-CI snapshot and report actual completion/failure/pending states. No test rerun, force push, merge or approval flow is needed for this read-only verification.

Until that follow-up occurs, this report verifies only the nine checkpoints and the observed report-bot main head. It makes **no claim that a future documentation commit has been published or verified**.

## Operations and reproducibility

`python /tmp/engine-c71f32882729/w10e-work/review-evidence.py` reproduces the core metadata, ancestry, source-tree, artifact and saved-log checks without running project code. It completed successfully. Additional short parsing reconciled the four unit totals and failing-test identities.

Every local Git command used **`GIT_NO_LAZY_FETCH=1`**, **`GIT_OPTIONAL_LOCKS=0`**, **`GIT_ALLOW_PROTOCOL=none`** and **`-c protocol.allow=never`**. Only tree/commit metadata, an existing lock blob, and the explicitly selected focused workflow text/diff were read. No historical binary diff, lazy fetch, Git mutation, source edit, compute lease or message to another person occurred. [operations.json](../validation/w10e-operations.json) records the reproducible script's operations.

**Worker59 initial verification complete; slot released for worker60/final integration. Await same-worker publication follow-up.**

