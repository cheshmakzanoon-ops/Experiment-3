# Engine completion and evidence audit — 24 November 2026

## Decision and source boundary

**The final production engine satisfies the programme's scoped acceptance checks.** The 60 changed unit suites pass all 1,072 executions, the required native-browser/replay run passes all seven cases, whole-project lint/compiler/build validation passes, and every protected content group is unchanged. The complete final broad unit run records **8,645 passed and four exact pre-existing baseline failures across 840 files**. No additional engine test failed in those four partitions. The remaining baseline content assertions stay visible; this is not a claim that every repository workflow is green.

This independent audit is by agent 60. The [scope report](ENGINE_SCOPE_AUDIT_2026-11-24.md), [regression inventory](ENGINE_REGRESSION_INVENTORY_2026-11-24.md), [CI report](ENGINE_CI_VALIDATION_2026-11-24.md) and [browser report](ENGINE_BROWSER_VALIDATION_2026-11-24.md) retain the detailed evidence behind the conclusions below.

| Boundary | Revision or identity |
| --- | --- |
| Original engine | [`a0ae513e7982f0b4719296519752e0ae5f1983f8`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/a0ae513e7982f0b4719296519752e0ae5f1983f8) |
| Original Git tree | `3e5dd0888f193dbde62f6ce5cdebdd1c2ee9847c` |
| Final production source | [`b282f121b5766df26466d413d2c685b2f826799d`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/b282f121b5766df26466d413d2c685b2f826799d) |
| Final production Git tree | `1472d9c28a270af720507d90f490d52ff5ca1fbb` |
| Recovered local production-build fingerprint | `c3f2de274c415d70a377784a67bd926bbf96dff062385ffd90d75352c8847106` |

The final production commit is a direct child of `596bdfc44a47c39d299324cf30969c74e6e448c5`, preserving the earlier engine and report history. Its observed child `43b97751e92e86b923aa896437f640710a41e577` changes only automated CI reports/logs. The immutable source boundary for this audit remains `b282f121`. Publishing this report or other evidence later does not represent another execution of the tests.

## Sixty assignments across ten waves

The [task ledger](ENGINE_TASK_LEDGER_2026-11-24.md) contains exactly 60 unique numeric identifiers, 01–60, in ten groups of six. The coordinating agent is excluded. The coordinator's retained execution record identifies them as distinct spawned agents. The current collaboration inventory exposes recent agents only, so this auditor does not claim to have independently retrieved all historical spawn receipts.

| Wave | Agent identifiers | Recorded responsibility |
| --- | --- | --- |
| 1 | 01–06 | Fixed-step scheduling, input lifecycle and worker delivery |
| 2 | 07–12 | Resource ownership, asynchronous startup and preparation |
| 3 | 13–18 | Collision/query work, terrain cache, snapshots and flashback |
| 4 | 19–24 | Host cancellation, transferable buffers and protocol boundaries |
| 5 | 25–30 | Replay, telemetry, recording, persistence and desktop mirroring |
| 6 | 31–36 | Rendering infrastructure, presentation ownership and disposal |
| 7 | 37–42 | Audio, input devices and replay/session transitions |
| 8 | 43–48 | Deterministic networking services, timing metrics and route search |
| 9 | 49–54 | Independent measurements, determinism, scope and adversarial review |
| 10 | 55–60 | Final physics/resource/network reviews and consolidated acceptance |

At production publication, the ledger deliberately left agents 59 and 60 awaiting final published-source receipts. The final CI report and this audit close those evidence assignments. Recovery and follow-up work reused the existing agents and does not add identifiers to the requested 60.

The final wave contributed eight physics/terrain invariant cases without another production physics edit, 18 resource-lifetime cases, and 11 composed network cases. The new resource fixes are confined to three existing disposal methods. The network fix concerns terminal server ownership, observer cancellation and late transport acceptance. The [physics](ENGINE_PHYSICS_REVIEW_2026-11-24.md), [resource](ENGINE_RESOURCE_REVIEW_2026-11-24.md) and [network](ENGINE_NETWORK_REVIEW_2026-11-24.md) reviews describe those findings and their limits.

## Protected content and runtime scope

Both complete recursive Git-tree responses reported `truncated: false`. Agent 60 compared the union of blob paths by path, mode and object ID, then independently regenerated all eleven protected-content manifests.

| Protected group | Unchanged tracked files |
| --- | ---: |
| Complete public directory | 231 |
| Public models, included above | 44 |
| Repository asset-extension files | 2,996 |
| Source JSON and asset-extension files | 58 |
| Rendering files outside the 13 individually reviewed runtime exceptions | 695 |
| Simulation files outside the seven individually reviewed runtime exceptions | 167 |
| Vehicle catalogue | 16 |
| Other open-world simulation modules | 33 |
| Package manifest, lockfile, Vite and TypeScript configuration | 4 |
| Selected protocol and schema definitions | 6 |
| Selected input calibration, defaults and performance policy | 4 |

Groups overlap and must not be added together. Every listed group has exactly the baseline path inventory, file modes and blob IDs. All eleven manifest SHA-256 values match the original scope audit. The complete public manifest is `b86dd5b10cc6dafd4e973e9ceadcf22acc6e3ef713ddd1c782599b48f2caf39f`; the asset-extension manifest is `50a2bde344da7a928b0db67a0dd190ebb71b1d128550275e2340dde3be91297c`.

The baseline has 9,545 blob paths and the final production tree 9,640. Their comparison finds 174 changed, added or removed paths, including 54 production-source paths and 60 unit-test suite paths. These are source-boundary counts, including automated report changes; they are not counts of wholly new engine systems.

Four production files changed in the final wave: `src/main.ts`, `src/session/free-roam.ts`, `src/rendering/open-world/festival-renderer.ts` and `src/net/server.ts`. Agent 60 inspected their wave-9 and final contents. Using exact TypeScript AST method ranges independently extracted by agent 59, the auditor verified complete-file equality after removing only each of the three changed `dispose` methods. The other 197 `GameApp` members, 51 `FestivalSession` members and 108 `FestivalRenderer` members, together with all text outside those methods, are preserved. The scope report records the remainder hashes and final Git blobs.

Authored model, character, environment, material-definition and vehicle-tuning content is preserved. Runtime cancellation, cleanup, refresh, scheduling and malformed-input behavior intentionally change where the programme fixes defects. Scope preservation does not imply that every runtime behavior is identical.

## Recovery and consolidated final-code regressions

The execution host was replaced before the final wave was published. The first nine waves were already on main. The exact final production patches were recovered from retained agent records; two networking test tails were reconstructed and then verified afresh. Earlier interrupted runs are not counted as successful verification of the restored files.

The recovered consolidated run executed every added or modified unit-suite file once:

| Inventory group | Files | Passed executions | Distinct `(file, fullName)` identities |
| --- | ---: | ---: | ---: |
| Added files | 55 | 1,004 | 1,000 |
| Modified existing files | 5 | 68 | 68 |
| **Total** | **60** | **1,072** | **1,068** |

There were **zero failed, skipped or pending cases and no retries**. Four parameterized labels each occur twice because JSON-style title formatting represents both `NaN` and `Infinity` as `null`. The receipt retains both executed input cases and their occurrence counts while conservatively counting each repeated displayed identity once. These totals do not add together overlapping earlier agent runs or broad CI results.

The original execution HEAD was `596bdfc`, with the final four production files and three new suites still present as frozen worktree changes. The report preserves that fact. After publication, agent 58 compared all 1,074 production inputs, 851 test inputs and four configuration inputs from the published `b282f121` Git tree with the pre-run content manifests. Every path and SHA-256 content hash matched.

Agent 60 independently checked the inventory JSON against the final Git tree: all 60 selected suite paths and their added/modified classifications agree; all 1,068 listed identities pass; occurrence weights total 1,072; all 60 process attempts have a successful exit and attempt number one. The final tree's input path counts agree with the publication mapping. The auditor also independently calculated the SHA-256 of all four final production files from GitHub-retrieved contents and matched the frozen regression receipt.

The [machine-readable inventory](ENGINE_REGRESSION_INVENTORY_2026-11-24.json) retains source manifests, selected test hashes, case identities, process settings, result/log digests and the explicit post-execution publication mapping. Its production input manifest is `8dec1a18da6a2dc05169a7947eaa85205dcfbaf7b1c4979570aabe62a429ebb1`; its test input manifest is `5bae7c8c7bfd4a7f4ec0fc753812fa8579e5908e0fe57b8ceb5c04d57e19ceb9`.

## Compiler, build and native-browser acceptance

The coordinator's separate restored-source verification passed whole-project TypeScript checking across 3,169 files, scoped lint, and a direct production Vite build of 1,094 modules. The existing output IP guard and source-stability guard passed. Four selected unchanged network cases also passed; those four are not added to the 60-suite total. The inventory records the retained log digests and the local build fingerprint above. Its local build commit field is `null`, correctly reflecting the pre-publication frozen worktree rather than retroactively claiming a committed build.

The exact published source also passed the [full CI validate job, 138535678691](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138535678691), completed at 15:07:32 UTC. Its primary log confirms whole-repository ESLint across source/tests/E2E/scripts, content validation, full TypeScript checking, production and demo Vite builds of 1,094 modules each, both output IP guards and source stability. This published-source result is separate from the recovered local compiler/build receipt.

The exact published source then passed the [focused native job, 138535240120](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620728/job/138535240120): **seven of seven cases passed**, with zero retries and the existing test deadlines. The job also passed whole-project TypeScript and the direct Vite build before browser execution. Its retained [artifact, 14933807988](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620728/artifacts/14933807988) records the source/build/backend receipts and browser evidence.

The verified backend was `ANGLE (Mesa, llvmpipe (LLVM 20.1.2 256 bits), OpenGL 4.5)`. Six native cases cover replay-cache isolation, late IndexedDB opening/disposal, atomic save rollback and recovery, version-change reconnection, mirror transaction completion/abort behavior, and real Worker transfer/reuse. The seventh is the complete replay-state scenario, including exact-end seek, pause and restart from the retained floor.

The earlier mirror test's incidental observer-order failure is resolved on the final source. The corrected assertion still requires request success first and exactly one rejection and one abort observation. Rollback, recovery, page-error and subsequent behavior assertions remain in place and all ran successfully. No production storage code, Playwright deadlines, retry policy or backend checks were relaxed for this correction.

## Complete final broad CI and baseline distinction

The independent CI audit verified all four completed unit partitions on the exact final production commit. Results are from [run 45419620548](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548), rather than a preceding wave or a later report commit.

| Partition | Primary job receipt | Passed | Failed | Files |
| --- | --- | ---: | ---: | ---: |
| 1 | [138535679555](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138535679555) | 2,142 | 2 | 210 |
| 2 | [138535678897](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138535678897) | 2,240 | 0 | 210 |
| 3 | [138535678313](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138535678313) | 2,227 | 2 | 210 |
| 4 | [138535678541](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138535678541) | 2,036 | 0 | 210 |
| **Total** | **Final source `b282f121`** | **8,645** | **4** | **840** |

The 8,649 executed cases include zero skipped, pending or todo cases. The final logs contain no additional unhandled-error or outer source-guard failure. These broad results overlap the 60-suite inventory and are not added to it.

All four failure signatures and payloads exactly match the [original baseline run](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45389569436), as verified by agent 59's primary-log comparison. Agent 60 independently confirmed that all four test files retain their baseline Git blob IDs at the final production commit.

| Unchanged failing test | Exact baseline finding retained |
| --- | --- |
| `tests/apx01-livery.test.ts` | Player wing material metadata is `turned-alloy`, which the existing assertion excludes |
| `tests/vehicle-catalogue.test.ts` | gpr1 calibration contains `eca1c71a`, while the assertion expects current hash `5f121c00` |
| `tests/i18n.test.ts` | The same 14 missing-key records for the two motorcycle rear-brake labels in seven languages |
| `tests/vehicle-catalogue-growth.test.ts` | Current gpr1 hash is `5f121c00`, while the frozen expectation is `eca1c71a` |

No model, material definition, vehicle tuning, dictionary or frozen catalogue expectation was altered to remove these failures. The [CI report](ENGINE_CI_VALIDATION_2026-11-24.md) retains the baseline job links and assertion comparisons.

The same final-source run also passed [physics scenarios](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138535678867), [off-road scenarios](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138535679205) and [wet presentation](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45419620548/job/138543129772). The wet-presentation job passed seven browser cases using its observed SwiftShader backend. That is a separate run from the required seven-case native/replay run using verified Mesa llvmpipe; neither result is presented as physical-GPU or FPS validation.

At the final CI audit snapshot, **15:28:32 UTC**, the wider browser inventory still had seven jobs running and nine queued, while four owner-review jobs were running. Those job states are not counted as passes. The completed checks above provide the stated acceptance evidence; the full release workflow is not declared all-green.


## Measured benefits and deterministic preservation

The [performance report](ENGINE_PERFORMANCE_2026-11-24.md) records comparisons of actual original and revised modules with exact fixture outputs. Agent 60 verified that all nine recorded operation-count source files retain their measured wave-7 blob IDs and all four route source files retain their measured wave-8 blob IDs at the final publication.

| Controlled measurement | Original work | Revised work |
| --- | ---: | ---: |
| BVH hit-point resolutions and normalizations, each | 8,448 | 128 |
| BVH triangle checks in the same fixture | 66,048 | 66,048 |
| Oversized telemetry batch destination copies | 6,000 | 2 |
| Telemetry Float32 values copied | 1,368,000 | 13,680 |
| Endpoint SAT calls for 64 separated bodies | 2,016 | 0 |
| Swept bounding-radius calculations for that fixture | 4,096 | 64 |
| Support-point calculations for the rotating-contact fixture | 12 | 2 |

The route comparison replaces 704,088 full-state scan-slot visits with 37,691 heap comparisons across the existing event routes. Those are different operation units, so their ratio is not a measured speedup. These are isolated CPU-work fixtures, including favorable rejection and oversized-batch conditions; no overall FPS, GPU, power or player-device performance gain is claimed.

The [determinism report](ENGINE_DETERMINISM_2026-11-24.md) compares six actual original/improved simulation pairs: Formula, wet road cars, wet road motorcycles, motocross, Festival traffic and a Festival event. Each runs 2,400 fixed ticks at 120 Hz, or 20 simulated seconds. All 14,406 complete presentation observations and selected Float64 vehicle-state records match exactly; Festival also matches 4,802 traffic/gameplay-status records. No presentation-snapshot field is excluded. The sole excluded gameplay-status subtree is terrain streaming's operational statistics.

All 189 core/simulation source files used by that receipt retain the exact measured wave-8 modes and blob IDs, with no additions or removals. This extends the source-identity boundary to the final publication without pretending another determinism execution occurred. It establishes finite same-tick evidence in one JavaScript runtime, not every possible input, complete race or cross-platform floating-point behavior.

## Audit limits and publication responsibility

This audit separates direct Git-object/raw-source checks, the consolidated local run, measured-source continuity and published CI/native receipts. Agent 60 performed no local test/build invocation and no new physical asset rehash because its executor was unavailable. Agent 51's physical-file checks, agent 58's execution/publication mapping, agent 59's CI and AST receipts, and the coordinator's compiler/build checks retain their own attribution.

The reported checks do not certify every repository workflow, long-duration gameplay, a deployed multiplayer service or physical GPU/audio/controller behavior. Controlled ownership tests establish that cleanup is attempted and local ownership is revoked; they do not prove that an external device or browser API which refuses cleanup released its internal resources.

Production publication at `b282f121` is verified. This audit and its companion receipts are evidence documents; their later publication does not alter that tested source boundary. The coordinating agent owns the final report-only commit and ledger update. Agent 60's handoff changes only this completion report and the scope report, with no production/test edits or remote branch-reference update.
