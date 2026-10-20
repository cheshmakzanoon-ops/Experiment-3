# Engine dynamics v14: static contact, rolling work and motorcycle pose rates

Simulation version 14 improves three physical connections in the existing engine:
tyre contact supports a stationary vehicle, carcass rolling work supplies its own
heat, and motorcycle motion channels describe the orientation actually recorded
and rendered. This is original engineering on the existing production solvers.
The coefficients remain authored calibrations, not manufacturer measurements.

The changes build on the [v13 coupled contact and finite footprint](ENGINE_DYNAMICS_V13.md)
and the [v12 wheel/contact and rotor thermal solve](ENGINE_DYNAMICS_V12.md).
The complete model reference is [PHYSICS_MODEL.md](PHYSICS_MODEL.md).

## Public iRacing references and their application

iRacing's public engineering describes useful principles; it does not publish
the proprietary equations and data needed to reproduce its engine.

| Public reference                                                                                                             | Principle applied here                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dave Kaemmer, [The Sticking Points in Modeling Tires](https://www.iracing.com/the-sticking-points-in-modeling-tires/) (2010) | Vehicle behavior must follow contact forces, including combined longitudinal/lateral slip.                                                        |
| Dave Kaemmer, [Physics Modeling: NTM v7 Info, Plus](https://www.iracing.com/physics-modeling-ntm-v7-info-plus/) (2018)       | Carcass compliance, contact motion, load, pressure and temperature belong in a connected physical model; rolling drag consumes mechanical energy. |
| [iRacing Development Update, February 3, 2023](https://www.iracing.com/iracing-development-update-february-3-2023/)          | Thermal and conditioning behavior should be investigated together with mechanical response.                                                       |
| [iRacing Development Update, November 2024](https://www.iracing.com/iracing-development-update-november-2024/)               | Initial tyre response and sustained-load response require distinct treatment.                                                                     |

These references motivated checking the consistency of the game's existing
contact, work and motion states. They do not validate this game's calibration,
establish handling parity with iRacing, or imply that a finite-element tyre model
has been implemented here. The existing 120 Hz worker and 240 Hz car substeps
are retained; no undocumented iRacing update rate is asserted.

## 1. A loaded tyre retains contact deformation at rest

### The previous defect

V13 multiplied both contact relaxation lengths by a walking-speed fade. Below
3 m/s that removed the elastic contact state and selected an algebraic slip
law. Such a law produces no supporting force at exactly zero slip, so a parked
car needed persistent downhill creep to balance gravity despite locked brakes.

### The implemented behavior

`tyre-force.ts` retains finite, load/pressure/wear-dependent contact compliance
at zero road speed. The longitudinal and lateral contact strains still use the
existing coupled backward-Euler solve and a shared friction ellipse:

```text
x_trial = (x_old + dt * slip_x) / (1 + dt * renewal_x)
y_trial = (y_old + dt * slip_y) / (1 + dt * renewal_y)
```

Near rest, renewal of the contact material follows actual road, lateral and
trial wheel-rim motion. It vanishes when all those motions vanish, allowing
existing elastic deformation to support a static load. A spinning wheel on a
stationary car and a wheel sliding sideways still renew their contact state.
The moving-law renewal returns to its previous value by 3 m/s. Contact stiffness
now remains finite throughout the former 3–12 m/s fade; the former moving solve
is recovered at 12 m/s and above for identical prepared states and inputs.

The elastic contact includes a small parallel material damping term. Its
coefficient is `c = K * contactDampingTime`, using an authored 0.004 s construction
parameter, with a smooth fade from 1 to 3 m/s. This coefficient is independent of
the integration timestep. The friction projection scales the spring strain and
viscous force together; internal viscous work heats the carcass without creating
tread wear. At zero motion the viscous force is zero and the elastic preload
holds. Exact spring/damper cancellation preserves the remaining elastic strain.

This term resolves an underdamped pitch/longitudinal mode exposed by the original
drop-settling regression after static compliance was introduced. The unchanged
6-second, 0.01 m/s settling limit now passes for both Formula and touring cars at
60, 120 and 240 Hz, together with the original energy bounds.

Releasing the brakes and exceeding available friction both allow motion; no
vehicle-position or velocity clamp holds the car. Loss of contact clears the
elastic reservoir using the existing accounted heat path. Placement/recovery
clears stale contact forces and work channels so they cannot feed the next
differential prediction.

The existing discrete spring budget remains:

```text
force * slip * dt
  = change in recoverable elastic energy
  + physical sliding/projection loss * dt
  + internal damping/reservoir-release power * dt
  + backward-Euler numerical loss
```

Numerical damping is not counted as physical heat or tread wear. The existing
camber power port and instantaneous contact-frame approximation retain their
documented limits.

### Measured parking behavior

The production `Vehicle` runs on an analytic 10° plane with zero fuel, neutral
gear, zero throttle and full brakes. The fixture allows 8 seconds to settle,
then measures displacement over the following 20 seconds. The following are
absolute drift distances; they exclude initial placement/suspension settling.

| Scenario                 |        V13 |         V14 | Outer update rates |
| ------------------------ | ---------: | ----------: | ------------------ |
| 10° cross-slope          | 606.046 mm | 0.000930 mm | 60, 120 and 240 Hz |
| 10° longitudinal incline | 346.887 mm | 0.000485 mm | 60, 120 and 240 Hz |

The reported drift, end speed and final wheel-lock status are identical at all
three outer rates in this constant-input fixture. All four wheels are locked at
the end of each run. The small remaining displacement
is settling motion, not a claim of mathematically exact zero drift. The result
does not establish timestep independence for changing controls or collisions.

Reproduce with the same harness against either checkout:

```bash
node --experimental-transform-types scripts/static-contact-benchmark.ts
node --experimental-transform-types scripts/static-contact-benchmark.ts /path/to/v13-checkout
```

The harness writes JSON to stdout, includes the scenario and source hashes,
distinguishes dirty source from its Git parent, and fails if its measured source
changes during execution. It never overwrites a report inside either checkout.
`tests/static-contact.test.ts` additionally covers preload, friction saturation,
contact loss, brake release and work accounting through low-speed reversals.

## 2. Rolling resistance and tyre heat use the same mechanical work

### The previous defect

V13 removed rolling energy through a longitudinal force on the body but supplied
the tyre network with an independent `0.0012 * load * roadSpeed` heat estimate.
The two coefficients could disagree substantially. A locked sliding wheel could
receive rolling heat because the chassis was moving, while a stationary burnout
could miss rolling work because road speed was zero.

### The implemented behavior

`solveTire()` now supplies a signed, load- and pressure-dependent carcass moment
inside every trial of the implicit wheel-speed solve:

```text
M_roll(omega) = -C_carcass * load * radius * tanh(2 * omega * radius)
P_roll = max(0, -M_roll(omega_solved) * omega_solved)
```

Puncture resistance contributes to this moment. The same converged moment is
also applied as an external torque to the chassis-plus-wheel angular momentum
system. This distinction matters: treating the road moment as an internal brake
would introduce the wrong chassis reaction. Previous-step differential reaction
prediction includes this moment as well as the longitudinal tread force.

The resulting `rollingDissipation` enters the existing coupled four-node
tread/carcass/core/rotor thermal network as explicit `rollingPower`. An explicit
zero remains zero. Direct thermal helper callers that omit this field retain
the compatibility estimate, so existing isolated API uses continue to work.

Ground compaction and excess loose-surface resistance remain translational
ground losses and do not heat the tyre carcass. Friction-brake heating and
regenerative braking retain their separate work channels. Rolling work does
not produce skid marks or enter the contact-slip wear calculation.

The outcomes are testable: forward and reverse rolling both oppose rotation;
a locked sliding or unloaded wheel has zero rolling work; a loaded stationary
burnout has positive rolling work; lower pressure increases the calibrated
carcass resistance. Tests also check the complete thermal energy input and the
external angular-momentum application in production `Vehicle.step()`.

This corrects a work inconsistency and changes thermal calibration. For the
Formula slick rolling without slip at 3000 N, 50 m/s and 155 kPa, the calibrated
paved carcass coefficient supplies about 2044 W, versus 180 W from the former
independent estimate. Those are source
terms for a specified example, not measured real-tyre heat or a universal
steady-state temperature. Full-car handling and endurance behavior therefore
need continued calibration against real measurements.

## 3. GP and motocross rates follow the authoritative chassis pose

The previous GP adapter assembled angular velocity from yaw and lean rates,
omitting pitch and parts of tyre-crown lean motion. The motocross adapter used
a related approximation. Those vectors could disagree with the actual combined
yaw/pitch/roll orientation used for recording, collision response and rendering.

The shared `OrientationKinematics` measures the shortest world-space rotation
between successive authoritative quaternions:

```text
delta_q = q_new * inverse(q_previous)
omega_world = shortest_rotation_vector(delta_q) / dt
```

Angular acceleration compares consecutive interval-average rates using the
distance between their interval midpoints, including unequal final substeps.
The sampler reuses its storage and does not integrate a competing orientation.
It records the orientation's motion, including simultaneous pitch, yaw and roll.

Both bike adapters use this result. Their private authoritative pose history
prevents a collision solver's temporary body edits from being mistaken for
additional motion. External impulses remain consumed once. GP vertical velocity
also differentiates the preceding authoritative position, excluding numerical
depenetration from physical rise/fall velocity.

Placement, discrete fallen/crown convention changes and completion of a remount
establish new derivative baselines. They do not manufacture a spin from an
instantaneous coordinate reset. Subsequent physical fall/remount motion is still
measured. Regression tests reconstruct quaternion motion independently through
Three.js and cover GP pitch/crown behavior, motocross flight, recovery, recorded
rates and collision-impulse ownership.

These are interval-average motion channels, not a replacement of the reduced
motorcycle force models with an unrestricted rigid-body motorcycle solver.

## Compatibility and remaining limits

`SIMULATION_VERSION` is 14. Saved records, ghosts and boards retain their original
physics category; tests include v13 among previous versions. Recorded snapshot
layout is unchanged because the necessary pose, angular-rate, contact-strain and
wheel-phase channels already exist.

The model still has massless suspension hubs rather than a complete unsprung
wheel-hop model. Tangential strain uses the instantaneous contact frame rather
than objective transport of a distributed, twisting patch. Camber thrust lacks
a reciprocal resolved overturning moment. Rolling resistance is a reduced axial
moment, with an authored carcass/ground split; it does not solve the full shifted
contact pressure distribution or all absolute chassis-plus-wheel angular work.
The thermal model has lumped temperatures rather than resolved tread width and
depth. These limits prevent a claim of complete tyre/chassis energy conservation
in every attitude or iRacing-equivalent real-world fidelity.

## Validation

The [machine-readable validation record](physics-v14-validation.json) retains
the measured source identities, scenario inputs, individual test-file results,
baseline/candidate calibration and full dynamics measurements. The baseline is
the exact `f73fea56353e0df373ee0c61d1e61fb5d05a1bac` revision. The numerical checks
retain their measured source identities. The final change set also incorporates
the concurrent `54c886d` GP presentation/corner-practice update and `93576d2`
Festival update. The latter adds open-world tyre support, painted contact and
route/session behavior, outside the closed-track fixtures measured here.

The 128 core/simulation files excluding `src/simulation/open-world/**` match the
measured candidate exactly (`4be6c0c1…9f90ecfe`, fingerprint v2). An import audit
also finds no changed local dependencies in the static fixture, car calibration,
dynamics benchmark, continuous closed-track race or replay/storage paths. Their
numerical evidence remains applicable to those unchanged inputs; it does not
validate the new Festival contact or travel behavior. The original full-source
hashes remain historical, and the final combined source/build identities are
recorded separately. The final Mesa browser receipt identifies the combined
build, while the earlier SwiftShader observation retains its preceding build
identity.

| Check                                                                | Final candidate result                                                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Selected car/contact/thermal/drivetrain/suspension/integrator tests  | 153 tests passed across 16 files                                                                      |
| Motorcycle pose, GP front-contact steering and record identity tests | 40 tests passed across 3 files                                                                        |
| ESLint on every changed TypeScript source, test and benchmark file   | Passed                                                                                                |
| TypeScript and Vite production build                                 | Passed in two invocations on unchanged final inputs; 754 modules and all 231 public files verified    |
| Strict APX-01 and TC-1 calibration                                   | All 8 metrics in unchanged target bands at 120 and 240 Hz                                             |
| Original dynamics benchmark                                          | All 11 cases passed                                                                                   |
| Seeded wheel-work stress                                             | 12,000 updates; no negative heat, nonfinite states or brake-lock violations                           |
| Continuous six-car race, telemetry and numeric replay                | All 14 checks passed; all six cars classified                                                         |
| Final merged GP browser journey on Mesa llvmpipe                     | Failed at the original 60-second settings-modal timeout; GP selection, driving and replay not reached |

These are focused local checks. The repository's complete unit, content, scenario
and browser workflows remain separate CI gates; no global suite pass is inferred
from the selected tests.

### Final production build

The merged source passes `tsc --noEmit`. Its following Vite invocation reached
754 transformed modules but failed writing output because the shared overlay
filesystem was full. A Vite-only invocation then completed on the same source
and configuration, using memory-backed temporary/output storage and the runner
configuration loader. All 231 copied public files match the checkout byte for
byte. The emitted build fingerprint is
`b67578b68e3068c808933864329d5a54609c5473bec43b672caff62a14247b91`,
independently reproduced from the source and configured identity inputs. The
existing large-chunk warning remains. No source, dependencies, bundle settings
or test thresholds were changed for this storage workaround. The JSON retains
earlier resource/input failures and distinguishes the compiler success from the
containing command's later output failure.

### Handling calibration

The original `scripts/vehicle-calibration.ts --strict --only=apx01,tc1` ran against
both revisions with identical target bands. The table shows its printed 240 Hz
measurements. All corresponding 120 Hz values also pass, with reported timestep
drift no greater than 0.2% across the two cars.

| Vehicle / metric                        |         V13 |         V14 | Existing target band |
| --------------------------------------- | ----------: | ----------: | -------------------- |
| APX-01: 0–100 km/h                      |      2.56 s |      2.54 s | 2.3–3.2 s            |
| APX-01: top speed                       | 320.55 km/h | 320.67 km/h | 320–360 km/h         |
| APX-01: stop from 100 km/h              |     19.28 m |     19.43 m | 15–32 m              |
| APX-01: lateral acceleration at 80 km/h |      1.94 g |      1.95 g | 1.8–3.2 g            |
| TC-1: 0–100 km/h                        |      4.95 s |      4.94 s | 4.8–7.5 s            |
| TC-1: top speed                         | 232.25 km/h | 232.40 km/h | 205–255 km/h         |
| TC-1: stop from 100 km/h                |     28.23 m |     28.55 m | 26–42 m              |
| TC-1: lateral acceleration at 80 km/h   |      1.33 g |      1.33 g | 1.0–1.45 g           |

The dynamics benchmark additionally checks braking from 100/200/300 km/h,
three constant-speed skidpads, repeated steering and three kerb profiles. Its
braking fixture measures 19.3765 / 55.8938 / 97.5559 m. These differ slightly from
the calibration table because the original fixtures use different preparation
and measurement procedures. The repeated-steering yaw rate recovers to
`1.107e-6 rad/s`; the largest load among the kerb cases is 7686.55 N.

### Work and root audit

The seeded 12,000-update audit includes 5046 updates in the damping fade window,
6683 damped contacts, forward and reverse motion, generated preload histories,
camber, changing grip/load, braking, regeneration and unloaded wheels. Force-only
probes, committed contact forces and production forces agree exactly.

The largest contact-work identity error is `3.70e-13 J`; the four-node thermal
balance error is below `3.68e-9 J`. The finite 16-iteration wheel solve has a
maximum measured torque residual of 0.24566 N·m for steps at or below the
production 1/240 s cap. Deliberately oversized direct helper calls reach
1.13132 N·m at 1/60 s; refinement of the selected worst cases stays inside their
original final brackets. Accounting for that torque residual reduces the
whole-wheel work mismatch to `1.81e-12 J`. This is measured evidence over the
specified stress inputs, not a proof of global root uniqueness.

### Continuous driving, telemetry and recorded state

The unchanged `scripts/integrated-driving.ts` passes all 14 checks. Its six-car,
eight-lap race uses production physics and ordinary player control requests;
it does not teleport cars or directly change forces, health, fuel or lap counts.
The full sequence exercises launch wheelspin, wake effects, brake lock/release,
kerbs, grass contamination and cleaning, changing weather, tyre service, physical
contact damage and the resulting aerodynamic loss.

At 610.3414 seconds of race time all six cars are classified with no retirements
and one pit stop each. The player is classified with seven laps and the other
five with eight. The test verifies 36,971 telemetry rows across 228 channels and
checks 41 sampled CSV rows against the actual stored values. Its 9,242 recorded
frames pass all four backward and page-boundary seeks, including damage, dirt
and track-surface history. Maximum resident replay storage is 16,468,320 bytes.
The replay uses an in-memory page adapter; this check does not establish browser
IndexedDB, graphical playback or camera acceptance.

### Final browser journey: settings transition exceeded its deadline

The combined production build ran the original GP browser journey once on the
repository's Mesa/llvmpipe backend. Its served build fingerprint and entry-bundle
hash match the final build recorded above. The framebuffer preflight passed.
The original 1280×800 viewport, 300,000 ms test deadline, 60,000 ms expectation
deadline, one worker, zero retries and settings workflow were retained.

The initial menu became visible at 152.266 seconds. The test opened Garage &
Settings, selected Low and clicked Apply & Save by 162.325 seconds. The first
failure was `expect(page.locator('#modal')).toBeHidden()` at line 91 of
`e2e/motogp-riding-flow.spec.ts`: the dialog remained visible through 23 recorded
polls and exceeded its original 60-second expectation. The test exited normally
with failure, reporting 268.473 seconds including teardown.

The later retained DOM at 232.871 seconds and the visually inspected failure
screenshot show that the settings modal had closed and the initial Aurel/APX-01
menu was restored. The trace records no console messages/errors or page errors;
all 92 recorded requests returned HTTP 200. This establishes a timing failure
within the settings transition. It does not establish a permanent hang, identify
which transaction phase caused the delay, or prove a regression from the engine
changes. The source transition includes renderer preparation, settings application
and persistence before modal closure, but no runtime phase diagnostics were
sampled in this run.

GP session selection, circuit entry, manual controls, moving chase/cockpit views,
pause and graphical replay assertions did not execute. The source starts the GP
worker after session entry; the test never reached that action. This browser run
therefore provides no live GP pose-channel or gameplay acceptance, and llvmpipe
provides no physical GPU acceptance. The JSON retains the complete compact
receipt and evidence hashes. No browser assertion or deadline was relaxed.

### Earlier SwiftShader browser observation

The original `e2e/motogp-riding-flow.spec.ts` ran once through the production
build before the `54c886d` presentation update, with Chromium's SwiftShader
software renderer, a 1280×800 viewport, one
worker, no retries and its unchanged 300,000 ms test deadline. The framebuffer
probe, cold menu, normal Low-quality settings, GP-R1/Poggio Alto practice setup,
four-rider selection, machine-preview assertions and menu screenshot completed.
The actual build fingerprint in the trace matches that earlier build output.

The test failed while `finishRaceEntry` waited for `driving` or `briefing`;
the application remained in `loading`. The last pre-timeout trace was preparing
the track surface. Construction continued during failure capture and teardown,
but no completed session entry was observed. The captured trace has no console
errors, page-error events or failed requests among 182 recorded requests; it has
one warning that `KHR_parallel_shader_compile` is unsupported. These observations
do not prove the cause of the timeout or establish a regression from the physics
changes, because no baseline browser comparison was run.

The moving GP grid, manual riding controls, chase/cockpit views, pause handshake
and graphical replay assertions did not execute. The process exited normally
with test failure (exit 1); its deadline and workload were not relaxed. This is
a partial software-rendered observation, with no physical GPU acceptance. The
validation JSON records the completed milestones, first failed boundary,
unexecuted sections, build identity and hashes of the locally captured evidence.
