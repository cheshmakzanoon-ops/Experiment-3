# Physics v18: converged contact, connected braking, and coherent motion

| Revision field      | Value                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Date                | 2026-10-20                                                                                |
| Inspection baseline | `81ee98b`                                                                                 |
| Integration base    | `96ad59d`, preserving the independently published Festival, MotoGP, and motocross updates |
| Simulation identity | `SIMULATION_VERSION = 18`                                                                 |

Release acceptance: numerical, browser, regression coverage, and final merged-source build checks passed, with the explicitly recorded rechecks below.

## Scope and reference standard

This revision corrects demonstrated numerical, contact, braking, and presentation defects in the existing engine. It extends the established compliant tire, coupled hub, thermal, drivetrain, and recorded-animation systems. The four-wheel solver changes apply to vehicles using `Vehicle` and `solveTire`; they do not replace the separate motorcycle dynamics models. Shared chassis presentation consumes the improved motion reconstruction.

The engineering reference is public iRacing documentation, interpreted as qualitative guidance:

- [The Sticking Points in Modeling Tires](https://www.iracing.com/the-sticking-points-in-modeling-tires/) explains force-based vehicle integration, coupled tire state, and the importance of behavior around and beyond peak grip. It supports testing force/work consistency and deriving presentation from simulated motion.
- [Physics Modeling: NTM V7 Info](https://www.iracing.com/physics-modeling-ntm-v7-info-plus/) describes carcass compliance and contact-patch motion, while explicitly withholding proprietary mathematics. It does not supply this project's contact equations, construction parameters, or coefficients.
- [February 2023 development update](https://www.iracing.com/iracing-development-update-february-3-2023/) discusses tire/road thermal coupling, fluid films, and limitations of individual tire submodels. This motivates examining the actual force and heat paths rather than only diagnostic values.
- [May 2025 development update](https://www.iracing.com/iracing-development-update-may-2025/) describes tire vertical compliance, bump rubbers, and more recoverable post-slide behavior. [2025 Season 4 release notes](https://support.iracing.com/support/solutions/articles/31000177148-2025-season-4-release-notes-2025-09-08-02-/) describe damper/bump-stop updates and brake-pad friction versus temperature.

These sources establish neither implementation equivalence nor measured vehicle fidelity. No proprietary iRacing code, tire coefficients, telemetry, or track measurements are used. This revision makes no claim about iRacing's current internal update rate.

## 1. Wheel torque convergence and work accounting

`src/simulation/tire.ts` replaces a fixed sixteen-iteration bisection with a safeguarded Brent root search. Interpolation accelerates smooth cases; bisection retains a sign-changing bracket when interpolation is unsuitable. The solve remains on the brake-complementarity half-line: a nonmonotone post-peak tire law cannot select a rotation for which the applied brake adds energy.

Convergence is expressed in torque units, using `1e-8 + 1e-12 * torqueScale` N·m, with an angular-speed roundoff floor and a maximum of 64 iterations. This improves small unloaded torque resolution and avoids a fixed bracket-width error becoming significant on light rotors or stiff contacts. It does not eliminate the integration error of the backward-Euler model.

`scripts/wheel-solver-probe.ts` applies 12,000 deterministic updates with seed `123456789`. Rotor inertias are 0.06, 1.35, and 5 kg·m²; steps are 1/960, 1/240, and 1/60 seconds. Signed drive torque, braking, load, grip, and contact velocities vary. The small-rotor/high-load/1/60-second combinations are conditioning stress cases beyond ordinary kart operation.

| Maximum error in this controlled probe             |                   Baseline tire module |     Updated tire module |
| -------------------------------------------------- | -------------------------------------: | ----------------------: |
| Wheel torque residual                              |                       1.2558518485 N·m | 1.6996182239 × 10⁻⁸ N·m |
| Work mismatch attributable to the root residual    |                         1.8394797195 J |   8.5808132621 × 10⁻⁸ J |
| Independently calculated whole-wheel work mismatch | Not recorded in the comparison summary |   8.5810825112 × 10⁻⁸ J |

The independent balance includes rotor kinetic energy, both elastic contact reservoirs, hub boundary work, drive/brake work, physical dissipation, and separately identified numerical integration loss. Numerical loss is not relabeled as heat that changes tire pressure or grip. These measurements demonstrate discrete-equation accuracy, not full-car energy conservation or agreement with real tire data.

## 2. Water, cooling, and reverse lockups

Water-film grip and thermal convection now receive `hypot(vLong, vLat)`, the magnitude of translation in the road plane. Previously, a car turning fully sideways could effectively lose speed-dependent aquaplaning and cooling despite retaining substantial road speed. The correction reaches the actual grip force as well as the aquaplaning diagnostic. Wheel rim speed is not substituted for translation: a stationary burnout does not acquire vehicle-speed water-film effects.

Signed longitudinal velocity remains the input for rolling transport, slip, contact renewal, sinkage, and wheel-axis resistance. This is an input correction to the existing reduced models, not an isotropic tire-force law.

Flat spotting now identifies a substantially held tread patch in either travel direction. A one-second locked-wheel fixture at ±30 m/s produces matching accumulation, `0.005704393816251802`. Rapid counter-rotation still generates distributed wear without falsely creating a stationary-patch flat spot. Equal 60 m/s planar velocities, including oblique and fully sideways movement, produce identical cooling in the isolated airborne thermal fixture.

## 3. Reachable suspension contact and directional link geometry

`Vehicle` previously rejected contact whenever geometric compression was negative. An already extended wheel could therefore lose a valid, loaded contact before reaching its authored droop limit. Candidate contact now requires a finite road intersection within that limit; the unilateral hub solver determines whether the candidate actually carries positive load. Merely being within reach does not attract an unloaded wheel to the road. Recorded geometric wheel length also uses the configured axle droop instead of a hard-coded 50 mm allowance.

In the production APX-derived fixture, road compression is −2 mm, previous hub travel is −8 mm, and retained geometric link load is 2000 N. The former gate reported zero tire loads. The corrected loads are 1770.288788 N per front wheel and 1711.560051 N per rear wheel, matching an independently derived linear spring/damper/tire series solution. Moving the road 60 mm farther away clears all contacts and link loads. Returning it while the hubs remain extended, without restoring stale link force, restores approximately 1206.914986 N front and 1190.133106 N rear support.

`geometricLoad` also distinguishes braking from propulsion using force relative to travel direction. It retains the original chassis-frame force signs. Reverse braking no longer selects drive anti-geometry solely because its longitudinal force is positive.

For the −22 m/s reverse-braking fixture with `antiBrake = 0.07` and `antiDrive = 0.005`, front link load changes from −30.804454 N to −431.262356 N. The latter equals −0.07 times the actual front longitudinal force, 6160.890800 N. Separate steered cases confirm the force-frame mapping. These are consistency oracles for authored geometry, not measured suspension calibration.

## 4. Regeneration through a connected driveline

`src/simulation/regenerative-braking.ts` allocates one common generator torque through the connected axle weights: front for FWD or the separate front motor, rear for RWD, and the configured center split for AWD. It does not treat four differential outputs as four independent generators.

Per-wheel demand first includes brake fade and ABS release. Regeneration replaces part of that demand; friction supplies the remainder. A full battery changes recovered energy and disc heating without changing requested total wheel braking or bias. The common generator respects the most restrictive connected ABS channel and retains a friction reserve. Its low-speed allocation ramp is continuous; the sign-safety condition can require friction takeover earlier, while preserving total requested braking. Existing 0.78 electrical recovery efficiency remains explicit; the replacement share is bounded at 0.65.

A crankshaft generator requires a nonzero gear ratio and clutch engagement. Its torque is additionally limited by remaining clutch capacity in the generator's opposing direction. A saturated back-driven clutch cannot transmit extra generator torque. The separate front-axle motor is independent of engine clutch disconnection.

Stopped or counter-rotating connected outputs disable common regeneration. Before solving the wheels, a conservative bound also checks that each connected wheel can retain its rotation sign through the step, using current rotor momentum, actual drive torque, total released braking, and a bound on tire torque. If that sufficient condition fails, friction supplies the same total demand. Completed-work accounting rejects a changed sign defensively and caps recovered electrical energy by actual generator work, power allowance, efficiency, and battery headroom.

Production regressions cover neutral/open clutch, an independent front motor, FWD/RWD/AWD routing, ABS, battery saturation across four brake temperatures, low-speed and reverse operation, within-step sign reversal, and a saturated slipping clutch. The ABS diagnostic fixture now initializes a running synchronized driveline rather than teleporting wheel speed while leaving the engine at idle.

## 5. Presentation velocities follow the rendered trajectory

Chassis poses already used Hermite translation and spherical cubic rotation. `PresentedFrame` independently blended endpoint velocities, which could describe different motion during changing acceleration. Motion blur consumed those inconsistent rates.

The presentation sampler now optionally emits analytic translation derivatives and world angular derivatives of the same curve. `quaternion-derivative.ts` propagates derivatives through spherical de Casteljau, including moving SLERP endpoints, quaternion sign equivalence, near-identity limits, and normalization. Linear/shortest-arc fallbacks supply their corresponding rates. The implementation reuses scratch objects and retains the existing pose evaluation, measured endpoints, reset holds, and raw recordings.

In a 0.2-second changing-acceleration fixture, correct midpoint speed is approximately 21.5 m/s; the former blend gave 23 m/s. The production `MotionField` error at 1280×720 with a 0.01-second shutter falls from 0.5309252544 pixels to 1.5849 × 10⁻⁸ pixels. An angular fixture similarly distinguishes the correct 2.3 rad/s from the former 2.6 rad/s. These are controlled projection checks, not a general visual-quality score.

## 6. Collision-free event recovery and compatibility fixtures

The broad regression scan exposed an existing event reset that placed the player's chassis inside a rival. It reproduced on untouched baseline `0d47645`: collision resolution immediately generated an impact and disrupted both vehicles. The reset now checks the collision solver's oriented chassis boxes, allowing 0.5 m of horizontal clearance and vertical room for suspension settlement. It searches backward from the existing bounded legal target in one-metre steps, stopping at the nearer of the current route edge's beginning or 30 m behind legal progress. A closed-circuit seam is unwrapped before applying that limit.

The replacement car, participant, and driver bindings are published only after finding a clear position. An occupied search window leaves the original car, controls, and progress intact and reports that the road is occupied. Regressions cover an angled rival, a blocked route start with a successful retry, and the closing seam. In the original reset-and-drive fixture, immediate impact falls from approximately 0.1814 to zero, and the car again makes the required legal progress.

Five older compatibility fixtures also failed on the untouched baseline. Their corrections preserve the underlying response and visibility requirements:

- The A61 rival fixture now explicitly authors and checks the valid measured `C.HUB_LENGTH`, independently of diagnostic `W.LENGTH`, at every detail level.
- The motocross collision fixture moves one starting bike 8 cm closer so both geometric corrections clearly exceed its original 5 mm precondition. All original heave, speed, and zero-crash limits remain. Temporarily reintroducing the old incorrect heave calculation produces false vertical speeds above 2 m/s and fails the corrected fixture.
- The Cape Wrenna camera control retains all 44 historical venue hashes. It explicitly accounts for one camera's documented 0.6 m displacement after an earlier unsafe grandstand was removed, while retaining its height, metadata, and the other nineteen records.
- The GP fork-crown fixture accounts for the aluminium carrier and steel batches already added by the carbon-rotor revision. It checks those six wheel materials individually and retains the original 21/9 mesh budget for the rest of the high/mid steering assembly, together with the crown-visibility and opaque-lid negative controls.
- The retail loading fixture bypassed the real interface constructor without supplying its always-initialized Bike HUD. It now supplies that dependency, preserves every loading-label check, and also verifies one practice reset for a session and none when hiding the loading context.

These fixture corrections do not change the existing artwork, camera placement, or motorcycle collision response.

## 7. Integrated vehicle benchmark

All eleven existing production dynamics scenarios pass at a 1/240-second step on analytic runway, skidpad, and kerb fixtures. The checks detected no nonfinite chassis/contact states, negative tire loads, or quaternion normalization drift. Repeated steering did not produce a growing yaw oscillation; after steering returned to zero, yaw rate settled to approximately 5.82 × 10⁻⁹ rad/s.

| Initial braking speed | Stopping distance | Stopping time |
| --------------------- | ----------------: | ------------: |
| 100 km/h              |           19.38 m |        1.46 s |
| 200 km/h              |           55.90 m |        2.37 s |
| 300 km/h              |           97.56 m |        2.96 s |

These are outputs of the authored APX model, not comparisons against measured stopping distances. The machine-readable [validation record](physics-v18-validation.json) preserves the full dynamics report, source fingerprint, and wheel-probe measurements. Existing generic historical benchmark reports are not overwritten.

## Reproduction, compatibility, and acceptance

Run from the repository root after installing its locked dependencies:

```bash
node --experimental-transform-types scripts/wheel-solver-probe.ts
node node_modules/vitest/vitest.mjs run tests/wheel-solver-accuracy.test.ts tests/tire-motion-invariance.test.ts tests/suspension-droop-direction.test.ts tests/regenerative-braking.test.ts tests/presentation-velocity.test.ts
node node_modules/vitest/vitest.mjs run tests/snapshot-interpolation.test.ts tests/rotation-interpolation.test.ts tests/camera-dynamics.test.ts tests/motion-blur.test.ts tests/wheel-winding.test.ts tests/wheel-pose.test.ts
node node_modules/vitest/vitest.mjs run tests/open-world-reset-occupancy.test.ts tests/open-world-session.test.ts
npm run test:dynamics
npm run check
```

The wheel probe optionally accepts an absolute path to the historical tire module; its imports must resolve against the matching source dependencies. Optional warmed timing results concern isolated solver workloads, not full-game frame rates.

Fifty new regressions cover wheel convergence/work, tire motion invariance, droop/directional geometry, regeneration, presentation derivatives, and occupied-road recovery. The complete scan used the same stage sequence as `npm run check`, with two test workers:

```bash
npm run lint && npm run validate:content && npm test -- --maxWorkers=2 && npm run build
```

| Acceptance stage                                             | Observed result                                                                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Complete regression scan on `c46ef21` plus this revision     | 553 files / 4,891 tests; 550 files / 4,882 tests passed initially, with nine failures described below; 940.84 s |
| Festival integration and explicit full-scan failure rechecks | All 10 files / 55 tests passed; 20.31 s                                                                         |
| Final lint and content validation                            | Passed                                                                                                          |
| Final TypeScript check and production build                  | Passed; Vite build completed in 16.58 s                                                                         |
| Final production dynamics and wheel probe                    | 11/11 scenarios and 12,000 wheel updates passed                                                                 |

Eight initial failures came from two command-line QA suites whose subprocess capture was blocked with `EPERM`. They reproduced on the untouched baseline and passed unchanged when subprocess access was permitted. The ninth was the incomplete retail loading fixture described above; its four tests passed after supplying the constructor dependency. No reported failure remains unresolved. The initial full-scan command exited 1 before reaching its build stage; the final integration pipeline independently completed lint, content validation, the affected tests, TypeScript, and the production build with exit 0. This is acceptance across the documented runs, not a claim that the initial shell command exited successfully.

The first integration with `47de488` preserved a separate Festival rendering update. It did not change this revision's physics or interpolation code. That 55-test gate contains all fourteen tests in the three initially failing suites plus 41 checks of the affected body construction, materials, presented-velocity consumers, road metadata, and contact/paint agreement. Counts overlap the full scan and must not be added as unique tests. Publication then encountered the independently published MotoGP revision `c5469f4`. Integrating it introduced no conflict with the v18 physics or presentation-derivative code. Its seven-file focused run initially passed 90 of 94 tests; four fork-crown cases still assumed the old hardware count. The fixture now explicitly checks the single steering-owned deforming hose and the new Mid reservoir material batch before excluding those identified additions from the original 21/9 remainder budget. All crown visibility, wheel-material, replay-identity, and opaque-lid checks remain. The two relevant suites passed all twelve tests after that correction. Six further rider/brake/presentation consumer suites passed all 33 tests. This resolves all 127 distinct tests across thirteen affected files; the twelve rechecks are already included in that count. Final lint, content validation, TypeScript, and production build passed.

The wheel and vehicle numerical reports use source fingerprint `c55d556fc08a0f2afeaebf99e17650c069e2a978825be4a857d19ed6601411cd`; every dynamics measurement and wheel-probe value exactly matches the earlier `2a2099fea04b5ee0d027338027d5c002432e670d9db905148d1c554301236ffd` run. The build retains the existing large-chunk advisory.

The last integration preserved motocross revision `96ad59d`, which changes no v18 force solver or pose-derivative module. Its new spine is isolated to the motocross kit; its linked challenges consume motion observations without feeding forces back into physics. The seven directly affected rider/garment/spine/tire-finish/flow/shared-presentation suites passed all 62 tests in 7.36 seconds. The complete final lint, content, focused-test, TypeScript, and production-build pipeline exited 0. The final repository source fingerprint is `29db7a970b3f6418a7c94dba4bbd690d2f2d4bdd7438409f249d40eca7d3eb69`. The numerical reports retain their earlier `c55d556…` fingerprint explicitly; their relevant solver modules are byte-for-byte unchanged by this last integration.

Browser acceptance passed all four focused specifications in 26.9 seconds: real cross-origin simulation/CSV workers, wheel alignment across detail levels, tire deformation and recorded rewind, and GPU motion vectors. The built application's live-session check also passed: driving, four-wheel engineering telemetry, cockpit/driver/mirror checks, pause and resume, and no console/page errors. These checks ran on a verified ANGLE Vulkan SwiftShader backend. They establish functional rendering acceptance, not physical-GPU frame-rate performance. The selected live-session case does not itself test a telemetry-export replay; recorded tire rewind is covered by the focused specification. The validation record keeps each browser run's source fingerprint and timing: browser checks preceded the independent Festival, MotoGP, and motocross rendering updates, whose affected paths received the integration checks above. The newly integrated MotoGP and motocross rendering paths have geometry/integration checks and a build, without refreshed browser receipts from this v18 task.

Physics identity advances to v18 because behavior and lap times can change. Existing circuit/vehicle/physics record categories keep older physics records separate. The snapshot layout is unchanged.

The hub remains a massless reduced model; grip, hydroplaning, thermal coefficients, and anti-geometry remain approximations. Regeneration is an operator-split allocation, not a simultaneous motor, clutch, and limited-slip differential solve. Its conservative sign guard may reject recoverable energy that a more complete coupled model could retain. Presentation reconstructs sparse samples and cannot recover an unrecorded impact history. No measured telemetry parity, real-car certification, or equivalence to iRacing is established.
