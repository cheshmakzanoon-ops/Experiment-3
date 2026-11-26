# Assignment 54 — CI attribution and publication boundary

Wave 9 · observed 26 November 2026, 00:06–00:08 UTC.

## Result

**Live `main` still points to `c9c94c7029dbc3e29b18101ef7ccea0a897184d1`; no new upstream source needs reconciliation at this observation. The latest relevant hosted build is failed, and the current candidate has not yet been published or tested by hosted CI.**

The candidate source fingerprint observed locally is `4c041cb338d0fa480e0514ee905137a24061494b98b9899949238f6b137be790`, over the same 1,129 Vite fingerprint inputs. Local checkpoint `b2879248…` is audit provenance, not the eventual publication commit. Evidence: [54-ci-attribution.json](../evidence/54-ci-attribution.json).

## Independent remote reads

| Observation | Result |
| --- | --- |
| [Main branch](https://api.github.com/repos/cheshmakzanoon-ops/Experiment-3/branches/main) | `c9c94c7029dbc3e29b18101ef7ccea0a897184d1` |
| Main tree | `5e9fea61ed17d0709a192e2106ef20e161788ffc` |
| Branch protection response | `protected: false`; protection disabled; required status-check contexts/checks empty |
| [Repository/inherited rulesets](https://api.github.com/repos/cheshmakzanoon-ops/Experiment-3/rulesets?includes_parents=true) | Empty list |
| [Build and validation 45700444387](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45700444387) | Completed, **failure** |
| That run's exact source | `2578271913c264f5ffd6131afea30723df14b65b` |
| Run interval | Started 25 November 21:01:22 UTC; updated 22:25:02 UTC |

The exact Git diff from that source to integrated main contains only 24 `ci-reports/` paths. Production source, tests, assets and workflows are identical across those two refs. This is stronger than inferring code equality from the CI-report commit messages.

These branch observations establish no additional required GitHub merge checks at the time read. They do **not** turn a branch update into a validated playable release: the repository's publication workflows retain their separate successful-CI requirements.

## Existing hosted failures

| Job group | Verified baseline result |
| --- | --- |
| `validate`, `scenarios`, `unit-tests (2)`, `unit-tests (4)`, `wet-presentation` | Success |
| `offroad-scenarios` | Failure |
| `unit-tests (1)` and `unit-tests (3)` | Failure: two assertions in each partition |
| All 16 `browser` shards | Failure |
| All four `owner-qa` shards | Failure |
| `publish` | Skipped |

The 29-job response therefore contains five successes, 23 failures and one skipped job. The [tracked summary at the inspected ref](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/c9c94c7029dbc3e29b18101ef7ccea0a897184d1/ci-reports/build-and-validation.md) agrees with the live API.

The exact stored logs establish these four broader unit failures:

| Test | Existing assertion signature |
| --- | --- |
| `apx01-livery.test.ts` | A player wing material has `turned-alloy` where the assertion requires its absence. |
| `vehicle-catalogue.test.ts` | The stored GP-R1 calibration hash is `eca1c71a`; the current definition hashes to `5f121c00`. |
| `vehicle-catalogue-growth.test.ts` | The frozen GP-R1 hash is `eca1c71a`, while the definition produces `5f121c00`. |
| `i18n.test.ts` | Fourteen missing entries: two GP rear-brake keys across seven translated dictionaries. |

Primary log records: [unit partition 1](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/c9c94c7029dbc3e29b18101ef7ccea0a897184d1/ci-reports/logs/build-and-validation/unit-tests-1.log) and [unit partition 3](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/c9c94c7029dbc3e29b18101ef7ccea0a897184d1/ci-reports/logs/build-and-validation/unit-tests-3.log).

All four test files remain byte-identical in the current candidate. The `contentHash`, `canonical` and `vehicleHash` function block is also exactly unchanged from the CI source; the new simulation identity does not change that hash algorithm. The earlier, separate upstream [assignment 42](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/c9c94c7029dbc3e29b18101ef7ccea0a897184d1/docs/engine/motocross-dynamics-2026-11-25/agents/42-baseline-ci.md) independently reproduced the same 48 passes and four failures against both of its then-current and original checkouts.

This attribution confirms the failures existed before this candidate. It is **not** a fresh current-candidate global unit run, and no current global green result is claimed. Fixing protected car materials or specifications to conceal these failures would exceed this task's scope. The individual root causes of the 20 failed browser/owner-QA jobs were not re-diagnosed here.

## Offroad evidence must retain its exact scope

The [original offroad log](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/c9c94c7029dbc3e29b18101ef7ccea0a897184d1/ci-reports/logs/build-and-validation/offroad-scenarios.log) identifies `event valley-ridge-mx-moto-1`: rider 9 crashed three times in four laps, exceeding the two-crash allowance. Its events were contact at 518.5 m / 65.0 s, front crash at 593.8 m / 182.5 s, and contact at 182.9 m / 413.4 s.

Current [assignment 49](49-wet-race-regression.md) reruns that exact event successfully on `4c041cb3…`: ten finishers, one total crash and 386.67 seconds. It also passes all eight original `--mx-full-grid` cases. That is a measured improvement over the identified failure, not a retroactive pass for the old hosted run.

The actual CI job unsets `OFFROAD_RACE` and runs the original **default** `scripts/offroad-races.ts` matrix after calibration. That includes other course/event cases, such as the longer Valley second moto and Arena event; it is not the `--mx-full-grid` selection. The eight full-grid cases plus the singled-out four-lap event therefore do **not** certify the entire hosted `offroad-scenarios` job. A new hosted run or a separate unchanged default-matrix execution must supply that result.

## After publication

1. Read the actual remote branch and commit/tree. Preserve any later CI-report child commits; use their source-tree identity to distinguish reporting changes from engine changes.
2. Find the `Build and validation` run by the exact published source commit, not merely the latest workflow or a later report-only commit. Record its URL, SHA, status and conclusion.
3. Inspect the complete job set: validation, four unit partitions, scenarios, default offroad scenarios, 16 browser shards, wet presentation and four owner-QA shards. Keep each failure visible. CI uses Node 22, whereas these local execution receipts use Node 24.22.3.
4. Report source publication separately from playable deployment. `ci.yml` makes its publish job depend on all seven job groups; the Pages/CDN workflows also require a successful matching `Build and validation` run. A CI-report commit or a successful local build is not that certification.

The main CI workflow cancels an older in-progress run on a new relevant push to the same branch. Its short `paths-ignore` list does not cover this engine-report folder. A later documentation receipt therefore needs deliberate coordination with the coordinator's publication sequence; this assignment changes no workflow, branch policy or gate.

Local [assignment 44](44-native-browser.md) never reached a page because the operating system rejected Chromium's socket creation. It supplies no gameplay, framebuffer or GPU acceptance. Hosted browser failures, the local launch restriction and the current CPU motion tests are three different evidence categories.

## Work performed

Five read-only GitHub requests retrieved the branch, rulesets, exact baseline run, all 29 jobs and the latest 12 workflow runs. Local Git-object reads confirmed the baseline-to-main report-only diff, exact failure signatures and unchanged test/hash-function inputs. No test suite, calibration, build, browser, git mutation, source change, asset generation or external message was performed. This assignment authored only this report and its compact JSON receipt.
