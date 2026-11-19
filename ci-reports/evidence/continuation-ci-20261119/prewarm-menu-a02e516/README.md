# Candidate a02e516 — build and menu-entry evidence

The original candidate **build and menu-entry jobs succeeded**. The Playwright
report records **7 passed, 0 unexpected, 0 flaky, and 0 skipped**; every case ran
with retry 0. The full isolated workflow failed its separate High job. These
build/menu results do not establish acceptance of the whole candidate.

## Source and CI identity

- Server commit: `a02e516cf3a58b33e4f783ecb37baafeed0e6ba5`.
- Exact tree: `a9c5d75554b2805b42eea1f393e01e616bbc5d9d`.
- Equivalent local commit: `872fa9d06edbcbb57b47167f0c99a660bb9bb3ef`.
- Isolated branch: `ci/high-late-startup-20261119`.
- [Workflow run 44563795294, attempt 1](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44563795294).
- [Build job 135699931724](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44563795294/job/135699931724): success.
- [Menu-entry job 135700617960](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44563795294/job/135700617960): success.

The published Git commit receipt and local Git tree match. Both complete logs
identify the exact server commit. Menu-entry passed the original check requiring
the downloaded build's `SOURCE_COMMIT.txt` to equal `GITHUB_SHA`. The build artifact
was not downloaded during evidence collection; its metadata and upload receipt
remain available. The workflow retains the original job commands, environment,
deadlines and selected menu-entry specs.

`menu-workload-parity.json` independently confirms byte equality against
`d8d87c73a8f3e921e865acdc02c61e84b8c877a7` for all four menu specs, the menu timing
fixture, and Playwright configuration. Exact candidate source copies and full-file
hashes are retained. This collection involved no rerun, local browser execution,
application/test source edits, publication, or corrective patch.

## Exact recorded test results

| Test | Duration, ms | Result |
| --- | ---: | --- |
| Real menu actions reachable with mouse and keyboard | 25,377 | passed, retry 0 |
| 640×400 settings persist and the normal paused grid starts | **86,317** | passed, retry 0 |
| Renderer context reuse clears fallback upload state and preserves 2D texture orientation | 1,222 | passed, retry 0 |
| GPU frame completion with timer polling | 369 | passed, retry 0 |
| GPU frame completion with animation-frame polling | 425 | passed, retry 0 |
| 640×400 settings transition owns its first covered frame and persists quality | 19,716 | passed, retry 0 |
| 1280×720 settings transition owns its first covered frame and persists quality | 20,778 | passed, retry 0 |

Full titles, locations, statuses, errors and attachments are preserved in
`menu/tests-summary.json` and the complete original report data. Durations are
whole-test durations, not individual loading-stage or native-call durations.
The exact job log ends with `7 passed (2.7m)`.

### Previously failing 640×400 Low case

The unchanged test at `e2e/30-menu-access.spec.ts:136` passed every assertion:

- Initial showroom presentation, zero circuit-construction tasks, and a completed GPU submission.
- Low selected, saved, reloaded, and verified as the persisted quality.
- Race mode with three opponents, started through the normal paused-grid button.
- State became `paused` within the unchanged 60,000 ms predicate deadline.
- Circuit remained Aurel, presentation purpose was `circuit`, construction tasks exceeded 100, and preparation status was `complete`.
- Worker pause was acknowledged with `{pending: false, paused: true}`.
- Captured page errors were empty, and the final screenshot attachment was saved.

The total test duration was 86,317 ms under the unchanged 240,000 ms test deadline.
`menu-result-summary.json` retains the exact assertion source with line numbers.
The original paused-grid screenshot is available as
`menu/menu-access-paused-grid.png` and inside the verified artifact.

## Comparison and native timing limits

The source-matched baseline d8 test failed at line 162: its 60,000 ms predicate
expected `paused` and received `loading`. The frozen baseline addendum directly
records the completed-cockpit loading detail and a bounded interval of native
fence timeouts. This candidate passed the same test and proceeded through all
the later preparation and worker-pause assertions.

This is a source-specific outcome comparison between separate CI executions.
It does not isolate one causal native operation or control runner variation.
The candidate's 86,317 ms whole-test duration must not be compared to the baseline's
time since the start-button click or to its observed fence duration.

The successful candidate artifact contains **no Playwright trace ZIP**. Its
`menu-frame-timing.json` attachment is preserved exactly, but uses the fixture's
bounded Node ring: 7,321 events received, 4,096 retained, and 3,225 Node events
discarded. Its document origins are `1795105286850.8` and `1795105315305.2`, with
61 and 167 packets respectively. The first document reports 212 browser drops;
the post-reload document reports zero. Zero browser drops does not remove the
separate Node retention limit. No exact stage-entry, poll-return or fence-duration
timeline is reconstructed from this successful run, and no fence identity is
transferred from the baseline.

The backend receipt records Mesa/llvmpipe through ANGLE, WebGL 2, error 0, and
the expected readback pixel `[64,128,191,255]`. It explicitly records software
rendering and does not claim physical GPU validation.

## Complete logs and artifact

| Item | Original bytes | SHA-256 |
| --- | ---: | --- |
| Complete decoded build log | 26,923 | `035a9b4c9abc2725288d17847d4b5b093b7e492586ee1134dff90e43d9fda1a4` |
| Complete decoded menu log | 60,671 | `383506e81728b3f053504e8307a5b3996ef485d12f02f6ac5a3272307f62d439` |
| Menu artifact ZIP, ID 14551657377 | 698,245 | `ce4f93913e6ead116caff1c41771804af99f03e37754b8cc6100c45bd7fd4a45` |

Both complete logs are retained in deterministic gzip form, with decompressed
bytes checked against the decoded connector response. The full menu artifact is
small enough to preserve unchanged. Its byte count and SHA-256 match the GitHub
artifact metadata. It includes the complete HTML report and all three screenshot
resources, backend and progress receipts. All extracted JSON attachment bodies
and report records preserve their original bytes through lossless compression.

`extract-menu-report.py` reproduces the recorded-report extraction from the local
ZIP without opening a browser, running tests or using the network:

```bash
python -B extract-menu-report.py menu-a02e516.zip /path/to/new-menu-report
```

The optional `analyze-menu-trace.py` utility was prepared but **not executed**:
the successful artifact has no trace ZIP requiring failure analysis. The compact
copy omits that unused utility and redundant raw response/poll files while
preserving the complete logs, artifact, results, exact assertions and identities.
The compact provenance lists every omission with its original hash and size.

`SHA256SUMS` covers every file other than itself. Shared GitHub metadata was copied
byte for byte from the graphics owner's collection; `shared-source-receipts.json`
records the source paths and hashes. The full original collection is frozen after
checksum verification.
