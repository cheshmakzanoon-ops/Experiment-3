# Agent 18 — Upstream motion reconciliation

Date: 2026-11-25. Wave 3/10, agent 6. Stable upstream reviewed: `39d9d497880e92801a7d77de6af2639b4186bfcc` (`origin/main`). Source references below use that commit's line numbers unless explicitly marked local.

## Result and priority

**One confirmed remaining P2 animation defect: wheel phase and published wheel angular velocity still describe different motion.** The old equal-position joint reversal and identical-snapshot joint-rate findings are fixed upstream. Automatic posture now has a continuous controller, recorded tangents, bounded cubic reconstruction, and lifecycle guards. The prior remount defects remain in upstream but already have a local patch; they are not new work for this wave.

The upstream manual rider blend and its analytic `poseRate()` must be kept together. Root confirmed it will keep that implementation and mark the competing local global-blend patch/test as superseded. No new smoothing or calibration change is needed for the merge.

This report is the only authored file. No production files, tests, models, characters, geometry, or render assets were edited. No test suite, installation, lifecycle hook, full typecheck, git mutation, or repeated test of a resolved finding was run.

## P2 — Wheel phase derivative still disagrees with displayed/published omega

### Exact evidence

- `src/rendering/wheel-pose.ts:24–40`: `wheelValue(..., W.OMEGA, ...)` linearly interpolates the recorded angular velocities, with a tire-replacement guard.
- `src/rendering/wheel-pose.ts:53–97`: `wheelPhase()` independently selects reset/hold behavior, exact recorded winding or inferred winding, a long-gap linear curve, or a cubic with limited tangents. It retains coherent low-speed reversals. Those choices generally change the instantaneous angular velocity.
- `src/rendering/frame-state.ts:164–168`: the presented wheel block receives its omega from `wheelValue()` and rotation from `wheelPhase()`.
- `src/rendering/bike.ts:2866–2869`: the model receives the same independently sampled omega and phase pair. This confirms that changing only `PresentedFrame` would leave the drawn wheel's speed-dependent presentation inconsistent.
- `tests/wheel-winding.test.ts:68–91`: existing tests intentionally support a sparse braking interval and a wheelspin burst with zero endpoint speeds; they verify phase reconstruction, not phase/rate agreement.

For the selected cubic, with normalized time `t`, lifted displacement `d`, duration `dt`, and the **post-limiter** interval tangents `u` and `v`, the displayed angular speed is:

```text
[6 t (1-t) d + (3 t² - 4 t + 1) u + (3 t² - 2 t) v] / dt
```

It is not, in general, `(1-t) * omegaA + t * omegaB`.

### Concrete remaining counterexamples

Use the existing `measuredPair()` construction in `tests/wheel-winding.test.ts:35–51`, with valid winding and unchanged vehicle, tire, contact/root convention, and position. Values below are at `alpha = 0.5`. The short duration is stored as Float32, matching the snapshot clock.

| Recorded interval | Derivative of the selected phase curve | Current published omega |
| --- | ---: | ---: |
| Travel `3 rad`, endpoint omegas `0 → 0`, duration `1/15 s` | `67.49999648 rad/s` | `0 rad/s` |
| Travel `3 rad`, endpoint omegas `300 → 0`, duration `1/15 s`; slope limiter reduces the start tangent to `9 rad` | `33.74999824 rad/s` | `150 rad/s` |
| Travel `400 rad`, endpoint omegas `0 → 0`, duration `2 s`; recorded-winding long-gap fallback | `200 rad/s` | `0 rad/s` |

These are deductions from the unchanged production branches, checked with a small inline arithmetic calculation. The first is also the unresolved production-sampler reproduction already documented in audit 04. No claim is made about gameplay frequency, and no new broad simulation was needed to establish the inconsistency.

### Bounded next action

Add one shared absolute wheel phase/rate sampler that chooses the existing winding and curve branches once, then analytically differentiates that exact curve. Use the resulting rate wherever presentation requests `W.OMEGA`, including the existing `wheelValue()` call path shared by `PresentedFrame` and `BikeShells`. Leave simulation omegas and stored replay bytes intact. Preserve exact measured endpoint and identical-snapshot behavior; explicitly preserve existing reset and tire-boundary selection semantics. No model, character, geometry, or material change is required.

### Focused proposed regressions

Extend `tests/wheel-winding.test.ts` and, where useful, the existing `tests/wheel-pose.test.ts` rather than creating a new simulation fixture:

1. For the three cases above, compare an interior finite-difference derivative of `wheelPhase()` against the new presentation omega at `alpha = 0.25, 0.5, 0.75`. The finite-difference denominator must be the actual snapshot `dt` times the normalized alpha span. Stay away from endpoint wrapping.
2. Assert that `PresentedFrame` publishes the same Float32 omega as the shared sampler, including the braking case where tangent limiting is active. Assert input arrays remain unchanged.
3. Cover positive and negative measured winding, the existing coherent low-speed reversal, and the legacy no-winding fallback so the fix cannot silently differentiate the wrong lifted angle.
4. Keep endpoint and identical-pair recorded-byte contracts, tire replacement, nonincreasing-time holds, and teleport/vehicle/root reset behavior in the focused suite. These are branch-preservation checks for the new shared sampler, not reasons to change already working lifecycle semantics.

## Findings from audits 03/04 that upstream already resolves

| Previous finding | Upstream implementation and existing regression evidence | Disposition |
| --- | --- | --- |
| Audit 04: equal-position joint intervals erase coherent reversals | `src/rendering/offroad/mx-machine-pose.ts:83–103` admits opposed rates only when displacement is coherent, the interval is continuous, and the equivalent Bezier control hull fits actual fork/shock/steering travel. `:105–114` retains conservative fallback. `tests/motocross-joint-reversal.test.ts:37–98` covers equal positions, neighboring interval velocities, stops, and inconsistent rates; `:116–139` covers unresolved boundaries/fallbacks. | Resolved. Do not restore the old endpoint-envelope requirement. A physically supported interior extremum is intentional. |
| Audit 04: identical snapshots lose joint rates | `src/rendering/offroad/mx-machine-pose.ts:163–168` copies the selected motion payload before any zero-duration reconstruction and sanitizes it. `tests/motocross-motion-boundary.test.ts:81–91` covers an interior-alpha identical pair; `tests/motocross-joint-reversal.test.ts:55` explicitly retains the recorded rate. | Resolved. No extra zero-duration patch needed. |
| Audit 03: manual blend has a velocity corner at neutral | `src/simulation/offroad/rider-weight.ts:39–71` adds a local Hermite join and its exact joint automatic/manual derivative. `tests/motocross-rider-blending.test.ts:111–188` checks prior outer authority, monotonicity, one-sided slopes, and derivative consistency. | Resolved by upstream. Keep the matching `pose()`/`poseRate()` pair. |
| Audit 03: binary/constant-speed automatic posture is a possible smoothing item | `src/simulation/offroad/mx-rider-posture.ts:14–38` makes speed/lean/climb/dab targets continuous; `:59–74` supplies analytic critically damped movement; `src/simulation/offroad/dirt-bike-vehicle.ts:1331–1349` uses the new controller for MX. `tests/motocross-posture-dynamics.test.ts:30–60,118–145` already covers rate reversal, cadence, and former thresholds. | Addressed upstream. Do not add another render-time or simulation spring. |

### Reversal overshoot assessment

The upstream joint reconstruction distinguishes an admissible extremum from an unsafe overshoot. Its Bezier hull check bounds the complete accepted reversal curve against actual travel, not only against a few sampled alphas. The fallback remains monotone between valid endpoints. Posture reconstruction similarly clamps the Bezier controls to `[0,1]` for standing and `[-1,1]` for dab/body (`src/rendering/offroad/mx-rider-pose.ts:16–43`). The upstream tests already exercise extreme finite posture tangents and physical joint stops. This review found no new justified replacement for those policies and did not rerun the solved synthetic cases.

## Posture and lifecycle pose assessment

`sampleOffroadField()` now applies both `presentationAlpha()` and `riderAlpha()` to marked standing/dab/body payloads (`src/rendering/snapshot-interpolation.ts:134–143`). Thus a placement, vehicle/root reset, crash, remount, or state-clock origin change cannot smear a new posture backward into the preceding state. The body sampler separately declines the cubic across launch, landing, short hops, and flight-clock resets (`src/rendering/offroad/mx-rider-pose.ts:27–34`). Existing `tests/motocross-posture-transport.test.ts:141–184` and `tests/motocross-body-transport.test.ts:254–314` specify these contracts. Boundary holds and the body-only linear contact fallback are deliberate, not evidence of a new motion bug.

The live MX flight path advances stance in `posture()` and the automatic body in `flight()` (`src/simulation/offroad/dirt-bike-vehicle.ts:912–916,1334–1338`), preserving body state between those calls. It does not repeatedly reset automatic posture to takeoff. `settle()` resets spring rates from the currently observed posture (`:335–338`), and completed MX remount re-samples the final patch before settling (`:820–826`). The earlier suspicion about the old posture code therefore should not be carried forward as an unresolved finding.

Upstream `src/simulation/bike-vehicle.ts:955–959` still contains audit 03's per-axis remount translation and direct rider-heading assignment. The local patch already replaces those for motocross/knobby bikes with a vector-limited stride, bounded shortest-arc turn, and an orientation completion condition. Preserve that existing local fix during merge. This report does not claim it was retested or propose duplicate work.

## Local rider-blend merge disposition

The local agent 09 global cubic changes manual authority throughout the stroke, while upstream changes only `|position| < 0.15`. At manual position `0.5` and automatic posture `0.45`, upstream returns `0.725`; the local global cubic returns approximately `0.798902225`. Its manual slope is approximately `0.59926815`, whereas upstream `poseRate()` correctly uses `0.55` for its own outer segment. Combining the local pose with upstream `poseRate()` would make the recorded body tangent mathematically incorrect.

This matters because `DirtBikeVehicle.riderBodyRate` calls `poseRate()` (`src/simulation/offroad/dirt-bike-vehicle.ts:171–173`) and the writer records it as `MX_POSTURE.BODY_RATE` (`src/simulation/wheel-contact-state.ts:53–59`). Keeping the local old file wholesale would instead omit the newly required method. Root has explicitly chosen the compatible outcome: keep upstream rider-weight intact and retire the local global-blend test with a superseded explanation. C2 curvature continuity can be a future, separately justified calibration discussion; the existing velocity-discontinuity defect is already fixed.

## Validation and handoff

Used stable `git show origin/main:<path>` reads, source/test searches, the two earlier audit reports, and the local rider-weight/remount diffs. A single inline Node arithmetic calculation confirmed the table and blend comparison; it did not import changing working-tree source or write a probe file. Existing regression coverage above was inspected, not executed or represented as newly passing.

**Next priority: shared wheel phase/rate reconstruction with the focused derivative regressions.** Preserve upstream posture/joint/lifecycle fixes and the already-owned local remount patch. No additional confirmed motion deficiency was established within this review's scope.
