# Assignment 43 — independent physics and boundary review

## Decision and scope

**No additional production correction is justified by this review.** The coupled stop solver agrees with an independently constructed mass-weighted projection, and the player first-contact solver handles contact at both interval boundaries without duplicating its supported advance or rotor update. These findings concern the reviewed source and the sampled reduced model. They do not resolve the concurrent assignment-40 AI posture investigation or establish final integrated acceptance.

This assignment wrote only this report and task-local diagnostic scripts/receipts. It did not edit production code, tests, models, geometry, materials, assets, terrain, environments, specifications, acceptance thresholds, or git state. No child agents were spawned.

The adapter remained SHA-256 `e04318b7e4c6075d42a6c65cc04664a19e5425e20e50f49a1b1ad4f37084ea17` during both measurements. Assignment 40 owns later adapter changes. Any final acceptance statement must identify that later integrated source separately.

## What was reviewed independently

The review read the actual contact, drag, ground-velocity and adapter implementations, their relevant regression tests, and reports 07, 10, 18, 25, 26, 28, 36 and 39. It checked the following relationships rather than treating the reports' conclusions as new measurements:

| Boundary | Source finding |
| --- | --- |
| Coupled suspension stops | Both axle impulses are solved from the same incoming velocity; the adapter then adds their generalized momentum changes. The legacy helper is retained only outside the motocross course/class gate. |
| Terrain gradient and impulse units | The contact row uses the terrain's height gradient, so the returned multiplier is the vertical-component impulse. Forward, lateral, heave, pitch and yaw changes use that same row and matching masses/inertias. It is not mislabeled as an impulse along a unit terrain normal. |
| Airborne translation | Exact constant-gravity displacement and analytic quadratic-drag distance use the same free duration. The angular advance remains the declared sampled, damped rule; it is not claimed to be an exact continuous angular solution. |
| First contact | The free arc is evaluated at the selected contact time, then the existing vertical solver receives only the remaining duration. The final terrain sample changes the speed coordinate basis while preserving the resolved horizontal component. |
| Supported refinement | Internal stages refresh local spring/damper forces and heave/pitch, while outgoing force/compression telemetry retains its outer incoming timestamp. The complete manual rider stroke is not repeatedly integrated by those stages: refinement requires initial support, whereas the free-rider stroke branch requires its absence. |
| Ground yaw coordinates | The physical force update and orthogonal body-frame rotation are separate. Supported camber steering remains a real path-turn contribution. The forward-only clamp can dissipate energy and is not an unrestricted reverse-motion coordinate model. |

The tests in reports 25 and 28 already exercise real departures, event-local normals, ordinary coarse/fine convergence and supported force refresh. This assignment therefore concentrated its new probes on a separate coupled-contact oracle, mass scaling, near-redundant geometry, and exact zero-remainder contact boundaries.

## Independent coupled-contact projection

The diagnostic represents velocity as

`v = [forward, lateral, vertical, pitchRate, yawRate]`

with diagonal generalized mass `M = diag(m, m, m, Ipitch, Iyaw)` and contact rows

`J = [−grade, −crossGrade, 1, lever, −yawArm]`.

It constructs mass-weighted velocity `w = sqrt(M) v` and rows `n = J / sqrt(M)`. An inelastic frictionless impact is the minimum-distance projection of `w` onto the two non-closing half-spaces. The oracle independently enumerates the feasible free/single-contact projections and obtains the simultaneous-contact candidate by orthogonalizing the two weighted rows. It then chooses the feasible projection with minimum squared distance. It does not reuse the production Gram-determinant or sum/difference solve.

The deterministic sequence uses seed **430271** and the 32-bit recurrence `state = 1664525 × state + 1013904223`. It contains **4,096 cases** spanning mass 160–240 kg, pitch inertia 65–160 kg·m², yaw inertia 35–170 kg·m², forward speed 0–48 m/s, lateral speed ±10 m/s, vertical speed −16 to +10 m/s, pitch rate ±9 rad/s and yaw rate ±5 rad/s. Grades, cross grades and contact arms vary independently. Every fourth case uses nearly coincident rows separated by a deterministic magnitude between 1e−9 and 1e−2, yielding **1,024 near-redundant pairs**.

Each case additionally swaps axle order and scales every mass/inertia by 0.001 and 1,000. Uniform mass scaling should change impulse magnitude by that factor while preserving the resolved velocity. This specifically challenges the solver's handling of effective-mass scaling rather than merely comparing a second implementation of its scalar formula.

| Result | Observed maximum or count |
| --- | ---: |
| Free / front-only / rear-only / simultaneous oracle solutions | 1,111 / 724 / 1,337 / 924 |
| Positive residual closing speed | 1.95399e−14 m/s |
| Kinetic-energy gain | 0 |
| Relative impact-work identity error | 6.51322e−16 |
| Component difference from independent projected velocity | 1.82077e−14 |
| Axle-swapped impulse difference | Exactly 0 N·s |
| Impulse difference after undoing uniform mass scaling | 2.27374e−12 N·s |
| Negative or nonfinite impulses; failed probe checks | 0 |

The impact-work comparison checks `Kbefore − Kafter = ½ Σ impulse × incomingClosingSpeed`. It concerns the velocity impulse only. The adapter's position projection, subsequent gravity, compliant springs, rider forces and speed clipping are deliberately outside that identity.

## Exact interval-boundary contact

A second probe invokes the unchanged real adapter's first-contact path on a laboratory plane, with its real MX250/MX450 dimensions, factory free-wheel offsets, spring/damper law and vertical solver. The plane is a test fixture; no authored venue is edited. The fixture prescribes a free incoming state with zero pitch/rider torque, 9 m/s forward speed, 0.7 m/s lateral speed and −2 m/s heave, then places the plane so the first closing tyre reaches it at a known point in the interval.

Both bikes run four durations—1/120 s, 1/240 s, 1/480 s and 0.013 s—with contact at the **start**, **37% of the interval**, and **exact endpoint**: **24 controlled adapter cases**. A wrapper records the actual call into `vertical()` while calling the original implementation. It does not substitute contact forces or suppress landing state.

All 24 cases have:

- Exactly one supported solver call and one new landing record.
- The correct free-plus-supported duration split.
- Finite outgoing heave, pitch, rates, speed, position and slide.
- Unchanged front/rear rotor values across this contact-only path, showing that it does not perform a second wheel update.
- Exact agreement with the independently evaluated incoming gravity position and velocity in this fixture.

Every exact endpoint case has **zero supported remainder**, still records its contact once, and remains finite. Start contact has zero free duration. The largest interior event-time error is **1.45286e−12 s**, within the declared 32-bisection resolution. No arbitrary contact epsilon or severity threshold was introduced.

This is a controlled boundary test of the real contact consumer, not another ordinary riding trajectory or proof that every terrain feature is swept continuously. Existing real-departure tests supply that different evidence.

## Drag subdivision identity

The helper was also checked with **120 combinations** of speeds 0–80 m/s, coefficients from zero and 1e−12 through 0.08 m⁻¹, and durations from 1/240 s through 7 s. Each whole step was compared with the nonuniform fractional sequence `[0.03, 0.13, 0.02, 0.19, 0.31, 0.07, 0.25]` of the same duration.

Maximum whole-versus-subdivided differences were **2.84217e−14 m/s** in speed and **1.13687e−13 m** in distance. The telescoping kinetic-work residual was **4.54747e−13** in the unit-mass energy convention. All outputs remained finite, nonnegative and passive in this bounded physical range. This does not promise overflow-safe behavior for arbitrary finite values near JavaScript's representational extremes.

## Limits that remain explicit

1. **Reduced spring work:** the compliant pitch moment still uses the shortened arm described in report 18, while the gap-rate and hard-stop Jacobian use the full offset derivative. The coupled impact's passivity does not make the complete spring/damper model conservative. An isolated torque correction still requires the coordinated equilibrium and control migration described in that report.
2. **Forward-only travel:** clipping a mathematically valid backward post-impact speed can reintroduce normal closure, as report 26 demonstrates. It remains dissipative; this review does not claim full complementarity after that separate publication constraint.
3. **Sweep coverage:** the search requires an endpoint-bracketed crossing or supported initial overlap. It is not a general sweep through an arbitrarily thin feature that the tyre enters and leaves between two positive endpoint gaps.
4. **Refinement scope:** local force refresh keeps the sampled terrain and outer control inputs fixed. The 16-stage cap and stroke/frequency criteria bound computational work, not all possible integration errors at arbitrarily large timesteps. They do not make the angular rule or complete vehicle motion exact.
5. **Pending integration:** the independent probes use the pre-assignment-40 adapter hash below. They neither repair nor certify the AI full-grid posture regression. Final current-source regression, browser and protected-scope checks remain separate gates.

## Receipts and exact source

Task-local diagnostic files are under `/workspace/scratch/e91efca799c8/validation/physics-review-a43/`:

```sh
node --experimental-transform-types /workspace/scratch/e91efca799c8/validation/physics-review-a43/invariants.mjs
node --experimental-transform-types /workspace/scratch/e91efca799c8/validation/physics-review-a43/contact-boundaries.mjs
```

Both exited zero. `invariants.json` and `contact-boundaries.json` preserve numerical maxima, all boundary-case observations, violation lists and before/after hashes. This report does not count these local diagnostic cases as added Vitest tests or add them to the integrated-suite total. No broad duplicate test sweep was run.

| Reviewed file | SHA-256, unchanged during measurement |
| --- | --- |
| `src/simulation/offroad/contact-impulse.ts` | `7c33205a27a5e271ffc1569ca2785aac234e5f4165aa6fe1f920c783fdd685e6` |
| `src/simulation/offroad/air-drag.ts` | `f9b4ffcfe58372c08fb2dabfacdea4a94dfe63902a6232b6889e7dbc6384846d` |
| `src/simulation/offroad/mx-ground-physics.ts` | `f63a9f4389c27e191a8cd638774e7d5f2f35e60fd557d2285a9bdbbaab982c4d` |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `e04318b7e4c6075d42a6c65cc04664a19e5425e20e50f49a1b1ad4f37084ea17` |

All diagnostic processes have ended. No production ownership was acquired or retained.
