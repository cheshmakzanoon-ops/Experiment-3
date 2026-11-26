# Assignment 55 — Independent final runtime source review

Wave 10, distinct assignment 55. Review base:
`c9c94c7029dbc3e29b18101ef7ccea0a897184d1`.

## Release assessment

**No newly identified release-blocking runtime defect in the reviewed frozen
candidate.** The nine changed runtime files implement the documented scope and
ownership boundaries. The known physical and presentation limits below remain
real; this review does not convert them into global energy conservation,
arbitrary-cadence equivalence, exact sparse impact reconstruction or a browser
acceptance claim.

This is a source and caller-context review, not a second execution of the broad
acceptance matrix. Final unit-sweep completion, publication and remote-head
verification remain root-owned gates. A passing source review does not imply
that those operations have already completed.

The independently computed fingerprint is
`4c041cb338d0fa480e0514ee905137a24061494b98b9899949238f6b137be790`.
It covers 1,129 sorted files: regular `src` files and `package-lock.json`,
`index.html`, `vite.config.ts`, using path/NUL/content/NUL SHA-256 framing.
[The compact receipt](../evidence/55-source-review.json) records all nine runtime
hashes and the review scope. No runtime, test, model, character, asset,
environment or Git state was modified by this assignment.

## Independent code assessment

| Runtime file | Checked behavior and conclusion |
| --- | --- |
| `src/core/session-identity.ts` | Simulation identity advances to 41 for changed deterministic dynamics. It does not alter the recording protocol or entrant layout. |
| `src/rendering/wheel-pose.ts` | The MX wheel sampler chooses winding and tangent limits once. Its interior angular-rate expression is the analytic derivative of the same Hermite phase; linear fallbacks share their secant. Exact endpoints and pause/reset/service holds intentionally retain measured values. Other vehicle families retain their previous rate interpolation. |
| `src/simulation/bike.ts` | Assisted gross drive is captured before rear-brake subtraction; published brake limits remain actuator ceilings. Translating the net rear-force allowance back to a gross braking ceiling includes the opposing drive once. Ordinary shared-core force ordering remains intact. |
| `src/simulation/bike-vehicle.ts` | The new finite recovery path is selected for motocross/knobby machines. It bounds full 3D rider displacement and shortest-arc heading, gathers before pushing, and requires actual seat position/heading for completion. The distance budget cannot authorize a teleport. Other recovery paths retain their previous branch. |
| `src/simulation/offroad/ai.ts` | Shoulder guidance consumes the current shared driver's decision after `super.update`. Its additional recentering runs only for `RACING LINE`; passing, following and caution keep traffic ownership. A qualifying landing's first timestamp is latched on its own plan, so rebounds neither renew nor erase the finite settling allowance. |
| `src/simulation/offroad/contact-impulse.ts` | The bounded active set jointly projects the normal stops and final forward-storage constraint in the retained mass metric. Orthogonal horizontal-axis elimination and the recovered nonnegative forward reaction are consistent. Caller-owned output is cleared before reuse. |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | Player eligibility, old/new ground-speed projections, launch/touchdown storage, yaw-frame transport, bounded complete intervals, physical-phase telemetry, first-contact timing, rotor inertia and sag-aware remount targets were checked in their callers. No new contradictory ownership was identified. |
| `src/simulation/offroad/mx-ground-physics.ts` | Lateral gravity is reprojected with the turning frame, forward-only displacement projection leaves horizontal side travel unscaled, and steering authority vanishes with front support. Cross-slope work checks use the shared finite endpoint and actual rotor travel; individual corrections preserve the other axle's available force and each friction circle. Brake heat excludes engine braking's separate port. |
| `src/simulation/offroad/session.ts` | A supplied gate assignment is accepted only as a complete valid permutation. Placement and entrant bookkeeping share the same resolved assignment; malformed input takes one consistent fallback path. |

### Caller and transition details

`DirtBikeVehicle.drive` returns `super.drive` before the new drivetrain logic
for every non-player caller. The two-signal downshift condition therefore does
not leak into AI or the legacy non-MX drivetrain. Player refinement is also
selected before any inner interval using the same course/machine/AI eligibility.
AI-owned and non-MX public steps remain single intervals.

On a supported player bike, speed storage is along the sampled terrain chord;
flight and the zero-support launch-debounce branch use horizontal translation.
The ordinary contact resample preserves horizontal momentum with the old/new
cosine ratio. Touchdown retains sprung vertical velocity instead of counting it
a second time in grounded speed. Yaw changes re-express horizontal world
momentum into tyre axes; projected stops include the final forward-only bound,
including the later endpoint-frame check. These are coordinate changes, not an
additional suspension impulse. Harness rotor reseeding was read together with
its placement, collision, landing and rolling-reference guards; this review
found no reproducible new natural-riding failure in that path.

At most eight complete player intervals are selected. Collision absorption,
automatic-shift decisions and counted launch debounce remain public-call
operations. Pending-landing judgment runs only on the first interval, before
this call's vertical update can create a new landing. Fuel, heat, shaft state,
rider/machine state and clocks consume the actual inner duration. Public force,
power and longitudinal-acceleration means average equal-duration intervals;
private endpoint values remain at their actual final physical phase. Machine
shaft/steer rates are restored to public endpoint secants.

The supported solver has a finite 16-stage budget, four crossing-event bits and
fixed bisection counts; its final stage consumes any remaining interval. Midpoint
force previews cannot increase the reported bottoming extremum. The separate
cross-slope finite-work correction also has fixed sweep/bracket/fallback bounds.
These are bounded numerical mechanisms, not a claim of an exact multibody solve.

## Accepted known limitations and practical consequences

The following were checked against source and existing evidence. They are
**retained limitations**, not newly discovered blockers or reasons to silently
relax an acceptance condition.

| Limitation | Practical release implication |
| --- | --- |
| Reduced compliant spring Jacobian work | The full gap derivative and calibrated spring torque arm are not work-conjugate. Assignment 28's closed-loop residuals are 1.7448/1.8394 J for its two bike probes. The isolated full-arm replacement regressed all four player jump cases. Current refinement improves integration of the retained model; it does not establish conservative suspension. A future correction needs a coherent support/drive/equilibrium redesign. |
| Separate yaw-damper energy port | Assignment 32 records approximately +5.73e−7 J under a within-interval yaw reversal. That signed port explains its ledger residual independently of tyre contact work. Contact passivity must not be presented as a globally passive planar model. |
| Retained C1 posture corner | The current mapping can have an acceleration discontinuity at neutral and its outer joins. Assignment 35's two C2 alternatives did not consistently improve actual sampled motion and were rejected. Continuous pose/rate is supported; C2 rider motion is not claimed. |
| Sparse impact interpolation | Assignment 48's 30/60 Hz maximum interior hub errors remain 40.853/18.911 mm despite much smaller means. The shared wheel phase/rate sampler fixes an inconsistency; it cannot recover every unsampled impact. CPU rig algebra is not framebuffer verification. |
| Adverse held-input landing | The MX450 Valley held-flight-control case remains a converged flat crash: about 7.063701 m/s bottoming at 3840 Hz versus the unchanged 7 m/s limit. The added adverse regression preserves this outcome. Separate complete-riding animation fixtures use existing public input feedback. |
| Whole-approach cadence sensitivity | The documented bad median approach remains cadence-sensitive: both assist modes crash-rear at 120 Hz; finer Raw approaches can loop out while Sport survives. Height/vertical-speed bounds do not prove whole-approach trajectory or outcome invariance. The official public tick remains the acceptance cadence. |
| Narrow scenario margins | The positive player corridor has about 1.09 mm of margin, and the passing full-grid stop result has 0.85 s against its existing limit. Exact measured scenarios pass; arbitrary seeds and control variation are not established by those results. |
| Presentation and platform boundary | Float32 long-session time precision and the distinction between force timestamps and drawn geometry remain. The browser process was blocked before page execution by the platform socket restriction. Local CPU costs, strict types and build success do not constitute browser/GPU/FPS acceptance. |

Supporting records: [spring work](28-spring-work.md),
[contact work](32-contact-work.md), [rider acceleration](35-rider-acceleration.md),
[ridden flow](40-ridden-flow.md), [animation](48-animation-contract.md),
[traffic/full-grid evidence](49-wet-race-regression.md), and
[architecture](../architecture.md).

## Verification boundaries

This assignment independently inspected the actual changes against integrated
main and read surrounding dispatch, state transitions and consumers before
judging scope. It did not rerun the already completed 49/52 broad gates or the
46 sweep in progress, invoke npm hooks, retry the blocked browser, alter frozen
source, or create a speculative replacement solver. The source receipt matches
the assigned candidate. No new release-blocking reproduction was found.
