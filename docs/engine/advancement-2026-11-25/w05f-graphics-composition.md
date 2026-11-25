# W05F — graphics scheduling and upload composition

Assignment 30/60, wave 5. **No additional production defect was found and no
production source changed.** The independently reviewed shared-context gate,
Festival scheduling and pending attribute unions compose correctly within the
boundaries exercised below.

Owned files:

- `tests/engine-graphics-advancement-composition.test.ts` — two integration cases.
- `docs/engine/advancement-2026-11-25/w05f-graphics-composition.md` — this report.

## Coverage added

### Shared pending frame → Festival scheduling → actual Three upload

The first case executes the complete current production `FestivalSession.frame`,
`resize` and `isPaused` methods selected with the TypeScript AST. Readiness uses
the complete production `FestivalRenderer.canSubmitFrame` method, the real
`acquireGpuFrameGate` leases and unchanged `GpuFrameGate`. The live clock and
presented-frame sampler are also real implementations.

The draw body is an explicit test boundary: the installed Three
`WebGLAttributes` performs the upload, a recorded draw command follows, and the
real lease submits its fence. This case does **not** execute Festival's full
scene construction, camera work or rendering transaction. W04D separately tests
the production transaction and failure fence; W04E separately tests the complete
session lifecycle. HUD, control and audio endpoints are observable doubles.

A recording GL boundary copies each actual `bufferData`/`bufferSubData` window
into separate storage. It records issued commands and permits completion only
when the test driver acknowledges them. The fixture does not implement Three's
range merging, version checks or gate readiness algorithm.

The sequence proves the following:

1. A circuit lease submits a pending frame. During 24 Festival callbacks, the
   fixture updates the same four vec3 items 24 times, requests two resizes and
   enters photo state. There is no resize, rider/traffic update, draw or upload;
   HUD, controls and audio are serviced on all 24 callbacks. The CPU range remains
   the exact 12-component union and uploaded storage retains its original bytes.
2. Observed completion permits the next presentation. Three uploads exactly
   **48 bytes at offset 1,200**, containing the latest values; it clears the
   consumed range. Both requested resizes are satisfied by one admitted resize.
3. A new nine-component dirty range survives an eligible GPU callback before
   photo cadence permits another draw. A subsequent explicit resize admits it
   and uploads **36 bytes at offset 1,248**.
4. A newer resize requested during that submission remains outstanding. Its
   next callback cannot bypass the pending fence. After observed completion,
   it is rendered immediately, and Three performs no redundant upload because
   the attribute version has not changed. All **29 callbacks** in the complete
   sequence still service HUD, controls and audio.
5. Releasing Festival's lease preserves the pending fence for both the circuit
   and a replacement borrower. They cannot admit another frame until actual
   recorded completion; the shared counters then show four submitted and four
   completed boundaries. All waits use zero flags and zero timeout; `finish`
   is never called.

The attribute writes are a controlled external producer. They do not assert that
Festival continues updating its scene during GPU deferral—the production frame
method correctly avoids those updates.

An initial fixture run expected an unchanged-attribute draw to create pending
work without recording a draw command. The shim then correctly reported its
empty fence as already complete. Adding the explicitly controlled draw command
fixed that fixture omission; no engine change or assertion weakening was needed.

### Actual trail producer → deferred publication → wrapped buffer

The second case uses two actual `FestivalTrails` producers and two real Three
uploaders. Both receive the same 181 prescribed finite snapshots and the same
height function. The reference publishes after each update; the other retains
its pending ranges behind the original shared fence. This is a buffer-publication
workload, not a claim that a particular visible/culling path accumulates 181
production presentation updates while its GPU is busy.

The 1,024-segment pool fills and wraps. All three pending attributes remain
bounded, and no deferred bytes are uploaded early. A released original lease and
a replacement borrower still observe the same pending work. After completion,
the actual uploader publishes **81,920 bytes** in three transfers: positions,
birth times and strengths. Every byte equals both the current CPU arrays and
the independently uploaded immediate reference. The birth-time witness also
establishes that old ring slots were overwritten, rather than merely filling a
fresh pool.

The next actual producer update creates narrow ranges again. A subsequent
admitted upload transfers less than the full pool and once again equals the
immediate reference exactly. This connects a real `markItems` caller's ring
behavior to Three's range clearing and shared completion ownership without
changing the caller, its geometry, shaders, materials or authored constants.

## Independent review findings

Source review confirmed that successful draw receipts alone advance Festival's
time, redraw and resize baselines. Readiness precedes rider/traffic posing, and
renderer admission is checked again at its draw boundary. Existing tests already
cover declining draws, partial render failures, simultaneous fencing failures,
context loss, compilation rejection, cancellation and fatal session teardown;
this assignment did not duplicate those scenarios.

The generic attribute helper holds state only in Three's own pending range
array. Three clears ranges only after its update completes, and unchanged
versions skip further transfers. There are no production `onUpload` callbacks
mutating attribute versions in the inspected source. Shared leases retain a
single context gate while any owner survives, independently of attribute
ownership or upload versioning.

The native graphics fixture audit checked its extracted production disposers.
The coordinator's already-added Festival `gpuFrames` dependency completes the
new cleanup contract; no additional missing graphics dependency was identified.
This is fixture inspection, not a native-browser run.

## Validation and limits

The following direct command passed **97 tests in four files** with one worker:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/engine-graphics-advancement-composition.test.ts \
  tests/engine-festival-frame-pacing.test.ts \
  tests/engine-shared-gpu-ownership.test.ts \
  tests/engine-attribute-range-coalescing.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0 --reporter=dot
```

After final fixture typing, formatting and full-service-count assertions, the
new file passed **2/2** again. Scoped ESLint passed, and the new test was formatted
with the repository's Prettier configuration. No broad compiler/build run,
Git operation, npm lifecycle hook, browser launch, timing benchmark or source
change was performed.

These are deterministic command/ownership and exact upload-byte results. They
are not native GPU latency, physical hardware, screenshot equivalence, FPS,
energy or retained-heap measurements. Native WebGL and dedicated timing remain
with the later assigned work. No original-baseline timing or source substitution
is used in these composition tests.
