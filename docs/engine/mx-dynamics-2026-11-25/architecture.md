# Runtime architecture and observation contracts

This document describes the retained motocross engine candidate identified in the
[release record](README.md#source-identity-and-provenance). It separates physical
state, observation time and presentation sampling so that a later integration or
test does not accidentally compare different phases. Source links are relative
to this repository; individual reports provide the before/after measurements.

## 1. Scope and ownership

The dedicated player contact path applies to the ridden `mx250` and `mx450` on
motocross or supercross courses. The eligibility decision is established before
initial placement sampling and is handled explicitly during live player/AI
handoff. AI-owned calls retain their calibrated contact path; supermoto and road
classes do not enter the new player contact solver. The shared bike class exposes
additional actuator-budget fields, but its existing non-MX physical behavior is
checked independently. [24](agents/24-slope-momentum.md),
[37](agents/37-coupled-lifecycle.md), [50](agents/50-preservation-audit.md)

| Runtime owner | Responsibility introduced or corrected in this pass |
| --- | --- |
| [DirtBikeVehicle](../../../src/simulation/offroad/dirt-bike-vehicle.ts) | Select contact scope; preserve momentum during coordinate changes; integrate contact/suspension intervals; keep rotor, thermal, lifecycle and public-observation contracts coherent. |
| [MX ground solver](../../../src/simulation/offroad/mx-ground-physics.ts) | Resolve finite rotor/chassis tyre shear, supported cross-slope gravity, actuator limits, world displacement and per-contact work. |
| [Contact impulse helpers](../../../src/simulation/offroad/contact-impulse.ts) | Joint unilateral tyre-stop and forward-speed constraints in the supplied mass metric and final travel frame. |
| [Bike core](../../../src/simulation/bike.ts) | Publish exact gross assisted drive and separate brake-aid ceilings, preserving their distinct meanings. |
| [BikeVehicle recovery](../../../src/simulation/bike-vehicle.ts) | Bounded rider gathering, pushing, turning, seat approach and readiness. |
| [Offroad AI](../../../src/simulation/offroad/ai.ts) | Scoped shoulder guidance, traffic ownership and the first qualifying landing's finite settling deadline. |
| [Offroad session](../../../src/simulation/offroad/session.ts) | Use one validated complete gate assignment for physical placement and gate-wall bookkeeping. |
| [Wheel presentation](../../../src/rendering/wheel-pose.ts) | Sample phase and interior angular rate from one winding-aware interpolation curve. |
| [Session identity](../../../src/core/session-identity.ts) | Mark the changed deterministic dynamics as simulation version 41. |

These are engine and animation-data changes. The authored motorcycle/rider rig,
mesh geometry, materials, textures and venue surfaces are unchanged by this task.
Reading those existing joints in CPU tests does not modify their authored content.

## 2. Three time scales must remain distinct

A public simulation call can contain several **complete physical intervals**.
Each complete interval can contain several **vertical support stages**, including
bounded contact/full-travel events. A presentation query then samples two published
snapshots at an arbitrary interpolation fraction. Those are three different
operations; none is permission to repeat a gameplay decision or apply thermal
work twice. [33](agents/33-supported-accuracy.md),
[37](agents/37-coupled-lifecycle.md)

The complete-interval budget estimates each axle's shaft sweep from heave, pitch,
terrain travel, lateral motion and yaw. It targets at most one twelfth of the
available travel per interval and caps the count at **eight**. A distant free
flight keeps a single interval unless the local clearance/rate/gravity forecast
places contact nearby. That inexpensive forecast chooses computation effort;
the actual swept first-tyre event still owns contact detection.

Supported, non-projected player suspension uses a midpoint evaluation of the
existing constitutive equations. Contact onset and full travel can cut an interval
at a bounded local root. Four event bits and sixteen bisections per root keep this
work finite; the support loop is capped at **sixteen stages** and consumes the
remaining time. It does not recursively refine without a bound. Preview forces
must not publish a real `bottomPeak`; only visited physical states and actual
crossings contribute to the landing's severity observation.

The added supported midpoint work is bounded by 8 × 16 × 4 spring evaluations,
in addition to the existing separately bounded projection/search paths. Surveyed
runs in assignment 33 are well below that bound. This is an accuracy improvement
with a measured contact-time cost increase, not a claim of free performance. The final controlled CPU audit observes up to
four complete intervals and 80 spring evaluations on its trajectories, with the
same hard caps; historical maxima belong to their original workloads.
[52 current audit](agents/52-tooling-runtime-cost.md),
[33 numerical design and cost](agents/33-supported-accuracy.md#retained-numerical-design)

### Decision and integration ownership

| Operation | Frequency / contract |
| --- | --- |
| Absorb an external collision impulse | Once, at the first complete interval of a public call. |
| Consume a manual gear edge | Once through the existing input path; an edge during a cut is not queued for later inner intervals. |
| Choose an automatic gear | Once per public call. Player downshift requires both actual shaft and rolling road RPM below the existing threshold; the existing early dispatch keeps AI/non-player drive behavior separate. |
| Advance engine RPM, torque and ignition-cut duration | On each complete interval using its actual duration. |
| Increment the unsupported launch debounce | At most once per public call; any regained support resets it immediately. The existing three-call recognition contract remains. |
| Judge a newly formed landing | The first interval of the next public call, allowing the first call's actual compression to finish. |
| Advance fuel, heat, wear, physical rider/machine response and clocks | On every actual physical interval, with durations summing to the public duration. |
| Publish interval observations | Once, after complete intervals, using the appropriate endpoint or time-mean contract below. |
| Sample an animation between snapshots | Purely from those snapshots and interpolation fraction, with no second simulation clock or history-dependent filter. |

A shorter numerical step must not create an extra gear decision, consume another
AI lease call, judge a landing early, or spend the launch debounce multiple times.
The existing AI and supermoto single-interval paths make their lease/call ownership
explicit. [37 lifecycle checks](agents/37-coupled-lifecycle.md#lifecycle-decisions-retained-at-the-public-boundary)

## 3. Ground and flight speed are different coordinates

On the player grounded path, scalar forward speed is stored along the sampled
terrain chord. Its horizontal component is

```text
horizontalForward = dynamics.speed * cos(roadPitch)
```

Lateral `slide` is already a horizontal metres-per-second component. The terrain
patches are separated horizontally, so player road pitch is `atan2(rise, run)`.
Applying an along-ground cosine to both forward and lateral travel incorrectly
shrinks a real sideways slide. The ground solver now projects forward displacement
inside each yawed microstep and leaves the horizontal lateral component intact.
[24](agents/24-slope-momentum.md), [27](agents/27-planar-transport.md)

Sampling a new chord in `writeBody()` is a coordinate change, not a force. The
represented horizontal momentum and `mxReferenceSpeed` are preserved through that
change before real vertical/contact integration. Keeping the reference consistent
also prevents the next step from mistaking a coordinate change for a harness speed
injection and reseeding rotor momentum. [40](agents/40-ridden-flow.md)

The launch lifecycle may still be in its debounce while both actual tyre loads
are zero. That state already has free horizontal translation: the distant terrain
cannot apply ground grade, rolling resistance, bulldozing or a contact-only
speed debit. The solver uses horizontal speed and aerodynamic drag during this
unsupported window while preserving the existing launch-recognition contract.

At departure, the player retains its actual horizontal and sprung vertical
momentum. At compliant touchdown, vertical velocity is still owned by suspension;
it must not also be projected into an added forward component. Hard-stop impulses
are applied as actual momentum exchanges, and yaw-frame conversion is resolved
with the final nonnegative forward-speed bound. The engine does not set wheel
speed to rolling equality to create a free pickup impulse.
[07](agents/07-landing-momentum.md), [20](agents/20-bounded-contact.md),
[30](agents/30-final-contact-frame.md), [43](agents/43-transition-oracles.md)

## 4. Field meanings and timestamps

| Field / observation | Meaning at publication | Correct use and common error |
| --- | --- | --- |
| `forceFront`, `forceRear`, `compressionFront`, `compressionRear` | Incoming support/constitutive observations of the **final physical interval**. For an ordinary unrefined call this is the public-call incoming phase. | Use the matching incoming pose, terrain and mass. Do not label these as endpoint spring forces or average them for the next physical solve. |
| `fork`, `shock` and corresponding wheel travel | Actual final geometric stroke, clamped to the physical travel. | Drive current joint placement and snapshot travel. Do not copy incoming compression into them or add another presentation delay. |
| `dynamics.speed`, heading, slide, yaw state, rotor speed | Final physical state in its selected coordinate convention. | Use the appropriate ground/flight frame. A later terrain-coordinate re-expression can change scalar speed while preserving horizontal momentum. |
| `tires[].fx`, `tires[].fy` | Time-mean wheel-frame force components over the public call. | Each mean × public duration recovers that component's time integral. A world impulse requires each interval's own wheel frame; the final heading alone is insufficient when it changes. Do not feed the public mean back into the last physical contact. |
| `tires[].energy` | Mean slip **power**, in watts, with the established half-per-axle-alias representation. | Sum the relevant aliases and multiply by duration for work; this is not a second thermal increment. |
| `gLong` | Mean reported acceleration over the public call. | Public telemetry **and** AI/traffic acceleration prediction use this value; it is not presentation-only. |
| `dynamics.longitudinal`, private MX force/slip/brake-power fields and actuator ceilings | Final physical interval's diagnostic/control phase. | Keep distinct from public means and use the matched interval duration for work. |
| Temperatures, pressure, wear, fuel and flexible machine state | Integrated endpoint state. | Every interval has already advanced the reservoirs/modes; publication must not advance them again. |
| `machineMotion.forkRate`, `shockRate`, `steerRate` | Public endpoint difference divided by public duration. | These are outer secants even though the flexible modes advanced internally on every interval. |
| `vy` | Physical sprung heave velocity. | Use in suspension, ballistic motion and impulse accounting. |
| `body.velocity.y` | Secant between authoritative body poses over the final physical interval. | This is not generally an outer public-call secant when the call is subdivided. It includes the pose-publication convention. Do not substitute it for `vy` or differentiate a collision-depenetrated pose as if that correction were physical heave. |
| First-contact event record | State at the actual swept contact event. | Compare transition momentum there, then account separately for supported motion, drag, fuel and rotor work after the event. |

The wheel-pickup oracle illustrates why these distinctions matter. The loaded
brush solve may enter its unchanged rolling-slip band, then `writeBody()` samples
a new chord and re-expresses chassis speed without changing the rotor. Comparing
that later scalar coordinate with the pre-re-expression rotor can falsely claim
that pickup never occurred. Assignment 45 observes the force endpoint and verifies
independent angular impulse, horizontal-frame transport and work.
[45](agents/45-wheel-pickup-contract.md)

Fuel is likewise consumed over actual complete intervals. A whole-public-call
analytic drag formula using only the last interval's mass is not exact for all
previous intervals. The corrected test composes independent reciprocal-speed and
logarithmic-distance equations at the actual masses; the original numerical
precision remains. [Root drag reconciliation](reconciliation.md#final-integration-airborne-drag-and-changing-fuel-mass)

## 5. Force, actuator and work budgets

The core's `assistedDriveForce` is the **gross engine command after rider aids and
before rear-brake subtraction**. Net tyre force contains contact clipping and
opposing brake force, while intervention telemetry has display deadbands. Neither
can reconstruct the exact actuator command. The adapter passes the explicit gross
command to the rotor solver and marks its aid ownership so the solver does not
apply the same traction limiter again. Soil grip and finite wheel inertia still
limit the resulting contact. [25](agents/25-launch-traction.md),
[26](agents/26-drive-budget-review.md)

Front and rear brake-aid ceilings are separate absolute actuator limits. The
contact solver uses the tighter of the relevant supported-wheel aid ceiling and
its existing live slip-ABS request, rather than multiplying the two reductions.
An unloaded wheel can still brake its own stored angular energy. Rear engine drag
is separated from friction-brake heat, and opposing engine drive remains in the
gross rear budget exactly once. [29](agents/29-brake-budget.md)

Each wheel's shear vector remains inside its own combined friction circle.
Supported cross-slope gravity is represented as a world-fixed horizontal vector
over the interval, then projected into the changing heading as necessary. Static
brush preload may oppose that supported gravity without creating positive finite
contact work. Zero support removes the support-dependent gravity and contact
forces. This retains the reduced vertical-load convention; it does not introduce
a full three-dimensional constrained mass model. [22](agents/22-cross-slope.md)

The finite-work correction adjusts only the offending contact's vector and
rechecks the coupled finite-step outcome. It does not let one wheel's correction
consume another wheel's valid force budget. Tiny relative cancellation is handled
at floating-point roundoff scale, not by a new physical acceleration deadband.
The separate explicit yaw damper remains a distinct work port with the documented
small reversal limitation. [32](agents/32-contact-work.md)

The same physical front rotor must retain its inertia across phase boundaries.
Player flight now reads the live front-tyre inertia used by ground contact for
brake heat and chassis pitch reaction. It does not change the front angular
deceleration law, rear inertia, aerodynamic drag, or the calibrated AI/supermoto
path. The proof accounts for rotor energy, thermal work and independently measured
chassis angular impulse. [42](agents/42-rotor-energy.md)

## 6. Coupled stops and reduced compliant support

A unilateral stop must not pull the body into a contact, and one axle's impulse
must not close the other axle's already resolved contact. The solver enumerates
the small active-set system in the supplied mass/inertia metric. The forward-speed
bound is included in that system, rather than imposed as a later independent
clamp. On a yawed landing, its row is expressed in the actual final storage frame.
The final contact geometry is resampled when the frame changes.
[20](agents/20-bounded-contact.md), [30](agents/30-final-contact-frame.md)

Complementarity, impulse balance, normal non-penetration and kinetic-energy loss
are properties of **each actual impulse**, using its own mass and geometry. More
than one complete physical interval can produce another legitimate later stop.
A test must distinguish that from applying the same impact twice; an unconditional
one-impulse-per-public-call assumption is not the physical contract.
[Assignment 51](agents/51-contact-contracts.md) certifies every observed impact
this way and preserves the original numerical tolerances. Its two suites pass
29/29 cases, including exact release/hold crash replays and observer transparency.

The compliant spring model remains reduced. Its full gap derivative contains a
height-dependent pitch term that its calibrated compliant torque arm omits. The
retained numerical refinement integrates that existing model more accurately; it
does not cure the work-conjugacy mismatch. A complete redesign must reconcile
vertical support, terrain-normal reaction, longitudinal contact and equilibrium
together. The isolated arm replacement was rejected because it introduced real
riding regressions. [28](agents/28-spring-work.md),
[33](agents/33-supported-accuracy.md)

## 7. Animation, recovery and recorded state

MX wheel phase and interior displayed angular speed share one scalar sampler. It
chooses winding, limited Hermite tangents or a linear fallback once. Interior
`W.OMEGA` differentiates that same displayed phase. At exact endpoints, paused
snapshots, resets and tyre-service holds, the selected recorded angular speed is
retained. A measured endpoint is not claimed to equal every one-sided derivative
of an interior limiter. Other vehicle families retain their measured-speed
interpolation. [19](agents/19-wheel-motion-consistency.md)

Actual suspension endpoints feed the existing articulated rig. CPU tests inspect
world joint matrices, travel limits, LOD changes and out-of-order/pause queries.
Those tests preserve the existing rig geometry. Sparse publication cannot recover
every unresolved impact event exactly; the measured interior error envelope is
reported rather than hidden behind a smoothness claim.
[48](agents/48-animation-contract.md)

Recovery bounds the rider's full three-dimensional motion at 4 m/s and heading at
4 rad/s; the motorcycle push is bounded at 3 m/s and 1.6 rad/s. Gathering beside the
bike, terrain-height changes, turning and the final seat approach have explicit
costs. The distance-aware budget is diagnostic/planning state, not authority to
teleport when a timer expires. Readiness requires actual endpoint position and
heading, and the final seat target uses the same sag-aware placement convention.
[12](agents/12-remount-motion.md), [23](agents/23-remount-handoff.md)

Simulation identity 41 distinguishes the changed deterministic dynamics. This
pass leaves protocol 17 and its 331-float entrant stride intact. Native input-log,
flashback and branch tests exercise crash, recovery, remount and latent-state
continuation. The protocol's Float32 global time still has its existing
long-session precision limit; no broader clock redesign is claimed.
[36](agents/36-recording-contract.md), [50](agents/50-preservation-audit.md)

## 8. Rules for future verification

1. Identify the complete source fingerprint and test file inputs for every final
   acceptance claim. A result from an earlier checkpoint remains historical.
2. Compare an impulse, force solve, transition event or reservoir at its actual
   physical phase. Then account explicitly for subsequent motion and work.
3. Keep independent conservation/geometry/reference checks alongside behavioral
   assertions. Do not reproduce a changed integrator recurrence as its own oracle.
4. Preserve observer transparency and restore temporary method descriptors even
   on exceptions. Diagnostic hooks must not alter the native trajectory.
5. Separate a deliberately held or adverse input from a complete riding-feedback
   contract. Preserve the adverse physics case instead of changing crash thresholds
   to make an animation fixture survive.
6. Report exact scenario margins and unresolved model limits. CPU math, local
   build, hosted CI and browser/GPU acceptance are different forms of evidence.
