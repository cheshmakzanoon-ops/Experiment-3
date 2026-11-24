# Agent 35 — renderer resource integration

Wave 6, agent 35 of 60. Implementation, focused verification and source evidence are complete. File ownership is released to the coordinator; no staging, commit or push was performed.

## Result

A real factory-level failure path could replace the original construction exception with an optional GPU timer cleanup exception. `RacingRenderer.create` caught a failed construction task, called `renderer.dispose()`, and only then rethrew the construction error. `GpuTimer.dispose` intentionally reports cleanup failures. The renderer's disposal orchestration correctly finished the remaining owners, but its reported timer failure escaped before the factory could return the original cause.

The reproduction executes the complete production factory and disposal methods with the actual `BuildQueue` and `GpuTimer`. A real queue task throws an `Error`, `undefined`, or `0`, and the timer's query deletion throws separately during actual renderer disposal. Before the repair, all three callers received the timer deletion error instead of the work failure. Two further cancellation cases returned the intended null result but discarded the cleanup diagnostic. The isolated pre-fix run therefore had **5 failures and 4 passes** across nine initial cases; its output is retained in `35-before.log`.

## Production repair

Only the partial-renderer cleanup boundary inside `RacingRenderer.create` changed. One local `releasePartial` function calls the unchanged renderer disposal orchestration, reports any cleanup failure through `console.warn`, and allows the factory to retain its original failure or cancellation outcome. The seven existing cleanup sites use that same boundary.

- A failed construction task retains its exact thrown value and identity, including non-Error values.
- Cancellation remains a null factory result; teardown failures remain diagnostic instead of replacing cancellation.
- GPU fences, composer and renderer backend are still released even when query deletion fails.
- Query deletion is attempted once, and repeated renderer disposal stays inert.
- The standalone `GpuTimer.dispose` error-reporting contract is unchanged.

No construction ordering, draw code, GPU timing algorithm, shader, geometry, material, lighting, model, character, environment, track, asset loader definition, or tuning data changed. The successful factory path returns the same live owner after the real queue is complete.

## Integration coverage

Added `tests/renderer-resource-integration.test.ts` with **14 cases** in three groups.

### Factory and teardown ownership — six cases

Three cases preserve `Error`, `undefined`, and `0` construction failures while the real timer cleanup fails. Two cases cancel from actual pending or terminal queue progress callbacks, require no later texture registration/reflection work, and retain the cleanup diagnostic. The success case requires the original dependency → cars → registration → reflection order and no early disposal.

The test selects complete `create` and `dispose` methods with the TypeScript AST. It substitutes the constructor and asynchronous asset-loader boundaries with inert owners; it does not load or change authored content. All factory branches, cancellation checks and cleanup operations remain production code.

### Frame-submission ownership — five cases

These cases execute the real contiguous frame-submission region of `RacingRenderer.draw`: from `renderer.info.reset()` through its final CPU-timing assignment. The extraction retains every statement and branch in that region. It uses actual `GpuTimer`, `DrawLedger`, and `GpuFrameGate` instances.

Injected extension, query-begin, query-end and pending-query-poll failures still permit environment, probe, mirror, wet and composer submissions in order. Draw-phase counts complete, temporary override/shadow/matrix state is restored, and the actual fence owner records submission. Sampling remains unavailable after a timing fault, without inventing GPU milliseconds. A second frame also completes after the first fence is observed ready.

The fifth case throws an original composer error while the timer's `endQuery` also fails. The original composer error survives, state and draw accounting finish, no successful-frame fence is published for the failed draw, and a subsequent frame completes.

### Shared venue-preparation cancellation — three cases

The actual `prepareVenueGround` caller, queue, shared generator and `VenueField` are exercised with a small synthetic track. Cancellation from pending progress, a scheduled browser yield, or terminal progress stops at the expected raster boundary. An abandoned partial iterator does not retain its shared waiter; a later preparation obtains a fresh partial owner. A completed field remains the same valid cached object even if its caller cancels at the final progress callback.

## Validation

All heavy checks used the shared test lock and a 512 MiB Node heap. No npm lifecycle hooks, asset generation, full-project build or local browser launch was attempted.

Final focused result: **four suites, 80 tests passed** in 3.50 seconds (763 ms test execution):

| Suite | Cases |
| --- | ---: |
| New renderer resource integration | 14 |
| Existing GPU timer fault containment | 37 |
| Existing BuildQueue cancellation | 22 |
| Existing shared venue-field preparation | 7 |

These are 80 unique cases within that one run. The preceding nine-case and fourteen-case runs are not added to this total.

Scoped ESLint passed for both edited source/test files. Strict scoped TypeScript compilation of the new suite and its dependencies passed with no diagnostics. The new test file was formatted with Prettier, and scoped whitespace checks passed.

Commands:

```sh
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/prettier/bin/prettier.cjs --write tests/renderer-resource-integration.test.ts
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/eslint/bin/eslint.js src/rendering/renderer.ts tests/renderer-resource-integration.test.ts
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --types node tests/renderer-resource-integration.test.ts
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/renderer-resource-integration.test.ts tests/gpu-timer-faults.test.ts tests/build-queue-cancellation.test.ts tests/venue-field-preparation.test.ts --maxWorkers=1
git diff --check -- src/rendering/renderer.ts tests/renderer-resource-integration.test.ts
```

## Evidence and limits

- `35-before.log`: initial production failure and cancellation diagnostic reproductions.
- `35-factory-after.log`: repaired nine-case factory/caller stage.
- `35-after.log`: all fourteen new integration cases.
- `35-focused.log`: final four-suite / 80-case run.
- `35-types.log`: empty successful scoped compiler output.
- `35-renderer-resources-sources.json`: handoff revision and exact SHA-256 fingerprints, including the pre-change renderer hash.

The frame tests use controlled GL and draw services. They establish production control-flow, ownership and exception behavior, **not native GPU execution, visual correctness, physical GPU performance, or FPS**. They deliberately exclude the earlier vehicle/camera presentation prefix of `draw`. The factory tests do not exercise authored asset decoding or renderer constructor initialization. Complete project compilation and the coordinator's native runtime workflow remain broader integration gates.
