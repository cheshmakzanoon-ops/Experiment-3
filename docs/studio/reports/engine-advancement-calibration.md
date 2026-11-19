# Engine advancement calibration — assignment 23, wave 8

## Result and scope

**All 228 vehicle metric pairs are inside their unchanged design bands at 1/240 and 1/120 second.** This result combines the 48 four-wheel vehicles from the complete initial 57-vehicle run with a final rerun of all nine motorcycles after the narrow motorcycle corrections below. It represents 456 individual band checks. The complete 57-vehicle run was not repeated after every motorcycle-only correction.

The initial full run failed three metric pairs. Those failures were retained, investigated against the stable v25 baseline, and corrected without widening a design band, increasing tyre friction, changing engine/brake hardware, or changing a controller gain. The final nine-bike measurements also record **zero crashes in all 18 runs**; the original strict CLI compares performance bands and does not itself assert crash count.

The original production car dynamics benchmark passes **11/11 cases**. The three original 320-second weather scenarios pass **3/3**. The focused motorcycle/contact suite passes **61/61 tests in five files**; targeted ESLint passes. The numerical evidence, full 57-vehicle values, source manifests, failed initial measurements and scenario output are in [engine-advancement-calibration.json](engine-advancement-calibration.json).

This is calibration acceptance for the measured scope, not complete release acceptance. The seeded GP AI hairpin/race gate was still assigned to the independent wave-9 reviewer when this report froze. Festival static-collider certification and final complete-suite release checks remain attributed to their respective reviewers; they are not silently claimed by these runway measurements.

## What the initial full run found

| Metric                              | Initial 1/240 s | Initial 1/120 s | Unchanged band | Final 1/240 s | Final 1/120 s |
| ----------------------------------- | --------------: | --------------: | -------------: | ------------: | ------------: |
| GP-R1 100–0 km/h distance           |     44.857084 m |     43.878084 m |        30–42 m |   38.641593 m |   38.686482 m |
| SBK-1000 100–0 km/h distance        |     47.586534 m |     47.324085 m |        32–45 m |   41.122867 m |   41.100417 m |
| NR-900 80 km/h lateral acceleration |      0.897842 g |      0.897845 g |      0.9–1.2 g |    0.946472 g |    0.946471 g |

The v25 baseline at commit `0f928c8c0250623eb8cfe4dc439cc273af8c482a` passed all 36 motorcycle metric pairs. Its CLI reported approximately 36.38/36.58 m for GP-R1 braking, 38.85/38.89 m for SBK braking, and 0.95/0.95 g for the NR-900 lateral test. These are the original CLI's rounded baseline values, not extra numerical precision inferred from them. A separate baseline NR trace measured 0.9515096051066475 g at 1/240 second.

### Braking: current pitch geometry must limit the whole brake pair

The failed GP-R1 and SBK measurements each included a real pitch-over crash at 1/240 second. In the SBK trace, rear support reached zero about 0.10 s after brake application, but the front kept applying about 2.73 kN as the nose rotated down. At about 2 s, both tyres had lost support and the chassis pitch had passed −3 radians. Tyre surface temperatures remained around 86 °C with grip near 0.987; thermal fade was not the cause.

The sprung chassis uses the current pitch-dependent normal-force moment arm. The anti-stoppie request still used the upright arm. As fork dive shortened the front support's lever arm, the upright brake threshold continued to permit a tipping moment.

The suspension now publishes an optional `rearLiftForce`, derived from the same reduced pitch equation used by its integrator. With front/rear CG arms `a` and `b`, pitch `theta`, front extension `e`, downforce `D`, front aero share `f`, mass `m`, and the integrator's longitudinal-force height `h`:

```text
frontMomentArm = a*cos(theta) + e*sin(theta)
aeroMoment = D*((1-f)*b - f*a)*cos(theta)
rearLiftForce = max(0, ((m*g + D)*frontMomentArm + aeroMoment)/h)
```

At rear-lift equilibrium the rear normal force is zero and the front supports `m*g + D`. At upright pitch this expression is exactly the previous `staticRear*wheelbase/h` threshold, including aero balance. The existing machine-specific stoppie margin still applies. Rear service braking and engine braking spend the same total budget as the front brake; a final bound on the actual negative force pair also covers rear-only strokes.

The optional input never creates normal support. Actual tyre-force clamps remain authoritative, both contacts still apply zero drive/braking in flight, and near-zero force heights return a finite nonnegative capacity. Placement clears the derived value before the next force step. Standalone and MX paths without this optional road input retain their prior arithmetic.

### Cornering: keep nominal intent separate from available recovery

The NR-900 trace had no crash or grip violation. At a steady 80 km/h, roughly 197 N of drive left the front with 94.96% of its nominal axle share. The new contact-aware target multiplied the already conservative 72% nominal grip policy by that support share again: nominal lean 0.70263 rad was clipped to about 0.67492 rad, while the limiting tyre used only about 73.75% of its friction circle. Mechanically driven tyre cooling caused a smaller additional change from the old ideal-temperature model.

The correction is an **intent-versus-capacity contract change**. It is not a claim that the earlier support derating violated a tyre force law. The authored 72% nominal lean scale is unchanged. A separate physical target limit now leaves the documented 10% headroom inside the existing 96% recovery budget, using the weaker contact's actual load, its own friction and the same camber factor as recovery. An already arrestable nominal request is preserved; severe unloading and split grip still clip it.

The physical target inverts the actual ordinary-road roll equilibrium, including full rider hang-off. If `q = riderOffsetMax*0.25/h`, `r = totalNormalLoad/mass`, and `c = 0.9*0.96*currentLateralCapacity/r`, it solves `sin(phi) + q = c*cos(phi)`. Zero reaction produces a zero physical target. This replaces the old nonzero minimum intended for the nominal surface-grip scale, while retaining that nominal policy for standalone callers.

### Roll stopping: integrate the remaining moment and account for response

The stronger contact tests exposed why an otherwise feasible target could still be crossed too quickly. Multiplying the current restoring acceleration by the remaining lean angle overestimated stopping work: the opposing contact moment decreases toward the target. The road controller now integrates that moment, including rider-offset torque:

```text
E = [budget*direction*(sin(target)-sin(start))
     + reaction*(cos(target)-cos(start))
     - reaction*(riderOffset*0.25/h)*(target-start)] / h
allowedRate = sqrt(2*max(0,E)*existingStopShare)
```

The existing finite rate tracker also travels `leanRate/rateGain` before a zero-rate command settles. The stopping calculation and target error therefore start from `lean + leanRate/rateGain`; force inversion still uses the current physical lean. The authored rate gain, roll gain, 0.75 stopping share, grip and damping values are unchanged.

The regression matrix uses held full intent with front or rear support reduced to 18%, or either tyre at 25% grip. All four conditions pass at both physics rates with default 1.2/s damping, the softest authored 0.6/s damping, and an additional zero-damping stress case: **24 cases**, all remaining within their actual friction circles and settling with the limiting tyre at 86.4% use. Separate checks preserve a feasible nominal lean exactly and keep airborne forces at zero.

## Final motorcycle measurements

Every cell lists **1/240 s / 1/120 s**. Display values are rounded; the JSON retains full precision. Acceleration is seconds to 100 km/h, top speed is km/h, stopping distance is metres from 100 km/h, and lateral acceleration is the original filtered 80 km/h metric.

| Vehicle |       0–100 s |  Top speed km/h |         100–0 m |           Lateral g | Crashes |
| ------- | ------------: | --------------: | --------------: | ------------------: | ------: |
| gpr1    | 3.029 / 3.025 | 353.68 / 353.67 | 38.642 / 38.686 | 1.452632 / 1.452640 |   0 / 0 |
| sbk1000 | 3.163 / 3.158 | 307.63 / 307.61 | 41.123 / 41.100 | 1.198611 / 1.198611 |   0 / 0 |
| gpr2    | 3.071 / 3.067 | 342.51 / 342.53 | 36.821 / 36.857 | 1.455471 / 1.455447 |   0 / 0 |
| ss600   | 3.479 / 3.475 | 265.34 / 265.33 | 40.496 / 40.497 | 1.147285 / 1.147283 |   0 / 0 |
| nr900   | 3.346 / 3.342 | 224.34 / 224.34 | 43.714 / 43.608 | 0.946472 / 0.946471 |   0 / 0 |
| cr750   | 4.213 / 4.208 | 236.98 / 236.99 | 49.525 / 49.510 | 0.911603 / 0.911602 |   0 / 0 |
| mx450   | 5.079 / 5.108 | 140.37 / 140.37 | 46.164 / 46.279 | 0.798342 / 0.798436 |   0 / 0 |
| mx250   | 4.983 / 5.000 | 128.55 / 128.56 | 45.547 / 45.571 | 0.798321 / 0.798422 |   0 / 0 |
| sm450   | 4.750 / 4.767 | 150.00 / 149.99 | 44.022 / 44.103 | 0.989051 / 0.989158 |   0 / 0 |

The MX-450, MX-250 and SM-450 comparison records are bit-identical to their initial full-run records, including both timesteps. This checks the intended opt-out from the road-only brake-capacity and rider-control corrections.

Across the final combined 57-vehicle evidence, the largest observed relative timestep drift is **0.574241%**, for `mx450` / `accel0to100`. The original strict script checks both measurements against their design bands; it reports drift but does not define a separate drift pass threshold. This report does not invent one.

## Original car and scenario gates

The original dynamics benchmark covers 100/200/300 km/h braking, stopping-distance ordering, three skidpad speeds, repeated slalom and three kerb heights. All 11 cases pass without changed fixture thresholds. The 25 m/s skidpad has radial RMS about 0.326 m; the 35 m/s case about 1.132 m. Their measured lateral accelerations agree with the corresponding kinematic values within the original checks.

Each weather case uses four production cars for 320 simulated seconds, retaining its original finite-state, fuel, battery, lap and pit assertions.

| Weather    | Completed laps by car | Pit stops by car | Maximum km/h | Result |
| ---------- | --------------------- | ---------------- | -----------: | ------ |
| clear      | 5, 6, 6, 6            | 1, 0, 0, 0       |       304.27 | Pass   |
| changeable | 4, 4, 3, 3            | 1, 1, 1, 1       |       302.46 | Pass   |
| rain       | 4, 4, 4, 4            | 0, 0, 0, 0       |       280.51 | Pass   |

Elapsed timings in the JSON were recorded on a shared CPU while other agents worked. They are test execution durations, not frame-rate or target-hardware performance measurements. The car force sources stayed byte-identical between the complete initial run and the final motorcycle snapshot. The intervening protocol/contact-record changes describe road-bike presentation and leave the car contact record path unchanged.

## Reproduction and source identity

Run the original commands from an isolated copy of the checkout. The full calibration, dynamics benchmark and weather script write generated files under `docs`; this review used scratch copies so existing committed calibration documents were not silently replaced.

```sh
node --experimental-transform-types scripts/vehicle-calibration.ts --strict
node --experimental-transform-types scripts/dynamics-benchmark.ts
node --experimental-transform-types scripts/validate.ts
node --experimental-transform-types scripts/vehicle-calibration.ts --strict --only=gpr1,sbk1000,gpr2,ss600,nr900,cr750,mx450,mx250,sm450
./node_modules/.bin/vitest run tests/road-bike-braking-geometry.test.ts tests/road-bike-intent-capacity.test.ts tests/road-bike-suspension.test.ts tests/road-bike-contact-surface.test.ts tests/road-bike-control-reserve.test.ts
```

The final scratch evidence collector adds crash counts to the report and writes that report when `--only` is used. Measurement functions, rider inputs, target bands, comparisons and strict exit behavior remain identical to the original script. It records 36 passing metric pairs and zero crashes in both measurements of all nine bikes.

- Initial full-run base commit: `4e3d65c8485aa81d2e720b99a7616923a359b35e`.
- Initial aggregate: `6bb5fe0212f774773be9f489913779f3cd8980a3172a079fff318eefa2af4868`.
- Final motorcycle snapshot captured: `2026-11-19T06:56:21.588470+00:00`.
- Final motorcycle aggregate: `3731fbbf518aa377159c0f6efd97da6ea6cfa9b62589bd8e3975cd43b77c965d`.
- Original dynamics benchmark's separate whole-`src` fingerprint: `7ec7cef5d3b009b2680d182cd4f5a7be7b685d9f6fe40833f54afee329d538e5`.

Each engine aggregate hashes all 173 TypeScript files under `src/core` and `src/simulation`, sorted by relative path, with each record encoded as `path`, NUL, file SHA-256 and newline. The JSON contains the full initial map and the six final changed hashes, so either snapshot can be verified precisely. The final GP force-preview code is the rear-only checkpoint supplied by assignment 20; later assignment-25 GP changes require their own affected-machine rerun.

| Final source                             | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `src/simulation/bike.ts`                 | `6a997eeb6d8455c1f4ae2ee76e70a9682f09d12c3b676ab839b7695aa60a5c44` |
| `src/simulation/bike-vehicle.ts`         | `f9fc88261177dd83a4c46a0bb196630d7c635054f31c370ca89880e04c019fab` |
| `src/simulation/road-bike-suspension.ts` | `f2a0787ea34795ad4f826cfd8e33c07048e8251651b39052a0806cae835904f1` |
| `src/simulation/motogp-physics.ts`       | `c571841bfa76e9ab1e10d6d8d320df84b840f075f4f1bc6b9369a499945aac48` |

The class hardware, springs, dampers and design bands describe the game's fictional machines. Passing them does not establish measured manufacturer calibration, complete spatial motorcycle physics, or a console rendering quality/performance result. The heave/pitch model remains a reduced model with point support and no unsprung tyre masses.
