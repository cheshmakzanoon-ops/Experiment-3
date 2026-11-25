# W10F — Independent final engine release review

Assignment **60/60**, wave **10** · 25 November 2026.

## Decision and reviewed boundary

**The focused engine checkpoint is accepted at `394913934d3c6c9cfbe5ba5251beb7ebe68ee249`.** I independently retrieved the completed run, successful job stages and full decoded output. The reviewed documentation preview preserves its accepted executable inputs, retains matching evidence and accurately states the limits of the result. No blocking source-preservation or evidence-consistency issue was found within this review.

This report reviews preview tree **`29a0d5c4af9f7fab4ea27baa156b4d6bdb119c27`**, based directly on the executed tree. It does not invent or certify a later publication commit. The coordinator still owns the latest-main comparison, integration of this report, completion-ledger update and expected-head publication. The [machine-readable review](w10f-final-review.json) preserves the inspected identities and checks.

Sources: [accepted commit][commit], [successful focused run][run], [successful job][job], [reviewed preview tree][preview].

## 1. Complete acceptance belongs to one executed source

| Item | Independently verified value |
| --- | --- |
| Executed commit | `394913934d3c6c9cfbe5ba5251beb7ebe68ee249` |
| Executed tree | `cf9fded4f2bd81567858d5d1e19f873ebd293754` |
| Historical module baseline | `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc` |
| Focused run / job | 45647350422 / 139321807542 |
| Attempt and conclusion | Attempt 1; run and job completed successfully |
| Full configured source/test/script ESLint | Passed |
| Focused unit selection | **1,351 cases across 95 files passed** |
| Historical-module reports | **All six expected reports passed** |
| TypeScript and Vite | Both passed |
| Native engine and replay selection | **60 cases passed in 3.0 minutes** |
| Native execution policy | One worker, zero retries, forbid-only |
| Imported native file service | Two actual successful digest checks, before and after native execution |

All six actual probe records identify the same accepted candidate, the same dda5 baseline and clean tracked source within their declared scope. I checked the six expected identities and their actual status spelling: the Simulation report uses `pass`; the other five use `passed`.

The final log contains the passing desktop recovery and worker-idle cases, rather than merely their test definitions. Every required job stage and evidence upload completed successfully. The earlier 0bc compiler failure therefore remains a failed historical checkpoint, while the corrected 394 source now has its own complete acceptance.

The evidence includes inherited suites and new cases. These totals are not a count of newly authored tests. The [release evidence](w10e-release-evidence.md) records the selected coverage, commands, source guard and imported service in more detail.

## 2. Retained evidence matches the retrieved execution

I fetched every changed blob in the preview and compared the retained records with evidence independently obtained from GitHub:

| Retained item | Verification |
| --- | --- |
| [Complete normalized job log](evidence/3949139/hosted-job.log) | All **200,174 characters** exactly match my independently retrieved log after the same normalization |
| [Six probe reports](evidence/3949139/probes.json) | All six complete parsed objects match the independently parsed actual job records |
| [Compact result](evidence/3949139/result.json) | Source/tree, run/job, counts, stages, probe identities and artifact fields agree with the actual execution |
| [Release manifest](w10e-release-evidence.json) | Its 31 root entries and eleven explicit input identities agree with the executed tree; the preview changes only the documentation root |

The upload output records artifact **15039007572**, **1,388,869 bytes**, with ZIP SHA-256 `1b4cdb12aa288b6874957d75bf9960ba59a0740e6df55d3cf74ae2a053fcfaf3`. The separate release reviewer corroborated those fields against artifact API metadata. I did not download the ZIP, recompute its digest or inspect browser attachments or checksum-file contents. Successful runner assertions and actual digest-check outputs are the evidence used here.

The log normalization removes ANSI escapes and line-leading timestamps while retaining the other command/output text. This is a labeled normalized copy. Repository retention of the log and complete reports extends the usable record beyond the hosted artifact's seven-day retention.

Sources: [job output][job], [artifact][artifact], [release evidence](w10e-release-evidence.md).

## 3. Protected-source audit extended through the accepted checkpoint

The [existing audit](w09c-protected-path-audit.md) and [manifest](w09c-protected-path-audit.json) cover ten engine commits through `0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a`, with 970 protected SHA/mode/type equalities. I independently fetched the successor commit objects, their changed-file lists and complete recursive trees.

The extension is precise:

| Commit | Parent and actual change scope |
| --- | --- |
| `f195454a45f8fc86fd7a5689d158695641a582b5` | Direct child of 0bc; eight changed files, all under `ci-reports/` |
| `394913934d3c6c9cfbe5ba5251beb7ebe68ee249` | Direct child of f195; nine documentation/evidence files and one native fixture line |
| `8e68b49c5fae635db3e3d015a7ef023edbdc6f12` | Later main observed during review; direct child of 394, changing only eight CI-report paths |

The sole executable difference in the accepted checkpoint's own commit is:

~~~diff
- const operation = (window as BindingWindow).__engineNativeDesktopCall({
+ const operation = (window as unknown as BindingWindow).__engineNativeDesktopCall({
~~~

It makes the intentionally injected test binding explicit to TypeScript and retains the fixture's runtime operations and assertions. Production, workflow and dependency inputs do not change in the 0bc-to-394 comparison. The `src` subtree also remains exactly `ed1aa16fcfbd61e8220025d0c5fc535603955896` from the last production checkpoint `e2d1fec2ff3b38a2cf962e9974cfe0622259823b` through accepted 394.

All **97 protected identities** in the audit's current set match across 0bc, immediate parent f195, accepted 394 and the reviewed preview. Together with the earlier audit, this extends the recorded check to **eleven own commits and 1,067 protected equalities**. The existing audit supplies the earlier 970; this assignment independently supplies the closing 97 and preview comparison.

All **19 animation files** from concurrent commits `ef503b28033760315eff29b1147f05d2ab426bcf` and `e3ad320b1d54fb28db5a3d6b09b1faf7350a0ff2` retain their exact animation-commit blobs in the inspected states. The later incoming 8e68 commit changes only CI reports; every other tracked leaf retains SHA, mode and type.

These checks preserve the audited models, characters, authored environments, rendering, shaders, protected host/protocol/offroad sources and concurrent animation content. They establish source preservation. Shared engine behavior can still affect gameplay, so this is not a separate visual or hardware-behavior certification.

Sources: [0bc-to-394 comparison][extension], [incoming f195][incoming-before], [observed later main][incoming-after], [audit manifest](w09c-protected-path-audit.json), [closing identity manifest](w10f-final-review.json).

## 4. The documentation preview preserves the tested inputs

The full preview contains **11,161 entries** and was returned without truncation. Comparing every leaf against the executed tree produces exactly **13 changed files**, all under `docs/engine/runtime-2026-11-25/`. There are no changed runtime, test, workflow, dependency, native-service, asset or authoring inputs.

Thirty of the 31 root entries remain identical; only `docs` differs. Every one of the eleven explicit workflow/configuration/dependency/service identities in the release manifest matches. The complete leaf comparison also preserves documentation elsewhere that might serve as a test fixture or historical source archive.

I reviewed the overview, architecture, reproduction, limitations, assignment index and release evidence, together with the closing checkpoint entries and the historical composition review's acceptance boundary. Their claims retain the relevant qualifications:

- SaveStore completion means the local IndexedDB transaction committed. Native bridge acknowledgement and file flush remain asynchronous.
- Leaderboard and ghost operations remain separate transactions. The compatibility queue coordinates callers sharing the same JavaScript store object.
- Full reconciliation is not globally atomic with arbitrary concurrent writers. The current recovery fix detects incomplete predecessors and blocks unsafe incremental certification.
- Cancellation promptly releases ownership and callers; it does not forcibly terminate dynamic import or every already-started asynchronous effect.
- Prepared packet assembly and transport still copy; canceled EventLoop heap tombstones remain; lane bookkeeping adds bounded key references; lazy guidance moves required route work to first eligible use.
- Historical-module probes share current dependencies outside their declared replacements. The real-Simulation comparison covers one simulated second per weather case; separate lane stress supplies eviction evidence.
- Mesa software rendering, OfflineAudioContext and the explicit desktop Playwright binding do not establish physical GPU/audio/controller behavior or Electron IPC.

The reproduction guide matches the inspected focused workflow, including source guards, direct compiler/build invocations, zero-retry policies, all six report identities, failure-preserving pipelines and native-service digest checks. It avoids the package's model-generation hooks.

The overview's structural reductions are attributed to their historical 92e measurement source. The accepted 394 reports contain their own provenance and sample vectors. Neither the guide nor this review converts operation counts into unmeasured whole-game FPS, power, GC or physical-network guarantees.

Historical reports retain what was pending or failed when they were authored. The overview explicitly directs readers to the later accepted-source record. That keeps the earlier fixture, lint and compiler failures visible without treating them as current unresolved production defects.

Sources: [preview][preview], [architecture](w10a-architecture.md), [reproduction](w10b-reproduction.md), [limitations](w10c-limitations-handoff.md), [checkpoint history](CHECKPOINTS.md).

## 5. Sixty actual assignments and closing report links

I independently fetched the coordinator's 60-entry snapshot and the preview ledger. Both contain exactly **60 unique agent IDs**, **60 unique contiguous assignment numbers 1–60**, and **ten waves with six assignments each**. Every assignment's wave agrees with its number. The prior session's separate sixty-agent ledger is excluded.

The earlier snapshot had 57 complete assignments and 58–60 running. The preview changes only the statuses of assignments 58 and 59 to complete, retaining the same identities and task text. It honestly records **59 complete and only assignment 60 running** while this report is being written. Delivery of this report supplies the final assignment's output; the coordinator can then record actual completion.

The three-worker scheduler limit is explicit. The ten waves are logical assignment groups and do not claim sixty simultaneous workers or count coordinator actions, follow-up turns or failed spawn attempts as new agents.

I resolved **207 relative Markdown file-link occurrences** across the changed Markdown, covering **87 unique targets**. Every target exists in the preview except this intentionally pending `w10f-final-review.md`, referenced five times. The assignment index has 60 distinct primary report links: 59 targets are present, and this report supplies the sixtieth. These are file-target checks, not an assertion that every external URL or heading fragment was separately tested.

Sources: [assignment index](w10d-assignment-index.md), [ledger](AGENTS.json), [review manifest](w10f-final-review.json).

## 6. The broader repository workflow remains separate

At **2026-11-25 16:02:13 UTC**, I independently fetched broader [run 45647350414][general-run] for the same 394 source. It was still in progress. Its validate, scenarios, offroad-scenarios, wet-presentation and unit partitions 2/4 had passed. Completed unit jobs **139322017689** and **139322017702** failed on the four documented content cases. I fetched both actual logs:

| Current completed failure | Matching evidence before this task |
| --- | --- |
| APX-01 livery material: `turned-alloy` must differ | Baseline retained partition 1; original completed job 139194831495 |
| GPR-1 calibration: `eca1c71a` versus `5f121c00` | Same baseline partition 1 and job |
| All-seven-dictionaries assertion in i18n | Baseline retained partition 3; original completed job 139194831518 |
| GPR-1 frozen catalogue-growth hash mismatch | Same baseline partition 3 and job |

I also fetched those immutable baseline logs, original run 45611188717 and its job metadata. The original overall run was canceled, while both named unit jobs had already completed with failure. Its source `a7f1eb9798cc19fd2a1f9abd515de1189231bb2a` is an ancestor of dda5; the inspected comparison is four commits ahead and none behind.

This establishes that these four observed content failures predate this task. It does not classify every possible later browser or owner-QA result: those remaining jobs were still running at this review boundary and are not certified here. No whole-repository green result or deployment follows from the successful focused engine gate. The engine work did not weaken their protected expectations.

Sources: [current unit partition 1][general-unit-1], [current unit partition 3][general-unit-3], [baseline partition 1][baseline-unit-1], [baseline partition 3][baseline-unit-3], [provenance review](w09d-evidence-provenance.md).

## 7. Publication boundary and reviewer limits

The coordinator should refresh main, inspect every intervening commit and build the final overlay from that exact latest tree. This preview is deliberately based on the executed tree; it must not replace newer unrelated CI or animation history. Add only the reviewed current-task documentation/evidence, this report and actual completion updates. Recheck parent-relative changes and equality of the executed runtime, tests, workflow and dependency inputs, then publish with the inspected parent, expected head and `force: false`.

This report certifies the specified preview and observed source history. It cannot certify a not-yet-created commit, an unobserved expected-head update or later main. The executed SHA must remain visible in the final handoff even when main advances through documentation or incoming CI-report commits. Any new executable or harness change needs its own integrated gate.

This assignment performed no local compiler/browser execution, no new runtime tests and no benchmark. It rechecked release evidence, source identities, protected boundaries, documentation consistency and relative file targets; it does not claim a new line-by-line review of every production module. The earlier independent implementation and composition reviews remain linked evidence for those contracts.

Only this report and its matching JSON are authored by assignment 60. No production, test, workflow, model, character, environment, animation, commit, branch or ref was changed by this reviewer.

[commit]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/394913934d3c6c9cfbe5ba5251beb7ebe68ee249
[run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45647350422
[job]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45647350422/job/139321807542
[preview]: https://api.github.com/repos/cheshmakzanoon-ops/Experiment-3/git/trees/29a0d5c4af9f7fab4ea27baa156b4d6bdb119c27?recursive=1
[artifact]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45647350422/artifacts/15039007572
[extension]: https://github.com/cheshmakzanoon-ops/Experiment-3/compare/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a...394913934d3c6c9cfbe5ba5251beb7ebe68ee249
[incoming-before]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/f195454a45f8fc86fd7a5689d158695641a582b5
[incoming-after]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/8e68b49c5fae635db3e3d015a7ef023edbdc6f12
[general-run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45647350414
[general-unit-1]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45647350414/job/139322017689
[general-unit-3]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45647350414/job/139322017702
[baseline-unit-1]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc/ci-reports/logs/build-and-validation/unit-tests-1.log
[baseline-unit-3]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc/ci-reports/logs/build-and-validation/unit-tests-3.log
