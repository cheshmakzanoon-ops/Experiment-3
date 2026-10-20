# Physics v17: surface history, directional controls, driveline contact, and camera motion

Date: 2026-10-20

Simulation identity: `SIMULATION_VERSION = 17`

Status: engine published to `main`; production bundling, complete TypeScript checking, focused regressions, and deterministic replay checks passed. The remaining acceptance limits are recorded below.

## 1. Scope and technical references

This revision improves the relationship between road conditions, tire grip, driver assistance, driveline inertia, and the motion presented to the player. It fixes demonstrated correctness defects and adds a reduced pavement thermal model. It does not certify the game against real vehicle telemetry or reproduce iRacing's proprietary engine.

| Area                 | Implemented behavior                                                                                                                | Main implementation                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Wet rubber           | The dry rubber advantage reverses smoothly as a local water film develops on sealed pavement.                                       | `src/simulation/surface-material.ts`, `src/simulation/tire.ts`                              |
| Pavement history     | Surface and substrate temperatures exchange heat; rainfall, evaporation, exposure, wind, and eligible tire work affect the surface. | `src/simulation/surface-thermal.ts`, `src/simulation/track.ts`, `src/simulation/weather.ts` |
| Festival climate     | A reference pavement column retains temperature history and can dry through evaporation after rain.                                 | `src/simulation/open-world/open-world-track.ts`                                             |
| Driving assists      | TC and ABS distinguish wheelspin and braking slip in either travel direction, using each wheel's road frame.                        | `src/simulation/driving-assists.ts`, `src/simulation/vehicle.ts`                            |
| Airborne kart clutch | An unsupported driven wheel prevents fictitious vehicle inertia from entering the clutch synchronization calculation.               | `src/simulation/vehicle.ts`                                                                 |
| Cockpit/pod motion   | Camera acceleration and impact samples share the presented chassis timeline, with analytic integration between observations.        | `src/rendering/camera-dynamics.ts`, `src/rendering/renderer.ts`                             |

### Public iRacing principles used

The reference material supports the qualitative mechanisms, rather than the coefficients or exact equations introduced here.

- [The Sticking Points in Modeling Tires](https://www.iracing.com/the-sticking-points-in-modeling-tires/) explains why tire response depends on coupled load, pressure, temperature, surface, and deformation states, and why linear, peak, and post-peak slip behavior all matter. This supports evaluating actual forces and changing contact conditions rather than judging realism from a single grip constant.
- [Physics Modeling: NTM V7 Info](https://www.iracing.com/physics-modeling-ntm-v7-info-plus/) describes carcass/contact-patch motion and pressure/temperature-dependent behavior. It explicitly withholds much of the proprietary mathematics. Its 2018 FAQ describes a 360 Hz physics update and twice-per-step force evaluation; that is a historical public statement, not a verified specification of today's iRacing implementation. This project retains its existing 120 Hz worker schedule and four-wheel internal step limit of 1/240 s.
- [iRacing Developer Blog: S4 Updates to the Dynamic Track Model](https://www.iracing.com/iracing-developer-blog-s4-updates-to-the-dynamic-track-model/) explains how subsurface temperature layers preserve thermal history and how water evaporation affects surface temperature. The two-reservoir model below is an original reduced approximation of those principles.
- [Rain Q&A](https://support.iracing.com/support/solutions/articles/31000172636-rain-q-a), modified June 17, 2024, explains the lower wet grip of heavily rubbered and polished racing lines. It provides the qualitative basis for the local wet-rubber inversion, without providing the numerical penalty used here.

No iRacing source code, tire coefficients, proprietary construction data, or measured track datasets were used. The clutch and assist corrections follow this project's force and energy accounting; the camera correction follows its existing analytic spring model.

## 2. Local wet-rubber grip

Previously, the rubber term always increased grip, including on wet sealed pavement. The shared `peakGrip()` now uses `rubberGrip(material, rubber, waterMm)`.

For a sealed material, the authored road-interface multiplier is:

```text
coverage = clamp(rubber, 0, 1)
film = max(0, waterMm)
wet = film / (film + max(0.05, 0.35 * textureMm))
rubberFactor = 1 + coverage * (0.05 * (1 - wet) - 0.18 * wet)
```

The existing 5% dry gain at full coverage remains. The multiplier approaches a maximum 18% loss as a fully rubbered surface becomes thoroughly wet. Clean pavement has a multiplier of exactly one. Unsealed and loose materials also return one; dirt does not acquire a paved racing-line bonus or penalty.

The transition follows the water depth at the actual sampled contact, not a global rain flag. A line can regain grip as its local film clears while a wetter adjacent line remains slippery. The material's macrotexture influences the transition, so smoother sealed surfaces respond to thinner films.

The 5%/18% limits and texture transition are original authored parameters. The iRacing reference does not establish those values. Compound wet performance and speed/load/pressure-dependent aquaplaning remain separate calculations. The new factor changes the road/rubber interface and does not duplicate the aquaplaning term.

Cars and GP motorcycles consume the shared grip function. The GP regression separately changes front and rear sampled road conditions and confirms different available grip. This does not replace the motorcycle dynamics solver with the four-wheel tire solver.

### Controlled braking diagnostic

The experiment uses the production implicit tire/wheel solver with a 250 kg supported mass, a medium tire, zero camber and drive torque, and a constant 4000 N m brake torque. It measures distance from 100 to 5 km/h. Translation responds to the solved longitudinal force and ground drag; distance uses trapezoidal integration. Steering, suspension, aerodynamic forces, and driver assistance are excluded.

| Contact condition                  |    240 Hz |    480 Hz |
| ---------------------------------- | --------: | --------: |
| Dry, clean                         | 23.0325 m | 23.0552 m |
| Dry, full rubber coverage          | 21.9232 m | 21.9428 m |
| 0.6 mm water, clean                | 50.4065 m | 50.4305 m |
| 0.6 mm water, full rubber coverage | 56.4945 m | 56.5213 m |

In this isolated experiment, full rubber shortens dry braking by approximately 4.8% and lengthens wet braking by approximately 12.1%. The largest difference between the two integration rates is below 0.10%. These are solver diagnostics, not measured full-car stopping distances or a claim of real-vehicle calibration.

## 3. Pavement thermal history and water coupling

### Two dynamic temperature reservoirs

`SurfaceThermalStep` tracks a surface temperature and a deeper substrate temperature. For held weather and heat inputs, it solves the linear two-state thermal balance analytically, including the zero eigenvalue of an insulated column. It does not advance a stiff thermal system by an unstable explicit temperature increment.

The modeled balance is:

```text
Cs * dTs/dt = G * (Tb - Ts)
             + h * (Ta - Ts)
             + rainfall * cpWater * (Ta - Ts)
             + qSolar + qTraffic - qEvaporation

Cb * dTb/dt = G * (Ts - Tb) + Gdeep * (Ta - Tb)
```

`Ts`, `Tb`, and `Ta` are surface, substrate, and ambient temperatures. The deeper environmental sink is represented by ambient temperature; there is no third dynamic earth-temperature state.

| Parameter                          | Authored value | Units                                                              |
| ---------------------------------- | -------------: | ------------------------------------------------------------------ |
| Surface heat capacity, `Cs`        |         21,000 | J/(m² K)                                                           |
| Substrate heat capacity, `Cb`      |        168,000 | J/(m² K)                                                           |
| Surface/substrate conductance, `G` |             45 | W/(m² K)                                                           |
| Deep conductance, `Gdeep`          |              3 | W/(m² K)                                                           |
| Base air exchange                  |             12 | W/(m² K)                                                           |
| Wind coefficient                   |              4 | Multiplies the square root of wind speed in the air-exchange model |
| Unoccluded solar flux scale        |            260 | W/m², multiplied by `1 - cloud`                                    |
| Water latent heat                  |     2.45 × 10⁶ | J/kg                                                               |
| Water heat capacity                |           4180 | J/(kg K)                                                           |

These values are engineering approximations, not measurements of the game's fictional venues or iRacing parameters. The solar term is a reduced cloud/exposure input. It does not model astronomical sun position, material-specific albedo, or arbitrary scene shadows.

### Evaporation uses actual available water

The evaporation demand depends on surface saturation vapor pressure, an ambient vapor-pressure proxy, and wind. The existing weather protocol has no humidity channel. The model explicitly uses the authored relative-humidity proxy `0.5 + 0.42 * cloud`, rather than representing it as observed humidity.

Water drainage and evaporation compete for the same film. The implementation determines when the film dries and restricts subsequent evaporation to incoming water. Latent cooling uses the amount that actually evaporates. A dry cell cannot continue losing latent heat from an empty film, and water removed by drainage is not counted as evaporated water.

Incoming rain also exchanges sensible heat at the assumed ambient temperature. `advanceWet()` uses its actual local rainfall argument for both the water balance and sensible cooling. A cell with zero incoming rain cannot cool from a different global rain rate selected during preparation. Standalone `advance()` continues using the rainfall configured by `prepare()`.

The thermal solution is exact for held inputs. Evaporation is evaluated and held over each production surface interval; the coupled nonlinear weather/evaporation history is not claimed to have an exact continuous solution.

### Circuit evolution and traffic work

Circuit cells retain both temperature states and advance on fixed 0.5 s surface intervals. The update preserves any remainder and visits the appropriate weather endpoints when a call spans multiple intervals. This removes dependence on which caller first happens to cross the half-second boundary for the tested weather-only histories.

Eligible four-wheel contacts deposit the road share of dissipated tread work into the contacted circuit cell. The existing tire thermal model retains 62%; the road receives the complementary **38%**. Work accumulates in double precision and is divided by cell area and interval duration to obtain heat flux. Cells are not heated by airborne contacts or by contact work reported on excluded off-grid materials. The accumulator is consumed once per surface update.

Roofed rows receive no direct solar term or rainfall. Local catchment rainfall also controls sensible cooling and rain-driven rubber wash-off. Surface temperatures and water still use their existing grid storage precision.

This does not establish closed global energy conservation. In particular, the tire thermal model's conductive exchange with the road is not reciprocally deposited into this grid, other vehicle/engine heat sources are not modeled here, and arbitrary traffic work accumulated across delayed multi-interval calls is not reconstructed as a timestamped history.

### Festival, GP, and motocross limits

Festival uses one reference pavement climate column instead of a circuit temperature grid. Contact samples read that column's temperature. Its `interact()` remains empty, so this revision does not add spatially localized vehicle heating or rubber deposition to the open world. The reference film now permits evaporation to dry the road after rain, rather than only exponential drainage.

GP and motocross retain their existing reduced tire-temperature updates driven by utilization and wetness. They do not adopt the four-wheel multi-node tire thermal solver, nor do their adapters deposit the new 38% road-work share. GP can use the shared sampled road-grip term, including wet rubber, without those stronger thermal claims. Loose motocross surfaces remain outside the sealed-pavement rubber model; this revision does not introduce a new soil heat/moisture solver.

## 4. Driving assistance in the wheel's travel direction

The tire solver reports signed longitudinal slip in a fixed wheel-forward frame. Consequently, powered reverse wheelspin has negative raw slip, while a wheel locking during reverse travel has positive raw slip. The former TC and ABS checks interpreted only the forward signs.

`drivingSlip()` reorients that measured slip for the controller: positive means wheelspin along travel, and negative means braking slip. It preserves the magnitude. Direction comes from the contact velocity projected onto that wheel's road-tangent forward vector, including steering and chassis angular motion. Near rest, it falls back to wheel rolling direction and then requested drive direction.

TC consumes the retained contact velocity and basis belonging to the same completed substep as its tire-slip sample. ABS resolves the direction from the current contact velocity. Both remain discrete feedback controllers; this is not a new simultaneous control/tire solve. ABS continues releasing frictional and regenerative brake torque together. Raw mode continues permitting genuine wheel lock.

The 11 new regressions cover forward/reverse braking and wheelspin at three chassis headings, near-rest behavior, raw-mode lockup, and a chassis spin where a driven contact travels backward despite zero center-of-mass translation.

## 5. Airborne kart clutch energy correction

The kart-specific effective inertia adjustment previously assumed that a low-slip driven wheel could borrow a share of vehicle translational inertia. It did not require road contact. The clutch therefore calculated an impulse against a heavier wheel than the airborne tire solver actually integrated.

A production SK-125 reproduction used zero fuel and battery energy, a manually closed clutch, first gear, and a chassis 4 m above the road. Every tire load was zero. With engine angular speed 100 rad/s and stationary rear wheels, engine-plus-wheel rotational energy rose from **40.00 J to 62.04 J in one 1/240 s step**, while the clutch separately reported **11.77 J** dissipated. Another case at 1000 rad/s engine speed and 60 rad/s rear-wheel speed rose from **4216.00 J to 4257.59 J**. These are pre-fix diagnostics.

The correction allows effective vehicle inertia only when every driven contact has more than 1 N of support. Otherwise, the clutch uses the physical driven-rotor inertia. A single free driven wheel is sufficient to disable the additional mass referral.

The six new regressions exercise both kart definitions, verify that unpowered airborne coupling does not create rotational energy, include chassis rotation and reported clutch dissipation in the diagnostic budget, and check contact loss/reacquisition and a single unloaded driven wheel.

The grounded effective-inertia adjustment remains an approximation. It consumes the preceding tire solve's support and slip, so a newly lost or regained contact changes the referral on the following substep. This one-substep latency is explicit in the regression. The change does not claim a globally closed energy budget or a fully coupled engine/clutch/differential/tire constraint solve.

## 6. Camera motion follows the presented simulation

The cockpit and pod camera previously used acceleration and impact from the newest raw snapshot while the visible chassis used a delayed/interpolated presentation state. Camera recoil could therefore lead the movement it was intended to communicate.

The renderer now supplies the camera's lateral, longitudinal, vertical, and impact channels from the same presented frame as the chassis. A zero-time observation establishes the baseline after a cut, pause, or replay seek without moving the spring or replaying an old impact.

The critically damped spring integrates a linearly changing target over the observed interval. Small-argument series keep very small simulation-time advances numerically stable. Positive changes in the recorded impact envelope are integrated over the interval, replacing a per-render-frame rise threshold that could discard high-refresh-rate impacts. Falling impact values do not create a second strike.

### Numerical camera probe

For an ideal impact envelope rising from 0 to 0.4 over 0.25 s, the analytic forward displacement is **0.0003217970200495814 m**.

| Render rate |  Previous implementation |                    Updated implementation |
| ----------- | -----------------------: | ----------------------------------------: |
| 20 FPS      | 0.00029386804777242455 m | Matches analytic reference within 10⁻¹⁸ m |
| 60 FPS      |  0.0003194123102837043 m | Matches analytic reference within 10⁻¹⁸ m |
| 144 FPS     |  0.0003217105502101693 m | Matches analytic reference within 10⁻¹⁸ m |
| 240 FPS     |                      0 m | Matches analytic reference within 10⁻¹⁸ m |
| 1000 FPS    |                      0 m | Matches analytic reference within 10⁻¹⁸ m |

The old 0.01 rise threshold removed the last two responses. The updated result demonstrates consistency for the specified ideal signal, not measured human-head biomechanics or invariance to arbitrary undersampled input. The camera remains a bounded authored presentation response and does not feed forces back into vehicle physics. This revision does not replace rider skeletal animation or wheel/suspension models.

## 7. Validation evidence and reproducibility

The following focused runs completed during implementation. They are separate runs, not a claim that the entire repository suite has passed at the final integrated commit.

| Focus                                              | Files                                                                                                  | Results |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------: |
| Wet rubber and tire/material behavior              | `tyre-model.test.ts`, `wet-rubber-grip.test.ts`, `surface-material.test.ts`                            |   30/30 |
| Surface/substrate/water accounting and integration | `surface-thermal.test.ts`                                                                              |   15/15 |
| Camera response and integration                    | `camera-dynamics.test.ts`, `camera.test.ts`, `cockpit-framing.test.ts`, `race-view-continuity.test.ts` |   63/63 |
| Signed assists and clutch behavior                 | `driving-assists.test.ts`, `airborne-clutch.test.ts`, `clutch.test.ts`                                 |   24/24 |

Targeted ESLint, formatting, and whitespace checks passed for the respective changes. The tire-model walking-pace regression was corrected to test the existing finite elastic-contact behavior: restoring force, finite strain/energy, gradual force buildup, and the force envelope. Production tire behavior was not weakened to satisfy an instantaneous-response assertion.

The thermal tests include insulated heat conservation, supplied heat, held-input subdivision, return of substrate heat, local-rain sensible heat, evaporation dry-out, competition with drainage, surface tick scheduling, one-time localized traffic deposition, sheltered rows, and Festival thermal memory/drying. Those individual accounting tests do not establish conservation for the entire game.

Additional GP validation passed 21 of 22 existing cases within the Vitest wall-time limit. The remaining wet race reached that limit without a physics assertion failure; the same wet case and assertions then passed in a standalone Node run. All eight riders completed two laps at 540.6667 simulated seconds with zero crashes, impacts, penalties, or retirements and a finite frame. This records the distinction between the timed test-runner result and the standalone completed scenario.

The checked-in `scripts/physics-v17-grip-probe.ts` reproduces the eight braking runs and emits JSON containing distances, cutoff speeds, simulated times, percentage changes, and the 240/480 Hz comparison:

```sh
node --experimental-transform-types scripts/physics-v17-grip-probe.ts
```

A combined focused command from the repository root is:

```sh
npx vitest run --configLoader runner --no-cache \
  tests/tyre-model.test.ts tests/wet-rubber-grip.test.ts tests/surface-material.test.ts \
  tests/surface-thermal.test.ts \
  tests/camera-dynamics.test.ts tests/camera.test.ts \
  tests/cockpit-framing.test.ts tests/race-view-continuity.test.ts \
  tests/driving-assists.test.ts tests/airborne-clutch.test.ts tests/clutch.test.ts
```

The command above is a reproduction command; its complete combined run is not implied by the separate focused results. The `runner` configuration loader also avoids Vite's bundled configuration temporary-file path in storage-constrained environments.

### Final integrated validation and commit record

The engine is published in [commit `7911ff7ecd3c628036f01d36ad0f6eb76c3f5fa3`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/7911ff7ecd3c628036f01d36ad0f6eb76c3f5fa3), on top of upstream `8be64a63c762f91d87addb2c553b6e0643a647d0`. The published Git tree was compared with the local committed tree and matched exactly: `2d1f93197456f78ab2eb335db2c09f711be9091e`.

The successful production bundle identifies that same engine commit and source fingerprint:

```text
4a678500a4809b57bd30c76b7796deb5d2d652abf5eea3c5baf9f0fd463a6780
```

The complete machine-readable evidence summary is in [physics-v17-validation.json](physics-v17-validation.json).

| Final check                          | Observed result                                                                                                                                                                               |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete repository TypeScript check | Passed with exit code 0; production source, tests, browser fixtures, scripts, and root TypeScript configuration files included.                                                               |
| Production Vite bundle               | Passed with exit code 0; 772 modules transformed; successful run reported 2 min 23 s.                                                                                                         |
| Changed-file ESLint                  | All 19 changed TypeScript files passed: 18 source/test files together, plus the grip diagnostic separately.                                                                                   |
| Deterministic replay                 | Both existing flashback scenarios passed against the published engine source: 3,000 logged ticks reproduced bitwise twice; rewind and continuation on a new timeline also reproduced exactly. |
| Focused subsystem regressions        | The separate 132 successful checks listed above; this is not a completed whole-repository Vitest run.                                                                                         |
| Source/patch integrity               | Published tree equality, source-fingerprint equality, and whitespace checks passed.                                                                                                           |

The final compiler invocation was:

```sh
node --max-old-space-size=2560 node_modules/typescript/bin/tsc --noEmit
```

Production bundling used the repository's `vite.config.ts` through Vite's build API, with an identical clean public asset tree reused read-only and output directed to temporary storage. The public tree was verified as `2e291e068d7974d776bc92152db98282f9f6e7ea`. This records the completed bundling check; it is not a claim that every command in `npm run check` completed. The successful compiler and bundle used a 2560 MiB Node heap after shared-runtime memory pressure and two smaller-heap bundle failures. No application quality or simulation assertions were reduced to obtain that build.

The production build still reports a large-chunk warning: its entry chunk is 15,616.34 kB after minification, or 4,698.43 kB with gzip. Successful bundling does not establish representative-device startup time, frame rate, or physical-GPU performance.

The replay cases were taken from `tests/flashback-determinism.test.ts` and executed with their original physical inputs and equality assertions through a lightweight synchronous Node assertion bridge. The existing Vitest wall-time deadline was not enforced in that bridge. This distinguishes the completed deterministic-simulation evidence from a claim that the interrupted broader test-runner attempt passed.

The 21-file integrated Vitest attempt and the cockpit/weather Playwright acceptance attempt were interrupted while the shared runtime reached its 8 GiB memory limit. The SwiftShader WebGL2 adapter was successfully identified before the browser attempt, but full scene acceptance was not completed. An isolated Vercel runner was unavailable because its API denied access (403) and no CLI fallback was installed. These checks remain explicit limits; the later compiler and production-bundle recovery does not turn them into passes.

At the final status check, the repository's broader [Build and validation workflow](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/39408674981) was queued. Its eventual results are separate from the local evidence recorded here.

## 8. Remaining calibration work

Realism still depends on validation against appropriate vehicle and venue data. Priorities include measured braking/cornering/load-transfer traces, tire temperature and pressure histories, wet friction versus water depth, real humidity and solar/exposure inputs, and examination of the effective grounded drivetrain inertia under transient loading. Motorcycle tire thermal behavior and spatial Festival traffic heating remain separate implementation gaps.

Version 17 identifies the changed driving behavior for session/replay comparisons. Prior records remain associated with their earlier physics category. Numerical consistency, plausible qualitative behavior, and corrected energy defects are useful progress; they are not a substitute for measured validation of the complete simulator.
