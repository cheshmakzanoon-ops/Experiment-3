# Aerodynamic coupling and isolated vehicle-dynamics gates

## Implemented change

The aerodynamic system now samples an original 9 by 9 front/rear clearance table and independent pitch-response samples. The table retains the documented floor choking/clearance calibration; it is **not measured CFD or a real Formula car dataset**. Coefficients remain dimensionless and loads remain proportional to dynamic pressure. Two floor stations are transformed by the rigid-body orientation before clearance is measured, so pitching the chassis actually changes the front/rear aerodynamic state. Out-of-domain clearance remains nonnegative and high-clearance floor suction decays rather than persisting above the track.

Wake overlap now fades continuously at its beginning, end, speed threshold, lateral envelope and vertical envelope. Opposing and vertically separated cars do not receive a rear wake. Aquaplaning susceptibility now responds to wheel load as well as compound, water depth and speed. An unloaded tire no longer removes water or deposits rubber beneath a flying car, and airborne rotation no longer cleans or picks up surface contamination.

## Three passes for this change

1. Functional: sampled coefficients, actual clearance geometry, finite wake, load-dependent wet contact and isolated test surfaces.
2. Engineering validation: eight new unit/property regressions, the complete existing suite, dry/changing/rain traffic scenarios, and eleven isolated dynamics cases.
3. Review: preserve SI units and force-driven motion; retain the old calibration as explicit data; check boundary continuity, state ownership, no airborne surface mutation, and no per-query aero-map allocations. Browser/GPU presentation is unchanged by this checkpoint and remains subject to the browser workflow.

This is a focused subsystem review, not the three final whole-project audits.

## Executable benchmarks

Run `npm run test:dynamics`. `npm run test:physics` also runs these cases after the weather scenarios. `docs/dynamics-benchmark.json` records the source fingerprint, the fixed 1/240-second step, every measurement and any failed assertion. Failures produce a nonzero exit code.

The isolated fixtures replace only surface geometry: an analytic runway, an 80 m-radius skidpad, and one-sided smooth 25, 55 and 85 mm kerbs. They use the production chassis, clutch, drivetrain, suspension, tires, brakes and aero. They do not assert that a smooth isolated surface is a validation of the circuit's BVH; separate contact tests cover that implementation.

Initial velocity and wheel rotation are set once for defined-speed braking/kerb tests. No pose, speed, tire state or fuel is reset during a measured run. Skidpad speed/path controllers supply only normal throttle, brake and steering inputs. Braking uses unassisted full pedal, so a lockup is an observed tire-model outcome, not a hidden ABS aid.

The first run measured dry stopping distances of 18.86, 54.66 and 96.83 m from 100, 200 and 300 km/h. On the skidpad, measured lateral acceleration was 0.289, 0.792 and 1.515 g; each agrees with the corresponding measured speed/radius within 0.002 g. These are **model results**, not proof of agreement with a real vehicle. Kerb severity increased measured peak load from approximately 3.90 to 5.98 to 7.73 kN. Repeated slalom yaw amplitude remained bounded and decayed after steering ceased.

Remaining whole-project work includes broader multi-car robustness, local race-control flags, stronger driver animation/audio quality, full scenario verification and target-device profiling. Passing these isolated cases is not full master-directive completion.

## Race integration regression and repair

The first candidate passed isolated dynamics but failed the changing-weather whole-field race: three side-by-side cars missed their legal pit entry. Preparation now budgets lateral travel time, and cars blocked outside the entry corridor yield through normal braking to traffic already nearer that corridor. The repeat completed both ten-car three-lap races with zero recorded impacts, and all ten cars serviced their tires in changing weather. Existing legal-entry checks and whole-field acceptance assertions remain intact; neither was relaxed to make the test pass.
