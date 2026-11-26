# Reconciliation with the concurrent motocross pass

This assignment began at `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`.
While its third wave was working, another session published
`39d9d497880e92801a7d77de6af2639b4186bfcc`. That commit is part of the
accepted baseline for the combined result. Its changes must not be attributed
to this assignment or overwritten by an earlier local implementation.

## Decisions

| Area | Integration decision | Reason |
| --- | --- | --- |
| Flight and contact time | Retain upstream swept touchdown and supported substeps | They integrate an actual contact event and the remaining supported interval. |
| Compliant touchdown momentum | Retain assignment 07's conversion of horizontal velocity to grounded storage units | Projecting the still-retained vertical velocity into forward speed duplicates momentum. |
| Suspension publication | Retain upstream final-pose fork/shock sampling | Physical incoming compression and force history differ from the displayed endpoint; final terrain resampling also matters. |
| Coupled suspension stops | Retain one public API; reconcile numerical and speed-bound improvements behind it | Two competing definitions or an independent final speed clamp would undermine the shared contact solve. |
| Rider blend | Retain upstream local blend and its matching analytic `poseRate` | The earlier assignment 09 global blend changes outer control authority and cannot use the upstream derivative. Its implementation is superseded. |
| Joint reconstruction | Retain upstream reversal and repeated-snapshot handling | Those fixes already address the first audit's suspension extrema and held-snapshot findings. |
| Wheel reconstruction | Investigate remaining phase/rate inconsistency separately | A displayed rotation and its reported angular velocity should describe the same motion. |
| Sport drive reserve | Forward the core's gross limited engine request | A net tyre force includes brake subtraction and is not an engine actuator command. |
| Front support | Retain the new continuously bounded bar-steering authority | Unsupported front contact cannot impose a rolling turn through the rear tyre. |
| Gates and recovery | Retain independent fixes; recheck lifecycle boundaries | Physical placement and animation motion must agree with session state. |
| Session identity | Advance beyond upstream physics version 40 | Changed deterministic dynamics require a distinct recorded-session identity. |

The local checkpoint preserves the earlier alternatives and their reports for
audit. A superseded test based on a replaced implementation is not a final
acceptance result. Existing upstream contracts remain acceptance gates; any
intentional contract change must be explained and independently verified.

Local checkpoint: `b451b72`; initial reconciliation commit: `61434f1`.
The agent 15 guidance candidate was excluded from that merge because it
regressed four existing clear-jump cases. Assignment 21 revisits its causal
approach findings against the combined dynamics.

The new assignment 07/13 tests were reconciled with the incoming engine's
actual contracts. A compliant touchdown is compared with an identical
already-supported initial state, since a refined support interval cannot be
reconstructed from its first force sample alone. A public step that begins
with closing tyre overlap contacts at time zero and has no free-flight drag
interval. Suspension endpoint assertions inspect `fork`/`shock` and recorded
wheel travel, while `compressionFront`/`compressionRear` remain incoming
force-solve observations. Tests of the scalar fallback explicitly select a
non-motocross course; upstream already uses coupled stops for MX AI.

The transplanted assignment 10 invariant tests pass against upstream's
positional solver API. This is evidence to preserve its numerical kernel,
rather than replacing a passing implementation solely because both sessions
developed alternatives. The separate forward-bound defect remains actionable.

## Remaining integration gates

### Test fixture corrections after cross-slope support

The earlier real-wheelie tests used Valley Ridge at s=35, which has a 1%
cross-bank. Their exact front/coast trajectory comparison therefore included
rear-load-dependent downhill support after cross-slope physics was added.
Braking also changes automatic rider bracing, and thus rear load, even while
the front wheel remains free. Those are separate physical effects from the
unsupported front contact whose authority the tests were intended to isolate.

The integration fixture now uses an analytic level patch with the original
soil and course eligibility. The brake case holds a fully converged manual
rearward rider stroke before applying throttle, so brake-induced automatic
bracing cannot alter the compared body pose. The production springs still
create the wheelie from controls alone. A 50 ms brake interval gives its
overspeed rear rotor time to enter braking. Every original assertion remains,
including zero front force, exact front/coast trajectory comparisons, reduced
rear angular speed, rear brake force above 300 N, and the expected pitch
response. Both steering cases pass, and all 17 contact-traction tests pass.
These in-memory test planes do not modify any authored terrain or environment.

Before publication, rerun the combined motocross unit contracts, ridden laps,
race/calibration scenarios, deterministic preservation evidence, type checks,
lint and the production build. Confirm the protected asset/environment tree
is unchanged. Record source identities with final evidence and distinguish
local results from hosted CI and actual browser observations.

### Final integration: airborne drag and changing fuel mass

The completed assignment 46 sweep found two strict airborne-drag failures:
MX250 and MX450 player endpoints differed from a whole-public-tick formula by
approximately `3.739e-11` and `3.900e-11` m/s. Opponent, riderless and trajectory
cadence cases passed. The formula used the public tick's final mass for every
instant, although complete contact-accuracy intervals consume fuel and refresh
mass individually. The runtime already integrates the quadratic drag law
analytically within each such interval. No drag, fuel or runtime change was
required.

Root changed only `tests/motocross-air-drag.test.ts` to observe the actual
complete physical intervals and compose the independent reciprocal-speed and
logarithmic-distance equations using each interval's sampled mass. Existing
speed, travel, heading, lateral velocity and ballistic-heave precision remains
unchanged, with the same numeric assertions applied at each physical endpoint
as well as the public endpoint. Explicit checks require the interval durations
to sum to the public timestep and demonstrate that the discarded final-mass
shortcut exceeds the original precision in the refined player cases.

Two observer-transparency cases compare 19 unrounded motion, rotor, mass and
fuel quantities over 100 public calls per machine against unobserved native
runs. All 200 paired states are exact and the temporary observer is removed
after every call. The helper also restores its method descriptor in `finally`.
The complete file passes **22/22 tests**, including all 20 original tests;
ESLint passes. This correction does not relax the original tolerances or
disable fuel consumption. The source identity and command result are recorded
in [root-air-drag.json](evidence/root-air-drag.json).
