# Agent 14 — ridden two-lap integration diagnosis

Date: 2026-11-25. Scope: read-only production audit; the only repository edit is this report. Existing lap assertions are unchanged. No lap simulation was rerun, no package hooks were run, and no rendering, character, model, geometry, material, or environment files were changed.

## Finding and proposed ownership

The highest-confidence controller defect is that the jump governor can preserve a lane outside the surveyed jump face while selecting its speed from the full-height centre-profile survey. Arena's failing finish triple is a direct example. Fix lane acquisition and clear eligibility in `src/simulation/offroad/ai.ts` before changing body authority or landing judgement. A bounded finite-horizon pitch controller is a separate useful refinement; it cannot repair the wrong ballistic landing corridor.

Suggested ownership:

| Owner | File / responsibility | Priority |
| --- | --- | --- |
| Next planner implementation agent | `src/simulation/offroad/ai.ts`: acquire the existing held feature lane, verify the departure corridor before locking a clear, and retain a feasible roll/abort decision | First |
| Root / a later flight-control agent | `src/simulation/offroad/dirt-bike-vehicle.ts`: optional bounded finite-horizon body-demand calculation using existing torque, inertia, damping, and body slew | After correct lane and supported-contact integration |
| Existing contact integration agent | `src/simulation/offroad/dirt-bike-vehicle.ts` plus the coupled hard-stop helper: inspect Valley's first rear bottom-out and subsequent pitch momentum | Already separately owned; do not overlap |
| Separate follow-up, if the remaining Valley lowside persists | Adapter/core roll-feedback boundary under actual tyre support; do not assume the planner alone caused the sustained wrong-side lean | Investigate only after the planned fixes |

## Evidence source and reproducibility

Read first: `/home/agent/mx-lap-debug-579b454ae846.ts` and `/home/agent/motobound-diagnostics-579b454ae846/laps.json`. The runner uses the normal AI driver to supply player inputs, with `aiControlled` withheld, and sets airborne steer and front brake to zero. It therefore drives the dedicated ridden contact plant with a planner historically calibrated for the AI plant. It does not show that a human cannot ride the circuits.

Captured production hashes match the files inspected during this audit:

| File | SHA-256 |
| --- | --- |
| `dirt-bike-vehicle.ts` | `52f1ba3baa761a48e530e00bbe7d66baac5f7017da83ebd37328cdc12b072750` |
| `mx-ground-physics.ts` | `9eb4c94b0455a55d8e35333b5f86163999f497906b5cf1ccf20ac1041c7a1960` |
| `rider-weight.ts` | `f2395b6adc6bfb80bf5493cec399d0a455e2f6d56da4552f1dc99863253ff1b9` |

Small independent probes imported the production course definitions, `jumpHoldSpeed`, and `Track`, then evaluated width/relief at the already-recorded trace stations. No dynamics, input, or terrain state was changed. Fresh course relief confirms the static profile fade; it does not recreate the trace's deformation history.

## 1. Surveyed jump speed is applied to a different lane profile

`course.ts:114–116` defines tape allowance **0.8 m** and outside-berm allowance **1.6 m**. `course.ts:173–186` applies the berm allowance only on the appropriate berm side. There is no 2.8 m general allowance.

`course.ts:191–200` multiplies jump-profile height and longitudinal grade by:

```text
fade = 1 - smooth(groomedHalfWidth + 0.4, groomedHalfWidth + 3.4, abs(lateral))
```

The jump survey and `jumpHoldSpeed` use the full profile's lip height, launch angle, and landing zone (`profile.ts`, `jump-target.ts:30–37`). The current governor does not adapt that survey to the actual departure lane.

Exact values from the captured positions and production course query:

| Case / station | Lateral | Groomed half-width | Legal half-width | Profile height factor |
| --- | ---: | ---: | ---: | ---: |
| Arena, before finish triple, s441.131 | −5.5804 m | 4.2 m | 5.0 m | 0.749402 |
| Arena, flight onset, s451.862 | −5.5804 m | 4.2 m | 5.0 m | 0.749387 |
| Arena, touchdown, s466.615 | −5.5645 m | 4.2 m | 5.0 m | 0.756396 |
| Valley, on sky-triple face, s586.625 | −6.1061 m | 5.0 m | 5.8 m | 0.859900 |
| Valley, flight onset, s588.549 | −5.8983 m | 5.0 m | 5.8 m | 0.926394 |
| Valley, first touchdown, s606.338 | −3.9774 m | 5.0 m | 5.8 m | 1.000000 |
| Valley, second failure's initial straight, s343.563 | −7.6817 m | 5.0 m | 5.8 m | No jump present |
| Valley, second failure, s362.732 | −7.6809 m | 5.0 m | 7.4 m, outside berm | No jump present |

Arena's nominal 31-degree face becomes approximately `atan(0.7494 * tan(31°)) = 24.24°` on this shoulder, before small base-ground and deformation effects. The actual takeoff velocity is consistent with the lower launch angle.

The exact steering override is `ai.ts:483–512`, `governJump()`. Inside 28 m of the lip it assigns steering from course-heading error, current lean, and lean rate, with **no lateral-lane error**. Once the bike is parallel to the straight, zero lean and zero yaw error make this command almost zero even 5.58 m off centre. In the Arena trace, lateral remains −5.5804 m from s441 to s452 while commanded steer decays to zero. The intended held feature lane is already defined within ±1.5 m at `ai.ts:585–587`, but this final governor overwrites the controller that can reach it.

The existing bounded lane-to-lip blend (`motocrossJumpApproachSteer`, `ai.ts:84–94`) is only used by `alignRhythmRunup`, `ai.ts:192–220`, for an identified **whoops-to-triple** run. Arena's finish triple follows rollers, so that path does not repair its late lane lock. Valley has the matching whoop run, but its recorded heading still leaves a diagonal flight from a reduced-height takeoff side to a full-height landing.

### Bounded fix proposal

1. Reuse the existing held feature-lane target and bounded lane-to-lip blend for all committed jumps, with enough approach distance to settle both lane and heading. The correction should use ordinary input steering, and finish before the tyre leaves the face.
2. Before committing to a centre-survey clear, require the projected departure and landing tyre corridor to stay inside the full-profile band, with tyre/heading clearance. The physical full-profile boundary is `width + 0.4`, not the tape width or a generic generous lane bound. The existing ±1.5 m held lane provides ample intended margin.
3. When that corridor is unreachable with the remaining supported run-up, use the existing roll/abort state while braking distance still permits it. A late speed increase cannot turn a shoulder launch into the surveyed clear, and airborne steering cannot repair the centre-of-mass path.
4. Do not change `TAKEOFF_GAIN` by guesswork, widen the course, or soften landing limits to conceal this mismatch. A future lane-specific trajectory survey is an alternative to acquiring the existing surveyed lane, but is a larger planner change.

Acceptance should preserve the current two-lap assertions and add a small production-controller regression proving that a wide, parallel approach does not stay indefinitely tangent-locked while committed to the centre-profile clear. This is a distinct causal regression, not a copy of implementation arithmetic.

## 2. Both landing events are physically hard upslope interceptions

### Arena finish triple

Survey: start s448.639, lip s451.469, landing centre s471.024, landing pitch −0.331613 rad; `jumpHoldSpeed = 13.725019 m/s`. The trace approaches at roughly 13.87 m/s, so this is not simply a missed scalar road-speed target.

At flight onset (t132.6083), horizontal speed is 12.8504 m/s, vertical speed 5.5474 m/s, pitch 0.4310 rad, and pitch rate −0.8966 rad/s. The tyre predictor immediately forecasts an **upslope** of +0.4377 rad with about 1.138 s remaining. Actual touchdown at t133.7708 / s466.511 is about 4.51 m before the surveyed landing centre. Its recorded local slope is +0.423608 rad and normal closing speed 8.9920 m/s. The front suspension then reaches travel and reports bottoming speed 8.3928 m/s before `crash-flat`.

The predictor's early positive slope is useful evidence that the flight is already on the wrong landing corridor. Better pitch alignment can distribute the impact, but does not remove its approximately 9 m/s closing speed.

### Valley sky triple and secondary bounce

Survey: lip s587.935, landing centre s608.839, landing pitch −0.331613 rad; `jumpHoldSpeed = 14.278590 m/s`. The first recorded flight begins with pitch rate −1.0243 rad/s and about 13.5153 m/s horizontal / 7.0224 m/s vertical speed.

First touchdown is rear-only at t76.9625 / s606.230, with local rear-patch slope **+0.305552 rad**, normal closing speed **9.7595 m/s**, and pitch error −0.255765 rad. The rear is on the rising side of the knuckle even while the two-patch chord is already near level or descending. Rear force reaches about **93.4 kN** at t77.0000 as shock travel reaches 0.3 m. Pitch rate moves from +0.188 rad/s just before touchdown to −5.125 rad/s by t77.0167.

The next hop begins near s607.263 with pitch rate **−4.965 rad/s** and only about 0.41 s to the next contact. It then reaches the pitch clamp before the front landing. The eventual `crash-front` at s612 is a downstream outcome of the first rear impact; it is not evidence that a stronger air aid alone is required. The existing bounded body authority cannot arrest roughly 5 rad/s in that brief hop.

## 3. Finite-horizon pitch aid is a separate control refinement

`dirt-bike-vehicle.ts:824–845` computes:

```text
wanted = (target - chassis) / max(0.12, landingIn) - pitchRate
bodyTarget = clamp(-0.9 * wanted, -1, 1)
```

`wanted` is a velocity-error-like quantity, but `bodyTarget` produces torque at `:883–884` and therefore angular acceleration. The controller does not invert the time remaining, inertia, damping, known pedal torque, or body slew. Both traces begin with nose-down momentum; the current response loses much of the available horizon before the body saturates rearward. Arena's touchdown pitch is only about +0.17 rad, despite the stable +0.43 rad predicted slope and +0.1 rad nose-up target.

A bounded physically based replacement can use the existing plant `dω/dt = τ/I - λω`. Over horizon T, define `A=(1-exp(-λT))/λ` and `B=(T-A)/λ`; the constant acceleration input reaching a target angle is `(target-angle-ω*A)/B`. Map the resulting torque demand through the existing body-torque limit, account for the actual wheel/brake torque, and preserve body slew. A terminal-rate-aware bounded solution is preferable if a constant-torque endpoint would arrive with excessive pitch rate. Keep the existing Sport body-only authority and finite manual rider motion; do not directly edit pitch or supply extra torque.

This proposal should be evaluated after lane acquisition and contact integration. It is not justification to enable AI pedal control for the ridden bike or to neutralize the wrong-lane impact in air.

## 4. Additional consistency checks and limits

**Takeoff storage convention:** ground travel uses `d.speed * cos(roadPitch)` (`dirt-bike-vehicle.ts:656–659`), while departure stores `d.speed * cos(atan(faceSlope))` (`:1530–1533`). At a knuckle the two-patch chord and last loaded tyre's slope can differ substantially. A later unit-conversion audit should make departure preserve the velocity actually transported into the transition, just as the existing touchdown fix does. Do not infer an exact impulse from adjacent 120 Hz trace rows: there are two internal substeps, changing contact loads, and a changing road chord. The source establishes the convention mismatch; a controlled single transition should establish the correction. This is not a reason to retune ballistic speed constants.

**Tyre geometry:** `predictTyreLanding()` (`:1047–1117`) uses the same horizontal axle reaches and pitch/sag vertical geometry as `writeBody()` / `vertical()` (`:1266–1269`, `:1739–1750`). Its late Arena slope prediction closely matches touchdown. There is no evidence in these traces of a forecast-versus-solver geometry mismatch that explains the missed landing zone. Full rigid-body geometry would be a wider model change, outside this task.

**Valley lowside remains a separate unresolved plant/controller boundary:** the trace starts at s343.56 with lean −0.647 rad, lean rate −0.983 rad/s, approximately 10.38 m/s speed, front support only 133 N, and **input steer +1**. Lateral remains near −7.68 m while full inward input is sustained and lean remains on the opposite side, then grows past −1.2 rad entering the berm. Thus it is not accurate to say the AI requested a persistent outward lean. The heading guard alone will not catch the initial condition because heading error is nearly zero. Lane-aware support recovery should slow/restore contact before the next berm; if opposite-side lean persists, inspect the legacy lean inverse against the actual two-tyre roll feedback. No additional claim of solver causality is established by the saved fields.

The next integration run should classify remaining failures by their **first** departure/impact event, confirm that the lap driver now acquires the surveyed corridor, and then decide whether the bounded pitch refinement or further roll analysis is still required. The existing assertions must remain intact.
