# Engine CI validation — 24 November 2026

## Final published source

Independent CI review by agent 59, completed against the final source with
the job-state snapshot taken on 24 November 2026 at 15:28:32 UTC.

The final engine code was published as
`b282f121b5766df26466d413d2c685b2f826799d`, tree
`1472d9c28a270af720507d90f490d52ff5ca1fbb`. Agent 59 independently checked
that identity against the GitHub commit object and restored checkout.
Later report-only commits are not substituted for this tested source identity.

**The complete final unit run finished with 8,645 passed and four failed across
840 files. All four failures exactly match the original baseline.** No new
engine unit failure, skipped/pending case, unhandled-error summary or additional
source-stability failure was observed in the completed partitions.

**Whole-project lint, content validation, TypeScript, product/demo builds and
their output guards passed on the final source.** The [full validate job,
138535678691](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138535678691)
completed successfully at 15:07:32 UTC. Its log verifies
`eslint src tests e2e scripts`, `Content valid`, full `tsc --noEmit`, and
1,094-module product and demo builds. The existing source-stability guard and
both output IP guards passed.

**All seven focused native/replay cases passed on this exact source.** The
[focused runtime job, 138535240120](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620728/job/138535240120)
completed successfully at 15:00:28 UTC. Its whole TypeScript check and direct
Vite product build also passed, with 1,094 modules transformed. Chromium's
verified backend was `ANGLE (Mesa, llvmpipe (LLVM 20.1.2 256 bits), OpenGL 4.5)`.
The corrected mirror case reached and passed its rollback, rejection, recovery
and page-error assertions. The complete replay-state case passed, including
exact-end seek, pause and restart from the retained floor. The final log reports
`7 passed (2.2m)`, with zero retries and the original test deadline.

All four unit partitions in the [final full CI run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548)
had completed by 15:24:18 UTC. The four baseline assertions remain failing;
the complete release workflow is not claimed as green. At the 15:28:32 UTC
snapshot, seven broad browser jobs were running and nine were queued; all four
owner-QA jobs were running. Their inventory remains separate from the passed
focused native/replay and wet-presentation gates. The wave-9 results below are
retained as historical receipts and are not substituted for final-source jobs.

The [consolidated regression inventory](ENGINE_REGRESSION_INVENTORY_2026-11-24.md)
separately records 1,072 passed executions across all 60 changed unit-test files,
with 1,068 distinct displayed identities, no failed/skipped/pending case and no
retry. Its frozen input hashes identify the final prepublication source, and
its later published-object check matched all 1,074 production inputs, 851 test
inputs and four configuration files to this final commit. It also
records the coordinator's complete 3,169-file TypeScript pass and direct
1,094-module product build. These local results are not added to CI counts.

## Final-source unit partition receipts

Every row below belongs to `b282f121b5766df26466d413d2c685b2f826799d`.
Counts come from completed Vitest summaries. The four partitions are disjoint;
no earlier revision or repeated execution is added to this final total.

| Partition | Job | Passed | Failed | Files |
| --- | --- | ---: | ---: | ---: |
| 1 | [138535679555](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138535679555) | 2,142 | 2 | 210 |
| 2 | [138535678897](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138535678897) | 2,240 | 0 | 210 |
| 3 | [138535678313](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138535678313) | 2,227 | 2 | 210 |
| 4 | [138535678541](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138535678541) | 2,036 | 0 | 210 |
| **Total** | **8,649 executed cases on the final source** | **8,645** | **4** | **840** |

Partition 1 completed at 15:24:18 UTC, partition 2 at 15:22:58 UTC, partition 3
at 15:15:34 UTC and partition 4 at 15:14:26 UTC. Each checkout and job receipt
identifies the final source commit.

The two partition-1 failures are the original APX-01 livery material assertion
and stale gpr1 calibration hash. The two partition-3 failures are the original
dictionary gate and frozen gpr1 catalogue expectation. Their complete test
titles, assertion messages and expected/received values match the original
baseline; all 56 dictionary-error fields describing its fourteen missing-key
records also match exactly. All four logs report zero skipped, pending or todo
cases, no unhandled-error summary and no additional source-stability failure.
The detailed baseline comparison remains below.

## Previous completed receipt — wave 9

Independent review by agent 59, observed through 24 November 2026 at 14:42 UTC.
The source of this earlier receipt is wave 9,
`6a665033c37f3d760ac0de92cad4c9417ec3ddd5`, tree
`b5ad2e0f14fef214fc05c81b636a72f17e24110b`.

**Whole-project lint, content validation, TypeScript checking, product and demo
builds passed. The complete four-part unit run finished with 8,608 passed and
four failed across 837 files. All four failures match the original baseline.**
The focused native-browser job finished with six passed and one failed
observer-order assertion. At that checkpoint, the corrected assertion required
a subsequent published-source rerun. Its later passing receipt is recorded above.

These earlier results do not cover the later wave-10 changes. They also do not make
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
| Final wave 10: `b282f121b5766df26466d413d2c685b2f826799d` | [validate, 138535678691](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138535678691) | Success: whole lint, content validation, TypeScript, product/demo builds and output guards; completed at 15:07:32 UTC |
| Final wave 10, same source | [focused runtime, 138535240120](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620728/job/138535240120) | Success: whole TypeScript, direct production build and all seven native/replay cases; completed at 15:00:28 UTC |
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

### Additional completed final-source gates

These jobs also executed on `b282f121b5766df26466d413d2c685b2f826799d`:

| Gate | Job | Result |
| --- | --- | --- |
| Physics scenarios | [138535678867](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138535678867) | Success, completed 15:22:37 UTC |
| Offroad scenarios | [138535679205](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138535679205) | Success, completed 15:18:34 UTC |
| Wet presentation | [138543129772](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138543129772) | Seven browser cases passed on verified SwiftShader; completed 15:23:28 UTC |

The wet-presentation job is separate from the focused Mesa native/replay job.
Its seven cases and the selected 60-file local regression inventory are not
added to the disjoint unit-partition totals.

### Earlier wave-9 scenario receipts

Wave 9 also completed the existing [physics scenarios job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45413157564/job/138512362049),
[offroad scenarios job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45413157564/job/138512361892)
and [wet presentation job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45413157564/job/138515056948)
successfully. The physics scenario job completed at 14:39:32 UTC.

## Earlier complete unit partition receipts

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
contain the same four remaining failures observed in the final source, with the
same assertion titles and values. All four affected test source files are
byte-identical between the baseline, wave 9 and the final wave-10 commit.

| Test | Baseline and final-source finding | Classification |
| --- | --- | --- |
| `tests/apx01-livery.test.ts` | The player's wing material metadata is `turned-alloy` where the assertion excludes `turned-alloy` | Pre-existing authored-material assertion |
| `tests/vehicle-catalogue.test.ts` | The gpr1 calibration record contains `eca1c71a`; the current vehicle hash expected by the assertion is `5f121c00` | Pre-existing stale calibration record |
| `tests/i18n.test.ts` | Fourteen missing-key records: `Rear brake (GP motorcycle)` and `GP rear brake button (−1 unbound)` in de, fr, es, pt-BR, it, pl and tr | Pre-existing dictionary content |
| `tests/vehicle-catalogue-growth.test.ts` | The current gpr1 hash is `5f121c00`; the frozen expectation is `eca1c71a` | Pre-existing frozen catalogue expectation |

The original baseline additionally failed the CPU-read resampling fixture in
`tests/presentation.test.ts` and the stale draw limit in
`tests/shadow-proxies.test.ts`. Those two failures are absent from the
completed wave-8, wave-9 and final unit runs. Their earlier engine/test reviews are
documented in the development report.

No art, model, authored environment, dictionary, calibration, frozen hash or
vehicle tuning has been changed to make these four remaining assertions pass.
The [scope audit](ENGINE_SCOPE_AUDIT_2026-11-24.md) records the independent
content-preservation checks. The failures remain visible.

## Native browser evidence and observer-order review

The final [wave-10 focused runtime job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620728/job/138535240120)
passed all seven selected cases on `b282f121b5766df26466d413d2c685b2f826799d`.
The [uploaded evidence](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620728/artifacts/14933807988)
contains the native reports, logs, backend identity, source receipts and build
identity. This is the acceptance receipt for the corrected mirror assertion;
the original failed run remains documented below.

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
in place. The final-source rerun above passed with that configuration unchanged.

See the [browser validation report](ENGINE_BROWSER_VALIDATION_2026-11-24.md)
for the exact six native cases, retained evidence and boundaries.

## Remaining evidence boundaries

Local Chromium could not start because operating-system socket creation was
denied before test execution. Local host-terminated compiler or build attempts
are not counted as successful checks. The verified CI build/browser receipts
above are separate evidence from those local limits.

The shared executor temporarily became unavailable during this independent
review and was restored before final publication. Agent 59 ran no project
compiler, application test or browser process and modified no production source.
The final full CI validate job, all four unit partitions, focused native/replay
acceptance, physics/offroad scenario jobs and wet-presentation gate are complete
as recorded above. The four failing unit assertions remain exact baseline
findings. Broader browser/owner jobs were still running or queued at the stated
snapshot; their outcomes are not anticipated or treated as passes here.

