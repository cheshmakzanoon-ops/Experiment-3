# Agent 42 — fixed-step conservation and diagnostic ownership

## Outcome

The fixed-step clock passed independent conservation checks across 65,536 seeded mixed events and both actual worker consumers. A concrete circuit-worker diagnostic lifetime defect was reproduced and repaired: a same-worker `init` reset the simulation tick and dropped-time counters but retained the previous session's step-cost moving average. The circuit worker now sets `stepMs = 0` immediately after resetting its clock during `init`, matching the Festival worker.

The initial regression run reported a new circuit frame with `H.TICK = 0`, `H.DROPPED = 0`, and stale `H.STEP_MS = 5.124625205993652`. The Festival equivalent already passed. The initial failure is retained in `42-initial.log`.

This is a supported worker-protocol reinitialization correction. It does not imply that ordinary creation of a new worker was wrong: the module-level `stepMs` already started at zero. No timestep, catch-up limit, CPU budget, physics tuning, model, character, environment, track, or asset was changed.

## Owned changes

| File | Change |
| --- | --- |
| `src/workers/physics.worker.ts` | One line resetting the step-cost EMA in the `init` case. Root explicitly approved this narrow production edit after the red regression. |
| `tests/engine-clock-accounting.test.ts` | Four tests: two seeded conservation cases at 120/240 Hz and one actual-worker lifecycle case per circuit/Festival consumer. |

`src/workers/fixed-step-clock.ts`, the Festival worker, the live render clock, and flashback implementation were left unchanged. The 240 Hz configuration exists only in the parameterized clock test; live workers retain 120 Hz.

## Independent accounting oracle

The caller maintains its own ledger of charged timestamp differences in integer eighth-milliseconds. It observes successful callback returns and rejected inputs independently of the clock's scheduling decisions. The oracle checks:

```text
charged elapsed seconds
  = observed completed ticks × fixed dt
  + retained accumulator
  + explicitly dropped seconds

dropped seconds
  = elapsed-limit drops + CPU-budget drops + interrupted drops
```

The test does not duplicate the production loop to predict how many ticks a budget should permit. It checks conservation after each public operation, exact callback `dt`, bounded post-call fractional remainder, and rejected-timestamp ownership. Seeded events mix duplicate/small/large timestamp intervals, pauses, ordinary resets, resets and rebases inside callbacks, thrown callbacks, and measured work costs of 0/3/6/12 ms. The timestamps start at 1e12 ms of uptime, with exactly representable increments.

A reset ends an accounting epoch. Before an in-callback reset, the test checks the retiring epoch while its admitted time can still contain whole pending ticks; immediately after reset, the new epoch must own clean counters and zero pending time. Lifetime test-observation counts are kept separately and are not presented as lifetime counters supplied by `FixedStepClock`.

| Observation | 120 Hz test | 240 Hz test |
| --- | ---: | ---: |
| Seeds | 8 | 8 |
| Mixed events | 32,768 | 32,768 |
| Callback invocations, including injected failure/reset callbacks | 67,718 | 84,679 |
| Pause intervals | 1,320 | 1,320 |
| External resets | 926 | 926 |
| In-callback resets | 976 | 976 |
| In-callback rebases | 1,326 | 1,326 |
| Injected callback failures | 1,678 | 1,678 |
| Rejected timestamps | 1,292 | 1,292 |
| Batches with elapsed-limit drops | 3,216 | 3,216 |
| Batches with budget drops | 4,411 | 7,198 |
| Batches with interrupted drops | 3,004 | 3,004 |
| Maximum conservation/classification error | 7.105427357601002e-15 s | 7.105427357601002e-15 s |

The assertion tolerance is 1e-9 seconds. The observed difference is far smaller; no tolerance was relaxed to make the tests pass.

## Actual worker integration

The integration cases import the real circuit/Festival worker modules and real `Simulation`/`OpenWorldSimulation` implementations. Only interval scheduling, `performance.now()`, and a controlled cost added after a real tick are replaced. Messages use `structuredClone` with their actual transfer lists, preserving ArrayBuffer detachment. No ordinary frame is recycled during the scenario, so physics must continue with its frame pool exhausted; required pause snapshots must still publish current counters.

Each worker receives 80 seeded batches with varying measured tick cost and interval lengths. The caller's external ledger accounts for the timestamp at each active pump and excludes explicitly rebased pause intervals. It checks the clock's accounting after every operation and compares required frame `H.DROPPED` against external elapsed time minus externally observed tick time and the retained fraction. This comparison uses the existing Float32 wire precision.

The cases include two long pauses, each with both paused interval callbacks and a completely suspended interval period, then a failure injected before a physics tick and another long paused period. Reinitialization must publish zero tick, zero dropped time, and zero step-cost estimate. Following that reset, six milliseconds produces no tick and three additional milliseconds produces exactly one, proving old pending work does not enter the new session.

Both workers produced the following identical first-epoch accounting:

| Quantity | Result |
| --- | ---: |
| Charged active timestamp differences | 13.11225 s |
| Successfully completed real physics ticks | 153 |
| Time represented by those ticks | 1.275 s |
| Retained fraction | 0.0034166666666670537 s |
| Elapsed-limit drops | 9.400500000000001 s |
| Budget drops | 2.3333333333333326 s |
| Interrupted time | 0.1 s |
| Maximum accounting error | 5.329070518200751e-15 s |

Each worker then completed one clean tick in the new epoch. All attempted physics calls received exactly `1 / 120` seconds. The synthetic CPU costs validate scheduler decisions and diagnostic ownership; they are not a hardware performance benchmark.

## Verification

All heavy checks used the shared `/engine-work-4e0075ccccb3/test.lock`, a 512 MB Node heap limit, and one Vitest worker. No npm lifecycle hooks were run.

| Check | Result | Evidence |
| --- | --- | --- |
| New tests before the fix | 3 passed; 1 failed on stale circuit `H.STEP_MS` | `42-initial.log` |
| New tests plus existing circuit/Festival clock suites | 29 passed across 3 files | `42-final.log` |
| ESLint on the new test and changed worker | Passed | `42-lint-final.log` |
| Strict scoped TypeScript check of the new test and its imported graph | Passed | `42-types-final.log` |
| Prettier on the new test | Completed | `42-format-final.log` |

Final test command:

```sh
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/engine-clock-accounting.test.ts tests/worker-fixed-step-clock.test.ts tests/open-world-worker-clock.test.ts --maxWorkers=1
```

Scoped type-check command:

```sh
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/typescript/bin/tsc --noEmit --target ES2022 --lib ES2022,DOM,DOM.Iterable --module ESNext --moduleResolution Bundler --strict --allowImportingTsExtensions --skipLibCheck --types vite/client,node tests/engine-clock-accounting.test.ts
```

`42-clock-accounting-sources.json` records the observed checkout identity, SHA-256 identities of the selected source/test files, and parsed numeric observations from the final test log. Publication remains the root agent's responsibility; this agent did not stage, commit, or push.

## Scope and architectural limits

- Work budgets are cooperative boundaries between indivisible ticks. One tick can exceed the nominal CPU budget. These checks do not claim a hard wall-time deadline for a worker message turn or a guarantee of real-time simulation speed under overload.
- The circuit/Festival failure is injected before the actual physics step. Generic conservation counts successfully returned callbacks. This work does not prove transactional rollback across an already completed physics step and a later failure in telemetry, result handling, or transport; the actual worker catch paths pause the session and report an error.
- The actual modules run in the existing Node/Vitest worker harness with real structured cloning. Native browser worker scheduling is outside this agent's evidence and remains part of the root's separate native-worker verification.
- The `H.TICK` frame field is the simulation timeline tick, while `clock.ticks` counts successfully completed live callbacks since its last reset. They coincide in the new-session scenarios tested here. Restoring a nonzero flashback target deliberately gives them different origins; this test does not equate them across rewind.
- `Resimulation` in `src/core/flashback.ts` still rebuilds from session start to the selected target. Its 8 ms budget and 2,000-step cap bound cooperative work slices, not total replay work or latency. The selectable rewind window is 30 seconds, but `InputLog` retains session input history apart from deduplication and truncation of a replaced future. Total history size and total rewind work are therefore not bounded by that window. Construction and input-log copying are also outside the `run()` step loop's budget. No checkpoint redesign or extra long-session benchmark was requested or performed.
