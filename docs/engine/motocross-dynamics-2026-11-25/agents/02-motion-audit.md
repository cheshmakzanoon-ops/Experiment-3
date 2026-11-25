# Assignment 02 — motocross motion continuity audit

Baseline: `b527a7e0`. Read-only audit of production code; no model, geometry, material, venue, or environment edits. No repository `AGENTS.md` was found.

## Existing capabilities to retain

The current implementation already has deterministic absolute rider poses, recorded joint rates and monotone cubic suspension interpolation, exact damped fender modes, ground-aware boot placement, recovery gait, takeoff anticipation, sight of the landing, and a contact-timed chase-camera spring. Reimplementing these as render-time springs would harm replay and LOD consistency. `mx-ground-pose.ts` is scenery placement and is outside this task.

## 1. High priority: fixed-tick posture has velocity discontinuities and threshold chatter

`DirtBikeVehicle.posture()` in `src/simulation/offroad/dirt-bike-vehicle.ts` chooses `standUp` using hard thresholds (`speed > 7`, `abs(lean) < 0.42`, `climb > 0.5`) and advances standing with `approach(..., dt * 3.5)`. Dab and automatic fore/aft posture use the same constant-speed `approach` pattern with rates 6 and 3.

Consequences follow directly from these equations: an initially still standing channel acquires velocity 3.5/s on its first tick, stops immediately on reaching its endpoint, and reverses velocity immediately when the target reverses. Oscillation on either side of the lean/speed threshold reverses that velocity repeatedly. `sampleMotocrossRiderMotion()` smooths the scalar standing-to-joint mapping, but intermediate posture reversals still change joint velocity immediately. `MotocrossRiderSpine.ride()` also consumes standing directly. A later interpolation pass cannot restore the missing acceleration history.

Recommended implementation: a small motocross-only fixed-tick posture controller with bounded position and a persistent critically damped velocity for stance, dab, and automatic body demand. Replace brittle boolean thresholds with continuous demand over a narrow band, or explicit hysteresis where behavior must stay binary. Preserve pilot weight-shift authority (`RiderWeight` already has an analytic critically damped response), reset all history at placement/crash/recovery boundaries, and retain the existing snapshot fields. The controller can be developed in a new file before the lead integrates it into `DirtBikeVehicle`.

Validation: settled response; rapid target reversals; threshold sweeps; finite values and bounds; comparable response at equal simulated times under 60/120/240 Hz; fresh placement/reset equivalence; full MX250/MX450 jump/landing checks because standing also changes physical damping and drag. Do not silently retune handling merely to meet pose assertions.

## 2. Medium priority: chase heading depends on the rendering rate during a continuous turn

`src/rendering/offroad/chase-camera.ts` updates heading using the newest target as a step: `heading += error * -expm1(-afterEdge / headingLag)`. Its height filter already uses the exact response to a line between consecutive measured targets, but heading does not. Existing camera tests compare a held target after a long settle, which does not expose a continuously turning target.

Measured with the actual controller on flat terrain, a 0.7 rad/s heading ramp for two seconds, identical final input, motion disabled:

| Render rate | Final camera bearing |
| --- | --- |
| 30 Hz | 1.3340783417 rad |
| 60 Hz | 1.3286860842 rad |
| 120 Hz | 1.3258798445 rad |
| 144 Hz | 1.3254049842 rad |
| 240 Hz | 1.3244491279 rad |

The 30 versus 240 Hz difference is 0.00963 rad (0.552 degrees), corresponding to approximately 11.4 cm of gaze displacement in this case. This is a reproducible continuous-input error, distinct from the intended lag. Implement the angular counterpart of the existing exact ramp-follow calculation, with shortest-arc unwrap, snap preservation, and careful split treatment at takeoff/touchdown. Roll and continuously changing gaze demand have the same newest-target sampling pattern and warrant the same review.

Validation: constant turn ramp at 30–240 Hz, crossing ±pi, interrupted/held time, spin snap, airborne flight heading, and the existing split-versus-skipped contact timing scenarios.

## 3. Lower priority: monotonic joint interpolation discards velocity at unresolved reversals

`src/rendering/offroad/mx-machine-pose.ts::sampleMxJoint()` clamps each tangent to the sign of its individual interval. A measured joint rate can therefore be preserved on one side of a shared snapshot and forced to zero on the other when travel reverses. When endpoint displacement is below `1e-8`, the entire interval becomes linear/constant even if endpoint velocities are nonzero. This intentionally prevents interpolation from exceeding measured travel, but means the function is not generally velocity-continuous through fork/shock reversals.

Investigate only with measured suspension recordings: distinguish a real travel stop from an ordinary rebound extremum, preserve safe endpoint rates within physical stroke limits where possible, and retain the present conservative fallback for coarse/invalid intervals. Do not remove bounds globally or invent extra suspension travel. The impact/physics audit may remove the source of much visible chatter before interpolation changes are necessary.

## Safe ownership

- New pure simulation posture controller: one implementer; `dirt-bike-vehicle.ts` integration remains centrally owned.
- `src/rendering/offroad/chase-camera.ts`: independent camera owner.
- `src/rendering/offroad/mx-machine-pose.ts`: independent interpolation owner, only if reversal evidence justifies a change.
- `src/rendering/offroad/motocross-rider-motion.ts`: pure animation mapping, safe for targeted engine work.
- Keep `rider.ts`, `bike.ts`, `dirt-bike-model.ts`, spine skin binding, assets, and terrain/environment builders protected unless the lead explicitly isolates a necessary behavior-only integration hunk.

No production changes or permanent tests were made for this audit. The camera measurement was executed directly against the checked-out TypeScript with Node's type transformation.
