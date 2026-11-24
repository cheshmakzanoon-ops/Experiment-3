# Agent 01 — runtime worker transport and lifecycle audit

Date: 2026-11-24. Audited checkout: `/engine-work-4e0075ccccb3/repo`, programme base `5edead7a44c8ccb5a187b22b750ce2bda7715128`.

Scope: read-only inspection and transient, in-memory reproductions. No production source, tests, Git references, models, characters, environments, authored assets, or tuning were changed. This report is the only file written.

I read the previous task ledger, clock/transfer review, completion audit, current worker implementations, main and Festival host lifecycle, input application, and the existing clock, frame-pool, pause, recording, flashback and Festival lifecycle regressions. The findings below are separate from the previous programme's already repaired bounded clock, pool ownership, duplicate-return, reentrant-publication and teardown defects.

## Recommended priorities and ownership

| Priority | Finding | Suggested implementation scope |
| --- | --- | --- |
| High | Shift edges disappear when multiple input messages precede the next simulation tick | Worker input boundary in both workers; shared pending-edge helper if useful; worker integration regressions |
| High | Circuit surface delivery bypasses bounded snapshot/recording transport | Physics worker surface channel, its protocol acknowledgement, main receiver, targeted backpressure regression |
| High | A fatal Festival simulation error is handled as a recoverable command error | Festival worker error classification, open-world protocol, FestivalSession receive/failure path |
| Medium | Circuit startup stays pending after initialization failure or host disposal | GameApp readiness ownership and settlement; extracted host lifecycle integration |

## 1. Queued input updates erase an unconsumed shift edge

**Exact path.** `src/workers/physics.worker.ts`, `applyInput` and `onmessage` case `input` (lines 23–26 and 106–109); `src/workers/open-world.worker.ts`, corresponding `applyInput` and `input` case. Both immediately apply every arriving control sample. `Simulation.setInput` (`src/simulation/world.ts`, lines 140–146) and `OpenWorldSimulation.setInput` (`src/simulation/open-world/session.ts`, lines 484–490) overwrite `dst.shift`, including with zero. Gearboxes consume and clear the edge only during stepping.

**Mechanism.** A shift pulse followed by the next ordinary control sample can both be handled before the next interval tick, particularly after worker scheduling stalls or explicit immediate input polling. The second sample sets shift back to zero. The worker then advances with no shift. Analog controls should take their latest value, but an already delivered edge needs a tick on which to be consumed. FIFO message delivery alone does not guarantee an intervening simulation tick. Existing flashback edge tests issue inputs on different ticks; they do not exercise this arrival pattern.

**Executed reproduction.** An inline Node 24 script imported the real circuit worker, intercepted only `setInterval`, `performance.now` and `self.postMessage`, and used `structuredClone` with real transfer detachment. It initialized a solo `gpr1` practice session and compared these sequences:

1. Input `shift: 1`, then a 20 ms worker turn: gear **2** at tick 2.
2. Fresh init, input `shift: 1`, input `shift: 0`, then the same worker turn: gear **1** at tick 2.

No worker errors occurred. No simulation or gearbox code was substituted. The Festival counterpart is source-confirmed, not separately executed in this audit.

**Repair direction.** Keep pending discrete input intent at the worker boundary and apply it exactly once at a simulation tick while allowing analog fields to update. Define bounded handling of multiple opposing or repeated edges and explicit clearing on pause, init, flashback and cancellation. Preserve flashback determinism by logging what the simulation actually receives at the actual application tick. Do not change gear ratios, shift timing, bike/car models, or vehicle dynamics to fix transport semantics.

**Regression strategy.** Extend the real worker harnesses with shift-then-neutral, neutral-then-shift, multiple edge arrivals before a turn, an expensive catch-up turn, pause-before-consumption, and a replay of the resulting application log. Assert both exactly-once effect and latest analog state. Compare ordinary one-message-per-tick traces with the original output to constrain the change.

## 2. Circuit surface frames continue allocating after every bounded transport reserve is exhausted

**Exact path.** `src/workers/physics.worker.ts`, interval callback lines 218–239, independently clones water/rubber/marbles/frozen arrays and posts a `surface` message every 60 simulation ticks. `src/main.ts`, `onmessage` branch `surface`, consumes but does not acknowledge that message. `Track` has `512 × 7` Float32 entries in each of these arrays (`src/simulation/track.ts`, lines 33–34 and 136–140).

**Mechanism.** The ordinary five-buffer frame pool and bounded sixty-page recording pools do not cover this channel. If the main thread cannot consume messages while the worker continues, each additional half-second produces another transferred allocation and queued task. A clear-weather surface packet alone contains **43,008 array bytes**; a cold-weather packet contains **57,344**, excluding object and optional terrain-delta costs. At 120 simulated ticks per second these are **86,016** or **114,688 bytes per simulated second**, respectively, without a cap. Returning pose or recording buffers is unrelated to surface ownership. Draining the eventual backlog also performs obsolete surface renderer updates and replay-surface work.

**Executed reproduction.** The same real-worker harness retained every received buffer and advanced 500 turns of 20 ms. During these additional 10 simulated seconds it observed **20 surface messages and 860,160 surface-array bytes**. Only three ordinary pose messages remained available after the two already held frames, confirming that pose backpressure engaged while surface publication continued. This short run demonstrates the uncapped channel; exhaustion beyond sixty seconds follows directly from the independent code path and was not separately benchmarked.

**Repair direction.** Give surface publication explicit bounded outstanding ownership/acknowledgement. Preserve the existing normal 0.5-second replay-surface cadence while capacity exists. On prolonged stalls, choose and document a bounded recording policy: latest-state coalescing with an explicit capture-gap warning, a bounded surface reserve, or a session hold. Terrain deltas are incremental, so simply dropping their messages is incorrect: accumulate the delta or send a complete rebase on recovery. Required pause/flashback barriers must retain ordering and authoritative state.

**Regression strategy.** Drive the real worker with actual buffer detachment, withhold every acknowledgement beyond the configured reserve, and assert bounded outstanding bytes/messages while simulation ticks continue according to policy. Resume consumption and verify the newest surface, correct merged/full terrain state, warning behavior, pause/flashback ordering, and unchanged ordinary replay keyframes. The Festival's unacknowledged 10 Hz `status` channel is a smaller related follow-up opportunity; existing tests deliberately require its cadence even when pose buffers are held, so a change there needs an explicit policy rather than an incidental gate on pose availability.

## 3. Fatal Festival worker failures are indistinguishable from recoverable command failures

**Exact path.** `src/workers/open-world.worker.ts`, interval catch lines 133–138 sets `paused = true` and emits `{type: 'error', message}`. Its message-handler catch lines 102–106 uses the same error shape for uncorrelated command failures. `src/session/free-roam.ts`, `receive` lines 489–490 invokes `fail(error)` with the default `fatal = false`. `fail` lines 425–434 closes the lifetime only during startup or when fatal is explicitly true. Native worker `onerror` already supplies `true`.

**Mechanism.** A simulation step/serialization/status exception stops the worker's advance loop but leaves a running host's controls, renderer, workers and audio alive. It rejects outstanding command requests and shows a toast, yet never returns canvas/input ownership to the parent. The user can remain in a frozen session or attempt to resume a partially failed simulation. Making every protocol error fatal would also break intentional recovery for an unknown event or other command validation error.

**Executed reproduction.** An inline TypeScript-AST harness extracted and transpiled the exact production `FestivalSession.receive` and `fail` methods, supplying only dependency doubles. A running session receiving the worker's error shape recorded `closed: 0`, `exited: 0`, `rejected: 1`, `disposed: false`. The worker's forced-pause half of the mechanism is directly visible in the interval catch. Existing `festival-session-lifecycle.test.ts` explicitly expects protocol errors to leave driving enabled; its synthetic message represents a command error and omits the distinct fatal simulation case.

**Repair direction.** Add explicit fatal/recoverable classification to the Festival worker protocol, or a separate terminal-error message. Use terminal classification for step, frame serialization, initialization and transport failures; retain recoverable command-result rejection for a command that failed without invalidating the simulation. Route terminal errors through the already available `fail(error, true)` ownership path. A simulation-worker `onmessageerror` handler is also missing and can share this terminal path.

**Regression strategy.** Start a real running host fixture, force a worker step failure, deliver its actual serialized error, and assert exactly-once disposal, both worker terminations, input/audio release, request rejection and parent exit. Separately retain recoverable unknown-command tests and startup cancellation semantics. Test that queued late errors/results cannot reopen the disposed session.

## 4. Circuit first-frame readiness is never settled on failure or disposal

**Exact path.** `src/main.ts`, `GameApp.start` creates a resolve-only promise at line 1351, stores `readyResolve`, and awaits it at line 1373. The only settlement occurs in `accept` lines 1493–1495. `GameApp.fail` (lines 3407–3426) and `dispose` (lines 3540–3583) clear the initialization timer and terminate the worker but do not settle or clear this resolver. `fail` is also the initialization timeout's destination.

**Mechanism.** Worker creation can succeed but initialization can fail, time out or be cancelled before the first snapshot. The terminal path removes the only producer and timeout while `start()` stays pending forever. Its caller cannot observe completion/cancellation, and the stored resolver keeps the unfinished initialization chain reachable for the host lifetime. Existing resource teardown tests check individual releases but not settlement of the outer circuit startup promise. Festival startup already implements rejectable readiness and owns its terminal settlement.

**Executed reproduction.** An inline AST harness ran the exact production `GameApp.fail` and `dispose` methods with an outstanding readiness promise and dependency doubles. After each terminal method and drained microtasks, both cases reported `readySettled: false`, `resolverRetained: true`, `terminal: true`. This isolates terminal settlement; it is not a full browser boot test.

**Repair direction.** Give circuit readiness a single settlement owner with resolve/reject (or an existing cancellation lifetime), clear both callbacks before invoking either, and settle it from fail, dispose, replacement and synchronous initialization-post failure. Preserve the generation checks after awaits. Avoid creating a second lifecycle abstraction if the existing session lifetime helper can be reused.

**Regression strategy.** Hold the first frame and separately trigger a worker error, init timeout, disposal, and posting failure. Assert `start()` settles exactly once, pending callbacks/timers are cleared, and a queued late frame cannot run preparation or revive the session. Keep the successful first-frame/preparation path covered.

## Evidence limits

These are targeted source and runtime-boundary findings, not a full test-suite result or a native-browser performance measurement. The worker reproductions execute real simulation code with controlled scheduling and real transferable detachment; AST reproductions execute exact methods with dependency doubles. No pretest asset generators, model pipelines, commits or remote writes were run. All proposed production work can stay within engine infrastructure; no authored content changes are required.
