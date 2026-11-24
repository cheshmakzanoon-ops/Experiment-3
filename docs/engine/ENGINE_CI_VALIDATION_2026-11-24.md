# Engine CI validation — 24 November 2026

## Conclusion and source boundary

Independent review by agent 59, observed through 24 November 2026 at 14:42 UTC.
The latest reviewed engine source is wave 9,
`6a665033c37f3d760ac0de92cad4c9417ec3ddd5`, tree
`b5ad2e0f14fef214fc05c81b636a72f17e24110b`.

**Whole-project lint, content validation, TypeScript checking, product and demo
builds passed. The complete four-part unit run finished with 8,608 passed and
four failed across 837 files. All four failures match the original baseline.**
The focused native-browser job finished with six passed and one failed
observer-order assertion. The corrected observer assertion still requires a
published-source rerun before that case can be counted as passed.

These results do not cover unpublished wave-10 changes. They also do not make
the complete release workflow green: the four baseline unit failures remain,
and the broad browser/owner inventory had not completed at this review snapshot.
Queued, running, cancelled, blocked or host-terminated work is not a pass.

The comparison baseline is
`a0ae513e7982f0b4719296519752e0ae5f1983f8` (tree
`3e5dd0888f193dbde62f6ce5cdebdd1c2ee9847c`).
The later report-only commit
`596bdfc44a47c39d299324cf30969c74e6e448c5` is a child of wave 9;
no validation run is relabelled as having tested that later commit.

## Whole-project checks

| Source | Job | Verified result |
| --- | --- | --- |
| Wave 8: `c4e62c642d912037e5e9262b1b89d4fbfd9677fe` | [validate, 138498948448](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45409387072/job/138498948448) | Success: whole lint, content validation, TypeScript, product/demo builds and output IP guards |
| Wave 9: `6a665033c37f3d760ac0de92cad4c9417ec3ddd5` | [validate, 138512362203](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45413157564/job/138512362203) | Success; completed at 14:25:46 UTC |
| Wave 9, same source | [focused runtime, 138512113073](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45413157534/job/138512113073) | Whole TypeScript check and direct Vite production build passed before browser execution; the overall job failed on the test-observer assertion |

The complete validate log identifies `eslint src tests e2e scripts`,
`Content valid`, and `tsc --noEmit && vite build`. Both product and demo
builds transformed 1,094 modules. The focused job independently executes
`node node_modules/typescript/bin/tsc --noEmit` followed by Vite directly,
without invoking asset-generation build hooks.

Locked installation and the main validation command run under the existing
source-stability guard. Successful validation does not certify physical GPU
performance, a complete browser inventory, or audio/controller hardware.

Wave 9 also completed the existing [physics scenarios job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45413157564/job/138512362049),
[offroad scenarios job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45413157564/job/138512361892)
and [wet presentation job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45413157564/job/138515056948)
successfully. The physics scenario job completed at 14:39:32 UTC.

## Complete unit partition receipts

Counts below are from each job's final Vitest summary. Counts from different
source revisions are not added together.

| Wave 9 partition | Job | Passed | Failed | Files |
| --- | --- | ---: | ---: | ---: |
| 1 | [138512362367](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45413157564/job/138512362367) | 2,132 | 2 | 210 |
| 2 | [138512362100](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45413157564/job/138512362100) | 2,234 | 0 | 210 |
| 3 | [138512362322](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45413157564/job/138512362322) | 2,253 | 2 | 210 |
| 4 | [138512362289](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45413157564/job/138512362289) | 1,989 | 0 | 207 |
| **Total** | **Source `6a665033c37f3d760ac0de92cad4c9417ec3ddd5`** | **8,608** | **4** | **837** |

Partition 1's final result was logged at 14:40:48 UTC. No additional engine test
failed in the four completed wave-9 partitions.

The preceding wave-8 source independently completed 8,587 passed and four
failed across 835 files:

| Wave 8 partition | Job | Passed | Failed | Files |
| --- | --- | ---: | ---: | ---: |
| 1 | [138498947980](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45409387072/job/138498947980) | 2,114 | 2 | 209 |
| 2 | [138498948050](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45409387072/job/138498948050) | 2,235 | 0 | 209 |
| 3 | [138498948185](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45409387072/job/138498948185) | 2,216 | 2 | 209 |
| 4 | [138498948131](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45409387072/job/138498948131) | 2,022 | 0 | 208 |

## Exact baseline failure comparison

The original baseline run is [45389569436](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45389569436).
Its completed [unit partition 1](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45389569436/job/138429545672)
and [unit partition 3](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45389569436/job/138429545990)
contain the same four remaining failures, with the same assertion titles and
values. All four affected test source files are byte-identical between baseline
and wave 9.

| Test | Baseline and wave-9 finding | Classification |
| --- | --- | --- |
| `tests/apx01-livery.test.ts` | The player's wing material metadata is `turned-alloy` where the assertion excludes `turned-alloy` | Pre-existing authored-material assertion |
| `tests/vehicle-catalogue.test.ts` | The gpr1 calibration record contains `eca1c71a`; the current vehicle hash expected by the assertion is `5f121c00` | Pre-existing stale calibration record |
| `tests/i18n.test.ts` | Fourteen missing-key records: `Rear brake (GP motorcycle)` and `GP rear brake button (−1 unbound)` in de, fr, es, pt-BR, it, pl and tr | Pre-existing dictionary content |
| `tests/vehicle-catalogue-growth.test.ts` | The current gpr1 hash is `5f121c00`; the frozen expectation is `eca1c71a` | Pre-existing frozen catalogue expectation |

The original baseline additionally failed the CPU-read resampling fixture in
`tests/presentation.test.ts` and the stale draw limit in
`tests/shadow-proxies.test.ts`. Those two failures are absent from the
completed wave-8 and wave-9 unit runs. Their earlier engine/test reviews are
documented in the development report.

No art, model, authored environment, dictionary, calibration, frozen hash or
vehicle tuning has been changed to make these four remaining assertions pass.
The [scope audit](ENGINE_SCOPE_AUDIT_2026-11-24.md) records the independent
content-preservation checks. The failures remain visible.

## Native browser evidence and observer-order review

The [focused runtime job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45413157534/job/138512113073)
executed against wave 9 with verified backend
`ANGLE (Mesa, llvmpipe (LLVM 20.1.2 256 bits), OpenGL 4.5)`.
Five native lifecycle cases and the complete replay-state scenario passed.
The replay case includes exact-end seek, pause, and restart from the retained
floor. The mirror-adapter case failed only at its observer-order assertion.

The actual order was `request-success`, `promise-rejected`,
`transaction-abort`; the fixture expected the latter two in the opposite
order. Rollback and read-rejection assertions before that check passed.
Recovered-data and page-error assertions after the ordering check were not
reached, so they are not separately claimed as passing in the first run.

Independent source review supports changing only that ordering assumption:

- The fixture deliberately aborts the real native transaction after request
  success.
- Production `idbKv` resolves data only on transaction completion and rejects
  on transaction/request error or abort.
- Requiring request success first and exactly one rejection and one abort
  observation in either order still fails on a prematurely resolved read,
  omitted/duplicated observations, failed rollback or failed recovery.
- The recovery and page-error assertions remain unchanged after the ordering
  check. No production storage code changed for this correction.

The original Playwright configuration retains a 300-second test deadline,
60-second expectation timeout, one worker and zero retries. Backend
verification, normal Chromium launch options and the selected assertions remain
in place. A passing rerun of the corrected source is still required.

See the [browser validation report](ENGINE_BROWSER_VALIDATION_2026-11-24.md)
for the exact six native cases, retained evidence and boundaries.

## Remaining evidence boundaries

Local Chromium could not start because operating-system socket creation was
denied before test execution. Local host-terminated compiler or build attempts
are not counted as successful checks. The verified CI build/browser receipts
above are separate evidence from those local limits.

The shared executor became unavailable during this independent review. No
compiler, test or browser process was launched by agent 59, and no production
source was modified. Wave-10 validation, a corrected native rerun, broad browser
completion and any final source identity must be recorded explicitly when
observed; this report does not anticipate those results.

