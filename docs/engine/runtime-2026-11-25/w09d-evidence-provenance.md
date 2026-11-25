# W09D — evidence provenance and failure attribution

Assignment **52/60**, wave **9** · 25 November 2026.

## Decision

The inspected evidence is internally consistent with the independently retrieved GitHub runs, jobs and logs. The accepted 92e checkpoint has reproducible, correctly scoped retained evidence. The four broader content failures already existed before this task; the new test-harness lint failures and the later persistence integration failure belong to this session's validation history and must remain visible.

**The latest source inspected by this review is not accepted.** Source `748814f648badd2e355c47c2f6ddc7321a0ed494` failed its newly added lint gate. Later units, probes, typecheck/build and native stages were skipped. At this review boundary, `92e2dc2` remains the latest complete successful focused engine checkpoint. A later successful run must identify its own source before becoming release evidence.

This assignment changes only this report. It executed no local compiler, tests or browser and made no production, test, workflow, commit or ref change.

## Exact run and source identities

The reviewer fetched the run metadata and jobs independently, then compared their reported outcomes with retained evidence.

| Source | Independently checked run / job | Observed acceptance boundary |
| --- | --- | --- |
| `774e62fafdfd9ecd84001a2fcdb3b9f6ee973b86` | [45592833399][prior-run] | Prior-session success; retained logs report 914 units across 70 files and 47 native cases |
| `92e2dc2ed2f4959011bb84816e90506cefed774d` | [45637677573][accepted-run] / 139287423560 | Success: 1,135 units across 86 files, all six probes, full typecheck/build, 57 native cases |
| `e2d1fec2ff3b38a2cf962e9974cfe0622259823b` | [45641670477][failed-run] / 139301674493 | Failure: 1,348 of 1,350 units passed; two persistence cases failed; later stages skipped |
| `748814f648badd2e355c47c2f6ddc7321a0ed494` | [45644838370][lint-run] / 139312908814 | Failure: native idle observer `prefer-const` error; every later validation stage skipped |

The accepted source's Git commit object points to tree `53db549abaa5ce3a38421e7c103e3e052a7956d8`, matching the [retained result][accepted-result]. Its native command explicitly uses one worker, zero retries and `--forbid-only`. The output reports `57 passed (4.0m)`; job metadata marks the unit, probe, compiler/build and native steps successful. The accepted workflow at that source did not contain the later full ESLint stage, so its success is not an ESLint or complete-repository pass.

The e2d job identifies exactly the two populated private-snapshot cases in `engine-persistence-integration.test.ts`. Its retained counts and skipped-stage description are accurate. The sixteen desktop revision, seven event retirement and one recovery-boundary cases passed in that run. The six existing suites newly selected by its workflow contribute **191 cases**; the increase from 1,135 to 1,350 therefore must not be described as 215 newly authored tests.

The 748 commit contains only tests, workflow and documentation changes and has e2d as its immediate parent. That fact does not extend 92e's whole-source acceptance: the new desktop and idle native witnesses, changed fixture, and lint gate still require execution. The inspected 748 failure is specifically `e2e/fixtures/engine-native-worker-idle-observer.ts:49`, where `owner` is never reassigned. It is a harness lint finding, not an observed production runtime failure.

## Retained evidence matches the upstream jobs

The reviewer retrieved the actual accepted job log separately from the repository copy. Removing ANSI control sequences and line-leading timestamps by the documented normalization produces **exactly the retained 197,606-character log**. No other transformation was required.

The six complete probe JSON objects were independently parsed from that fetched log. Their ordered serialized objects match the [retained probe array][accepted-probes] exactly, including every source hash, bundle hash, workload result and timing vector. Their provenance consistently identifies:

- Baseline `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`.
- Candidate `92e2dc2ed2f4959011bb84816e90506cefed774d`.
- Node v22.23.5 and esbuild 0.25.12.
- Clean tracked state within the explicitly declared status scope.
- The particular production files substituted for each historical comparison.

The failed e2d job was checked the same way. Its independently fetched log, after that same normalization, exactly matches the **48,913-character** copy now retained at 748. Its [result record][failed-result] agrees with job metadata and the failure output. Preserving this failure alongside the successful run avoids presenting only favorable checkpoints.

The upload log also matches the accepted artifact metadata: ID **15033344605**, **1,361,643 bytes**, and SHA-256 `4f44a6a4314dd120af97f9b5974287a3ee26e98dc3fd9ab8610e1342b9e25fa0`. For e2d it matches ID **15035608167**, **9,548 bytes**, and SHA-256 `4224f62bef056fbeafdacc5ba5cbbb75e51124443480d26c467c0ac9195062f6`.

These are independently checked **upload-log identities**. This assignment did not download either ZIP, recompute its archive digest, or inspect its Playwright JSON attachments. Passing native test output establishes runner/assertion outcomes. It does not make every attached native measurement a separately inspected observation in this review.

## Two different historical comparison boundaries

The historical native audio reference and the six new runtime probes use different baselines and dependency policies. They should not be conflated.

### Closed native audio reference

The audio reference uses original commit `350119e8ec0606e8c5de5b3ab80df41104025679`. The [archive][audio-archive] contains 31 dependency sources, alongside the previously retained loudness source in the [original manifest fixture][audio-original].

The reviewer fetched **all 31 dependency paths from that historical commit** and compared each decoded UTF-8 source string with the archive: all 31 matched exactly. The [specification][audio-spec] verifies the archive commit, exact path set, SHA-256 and Git blob identities; supplies the archived sources through an original-only resolver; and checks the complete reference input set. An unarchived original import throws rather than falling back to live source. Its expected graph contains 32 historical source modules plus the synthetic entry.

The candidate bundle remains a separate build of the current fixture and production graph. Its input paths and hashes are recorded separately. Freezing historical dependencies therefore avoids rejecting legitimate later protocol changes merely because current source differs from a historical hash; it does not freeze the candidate engine under test.

The reviewer also compared the spec with the parent of `40bf6c7`: the entire suffix from `async function load` onward is unchanged. Native numerical thresholds, both test bodies, sensitivity controls and cleanup assertions were not relaxed by that repair. The commit itself changes only the spec, archive and report.

This is a closed historical graph for that audio comparison. It is not a complete historical application build, and this session must not claim to have newly implemented the earlier audio engine optimization being measured.

### Targeted runtime module substitutions

The [shared runtime helper][probe-helper] instead obtains only declared modules with `git show` at this task's dda5 baseline. Every other dependency comes from the candidate checkout in both variants.

| Probe | Historical substitutions |
| --- | --- |
| Radio | `src/core/radio.ts` |
| Input queue | `src/net/input.ts` |
| Lane cache | `src/simulation/track-lane-index.ts` |
| Thermal | `src/simulation/surface-thermal.ts` |
| Codec | `src/net/bytes.ts`, `src/net/codec.ts` |
| Full Simulation composition | Lane index and surface thermal modules together |

The helper verifies that each declared target actually loaded, checks candidate target bytes and HEAD after bundling, and gives even identical bundles distinct module instances. Its tracked-status check covers `src`, the probe directory, package files and tsconfig. Untracked files are explicitly excluded; dirty status is recorded rather than universally rejected. The accepted reports show clean status in that scope.

Thus the probe result means “the selected original modules and candidate modules produced the compared outputs within the same candidate dependency graph.” It does not mean two complete historical/current engines were independently built. The full-Simulation entry exercises the real Simulation but retains that targeted substitution boundary.

Structural copy and operation reductions are evidence for the supplied workloads. Their timings do not establish game FPS, total heap/GC, energy, physical networking or hardware performance. Browser acceptance uses a software Mesa/llvmpipe backend; offline native audio likewise does not establish physical speaker or AudioWorklet behavior.

## Broader content failures demonstrably predate this task

At the immutable task baseline, the retained [general CI report][baseline-report] points to run **45611188717**, source `a7f1eb9798cc19fd2a1f9abd515de1189231bb2a`. The reviewer fetched that run and its jobs directly. The overall run was **canceled**, while unit jobs **139194831495** and **139194831518** had already completed with failure. Its validate job completed successfully.

The baseline's retained [partition-1][baseline-unit-1] and [partition-3][baseline-unit-3] logs contain these same failures and diagnostics later present in the 92e general run:

| Completed baseline job | Existing failed case | Matching diagnostic |
| --- | --- | --- |
| Unit partition 1, 139194831495 | `apx01-livery.test.ts`: player livery and wing material role | Expected `turned-alloy` not to equal `turned-alloy` |
| Unit partition 1, 139194831495 | `vehicle-catalogue.test.ts`: design-band calibration | GPR-1 calibration hash `eca1c71a` versus `5f121c00` |
| Unit partition 3, 139194831518 | `i18n.test.ts`: all seven dictionaries | Nonempty dictionary findings where an empty result was required |
| Unit partition 3, 139194831518 | `vehicle-catalogue-growth.test.ts`: frozen machines | GPR-1 frozen hash `5f121c00` versus `eca1c71a` |

GitHub ancestry comparison reports a7f1eb9 as the merge base with dda5, with dda5 four commits ahead and none behind. These completed job failures and their retained logs therefore predate this task's baseline. The report does not call the canceled overall run a completed failure, infer an original defect introduction commit, or claim that all possible later content outcomes are covered by this comparison.

The later [92e general workflow][general-run] still fails. In addition to these preexisting content cases, its validate log records this session's new `no-this-alias` error in `engine-worker-idle-scheduling.test.ts`. That error is not preexisting and was assigned its own correction. The subsequent 748 `prefer-const` failure is likewise a new harness issue. Keeping these classifications separate is necessary even when the focused engine runtime checkpoint itself passed.

No content, vehicle tuning, livery, model, renderer or translation file was changed by this provenance review.

## Prior-session work and final claim discipline

Prior accepted source `774e62fafdfd9ecd84001a2fcdb3b9f6ee973b86` has its own [successful workflow][prior-run] and retained 914-unit/47-native logs under `docs/engine/advancement-2026-11-25`. Its documentation handoff is `c803ac92ad732b7a5fe491c3426671940a1c1ba3`. GitHub ancestry confirms that handoff is an ancestor of this task's dda5 baseline, six commits behind it.

Those earlier implementations, sixty-agent ledger, acceptance counts and decoded attachments are prior work. They are useful context and continuing regression coverage, not sixty agents or 914 new tests performed by this session. The current session uses its distinct `runtime-2026-11-25` ledger and checkpoints.

Release claims should identify the eventual successful source and run, distinguish new changes from inherited contracts, retain failed intermediate gates, and preserve the difference between structural measurements and hardware performance. If a final documentation-only commit follows an accepted executable source, demonstrate that runtime/test/workflow/dependency inputs are unchanged and keep the accepted source identity visible. A green result should never be silently transferred across later code or harness changes.

[prior-run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45592833399
[accepted-run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45637677573
[failed-run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45641670477
[lint-run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45644838370
[general-run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45637677739
[accepted-result]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/748814f648badd2e355c47c2f6ddc7321a0ed494/docs/engine/runtime-2026-11-25/evidence/92e2dc2/result.json
[accepted-probes]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/748814f648badd2e355c47c2f6ddc7321a0ed494/docs/engine/runtime-2026-11-25/evidence/92e2dc2/probes.json
[failed-result]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/748814f648badd2e355c47c2f6ddc7321a0ed494/docs/engine/runtime-2026-11-25/evidence/e2d1fec/result.json
[audio-archive]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/748814f648badd2e355c47c2f6ddc7321a0ed494/e2e/fixtures/engine-native-audio-reference-inputs.json
[audio-original]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/748814f648badd2e355c47c2f6ddc7321a0ed494/e2e/fixtures/engine-native-audio-advancement-original.ts
[audio-spec]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/748814f648badd2e355c47c2f6ddc7321a0ed494/e2e/engine-native-audio-advancement.spec.ts
[probe-helper]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/748814f648badd2e355c47c2f6ddc7321a0ed494/scripts/engine-runtime-probes/support.mjs
[baseline-report]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc/ci-reports/build-and-validation.md
[baseline-unit-1]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc/ci-reports/logs/build-and-validation/unit-tests-1.log
[baseline-unit-3]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc/ci-reports/logs/build-and-validation/unit-tests-3.log
