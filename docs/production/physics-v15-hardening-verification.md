# Physics and animation hardening — verification record

Date: 2026-10-20  
Repository: [Experiment-3](https://github.com/cheshmakzanoon-ops/Experiment-3)  
Primary physics revision: [ca9e098](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/ca9e09861a7fa8b5dfc73dda7b5fad626294512d)  
Follow-up rendering/AI revision: [1e32f47](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/1e32f47f393e84413fa1d37cadf7110cc26a618b)

## Engineering changes

1. **Compliant suspension link loads.** Feed suspension geometry/jacking reactions into the coupled hub and tyre solver rather than adding force directly to already-solved tyre contact. Load, carcass deformation and mechanical travel now share the same force balance, including external work and no-contact resets.
2. **Passive differential impulses.** Integrate viscous shear implicitly, account for known drivetrain/road torque impulses before locking, constrain coupling impulse so predicted free slip is not overcorrected, and apply centre-differential split effects within the same substep.
3. **Relative-air aerodynamics.** Use velocity relative to wind for body-frame yaw and station plunge damping as well as dynamic pressure. Crosswind and ground motion that produce identical relative airflow now produce the same aerodynamic force/moment in isolated checks.
4. **Motocross suspension reference geometry.** Use a fixed factory suspension reference and a calibrated rising-rate spring inverse. Preload and fuel mass change static body heave/rake, not physical mounting points. Placement and recovery reset suspension travel coherently.
5. **One authoritative animated chassis.** Off-road rendering no longer adds another spring-derived body heave/pitch to an already simulated pose. Front fork, rear axle, rigid swingarm, rear brake and chain follow recorded travel. Simulation/rendering placement is checked across levels of detail and replay seeks.
6. **Follow-up integration fixes.** The motocross AI assistance check refreshes road-traffic decisions before assisting a stationary rider, while retaining drive effort earned before a temporary traffic stop. Inspection fixtures derive supported chassis poses from wheel travel rather than moving tyres below the floor. The GPU tyre shader shares an exact CPU-supplied wheel phase sine/cosine pair so unloaded tyre rotation does not change rubber/bead radius.

## Verification performed during development

- An isolated, stiff viscous differential case previously gained approximately 5,522 J over one 60 Hz step; the corrected solution dissipated energy. New tests cover asymmetric wheel inertias, positive/negative drive, slip reversals, torque conservation, and integration timestep sensitivity.
- Added analytic hub series-compliance, work/energy, cambered-road projection and airborne-load-reset checks; added relative-wind equivalence and crosswind-symmetry regressions.
- Added motocross factory-sag, rear-preload, fuel-weight, support-plane, full-stroke, rigid-swingarm, brake-mount, replay-seek and LOD placement checks.
- The controlled driving benchmark passed all 11 cases (including high-speed braking, cornering, slalom and kerbs).
- Three four-car, 320-second weather simulations (clear, changing weather and rain) passed race and pit-stop completion requirements.
- Motocross launch calibration bands and 20 jump survey cases passed on the integrated source.
- A combined focused run on the integrated source passed **211 tests across 25 files**. This is not a claim that every repository test or browser end-to-end flow passed.
- Individual GPU tyre and motocross articulation probes passed after corrections. A complete browser/GPU regression on the subsequently merged source was not conclusively recorded during this run.
- Lint passed and a production bundle was built during verification. A final independent production build and complete test suite on the very latest combined GitHub head remain appropriate CI release gates.

## Model limitations and honest interpretation

This work is *inspired by general professional simulation practices*, including aspects publicly discussed by iRacing, not a copy of its proprietary physics implementation. Differential passivity is guaranteed relative to the predicted, operator-split free wheel speeds, not a globally solved simultaneous tyre/clutch/driveline constraint. The off-road bike uses a reduced vertical model and approximate rendered geometry; the very tight stationary support checks should not be interpreted as experimental motorcycle validation. Real-world tyre force maps, damper dyno data, measured inertias, surface measurements, and replayed telemetry are still needed before describing the game as iRacing-equivalent or quantitatively hyperrealistic.

The base upgrade changed the lap-record physics identity to **version 15**. Concurrent, independently merged work advanced that identity to version 16. These records are intentionally not treated as directly compatible across versions.

## Recommended remaining release gates

Run the full unit/physics/e2e/CI matrix on a stable machine against the current GitHub head; compare simulated braking distances, steady-state lateral acceleration, transient steering response, suspension travel, and dirt-bike takeoff/landing behaviour against instrumented real-world data; repeat GPU tests on target desktop/browser hardware. Keep regressions and measured outcomes, not visual impressions alone, as acceptance evidence.
