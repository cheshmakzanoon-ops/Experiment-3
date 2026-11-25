# Wave 8E — worker scheduling and diagnostic ownership review

Assignment 47/60 · 25 November 2026

## Conclusion and delivered correction

No blocking production defect was found in the reviewed timer-parking or flashback-diagnostic changes. This assignment corrects a real lint failure in the newly added worker scheduling test and supplies an independent source and witness review. It changes only `tests/engine-worker-idle-scheduling.test.ts` and this report.

The full repository validation for source `92e2dc2ed2f4959011bb84816e90506cefed774d` rejected the test's `current = this` receiver capture under `@typescript-eslint/no-this-alias`. This was introduced by this development session; it is not one of the unrelated content failures in the broader build. The exact failure appears in the retained [general validation log][lint-log] for [run 45637677739][general-run].

The correction stores the spy's actual `Simulation` receiver in an explicit observation object's `simulation` property. A guarded `current()` accessor reads that property and reports a clear failure if the worker has not written any frame. The original `writeFrame` still executes with the same receiver and arguments. No fabricated simulation, altered clock, suppressed lint rule, removed assertion or changed acceptance threshold is introduced.

All seven test names and all 80 `expect` calls remain. A textual inverse of only the receiver-observation adaptation reproduces the original file exactly. That is a source-integrity check, not an ESLint or TypeScript execution result. **The corrected candidate has not been executed by this assignment.** Its integrated source needs the coordinator's lint, unit, compiler and native gate.

## Reviewed identities and evidence

| Item | Identity |
| --- | --- |
| Original session baseline | `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc` |
| Accepted source | `92e2dc2ed2f4959011bb84816e90506cefed774d` |
| Integrated source reviewed | `e2d1fec2ff3b38a2cf962e9974cfe0622259823b` |
| Integrated worker blob | `4911703dd582912f256df2e017b4f43bca6c9d21` |
| Integrated diagnostics blob | `ff6d6ee9de0d9a1b1c86415bcb6c9adc57165ae1` |
| Test before this correction | `ffd669d5d11a583c0c1703d21536959025a40c9d` |

I independently fetched the accepted workflow metadata, confirmed its exact source and successful conclusion, and read the retained complete job log. It records seven scheduling cases, seven flashback-state cases, eighteen diagnostic-backpressure cases and the native flashback/ACK case passing. Overall it records 1,135 unit tests in 86 files, the six baseline comparisons, the compiler/build stage and 57 native cases.

I also independently compared both worker production files at the accepted and integrated commits: they are identical. The integrated commit adds the new native idle witness, which was not present in that accepted run. This report does not transfer the old gate to that newer witness or to the lint correction.

Sources: [accepted workflow][accepted-run], [retained result][result], [retained job log][job-log], [worker][worker], [diagnostics][diagnostics].

## Timer state and ownership

The production change extracts the former interval callback into `pump()` and surrounds it with explicit ownership. I compared the extracted callback body with the baseline: all **2,389 characters of its body are identical**. Physics stepping, watchdog behavior, telemetry cadence, frame publication, pit-transition snapshots and ordinary surface publication therefore retain their implementation. The change is when that work is scheduled.

The scheduler derives whether there is runnable work from the current worker state:

| State | Periodic ownership |
| --- | --- |
| No initialized simulation, or initialized and paused | Parked |
| Failed owner | Parked |
| Active resimulation | One interval, even though normal play is paused |
| Resimulation complete but final surface credit unavailable | Parked |
| Live simulation with no pending flashback transaction | One interval |
| Final surface receipt after an early resume | Reconciles and starts the live interval |

Every normal message handler completes through `finally`, which reconciles the timer after success, early return or failure. Every owned interval callback likewise reconciles in `finally`, including the callback that finishes a rewind. There is no dependence on a later recycled frame or unrelated host message to stop completed work.

Cancellation clears the currently owned handle and increments its generation before calling the paired native cancellation function. A callback captures its own generation; stale delivery returns before it can execute physics or reconcile a successor's timer. Repeated resume commands observe the existing interval and cannot create a second one. Bootstrap behavior remains deliberate: an otherwise idle worker receives its original first interval turn and then parks; an earlier message may park it sooner.

The clock is rebased when a new runnable interval is acquired. The existing `FixedStepClock.rebase` changes its previous timestamp without clearing the admitted fractional tick. This excludes a long paused or surface-credit-blocked wall interval without turning it into catch-up work or discarding the preceding fraction. Fresh initialization and completed rewind still use their existing reset boundaries.

Sources: [worker][worker], [fixed-step clock][clock], [scheduling tests][scheduling-tests].

## Flashback and failure composition

Resimulation owns its own runnable condition while normal gameplay remains paused. Its existing per-turn work budget and 2,000-step cap remain in the unchanged pump. When it completes, the worker installs the rebuilt simulation, resets its recording/timing boundaries and requests a required surface transaction.

The surface channel still reserves bounded ownership before capturing transferred arrays. If the actual 120-packet bound is occupied, completion waits without a periodic timer. A valid returned receipt can publish the ordered flashback notification, matching surface and required frame directly. The message handler then determines whether normal play was resumed while waiting and acquires exactly the needed timer. A duplicate or mismatched surface receipt cannot free another credit or restart a blocked transaction.

A terminal error sets the failed flag, pauses normal play, cancels rewind state and clears pending completion/input ownership. Reconciliation then parks the interval. Queued resume, input and flashback traffic cannot revive that owner. Delivered surface and diagnostic acknowledgements can still retire their original credits while failed; they do not publish replacement state. Only fresh initialization admits a new simulation, and it remains paused until resume.

This is a scheduler and ownership guarantee. It is not evidence that the entire process has no other timers, nor that one indivisible physics tick always fits its work budget. The existing clock explicitly permits a single tick to exceed that budget.

Sources: [worker][worker], [surface channel][surface], [resimulation][flashback], [scheduling tests][scheduling-tests].

## Diagnostic enable state, cadence and credit

The new diagnostic rebase is distinct from fresh-session reset. `EngineeringProbe.rebase()` clears only the remembered sample tick. It preserves the latest enable choice, including a toggle processed during rewind. `EngineeringChannel.rebase()` advances the timeline epoch but retains the outstanding delivery ticket.

That separation addresses both prior failure modes: enabled diagnostics do not silently become disabled after flashback, and the old future sample tick does not delay sampling on the rewound timeline. Fresh initialization still uses `reset()`, which disables inspection.

An outstanding ticket continues to block sampling before any copied diagnostic payload is constructed. Its original epoch and sequence remain the only valid acknowledgement after rebase. Returning that ticket may allow a new-timeline sample; returning it twice cannot release the successor. The existing publication-failure identity check likewise cannot revoke a successor installed by synchronous acknowledgement during an older send.

The actual-worker cases cover restored cadence before the previous sample tick, held old credit, invalid and duplicate receipts, previously disabled state, both directions of a toggle during rewind, and fresh-init disabling. The broader backpressure suite also checks immutable copied values, host lifecycle retirement and rejected publications. These were observed passing in the accepted run, rather than inferred only from names.

Sources: [diagnostics][diagnostics], [flashback-state tests][diagnostic-tests], [backpressure tests][backpressure-tests], [accepted log][job-log].

## Controlled and native witnesses

The seven scheduling unit cases execute the actual worker and real `Simulation`, adapting only timer delivery, monotonic time and observed simulation calls. They establish exact state and fixed-step behavior across jitter, preserved fractional time, stale callback generations, budgeted resimulation, terminal recovery and the actual 120-surface-packet capacity. The reference serializer bypasses the observing spy, so comparison itself does not replace which simulation is being observed. The lint correction retains this distinction.

The accepted native diagnostic case bundles the production worker directly into a real DedicatedWorker. It holds only engineering credit, returns ordinary frame/recording buffers through native transfer lists, and acknowledges consumed surface data. It requires actual physics to advance while the credit remains occupied. After rewind, the original ACK restores sampling without a new enable command; duplicate old tickets remain ineffective while later native frames cross the diagnostic cadence. Buffer detachment, immutable samples, real pause barriers, finite surfaces and cleanup are checked.

The newer native idle case wraps native interval registration/cancellation before the unchanged worker bundle runs. Separate IIFEs are important: a static import would initialize the worker before the observer. The wrappers retain the real period, handle, arguments and callback delivery. Private observation messages are intercepted before production dispatch; ordinary worker messages pass through.

Its positive controls require real bootstrap and active callbacks, actual live ticks, real resimulation and fresh-session progress. Its parked observations use a native 80 ms timeout and require at least 60 ms of worker-monotonic elapsed time with unchanged callback and owner records. The rewind owner must be canceled inside its finishing callback, preventing a later recycle or pause message from masking missing callback cleanup. Five expected owners must retire with maximum concurrent ownership one.

The native idle witness cannot manufacture stale browser callbacks after cancellation; the controlled unit test supplies that adversary. It also returns surface credit normally, so the unit case supplies the full-capacity blocked scenario. Together their boundaries are complementary. No CPU percentage, power, hardware frame rate or exact four-millisecond delivered cadence is established by these counters.

Sources: [native diagnostic spec][native-diagnostic], [native diagnostic host][native-diagnostic-host], [native idle spec][native-idle], [native idle observer][native-observer], [native idle host][native-idle-host].

## Integration status

The authored lint correction and the integrated native idle witness require the next exact-source hosted gate. No local runtime was available, and no local execution was attempted. Source review found no reason to alter worker production code or broaden the protected visual/animation scope.

This assignment made no commits or ref updates. It returns only a two-file unreferenced tree for coordinator review and integration. Other repository failures involving livery, authored vehicle data or translations are outside this correction; this report does not claim the general repository workflow is green.

[accepted-run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45637677573
[general-run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45637677739
[result]: evidence/92e2dc2/result.json
[job-log]: evidence/92e2dc2/hosted-job.log
[lint-log]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/ci-reports/logs/build-and-validation/validate.log
[worker]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/src/workers/physics.worker.ts
[diagnostics]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/src/workers/diagnostics.ts
[clock]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/src/workers/fixed-step-clock.ts
[surface]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/src/workers/surface-channel.ts
[flashback]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/src/core/flashback.ts
[scheduling-tests]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/tests/engine-worker-idle-scheduling.test.ts
[diagnostic-tests]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/tests/engine-flashback-diagnostics-state.test.ts
[backpressure-tests]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/tests/engine-diagnostics-backpressure.test.ts
[native-diagnostic]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/e2e/engine-native-flashback-diagnostics.spec.ts
[native-diagnostic-host]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/e2e/fixtures/engine-native-flashback-diagnostics.ts
[native-idle]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/e2e/engine-native-worker-idle.spec.ts
[native-observer]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/e2e/fixtures/engine-native-worker-idle-observer.ts
[native-idle-host]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/e2e/fixtures/engine-native-worker-idle.ts
