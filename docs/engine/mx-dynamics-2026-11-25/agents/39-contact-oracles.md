# Assignment 39 — contact-event and publication oracles

Wave 7; 25 November 2026. This assignment independently reviewed the five
reported contact/landing failures after assignment 33 introduced complete
physical intervals inside a public update. It changes three test files and
this report. **No production engine code, numerical tolerance, physical
threshold, model, character asset, authored terrain, or environment was changed.**

## Disposition

The five reported failures compared values from different physical phases.
The owned suites now pass **30/30 tests**, including two new observation
transparency cases. A final focused run with the unchanged supported-convergence
suite passes **41/41 tests in four files**. The original convergence tolerances
and crash outcomes remain intact.

This is **not** a declaration that the full engine suite passes. A related
five-file run passed 48/54 and exposed **six further old-integrator assertions**
in `motocross-contact-time-coherence.test.ts`. Root assigned their independent
review to assignment 41; those assertions remain unchanged here. The exact
pending checks appear below.

## Why the observations had to move

A public update can now contain several complete tyre/chassis/thermal
intervals. The first physical interval may locate a swept touchdown, integrate
its supported remainder and rotate the tyre frame. Later intervals then apply
real ground forces, rotor pickup and suspension motion. Their final state is
not the state immediately after the first frame conversion.

Likewise, physical incoming force/compression channels describe the incoming
state of the **last** physical interval. First-contact axle identity and
severity belong to the earlier swept event. Final public loads can already be
zero after an unloading response without invalidating that earlier contact.

| Original test / failure | Correct observation and retained contract |
| --- | --- |
| MX250 bottomed contact fixture required a reconstructed signed forward component below −0.1 m/s; the shorter interval produced −0.07834 m/s | Observe the real first-contact completion. Require a genuinely negative component and independently show that the former bare forward clamp closes the active stop by more than 1e−5 m/s. The corrected closure must still be at most 2e−9 m/s. |
| MX250/MX450 genuine partial touchdown compared the public heading change, about −0.0071966 rad, with the first interval's turn, about −0.0024713 rad | Compare the immediately preceding supported state with `firstFlightContact` completion. Retain the exact yaw turn, world-velocity preservation and kinetic-energy assertions at that boundary. Later ground evolution is no longer misidentified as a frame-conversion impulse. |
| Stop-observability test required the final public incoming compression to remain below full travel | Require the **first contact interval's** incoming compression below travel, then independently observe the actual crossing and later compression. Verify final incoming force/compression channels against the last physical interval. |
| MX450 impact test chose first-contact patches from final public force flags; both final loads were zero and the reconstruction produced NaN | Capture the actual swept event's axle flags and pose before its force solve. Independently sample those tyre footprints and reconstruct incoming normal speed from the ballistic velocity. |

## Hard-contact constraint and momentum checks

`tests/motocross-final-contact-frame.test.ts` now records two distinct states:

1. The supported remainder's result immediately before its continuing-yaw
   frame conversion.
2. The completion of that same `firstFlightContact` event, including its
   current contact geometry and mass.

The independent contact Jacobian still differentiates actual free-wheel
geometry on coherent analytic planes. It retains the two causal collision
states, reflected yaw/slide/cross-slope signs, three world headings, both
motorcycles, separating-stop cases, partial contact at 120/240/480 Hz, and
exclusion of AI, supermoto and road-course dirt bikes.

The former `signedForward < -0.1` condition was a fixture-strength assumption,
not the physical constraint. Its replacement is more direct: construct the
old counterfactual velocity by rotating the same world velocity and removing
only its negative forward component. The actual active stop must then have a
positive closing speed above **1e−5 m/s**. The production joint projection
must retain nonnegative forward speed, keep closure at or below **2e−9 m/s**,
and add no kinetic energy beyond the unchanged **1e−8 J** roundoff allowance.
This preserves the regression against the real defect instead of merely
accepting a smaller negative fixture velocity.

Separating stops still receive no new vertical, pitch or yaw impulse. Their
transverse component remains exact, and the energy loss still equals the
removed forward component's kinetic energy. Unbounded partial landings retain
their world momentum and energy under the original precision assertions.

Two additional cases compare observed and unobserved collision runs for
**24 subsequent updates per motorcycle**. Unrounded pose, velocity, support,
rotor, control, fuel, thermal, rider and machine-motion state agree exactly.
The observers do not influence the trajectory or hide a later state mismatch.

## Actual stop severity and force timestamps

`tests/motocross-landing-observability.test.ts` retains the real SKY TRIPLE
overshoot, ordinary controls, the long contact-containing public update, the
incoming impact severity and the next-public-update `crash-front` judgment.

The former test reconstructed every stage with the old semi-implicit Euler
recurrence. That algebra is no longer a valid oracle for the supported midpoint
solver. It also expected the entire public call's rotor state to remain the
first flight interval's rotor state, excluding the newly coupled ground pickup.

The retained test instead:

- Checks the exact ballistic height and velocity up to the first event.
- Sums actual supported interval durations and requires their total to equal
  the public duration minus the free span, with the original precision.
- Observes actual visited chassis states at the force-evaluation boundary.
  A midpoint preview leaves the actual state unchanged and therefore cannot
  invent an observed extremum.
- Independently reconstructs both shaft velocities from chassis, pitch, yaw
  and contact-normal geometry, including actual full-travel crossings. The
  largest observed/crossing shaft speed matches the published bottoming
  severity to **8 decimal places**.
- Reconstructs the default-setup spring/damper/stop forces independently from
  each interval's actual incoming pose, retaining force precision of
  **9 decimal places** and incoming compression precision of **11 places**.
- Requires the final public force/compression channels to equal the final
  physical interval's observations, while preserving the first interval's
  below-travel incoming state.
- Checks the coasting-rotor recurrence over the physical flight update that
  contains contact. Subsequent ground intervals are allowed to apply their
  real pickup forces; their energy contract is covered independently by
  assignment 37.
- Retains finite public state, nonzero real support, full displayed travel,
  normal impact speed above 10 m/s, immediate recorded bottoming severity,
  and exactly one crash judged on the following public call.

An unobserved copy receives every identical public duration. Its physical state
matches after every update; core dynamics, all tyre thermal/contact state,
rigid-body state, machine motion, clocks, fuel, gear and RPM also match at the
landing endpoint. Both copies then produce the same next-update crash state.

The independent RK4 constitutive and cadence accuracy checks remain in
`motocross-supported-convergence.test.ts`; this observation test no longer
duplicates a particular numerical integrator's implementation.

## Incoming impact record

`tests/motocross-landing-prediction.test.ts` records the swept event's actual
front/rear flags, event time and pose before support applies an impulse. It
does not infer historical contact from the current loads.

The checks retain exact event-time identity and independent free-translation
and gravity reconstruction. They sample the actual event footprint, require
its gap within **1e−8 m**, and derive the along/cross gradients and normal
impact speed from the terrain normal. The pitch record must describe the
captured incoming chassis and automatic rider posture, with the original
precision. Final support, heave and pitch state must all be finite.

## Verification and explicit pending handoff

Final owned/reference run:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/motocross-final-contact-frame.test.ts \
  tests/motocross-landing-observability.test.ts \
  tests/motocross-landing-prediction.test.ts \
  tests/motocross-supported-convergence.test.ts --maxWorkers=1
```

Result: **4 files, 41/41 tests passed**, 7.59 seconds. Of these, 30 are in the
three owned files and 11 are the unchanged supported-convergence suite. The
overlapping exploratory runs are not counted as additional distinct tests.

Focused ESLint on the three changed files, a strict TypeScript check of their
imported dependency graph with a 512 MB heap, and `git diff --check` pass.
The temporary TypeScript configuration resides under ignored `test-results/`.
No install, npm lifecycle hook, git mutation or publication was performed.

**Pending outside this assignment:** the broader five-file run includes
`motocross-contact-time-coherence.test.ts` and reports **48 passed, 6 failed**.
For each MX250/MX450 × 120/240/480 Hz combination, its test named
“records the free incoming event and integrates support once afterward” still
requires exact `vy = incomingVy + (incomingForce/mass - gravity)*duration` and
`y = incomingY + finalVy*duration`. Those are the replaced Euler equations.
The first velocity differences range from **3.2965e−6 to 6.5320e−4 m/s**,
against an exact-algebra tolerance of 5e−11 m/s. All preceding first-event
time, ballistic, patch and severity assertions pass. These six assertions
remain unchanged; assignment 41 owns their semantic review and must inspect
the subsequent rotor/force assertions too. This report does not predeclare
that review a success.

## Source identity

All reported runs used this unchanged production checkpoint:

| Source | SHA256 |
| --- | --- |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `02cc6351d7467833dfa21be74a2fac71ddfbbd64ecc4cd6623809325384d58b4` |
| `src/simulation/offroad/mx-ground-physics.ts` | `68b04234548a2b037f4769d38343c26ec712a61fd9261fd6dac44641c81ca4e3` |

Assignment 40 is independently investigating a later no-support/ground-frame
momentum issue. Its possible production change is not included in this
checkpoint's results; final campaign acceptance must rerun the relevant gates.

All test/report ownership is released to root at handoff.
