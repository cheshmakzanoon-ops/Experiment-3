# Assignment 23 — Transport the measured motocross body tangent

## Change and ownership

The optional `MX_POSTURE` contract now records the derivative of the actual `O.BODY` coordinate at contact-tail offset **+20** (`MX_POSTURE.BODY_RATE`). Its existing marker at +17 and standing/dab rates at +18/+19 are unchanged. Snapshot stride remains **331** and protocol version remains **17**. Offsets +21 through +32 were not used or changed by this assignment.

`writeWheelContact()` reads `DirtBikeVehicle.riderBodyRate`, supplied by assignment 22. That getter uses assignment 21's `RiderWeight.poseRate(automaticBody, automaticBodyRate)` to combine both moving coordinates. It is therefore the derivative of the transmitted body position, including the manual neutral join; it is not merely the automatic controller's rate. The writer admits the optional posture contract only when all three rates remain finite after Float32 conversion, and its existing block clear removes stale fields outside the live ridden MX contract.

The existing bounded Hermite helper now accepts `O.BODY` with physical limits -1..1. It keeps signed endpoint tangents, genuine reversals between equal endpoint positions, exact recorded endpoints, and the original Bézier control-hull bounds. There is no additional response curve, render clock, spring, or accumulated presentation state.

Only these files were changed:

- `src/simulation/protocol.ts`
- `src/simulation/wheel-contact-state.ts`
- `src/rendering/offroad/mx-rider-pose.ts`
- `src/rendering/snapshot-interpolation.ts`
- `tests/motocross-body-transport.test.ts` — new
- This report

The adapter, body controller, `bike.ts`, `frame-state.ts`, models, authored geometry, rigs, materials, assets, environments, and specifications were not edited. Root owns git, publication, and integrated TypeScript checking.

## Live consumer path

`DirtBikeVehicle.riderBodyRate` → `writeWheelContact` → `Simulation.writeFrame` → `sampleOffroadField(..., O.BODY, ...)` → `sampleMxPostureField`.

Both consumers already use that shared reader: `BikeShells.pose()` sends the reconstructed value to the existing `DirtBikeModel.pose()` body input, and `PresentedFrame.sample()` publishes the same value rounded to Float32 for cameras and effects. The new test runs the real `BikeShells.update()` path, observes its actual model call, and verifies agreement after compact replay seeks and near/far camera cuts. It does not replace the model's pose method.

Compact replay already retains the complete contact tail. Tests confirm that the new derivative survives packing/expansion and that seeking in a different order does not mutate the source snapshots or alter the reconstructed pose.

## Boundaries and compatibility

Recorded body movement uses the same presentation and rider gates as recorded standing/dab: equal or backward time, implausible teleport, vehicle change, crash count, rider state, and rider-clock reset hold the older body until the new endpoint. Zero-marker legacy frames retain their previous linear body behavior, including their previous rider-boundary interpretation. Other vehicles and non-MX-course payloads do not opt into the optional contract.

Missing markers, invalid marker values, NaN/infinite optional rates, and intervals longer than 125 ms fall back to the existing linear body segment. Exact endpoint body values remain unchanged. Extreme finite tangents remain bounded over the complete stroke. Malformed optional rates cannot make the reconstructed body value nonfinite; raw source payloads are not rewritten.

Body alone additionally falls back to linear when endpoint metadata shows:

- A change in `O.AIRBORNE`.
- A rewound `O.AIR_TIME`, indicating a new flight origin.
- A changed last-flight time between two grounded snapshots, revealing a complete short hop inside the interval.

These gates use physical event metadata. No error threshold was fitted to the traces. Standing and dab retain their existing interpolation at these boundaries.

## Reconstruction evidence

Production `Simulation` runs were observed at 240 Hz; each call contains two physics substeps. Every eighth observation supplies a 30 Hz endpoint, and all seven intermediate actual physics poses are used as truth. Errors below are absolute errors in normalized `O.BODY` units, whose full physical interval is -1..1. The baseline is the previous linear interpolation of the exact same endpoint poses.

The grounded trace starts from a settled brake brace, reverses manual input in both directions, releases the stroke, and changes braking inside some publication intervals. It remains parked and ridden throughout. The airborne trace rides the surveyed Valley Ridge `RIDGE TABLE` with ordinary approach inputs, then changes manual stroke and braking during a real launch and uninterrupted flight. No flight positions or body poses are fabricated.

| Vehicle / trace | Interior samples | Linear mean error | Recorded mean error | Linear peak error | Recorded peak error | Mean reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| MX250 / brake and manual reversals | 315 | 0.002208223 | 0.000150591 | 0.013836157 | 0.003626447 | 93.18% |
| MX450 / brake and manual reversals | 315 | 0.002208223 | 0.000150591 | 0.013836157 | 0.003626447 | 93.18% |
| MX250 / uninterrupted airborne intervals | 203 | 0.001312233 | 0.000026277 | 0.007233113 | 0.000267061 | 98.00% |
| MX450 / uninterrupted airborne intervals | 203 | 0.001271446 | 0.000044587 | 0.006884426 | 0.000826344 | 96.49% |
| MX250 / full approach and flight, including fallback | 511 | 0.000685832 | 0.000033935 | 0.007233113 | 0.001633844 | 95.05% |
| MX450 / full approach and flight, including fallback | 511 | 0.000629423 | 0.000050025 | 0.006884426 | 0.003294291 | 92.05% |

The matching parked results are expected: both production bikes use the same body response under this stationary command history. The tests separately establish a nonzero automatic body rate and a nonzero manual contribution to the combined recorded derivative.

### Conservative fallback tradeoff

The MX250 approach contains a complete short hop between two grounded snapshots; its later launch is a second boundary. Removing only the boundary metadata from test copies exposes the same unrestricted Hermite path for comparison. Across these two intervals, its summed absolute error is **0.018053034**, versus **0.009567775** for the retained linear fallback: a **47.00%** reduction at those problematic boundaries.

The MX450 launch illustrates the deliberate limit: unrestricted Hermite happens to fit that particular boundary better (summed error **0.001360111** versus **0.014802344** for linear). It still receives the same physical boundary rule. The implementation does not choose a curve by vehicle, snapshot phase, or retrospective truth. The complete MX450 trace still improves mean error by 92.05% against the original renderer.

Endpoint information cannot recover an unrecorded forcing change or every hidden event exactly. Hermite is not guaranteed to improve every interior sample, and the measured percentages describe these exercised trajectories. This work changes reconstruction only; it does not claim new handling, altered physics, or a visual playtest result.

## Verification

**123 tests passed across 10 files**, including 21 new transport tests:

```text
MX_BODY_METRICS=1 node_modules/.bin/vitest run tests/motocross-body-transport.test.ts tests/motocross-posture-transport.test.ts tests/motocross-rider-weight.test.ts tests/motocross-rider-blending.test.ts tests/motocross-posture-dynamics.test.ts tests/snapshot-interpolation.test.ts tests/motocross-body-input.test.ts tests/motocross-body-pose.test.ts tests/motocross-motion-boundary.test.ts tests/recording-transport.test.ts
```

`MX_BODY_METRICS=1` prints the reproducible measurements used above. New coverage includes the production writer and combined derivative, both 30 Hz physics traces, renderer/PresentedFrame agreement, replay seeking, signed slopes, physical bounds, all rider/reset gates, flight and hidden-hop fallbacks, malformed rates, Float32 overflow rejection, reused bytes, old zero markers, other modes, and unchanged stride/version.

Focused ESLint passed for all four changed source files and the new test. No full TypeScript check was run by this assignment; root retains the integrated 5 GiB check.
