# Road motorcycle contact integration

The heave/pitch solver exposes two integration assumptions that the previous algebraic road-bike model could tolerate: discontinuous analytic road heights and a roll equation that assumed static vertical support. Both need explicit treatment when suspension force can disappear.

## Continuous road geometry

`Track.sample` finds a nearest centreline segment and returns height from its interpolated station. On the inside of a curved polyline, the closest projection can switch between two different stations at a segment bisector. The station change is harmless for surface classification, but a longitudinal grade turns it into a height step. A damper receiving the finite difference of that height sees a false road velocity.

A paired query along the actual Ardennes ribbon, advancing only 0.02 m each time, reproduced these differences:

| Centreline station | Inside offset | Analytic height change | Collision ribbon height change |
| ------------------ | ------------: | ---------------------: | -----------------------------: |
| 1115.34 m          |         3.0 m |              0.03347 m |                      0.00301 m |
| 2531.02 m          |         3.5 m |              0.01165 m |                      0.00061 m |
| 3130.88 m          |         3.5 m |              0.01922 m |                      0.00172 m |

These are geometry-query differences, not authored kerbs. For example, the first analytic query advanced its nearest station by 0.214 m for 0.02 m of forward travel.

The road-bike adapter now uses the same continuous collision ribbon as the car contacts. Four queries feed the current and predicted front/rear suspension heights; the two post-step contact/pose queries use the same helper. Each query casts vertically through a two-metre band centred on the preceding road-layer height. A nearby overhead deck cannot become support simply because the bike is airborne. A miss retains the venue's analytic fallback and its existing layer hint, including outside the finite circuit ribbon. This is a spatial collision query, with no temporal contact retention or force smoothing.

`tests/road-bike-contact-surface.test.ts` reproduces the three real stations above. It checks both the heights actually delivered to the production suspension solver and the published contact points against independent collision casts. Each fixture must also retain a measurable disagreement with the old analytic height, so moving the fixture to a harmless flat area cannot silently remove its coverage.

## Roll torque from actual support

Let `N = N_front + N_rear`, `Fy` be the actual combined lateral tyre force, `h` the contact-to-CG distance, and `phi` the combined lean. The contact-force contribution to roll moment about the CG is:

```text
M_roll = h * (N * sin(phi) - Fy * cos(phi))
```

Using `mass * g` instead of `N` assumes static vertical equilibrium. Near a crest, it supplies a full-weight roll moment while the tyres may have only a small fraction of their normal lateral capacity. It also makes the moment jump abruptly when the last contact disappears.

Production road bikes now use `N / mass` in that roll balance. The GP inverse controller uses the same reaction in its roll prediction, stopping-energy calculation and force inversion. Standalone and MX paths without supplied road contacts retain their existing assumptions. World gravity in the heave equation is unchanged; a freely airborne bike still receives no tyre force, and its free CG does not acquire roll torque from gravity.

`tests/gp-contact-reaction.test.ts` supplies analytically balanced forces with `Fy/N = tan(phi)` at 2%, 10%, 40%, 100% and 150% of static weight. Both the direct-bar plant and assisted inverse must preserve the exact lean. The ordinary-road counterpart is in `tests/road-bike-control-reserve.test.ts`. The production crest/drop tests continue to verify the independent gravity/downforce bound, zero airborne drive/braking/lateral force, momentum, landing, and timestep consistency.

## Horizontal momentum through yaw and contact transitions

The GP patch solve carries forward and lateral velocity in a yawing body frame. Advancing only the lateral equation `v_side′ = a_side - yawRate * v_forward` leaves out the reciprocal forward term and adds world kinetic energy during a slide. The real Ardennes reproduction reached approximately 16 m/s forward and 13 m/s sideways with the throttle shut, so its reported speed rose to approximately 21 m/s without the corresponding force work.

For production GP contacts, both velocity components now receive the force impulse and then rotate together through the same yaw increment used by the body pose. The steered front contact contributes `Fx*cos(delta) - Fy*sin(delta)` longitudinally and `Fx*sin(delta) + Fy*cos(delta)` laterally. Since the adapter has already applied its front `Fx`, the patch solve adds only the longitudinal projection difference. Yaw is clipped before that frame rotation; the incident velocity limits can remove energy but cannot create it. Legacy standalone callers retain their previous opt-out path, and free flight retains its exact inertial rotation.

`tests/gp-contact-momentum.test.ts` checks world momentum with both contacts or rear-only support under zero horizontal force, exact impulse work with front braking and lateral force, the steered-force projection, matching pose/velocity yaw, and dissipative numerical guards. The rear-only production-contact test now checks both components of the exact paired rotation rather than the former one-component Euler formula.

## Steering and braking requests

The GP traction reserve retains the original requested roll effort even when present front/rear support clips the immediately achievable target. Otherwise a drive-induced light front can clip away the very request that should ask traction control to restore steering load.

The GP path follower converts desired curvature with the same actual normal reaction used by its roll plant. At a fixed ratio of lateral to normal force it therefore requests the same combined-CG lean during both crest unloading and additional support. `tests/gp-path-reaction.test.ts` covers this correspondence.

The GP AI also reserves front load before opening its throttle during a path correction. Its extra reserve is the bounded lateral correction calculated by the existing path controller in the current step; it is not a fixed permanent penalty on cornering acceleration. The normal throttle/engine/traction path still determines the actual transmitted force.

Steering and brake-capacity planning use the shared `bikePreviewDistance` derivation. The brake plan includes the same future curve the lean follower already requests, plus the lever's mean half-rise travel. `tests/gp-control-preview.test.ts` observes the actual production sampler calls at three speeds and checks that their only difference is that pedal-response distance.

The approach envelope accepts optional route gradients. Positive gradient is uphill; the envelope converts `dy/ds` to `sin(angle)` before accounting for gravity's contribution to stopping. Default and zero-gradient callers remain numerically identical. A GP feed-forward brake request converts the planned **net** deceleration to tyre-force deceleration by subtracting the existing `g * slope` contribution. The dynamics plant still applies slope gravity exactly once. `tests/ai-braking-grade.test.ts` checks the flat, uphill and downhill constant-gradient stopping-energy solution and the matched lever request.

The motorcycle approach profile additionally limits the friction-circle result by the normal load that must remain at the rear to carry planned cornering force. Under braking, `N_rear = N_rear_static - Fx*h/L`; preserving the rear lateral-force reserve therefore gives a linear braking bound that a generic friction ellipse misses. GP and ordinary road riders share this geometry-based bound, with their own existing reserve and rider-offset conventions.

These corrections do not establish measured real-bike suspension calibration or a complete spatial motorcycle model. The heave/pitch approximation still has point contacts and no unsprung tyre masses. Real circuit starts, downhill hairpins, mixed-class races, pit/recovery and open-world riding remain integration gates in addition to the isolated force and geometry invariants.
