# MotoGP CI evidence on d8d87c7

This frozen package preserves the completed MotoGP workflow evidence for [run 44553045866](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44553045866), source **d8d87c73a8f3e921e865acdc02c61e84b8c877a7**. It contains the original supplied summary and unit receipt, seven complete decoded job logs compressed losslessly, selected menu failure attachments, artifact identities and hashes, and a narrow source-based interpretation of the loading stage. No source file was changed, no test was rerun and nothing was published while assembling it.

## Actual scope and results

The unit receipt records **55 files and 699 tests passed** in 131.22 seconds. This was the workflow's focused MotoGP unit selection; it does not establish the result of the original full unit suite. The exact selected-test command remains in the full unit log and `provenance.json`.

The six browser jobs record **26 passed and 1 failed**:

| Browser group | Job | Passed | Failed |
| --- | ---: | ---: | ---: |
| Course construction | 135662500452 | 2 | 0 |
| Presentation | 135662500574 | 9 | 0 |
| Rider contact | 135662500618 | 7 | 0 |
| Wet riding | 135662500723 | 1 | 0 |
| Menu entry | 135662500733 | 6 | 1 |
| Dry riding | 135662500754 | 1 | 0 |

The supplied workflow summary records build job 135661596989 as successful. A separate full build log was not among the supplied inputs. All six browser logs identify the same reviewed-build artifact and successful digest verification. Unit job 135661596180 and all six browser jobs explicitly record the d8d87c7 checkout.

`menu-entry/browser-backend.json` identifies Mesa llvmpipe through ANGLE and explicitly records that physical hardware was not validated. These are software-renderer functional results, not a consumer GPU performance benchmark.

## Menu-entry failure and interpretation

The failing case is `640x400 settings persist and the normal paused grid starts`, at `e2e/30-menu-access.spec.ts:162`. It used Low quality and four Formula cars. The original 60,000 ms state predicate expected `paused` but remained `loading`; the case duration in the browser progress receipt is 121,228 ms.

The original [failure screenshot](menu-entry/test-failed-1.png) and [error context](menu-entry/error-context.md) show **“Warming up tyres” at 94%**. At the exact tested source, `src/ui/loading-copy.ts` maps `/completed cockpit/` to that displayed text and fraction. `src/rendering/renderer.ts` emits the corresponding completed-cockpit progress immediately before the second mode's `waitForPreparedFrame` call. The exact source excerpts, Git blob identities and file hashes are retained in `source-stage-evidence.json`.

This supports a **completed-cockpit stage inference only**. The screenshot is consistent with the second GPU-completion wait, but this menu case did not install the High native-command monitor. It does not identify the last native call, establish a fence timeout, prove an unsignalled fence, or assign the failure to the High first-reflection upload. The separate High failure was observed earlier in preparation and remains a distinct investigation.

Read-only inspection of the saved Playwright trace found 239 browser console events, all debug, and zero console errors. The terminal test error and per-trace event counts are retained in `menu-entry/trace-summary.json`. Absence of captured console errors is not a root-cause diagnosis.

## Included and omitted material

Included files are:

- Unmodified `workflow-summary.json` and `unit-receipt.json`.
- All seven complete decoded logs under `logs/`, compressed with deterministic gzip. Decompression was verified byte-for-byte against each original; original byte counts and SHA-256 hashes are in `provenance.json`.
- Original menu error context, screenshot, browser progress and backend JSON. Their bytes were verified against their entries in the downloaded GitHub artifact.
- Artifact IDs, URLs, reported sizes and digests for all six browser artifacts, the focused unit artifact and the shared reviewed build.
- Trace event summary, source-stage excerpts, input inventory and package checksums.

The large **motogp-menu-entry artifact**, ID **14543054190**, is omitted from this compact package. Its original 64,669,574 bytes remain in the supplied raw directory. Its local SHA-256 was verified against the job's uploaded-artifact digest:

`c523cce38038bd2168c95a44c9d7d192a3c89c744c751359192e93f264264d35`

The nested **trace.zip**, 32,854,438 bytes, is also omitted. Its SHA-256 is:

`0c34a460c3b08af3df75d2b8e35c9334574a4d804ea0b502d29f46acc65ff1d2`

The omitted trace's extracted bytes were verified against the parent archive entry. Other build/browser/unit archives were not present in the supplied raw directory; their identities and hashes are preserved from the original logs, with that limitation explicit in `artifacts.json`. The unit JSON artifact itself is not included; its complete job log and parsed receipt are retained.

## Integrity and preservation

`SHA256SUMS` covers every packaged file other than itself. `provenance.json` records the original input inventory, log compression mapping and source-identity lines. All original supplied files were rehashed after assembly and remained unchanged. The raw directory is `/workspace/scratch/0ab62d15db18/ci-motogp-d8d87c7`; this compact package is `/workspace/scratch/0ab62d15db18/ci-motogp-d8d87c7-evidence`.

This package is frozen after checksum verification. It makes no new CI pass claim and contains no source fix.
