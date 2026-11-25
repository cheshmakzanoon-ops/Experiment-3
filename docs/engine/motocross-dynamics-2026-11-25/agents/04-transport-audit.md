# Assignment 04 — motocross snapshot, transport and replay audit

Baseline: `b527a7e01ea247f0233a2ec4f2850639bafbd887`. Audit only; no production/model/environment changes.

## What is already sound

`sampleChassisPose` rejects implausible root jumps and uses measured velocity/angular velocity for coherent interpolation. `riderAlpha` separates crash/remount clocks. `sampleOffroadField` keeps airborne and landing records discrete. `mx-machine-pose.ts` uses bounded joint Hermite interpolation and absolute fender curves, and `ReplayRecorder` retains the optional motion slots. Existing `motocross-machine-animation.test.ts` exercises real MX250/MX450 samples and replay/LOD cuts. Adding a second render-time spring would compromise the existing deterministic pause/seek contract and is not warranted.

## Reproduced findings

### 1. Presented foot controls disagree with the drawn motorcycle

`BikeShells` (`src/rendering/bike.ts`, `writeValues`) interpolates `MX_FOOT.ANGLE`, `COVER`, and `CLEAR` using the endpoint `hasMxFootControls` guards. `PresentedFrame.sample` copies the older optional-contact block and `writeMxMachinePose` updates only the machine channels. It never writes the foot controls.

A valid single-rider synthetic pair at 30 Hz, moving from angle 0 to 0.2 and cover 0 to 1, gives at alpha 0.5:

| Channel | Drawn sampler | PresentedFrame |
| --- | ---: | ---: |
| Selector angle | 0.10000000149 | 0 |
| Boot cover | 0.5 | 0 |

This is a concrete presentation-data coherence bug. The current rendered selector itself is already interpolated, so this result does **not** establish visible selector stutter. It matters for consumers inspecting or reconstructing the common presented pose, and future pose-driven effects. Fix in pure presentation code: factor one optional foot-control sampler, call it from the presented-frame writer, and preserve the zero fallback and actual state boundary. Do not modify model geometry.

### 2. An optional motion marker can certify non-finite motion

`hasMxMachineMotion` only checks marker 1 plus the knobby/riding contract. It does not validate any optional motion values. `snapshotIncompatibility` checks the contact mask, but not this zero-mask optional payload. A marked NaN `CHAIN_PULL` is accepted and reaches `PresentedFrame`; `sampleMxFender(..., alpha=1, velocity=true)` returns a marked NaN endpoint rate without checking it.

Executed production-helper probe result:

```json
{"acceptsCorrupt":true,"corruptChain":true,"endpointFlexVelocity":"NaN"}
```

This is a boundary-hardening issue, not a reproduced ordinary simulation instability. All solver-written values in inspected normal paths are finite. Fix by treating malformed optional motion as absent (or rejecting an explicitly marked corrupt payload at ingestion), validating individual finite fields without allocating on each frame, and preserving old zero-filled recordings. Check marker, finite fender displacement/rates, fork/shock/steer rates and chain pull. Avoid requiring a protocol stride change.

## Required compatibility action for the parent physics work

`SIMULATION_VERSION` is 39 in `src/core/session-identity.ts`. The proposed hard-stop/suspension/posture changes alter seeded dynamics outside vehicle-definition hashes. Increment the simulation identity and document its scope so old ghosts/results cannot certify the new model. The optional animation payload remains in existing contact-tail slots; changing physics alone does not require increasing `PROTOCOL_VERSION` or `CAR_STRIDE`.

## Focused acceptance

1. A PresentedFrame midpoint exposes the same selector/cover/clear values that the drawn motion sampler consumes, including riding-to-fallen and missing legacy endpoints.
2. Marker-zero legacy pairs retain their old neutral/linear fallback; a bad optional rate or chain pull never writes NaN into a presented frame or fender velocity.
3. Existing real-bike interpolation/replay tests remain passing; no render-clock state is introduced.
4. Verify new physics identity against `sessionIdentity` and existing replay/ghost compatibility tests after integration.

Reproduction used Node's `--experimental-transform-types` against production imports with one full `HEADER + CAR_STRIDE` frame, `vehicleIndex('mx250')`, mask zero, riding state zero, valid unit quaternion, and `MX_MOTION.VALID=1`. No fixtures or production source were changed to run it.
