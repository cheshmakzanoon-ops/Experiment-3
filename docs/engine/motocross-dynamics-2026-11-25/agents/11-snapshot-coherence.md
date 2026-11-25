# Assignment 11 — common motocross motion and optional-payload boundaries

## Changes

`writeMxMachinePose()` now writes selector angle, boot cover and boot clearance into the shared `PresentedFrame` using the same guarded endpoint interpretation as the drawn bike. This also works for older recordings that contain foot controls but predate the elastic-machine marker. A riding-to-fallen interval releases toward the neutral foot pose in the same way as the existing drawn sampler.

The optional machine extension now requires finite fork/shock/steer rates, both elastic displacement/rate pairs, and chain pull before it supplies higher-order joint/fender motion. A corrupt marked endpoint disables the optional motion for the interpolated pair and clears those optional channels in the presentation copy. Core pose interpolation then retains its existing fallback.

The coordinator approved a minimal additional change to `frame-state.ts`: exact endpoint and held reset-boundary copies run the same sanitizer before returning. Ordinary valid endpoints remain byte-identical, and caller snapshots are not mutated. A repeated `a === b` sample retains measured optional rates rather than reconstructing zero rates from a zero-duration interval.

No `bike.ts`, model, geometry, material, environment, protocol layout, or simulation source edits were made. The corruption fallback uses the existing renderer behavior: `sampleMxFender()` returning `undefined` disables the recorded chain path as well, so a malformed marked chain endpoint is not read by raw chain interpolation.

## Executed verification

Command:

```sh
npx vitest run tests/motocross-motion-boundary.test.ts tests/motocross-machine-animation.test.ts
```

Result: **10 tests passed across two files**, including five new boundary contracts and the existing real-simulation joint reconstruction/replay cases. The new contracts exercise shared versus drawn control interpretation, the falling rider edge, exact endpoints and held frames, malformed finite-field variants, held teleport boundaries, and preservation of legacy/supermoto payloads.

Focused ESLint passed for the two modified production files and new test file.

## Boundary

This is defensive handling of an explicitly marked optional motocross extension, not evidence that ordinary simulation produces corrupt frames. The sanitizer does not reinterpret unmarked legacy bytes or other vehicles' contact payloads. It does not replace the general snapshot compatibility checks. Tests execute production interpolation and existing replay/model logic on the CPU; they are not a GPU or subjective visual-quality result.
