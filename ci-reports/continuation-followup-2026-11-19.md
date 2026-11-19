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

At the retained snapshot, build/lint/content/typecheck/IP validation, road scenarios, offroad scenarios and wet presentation passed. All sixteen ordinary-browser partitions and all four owner-QA partitions were still running. This checkpoint does not represent a green workflow or completed browser acceptance.

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

## Separate branch-maintenance failure

The [branch-maintenance audit](evidence/continuation-followup-20261119/main-unit-complete/branch-consolidation/README.md) identifies an intentional ancestry-preflight failure at the unmerged `babylon-js` branch. Its 45 unique commits are not present on main. The workflow stopped before any deletion. This is separate from application CI; no branch policy was weakened and no unrelated history was deleted.

## Next acceptance boundary

Continue the existing hosted browser workloads to terminal results. Retain the unchanged wet-contact, mixed-pace and broader race regression requirements for every physics candidate. A physics candidate accepted for integration must also advance the simulation identity once; the snapshot schema changes only if its payload layout changes. Local native checks or selected race passes alone do not authorize an acceptance claim for the complete game.
