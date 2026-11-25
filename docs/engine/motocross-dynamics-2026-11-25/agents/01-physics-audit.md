# Wave 1 / Agent 01 — motocross physics audit

Baseline: `b527a7e0`. Scope: `dirt-bike-vehicle.ts`, `mx-ground-physics.ts`, `contact-impulse.ts` and physics tests. No production changes. No models, materials, tracks or environments changed. No applicable repository `AGENTS.md` was present.

## P1: coupled hard stops are solved only once, in axle order

`DirtBikeVehicle.vertical()` visits front then rear bottomed contacts and applies `hardStopImpulse()` independently. Because the pitch arms oppose one another, the rear impulse can make the already-resolved front tyre close into the ground again. `tests/motocross-contact-impulse.test.ts` proves single-contact energy/closing-speed behavior but does not cover a simultaneous two-contact stop.

A direct production-helper reproduction uses mass 184 kg, pitch inertia 43 kg m², flat ground, front/rear levers +0.82/−0.66 m, initial vertical speed −6 m/s and zero pitch rate. The current front-then-rear pass gives:

- Front impulse 284.73815030565925 N s; rear impulse 516.3013058407805 N s.
- Final vertical speed −1.6465246948563057 m/s and pitch rate −2.49473438614592 rad/s.
- Rear closing speed approximately zero; **front closing speed 3.69220689149596 m/s**.
- Remaining kinetic energy 383.2255511454973 J from initial 3312 J, which the following spring/contact step must absorb. It is not energy creation, but the residual depends on axle order and can feed pitch chatter on a hard flat landing.

Recommended implementation: a two-contact unilateral effective-mass solve using the same heave/forward/side/pitch/yaw Jacobians, with active-set fallback to one loaded axle. Keep the single-contact helper and ordinary compliant stroke. Test simultaneous flat/banked stops, reversed order, one separating end, positive impulses, no final closing speed at either active contact, energy dissipation, and an actual MX250/MX450 hard landing. Assign a contact solver owner and central integration owner for `vertical()`.

## P2: spring torque and spring travel use different pitch Jacobians

`vertical()` defines free-end heights as `cgY + fa*sin(pitch) - HF*cos(pitch)` and `cgY - ra*sin(pitch) - HR*cos(pitch)`. Its damper rates and hard-stop impulse levers correctly differentiate these to `fa*cos + HF*sin` and `-ra*cos + HR*sin`. However, the spring-force pitch torque remains `(FF*fa - FR*ra)*cos`. The omitted term is `(FF*HF + FR*HR)*sin(pitch)`.

This is a mathematical consistency finding rather than a measured gameplay regression. A generalized force consistent with the existing compression coordinate must reproduce the derivative of stored spring energy; the discrepancy grows on steep ramps/wheelies. Recommended next step: independently verify virtual work over nonzero pitch before changing calibration. Any implementation must review static slope equilibrium and existing jump/AI surveys; do not silently substitute a different geometry model. Assign suspension specialist, with `DirtBikeVehicle` integration centralized.

## P2: placement resets leave pending landing/control history alive

`place()` and `placeFree()` call `settle()`. That method clears airborne state, yaw, wheel pickup and motion filters, but does not clear `pendingLanding`, `settleTime`, `bottomPeak`, `bottom`, `frontLight`, `noseTorque`, `faceSlope`, `predictClock`, `landingIn` or the automatic posture. `step()` calls `judgeLanding(this.pendingLanding)` without requiring that the record belongs to the currently placed run. A reposition within the quarter-second settlement window can therefore carry the previous landing judgement/animation pulse into the new settled bike. Existing placement test verifies sag only.

Recommended reproduction: complete a bottoming touchdown, place again before settlement ends, advance one tick and assert no old landing crash, bottom pulse, wheelie age or prediction is consumed. Define which public historical fields (`lastLanding`, total landings, clock) intentionally persist; clear transient state without deleting history. Assign reset/lifecycle owner.

## Existing strengths to preserve

The current ground solver already conserves longitudinal wheel/chassis impulse, bounds both tyres by combined friction circles, keeps unloaded patches force-free, uses 720 Hz microsteps and exposes averaged force/heat ports. Its tests cover locked wheels, contact pickup, low-speed lateral settling, per-axle grip and coarse/fine contact integration. Avoid replacing it wholesale or changing road/GP/AI tuning while fixing the concrete contact and transition gaps above.
