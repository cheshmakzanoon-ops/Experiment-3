# GP contact relaxation follows the current tyre stiffness

Assignment 27, wave 9. The production correction is confined to
`src/simulation/motogp-physics.ts`; it changes how the existing reduced carcass
state is carried between different contact preparations. It adds no grip,
normal support, steering gain, AI speed margin or crash allowance. The tyre
curves, authored relaxation length and longitudinal force limits are unchanged.

## Reproduced contact defect

The GP plant stored relaxed lateral force in absolute newtons. When a wheel
unloaded, its old force was immediately clipped to the smaller friction circle.
When support returned, the force rebuilt over the original relaxation length.
This asymmetric treatment could repeatedly lose lateral force even when the
slip was held fixed and the mean normal load stayed constant.

The independent preceding review established that the Ardennes hairpin's
apparently low mean support was a sampling artifact: full-rate support averaged
approximately the motorcycle's weight while oscillating rapidly. This review
did not reduce gravity, smooth the road, or reinterpret that oscillation as a
sustained crest. It reproduced the force-history defect on a prescribed tyre
bench without an AI, a path planner, a road mesh or chassis feedback.

The bench holds speed at 13 m/s, body lateral speed at 1 m/s, yaw rate at zero,
lean at 0.4 rad, friction at 1.5, and longitudinal force at zero. Its alternating
normal loads are 500 N and 1,900 N per wheel, with mean 1,200 N.

| Prescribed contact                                  | Mean lateral force |
| --------------------------------------------------- | -----------------: |
| Constant 1,200 N support                            |    −1,173.947958 N |
| Alternating support, old absolute-force history     |      −853.178558 N |
| Alternating support, corrected strain history       |    −1,148.694635 N |
| Mean of independent steady 500 N / 1,900 N contacts |    −1,141.611027 N |

The nonlinear tyre law does **not** require the alternating-load result to equal
the constant-mean-load result. The independent steady comparison explicitly
retains that difference. The correction removes the much larger loss caused by
carrying the wrong elastic state. Zero slip with zero camber remains exactly
force-free, including during unloading and reloading.

## State and integration contract

The existing reduced force-relaxation state represents an equivalent lateral
carcass strain `u = Fy / C_alpha`, where `C_alpha` is the prepared contact's
cornering stiffness in N/rad. On an actual contact evaluation:

```text
carriedFy = oldFy * currentCorneringStiffness / previousCorneringStiffness
mix = 1 - exp(-dt * rollingSpeed / authoredRelaxationLength)
newFy = clamp(carriedFy + (steadyFy - carriedFy) * mix, currentFrictionCircle)
```

A missing previous preparation starts from the existing force, normally zero.
An unloaded or zero-friction wheel has zero force and zero stored preparation.
Its next landing therefore builds from an unstrained contact. The existing
friction-circle projection remains immediate and authoritative.

The ratio is applied once in the actual plant, before that step's relaxation.
The front inverse uses separate scratch and never changes the history. The
rear preview computes the same interpretation locally, without updating either
force or stored stiffness; ten repeated inverse/preview calls produce the same
answer and leave actual physical and thermal state unchanged.

Constant contact preparation uses the original arithmetic exactly. Standalone
callers without the road-contact opt-in also retain the original arithmetic.
The two added history scalars reset with the existing GP contact state. No
presentation field or snapshot stride is added; deterministic replay reconstructs
these states through the actual solver.

There is no new heat source for a change in normal load. The existing thermal
path continues to measure work from the force actually applied and the contact's
relative slip velocity. Zero-slip/zero-camber load cycles produce zero lateral
force and zero sliding heat.

This remains the game's reduced relaxation model. `Fy/C_alpha` is an equivalent
elastic state, not a full nonlinear carcass deformation model, and this work
does not claim to introduce measured manufacturer tyre data or unsprung masses.

## Verification and source boundary

The exact original seed-1037 reproduction now clears the hairpin with all four
riders and **zero falls through 110 seconds**. All four riders are beyond
station 3,681 m at that point. This short reproduction is not claimed as a full
race or a replacement for the original scenario sweep.

The unchanged complete GP braking-plan suite passes all nine assertions,
including both Ardennes seeds, Montejaral and all three cooldown cases. The
unchanged complete bike-session suite passes all fourteen assertions, including
the mixed-class incident, completion, stuck-rider and GP pace checks. The same
integration invocation also passes the original GP plant, motorcycle thermal,
paired momentum, contact-reaction, steering-inverse and exact flashback tests:
**102 assertions passed in 11 files**.

That invocation nevertheless exits **1** because Vitest reports an unhandled
`onTaskUpdate` RPC timeout. It is recorded as a failed invocation, not a clean
suite result. No test exceeded its individual deadline and no assertion was
disabled. Assignment 29 owns the separate reporter investigation and final
complete acceptance on the frozen combined source.

After integration and formatting, the focused force/inverse/momentum/reaction
run exits **0**, with **36/36 tests passing**. The nine new tests in
`tests/gp-load-relaxation.test.ts` cover stiffness changes in both directions at
1/240 and 1/120 second, constant-preparation bitwise equivalence, zero-slip load
changes, unloading and landing, repeated read-only previews, current friction
circles and finite mechanical work.

[Full-precision evidence and source manifest](studio/reports/evidence/gp-contact-relaxation.json)
retain the bench measurements, narrow race result, failed process status, and
pre-format/final source hashes. Final all-19 scenario results, the affected two
GP machines' calibration, and the complete test invocation belong to the final
acceptance report; they are not inferred from these focused results.
