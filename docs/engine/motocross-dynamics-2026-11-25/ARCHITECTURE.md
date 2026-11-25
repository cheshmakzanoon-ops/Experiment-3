# Motocross dynamics and motion architecture

This document describes the integrated engine source prepared for publication in this task: source/test/benchmark Git tree **b7f379a7aaea0f807b5623b2c981190c6d1a3a17**. The task changes numerical integration, contact resolution, controller motion, recorded reconstruction and camera observation. Authored motorcycles, characters, meshes, materials, environments, terrain, courses and vehicle specifications remain unchanged. The independent [protected-scope audit](agents/51-protected-scope.md) verifies that boundary against the original task baseline.

The engine remains a reduced game simulation. Its stronger numerical invariants and recorded motion contracts are useful improvements in physical consistency; they are not a claim of laboratory-calibrated motorcycles or human biomechanics. [Build provenance](BUILD_PROVENANCE.md) identifies the tested source and artifact. The acceptance reports own their observed results; an earlier assignment's experiment is not automatically a measurement of the final integrated build.

## 1. State ownership and module map

The fixed-step vehicle owns physical and controller state. Snapshot publication records that state. Presentation reconstructs a requested instant from recorded values, and the camera observes the presented pose on its presentation clock. A second render-time suspension, rider or foot simulation would break this ownership.

The following are the **18 changed or new runtime paths**. Paths are relative to the repository root.

| Runtime module | Responsibility and boundary |
| --- | --- |
| [src/simulation/offroad/dirt-bike-vehicle.ts](../../../src/simulation/offroad/dirt-bike-vehicle.ts) | Owns motocross heave/pitch, physical contact transitions, automatic posture integration, wheel telemetry, placement/recovery and contact observations. Samples existing terrain; does not define it. |
| [src/simulation/offroad/contact-impulse.ts](../../../src/simulation/offroad/contact-impulse.ts) | Pure coupled unilateral hard-stop solve in generalized velocity coordinates. The adapter owns application of its impulses. |
| [src/simulation/offroad/air-drag.ts](../../../src/simulation/offroad/air-drag.ts) | Pure exact forward speed/distance step for constant-coefficient quadratic drag. |
| [src/simulation/offroad/mx-ground-physics.ts](../../../src/simulation/offroad/mx-ground-physics.ts) | Existing soil/tyre solver with passive rotation of its forward/lateral velocity coordinates. |
| [src/simulation/offroad/mx-rider-posture.ts](../../../src/simulation/offroad/mx-rider-posture.ts) | Smooth stance/dab targets and fixed-step critically damped automatic posture, with measured derivatives. |
| [src/simulation/offroad/rider-weight.ts](../../../src/simulation/offroad/rider-weight.ts) | Existing finite manual stroke, plus a differentiable local blend with automatic body pose. |
| [src/simulation/offroad/mx-gear-stroke.ts](../../../src/simulation/offroad/mx-gear-stroke.ts) | Accepted-shift state and pure, bounded selector/boot trajectory evaluation from recorded initial conditions. |
| [src/simulation/offroad/ai.ts](../../../src/simulation/offroad/ai.ts) | Narrow continuity repair to the existing supercross shoulder guard after posture changes. |
| [src/simulation/protocol.ts](../../../src/simulation/protocol.ts) | Fixed layout, eligibility predicates and named optional motion offsets. |
| [src/simulation/wheel-contact-state.ts](../../../src/simulation/wheel-contact-state.ts) | Clears and writes the selected contact-tail contract; serializes controller derivatives and shift initial conditions. |
| [src/core/session-identity.ts](../../../src/core/session-identity.ts) | Simulation identity 40, separating changed deterministic physics from version 39. |
| [src/rendering/offroad/mx-machine-pose.ts](../../../src/rendering/offroad/mx-machine-pose.ts) | Bounded measured joint/fender reconstruction, optional-block validation and synchronized presented wheel fields. |
| [src/rendering/offroad/mx-rider-pose.ts](../../../src/rendering/offroad/mx-rider-pose.ts) | Pure bounded reconstruction of standing, dab and body from recorded positions and tangents. |
| [src/rendering/offroad/mx-foot-pose.ts](../../../src/rendering/offroad/mx-foot-pose.ts) | Reconstructs accepted foot events; validates continuity and uses complete measured poses at unsafe boundaries. |
| [src/rendering/snapshot-interpolation.ts](../../../src/rendering/snapshot-interpolation.ts) | Routes eligible offroad fields through shared pose readers and existing lifecycle gates. |
| [src/rendering/frame-state.ts](../../../src/rendering/frame-state.ts) | Builds the PresentedFrame copy used by camera/effect consumers; sanitizes optional blocks at endpoints and held boundaries. |
| [src/rendering/bike.ts](../../../src/rendering/bike.ts) | Only the import adjustments and three foot-field sampler calls change. All model construction and existing rig definitions remain identical. |
| [src/rendering/offroad/chase-camera.ts](../../../src/rendering/offroad/chase-camera.ts) | Integrates measured target ramps and follows the current recorded flight origin. |

The unchanged MxMachineMotion controller continues to own measured elastic fender/chain motion. The unchanged model code poses the existing rig from these inputs. Reading or testing its matrices is not authorization to change its geometry.

### Eligibility is explicit

Most new physical behavior requires both a motocross-class machine and a motocross or supercross course. The player first-contact split and local supported refinement have the narrower ridden-player gate. AI and riderless contact transitions keep their established paths; eligible MX flight translation still receives the analytic drag/gravity corrections.

Some intentionally shared boundaries have wider scope. Motocross placement synchronizes tyre telemetry even in accepted road-practice sessions, and ridden knobby bikes publish their foot controls and optional event state. The simulation-version increment is global. Consequently, “all non-MX bytes are unchanged” is not the compatibility contract. The [scope-isolation report](agents/30-scope-isolation.md) distinguishes exact surveyed non-MX traces from those visible MX road-practice differences.

## 2. Contact state has more than one timestamp

Incoming force state and outgoing displayed suspension travel describe different instants. They must remain separate:

| State | Meaning | Required consumer behavior |
| --- | --- | --- |
| Incoming compression and gap-closing rate | Geometry and relative motion at the start of the supported solve | Feed the spring, damper and stop laws. |
| forceFront/forceRear and compressionFront/compressionRear | Outer incoming force/compression observations | Retain their existing physical/telemetry interpretation even when internal refinement occurs. |
| Contact-event record | First supported contact, before its remainder is integrated | Record impact speed, pitch, terrain normal, distance and time coherently. |
| fork/shock at publication | Travel implied by the final chassis heave/pitch and final sampled contact geometry | Match the same timestamp as the published chassis. |
| PresentedFrame travel and wheel length | Reconstructed values at the requested display instant | Match the visible rig, camera and effects without integrating new physics. |

Previously a separate 20 ms filter delayed the visible fork/shock while the chassis already described the new endpoint. Eligible ridden MX now derives outgoing travel directly from its final physical pose, within the existing travel bounds. Snapshot reconstruction supplies intermediate visual motion. Replacing the incoming force compression with this outgoing travel would silently change forces and is prohibited by the contract.

The [dynamic suspension tests](../../../tests/motocross-dynamic-suspension.test.ts) independently check the existing spring/damper equation as well as endpoint geometry. A pose improvement must not be accepted by weakening that force oracle.

## 3. Coupled suspension hard stops

The two bottomed axles constrain one body. Solving the front and then the rear independently can make the first axle close again through pitch. The MX path therefore solves both active contacts from the same incoming velocity.

The generalized velocity is forward, lateral, vertical, pitch rate and yaw rate. Each contact uses the height-gradient row

$$
J=[-g,\,-g_\perp,\,1,\,\ell,\,-a_\psi],
\qquad
M=\mathrm{diag}(m,m,m,I_p,I_\psi).
$$

The helper considers free, front-only, rear-only and simultaneous active sets of the 2×2 mobility matrix \(JM^{-1}J^T\). Impulses are nonnegative. The contact row is not a unit normal: its multiplier is the vertical-component impulse, and every linear/angular change must use that same row and matching mass/inertia. The simultaneous solve uses a Gram determinant expressed through squared minors and sum/difference coordinates to avoid cancellation near redundant contacts.

Both returned impulses are applied to the common incoming body state. No restitution or bias velocity is added by the impulse solve. Its inelastic passivity applies to this velocity operation; the adapter's separate position projection, gravity, compliant suspension and speed publication are outside that energy identity. The independent [physics review](agents/43-physics-review.md) compares this solve with a separately constructed mass-weighted projection.

A further representation limit remains: the adapter does not support unrestricted reverse travel. Clamping a mathematically valid backward post-impact speed can restore contact closure even though the coupled helper closed it. That clipping is dissipative. The [consumer integration report](agents/26-stop-integration.md) preserves the exact counterexample instead of extending the helper's guarantee through the separate clamp.

## 4. Flight and first-contact timing

### Exact translation within the declared model

For eligible MX with neither spring supporting the chassis, gravity uses the exact constant-acceleration displacement:

$$
y_1=y_0+v_{y0}\Delta t-\tfrac12g\Delta t^2,
\qquad
v_{y1}=v_{y0}-g\Delta t.
$$

This includes the unsupported takeoff-debounce span and riderless free flight. Supported springs retain their force-driven integration.

For nonnegative forward speed and constant \(k=\mathrm{drag}/m\), the new helper evaluates

$$
v_1=\frac{v_0}{1+kv_0\Delta t},
\qquad
s=\frac{\log(1+kv_0\Delta t)}{k}.
$$

Its implementation uses log1p and the continuous zero-drag limit. Speed and distance therefore refer to the same interval. Prediction and authoritative MX flight use the same translational law. The helper validates finite, nonnegative physical inputs; it does not promise sensible arithmetic near arbitrary JavaScript overflow limits. The existing sampled, damped angular rule remains approximate.

Legacy non-MX translation preserves its previous endpoint stepping **and multiplication order**. Reassociating floating-point products previously caused an observable deterministic divergence; [assignment 30](agents/30-scope-isolation.md) documents the correction.

### A ridden player's contact split

At the beginning of an airborne player step, the adapter retains the planar position, heading/yaw, forward/lateral speed and manual rider-stroke state. The contact probe evaluates the corresponding free arc at a candidate time, including the existing pitch rule and sampled terrain under both tyres.

An initially overlapping tyre is supported only if the existing non-tensile spring/damper/stop law supplies positive support. This avoids treating a separating takeoff overlap as a new landing. Otherwise each tyre must have a positive initial gap and a nonpositive final gap. Its inside endpoint is refined with **32 bisections**, and the earliest eligible axle event is selected. No new contact epsilon or landing-severity threshold chooses the result.

The adapter then:

1. Advances free state to that event and samples both contact patches there.
2. Gives vertical() only the supported remainder, including a valid zero-length remainder for exact endpoint contact.
3. Records incoming impact state before support changes it.
4. Completes the remaining planar/yaw motion and samples the final terrain.
5. Preserves resolved horizontal world velocity when that final sample changes the along-slope speed coordinate.

The last point prevents a terrain-basis change from becoming a momentum change. Rotor reaction is apportioned over the free and supported spans; the contact split must not update the rotors, pickup or hard-stop impulse a second time. The actual touchdown clears the old takeoff-debounce history while preserving the existing three-sample requirement for a later departure.

Landing prediction remains an observation. It evaluates a coherent beginning-of-step pose, distinguishes closing from separating overlap and preserves forecast-clock phase across subdivisions. A forecast must not apply physical support. [Contact timing](agents/25-contact-time.md), [landing observation](agents/19-landing-observability.md) and the independent [boundary review](agents/43-physics-review.md) separate those responsibilities.

**Coverage limit:** this is an endpoint-bracketed search. A sufficiently thin interior feature could be entered and exited while both endpoint gaps remain positive. The method is not a general continuous collision sweep over arbitrary terrain.

## 5. Bounded supported integration and stop observation

A coarse supported step can cross a stiff stop before refreshing its force. The ridden-player path estimates required local resolution from incoming shaft sweep and, near full travel, the existing stop stiffness:

- Predicted shaft sweep per stage is limited toward one sixth of that axle's travel.
- Estimated stiff-stop modal phase is limited toward 0.3 radians.
- Work is capped at **16 internal stages**.

Each stage refreshes the existing spring, digressive damper, lossy stop and calibrated pitch moment from the current internal heave/pitch. The stop observer records a full-travel crossing in each resulting interval before a later state transition can discard it. Observing a crossing does not apply an additional force or impact.

The stages hold sampled terrain patches and outer inputs fixed. They do not rerun horizontal soil forces, rider controllers, terrain sampling or the outer landing-state machine. Ordinary low-rate support, free flight, projected hard-stop impulses and paths outside the player gate retain one advance. Refinement is therefore bounded local accuracy work, not a universal error-controlled integrator. The original spring law and landing/crash limits remain intact; [assignment 28](agents/28-supported-accuracy.md) contains convergence evidence and the explicit coarse-step oracle correction.

## 6. Ground velocity coordinates and physical steering

Forward and lateral velocity are components in the bike's rotating heading frame. A change of coordinates alone must not add kinetic energy. The ground solver first applies existing physical forward/lateral forces, then rotates these components orthogonally through the same yaw increment applied to heading.

This replaces explicit Euler cross terms that could increase energy during unloaded yaw. Supported camber steering remains a separate physical turning contribution. The forward-only clamp can dissipate energy and still limits reverse-motion interpretation. The [passivity regression](../../../tests/motocross-ground-passivity.test.ts) isolates coordinate rotation from supported tyre work; it does not claim whole-vehicle conservation.

## 7. Automatic posture and finite manual body motion

Standing, dab and automatic body demand use exact critically damped responses to held targets. Their state consists of position and velocity. Target changes preserve both, while smooth speed/lean/climb maps prevent small input changes from toggling full stance commands.

The response frequencies are explicit game-control values: **17, 28 and 18 rad/s** for standing, dab and body. They are not measured physiology. Standing is bounded to 0…1; dab and body to −1…1. Reset starts from the observed bounded pose at rest. Nonpositive or nonfinite durations hold the state.

Ownership within a fixed step is important. On the ground, anticipation advances stance, dab and body once. In flight, anticipation advances only stance/dab; the flight aid advances the automatic body later in the same step. Calling the combined controller twice or resetting the body from the stance path would manufacture a different response.

The independent manual RiderWeight stroke retains its existing finite physical displacement and airborne momentum exchange. Only its pose blend changes locally within **±0.15** manual displacement. That join is C1: at neutral its manual derivative is \(1-\mathrm{automatic}^2\), and its correction and first derivative vanish at both join edges. Outside the join, the established manual authority is unchanged. The published body tangent includes both manual and automatic rates through the exact partial derivatives of that same pose mapping. This does not make the mapping C2 or establish anatomical acceleration limits. See [rider blending](agents/21-rider-blending.md) and the [independent motion review](agents/44-motion-review.md).

## 8. Selector and boot motion from accepted commands

Gearbox acceptance remains the existing gameplay decision. An accepted change samples the current selector angle, boot cover/clearance and their rates, stores that initial condition, advances a wrapping event counter and begins the new trajectory on simulation time.

The three channels must share the event boundary and coordinated route. In particular, a covered boot must clear the outside of the sleeve before moving across it, then close into contact. Position continuity alone does not establish safe contact ordering. The isolated canonical envelopes still complete within their original 260 ms route; legal rapid interruption preserves the observed incoming position and velocity.

Near a travel extremum, compressing an entire handoff into the small remaining tangent interval caused excessive rates and poor Float32 reconstruction. The final construction keeps distant-target movement on the original handoff duration \(T\). When necessary, a zero-initial-rate base carries that movement and the incoming tangent contributes only

$$
q(t)=v\,t(1-t/\tau)^2,\quad
0\le t\le\tau,\qquad
\tau=\min(T,\,0.99\cdot3r/|v|),
$$

where \(r\) is available travel in the incoming rate's direction. The correction is zero afterward. It starts at the measured velocity and joins with zero position/rate at \(\tau\); its rate magnitude never exceeds \(|v|\). Its restricted Bézier control displacement is bounded by the available travel. Shrinking the tangent interval therefore does not accelerate the distant target through its whole stroke. Ordinary unrestricted handoffs and isolated route evaluations retain their established evaluation paths.

The pure sampleMxGearChannel evaluator is shared by the fixed-step controller and replay reader. It has no wall clock, playback history or mutable cache. [Assignment 44](agents/44-motion-review.md) documents the mathematical bound, ordinary-clock reproductions and actual-writer Float32 checks.

## 9. Snapshot layout and compatibility

The layout remains **protocol 17**, **24 header floats**, **331 floats per entrant**. The contact tail begins at entrant-relative offset **298** and occupies **33 floats**, ending at 330. Simulation identity changes from **39 to 40** because deterministic physics changed; this is separate from the unchanged numeric layout.

The writer clears all 33 values before selecting the vehicle contract. Cars use their contact mask; a ridden sprung road motorcycle uses the distinct tag **16**. The MX interpretation requires a zero mask, a knobby vehicle and the correct rider state. An optional marker must never be mistaken for a car contact or road-bike tag.

| Tail offset | Entrant offset | Meaning |
| --- | ---: | --- |
| +0 | 298 | Contact contract selector: MX zero; car mask or road-bike tag elsewhere. |
| +1…+3 | 299…301 | Measured selector angle, boot cover and clearance. |
| +4 | 302 | Recorded machine-motion marker. |
| +5…+7 | 303…305 | Fork, shock and steering rates. |
| +8…+11 | 306…309 | Front flex/rate, rear flex/rate. |
| +12 | 310 | Signed chain pull. |
| +13…+16 | 311…314 | Existing remount-gait marker, world X/Z velocity and phase. |
| +17 | 315 | Recorded posture marker. |
| +18…+20 | 316…318 | Standing, dab and blended body rates. |
| +21 | 319 | Recorded accepted-foot-trajectory marker. |
| +22 | 320 | Event counter modulo \(2^{24}\), advanced by acceptance and reset. |
| +23…+24 | 321…322 | Age since acceptance and direction. |
| +25…+27 | 323…325 | Initial selector angle, cover and clearance. |
| +28…+30 | 326…328 | Corresponding initial rates. |
| +31…+32 | 329…330 | Float32 high part of adapter clock and its residual low part. |

Posture positions remain in the existing offroad STANDING, DAB and BODY fields. Rates use the corresponding position units per simulation second. Fork/shock use metres; selector/steering use radians; normalized controls and flex keep their established units.

A zero marker retains legacy interpretation. The accepted-foot seed describes an executable trajectory, so **a future incompatible change to its evaluator requires an explicit decoder compatibility decision even if the stride stays 331**. Reusing the marker with silently changed meaning would reinterpret recorded events. The [protocol review](agents/45-protocol-review.md) covers these boundaries.

The split local clock preserves foot event timing at a supplied interpolation fraction. It does not replace the global Float32 H.TIME field. When adjacent header times quantize to the same value, the existing whole-pose hold still applies. No claim of indefinitely precise long-session replay timing follows from local foot precision.

## 10. Reconstruction, fallback and source immutability

All readers reconstruct from recorded state. The source worker/replay arrays remain unchanged; sanitization applies only to a presented copy.

### Suspension, steering and elastic motion

Measured fork/shock/steer tangents drive bounded Hermite reconstruction. Opposed rates can represent a real interior reversal even when endpoint positions are nearly equal. That reversal is admitted only when the rates are consistent with interval displacement, the lifecycle/contact observations are continuous and the complete equivalent Bézier control hull stays inside mechanical travel. Contact edges or incompatible tangents retain the conservative existing interpolation.

Optional machine motion is a complete extension. Every motion field must be finite, and both flex endpoints must lie within the controller's existing **−0.32…1** envelope. A malformed marked block falls back as a whole at interpolated, endpoint, pause and held-reset samples. The primary chassis is not rewritten. This prevents an arbitrary finite morph value from escaping endpoint validation; [assignment 47](agents/47-replay-boundaries.md) includes actual-rig replay cases.

PresentedFrame uses the same measured joint reconstruction as the visible motorcycle. It updates related wheel compression, length and front steering coherently: length plus compression retains the worker's fixed rest-length relationship. Camera/effect consumers must not reconstruct a different suspension pose independently.

### Posture

Marked standing/dab/body pairs use bounded Hermite curves over positive intervals no longer than **125 ms**. Their control points are clamped within the physical normalized pose range, rather than adding a second spring. Existing rider and presentation lifecycle gates hold or select endpoints through crash, remount, placement and vehicle changes.

Body reconstruction additionally rejects a changed airborne state, restarted flight clock or hidden grounded hop that would spread a new automatic-body tangent across the wrong interval. Invalid optional tangents fall back to the established position interpolation. Fully unmarked posture retains the legacy behavior.

### Accepted foot events

The foot reader validates event range/direction, finite seed values and rates, seed-position bounds, nonnegative age, split clocks and agreement between the reconstructed seed and measured endpoint. Equal events require the same initial condition and coherent age advance. One newly accepted event can be reconstructed across the interval only if its initial pose/rate joins the previous event. Vehicle changes, crashes, clock rewinds, missing events or intervals over 125 ms reject that inferred continuous route.

For an unsafe marked interval, all three channels use the same nearer complete measured endpoint, with the switch at fraction 0.5. This preserves a real coordinated pose instead of inventing a route through the sleeve. Fully unmarked pairs keep their legacy linear control behavior, including neutral inactive endpoints.

Interior PresentedFrame samples clear the copied twelve-field foot-trajectory metadata after writing their reconstructed three positions. Their moved display pose no longer represents the original measured seed age and must not masquerade as a new authoritative snapshot. Exact selected endpoints preserve valid source metadata.

These readers are independent of display call order. The final [cadence acceptance](agents/54-final-cadence.md) exercises forward/reverse samples, repeated pause, fractional times and high/mid/far detail changes using actual rigs; it measures CPU transforms, not hardware frame rate.

## 11. Camera observation and lifecycle

The motocross chase camera receives presentation time. It integrates continuous measured heading, roll and gaze targets with an exact first-order response to a linear target ramp, using stable exponential expressions for small intervals. Heading is unwrapped across the angle boundary. Existing catch-up ranges and discontinuity handling select the step/snap behavior when a target jump cannot reasonably be treated as a measured continuous ramp.

The airborne following direction comes from world travel velocity when available, keeping a chassis whip separate from its flight path. Takeoff and touchdown edge timing retains the recorded flight-duration split. A positive-time airborne observation now assigns the **current recorded AIR_TIME**, rather than keeping a previous maximum. A hidden landing/relaunch can restart that timer between two airborne samples; retaining the old maximum would qualify a tiny new hop for a previous flight's landing kick.

This timer correction retains continuous camera position, heading, gaze and existing recoil. It cannot reconstruct the time or severity of every impact missing between observations. Held-time redraws consume no new history. Motion disable clears the affected motion immediately, including a paused redraw. Existing camera-mode, scene/session, seek/rewind and long-gap reset ownership remains with the renderer and CameraClock.

The [camera lifecycle review](agents/46-camera-lifecycle.md) distinguishes exact affine-target response from sampling error on curved terrain, nonlinear clamps and hidden events. The dense rig cadence benchmark does not certify this separate stateful camera path.

## 12. Recovery and narrow AI integration

Placement and remount must establish a new transient contact history. The adapter clears pending landing judgments, settling/bottom observations, forecast timing, front-light/nose-torque history and stale brake-power observations. It seeds posture from the observed settled pose, resets finite manual momentum and immediately publishes wheel spin/load/compression consistent with that state. Tyre phase, wear, heat and intended cumulative history survive; reset is not an extra tyre integration step.

After remount movement to another patch, the final position is sampled before equilibrium is rebuilt. A queued old landing must not crash the newly settled bike, and a previous airborne rotor speed must not return for one snapshot. The [reset tests](../../../tests/motocross-contact-reset.test.ts) exercise those actual consumers.

Finite posture also exposed a supercross AI policy discontinuity: front load could recover while the predicted outward path remained unsafe, disabling an existing shoulder guard above 0.38 body weight. The repair removes only that binary load eligibility check. The existing swept-path geometry, support-scaled steering/pedal formulas, speed/race/launch gates and AI control-model scope remain. It does not increase tyre grip or relax crash limits. See [the causal grid repair](agents/40-grid-regression.md) and [scope audit](agents/51-protected-scope.md).

## 13. Limits that future work must preserve visibly

The following remain deliberate, documented limits rather than hidden claims of a complete physical model:

| Limit | Implication for a future change |
| --- | --- |
| Reduced spring geometry | The compliant pitch moment omits a geometric offset term present in the gap derivative. The spring-work diagnostic finds nonzero closed-loop elastic work. Adding that term alone disrupted calibrated jumps; a correction needs coordinated equilibrium, geometry, load-transfer and aid treatment. See [assignment 18](agents/18-spring-geometry.md). |
| Forward-only speed | Clamping a reverse post-impact component can restore normal closure. A complete fix requires a travel-representation decision, not a stronger claim about the coupled solver. |
| Endpoint-bracketed terrain contact | Interior features without endpoint sign change are not guaranteed to be detected. |
| Bounded local refinement | Sixteen stages bound cost, not all integration error; terrain and outer controls remain fixed within the supported advance. |
| Sampled angular/contact model | Exact free translation does not make angular dynamics or total mechanical energy exact. Reduced contact geometry is not identical to every visible mesh location on steep or discontinuous terrain. |
| Global Float32 time | Precise foot age does not remove repeated global header times or whole-scene holds in very long sessions. |
| Evidence scope | Analytical checks, real simulation traces, CPU rig matrices and a software-WebGL browser journey prove different properties. None alone establishes physical-GPU FPS, subjective smoothness on target devices or real-bike calibration. |

## 14. Regression contracts for continued development

A future engine change should select tests for the contract it changes, preserve their physical meaning and identify the source actually measured.

| Contract | Durable verification entry points |
| --- | --- |
| Coupled impact and coordinate passivity | motocross-coupled-stops, motocross-hard-stop-integration, motocross-ground-passivity tests; independent review [43](agents/43-physics-review.md). |
| Exact flight/contact and supported accuracy | motocross-air-drag, motocross-ballistic-timing, motocross-contact-time-coherence, motocross-supported-convergence, motocross-landing-observability and motocross-dynamic-suspension tests. |
| Finite controls and real mesh contact | motocross-posture-dynamics, motocross-rider-blending, motocross-shift-continuity, motocross-shift-extrema, motocross-interrupted-shift-contact and motocross-foot-reconstruction tests. |
| Recorded state and lifecycle | motocross-posture-transport, motocross-body-transport, motocross-motion-boundary, motocross-foot-boundary, motocross-dynamics-replay, wheel-contact-recording and session-identity tests. |
| Camera | motocross-camera-ramp, motocross-camera-motion-ramp, motocross-camera-flight-origin and existing camera/clock suites. |
| Production trajectories and presentation | Existing offroad race/calibration runners, player-dynamics benchmark, enhanced display-cadence benchmark and native gameplay journey. |
| Protected scope | [Executable protected-source audit](evidence/51-protected-scope.py), with explicit allowed runtime paths and exact inverse checks for bike.ts and the narrow AI patch. |

The final combined acceptance in [assignment 49](agents/49-final-units.md) and final cadence result in [assignment 54](agents/54-final-cadence.md) identify their unchanged inputs. Native and race acceptance must be read from their own final receipts. Do not combine repeated runs, local diagnostic samples and unit cases into an inflated test total, or replace a source-specific failure with an earlier successful build.
