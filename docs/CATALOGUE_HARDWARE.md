# Catalogue suspension and powertrain response

## Scope and provenance

`src/simulation/catalogue-dynamics.ts` supplies authored hardware defaults for the 46 catalogue four-wheel definitions. The APX-01 and TC-1 retain their dedicated dynamics blocks; motorcycle adapters retain their separate defaults. The calibration is original engineering work for the game's fictional vehicles, **not measured manufacturer suspension data or transmission telemetry**.

Family selection follows the class, tyre family, drivetrain, powertrain and transmission described in the existing content sheets. The broad road class distinguishes the pickup, classic road car and dual-clutch supercar. The family data removes the blanket zero camber gain, zero roll centres, zero anti geometry and universal 90 ms shift used by the catalogue. Small link-force paths now share load transfer with the springs; finite intake response and class-specific torque interruptions distinguish road manuals, racing transmissions and electric drives.

Existing spring rates, anti-roll bars, ride heights, dampers, tyre laws, torque curves, mass, engine inertia/friction, aero and design-band thresholds are unchanged. These values do not turn the existing suspension model into a measured hardpoint or unsprung-body solver. Kart geometry stays zero, with the stiff chassis settings already authored in its content sheet.

## Units and defaults

Front/rear pairs below follow that order. Camber gain is **radians per metre of bump**, roll-centre height is **metres above the contact patch**, and intake/shift times are **seconds**. Positive camber gain adds negative wheel camber in bump according to the existing solver convention. The source table also authors roll-centre migration and a small progressive spring term.

| Hardware family              | Camber gain F/R (rad/m) | Roll centre F/R (m) | Intake open/close (s) | Torque interruption (s) |
| ---------------------------- | ----------------------- | ------------------- | --------------------- | ----------------------- |
| Modern single-seater         | 0.28 / 0.20             | 0.025 / 0.045       | 0.022 / 0.030         | 0.055                   |
| Historic formula / prototype | 0.18 / 0.12             | 0.035 / 0.055       | 0.040 / 0.040         | 0.180                   |
| Endurance                    | 0.24 / 0.18             | 0.030 / 0.050       | 0.025 / 0.035         | 0.060                   |
| GT                           | 0.28 / 0.20             | 0.040 / 0.060       | 0.040 / 0.040         | 0.075                   |
| Touring                      | 0.25 / 0.18             | 0.055 / 0.075       | 0.050 / 0.045         | 0.095                   |
| Club                         | 0.20 / 0.14             | 0.045 / 0.065       | 0.055 / 0.045         | 0.140                   |
| Historic road                | 0.12 / 0.00             | 0.045 / 0.070       | 0.065 / 0.050         | 0.220                   |
| Road                         | 0.20 / 0.16             | 0.055 / 0.075       | 0.075 / 0.050         | 0.180                   |
| SC-7 sports road             | 0.25 / 0.20             | 0.040 / 0.065       | 0.040 / 0.035         | 0.080                   |
| Utility / offroad            | 0.10 / 0.00             | 0.065 / 0.100       | 0.090 / 0.060         | 0.200                   |
| Rally / rallycross           | 0.15 / 0.12             | 0.060 / 0.080       | 0.045 / 0.040         | 0.070                   |
| Historic rally               | 0.12 / 0.08             | 0.050 / 0.075       | 0.050 / 0.045         | 0.170                   |
| Kart                         | 0.00 / 0.00             | 0.000 / 0.000       | 0.015 / 0.012         | 0.045                   |

Anti-brake and anti-drive parameters are force-line slopes, `tan(theta)`, **not percent anti-dive or anti-squat**. Non-kart braking slopes range from 0.004 to 0.022; drive slopes range from 0.012 to 0.025 and apply only to driven axles. Keeping these small introduces observable mechanical response without creating load or changing tyre grip to recover an acceleration target.

Electric drives use 0.012/0.010 s response and zero pumping drag. Single-ratio drives, including the direct-drive kart, have no shift interruption. The RS-5 and LX-12 automatics use 0.100 and 0.140 s respectively. All multi-gear vehicles still use the existing full torque-cut shift model; this does not simulate an overlapping dual-clutch shift or torque converter.

## Override contract

The new defaults enter through `vehicleDynamics()` before named differential and explicit `VehicleDefinition.dynamics` composition. An explicit suspension, gearbox, engine or differential block remains authoritative. Existing hybrid and driveline blocks on the vehicle definition are unchanged. In particular, the complete turbo engine blocks for HF-86, PR-3, GB-4 and RR-4 retain object identity and their existing turbo response. Their authored engine blocks also retain their original intake settings. `legacyDynamics()` remains available unchanged for regression comparisons. Definitions are not mutated, and the resolved blocks remain cached and frozen as before.

## Verification

The pre-change and changed **48-car** strict runs both passed every existing design band. The changed run executed the actual `scripts/vehicle-calibration.ts --strict --only=...` from a scratch working directory, covering the 46 catalogue cars plus APX-01 and TC-1 at **1/240 s and 1/120 s**. All **192 metric comparisons** passed; maximum printed timestep drift was **0.2%**. `--only` deliberately writes no replacement for the full registry report, which also includes motorcycles.

Representative changed measurements at 1/240 s:

| Vehicle                | 0–100 km/h (s) | Top speed (km/h) | 100 km/h stopping distance (m) | Lateral at 80 km/h (g) |
| ---------------------- | -------------- | ---------------- | ------------------------------ | ---------------------- |
| FX-26 Formula          | 2.35           | 342.71           | 19.02                          | 1.92                   |
| GT-8F                  | 3.43           | 279.09           | 26.02                          | 1.34                   |
| RH-3 Hot Hatch         | 5.33           | 259.78           | 33.57                          | 1.09                   |
| RP-6 Desert Pickup     | 5.47           | 187.00           | 41.53                          | 0.88                   |
| RL-2 Rally             | 4.24           | 192.41           | 34.24                          | 1.06                   |
| SK-125 Kart            | 3.87           | 136.83           | 19.16                          | 1.94                   |
| EH-3 Electric Hypercar | 2.44           | 348.94           | 29.45                          | 1.16                   |

Eight new tests in `tests/catalogue-dynamics.test.ts` exercise the production `Vehicle` with an analytic runway. Four braking transients compare each car against the same car with only anti geometry removed: link geometry reduces brake pitch, changes compressed camber and increases front ride height while speed differs by less than 0.02 m/s and total normal load by less than 1%. The throttle/shift test verifies differentiated finite intake response and actual torque interruption, including uninterrupted single-ratio electric drive. Further assertions cover kart geometry, driven axles, explicit overrides, bike/legacy separation and immutable definitions.

The new tests and the existing catalogue, catalogue-growth and powertrain suites passed **34 tests across four files**. TypeScript checking, focused ESLint and whitespace checks passed. These results establish model consistency and preservation of the design briefs; measured real-vehicle correlation, detailed linkage geometry and hardware-specific transmission models remain future engineering work.
