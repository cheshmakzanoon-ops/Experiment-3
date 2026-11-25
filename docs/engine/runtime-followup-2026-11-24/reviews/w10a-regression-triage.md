# Worker55 — final regression and fixture-contract acceptance

Wave 10, assignment 1. Read-only review completed against published checkpoint 9 **`9119c7683d821d145f15ed64a03ee3406595b58d`**, tree **`3b704f846c3283c21e73f8f5c3febf670a773c63`**. The retained source snapshot was taken at **2026-11-25 04:37:26 UTC**. Task baseline is `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`; production checkpoint 7 is `6a6bf02eb2d89eeb6aeff32769ef3deb4a49f17c`; fixture checkpoint 8 is `811ac2bc92f4494b1ec99d1fc4201101ccf34c66`.

## Decision

**Accept the four published fixture corrections. No production repair or additional reproduction workload is justified by this review.** Each of the **35 task-associated broad-unit failures** is matched to an exact-baseline passing case and a passing corrected case. The other **four broad-unit failures** match actual failing baseline-equivalent content/i18n cases. There are **zero unmatched failures** in the observed set of 39.

This is fixture and regression-triage acceptance, not a final all-tests-green declaration. The coordinator's checkpoint-9 **128-file unit gate, whole-project lint/type/build, and 37 native/replay cases remain outstanding at this handoff**. The night scenery timeout remains unresolved and must not be described as a proven baseline failure, environmental failure, or fixed defect. No other task-associated failure in the supplied completed-unit evidence is left without a correction and meaningful regression coverage.

I independently compared local Git tree metadata: the **entire `src` tree is identical at checkpoints 7, 8 and 9**. All **29 production files changed since the task baseline** have current working bytes matching their checkpoint-7 Git blobs. The tracked working tree was clean; only the existing untracked `browser-progress.json` receipt appeared. No authored model, character, environment, asset, material/geometry/texture definition, or vehicle tuning was edited. Evidence: `w10a-work/source-review.json`.

## 1. Exhaustive accounting of the observed unit failures

I parsed the four raw checkpoint-7 broad-unit logs, reconstructed every failed case name, and joined those names against the retained exact-baseline and corrected Vitest JSON results. Content failures were instead joined to the actual baseline-equivalent failing log names. The four partitions report **9,558 passed / 39 failed cases across 901 physical files**, with eight failing files. Their results are not superseded or relabeled by targeted follow-up runs.

| Failed file or group | Observed failures | Actual baseline evidence | Correction and inspected result |
| --- | ---: | --- | --- |
| `circuit-preparation-lifetime.test.ts` | 14 | All 19 cases pass exact task baseline | Real `OutputPass` supplied; all 19 cases pass corrected run |
| `festival-renderer-loader-lifecycle.test.ts` | 18 | All 18 cases pass exact task baseline | Missing owned resources supplied and checked once; all 18 pass |
| `circuit-frame-transport.test.ts` | 2 | All five cases pass exact task baseline | Fatal write/post semantics tested through fresh init; all five pass |
| `surface-channel-backpressure.test.ts` | 1 | All 14 original cases pass exact task baseline | Terminal worker correction plus a new independent real-terrain rebase case; all 15 pass |
| Livery, catalogue/calibration, catalogue-growth hash, i18n | 4 | Same named assertions fail source-equivalent baseline logs | Protected content and expectations remain unchanged |
| **Total** | **39** | **35 task-associated differences, four inherited failures** | **Zero unmatched cases** |

The first three files contain **42 original selected cases**, all of which passed the actual task baseline. They are **not baseline failures**. Adding the original surface file gives 56 original cases passing exact baseline; the corrected files contain 57 cases because one independent surface recovery case was added. The passing evidence consists of **a three-file 42/42 run and a separate one-file 15/15 run**, not a claim that a combined four-file gate has already run. Both targeted runs and their scoped ESLint commands passed under source stability, with no production changes, skips, TODOs or retries.

The broad unit jobs are `138970922124`, `138970922114`, `138970922195`, and `138970922130`. The matching baseline-equivalent content logs are `138728088710` and `138728088792`. Exact case-by-case classification, including renamed terminal-contract cases, is retained in `w10a-work/unit-failure-correlation.json`; its `uncorrelated` list is empty.

The original consolidated run remains **1,803 passed / 34 failed, 127 files**. Its omission of the surface file explains why the additional failure was first discovered in broad CI. Root has added the surface file to the focused workflow's trigger and execution selection and authorized the final **128-file / expected 1,852-case** gate. The published workflow retains direct tool entry points, source guards, single-worker execution, zero retries, and the unchanged browser selection.

## 2. Meaningful coverage preserved by each correction

### Fatal frame publication and recovery boundaries

The corrected frame cases retain the real `Simulation`, serializer, worker implementation and structured transfers. Both frame construction failure and frame post failure now assert exactly one error, no pause receipt for an incomplete operation, no additional messages or frames after repeated commands, no physics steps after failure, and no revival from returning retired frame storage while failed.

Fresh initialization must publish tick zero and then restore **five distinct full-size frame buffers**, each describing the expected car count. The simulation must advance again. When the fresh pool is exhausted, a valid return permits exactly one more publication; its duplicate cannot create capacity. The normal non-transferring/transferring duplicate-return cases and exact flashback completion case remain present.

Low-level buffer recovery has not been deleted to accommodate terminal worker ownership. Unchanged `tests/frame-buffer-pool.test.ts` retains **11 cases**, all passing in the original consolidated gate. Those include twelve consecutive attached writer/post failures reusing the same buffer, failed required allocation recovery, post-transfer failure credit, synchronous return followed by failure, wrong-size returns, detached duplicates and bounded reserve behavior. The final selection retains this file. The distinction is intentional: a reusable low-level transport can recover its allocation while the enclosing partially failed simulation remains terminal.

### Same-terrain rebase after consumed changes

The updated worker surface case asserts no further messages, surface packets, pause acknowledgement, tick advance or terrain-hash mutation after a surface post fails. Duplicate old receipts and a queued resume cannot revive it. Fresh initialization must create a distinct simulation; its nonempty deformation must be delivered as a full reset in a newer epoch, with blocks exactly matching the new terrain's authoritative state and the packet time matching race time. Successful transfers remain detached and only one error is observed.

Crucially, that fresh-session assertion is supplemented by a new **direct `SurfaceChannel` plus real deformed `Simulation` terrain** case. It first delivers and acknowledges an initial full snapshot, then deforms the same terrain and captures a nonempty expected block map. A failed attached post must have `reset=false`, nonempty blocks and a consumed (`size === 0`) incremental change set. A subsequent publication from that **same terrain instance** must use `reset=true`, exactly reconstruct both the pre-failure expected map and current authoritative map, and leave the terrain hash unchanged. It also checks successful detachment, exact time, rejection of the failed ticket's ACK, and capacity remaining blocked until the actual recovery packet is acknowledged.

This preserves the previous exact same-terrain full-rebase proof independently of the worker's intentional fatal-error policy. The expected map is derived from accumulated terrain state and `renderBlock`, without consuming it through `renderDelta`. Existing attached/detached failure-credit and reentrant epoch cases remain unchanged. The production `SurfaceChannel` itself is unchanged from task baseline.

### Renderer ownership and independent disposal

The circuit preparation fixture now supplies a **real Three `OutputPass`** and observes its real material's disposal event alongside the existing real scene resources. The existing preparation order, cancellation, first-failure and independent cleanup assertions remain intact.

The Festival loader fixture supplies the four newly required owners—sky geometry, sky material, near-shadow owner and output pass—and verifies every supplied owner is disposed exactly once during cleanup, including after earlier explicit disposal. These are supplied disposable test owners, not a claim that this loader unit fixture creates GPU allocations. Its original loader cancellation, late resolution/rejection, installation, shared work, retry, disabled-quality and idempotence cases remain.

Independent resource coverage remains in `engine-renderer-exclusive-release.test.ts`: real `Sky`, `DirectionalLight`, shadow render targets, `EffectComposer` and production-initialized `OutputPass`, with real disposal events, reentrant calls, throwing owners, first-error preservation including `undefined`, and the borrowed Festival backend remaining alive. `engine-renderer-texture-composition.test.ts`, `engine-resource-adversarial.test.ts`, and the native resource cases supply additional source-restoration, callback-failure and GPU-release evidence. The corrected partial fixtures do not stand alone as proof of resource release.

The published four-file diff changes no timeout, retry, quality setting or tolerance, introduces no skip, and preserves all original case counts while adding the independent surface case. The intentionally replaced assertions are the obsolete worker-revival expectations; corresponding allocation/rebase guarantees remain explicitly covered at their own ownership boundaries.

## 3. Covered versus uncovered matrix

| Contract or risk | Evidence reviewed | Assessment / limit |
| --- | --- | --- |
| Fatal worker error prevents further execution/publication/receipts | Corrected frame and surface cases; `engine-circuit-worker-terminal`; adversarial failed-init cases | Covered for the injected write, post, mutation, interval and rewind boundaries |
| New init restores usable storage and terrain | Five full-size distinct frames; new-epoch nonempty exact terrain reset | Covered; this starts a fresh simulation and does not promise continuation of failed world state |
| Attached/detached low-level recovery remains valid | Eleven unchanged pool cases; surface credit cases and new same-terrain case | Covered independently of terminal simulation ownership |
| Old ownership ACKs retire without reviving a failed worker | Surface duplicate-ACK silence, diagnostic failed-init cases and source branch review | Covered for the exercised epoch/sequence channels |
| Same-size frame returns authenticate session/sender identity | Existing pool comment and protocol inspection | **Not provided by the current wire format**; capacity accounting is not identity authentication |
| Owned renderer resources release independently | Real resource event suites, corrected supplied owners, native resource cases | Covered for the tested owners and callback orderings |
| Every nested/vendor disposer drains after any internal exception | W08E limits and reviewed disposal boundaries | **Not certified**; outer independent cleanup does not prove vendor-internal sibling cleanup |
| All observed task-associated broad-unit failures addressed | Exhaustive raw-log join, exact-baseline pass, corrected-case pass | Covered: 35 of 35, zero unmatched |
| Entire final revision passes final validation | Coordinator's queued checkpoint-9 gates | **Pending**, not claimed here |
| Complete broad CI / physical GPU performance | Partial broader run and software-renderer evidence only | **Not established** |
| Night scenery survey timeout cause | Current trace and mixed baseline/older logs | **Unresolved**, no specific engine defect identified |

## 4. Independent browser-failure triage

I recomputed the retained baseline root-tree comparison. All **31 root entries** match between exact task baseline and source-equivalent predecessor `a3f4d81900a07700c128ee84a588dcfd20659ee4`, except `ci-reports`. Thus the predecessor's source, tests, workflows, configuration, dependencies and committed assets are an appropriate source-equivalent comparison. This is distinct from the exact local baseline unit runs above.

The raw current and baseline-equivalent log excerpts agree on all of these observed symptoms:

| Case | Current and baseline-equivalent result |
| --- | --- |
| High graphics journey | Expected `paused`, received `loading`; 90,000 ms predicate at `graphics-high-journey.spec.ts:698` |
| Compact race Escape pause | Expected `{paused:true,pending:false}`, observed `paused:false`; 60,000 ms predicate at line 85 |
| Terrain geomorph quarter | Maximum error `0.3416664796083448`, expected below `0.001` |
| Aurel normal startup | Still `loading` after 240,000 ms in `finishRaceEntry` |
| Garage startup | Same `loading` result and 240,000 ms predicate in `finishRaceEntry` |

These are independently established pre-existing symptoms, not blanket proof that every path or failure cause is unchanged. The retained spec/config/blob comparisons and excerpts support this narrower classification. No protected definition, content hash, timeout, quality level or assertion was altered to address them.

### Night scenery timeout remains an explicit limit

I read the original retained trace ZIP, independently obtaining **41,092,563 bytes** and SHA-256 **`8227351c0047d0214eb86d386a08baf0f8a86b66673e3fa301f679c7717efbc6`**. The browser trace has seven calls started and six completed. Its sole pending call is:

```js
l => window.ShadowBudget.sceneryShadowBudget(l) // argument: "night"
```

Navigation and script injection completed. The test trace ends the evaluate operation with the unchanged **300,000 ms** deadline. The browser trace contains no recorded page-error or console event that locates a smaller failing operation.

The source-equivalent task baseline's night case passed, checkpoint 4's night case passed, and a prebaseline run at `93416f81c9bfe4f1df894888bd7c03d904b64058` failed at the same evaluate/deadline boundary. That is mixed history. An earlier identical timeout does not establish the current cause; a passing baseline forbids labeling the current timeout a proven failing-baseline case.

Source review shows this survey directly constructs and steps `Simulation`, awaits `RacingRenderer.create`, and performs the cockpit/shadow rendering, readback and cleanup inside the single evaluated call. It does not run the physics-worker command transport. The trace contains no internal milestone that separates those operations, so neither worker terminal-contract fixes nor a particular rendering/physics change can be identified as the cause. **There is no concrete engine mechanism to fix or code-directed reproduction to authorize from this evidence.** If resolving this separate broad-CI uncertainty becomes a gate, the defensible next experiment is a controlled exact-baseline/checkpoint-9 comparison with test-only phase observations around those existing operations, retaining the same workload, quality, assertions and deadline. I did not request or run it during freeze.

## 5. Error-boundary qualifications and final actions

No new engine defect was reproduced or substantiated in this review. Existing terminal-state, fresh-init, first-error and independent-owner tests cover the corrected contracts. The remaining resource qualification is concrete and already documented by W08E: Three event dispatch is sequential, and a throwing callback installed before the vendor's release listener may stop later listeners for that resource. Nested planting, BikeShells, LightShadow, EffectComposer and OutputPass cleanup can also contain sequential internal work. The outer `release` wrappers guarantee attempts at later **independent owners**, not arbitrary completion inside an owner that throws. Existing native injections run after upload, so their listener ordering must not be generalized. This is a retained coverage boundary, not newly demonstrated task regression or a request to broaden into protected content/vendor changes.

Required coordinator actions are the already queued exact-checkpoint-9 unit/static/native gates and retention of their actual results. Preserve the four inherited unit failures, matched pre-existing browser symptoms, and unresolved night timeout in the final disclosure. Do not describe the completed broad run as green or use software Mesa/SwiftShader evidence as physical-GPU performance proof.

## Evidence and operations

All new evidence is outside the repository under `w10a-work/`:

- `source-review.json`: exact final SHA/tree, tracked status, all 29 production hashes and baseline/checkpoint test/channel identities.
- `published-fixture-corrections.patch` and `published-focused-workflow.patch`: exact checkpoint-7 to checkpoint-9 review scope.
- `unit-failure-correlation.json`: all 39 failed names, categories, actual baseline status or matching baseline failure log, and corrected passing status.
- `baseline-source-equivalence-review.json`: independent root metadata comparison.
- `browser-baseline-excerpts.json`: five current/baseline pairs with original raw-log coordinates and matching failure blocks.
- `night-review.json`: independently parsed original trace events, archive identity, and four-history pass/fail observations.
- `review-evidence.py` and `operations.json`: reproducible read-only evidence parser and exact local Git operation record.

Underlying targeted validation is retained in `w09a-work/correction-three-file-results.json`, `correction-results-summary.json`, `baseline-unit-results.json`, `surface-comparison-summary.json`, `surface-baseline.json`, `surface-corrected.json`, and `surface-correction-summary.json`. These were **reviewed, not rerun** by worker55.

The retained reproducible evidence command is `python /tmp/engine-c71f32882729/w10a-work/review-evidence.py`; it performs metadata reads, content hashing and parsing of existing logs/JSON/trace data, and completed successfully. Other commands were source/report reads, short existing-log inspections and writing this handoff. No unit test, compiler, lint, build, benchmark, browser, Git mutation, network request, external message or protected-content edit was performed. All Git reads used `GIT_NO_LAZY_FETCH=1`, `GIT_OPTIONAL_LOCKS=0` and per-command `-c protocol.allow=never`; the retained evidence script additionally sets `GIT_ALLOW_PROTOCOL=none`. No historical archive or missing-object fetch was attempted. No COMPUTE lease was acquired. **Worker55 review complete; slot released.**
