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
