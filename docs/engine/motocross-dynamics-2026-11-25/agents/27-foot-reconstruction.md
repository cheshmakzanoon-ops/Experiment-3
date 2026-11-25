# Assignment 27 — recorded foot trajectory reconstruction

## Result

The live motorcycle reader and `PresentedFrame` now sample the same accepted-shift trajectory as `MxGearStroke`. They preserve the outward clearance waypoint between snapshots instead of independently interpolating the selector, cover and clearance endpoints.

The reported downshift-at-zero / upshift-at-115-ms defect is reproduced by the new test before reconstruction. Its actual mesh measurements are:

| Detail, either MX bike | 60 Hz endpoint lerp, alpha 0.4 | 30 Hz endpoint lerp, alpha 0.2 | Reconstructed samples |
| --- | ---: | ---: | --- |
| Mid | −5.924 mm | −14.541 mm | Boot clears all three sleeve rays laterally |
| High | −7.579 mm | −15.314 mm | Boot clears all three sleeve rays laterally |

Negative values indicate overlap along the existing vertical contact rays. An absent boot intersection after reconstruction means lateral clearance, not an infinite physical separation. The established **3 mm** overlap tolerance is unchanged.

## Shared motion and transport

`sampleMxGearChannel` is a pure, allocation-free evaluator of the original controller curve. The accepted event's incoming positions and rates determine its shortened selector bridge, cover coast, resting cover and coordinated clearance route. `MxGearStroke` and the new `sampleMxFootField` both call it. No render-time spring or temporal sampling history is added.

The optional `MX_FOOT_TRAJECTORY` payload uses exactly the twelve previously unused zero-mask MX contact floats:

| Contact-tail offsets | Contents |
| --- | --- |
| +21 | Recorded marker |
| +22 | Accepted/reset event counter, wrapping exactly within Float32's 24-bit integer range |
| +23 | Age relative to the accepted command |
| +24 | Direction, including zero for reset/inactive |
| +25…+27 | Incoming selector, cover and clearance positions |
| +28…+30 | Their incoming rates |
| +31…+32 | High and low parts of the adapter clock |

`writeWheelContact` records the seed alongside the existing three position fields. The existing compact recorder already preserves this complete contact tail. The split adapter clock locates an event within a snapshot pair without subtracting two coarse Float32 race clocks. Relative ages retain precision within a stroke, including the tested 1-hour, 1-day and 1,048,576-second clock origins.

Same-event pairs reconstruct their recorded route. An adjacent event is reconstructed on its proper side of the interval boundary after checking that its seed joins the preceding trajectory. Multiple unobserved events, resets, inconsistent seeds, malformed optional payloads and gaps over 125 ms select a complete measured endpoint pose. This avoids inventing a path through a missing waypoint. Unmarked legacy pairs retain their original linear interpolation. Exact endpoints remain the measured values; non-finite/out-of-range positions are sanitized. Synthetic interior `PresentedFrame` values clear the copied trajectory marker so a stale measured age cannot masquerade as a new authoritative snapshot.

Protocol version **17**, per-car stride **331**, and simulation version **40** remain unchanged. The reserved body-rate slot at +20 is untouched.

## Numerical continuity

Large-clock subtraction exposed an existing numerical corner at a canonical peak: the position could round exactly to its travel limit while retaining a tiny outward derivative (about `2.1e-10/s` in the reproduced case). That impossible tangent collapsed the next handoff to zero duration. The shared evaluator now returns zero for an outward canonical rate only when its sampled position is already at the physical limit. This keeps the next accepted stroke continuous at the numerically represented limit.

An independent comparison against the pre-assignment controller sampled both isolated directions every 0.1 ms through their full 260 ms duration: **5,202 samples, all 15,606 positions exactly equal, and zero rate difference**. Existing interruption position/rate continuity tests remain passing. Gear acceptance and shift-cut timing are unchanged.

## Verification

```sh
MX_FOOT_METRICS=1 npx vitest run \
  tests/motocross-foot-reconstruction.test.ts \
  tests/motocross-interrupted-shift-contact.test.ts \
  tests/motocross-shift-continuity.test.ts \
  tests/motocross-control-animation.test.ts \
  tests/motocross-machine-animation.test.ts \
  tests/motocross-posture-transport.test.ts \
  tests/motocross-body-transport.test.ts
```

**92 tests passed across seven files**, exit code zero, with no unhandled errors. Focused ESLint and `git diff --check` passed. No full TypeScript check was run, as requested by the coordinator.

The eleven new tests cover:

- **64,000 reconstructed poses** across both directions, every integer-millisecond interruption from 60–259 ms, four event phases and 60/30 Hz snapshots. Maximum position-channel error versus the controller is **4.4321e-7**. Every sampled value is finite and inside the existing channel bounds.
- **4,680 actual mesh poses / 14,040 sleeve stations** across MX250/MX450, mid/high detail, both snapshot rates, all direction pairs, three event phases, six interruption times, and repeated-direction/reversal sequences. Worst sampled overlap is **0.129 mm at mid detail** and **1.083 mm at high detail**. Both remain below the unchanged 3 mm tolerance. Original top/sole contact positive controls remain present.
- Live `BikeShells` versus `PresentedFrame` boot matrices, mid/high LOD cuts, repeated samples and out-of-order seeks; complete compact replay metadata; counter rollover; a real two-command interval at the 60 ms minimum cadence; reset/inactive transitions; same-time and reversed local clocks; long gaps; malformed optional fields; and legacy interpolation.

The existing control-animation replay assertion explicitly requiring the obsolete linear midpoint (`−0.01`) was narrowly updated, with coordinator authorization, to use the controller at the same recorded physical time. All endpoint, mesh/contact and tolerance assertions were retained. Dense mesh tests yield between cases so Vitest can publish status updates without its RPC timeout.

## Scope and limits

Only assigned controller, protocol, transport, pure reader, tests and report files were changed. In `src/rendering/bike.ts`, changes are limited to the authorized import/unused-import adjustment and replacement of the three direct foot lerps. A byte comparison against the handoff baseline, excluding that exact approved region, verified **120,843 protected bytes unchanged**, SHA-256:

`562dfa5b915a0818d057f1301f816eb599d516d2b67523d7fce05fd3d63d9fc7`

No character/bike model definitions, mesh construction, materials, geometry, assets, environments, vehicle specifications or other pose logic were edited. No adapter or git-history mutation was performed.

Contact evidence uses the existing static-sag fixture, riding stance 0.24, rear brake 0.75, neutral chassis/steering, and three authored sleeve stations. It does not certify continuous triangle collision detection or every rider/terrain posture. Far detail omits these controls. Legacy recordings cannot recover an unrecorded waypoint; unresolved history deliberately holds a measured pose. A repeated Float32 race-clock header still follows the existing whole-chassis presentation hold; the local foot sampler remains deterministic and precise from its own clock payload.
