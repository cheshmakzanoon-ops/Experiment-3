# W03D — omit unavailable flashback history

Assignment 16/60, wave 3. Implements the unused-journal finding in `audit-runtime.md`.

## Production change

`src/core/flashback.ts` now owns `supportsFlashback(mode)`: race, endurance and practice are eligible. `src/ui/flashback.ts` uses that predicate and keeps the existing five-use limit. The circuit worker initializes its journal to `null` and creates an `InputLog` only for an eligible session.

Every input still goes through `applyLoggedInput` and `Simulation.setInput`. A null journal skips recording while applying exactly the same controls. Pit commands and autopilot changes likewise always reach the simulation, with journal writes conditional on availability. The paused reset, queued shift application and stale-input watchdog continue through the same input boundary.

The worker requires a journal before accepting a rewind. An unsupported request therefore cannot flush recording pages, construct a resimulation, replace the live simulation, or publish a rewind completion. It reports the existing `Invalid flashback request` terminal error; queued traffic cannot revive that worker. This preserves the established terminal-error contract.

Eligible sessions retain the complete journal from tick zero. The 30-second selection window does not trim earlier inputs, because reconstruction still starts from the beginning. Successful rewind continues to truncate only the replaced future. Reinitializing from an eligible session into time trial or qualifying drops the former journal reference.

Telemetry and replay capture still use their existing independent `TelemetrySampler`. Ghost consumers and recording formats are unchanged. No simulation equations, vehicle settings, authored assets, model files, environment, character or gameplay content were changed.

## Measured retention and output equivalence

`tests/engine-flashback-disabled-history.test.ts` imports the actual worker graph once, then uses its real init/input/pause/pit/autopilot/flashback handlers and scheduled physics callback. Outgoing frame and recording buffers are transferred, detached, consumed and transferred back through the actual recycle messages. Surface credits are acknowledged through the real protocol.

For each unsupported mode, the comparison runs the same 36,000 varying control samples at 60 Hz through 72,000 actual physics ticks: 600 simulated seconds. The baseline forces only the eligibility predicate to retain the production journal in that same mode. It does not substitute a fake worker, recorder, simulation or mirrored input loop. The second run uses the production eligibility policy. Constructor observation and the journal argument reaching the real input boundary expose the actual worker journal ownership.

Counts below are taken after the stream and before the final pause reset:

| Mode | Run | Constructed journals | Retained entries | Retained journal control objects |
| --- | --- | ---: | ---: | ---: |
| Time trial | Retained-history baseline | 1 | 36,000 | 36,001 |
| Time trial | Production eligibility | 0 | 0 | 0 |
| Qualifying | Retained-history baseline | 1 | 36,000 | 36,001 |
| Qualifying | Production eligibility | 0 | 0 | 0 |

The extra baseline control object is `InputLog.lastInput`; each input entry also owns its copied controls. These are observed object and entry counts, not heap-byte, garbage-collection, frame-rate or CPU improvement estimates. The live simulation's own current controls and normal recording buffers remain necessary.

Each pair has identical SHA-256 digests over the entire ordered applied-input trace, the controls entering every physics step, all transferred packed frames, every valid telemetry row, and every valid replay frame. The test retains fixed hashing scratch instead of an additional unbounded control/frame history. Including the final pause, each run produced:

| Measurement | Observed count |
| --- | ---: |
| Input applications | 36,001 |
| Physics ticks | 72,000 |
| Packed frame publications | 36,002 |
| Telemetry pages / rows | 600 / 36,000 |
| Replay pages / frames | 600 / 9,000 |
| Recording warnings / worker errors | 0 / 0 |

## Behavioral coverage

The new suite covers all five mode decisions and the existing UI use limit. It compares unsupported-mode shift FIFO, pit toggles, AI handback, DRS/overtake requests, pause reset and watchdog braking against the retained-history baseline. It rejects unsupported rewind with partially filled recording pages, asserting no flush, no resimulation construction, no live physical-state change and no later completion.

For each eligible mode, an actual worker session applies those ownership transitions, runs beyond the 30-second selection window, and retains tick-zero history. Rewinding from an altered future reproduces the captured packed frame and control/pit/autopilot state exactly; these state snapshots serialize performance/drop diagnostics as zero on both sides, because rewind resets the worker clock. Reinitialization then proves a competitive session no longer receives that prior journal.

Existing focused suites additionally cover precise simulation state and continuation across road, GP and motocross vehicles; repeated gearbox/DRS/overtake edges; bounded rewind work; paused pit-service snapshots; terminal errors; replay truncation; and rewind completion while ordinary frame, surface and recording transport capacity is exhausted.

## Verification

The final direct Vitest run passed **85 tests across 9 files** in **107.88 seconds**, including all **14 new actual-worker cases**. Scoped ESLint passed with exit code 0.

```sh
node node_modules/vitest/vitest.mjs run tests/engine-flashback-disabled-history.test.ts tests/worker-input-edges.test.ts tests/worker-rewind-ownership.test.ts tests/worker-pause.test.ts tests/engine-circuit-worker-terminal.test.ts tests/engine-flashback-state.test.ts tests/flashback-determinism.test.ts tests/flashback-recording.test.ts tests/flashback-work-budget.test.ts --maxWorkers=1
node node_modules/eslint/bin/eslint.js src/core/flashback.ts src/workers/physics.worker.ts src/ui/flashback.ts tests/engine-flashback-disabled-history.test.ts
```

Direct tool binaries bypassed npm lifecycle hooks. No dependency installation, full build, full-suite test, Git operation or publication was performed by this assignment.
