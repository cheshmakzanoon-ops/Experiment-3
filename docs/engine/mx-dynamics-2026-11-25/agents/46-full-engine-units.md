**Final acceptance, 2026-11-26: PASSED.** The final run contains 155 distinct files and 1736 test cases: 1736 passed, 0 failed, 0 pending and 0 todo. The earlier sweep below is preserved as historical evidence.

# Assignment 46 — Full motocross/offroad unit sweep

**Result: completed with blockers.** The effective union contains **154 distinct test files and 1723 test cases**. Assertion statuses: {'passed': 1710, 'failed': 13}. File statuses: {'passed': 148, 'failed': 6}.

## Source and input identity

Every completed run began and ended on Vite-compatible source fingerprint `a153c34d852b156d5638b2175766e5f22135aa9045af2796cd2e7d9afdd5f9d0` (1,129 source/configuration inputs). Fresh repository discovery matches the effective file union, and every effective test-file SHA-256 was rechecked immediately before this report.

| Runtime file | SHA-256 |
| --- | --- |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `7a72b2747d4469bc652ce965afab4a8f94a7b1606073291c6d36045182b9361e` |
| `src/simulation/offroad/mx-ground-physics.ts` | `68b04234548a2b037f4769d38343c26ec712a61fd9261fd6dac44641c81ca4e3` |

The raw receipts include byte hashes and permission modes for source, selected tests, local imported helpers, protected static inputs and configuration. Each run records before/after manifest digests and every observed change. Reports and test outputs are outside the observed input set.

## Commands and counting

The installed Vitest entrypoint was called directly with one worker and a 1,024 MiB Node heap limit. No npm lifecycle hooks, build, install, server restart or git mutation was used. The evidence JSON contains each complete argv array and shell-rendered command, including the explicit selected-file list.

| Run | Files | Test cases | Passed | Failed | Vitest exit | Seconds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `full` | 154 | 1723 | 1710 | 13 | 1 | 636.93 |

Vitest describe-suite totals are not file totals. File counts come from distinct `testResults[].name` entries; test counts come from their assertion results. If a targeted rerun supersedes an earlier file, that file contributes only its latest result to the union.

## Interrupted first attempt

The original 153-file attempt excluded the wheel-pickup file while assignment 45 owned it. After a context/session interruption, its session was unavailable, its log had stopped after 11 files, and no final Vitest JSON or completion receipt existed. Those partial results are preserved and excluded from all final totals. All previously observed input hashes/modes still matched at recovery. Root authorized one restart. Before that restart, assignment 45 released the pickup file, so the restarted run explicitly selected all 154 files.

## Exact sparse-fixture restoration

`docs/production/motocross-reference-review-20261017.json` was absent at restart even though its earlier restoration had been recorded. The reference-review test imports it directly. Before that suite ran, the exact tracked blob was restored from HEAD `38661da60a46e72cc0b76e179a25ae8ee49e6294` and verified byte-for-byte. Its SHA-256 is `b3f0d6c6c5d8711d2cb73c1c45aa500ba898342110a8214013261b5c2e2484b1` (Git blob `a4f050f5039c5a1402fe4fcc3624e2facfcb0ab1`). The full-run input manifest records this one added fixture explicitly. The harness returns a nonzero audit status for any input-manifest change; the evidence separately retains the actual Vitest exit status. This authorized restoration did not change runtime, test assertions or protected assets.

## Failures and disposition

- `tests/motocross-air-drag.test.ts` (`full`): production motocross flight drag 'mx250' 'player' integrates the existing force and travel without steering its free mass. AssertionError: expected 10.04177462770485 to be close to 10.041774627667458, received difference is 3.739231146937527e-11, but expected 5e-12. Final effective file status: `failed`.
- `tests/motocross-air-drag.test.ts` (`full`): production motocross flight drag 'mx450' 'player' integrates the existing force and travel without steering its free mass. AssertionError: expected 10.107995029045007 to be close to 10.107995029006009, received difference is 3.89981380521931e-11, but expected 5e-12. Final effective file status: `failed`.
- `tests/motocross-collision.test.ts` (`full`): motocross barriers between adjacent stadium lanes projects a deep manual terrain contact without an impossible launch in raw. AssertionError: expected 'loop-out' to match /^crash-/. Final effective file status: `failed`.
- `tests/motocross-collision.test.ts` (`full`): motocross barriers between adjacent stadium lanes projects a deep manual terrain contact without an impossible launch in sport. AssertionError: expected +0 to be 1 // Object.is equality. Final effective file status: `failed`.
- `tests/motocross-collision.test.ts` (`full`): motocross barriers between adjacent stadium lanes reconstructs a projected median contact and its remaining stroke from logged inputs. AssertionError: expected +0 to be 1 // Object.is equality. Final effective file status: `failed`.
- `tests/motocross-dynamic-suspension.test.ts` (`full`): live motocross suspension timestamps 'mx450' on 'valley-ridge-mx' at 120 Hz publishes the current pose through full travel and rebound. AssertionError: expected false to be true // Object.is equality. Final effective file status: `failed`.
- `tests/motocross-dynamic-suspension.test.ts` (`full`): live motocross suspension timestamps 'mx450' on 'valley-ridge-mx' at 240 Hz publishes the current pose through full travel and rebound. AssertionError: expected false to be true // Object.is equality. Final effective file status: `failed`.
- `tests/motocross-hard-stop-integration.test.ts` (`full`): the live motocross hard-stop consumer 'mx250' applies one physical impulse before compliant spring/gravity work. AssertionError: flat, airborne=false: expected [ …(2) ] to have a length of 1 but got 2. Final effective file status: `failed`.
- `tests/motocross-hard-stop-integration.test.ts` (`full`): the live motocross hard-stop consumer 'mx450' applies one physical impulse before compliant spring/gravity work. AssertionError: flat, airborne=false: expected [ …(2) ] to have a length of 1 but got 2. Final effective file status: `failed`.
- `tests/motocross-hard-stop-integration.test.ts` (`full`): the live motocross hard-stop consumer 'mx250' reaches the coupled stop through the unmodified stadium median approach. AssertionError: expected 177.99991401255608 to be 177.9999135958894 // Object.is equality. Final effective file status: `failed`.
- `tests/motocross-hard-stop-integration.test.ts` (`full`): the live motocross hard-stop consumer 'mx450' reaches the coupled stop through the unmodified stadium median approach. AssertionError: expected 184.49983629682907 to be 184.49983444863014 // Object.is equality. Final effective file status: `failed`.
- `tests/motocross-joint-reversal.test.ts` (`full`): 'mx450' on 'valley-ridge-mx' 'jump' restores measured extrema within mechanical travel. AssertionError: expected 1 to be +0 // Object.is equality. Final effective file status: `failed`.
- `tests/motocross-live-pose-coherence.test.ts` (`full`): 'mx450' 'valley-ridge-mx' 'jump' carries the current pose into real joints at both publication rates. AssertionError: expected false to be true // Object.is equality. Final effective file status: `failed`.

Exact assertion messages and stack locations are retained in `failureHistory` in the evidence JSON and the raw Vitest JSON. No tolerance or runtime adjustment was made by this assignment.

## Read-only collision diagnosis

The three original collision fixtures were reproduced separately without assertions or production edits. That diagnostic is not counted as unit tests. Its source fingerprint matched before and after, and no observed input changed.

| Original direct approach | Maximum CG height (m) | Maximum absolute vertical speed (m/s) | Crashes |
| --- | ---: | ---: | ---: |
| `raw` at 240 Hz | 3.166229761 | 5.228038420 | 1 |
| `sport` at 240 Hz | 3.149032006 | 5.228094223 | 0 |

The logged-input case detects the deep projection at tick 30 (maximum correction 0.175158928 m), records 0 crashes, and reproduces both the rewind frame (`True`) and final frame (`True`) exactly. The original height/speed envelope remains satisfied. These observations identify changed crash-cost assumptions; they do not independently authorize weakening the original tests. Root retains disposition of all failures.

## Deliverables and limits

- `docs/engine/mx-dynamics-2026-11-25/evidence/46-full-engine-units.json`: source identity, commands, distinct union counts, effective per-file SHA-256 and results, failure history, input-manifest digests and the exact fixture-restoration exception.
- `test-results/agent46/`: full machine-readable Vitest JSON, before/after audit receipts, readable logs, interrupted-attempt evidence and the local runner.

The selected basename scope includes existing rendering and environment contracts as read-only regression checks; no models, character assets, authored environments or production code were edited. Unit success establishes the recorded numerical/behavioral contracts, not photorealism or subjective animation quality. Native-browser validation belongs to assignment 44 and is not counted here.

Generated: 2026-11-25T23:43:37.305551+00:00.

## Final acceptance sweep — 2026-11-26

**PASSED: 155 distinct files and 1736 test cases.** File statuses: {'passed': 155}. Assertion statuses: {'passed': 1736}. Pending: 0; todo: 0.

This one complete run took **608.81 seconds**, from `2026-11-26T00:03:40.445044+00:00` to `2026-11-26T00:13:49.296285+00:00`. Its exact command arguments and explicit selected-file list are recorded in `evidence/46-final-engine-units.json`. The installed Vitest entrypoint ran directly with `--maxWorkers=1` and a 1,024 MiB Node heap. The final totals exclude the interrupted attempt, the historical full sweep and all overlapping targeted runs.

### Final source and input identity

Expected source fingerprint: `4c041cb338d0fa480e0514ee905137a24061494b98b9899949238f6b137be790`. It matched before execution, after execution and at report generation: `True`. The source manifest contains 1,129 entries. The final audit observed 1,556 total input files; changed during the run: `[]`; changed before this report: `[]`.

Separate before/after manifests under `test-results/agent46/final-*` record source, selected tests, protected static inputs and dependencies, including permission modes. Their file hashes and entry counts are retained in the compact final evidence. Fresh basename discovery exactly matches the completed result set: `True`.

Relative to the historical source, these runtime inputs differ:

- `src/simulation/offroad/ai.ts`: `701fa894de6ae3455ce5cbef1f0351478691815883443b6d158e324775407260` → `48b1a697e912e999dc04b423bdf3fab1fdf0204c7f656717d2063ea311e94462`.

### Previously failing files in the final run

| File | Final cases | Status |
| --- | ---: | --- |
| `tests/motocross-air-drag.test.ts` | 22 | passed |
| `tests/motocross-collision.test.ts` | 17 | passed |
| `tests/motocross-dynamic-suspension.test.ts` | 14 | passed |
| `tests/motocross-hard-stop-integration.test.ts` | 12 | passed |
| `tests/motocross-joint-reversal.test.ts` | 30 | passed |
| `tests/motocross-live-pose-coherence.test.ts` | 9 | passed |

The released jump-traffic-priority suite is included in the same complete run:

- `tests/motocross-jump-traffic-priority.test.ts`: 5 cases, `passed`.

### Final evidence

- `docs/engine/mx-dynamics-2026-11-25/evidence/46-final-engine-units.json` contains the final distinct counts, exact command, source identity, per-file hashes/results, input audits and the disposition of the six historical failure files.
- `test-results/agent46/final-receipt.json`, `final-vitest.json`, `final.log` and the separate `final-*-before.json` / `final-*-after.json` manifests preserve the raw audit.
- The historical `evidence/46-full-engine-units.json` and all original logs/receipts remain unchanged.

All integrity checks: `{"allInputsUnchangedAtReport": true, "allInputsUnchangedDuringRun": true, "assertionCountMatchesVitest": true, "discoveryUnchangedDuringRun": true, "historicalEvidenceUnchanged": true, "noDuplicateFileResults": true, "resultsMatchExplicitSelection": true, "resultsMatchFreshDiscovery": true, "sourceMatchesExpectedAfter": true, "sourceMatchesExpectedAtReport": true, "sourceMatchesExpectedBefore": true}`.

Final section generated: 2026-11-26T00:14:50.179043+00:00.
