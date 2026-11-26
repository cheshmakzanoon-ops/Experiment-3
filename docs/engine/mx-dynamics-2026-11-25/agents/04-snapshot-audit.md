# Agent 04 — MX snapshot and interpolation audit

Reviewed checkout `f3b39eb` on 2026-11-25. Read-only production review of snapshot interpolation, `PresentedFrame`, MX machine pose, wheel pose, and motorcycle protocol; supporting reads covered replay storage, live-frame timing, and existing tests. No production, model, character, geometry, material, or environment changes. No commits, pushes, installation, or npm hooks.

## Prioritized findings

### P2 — Published wheel speed disagrees with the wheel's displayed phase

**Evidence:** `src/rendering/wheel-pose.ts:66–97` reconstructs phase from exact recorded turns and a limited Hermite curve. `wheelValue` at lines 34–40 independently linearly blends `W.OMEGA`. `src/rendering/frame-state.ts:158–162` publishes those two different trajectories together. MX consumes them together in `src/rendering/bike.ts:2866–2869`; the existing MX wheel-exposure update consumes that omega in `src/rendering/offroad/dirt-bike-model.ts:1150`.

**Numerical repro:** A valid `mx450` pair, duration `1/15 s`, phase `0.25 → 3.25 rad`, measured winding valid, and both endpoint omegas zero gives:

| Quantity at alpha 0.5 | Result |
| --- | ---: |
| Finite-difference derivative of `wheelPhase` | 67.49999647 rad/s |
| `wheelValue(..., W.OMEGA, 0.5)` | 0 rad/s |
| `PresentedFrame` wheel omega | 0 rad/s |

This is the same class of unresolved spin burst deliberately supported by `tests/wheel-winding.test.ts:84–91`. Slope limiting during a rapid wheel lock also causes disagreement even with nonzero endpoint rates. The visible spin and exposure therefore use incompatible speeds, most noticeably at sparse replay cadence.

**Action:** Add a shared phase/rate sampler that differentiates the exact selected phase curve, including winding, limited tangents, linear long-gap fallback, and holds. Use its rate for presentation consumers and `PresentedFrame`; keep original recorded endpoint omegas unchanged. No model or material changes are needed. Cover both an unresolved burst and a limited locking interval with derivative-consistency assertions.

### P2 — The MX joint limiter suppresses physically bounded reversals

**Evidence:** `src/rendering/offroad/mx-machine-pose.ts:19–27` makes every nearly equal-position interval linear and clamps each normalized tangent nonnegative. This enforces monotonic motion between endpoint positions even when the recorded fork, shock, or steering rates describe a small coherent reversal. The current test at `tests/motocross-machine-animation.test.ts:78–79` explicitly enforces endpoint bounds, so that test currently encodes the limitation.

**Numerical repro:** Valid MX motion samples with fork compression `0.1 → 0.1 m`, duration `0.04 s`, and rates `+0.5 → −0.5 m/s` produce:

| Midpoint | Compression |
| --- | ---: |
| Current `sampleMxJointField` | 0.10000000149 m |
| Hermite curve matching both endpoint rates | 0.10500000138 m |
| Motion omitted by current limiter | 0.00499999989 m |

The supported curve has a small interior maximum and remains physically bounded. The current curve freezes the suspension throughout the interval and returns zero displayed rate, losing the reversal that should make rebound and steering feel continuous. This is a synthetic mathematical counterexample; an observed gameplay frequency was not measured.

**Action:** Permit small coherent interior extrema when endpoint rates and mechanical travel limits support them. Retain the conservative fallback for invalid rates, coarse gaps, travel stops, and unresolved impulses. Bound against actual joint travel instead of requiring every interior position to stay between both sampled positions. Validate position/rate continuity and physical limits for fork, shock, and steering reversals.

### P3 — Identical MX snapshot pairs can discard recorded joint rates

**Evidence:** With `a === b` and interior alpha, `presentationAlpha` returns 1 (`snapshot-interpolation.ts:57`). `PresentedFrame.sample` continues past its alpha-only endpoint return (`frame-state.ts:111–127`) and calls `writeMxMachinePose`. Its joint-rate path (`mx-machine-pose.ts:75–78`) passes duration zero into `sampleMxJoint`, which returns zero rate (`:19–20`).

**Numerical repro:** On the same valid MX snapshot, recorded rates `[0.5, −0.25, 0.20000000298]` are retained by `sample(frame, frame, 1)` but become `[0, 0, 0]` with `sample(frame, frame, 0.5)`.

**Action:** Preserve identical-pair/selected-endpoint data before reconstructing MX motion, and extend the existing generic identical-snapshot invariant to a marked MX payload. This is a helper-contract edge case, **not a demonstrated normal-pause regression**: `LiveFrameClock.sample` uses alpha 1 for paused and held-latest states (`live-frame-clock.ts:141–145,160`), and the current photo path uses alpha 0 (`main.ts:1923–1926`).

## Existing safeguards and overlap

- The reviewed checkout already has vehicle/root-convention/distance discontinuity guards, rider-state boundary handling, contact-change fallbacks, and analytic chassis position/angular velocity. These substantially overlap the reported concurrent snapshot/camera work; preserve them and reconcile with that owner before editing shared files.
- The MX machine samplers are absolute functions of snapshot inputs. Existing tests cover repeat sampling, reordered replay queries, and compact replay reproduction. No additional confirmed normal reset, landing, or pause timing defect was established in this review.
- Replay serialization retains the complete optional contact-tail payload (`src/storage/recorders.ts:124–125,154`), including MX motion. The identified errors occur during sampling, not payload omission.

## Validation

One small `node --experimental-transform-types --input-type=module` command imported the production samplers and asserted all three numerical repros above. It completed successfully in approximately 0.14 seconds. No simulation run, browser run, broad suite, or additional test command was used. Production remained unchanged.
