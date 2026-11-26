# Assignment 30 — Final touchdown frame and the forward bound

Wave 5; 25 November 2026. Production scope is the ridden motocross adapter's
partial touchdown boundary. No model, character, asset, environment, venue,
material, bike specification, force-law calibration or existing assertion was
changed. The normal impulse solver itself is unchanged.

## Confirmed defect

The first impact already constrains nonnegative speed along the touchdown
tyre axis. `firstFlightContact()` then integrates the supported remainder and
rotates the tyre frame by the surviving yaw rate times that remaining duration.
The formerly nonnegative component can become negative in this later frame.
An independent `Math.max(0, forward)` removed it after the contact solve.

That speed projection is dissipative in isolation, but its forward impulse
can close an uphill hard-stop contact that the preceding solve had separated.
The earlier forward constraint therefore did not certify the final published
contact state.

An initial seeded sweep of 3,000 consistent plane/drop states found 1,401
late-bound activations without a final bottomed-contact violation. In those
cases compliant rebound separated the contacts sufficiently, so adding another
normal impulse would have been wrong. Extending the diagnostic to 12,000
rear/front-only and paired stop states, with collision-sized lateral and yaw
velocities, found two causal violations:

| Bike | Signed final forward velocity before the old clamp | Rear closing velocity after the old clamp |
| --- | ---: | ---: |
| MX250 | −0.1559691116 m/s | +0.0110184177 m/s |
| MX450 | −0.2853805983 m/s | +0.0041860497 m/s |

Both rear contacts were still beyond full suspension travel at publication.
Their velocity before that independent forward impulse was separating. The
regression first failed with the same positive residuals through the public
`DirtBikeVehicle.step()` path, then passed after the correction.

These are prescribed, physically consistent rear-first plane-collision initial
conditions. Their approximately 5–6 rad/s incoming yaw rates represent collision
motion, beyond normal joystick whip rates. This assignment does not claim that
a control-only lap reproduced them on an authored venue. The MX450 example
also remains below the pitch-angle clamp, so the defect does not depend on that
separate limit.

## Change and mechanical contract

The adapter retains signed forward velocity through the final frame rotation
and terrain resample when a previously projected contact is present. Only if
the final component is negative does `boundFinalContactForward()` run.

At that actual final pose it:

1. Samples the existing final terrain contacts and selects only axles whose
   geometric compression remains at or beyond their physical travel.
2. Constructs their forward/cross gradients and the current pitch and yaw
   Jacobians from that same pose.
3. Calls the established coupled hard-stop solver with the current velocity,
   mass and inertias, together with the final forward-only constraint.
4. Applies the complete normal and forward reaction before publishing speed.

This is a new constraint at the evolved endpoint, not an unconditional repeat
of the earlier impact. Separating contacts receive no additional normal impulse
when the forward projection leaves them feasible. The mass-metric projection
does not add kinetic energy. If the forward constraint has a positive reaction,
its complementary velocity is mathematically zero and is published as exactly
zero, removing only the arithmetic cancellation residue. Significant incoming
signed velocity is retained until the coupled solve; it is never discarded
before normal feasibility is checked.

All arithmetic in ordinary nonnegative-forward landings remains unchanged.
AI, supermoto and non-motocross paths never enter this player-only swept-contact
boundary. The new code does not change the reduced model's compliant spring
energy law, which assignment 28 reviews separately.

## Verification

`tests/motocross-final-contact-frame.test.ts` contains **7 tests**, exercising
44 parameterized public-step scenarios:

- Both causal collision cases, mirrored cross-slope/slide/yaw signs and three
  world headings; final bottomed-contact closure is at most 2e−9 m/s and
  endpoint projection energy never increases beyond 1e−8 J numerical tolerance.
- Both bikes with separating bottomed contacts: no added vertical, pitch or
  yaw impulse, exact unchanged transverse component, and energy loss equal to
  the removed forward component's kinetic energy.
- Actual within-tick first contact at 120, 240 and 480 Hz, with mirrored grades
  and continuing yaw: world velocity and energy remain unchanged by the frame
  conversion, and the endpoint helper is not invoked.
- Explicit exclusion of MX AI on both venues, supermoto, and a road-course dirt
  bike. These scope checks supplement, rather than replace, the project's
  independent non-MX snapshot preservation benchmark.

Executed command:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/motocross-final-contact-frame.test.ts \
  tests/motocross-hard-stop-integration.test.ts \
  tests/motocross-contact-time-coherence.test.ts \
  tests/motocross-contact-consistency.test.ts \
  tests/motocross-landing-momentum.test.ts --maxWorkers=1
```

Final result: **5 files, 61/61 tests passed**, 8.68 seconds. The first expanded
run passed 60/61; its only failure was a new exact-zero check observing
3.47e−18 m/s after a mathematically active forward bound. The complementary-zero
publication described above resolved it; no test tolerance was changed.

Focused ESLint, `git diff --check`, and targeted strict TypeScript checking of
the new test and its imported production graph passed. The latter used a
512 MB heap and a temporary config extending the repository's strict config,
with explicit Node type roots and the Vite client declaration. Its first
external-config invocation could not locate those type packages; correcting
that temporary config resolved the setup error without a source change.
No install, npm lifecycle hook, full-repository type check, commit or push was
run by this assignment.

## Observed source identity

The stable final focused run includes assignment 29's disjoint brake candidate,
which that owner reports was completed before this run began.

| File | SHA256 observed after the focused run |
| --- | --- |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `7fa932378aa37f4e93a51900e3e40f3aafa16a2c87f1a65537f5799fa31fa272` |
| `tests/motocross-final-contact-frame.test.ts` | `9833b1337fc4f74027c7619d0d4073e1cf4539676488ad150731c9ab8f44e41e` |
| `src/simulation/offroad/contact-impulse.ts` (unchanged by this assignment) | `825d280cfd4c1769db8fee0abcdfa91989f4c6b73ac502e120f59f1061afa28e` |

Production and test ownership is released to root. Broader riding, performance,
and final-source validation remain integration gates owned by later assignments.
