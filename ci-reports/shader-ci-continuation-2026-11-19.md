# Accepted graphics and wet-path corrections — 19–20 November 2026

The accepted application source is [main merge `93c4c55`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/93c4c55469ecc2fe44157e74d4e81f3d6c9055c4), tree `183094280b5c0f3ec40ef5c29537477c7150c204`. It includes the previously published [shader and CI changes at `f80309f`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/f80309fce06e97ada17cde1ef330971d9af6ffd9) and the separately tested wet motorcycle path correction at `5f23cf6`. The merge retains the tested candidate as a parent. An independent Git comparison found that its 42 differences from that candidate are all under `ci-reports/`; application, test and workflow bytes match.

**Simulation version is now 28; protocol version remains 17.** The physics identity update accompanies the wet-path behavior change and adds explicit compatibility coverage for version-27 records, ghosts and network identities. All original race assertions, startup deadlines and release gates remain in force. The complete release is not certified: the separate mixed-class pace requirement and application startup failures remain open.

## Published changes

### Inactive graphics work

- Graphics settings compile local fog out when the feature is disabled. Aerial perspective, cloud shadows and grounding remain active. Repeated setting changes reuse two program variants; ordinary weather changes continue to use uniforms.
- Uniform-masked surface materials skip their weather calculation when both wetness and snow cover are exactly zero. Nonzero weather keeps its original calculation. No epsilon or quality reduction was introduced.
- Material ownership and disposal handling prevent an old scene's atmosphere from updating materials that have moved to a new scene.

The [shader publication receipt](evidence/inactive-shader-work-20261119/publication.json) binds the original paired validation to its exact published source. The graphics code was accepted at `669a44d`; its child `f80309f` adds the CI transport correction.

### CI package transport

Browser jobs in the main and graphics workflows select official HTTPS Ubuntu package sources before installing dependencies. The helper covers legacy sources, deb822 sources and the hosted runner's `apt-mirrors.txt`, retaining suites, signing options and mirror metadata. Package selections, test commands, assertions and deadlines are unchanged. Fixtures cover the actual mirror-file path as well as legacy and deb822 formats.

### Motorcycle wet-path geometry

Motorcycle steering offsets and curvature now follow the same wet line width already used by the shared AI planner:

```text
(1 - 0.45 * clamp(frontContactWater / 0.8, 0, 1)) * (lineScale ?? 1)
```

Full-width dry geometry retains the original value. Off-road overrides are unchanged. The correction does not alter tyre grip, target pace, control gains, vehicle admission or the GP/superbike performance requirement. Eight new geometry cases exercise the scaled path; the session identity and its compatibility cases are updated together.

## Completed paired shader proof

[Run 44642706691](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44642706691) compared baseline `54a09a0` with shader candidate `669a44d` using independently built and identified artifacts, the frozen original weather shader and the original application cases.

| Check | Result |
| --- | --- |
| Focused shader, atmosphere and settings tests | 179 passed in 11 files |
| Guarded production build, typecheck, lint and bundle/IP checks | Passed; initial JavaScript 3.57 MiB gzip against a 4 MiB limit |
| SwiftShader component cases | 4/4 passed |
| Mesa llvmpipe component cases | 4/4 passed |
| Weather comparisons against the original shader | All 40 rows exact in RGBA8 output |
| Disabled fog, held frames and restored frames | Exact; four native local-fog uniforms absent when disabled |
| Repeated fog toggles | Two program variants reused without growth |
| Aerial perspective, cloud shadow, grounding and active-fog controls | Each still changes rendered channels |
| Original Low menu/settings cases | Baseline 4/4; candidate 4/4 |
| Original High application case | Both fail the same 90-second paused-readiness assertion |
| Existing workflow/release-gate tests after the HTTPS change | 82 passed |

The Low suite reported 2.7 minutes on baseline and 2.2 minutes on candidate. These are single-pair, whole-test observations; they do not establish a repeated hardware performance result. Both High cases report `loading` when `paused` is required, before their overall job cap. The [compact shader evidence](evidence/inactive-shader-work-20261119/README.md) separates component equivalence from these startup outcomes and the HTTPS fixture audit.

## Completed paired wet-path proof

[Hosted run 44647781041](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44647781041) compared pinned baseline `f80309f` with candidate `5f23cf60923638bd03b29df9c7b533c536e8624f`, tree `97674f9a9e89ecb7a00427a11310cd5743daf121`. Both jobs used Node **22.23.4**, npm **10.9.9**, the complete original race files and guarded, unchanged source.

| Complete original test file | Baseline | Candidate |
| --- | --- | --- |
| GP tyre/contact | 21 passed, 1 failed | **22 passed, 0 failed** |
| Bike session | 13 passed, 1 failed | 13 passed, 1 failed |
| Both files | 34 passed, 2 failed | **35 passed, 1 failed** |

All **36 original case identities** match, with none missing, added, pending or skipped. Only one outcome changes: the original eight-rider, two-lap Poggio Alto rain contact case fails on baseline with impact `0.9916666666666667` against zero, and passes on the candidate. Every other original passing case remains passing. Candidate focused validation passes **128/128 cases across 10 files**, including the scaled geometry and version compatibility cases; lint and full typecheck also pass.

The remaining mixed GP/superbike pace failure is byte-identical in both original reports: GP best lap **91.13427179346363 seconds**, superbike **90.36337145755091 seconds**, where the existing requirement expects GP to be faster. Both original-race jobs retain failure status. The narrow wet correction was accepted on this matched evidence without treating the separate pace failure as solved.

The [paired proof package](evidence/accepted-wet-path-node22-20261119/README.md) retains the complete original reports, all case comparisons, focused report, source/runtime hashes, verified artifact digests and independent merge binding. It records exactly which candidate was run and how that source was incorporated into main.

### Runtime control

An earlier local clear-weather contact failure occurred identically on baseline and candidate under Node **24.22.3**, with impact `0.9833333333333334`. A bounded observer recorded 58,184 rider updates before the first dry fall; water stayed zero and width stayed one. The identical isolated clear case then passed on each source under the exact CI Node **22.23.4** binary. No assertion or deadline changed.

This establishes the scope of that local discrepancy; it is not evidence that the wet patch caused a new dry failure. The final hosted Node-22 comparison includes the complete original contact file and passes every candidate case. [Local runtime evidence](evidence/wet-path-runtime-20261119/README.md) preserves both observations.

## Complete unit-suite history and current main

### Pre-wet source: complete result

All four native unit partitions for `f80309f` finished in [main run 44646348452](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44646348452): **696 files, 6,780 cases, 6,778 passed and two failed**. Every source test file occurs exactly once. No original case was removed; no failure identity was added relative to the retained baseline. Its two failures are the rain contact and mixed-class pace cases described above.

The increase from the retained baseline's 6,757 cases is fully reconciled: five fog cases, sixteen weather cases, one generated workflow-YAML case and one generated fixture-bundle case. The [complete pre-wet unit package](evidence/complete-main-units-f80309f-20261119/README.md) retains all four native reports and terminal job logs, baseline reports, source inventories, verified artifact receipts and a script that reproduces the comparison from those retained files.

The overall run was later **cancelled by normal push concurrency** when the accepted wet merge reached main. Its build, road scenarios, off-road scenarios and seven wet-presentation cases had passed. Twenty browser/owner-QA jobs were cancelled; unobserved cases are not counted as passes or failures. The completed unit result remains valid for its exact pre-wet source.

### Current accepted source: complete unit result and remaining application checks

[Main run 44650977053](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44650977053) validates merge `93c4c55`. All four native unit partitions have completed: **697 files, 6,801 cases, 6,800 passed and one failed**. The complete original GP contact file passes **22/22**, including the corrected rain race. The sole unit failure is the unchanged mixed GP/superbike pace assertion.

| Native shard | Files | Passed cases | Failed cases | Node |
| --- | ---: | ---: | ---: | --- |
| 1 | 175 | 1,665 | 0 | 22.23.4 |
| 2 | 175 | 1,833 | 0 | 22.23.5 |
| 3 | 175 | 1,784 | 1 | 22.23.5 |
| 4 | 172 | 1,518 | 0 | 22.23.5 |

Every prior case is retained, with no missing, extra or duplicate source files, no pending cases and no new failure identities. The additional 21 passing cases comprise eight scaled-path cases, twelve version-identity cases and one generated workflow-YAML case. The [complete current unit package](evidence/complete-main-units-93c4c55-20261119/README.md) retains the native reports, terminal logs, exact-source inventories, artifact digests and reproducible comparison against the pre-wet source.

Lint/content/typecheck, the production and demo builds, IP checks, static build and exact-source artifact preservation also passed. At the final **01:20:43 UTC on 20 November** job snapshot, the main run had seven successful jobs, one failed unit job, eighteen running jobs and two queued jobs. The twenty unfinished jobs belong to the original browser/owner-QA matrix. Their eventual outcomes are not claimed here. The [current validation snapshot](evidence/current-validation-93c4c55-20261119/README.md) preserves that cutoff and the separately completed Graphics and MotoGP outcomes.

The separate [current Graphics run 44650976953](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44650976953) has completed on the exact accepted source:

| Job | Result |
| --- | --- |
| GPU components, `136005469146` | **7/7 passed**, including geometry, grounding, temporal depth and resource lifetime |
| Complete driving/capture/replay journey, `136005468623` | **1/1 passed** |
| High production journey, `136005469028` | Original 90-second readiness assertion still fails: expected `paused`, received `loading` |

All three observed Mesa llvmpipe jobs completed their package setup without HTTP mirror retry/fetch-error lines. Chromium/system setup took 23.763–48.626 seconds. These observations show that the earlier HTTP fallback stall did not recur in these jobs; they are not an installation-time benchmark. The [build/graphics snapshot](evidence/accepted-wet-path-node22-20261119/main-build-and-graphics.json) records job IDs, exact checkout, terminal outcomes, timings and failure excerpts.

## Remaining failures and acceptance limits

- **Mixed-class pace:** the unchanged GP/superbike ordering assertion still fails with the exact values above.
- **High startup:** baseline, shader candidate and current accepted main all fail the original 90-second paused-readiness condition. Package installation succeeds; this is an application readiness failure.
- **Low startup:** the paired Low comparison passed on both sources, but separate settings runs on `f80309f` still failed the original 60-second paused-readiness condition. Settings interaction run [44646348313](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44646348313) had three passes, one failure and three original skips; settings transition run [44646348624](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44646348624) had five passes and one failure. Both transition-dimension cases passed. These overlapping suites are not summed as unique test cases.
- **Fresh-context GP image equality:** current-source [MotoGP run 44650976917](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44650976917) reproduces the original hash-equality assertion at `41-motogp-reference.spec.ts:230`: expected `4193071955`, received `3908797941`. Eight other presentation cases pass. The hash values alone do not establish the size of the current pixel difference; the earlier tiny-difference measurement is not transferred to this run. The threshold was not relaxed.
- **Complete release:** the remaining current-source application and owner-QA jobs still require their original results; completed scoped checks do not certify the whole application.

The retained-array-uniform experiment and broader GP steering/admission trials remain outside main. The unrelated branch-consolidation workflow stopped because the existing `babylon-js` branch was unmerged; no branch-deletion phase was reached and no experimental branch was merged to bypass preflight.

The machine-readable [continuation state](continuation-state-2026-11-19.json) records exact accepted commits, run identities, observed outcomes and the next unresolved work. Repository publication uses a non-force expected-head update and retains intervening report commits. No release gate is bypassed.
