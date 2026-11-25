# Shared GPU submission ownership — assignment 22, wave 4

Date: 2026-11-25. Implements the context ownership/preparation portion of the rendering and runtime audits. Festival session cadence and HUD/control scheduling remain assignment 23's scope.

## Changed behavior

`shared-gpu-frame-gate.ts` keeps one actual, unchanged `GpuFrameGate` per live WebGL2 context. A `WeakMap` stores one gate and a reference count; each renderer receives an idempotent `GpuFrameLease`. There is no retained owner list. Context identity comes from the WebGL backend, so circuit and Festival automatically share pending work and diagnostics without another host dependency.

The lease exposes the existing readiness, submission, latency and diagnostics operations. Releasing one lease neither releases the pending fence nor disposes the shared gate while another lease remains. The final release removes the registry entry before calling the real gate's disposal, including when driver cleanup throws. A released lease cannot submit or admit another frame. A later borrower of an existing live context observes its existing pending or failed gate; it cannot reset that history.

Both renderer constructors acquire their lease only after their existing construction work succeeds. The circuit's final resize and Festival's final sky prewarm therefore cannot strand a newly acquired lease on a constructor failure. Circuit's existing `gpuFrames.dispose()` now releases its lease; its backend ownership and all other rendering behavior remain unchanged. Festival's existing resilient disposal chain releases its own lease even if an independent resource cleanup failed. It never disposes the borrowed backend.

### Festival submission API

- `canSubmitFrame(): boolean` polls the shared gate with its existing zero-time wait. It returns false for a pending frame or a disposed renderer. A recorded gate failure or context loss throws so the owning session can enter its existing failure lifecycle.
- `draw(a, b, alpha, dt): boolean` guards admission before Festival pose mutation. It returns false when busy/disposed and true only after a successful render transaction and fence submission. Existing callers may ignore the return value; session cadence/redraw state should advance only on true.
- Every entered rendering transaction records a fence after its shadow, environment, reflection and image work, including when a later pass throws after earlier work was submitted. The fence remains visible to the circuit after Festival disposal. Context loss discovered during fence submission cannot produce a successful return.
- The first rendering failure wins if rendering and fencing both fail, including a thrown `undefined` or other non-Error value. The real gate independently retains its terminal fence failure for every remaining owner. Failures are collected through `finally` and thrown afterward.
- `diagnostics().gpuFrameQueue` exposes the real shared gate's existing fields and context-wide submission/completion counters.

### Preparation and handoff

`prepareGpu` observes the preceding mode's fence before material work, then observes each material/compile/warm-up submission before the next stage. Material preparation is fenced even on an exception. `compileSceneTarget` issues its initial work synchronously; that work is fenced before awaiting its compile promise, preserving ownership if Festival is cancelled/disposed during the await. The two actual warm-up draws retain their existing rendering passes.

The compilation promise receives a rejection observer before synchronous fencing can fail. Preparation can therefore report a fence/context failure promptly while a later compilation rejection remains handled. The successful-fence path still awaits the original promise and propagates its rejection normally. The existing cancelled/disposed metadata callback remains attached to compilation. Material and synchronous compile-stage exceptions take precedence if fencing independently fails; non-Error thrown values are preserved.

Preparation returns true only after the final warm-up fence actually completes. Each completion wait has a 90,000 ms default deadline (`preparationTimeoutMs`) and yields through the supplied frame callback. Cancellation/disposal stops subsequent preparation work. A deadline is an error, not completion: it leaves the pending fence owned by the surviving circuit lease. Gate failure/context loss reject preparation promptly when observed.

The underlying `GpuFrameGate` algorithm was not modified. Its zero-time polling, refresh cadence, active-wait stall limit, context-loss behavior and prohibition on `gl.finish()` remain in effect.

## Validation

New coverage in `tests/engine-shared-gpu-ownership.test.ts` uses the real gate and lease implementation with a recording GL boundary. It executes the complete production constructor bodies with explicit inert scene-building collaborators; production admission, preparation, diagnostics and owned teardown methods; and every statement of Festival's contiguous production render transaction, selected through the TypeScript AST. Camera/world construction and native pass execution are not claimed by that render transaction fixture.

Covered cases:

- Two live owners on the same context, independent contexts, repeated release, replacement borrowers, shared completion and terminal failure, final release, and throwing driver cleanup.
- Successful constructor acquisition and failure immediately before acquisition for both renderers.
- Pending circuit→Festival handoff, Festival→circuit handoff after real submitted commands, busy/disposed draw return values, diagnostics and backend ownership.
- Partial render failure, independent teardown failure, first-failure preservation when fencing also fails, fence allocation failure, and context loss during rendering.
- Actual zero-time waits and the existing 120-second active stall behavior across alternating owners, without `finish()`.
- Pending handoff/material/compile/two-warm-up completion; cancellation at every preparation boundary; cancellation during the async compile await; deadline expiry retaining ownership; wait failure and context loss.

Direct focused command, with one worker and no npm lifecycle hooks:

```sh
./node_modules/.bin/vitest run tests/engine-shared-gpu-ownership.test.ts tests/gpu-frame-gate.test.ts tests/gpu-lifecycle.test.ts tests/gpu-frame-responsiveness.test.ts tests/renderer-resource-integration.test.ts tests/renderer-resource-lifecycle.test.ts tests/festival-renderer-loader-lifecycle.test.ts tests/engine-resource-integration.test.ts tests/engine-renderer-exclusive-release.test.ts tests/festival-ground-height.test.ts tests/festival-rendering-pipeline.test.ts tests/engine-renderer-texture-composition.test.ts --maxWorkers=1 --minWorkers=1 --reporter=dot
```

Result: **12 files / 157 tests passed**. After the first-failure implementation was adjusted to satisfy `no-unsafe-finally`, the focused new suite passed **25/25** again:

```sh
./node_modules/.bin/vitest run tests/engine-shared-gpu-ownership.test.ts --maxWorkers=1 --minWorkers=1 --reporter=dot
```

Scoped lint passed:

```sh
./node_modules/.bin/eslint src/rendering/shared-gpu-frame-gate.ts src/rendering/renderer.ts src/rendering/open-world/festival-renderer.ts tests/engine-shared-gpu-ownership.test.ts tests/festival-renderer-loader-lifecycle.test.ts tests/engine-resource-integration.test.ts tests/engine-renderer-exclusive-release.test.ts tests/festival-ground-height.test.ts
```

Existing fixture changes are limited to adding Festival gate-disposal stubs in `festival-renderer-loader-lifecycle.test.ts`, `engine-resource-integration.test.ts`, and `engine-renderer-exclusive-release.test.ts`, plus an always-ready admission stub in the camera-only `festival-ground-height.test.ts` fixture. Their existing assertions and other released lifecycle stubs are preserved.

### Coordinator review follow-up: observe compilation after fence failure

Review identified that a synchronous fence error could exit preparation before its `await compiling`, leaving a later rejected compilation promise unobserved. The narrow preparation change above closes that path and also applies first-synchronous-failure preservation to material/compile submission.

Added actual-production preparation regressions prove prompt rejection before the compile promise settles, no `unhandledRejection` event after late rejection for either allocation failure or context loss, unchanged cancellation/disposal metadata guards, normal compile rejection propagation, and preservation of `Error`, `undefined`, and `0` throws from either synchronous stage when fencing also fails.

Only the affected focused suite and two-file lint were rerun for this follow-up:

```sh
./node_modules/.bin/vitest run tests/engine-shared-gpu-ownership.test.ts --maxWorkers=1 --minWorkers=1 --reporter=dot
./node_modules/.bin/eslint src/rendering/open-world/festival-renderer.ts tests/engine-shared-gpu-ownership.test.ts
```

Result: **1 file / 34 tests passed**, with scoped lint clean. No full TypeScript check or build was run for the follow-up.

## Evidence limits

This is deterministic ownership and ordering evidence, not a native GPU latency/FPS measurement. Native WebGL and image-equivalence validation are deferred to the planned later wave; the blocked local Chromium path was not retried or bypassed. No full build, Git operation, npm hook, authored geometry/model/character/environment/material/shader/texture/tuning/asset edit, main host edit, or Festival session edit was performed by this assignment.
