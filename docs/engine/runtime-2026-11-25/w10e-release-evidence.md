# W10E — Exact-source release evidence

Assignment **59/60**, wave **10** · 25 November 2026.

## Accepted engine checkpoint

**The complete focused engine gate passed at `394913934d3c6c9cfbe5ba5251beb7ebe68ee249`.** It includes full source/test/script lint, **1,351 unit cases across 95 files**, all six original-baseline comparisons, complete TypeScript checking and Vite build, and **60 native browser cases in 3.0 minutes**. The run used one browser worker, zero retries and one workflow attempt.

I independently fetched the commit/tree, workflow, run metadata, job steps, decoded complete job log and artifact REST metadata. Every required stage completed successfully for this same source. I also parsed all six probe JSON objects from the actual job log and checked each identity, success status, candidate HEAD, baseline and clean tracked state.

This is acceptance of the **focused engine source**, not a claim that the complete repository content workflow is green, that the game was deployed, or that physical hardware performance improved. No local compiler or browser execution was available to this reviewer. This assignment authors only this report and its [machine-readable evidence manifest](w10e-release-evidence.json); it makes no source, test, workflow, commit, branch or ref change.

Sources: [completed run][run], [completed job][job], [source commit][commit].

## Immutable identities

| Item | Independently observed identity |
| --- | --- |
| Executed source | `394913934d3c6c9cfbe5ba5251beb7ebe68ee249` |
| Executed Git tree | `cf9fded4f2bd81567858d5d1e19f873ebd293754` |
| Original module baseline | `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc` |
| Focused workflow run | [45647350422][run], attempt 1 |
| Native-and-replay job | [139321807542][job] |
| Workflow result | Completed, success |
| Probe runtime | Node v22.23.5; esbuild 0.25.12 |
| Observed graphics backend | ANGLE / Mesa llvmpipe, LLVM 20.1.2, OpenGL 4.5 |

The Git commit object resolves to the tree above. The workflow metadata and all six probe records identify the same executed source. The manifest preserves all 31 root Git entries and eleven specific workflow/configuration/dependency blob identities, including the lockfile and native save service, for a later publication comparison.

The independently inspected [0bc-to-394 comparison][comparison] contains two commits: an incoming CI-report update and the corrected checkpoint. Its only executable change is the desktop fixture's intentional cast from `window as BindingWindow` to `window as unknown as BindingWindow`. Production source, workflow and dependency files are unchanged in that comparison. This explains the correction; the new successful run—not textual similarity—is what establishes current acceptance.

## Required stages and observed outcomes

| Gate | Observed result |
| --- | --- |
| Record source and dependency identities | Successful; commit/tree and lockfile/native-service digest files created |
| Locked dependency installation under source guard | Successful |
| Full ESLint over `src tests e2e scripts` | Successful |
| Complete focused unit selection | **1,351 passed, 95 files passed** |
| Six original-baseline comparisons | All six expected report identities succeeded |
| TypeScript and Vite | Both successful; Vite ran after the compiler |
| Browser and Mesa/Xvfb preparation | Successful |
| Native engine and replay selection | **60 passed**, one worker, no retries |
| Native service digest checks | Two actual `desktop/src/save-mirror.cjs: OK` outputs, before and after native execution |
| Evidence upload and job cleanup | Successful |

The decoded log explicitly reports `Running 60 tests using 1 worker` and `60 passed (3.0m)`. The unit command contains `--allowOnly=false --retry=0`; the native command contains `--workers=1 --retries=0 --forbid-only`. No failed, skipped or flaky native case appears in the terminal summary. The job and overall run both conclude success.

This selection contains inherited regression coverage as well as new cases. Its increase over an earlier checkpoint must not be described as that many newly authored tests. In particular, the six existing storage/network suites added during this task contribute 191 cases, as the [provenance audit](w09d-evidence-provenance.md) documents.

Sources: [exact workflow][workflow], [decoded job output][job], [retained complete log][retained-log].

## Recovery and ownership cases now executed

The run resolves the pending execution boundary recorded in the earlier native and fixture reviews. The log specifically reports:

| Scoped coverage | Observed passing cases |
| --- | ---: |
| Desktop revision ownership | 16 |
| Persistence integration, including healthy legacy comparison and rejected-load control | 14 |
| Canceled-event lookup retirement | 7 |
| Worker idle scheduling | 7 |
| Flashback diagnostic state | 7 |
| Actual network runtime composition | 3 |

The two new native desktop scenarios both passed. They require the A→B→A sequence to keep the native file prefix older but complete until a fresh owner seeds all local data; they also require a refused full seed to prevent a later partial write from concealing missing data, followed by successful complete recovery and resumed incremental writes.

The new native worker-idle scenario also passed. It requires positive native callback/tick activity, parked observation windows, cancellation inside the finishing rewind callback, rejected revival after terminal failure, and fresh-session recovery. The runner reports that case by its full name: “native worker parks every idle owner and wakes only runnable physics or resimulation.”

These are passing runner/assertion outcomes from the inspected log. I did not separately open the browser JSON attachments. The desktop tests use real IndexedDB and the production Node file service through an explicitly labeled Playwright binding; they do not establish Electron preload/IPC. The timer witness uses actual worker timers, while controlled unit tests separately exercise forced stale callbacks and the full surface-credit bound.

Sources: [native acceptance review](w09e-native-acceptance.md), [desktop specification][desktop-spec], [idle specification][idle-spec], [job output][job].

## Six baseline reports at the accepted source

I parsed the reports directly from the decoded job log. Exactly the following six identities are present:

| Report `probe` | Observed success status | Declared historical replacement |
| --- | --- | --- |
| `codec` | `passed` | Byte writer and codec |
| `lane-cache-actual-git-baseline` | `passed` | Lane index |
| `server-input-queue` | `passed` | Input queue |
| `radio` | `passed` | Radio state |
| `whole-simulation-composition` | `pass` | Lane index and thermal solver together |
| `surface-thermal` | `passed` | Thermal solver |

For every report, `candidateHead` equals the accepted 3949139 source, `baselineRef` equals the immutable dda5 baseline, and `candidateTrackedState` is `clean`. Each records Node v22.23.5, esbuild 0.25.12, declared source hashes, separate bundle hashes and the scope of replacement. The manifest retains those six complete provenance records.

The [shared helper][helper] fetches the declared original modules with `git show`, verifies that each target was loaded, and gives the two variants separate module instances. Other dependencies come from the same candidate checkout. These remain historical-module substitutions, not two complete historical/current application builds. The tracked-status scope excludes untracked files and is narrower than the whole repository.

The accepted reports preserve the deterministic correctness checks alongside their operation/copy observations. The [measurement report](w09b-measurements.md) explains earlier 92e timing vectors and structural counts; its timings remain attributed to that historical run. The [current six reports][retained-probes] carry this accepted source's own provenance and sample vectors. Neither source supports turning codec copies or queue timings into a whole-game FPS, CPU, power, GC or physical-network guarantee. The Simulation comparison still covers one simulated second per weather preset; eviction stress belongs to the separate lane probe.

## Source stability and imported desktop service

The source guard ran around locked installation, lint, units, probes, build and native tests. Each invocation compares its starting declared inputs with its ending inputs and returns the child exit status. A successful gated step therefore requires both child success and an unchanged protected snapshot for that invocation.

Its declared snapshot includes `src`, `public`, `scripts`, `tests`, `e2e`, `docs`, `.github`, and root files. It deliberately excludes the named generated player-LOD derivative, browser receipt outputs and ordinary output directories. It does not cover `desktop/src`, and it does not prove whole-repository immutability or freeze inputs between separate invocations.

The workflow covers the native service separately: it records a digest before the gate and checks it before and after the successful browser pipeline. I observed both check outputs as `OK`. The exact Git blob of the imported service is `f3a2e99d014e423b9919bed3b6ebde246e91e1eb`; the workflow blob is `9ddcd685aa39adef31a6f29127f36685a35a07d3`, and the lockfile blob is `9f3197395e8b9ec7d82e73668b21727b37038805`.

The checksum-file contents themselves were not downloaded from the artifact. The observed checks establish equality to the value recorded by this run; the Git blob identities independently pin the reviewed repository inputs. Direct compiler/build/test invocations avoid the package's model-generation hooks.

Sources: [source guard][guard], [workflow][workflow], [input tree][tree], [job output][job].

## Artifact and durable evidence

The upload log and the independently fetched [artifact API response][artifact-api] agree:

| Item | Observed value |
| --- | --- |
| Artifact ID | **15039007572** |
| Name | `engine-runtime-validation-394913934d3c6c9cfbe5ba5251beb7ebe68ee249` |
| Size | **1,388,869 bytes** |
| Reported ZIP SHA-256 | `1b4cdb12aa288b6874957d75bf9960ba59a0740e6df55d3cf74ae2a053fcfaf3` |
| Artifact state at inspection | Not expired |
| API expiration | `2026-12-02T15:47:53Z` |

The artifact metadata identifies the same workflow run and source HEAD. **This digest was corroborated between metadata and upload output, not independently recomputed from a downloaded ZIP.** I did not download the ZIP or inspect its traces, screenshots or attached native JSON.

The complete decoded job log contains **200,174 characters** after the documented normalization: ANSI escapes and line-leading timestamps removed, all remaining command/output text retained. Root is responsible for retaining that log, the complete six parsed probe objects and a compact result under `evidence/3949139/`. The expected handoff targets are [result.json][retained-result], [probes.json][retained-probes], and [hosted-job.log][retained-log]. These should be present in the final publication, extending availability beyond the hosted artifact's seven-day retention.

## Historical failures and final publication boundary

The failed intermediate gates remain part of the record. The e2d persistence fixture failure, 748 observer lint failure, and 0bc browser-binding type failure are not reclassified as successes. Their corrections are now included in the accepted source and exercised by its complete gate. Earlier 92e acceptance remains valid for that earlier source.

The complete repository workflow is separate. The [provenance review](w09d-evidence-provenance.md) demonstrates that the four broader livery, dictionary and vehicle catalogue failures existed before this task. This focused acceptance does not change their status or authorize changes to protected visual/vehicle content.

This report pins the executed 3949139 source. It does **not** invent or certify a later documentation publication commit. Before final handoff, the coordinator must compare later commits with their immediate parents and with this executed source, retaining identical runtime, test, workflow and dependency inputs where only reports/evidence were added. The manifest's root/input identities support that comparison; the final report should retain the executed SHA even if `main` subsequently advances.

No further runtime test was run by this reviewer, and no extra pass is inferred from source similarity. The complete successful hosted run is the acceptance evidence.

[run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45647350422
[job]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45647350422/job/139321807542
[commit]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/394913934d3c6c9cfbe5ba5251beb7ebe68ee249
[tree]: https://api.github.com/repos/cheshmakzanoon-ops/Experiment-3/git/trees/394913934d3c6c9cfbe5ba5251beb7ebe68ee249?recursive=1
[comparison]: https://github.com/cheshmakzanoon-ops/Experiment-3/compare/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a...394913934d3c6c9cfbe5ba5251beb7ebe68ee249
[workflow]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/.github/workflows/engine-runtime-validation.yml
[guard]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/scripts/source-stability.ts
[helper]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/scripts/engine-runtime-probes/support.mjs
[desktop-spec]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/e2e/engine-native-desktop-recovery.spec.ts
[idle-spec]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/e2e/engine-native-worker-idle.spec.ts
[artifact-api]: https://api.github.com/repos/cheshmakzanoon-ops/Experiment-3/actions/runs/45647350422/artifacts
[retained-result]: evidence/3949139/result.json
[retained-probes]: evidence/3949139/probes.json
[retained-log]: evidence/3949139/hosted-job.log
