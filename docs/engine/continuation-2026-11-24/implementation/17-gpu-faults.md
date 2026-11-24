# Agent 17 — whole-frame GPU timer fault containment

Date: 2026-11-24. Wave 3. Scope: optional timing infrastructure only.

## Outcome

Changed `src/rendering/gpu-timer.ts` and added `tests/gpu-timer-faults.test.ts`. Constructor extension lookup and live timing failures no longer abort rendering or replace a rendering exception. No renderer draw paths, geometry, materials, models, characters, authored environments, presets or dependencies were changed.

The timer distinguishes a query that was allocated from one whose begin completed. A failed begin deletes its allocated handle without calling end for a query known not to have begun. End detaches active ownership before calling GL, so a thrown end is attempted once and cannot leave an active reference or block subsequent cleanup. Finished query ownership is removed before deletion, preventing an exception from causing a duplicate deletion attempt.

A thrown live GL operation disables sampling for that timer instance, clears the published measurement and retires its bounded set of handles. Rendering and subsequent frame accounting continue. The static `supported` property still describes extension capability; the measurement remains null after a sampling fault. A newly constructed renderer/context creates a fresh timer. Ordinary disjoint/context-loss transitions retain their existing recovery behavior rather than permanently disabling sampling.

Cleanup attempts all remaining handles even when an end, delete or context-status probe throws. A positively lost context receives no end/delete calls on its invalid handles. Unknown status permits bounded best-effort deletion. Explicit `dispose()` retains its prior failure contract: it revokes ownership, attempts remaining cleanup and throws the first cleanup failure; subsequent disposal is inert. Live cleanup suppresses those optional diagnostic exceptions.

A fetched sample is committed only after the polling/start operation succeeds. Failure during deletion or replacement-query creation/start leaves its value null and does not advance the sample sequence. Numeric zero remains valid; null, nonnumeric, nonfinite and negative values are rejected. The four-query bound and available-before-result polling remain unchanged.

## Verification

All **64 tests passed across three suites**:

| Suite | Passed |
|---|---:|
| `gpu-timer-faults.test.ts` | 37 |
| `gpu-timer.test.ts` | 7 |
| `gpu-lifecycle.test.ts` | 20 |

The new suite injects faults at extension probing, context status, disjoint status, availability polling, result readback, allocation, begin, end and deletion. It separately covers status faults after readback and during end; four-handle cleanup with repeated faults; preservation of the exact rendering exception and final accounting callback; once-only query retirement; explicit disposal failures; null allocation; normal result validation; and context restoration. Repeated 1,000-frame probes verify that disabled instrumentation makes no further GL calls or allocations. These are behavioral bounds, not a browser heap-size measurement.

Executed commands use the shared test lock and 512 MiB Node heap:

```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run tests/gpu-timer-faults.test.ts tests/gpu-timer.test.ts tests/gpu-lifecycle.test.ts --pool=threads --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/eslint src/rendering/gpu-timer.ts tests/gpu-timer-faults.test.ts
```

Scoped ESLint, Prettier and a strict TypeScript check limited to the two owned files passed. The scoped compiler used `--noEmit --target ES2022 --moduleResolution bundler --module ESNext --allowImportingTsExtensions --skipLibCheck --strict --lib ES2022,DOM`; it does not replace the full-project gate. The final three-suite run completed in 759 ms, with 33 ms of test execution. No full-project typecheck or build was run by this agent; integration remains with the coordinator.

## Limits

The tests use controlled WebGL doubles and a frame wrapper with the production begin/try/finally/accounting order. They demonstrate exception and ownership behavior, not real-driver failure frequency, GPU performance or complete native-browser rendering. When a GL deletion itself fails, the engine can guarantee once-only best-effort cleanup and released JavaScript ownership, not successful driver-side reclamation.

No Git commits, pushes or refs were written by this agent.
