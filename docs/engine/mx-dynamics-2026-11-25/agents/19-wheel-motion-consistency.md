# Agent 19 — Motocross wheel phase/rate consistency

Date: 2026-11-25. Wave 4/60. Follow-up to agent 18's confirmed wheel presentation finding.

## Result

**Implemented the shared wheel trajectory and analytic derivative for motocross presentation.** `wheelPhase()` and the MX `wheelValue(..., W.OMEGA, ...)` path now use the same private `sampleWheelMotion()` function. The winding selection, long-gap fallback, coherent low-speed reversal and both tangent limiters are evaluated by that common implementation. Its interior angular velocity differentiates the actual selected phase curve, including the final limited tangents.

The existing consumers already call `wheelValue()` and `wheelPhase()` together: `PresentedFrame` in `src/rendering/frame-state.ts`, and `BikeShells` in `src/rendering/bike.ts`. Thus both receive the correction without edits to either consumer. The shared scalar sampler creates no objects and keeps no playback state.

Representative results, with the actual Float32 snapshot clock:

| Interval | Corrected midpoint presentation omega |
| --- | ---: |
| 3 rad travel, endpoint speeds 0 → 0, duration 1/15 s | about 67.49999648 rad/s |
| 3 rad travel, endpoint speeds 300 → 0, duration 1/15 s | about 33.74999824 rad/s |
| 400 rad travel, endpoint speeds 0 → 0, duration 2 s | about 200 rad/s |

## Scope and dispatch

The new omega behavior applies only when the selected snapshot's vehicle has `tireFamily === 'knobby'`, currently `mx250` and `mx450`. Root approved that dispatch. It does not depend on an optional machine/posture marker or the rider state; wheels still retain their phase trajectory when those optional payloads are absent or the rider has fallen.

All vehicle families retain their previous phase trajectory. Cars, road race bikes and supermoto retain their previous linearly interpolated `W.OMEGA`. Explicit regressions cover `apx01`, `gpr1` and `sm450`.

Legacy MX samples without a winding marker retain their previous inferred-winding phase curve, including its conservative long-gap hold. Their presentation omega now describes that unchanged curve. This narrow change is necessary for phase/rate agreement and is covered separately from the non-MX compatibility contract.

## Selection and boundary contracts

- Exact endpoints retain the original recorded rotation and omega, including the bounded phase at the right endpoint. Limiting an interior curve does not overwrite measured endpoint bytes.
- Reusing the same snapshot retains its recorded omega at every interior alpha. Distinct snapshots with equal or decreasing clocks select the older record in the pure samplers. `PresentedFrame` continues to reject a decreasing clock.
- Teleports, vehicle changes and root-convention boundaries retain the established selected-record behavior. No derivative is invented across a reset.
- Compound changes, stop-count changes and tyre installation transitions retain the older tyre's phase and measured omega until the replacement boundary.
- A continuous interval whose existing phase fallback holds position publishes zero interior omega. Examples are missing winding across a long gap, zero measured displacement without a coherent reversal, and unusable unmeasured velocities. These differ deliberately from a reset or selected endpoint.
- Measured long-gap motion and measured motion with unusable endpoint velocities use the derivative of the existing linear winding fallback.
- Original snapshots and recorded replay bytes remain unchanged. Query order and repeated seeks do not affect the result.

## Exact authored files

1. `src/rendering/wheel-pose.ts` — shared phase/rate sampler, analytic derivative, MX-only `W.OMEGA` dispatch.
2. `tests/motocross-wheel-motion-consistency.test.ts` — new regression suite.
3. `docs/engine/mx-dynamics-2026-11-25/agents/19-wheel-motion-consistency.md` — this report.

No existing test assertions were changed. No simulation, model, character, geometry, environment, material or asset files were edited. Neither `frame-state.ts` nor `bike.ts` required modification.

## Verification

Ran the installed Vitest entrypoint directly, with one worker and no npm lifecycle hooks:

```sh
node node_modules/vitest/vitest.mjs run tests/motocross-wheel-motion-consistency.test.ts tests/wheel-pose.test.ts tests/wheel-winding.test.ts tests/wheel-winding-recording.test.ts tests/menu-preview.test.ts --maxWorkers=1 --reporter=dot
```

**Result: 5 test files passed, 80 tests passed; 6.92 seconds.**

The new suite independently finite-differences the public phase sampler at five interior alphas using the serialized clock duration, then compares the result with `wheelValue(W.OMEGA)` and the exact Float32 value published by `PresentedFrame`. Additional assertions cover the numerical counterexamples above, separate and pairwise slope limits, positive/negative winding, every wheel counter, wraps, the 0.5-second curve-selection boundary, a two-second fallback, nonfinite endpoint rates, coherent reversals with and without winding, continuous holds, exact endpoints, repeated snapshots, input immutability, zero/decreasing intervals, teleports, vehicle/root changes, tyre changes and non-MX compatibility.

The existing winding-recording suite exercised the physical wheel writer and replay page round trips. The new suite makes no claim to infer the true unresolved acceleration history between sparse snapshots; it ensures the published presentation rate matches the curve already chosen for those snapshots.

Ran the installed Prettier entrypoint only on the two authored TypeScript files. No installs, builds, full typechecks, npm hooks or git mutations were performed. No browser capture or full application/simulation suite was needed for this bounded pure-sampler correction.

## Limitations and handoff

Measured endpoints and reset/service selections intentionally retain source omega even when the one-sided derivative of a limited or held interior differs. That existing endpoint contract is explicit in the regression suite; changing it would be separate behavior work.

The tests validate the production samplers and presentation snapshot. `BikeShells` receives the same corrected function by its existing calls, verified by source inspection; no new model-construction or visual test was added.

Implementation is ready for root review. Production and test ownership is released.
