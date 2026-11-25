# W10C — Remaining boundaries and next engine work

Assignment **57/60**, wave **10** · 25 November 2026.

## Purpose and decision

The delivered changes strengthen ownership, recovery and repeated-work efficiency within explicit boundaries. This handoff records those boundaries so the next engine change does not accidentally promise stronger persistence, cancellation or performance semantics than the implementation provides.

**No additional blocking production defect was established by this assignment.** The items below are existing architecture limits, measured tradeoffs and conditional follow-up opportunities. They are not a claim that every listed area needs another patch before this work can be accepted. The immediate release requirement remains the coordinator's complete gate for the corrected executable source.

This report independently read the current SaveStore, DesktopMirror, TimeTrialRecords, SessionStartOwner, EventLoop and ByteWriter sources, together with the committed storage, startup, networking, audio, physics, measurement, provenance and native-acceptance reviews. It authored only this document and performed no local execution, production edit, test addition, commit or ref update.

## Acceptance at this review boundary

<!-- COORDINATOR_ACCEPTANCE_START -->

The corrected executable source **`394913934d3c6c9cfbe5ba5251beb7ebe68ee249`**, tree `cf9fded4f2bd81567858d5d1e19f873ebd293754`, passed [run 45647350422][current-run], job **139321807542**, on attempt 1. Full ESLint, **1,351 unit cases across 95 files**, all six baseline comparisons, full TypeScript/Vite build and **60 native browser cases** passed. Native execution used one worker and zero retries; the file-service digest checks passed before and after it.

The coordinator and independent release reviewers retrieved the actual completed job and decoded log. See [release evidence](w10e-release-evidence.md) and the [retained result](evidence/3949139/result.json) for exact identities and inspection limits. The intermediate fixture, lint and compiler failures remain in [CHECKPOINTS.md](CHECKPOINTS.md); their corrected source has now completed the required focused gate. The architecture limits below remain useful and are not relabeled as new release blockers.

<!-- COORDINATOR_ACCEPTANCE_END -->

The persistence fixture repair, two lint corrections and binding cast are validation-history items. They should not remain listed as unresolved production defects after their corrected source completes acceptance. Conversely, an intermediate unit or lint pass must not be described as a complete native or repository-wide pass. The [provenance review](w09d-evidence-provenance.md) makes these distinctions explicitly.

## 1. Persistence has three different completion boundaries

The actual [SaveStore][save-source] resolves a changed write from the IndexedDB transaction's completion handler. That handler passes a private payload to `DesktopMirror.written`, whose [drain path][mirror-source] starts asynchronous bridge work. The SaveStore promise does not await that bridge promise or a native file flush.

| Boundary | What it establishes | What it does not establish |
| --- | --- | --- |
| SaveStore promise resolves | The local IndexedDB transaction committed; the write's data and desktop revision share that transaction | A desktop bridge acknowledgement or file flush has finished |
| Modern mirror batch is acknowledged | The bridge accepted the batch against the expected complete predecessor | Every caller-visible save promise waited for that acknowledgement |
| Native file flush completes | The file service has completed its own flush operation | That this was implicitly awaited by every local save or record toast |

A record “saved” notification follows its storage operation and therefore reflects that operation's local commit contract. It should not be described as a synchronous disk or cloud durability receipt. A blocked mirror can deliberately keep a newer local state while retaining an older complete file prefix. That separation is the recovery design, not evidence that the local update was discarded. See [the independent storage review](w08a-storage-review.md) and [native recovery review](w09e-native-acceptance.md).

### Full reconciliation is a separate coordination problem

The fix detects foreign committed revisions during each write transaction, distinguishes aborted reservations from committed ownership, and blocks unsafe incremental forwarding. It closes the returning A → B → A omission and failed-full-seed followed by partial-certification cases.

It does **not** make full reconciliation globally atomic with arbitrary concurrent writes. Reconciliation reads a snapshot, reserves a revision through a separate local operation, and performs asynchronous seeding or restoration. Two independently active owners need an additional coordination protocol if the product intends them to reconcile while writes continue.

The existing application uses one shared SaveStore and one desktop window according to the inspected host/storage review. The independent-owner tests exercise the reusable API boundary; they do not establish that ordinary gameplay routinely creates competing reconciliation owners. A future multiwindow or background-writer feature should define one reconciliation owner, a consistent snapshot/revision boundary, and how intervening writes are retained before enabling that topology. Simply assigning larger revision numbers is insufficient.

### Preserve the updater contract

`SaveStore.update` performs its read/transform/write within one native readwrite transaction. Its updater must stay synchronous and return a new value to persist. Returning the stored object by identity is a no-op; mutating that object in place does not save it. Thenables are rejected, and an unchanged update consumes no new revision or desktop delta.

Future callers should use that contract instead of inserting an await into an active transaction or reintroducing a separate read followed by an unconditional write. The separate desktop clone is also intentional: later mutation of a returned object must not change a queued mirror payload. These are invariants to retain, not opportunities to remove cloning indiscriminately. Sources: [SaveStore][save-source], [storage review](w08a-storage-review.md).

## 2. Accepted records and visible-session ownership differ

The [records implementation][records-source] captures accepted lap data and its store before external callbacks can replace the session. An accepted persistence operation can finish after the old session leaves; generation guards suppress effects after the relevant records/circuit/terminal ownership is revoked. Canceling accepted persistence merely because a screen changed would reverse that deliberate guarantee.

Two storage limits remain:

- Leaderboard and ghost are **separate key updates**. Either can succeed independently. The current API does not promise one all-or-nothing transaction covering both.
- The compatibility queue for a host without `update` is keyed by the **same JavaScript store object and record key**. Two wrappers around the same database or separate tabs do not share that queue. Cross-owner ordering belongs to the atomic update port.

The current host can retain a parked circuit generation while the menu or Festival is foregrounded. An accepted save may still produce its completion toast there. That is the reviewed foreground-screen policy, not an obsolete circuit generation bypassing a guard. Changing it would require an explicit host behavior decision in protected `src/main.ts`; this engine handoff does not propose that change as a defect. Sources: [records source][records-source], [startup/record host review](w07e-startup-recovery.md).

If a later product requirement demands a board entry and its ghost to appear together, first define the failure and recovery contract, then introduce an explicit multi-key transaction or recoverable record bundle. Preserve faster-record comparison, tie ordering, private accepted data and post-replacement persistence while doing so. Adding cross-key atomicity without a requirement would expand the interface and migration surface without evidence of current need.

## 3. Cancellation revokes ownership; it does not stop every computation

[SessionStartOwner][startup-source] promptly releases a canceled caller even when module loading or session creation never settles. It still observes late completion, refuses stale adoption, disposes a late session, and prevents departed failure cleanup from replacing a successor's state.

Dynamic import and arbitrary factory promises are not forcibly terminated by that race. A guarded callback is checked when it enters; the guard cannot undo an asynchronous effect that an already admitted callback started. Components that launch such work retain their own cancellation or generation responsibility.

The current session interface has synchronous `dispose(): void`. Direct cancellation revokes ownership before disposal, but it can still expose a disposal exception. The dedicated startup failure path separately contains cleanup errors so host recovery can run and original/recovery causes remain available. This does not create a general asynchronous-destructor protocol.

Follow-up cancellation work is justified when a concrete loader supports cooperative abort or a measured canceled setup continues to consume substantial resources. Acceptance should then establish actual underlying work retirement, late-rejection handling and successor isolation, alongside prompt caller settlement. It should not infer underlying cancellation merely because a UI promise resolved. Sources: [startup source][startup-source], [host review](w07e-startup-recovery.md).

## 4. Removed work still has explicit costs and limits

The [measurement report](w09b-measurements.md) preserves workload definitions and counted operations. Its rows measure different things and cannot be added into a total engine allocation or FPS figure.

| Change | Retained work or cost | Maintenance implication |
| --- | --- | --- |
| Compact radio history | Caption arbitration and session-history cooldown state remain | Do not erase cooldown history solely to shrink a map without checking rewind semantics |
| Bounded input expiry | Admission, sequence/ACK bookkeeping and sparse-key scans remain; some numeric paths attempt deletion of empty slots | Compare combined scan/delete work and exact controls/ACK behavior, not only delete counts |
| Lane FIFO ring | At most 2,048 additional resident-key references in the production bounded cache | Retain FIFO/tie/fallback behavior; the iterator reduction is not a measured heap-byte saving |
| Frozen thermal signature path | Matrix selection, wet-cell advances and the mutable-parameter path remain | Fewer signature checks must not be reported as skipped physics cells or matrix rebuilds |
| Consuming packet finish | Prepared recipient assembly and the existing transport still copy | Preserve independent packet ownership and exact wire bytes; this is not an end-to-end zero-copy network |
| Lazy driving guidance | Required route construction moves to first eligible active use; an existing same-track route can be reused | Profile first-use latency before deciding to prewarm or incrementally build |
| Canceled EventLoop lookup retirement | The canceled heap slot remains until popped; `pending` still counts heap slots | Do not claim heap compaction, zero retained scheduled slots or a changed pending contract |
| Physics worker timer parking | Other process work and one indivisible physics tick remain outside the scheduling change | Parked intervals support bounded ownership, not a measured whole-process CPU or power reduction |

These qualifications follow the [network review](w08b-network-review.md), [audio/input review](w08c-audio-input-review.md), [physics review](w08d-physics-review.md), [worker review](w08e-worker-review.md) and actual [EventLoop source][event-source].

For the prepared twelve-recipient codec workload, counted copies fall from 12,876 to 6,228 bytes: the 6,228 assembly bytes remain. The small hosted timing samples include slower candidate pairs and different paired-median versus ratio-of-medians summaries. Prefer the deterministic operation/copy counts when communicating the delivered benefit. A hardware performance claim needs separate measurement.

## 5. Keep the validation envelope visible

The current witnesses deliberately cover complementary boundaries. The acceptance section above determines which newly authored cases have actually completed; their specified scope alone is not a pass. A future release claim should use the relevant evidence rather than treating “native” as one universal platform guarantee.

| Evidence or witness | Checked or specified scope | Scope still requiring separate validation if needed |
| --- | --- | --- |
| Historical-module probes | Exact declared original modules substituted into the same candidate dependency graph; checked outputs, ownership and counters | Two complete historical/current product builds, all venues/vehicles, hardware performance |
| Real Simulation differential | Three seeded weather cases, one simulated second each; 363 complete frames and race-state observations, plus 27 surface checkpoints | Full-race endurance, every vehicle/venue combination, cross-host floating-point identity |
| Lane stress trace | 6,144 actual evictions and checked nearest outputs | Eviction coverage from the short Simulation cases, which retain only 11–12 cells |
| Worker/browser cases | Actual worker tasks, intervals, transfers and tested recovery boundaries; controlled units separately force stale callbacks and credit exhaustion | Whole-process wakeups, delivered 4 ms precision, CPU/power savings or physical GPU performance |
| Native cue audio | Real OfflineAudioContext rendering, PCM and forwarded automation | Live hardware audio, speaker output, autoplay or AudioWorklet behavior |
| Native desktop recovery | Real Chromium IndexedDB plus production Node file flush/reload through a labeled Playwright binding | Electron preload/IPC, Steam Cloud, arbitrary crash timing, simultaneous full reconciliation |
| Controller regressions | Real controller logic with supplied device-shaped objects and lifecycle callbacks | Physical wheel/gamepad drivers and target-device compatibility |

The speedbowl boundary trace also needs its existing qualification: 422 of 425 queries use the full-scan fallback; the three remaining queries exercise the lane index. The substantial eviction evidence comes from the separate Aurel trace. These limits are explicit in the [physics review](w08d-physics-review.md), not gaps to conceal with a broader test-count headline.

The hosted browser environment is Mesa llvmpipe software rendering. No new local compiler or browser execution was available to this assignment. Evidence from the final run should retain its exact source, backend receipt, zero-retry commands and available logs/attachments. Uploaded ZIP identity is distinct from inspecting that ZIP's contents. See [reproduction](w10b-reproduction.md) and [provenance](w09d-evidence-provenance.md).

## 6. Prioritized next work, conditional on actual need

The release row is satisfied by a complete accepted gate recorded in final release evidence, and applies again to later executable changes. The remaining rows are future investigations with concrete triggers; none is an invented release blocker.

| Priority | Trigger and intended benefit | Useful acceptance before claiming improvement |
| --- | --- | --- |
| Release gate for every executable change | Updated runtime or harness inputs need exact-source acceptance | One exact source passes full lint, selected units, all six report identities, typecheck/build and zero-retry native cases; retain failures and final evidence |
| First performance follow-up: representative hardware profiling | A target machine shows missed frame budgets, excessive allocation/GC or costly pause/start transitions | Repeated comparable seeded runs on that hardware, stage-specific CPU/allocation/GC data and frame-time distributions; verify exact behavior while attributing the measured bottleneck |
| Before a durable-file product promise: explicit acknowledgement policy | Export, quit, cloud handoff or UI language must guarantee native-file completion rather than local commit | An explicit awaited boundary with failure/retry behavior; actual desktop-shell acceptance with delayed/rejected IPC and file reloads, preserving successful local writes |
| Before multiple reconciliation owners: coordinate snapshots and writes | A multiwindow/background writer feature intentionally creates simultaneous full reconciliation | Native multi-owner interleavings with writes during snapshot/reservation/seed, rejection/abort recovery and proof that every committed value belongs to the certified file prefix |
| If records require one combined outcome: cross-key records contract | Product behavior requires leaderboard and ghost to commit or recover together | A deliberate atomic/recoverable bundle API, failure injection between operations and preservation of faster-record/tie/session ownership semantics |
| If profiling identifies retention or first-use cost: focused scheduler/guidance work | Long-horizon cancellation churn retains material heap state, or active guidance construction causes a measured hitch | Measure the actual retained objects or latency first; preserve stable event order/pending semantics or route/cue outputs in the resulting change |

Full-race differentials and physical audio/controller/Electron acceptance should be selected by the next target platform or feature, rather than adding indiscriminate coverage to increase totals. The existing short deterministic probes remain useful fast regressions even after broader experiments are added.

## 7. Preexisting content failures and protected work

Four broader repository failures demonstrably predate this task: the APX-01 livery material assertion, GPR-1 calibration hash, dictionary validation and GPR-1 frozen catalogue-growth hash. The [provenance audit](w09d-evidence-provenance.md) identifies completed failed jobs 139194831495 and 139194831518 from an ancestor of the task baseline. The overall old run was canceled; those specific jobs had already failed. This handoff does not infer their original introduction commit.

They remain a separate content/authoring stream. A successful focused engine run does not turn that broader workflow green, and fixing or weakening their protected model/catalogue expectations is not part of this engine delivery. This session's own fixture/compiler/lint failures are separately recorded and corrected; they must not be reclassified as preexisting content failures.

The [protected-path audit](w09c-protected-path-audit.md) covers the ten enumerated commits through 0bc9543 and retains the exact concurrent animation identities at that point. Later commits require their own parent-relative check. The next contributor should retain that method, use disjoint ownership, inspect the latest main parent, and publish only reviewed paths with an expected-head non-forced update. The [reproduction guide](w10b-reproduction.md) explains that procedure.

Models, characters, authored environments, rendering, shaders, the protected host/protocol/offroad paths and vehicle tuning remain outside this handoff's write scope. Future engine optimization should begin with an observed bottleneck or explicit behavior requirement and an invariant-preserving acceptance plan.

[current-run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45647350422
[previous-run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45645636058
[accepted-run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45637677573
[save-source]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/src/storage/data.ts
[mirror-source]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/src/storage/desktop-mirror.ts
[records-source]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/src/session/time-trial-records.ts
[startup-source]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/src/session/session-start-owner.ts
[event-source]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/src/net/event-loop.ts
