# W04F — Worker ownership and idle-runtime audit

Assignment **24/60**, wave 4. Audited source: `04b7a6e2516020fb971d5e42a2e33973033361b4` in `cheshmakzanoon-ops/Experiment-3`.

**Audit only. No production source, tests, branch, ref or commit was changed. No local execution after disconnect:** this assignment used repository source reads, not shell commands, test execution or browser measurements. The report distinguishes source-confirmed behavior from proposed reproductions.

Read the previous advancement README and ENGINE_CHANGES guide, the runtime W01A audit, all five assigned utilities, both simulation workers, their actual host message consumers, and the relevant ownership/backpressure/clock/input regressions. Existing repairs are not claimed as new findings.

## Prioritized result

| Priority | Finding | Evidence level | Narrow follow-up |
| --- | --- | --- | --- |
| P3 correctness | A successful flashback silently disables the user's still-enabled engineering diagnostics | Complete source-confirmed worker → host → display path; proposed actual-worker regression below | Distinguish same-session timeline reset from fresh-session reset in diagnostics and the circuit worker |
| P3 efficiency | Paused or blocked workers keep an unconditional 4 ms polling timer whose only idle action is clock rebasing | Source-confirmed recurring scheduling; no measured CPU, wakeup or power result | First measure foreground paused-worker callback counts; then suspend only the idle timer with explicit wake ownership |

Neither finding changes physics equations, authored handling, protocol strides or protected presentation source. There is no new demonstrated defect in the frame-credit, surface-credit, fixed-step arithmetic or shift-FIFO contracts reviewed here.

## 1. Flashback loses engineering enable state while the actual host keeps debug selected

### Source chain

1. [physics.worker.ts](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/04b7a6e2516020fb971d5e42a2e33973033361b4/src/workers/physics.worker.ts), `finishFlashback` (line 54), calls `engineeringChannel.reset()`.
2. [diagnostics.ts](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/04b7a6e2516020fb971d5e42a2e33973033361b4/src/workers/diagnostics.ts), `EngineeringChannel.reset` (lines 66–69), resets its probe. `EngineeringProbe.reset` (lines 150–153) assigns `enabled = false` and resets the cadence.
3. The actual host [main.ts](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/04b7a6e2516020fb971d5e42a2e33973033361b4/src/main.ts) sends an engineering enable message at session startup (line 1545) and on the explicit debug action (lines 3251–3257). Its `completeFlashback` (lines 2718–2730), `exitReplay` and `resume` paths do not send another enable message. They also do not clear the renderer's selected `debug` setting.
4. [renderer.ts](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/04b7a6e2516020fb971d5e42a2e33973033361b4/src/rendering/renderer.ts) keeps `debug` and passes it, with the last engineering sample, to `engineeringView.update` (line 2670). Its presentation reset does not switch debug off.
5. [engineering-view.ts](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/04b7a6e2516020fb971d5e42a2e33973033361b4/src/rendering/engineering-view.ts) hides stale samples through `engineeringFresh`; [ui/engineering.ts](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/04b7a6e2516020fb971d5e42a2e33973033361b4/src/ui/engineering.ts) shows “CONTACT/AI PROBE WAITING OR STALE / LIVE OVERLAYS HIDDEN”.

Consequently, normal resumed physics no longer produces engineering samples after a flashback. The selected debug display stays on, but its contact/AI portion remains stale until the user toggles debug off and back on. An old sample can briefly pass the freshness check when the new timeline reaches its timestamp; there is still no ongoing sampling.

### Why existing tests miss the integration

[engine-diagnostics-backpressure.test.ts](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/04b7a6e2516020fb971d5e42a2e33973033361b4/tests/engine-diagnostics-backpressure.test.ts), lines 157–174, intentionally asserts that flashback disables the channel, then supplies a fresh `{ type: 'engineering', enabled: true }` at line 168. That extra message is absent from the real host's completion path. This finding concerns the composition of the reset policy with its caller; it does not challenge the already-tested one-packet credit bound.

### Proposed narrow repair and regression

Keep a fresh `init` reset disabling diagnostics, but let a same-session flashback reset preserve the user's prior enabled value. Both reset forms must advance the channel epoch, invalidate the old tick cadence and preserve any outstanding receipt. A dedicated timeline-reset method or an explicit reset option can express this using only `src/workers/diagnostics.ts` and `src/workers/physics.worker.ts`. Avoid editing protected `main.ts` or rendering code.

Extend the actual-worker regression with the real host sequence: initialize practice, enable engineering once, run forward, request flashback, finish it, acknowledge any old packet, and resume without sending another enable message. Require a new-epoch sample for the rewound simulation and subsequent samples at the existing cadence, with no more than one unacknowledged sample. Cover the disabled-before-rewind case and fresh init as controls. Keep stale/duplicate ACK rejection and blocked old-credit ownership assertions.

The current explicit-disable assertion must be revised only together with that caller-level regression; changing its expectation alone would not validate the repair. No reproduction was executed in this audit.

## 2. Paused workers retain needless recurring timer work

Both [physics.worker.ts](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/04b7a6e2516020fb971d5e42a2e33973033361b4/src/workers/physics.worker.ts) (line 236 onward) and [open-world.worker.ts](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/04b7a6e2516020fb971d5e42a2e33973033361b4/src/workers/open-world.worker.ts) (line 169 onward) install a module-lifetime `setInterval(..., 4)` without retaining/cancelling its handle. Their idle branches call `performance.now()`, `clock.rebase(now)`, and return.

This is reachable during ordinary foreground pause menus, results, photo/travel holds and initialization. The host retains the worker rather than terminating it for these states. It is not merely a hypothetical failed-worker lifetime. The source requests a nominal 250 callbacks per second per such worker; **that is timer arithmetic, not an observed browser wakeup count**. Browser throttling and BFCache suspension can reduce or suspend delivery, so this report makes no background-power claim.

The clock already rebases in each pause/resume message. Festival also explicitly rebases when a valid status ACK releases a full status queue. Thus repeated idle rebasing does not contribute new simulation work or enforce the 750 ms input watchdog, which runs only in the active path.

A small dormant timer owner could cancel scheduling while paused, failed, uninitialized or waiting solely for ACK capacity, then schedule exactly once when a message makes work runnable. Preserve the circuit rewind job: a flashback must continue running while ordinary simulation is paused. A surface ACK already attempts pending publication directly; a completed blocked flashback must still deliver its original ordered flashback/surface/frame messages. Keep active 4 ms scheduling, fixed dt, CPU work limits and pause receipts unchanged initially.

Before adopting this optimization, count actual callback delivery with the existing worker harness and a foreground native-worker fixture. Then verify a long pause adds no simulation ticks or dropped time, resume preserves the existing fractional remainder, a paused flashback completes, full-status ACK wakes Festival once, failed workers stay inert, and repeated init/resume messages cannot create duplicate timers. This is a structural optimization opportunity; no speedup or power saving was measured here.

## Reviewed contracts retained without a new change recommendation

- **FixedStepClock:** bounded catch-up, CPU-budget yielding, millisecond subtraction before conversion, reentrant-reset ownership, failed-step discard and paused fractional carry already have targeted tests. No actual caller was found to invalidate them.
- **FrameBufferPool:** ordinary delivery is bounded; required snapshots intentionally may allocate. Attached writer failures recover storage and detached sends preserve return credits. Current wire data cannot authenticate sender/session identity, already documented explicitly; this audit does not repackage that known limitation as a new defect.
- **SurfaceChannel:** lazy capture reserves capacity first, retained credits span timeline resets, full rebases recover consumed deltas, and the actual host acknowledges after consumption. Existing tests cover blocked flashback/init and throwing consumers.
- **ShiftInputQueue:** the fixed 32-pulse FIFO and expiry/ownership clearing are used by both workers. Existing actual-worker tests cover neutral samples, burst overflow, pause, init, watchdog, Festival transitions, autopilot and rewind. No new lost/repeated pulse sequence was identified.

## Handoff boundary

The only written object is this report in an unreferenced tree. The coordinator owns publication, implementation decisions and all test/CI execution. Protected files were read only where required to trace callers; no protected source or authored content was changed.
