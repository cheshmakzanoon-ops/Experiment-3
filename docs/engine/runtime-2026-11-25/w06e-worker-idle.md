# W06E — circuit worker idle interval ownership

Assignment 35 of 60, wave 6. Candidate prepared on 2026-11-25 for coordinator review. This report records source inspection and the authored tests; it does **not** claim a new unit, type-check, build, native-browser or performance run.

## Finding

The circuit worker owned an unconditional four-millisecond interval. Its callback returned after rebasing the fixed-step clock when no simulation existed, the session was paused, the worker had failed, or flashback completion was waiting for a surface credit. Those states still scheduled periodic JavaScript work even though their useful transitions arrived through `onmessage`.

The running simulation already uses a fixed 1/120-second physics step, a maximum catch-up window and a CPU work budget. The improvement leaves that complete callback body unchanged. It changes ownership of the periodic timer.

Source basis: `src/workers/physics.worker.ts` candidate blob `93bbd5b7494e9764c48741535762e306695b5678`, published by the coordinator in `c482ad9ce9fdef02660e4880a027d83326c840c4`. This includes W06B's diagnostics rebase at flashback completion, which is retained exactly.

## Scheduling contract

| Worker state | Periodic interval |
| --- | --- |
| Module bootstrap, before the first message or callback | One four-millisecond interval |
| No simulation after its first callback | None |
| Initialized and paused | None |
| Running, with no pending rewind completion | One four-millisecond interval |
| Unfinished resimulation, including while paused | One four-millisecond interval |
| Finished resimulation waiting for surface capacity | None |
| Terminal failure | None |
| Resume requested while completion is blocked | None until the required credit arrives |
| Credit completes a rewind after an early resume | One four-millisecond interval |

A small reconciliation function runs at the message-handler and timer-callback `finally` boundaries. It starts an interval only when physics or resimulation is runnable and cancels it in every other state. The bootstrap interval is preserved for existing worker startup observers; absent any host message, its first callback parks it.

Starting a timer rebases the existing fixed-step clock to the current monotonic time. This preserves the clock's admitted fractional active time while excluding a long pause or credit wait. The ordinary pause message still updates `lastInput` and rebases the clock as before. The input watchdog, shift ownership, pause acknowledgement order, surface publication order, diagnostics credit and recording logic remain within their original code paths.

Each interval captures a monotonically increasing generation. Canceling clears its ownership and invalidates that generation before calling the paired cancellation API. A previously queued callback cannot run physics or cancel a successor's timer, even if the host recycles a numeric timer handle.

The scheduling and cancellation functions are captured together when this worker module is evaluated. This preserves their ownership in existing test harnesses that load multiple worker graphs while replacing globals; the circuit worker cannot accidentally adopt another worker's timer adapter.

## Why this remains responsive

Pausing still synchronously flushes telemetry and replay pages, clears shifts, applies neutral input, publishes the exact final frame and sends the optional pause receipt. None of those operations require a periodic callback.

Engineering toggles and receipts, input updates, pit commands and buffer returns still enter the same message handler while parked. An accepted flashback creates a real `Resimulation`; reconciliation wakes its bounded work loop even though the session remains paused. Once that job finishes, the worker either publishes its surface and frame immediately or waits without polling for a valid surface ACK. An ACK retains the original flashback → surface → frame FIFO ordering. If a resume was requested during the wait, reconciliation starts the interval only after that completion becomes publishable.

Terminal failures still ignore queued commands other than initialization and retire already delivered surface/engineering receipts. No such ignored command can restart periodic work.

## Authored verification

`tests/engine-worker-idle-scheduling.test.ts` loads the actual worker once. Its simulated clock and timer map control scheduling only; actual physics, recording, resimulation, transfer pools, surface channel and message handlers remain in use. All publications pass through actual structured-clone transfer lists.

Seven cases cover:

1. Bootstrap retirement and initialized pause: 1,000 nominal timer opportunities over four seconds invoke no parked callback and create no new interval. Direct message-driven diagnostics remain available.
2. Running ownership: 96 jittered callbacks retain the same one timer with a four-millisecond requested delay. A separately stepped `Simulation` produces identical full Float32 frame bytes and exact body position/velocity. Every worker physics step remains 1/120 second.
3. Long pause: a six-millisecond active remainder survives a 90-second pause; two resumed milliseconds do not advance a tick, the next millisecond does, and paused wall time is not reported as dropped physics time. Fresh input is preserved.
4. Canceled deliveries: manually delivering retired callbacks after a resume and a replacement init neither advances state nor revokes the successor timer.
5. Real resimulation budget: assigning five milliseconds of controlled work time to each completed tick makes the unchanged eight-millisecond resimulation budget yield after two ticks. Three turns reach the six-tick target and park again while paused.
6. Failure recovery: an exception after one completed physics tick cancels periodic work. Queued resumes, inputs, rewind requests and retired callbacks do not revive that failed session. Fresh init remains paused until an explicit resume.
7. Real surface backpressure: 7,200 controlled ordinary ticks fill the unmodified 120-packet transport bound. A fresh session's six-tick rewind cannot publish completion or keep a timer alive while all credits are held. An early resume remains parked; a valid old ACK publishes the ordered completion and wakes one timer. Its duplicate creates no extra timer, and the 90-second blocked interval is excluded from catch-up.

The scheduler witness counts callback deliveries and active timer handles. It does not estimate CPU utilization, energy, battery life, thermal behavior, native wake frequency or hardware FPS.

## Compatibility review

Existing actual-worker tests inspected include circuit terminal ownership, diagnostics backpressure, flashback-disabled history, worker/session adversarial cases, fixed-step worker integration, input edges, pause receipts, rewind ownership, and W06B's flashback diagnostics state cases. Their interval adapters update mutable pump variables or properties on each registration; none of these inspected harnesses retained an immutable bootstrap callback as their active executor.

The native controlled-worker adapter keeps an interval map and removes entries through `clearInterval`. Its circuit transfer and engineering-credit assertions sample running states, where the interval remains present. The native bootstrap assertion still observes one interval before session initialization. Real-clock page-history workers retain their unmodified native interval and message APIs.

These are source-based compatibility findings. Hosted execution is still required to catch omitted harness assumptions, TypeScript issues or browser integration defects.

## Integration and acceptance

Only three files belong to this candidate:

- `src/workers/physics.worker.ts`
- `tests/engine-worker-idle-scheduling.test.ts`
- This report.

No rendering, animation, protocol schema, authored assets, environments, vehicle data, handling tuning, offroad source or existing motocross test is changed.

The coordinator should review the latest main worker blob before integration. If another change has touched that file since `c482ad9`, merge the timer ownership changes over it; do not replace the intervening source wholesale. The source's full pump body was compared byte-for-byte with the supplied W06B base, and its message handler differed only by the final reconciliation call.

Required execution remains pending the focused hosted engine workflow: engine unit suites, full TypeScript/build validation, baseline comparisons and the native worker/browser acceptance suite. No timing or callback-count result is represented here as already executed.
