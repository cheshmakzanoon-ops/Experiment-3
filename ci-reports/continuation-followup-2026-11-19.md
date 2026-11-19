# Continuation after the published fixture and CI corrections

This follow-up starts from published main `ffd22598335dfa2a074ebd466e1d53830bb8bb41` (tree `cc67121b209279498206e4d575251ff866683ba9`). It preserves the earlier [final continuation report](continuation-final-2026-11-19.md) and supersedes its pending full-unit status. Rendering and physics candidates remain independently attributable and require their original acceptance gates.

## The complete published unit suite has finished

[Build and validation run 44617126580](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44617126580) completed all four unit partitions. The exact original inventory contains **694 files and 6,757 tests**: **692 files passed, two files failed; 6,755 tests passed and two failed**. No source file is omitted or assigned twice. Every discovered case has a terminal result; no unit partition timed out or was cancelled.

The two failures reproduce the existing published-source motorcycle issues:

| Original test | Observed result | Unchanged requirement |
| --- | --- | --- |
| Wet Poggio Alto GP race, seed 30101 | Peak impact `0.9916666666666667` | Zero impact |
| Mixed GP/Superbike Vellamar race, seed 3303 | GP best lap `91.13427179346363` s; Superbike `90.36337145755091` s | GP faster, then a margin greater than `0.15` s |

The mixed test fails its first pace assertion; the subsequent margin assertion does not execute on this source. The wet test reaches the finished-race assertion and fails the impact assertion before its later per-rider assertions. These are executed production failures, not setup failures or incomplete results.

The [complete immutable audit](evidence/continuation-followup-20261119/main-unit-complete/README.md) retains all four full job logs, all native structured test reports, individual file outcomes, original Git blob identities, exact failure messages, verified artifact digests and a reproducible reconciliation script. The partitioning correction has achieved complete evidence; it has not corrected the two race failures.

Build/lint/content/typecheck/IP validation, road scenarios, offroad scenarios and wet presentation passed. The original workflow subsequently completed with a failure conclusion, with every unit and browser partition accounted for. It is not a green workflow.

## The complete original browser suite has finished

The same source-specific [run 44617126580](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44617126580) reached its terminal conclusion on 19 November 2026. All sixteen ordinary-browser jobs and all four separate owner-QA jobs retained complete original logs and terminal case summaries.

| Original suite | Cases | Passed | Failed | Original conditional skips |
| --- | ---: | ---: | ---: | ---: |
| Ordinary browser | 353 | 268 | 73 | 12 |
| Owner QA, separate build | 42 | 29 | 13 | 0 |

Every case matches its exact committed file/title inventory. There are no missing, extra or duplicate cases and no cancelled browser jobs. The [complete browser audit](evidence/continuation-followup-20261119/main-browser-complete/README.md) retains all twenty lossless job logs, individual original failures, artifact descriptors, source identities and a reproducible reconciliation script. Independent reproduction yielded the identical summary bytes, and all 75 manifest entries were verified before the 76-file bundle was copied here.

Of the 86 failed browser cases, 85 fail an original readiness, page-evaluation, input, visibility, screenshot or other execution/predicate deadline. Those boundaries do not establish a common cause. The remaining failure is the strict final fresh-instance GP render hash in `e2e/41-motogp-reference.spec.ts:230`. Its earlier same-instance wet, held and rewind assertions passed. The final comparison between separately constructed dry high-detail GP models differs at four of 1,024,000 pixels, by at most one colour-channel level; its six original metrics and two dry PNGs are retained. That small difference neither clears the exact-hash gate nor identifies its graphics cause. No acceptance assertion or tolerance has changed.

## Isolated retained-texture candidate

The reviewed local rendering source `4b9d6bb70f1443930ae674e610dc14d61e187ee3` was published to the existing diagnostic branch as `c9d3ff07f0b459697133e5c6d68dcbe8492bd2ab`, with identical tree `365f4a448d3335e8ea111605471a80f457ba1a0a`. It prepares ready static texture owners through the installed renderer's native cache after shader preparation and before the later shadow/probe submissions. Pixels, dimensions, mip chains, filtering, wrapping, colour spaces and completed-frame requirements remain unchanged.

The earlier focused suite passed 186 cases. Independent continuation review verified its source and native-module hashes and reran the native texture/startup checks: 60 cases passed. These establish owner, submission and lifecycle behavior, not full-scene browser timing or appearance.

[Original isolated browser run 44620560801](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44620560801) was superseded before any job step executed. The follow-up below was ready while all four schedulable jobs remained queued; the existing workflow concurrency cancelled those unstarted jobs and the dependent menu job. Every final job has zero steps. No browser result, pass or performance claim is attributed to this superseded source. [Its original publication receipt](evidence/continuation-followup-20261119/texture-publication.json) remains historical evidence of the initial pending state.

## Final scene texture policy before far shadows

The reviewed follow-up `62f18b868163a9c86857ac3222414484b92bffc9` was published on the same isolated branch as `f22622e3302ed6147c5aae6f8eb6f6bc4057a242`, exact tree `c413cd5062b6555d1e607297e99ad93db123de77`. Its production correction queues texture-budget registration after the final static scene tasks and before the existing far-shadow bake. Both synchronous and deferred construction now use that order.

The earlier order allowed the far bake to sample and upload pre-budget owners, then discarded those owners when the completed scene adopted its intended texture policy. Native fixtures prove that the corrected far, near and colour consumers share final owners, sampler settings and mip payloads. The final colour policy remains unchanged; the far shadow intentionally adopts it, so identical earlier far-shadow pixels are not claimed.

The focused queue, startup, native texture, far-shadow, budget and vegetation checks passed **107/107 cases**. TypeScript and scoped lint passed. Moving only the new registration task after the far bake makes both native consistency checks fail. These are bounded native fixture results, not measurements of total scene startup or hardware performance.

[Run 44623276067](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44623276067) completed the unchanged High, component, gameplay/replay and menu/settings tests. The build passed; **15 of 16 browser cases passed, with one failure, zero skips and zero retries**. Component GPU passed 7/7, gameplay/replay 1/1 and menu/settings 7/7. High still received `loading` rather than `paused` after its original 90-second readiness deadline. Its later chassis, driving and two-photo-view assertions did not execute.

The [complete source-specific browser evidence](evidence/texture-order-browser-20261119/README.md) preserves all five full job logs, digest-verified artifacts, original individual case results and bounded native startup records. Shadow/reflection warmup began 50.233 seconds after the readiness poll started. Its retained interval is dominated by geometry-buffer calls after earlier cube work; the trace does not prove duplicate buffers, isolated GPU cost, or an infinite stall. No new program compilation/linking/metadata queries occur during that interval. The graphics candidate remains unaccepted.

A separate prospective integration onto this report's main-line base also passed its product build, 154 focused tests, the unchanged 4 MiB initial-bundle gate (3.57 MiB gzip), and the IP guard. Those local composition checks do not replace the failed original High journey. [The publication and supersession receipt](evidence/continuation-followup-20261119/texture-order-publication.json) records exact source equality and the previous run's zero-step cancellation. No experimental rendering source has been integrated into main.

## First-capture geometry preparation advances the observed boundary

The next rendering source `619ffceb23ed4351ddfcdf6a3fc232d15e5b5e12` was published as `b8f1445cb07d57b35ac1c5dd45e54b01d6aaec92`, with identical tree `8d33f4ce7255a56398689914b1a78fe4a74833ba`. It prepares eligible static geometry through the installed renderer's retained buffer cache before the first reflection capture. Original geometry, indices, payloads and disposal owners remain shared with the real capture. Temporary meshes use zero-count draws; dynamic, skinned, morph, instance-attribute and other excluded owners retain normal first use. The [source report](../docs/studio/reports/retained-geometry-preparation-2026-11-19.md) preserves its historical pre-run receipt and native ownership proofs.

The candidate passed 128 focused tests, including 15 native geometry cases, TypeScript and scoped lint. Its separate [prospective main composition](../docs/studio/reports/graphics-geometry-main-integration-2026-11-19.md), frozen at `3e82ea840fa0d12c6b9703831760b714cd11b146`, passed its guarded product build, 169 focused cases across nine files, the unchanged 4 MiB bundle gate (3.57 MiB gzip) and the IP guard. All original main CI partitioning and fixture corrections remain exact in that composition. These local checks do not accept the candidate.

[Hosted run 44630631215](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44630631215) again passed the build and all fifteen component, gameplay/replay and menu/settings companion cases. High still failed the original 90-second readiness assertion at line 786 with `loading` rather than `paused`; the subsequent active-GP, driving and two-photo-view assertions did not execute. The [complete source-specific browser bundle](evidence/geometry-browser-20261119/README.md) retains all sixteen case outcomes, five full job logs, four digest-verified browser-artifact receipts, original diagnostics, native trace records and protected-input identity. There are zero skips and zero retries.

This source's trace reaches shadow/reflection warming 35.634 seconds after the readiness window begins, completes that stage after another 42.187 seconds, and reaches the first small pit-service warmup at 77.822 seconds. The preceding source had not completed its first reflection stage before failure. The earlier stages also vary between runs, so this is an observed advancement, not a controlled estimate of time saved by geometry preparation.

At failure, the first pit pass is waiting on a fence that also covers the whole chase submission. It has not reached the second pit layout or cockpit warmup. The stage label does not attribute the remaining GPU work to pit rendering. The last readable diagnostic has no preparation error, no GPU failure and no native call in flight; completion remains pending. A separate native accounting gap remains: repeated finite plateaus follow returned `useProgram` calls, while the existing instrumentation does not time uniform or texture-binding calls. No new production change is justified by assigning those gaps to an unobserved owner.

## Passive attribution of the remaining program-setup gap

The next isolated source, `31a39636a3907ff5159640affdbeb2e2c9184c6f`, has tree `6c9ef74ee4c52e502e1e4484037f72e453eec886`, exactly matching local `2f51253549fd431040c5c04331e14d0f1c259f63`. Its three-file change adds test-only timing around 27 native uniform APIs plus `activeTexture` and `bindTexture`. It caches uniform owners and names from existing native lookup returns, retains at most sixteen slow-call records, and preserves per-method cumulative counters. It introduces no extra GL query, GPU wait, raster work or per-uniform worker message.

All six observational forwarding/identity/retention tests, full TypeScript and scoped ESLint passed. Independent reviews verified the complete original High workload/assertion body and existing fragment-output observer byte-for-byte. Every production, dependency and workflow input equals the preceding geometry source. The inserted observations move the same readiness assertion to line 820; its 90,000 ms limit is unchanged.

The [diagnostic source report](../docs/studio/reports/high-program-setup-diagnostic-2026-11-19.md), [independent review](evidence/continuation-followup-20261119/program-setup-independent-review/review.md), and [publication receipt](evidence/continuation-followup-20261119/program-setup-publication.json) preserve the exact boundary. [Run 44634762506](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/44634762506) runs the original hosted jobs. The diagnostic adds wrapper/clock/reporting overhead and measures returned-call CPU boundaries; it cannot establish uninstrumented performance or isolate GPU execution time.

That run is now complete: build and all fifteen companion browser cases pass; High fails the same original readiness predicate. There are no skips or retries. Its [complete exact-source audit](evidence/program-setup-browser-20261119/README.md) preserves all five full logs, original case identities and four digest-verified browser artifacts. Chase preparation completes in 42.2917 seconds; the first pit wait is still pending after 13.1095 seconds in the final diagnostic.

The additional observer locates 30.9344 seconds at native setup-call boundaries during chase, across 37,330 calls. All 35 calls at or above 100 ms occur in that stage; pit adds only 214 profiled calls and 0.2 ms. Dominant totals are 11.4125 seconds in `uniformMatrix4fv`, 11.2923 seconds in `uniform4fv` and 3.7662 seconds in `activeTexture`. The sixteen retained detailed records all occur on cube +Z, the fifth native face, after substantial earlier work. They include tiny scalar values, matrix/array values, texture binding and already-used programs. The cap is exhausted about 20.77 seconds into chase, so the remaining nineteen slow calls retain method counts/maxima rather than individual owners.

This explains much of the earlier instrumentation gap, but neither identifies isolated GPU cost nor proves that uniform data size or first-use initialization causes the delay. Returned calls may wait for earlier queued graphics work. No additional blanket material warmup, skipped first-capture drawable, smaller render target, lower quality, relaxed readiness condition or removed GPU fence is justified by these timings.

## Separate branch-maintenance failure

The [branch-maintenance audit](evidence/continuation-followup-20261119/main-unit-complete/branch-consolidation/README.md) identifies an intentional ancestry-preflight failure at the unmerged `babylon-js` branch. Its 45 unique commits are not present on main. The workflow stopped before any deletion. This is separate from application CI; no branch policy was weakened and no unrelated history was deleted.

## Physics candidates remain rejected

The [frozen GP contact evidence](evidence/gp-contact-continuation-20261119/README.md) retains the complete source patches, original acceptance-file hashes, native proofs, full guarded logs and exact-source negative results for four isolated trials. No candidate is integrated into production.

The current-contact path and throttle-reserve corrections in `7ac509f` passed the original mixed-pace and wet-Poggio gates but failed three of the complete 51 original race/contact cases: Parco 5074, Vellamar 5222 and Ardennes hairpin 1000. Its 25 additive native tests passed. The narrower current-history forecast candidate `0594a2b` passed 67 native tests and cleared two of those three failures, but still failed Vellamar and its own mixed-pace test. The final target-only support-admission candidate `e65e13f` passed 83 native tests but failed both original race checks used to assess it, including a much earlier Vellamar fall. It is rejected.

Exact-source diagnostic races also prevent a misleading pace attribution. Much of the winning-lap change between `7ac509f` and `0594a2b` follows different traffic separation and a new crash-triggered yellow flag. The earlier winner's best lap came after its own first-lap fall. The later winning-lap regression is therefore not evidence of a uniform tyre or pedal-reserve slowdown. A native state observer confirms a lateral excursion, airborne contact and subsequent lean-limit crossing on the later source, but has not established another production mismatch that justifies a new controller change.

The original seeds, deadlines, no-fall and contact assertions, friction, gains and actuator limits are unchanged. Source-stable passes belong only to the tested candidate. Simulation identity remains 27 and snapshot protocol remains 17 because no physics candidate has been accepted; an accepted physics change must advance its simulation identity once.

### Independent signed-command review

The intervening continuation checkpoint preserves a native signed-command proof on `3e58984936a9e1ba2821580688a723fb93053fa4`. Independent review establishes that its executable production behavior equals `0594a2b`: the only production difference is explanatory comments. Their separately recorded GP4 onset matches across 914 native observations and 22,850 comparisons. All 36 proof artifacts verify, and both short saved-state replay outputs reproduce byte-for-byte under source-stable guards.

That proof establishes usable native recovery authority at two precursor states that the former symmetric final clamp excludes. It preserves nineteen support/stopping/target/demand/reserve values, the original trim and pedals, and applies the real actuator, relaxation and steering gyro response. It proves a local command-admission issue; the final-fall fixture still falls and it does not establish a complete-race cure.

The resulting isolated candidate `f79c088bba9d407be8273d03f36721b67e7308d3` has no identified static implementation blocker. Its existing 127 focused native tests, TypeScript, lint, original Ardennes 1000 and original snapshot check pass. Its original mixed 3303 test nevertheless fails: GP `90.93835068988787` s versus Superbike `89.74459670278252` s. The first unchanged pace assertion fails before its later margin assertion. The [frozen independent review](evidence/gp-native-admission-independent-review-20261119/review.md) retains source identities, exact replay parity and complete terminal receipts. This candidate is unaccepted; no additional race was duplicated or production file changed by the review.

## Next acceptance boundary

The original main run is complete and failed with every case accounted for. Continue rendering diagnosis against the latest exact-source hosted result, and retain the unchanged wet-contact, mixed-pace and broader race regression requirements for every physics candidate. A physics candidate accepted for integration must also advance the simulation identity once; the snapshot schema changes only if its payload layout changes. Local native checks or selected race passes alone do not authorize an acceptance claim for the complete game.
