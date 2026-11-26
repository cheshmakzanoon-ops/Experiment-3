# Assignment 58 — final acceptance reconciliation

The completed local acceptance receipts agree on frozen runtime fingerprint
`4c041cb338d0fa480e0514ee905137a24061494b98b9899949238f6b137be790`
across 1,129 source/build inputs. This assignment updates the master
[README](../README.md) and [integration register](../integration.md) from completed
receipts and independently checks current file hashes. It does not rerun suites,
change production/tests/assets, mutate Git or publish the candidate.

## Completed gates

| Gate | Reconciled result |
| --- | --- |
| Final MX/offroad sweep | 155 distinct files, 1,736/1,736 tests pass; zero failed/skipped/todo. All eleven receipt-integrity checks pass. The completed run used no retry. |
| Shared-core suite | 181/181 tests in seven files, zero failed/skipped/todo. Its file-path intersection with the MX/offroad suite is empty. |
| Current inputs | All 162 final test-file hashes, 62 lint-input hashes and 1,556 full-sweep input hashes/modes still match their receipts. All 1,387 default-matrix input hashes/modes also match. These sets overlap and are not summed. |
| Original race gates | Eight full-grid scenarios pass with 96 finishers and no retirements; exact Valley four-lap event passes with 10 finishers and one total crash. |
| Unchanged default race matrix | All eleven original scenarios pass locally; exit 0, 458.699 seconds, no failed scenarios or changed inputs. `OFFROAD_RACE` is unset and no `--mx-full-grid` flag is used. |
| Preservation workload | Five non-MX cases, 6,005 complete snapshots and 16,477,720 bytes match, normalizing only simulation/category physics identity 39→41. |
| Tooling | Full production and changed engine/test type groups pass; ESLint passes 62 files; Vite builds 1,106 modules in 15.19 seconds. Earlier memory-limit failures remain historical; their required checks are now complete. |
| Independent reviews | Assignments 55 and 56 find no new concrete release blockers. The two architecture phase/frame clarifications from 56 remain in place. |

The master register keeps the 1,736 and 181 suite counts separate. Targeted runs
such as 66 player/traffic tests, 53 animation tests, 22 air-drag tests and 29 contact
tests overlap the broad sweep and contribute no additional unique-test count.
Observer state pairs and measured CPU calls are also not independent test cases.

Primary evidence: [46 final sweep](../evidence/46-final-engine-units.json),
[52 tooling/shared suite](../evidence/52-tooling-runtime-cost.json),
[49 races](../evidence/49-wet-race-regression.json),
[default-matrix receipt](../evidence/final-default-offroad-receipt.json),
[default-matrix raw results](../evidence/final-default-offroad-races.json),
[non-MX refresh](../evidence/final-preservation.json).
The [machine-readable reconciliation](../evidence/58-acceptance-reconciliation.json)
records receipt hashes and independent comparisons.

## Historical and publication boundaries

Assignment 46's earlier `a153c34d…` run remains 1,710/1,723 passing tests with 13
failures in six files. Assignment 47's 7/8 full-grid result remains a reproduced
regression at that source; assignment 49 supplies its accepted repair and final
race evidence. Interrupted runs, targeted repeats and historical failures are
excluded from final counts. The final source differs from `a153c34d…` only in the
AI traffic-priority guard.

Assignment 50's 291-file authored asset/reference comparison remains a historical
complete-tree audit against starting main `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`.
Final publication preflight must bind that preservation claim to the exact tree
sent. No character models, authored environment or other protected assets were
changed by this assignment.

At this handoff, assignments 01–59 have actually been spawned. Source/oracle
reviews 55–56 and reconciliation 58 are complete; 57's manifest and 59's preflight
are active. Assignment 60 remains planned at this recorded boundary. The master
ledger contains all ten requested waves, six assignment slots each, without
counting the separate incoming engine pass or relabeling planned work as done.

Main publication is pending. The latest recorded remote main is
`c9c94c7029dbc3e29b18101ef7ccea0a897184d1`, tree
`5e9fea61ed17d0709a192e2106ef20e161788ffc`. Local checkpoints are provenance, not
promised published API commit IDs. Root will record the actual publication and
assignment 60 will verify its remote commit/tree and observed checks.

The local eleven-scenario pass is separate from hosted CI. Assignment 54
attributes four pre-existing global-unit failure signatures at the baseline and
records no required branch checks/rulesets; it does not certify a newly green
global workflow. The entire global suite was not rerun by this assignment.
[CI attribution](54-ci-attribution.md)

Chromium still has no successful page startup under the observed OS socket
restriction. No gameplay screenshot, framebuffer, GPU or device-FPS acceptance
is claimed. The known compliant-work, cadence, sparse-pose and finite-margin
limits remain in the master documents. [Browser record](44-native-browser.md)


## Post-publication addendum — complete root TypeScript coverage

The sections above record assignment 58's original pre-publication handoff. The
engine was subsequently published as
`9b5fead87ae56902b138951e093c5f054b36d8a3`, with the integration record at
`2904ea226590e4f9c75b7e4aecf544c7b7f8fb15`. Hosted
[Build and validation run 45729738734](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45729738734)
then exposed four TypeScript diagnostics in two files from this pass. These are
**our type-check coverage gaps, not the separately attributed baseline failures**.
The previous full-production and selected dependency-group checks did not cover
all entries of root `tsconfig.json`, whose includes are `src`, `tests`, `e2e`,
`scripts` and root `*.ts` files. The earlier claims must be read with that scope.

The correction is deliberately confined to two files:

- `scripts/bench/motocross-rider-acceleration.ts`: `brakeReversal` now declares its
  trace as an array of rows with six numeric fields: `p`, `v`, `displacement`,
  `pose`, `rate` and `legacy`. Before/after TypeScript transpilation produces
  **byte-identical JavaScript**, SHA256
  `ce2f060645a4c3cc53865f793dfbb66cceb59a3dae48f34b752cfaf99086cb9c`.
- `tests/motocross-planar-transport.test.ts`: the spy captures the result of its
  single bound `original(...args)` call, samples the same `coreX`/`coreZ`, then
  returns that result to preserve the actual `BikeState` method contract.
  Every assertion, tolerance, fixture and original invocation order is unchanged.

### Verification of the correction

| Check | Actual result |
| --- | --- |
| Exact requested full root check, 2560 MiB heap | SIGKILL, subprocess exit −9 / shell equivalent 137, after 18.064 s; no diagnostics emitted. |
| Authorized serial full root retry, 2048 MiB heap | SIGKILL, exit −9 / 137, after 18.283 s; no diagnostics emitted. The root project/configuration was unchanged. |
| Strict two-file dependency check | Pass, exit 0, 2.921 s. Root compiler options inherited unchanged; initial inclusion narrowed to the two corrected files and their imports. |
| Affected planar test file | **16/16 pass**, zero failures/skipped/todo, 3.334 s. No assertions or test cases were added or removed. |
| Complete acceleration benchmark | Pass, exit 0, 5.008 s: three variants, 36 braking-reversal traces and six flight traces; all original assertions retained. |
| Focused ESLint | Both corrected files pass, exit 0, 0.797 s. |
| Runtime fingerprint | Still `4c041cb338d0fa480e0514ee905137a24061494b98b9899949238f6b137be790` across 1,129 inputs. |

The two full root attempts are resource-blocked local attempts, not passes. Their
empty logs do not prove that no further root-project diagnostics exist. Hosted
`validate` against the actual correction commit must establish that gate. No
further full-root retry, broad physics suite or npm lifecycle hook was run here.
The narrower strict check validates the two corrected dependency paths only.

The source boundary also changes for the earlier unit/lint receipts: exactly one
of the 1,556 full-sweep inputs, the planar test, now has a new hash. There are
1,554 unchanged materialized inputs plus one unchanged tracked sparse fixture,
`docs/production/motocross-reference-review-20261017.json`; its HEAD blob content
and mode match the accepted input, although it is no longer materialized after
root's CI-report fast-forward. The former full-unit result remains **1,736/1,736
at its original test hashes**. The corrected 16-case rerun is replacement evidence
for that file and is not added to the full-suite count. Both changed files were
among the 62 lint inputs: 60 retain their old hashes, and the other two now have a
fresh passing focused lint result.

The [correction receipt](../evidence/58-root-types-correction.json) records original
and current hashes, exact commands, timing, exits, logs, emitted-JavaScript proof
and the changed-input boundary. [Planar results](../evidence/58-planar-tests.json),
[benchmark output](../evidence/58-rider-acceleration-output.json) and the
[strict dependency configuration](../evidence/58-type-correction-tsconfig.json)
retain the actual observations. Root owns correction publication, current master
README/integration status and hosted-CI follow-up. This continuation edits no
production source, model, character, environment or protected asset and performs
no Git mutation.
