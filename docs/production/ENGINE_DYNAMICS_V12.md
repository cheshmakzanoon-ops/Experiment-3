# Contact dynamics and recorded wheel motion — simulation v12

This update starts from `7e535707db77f409d941b7776573b945964091ec` and improves three
specific parts of the existing engine: longitudinal tyre compliance, brake/tyre heat
exchange, and reconstruction of wheel rotation from sparse snapshots. It retains the
120 Hz worker tick, 240 Hz vehicle substeps, current steady tyre curves, and existing
vehicle calibration targets.

The final update is integrated on top of `0004d10009b6e88ec65fdb3fbd663e1dee3f5eb3`,
preserving its motocross HUD test-fixture correction, the GP rider, fork, front-contact
and menu-sky changes in `85ceda37b9893ffe1f407e08f4ae1e3a5018e736`, and the preceding
`4a8fd5734aa89f86238fe96d78a23043a587cc94` motocross landing, dust-lighting and showroom
changes. Those commits use physics v11 and v10 respectively; the combined contact/thermal
release is v12.

The last incoming commit, `0004d100`, changes only two motocross end-to-end test files.
It was integrated after the final execution receipts below. It changes no production
runtime file or any of the 20 focused unit-test files used by the final gate.

The force and thermal changes apply to the shared **four-wheel vehicle solver**, including
Formula, touring, road/festival and off-road cars. The wheel-motion recording change also
applies to **GP and motocross motorcycles**. Their separate two-wheel force models are not
replaced by the new car tyre model.

## Public iRacing references and the implementation boundary

The following are public engineering references, not a source-code specification:

| Primary reference | Principle used here |
| --- | --- |
| [Dave Kaemmer, The Sticking Points in Modeling Tires (2010)](https://www.iracing.com/the-sticking-points-in-modeling-tires/) | Compute forces, integrate component state, and derive visible motion from that state. Tyre behavior depends on more than instantaneous slip. |
| [Dave Kaemmer, Physics Modeling: NTM V7 Info (2018)](https://www.iracing.com/physics-modeling-ntm-v7-info-plus/) | The contact patch moves relative to the rim and has different longitudinal, lateral and vertical stiffnesses. Load, pressure and construction affect compliance. |
| [iRacing Development Update, November 2024](https://www.iracing.com/iracing-development-update-november-2024/) | Transient response, sustained loading and longer-term conditioning are distinct effects. The proposed additional contact-patch slices were described as future work in that update. |
| [iRacing Development Update, May 2025](https://www.iracing.com/iracing-development-update-may-2025/) | Surface-temperature excursions and grip recovery after a slide require careful calibration. More severe grip loss alone does not establish greater fidelity. |
| [Commodore's Garage #13, Tire Pressures (2016)](https://www.iracing.com/commodores-garage-13-tire-pressures/) | Brake heat can contribute to tyre heating and pressure buildup. |

Kaemmer explicitly withholds proprietary mathematics in the 2018 article. The equations,
parameters and algorithms below are **independent reductions for this engine**, not a
reconstruction of iRacing's proprietary tyre model. The existing Magic-Formula-shaped
steady curves remain original game calibrations rather than measured manufacturer data.

## 1. Longitudinal contact deformation

Previously the lateral force had a relaxation state, but longitudinal force responded
instantaneously to the trial wheel slip. The new contact has elastic deformation `x`,
stiffness `Kx` and recoverable energy `U = Kx*x*x/2`:

```text
slip speed s = wheel angular speed * rolling radius - hub longitudinal speed
Fx = Kx*x
dx/dt = s - lambda*x
lambda = Kx*s/Fsteady(s/V)
```

`Fsteady` is the existing combined-slip force, including its post-peak shape. The positive
sliding rate gives the same steady force while allowing deformation to build and relax.
The zero-slip limit uses the actual combined-slip longitudinal stiffness. The independently
calibrated reference relaxation lengths are 0.22 m for the Formula construction and 0.29 m
for the touring/family construction. Load, pressure, wear and low-speed fade modify
those lengths through the existing construction scaling laws.

### Coupling and energy

Every wheel-speed bisection trial solves the contact deformation with backward Euler.
Trials do not mutate persistent tyre memory; the converged trial alone is committed.
The contact force in the wheel torque equation is therefore the force ultimately applied
to the vehicle. Its longitudinal capacity is bounded by the current friction ellipse
after reserving the current lateral force.

For fixed prepared parameters, the independent discrete longitudinal-contact work identity is:

```text
Fx*s*dt = change in stored elastic energy
        + physical sliding/projection loss
        + backward-Euler contact loss
```

The last term is numerical dissipation and is not labelled tyre heat. During a reversal,
negative instantaneous contact work can only return energy that was previously stored.
Changes in stiffness remap deformation while preserving stored energy, so a load/pressure
change cannot manufacture an elastic preload.

Low-speed fallback and loss of contact clear the elastic state. Released internal
energy enters the carcass thermal node directly; it does not abrade the tread or heat the
road as though an airborne tyre were still sliding. Vehicle placement/recovery clears
the contact memory, and replacement tyres start with a fresh state.

The original 16-iteration wheel-root budget is retained. A trial with exactly zero residual
is accepted immediately, and the sliding bracket stays on the side selected by brake
complementarity. Brakes therefore oppose the solved rotation instead of accidentally
choosing a post-peak root on the wrong side of rest.

The zero-speed probe and bisection trials calculate the force without writing unused
deformation/heat budgets. A full root solve therefore computes those budgets once instead
of 18 times. The final evaluation records the same deformation, energy and physical versus
numerical losses, in the same arithmetic order. This optimization does not shorten the
root solve or approximate the force law.

## 2. Finite brake rotor and tyre heat exchange

The previous tyre network treated the brake disc temperature as an imposed boundary.
Heat entered the tyre core through that boundary without leaving the finite disc, and
the separate disc-cooling expression always used 24 degrees C.

Production car tyres now solve surface, carcass, core and rotor temperatures together:

```text
surface <-> carcass <-> core <-> rotor
rotor input = friction brake torque * absolute solved wheel speed
rotor loss to air = (25 + 4*absolute hub longitudinal contact speed) * (rotor - ambient)
```

The effective 16,000 J/K disc capacity and existing conductances are retained to avoid an
unrelated retuning of the vehicles. They are engineering calibration values, not measured
rotor masses. The fourth row of the tridiagonal backward-Euler solve removes from the disc
exactly the heat transferred to the core. Ambient air comes from the actual session.
Regenerative braking supplies no friction-disc heat. Internal contact relaxation enters
the carcass with a retained share of one; contact sliding retains the existing tread/road
heat split.

The separate three-node API remains available for callers that deliberately provide an
external disc-temperature boundary. Passive exchange is bounded for positive capacities
and nonnegative conductances; invalid/nonfinite integration steps are rejected.

### Discrete braking limit

Brake work still uses the existing backward-Euler endpoint speed. Its stopping step can
contain numerical wheel-energy loss `I*(newOmega-oldOmega)^2/2`; this is not reassigned
to physical brake heat. Exact within-step stop/reversal travel would require changing
the wheel and contact work quadrature together. This update does not claim that broader
integrator replacement.

## 3. Record completed turns instead of guessing them

Wrapped wheel phase and two endpoint angular speeds cannot uniquely identify how many
turns occurred between snapshots. A fast wheel that locks early can make the previous
endpoint estimate invent an extra turn. A wheelspin burst can disappear if both recorded
endpoint speeds are zero.

Each production wheel now retains a bounded phase plus an integer signed turn count.
The 240 Hz solver updates both from the actual angular increment. Protocol **14** appends
five values per entrant: a per-wheel validity mask and four signed turn counts. This adds
20 bytes per entrant per snapshot; every pre-existing per-entrant offset is unchanged.
Keeping phase separate from the integer count preserves small angular movements after
long sessions instead of rounding them away in a large Float32 total angle.

Live frames, both replay recorders and restored replay pages preserve this state. Phase
interpolation uses the measured winding; synthetic poses without it retain the older
estimate. Long coherent gaps preserve measured net rotation with a linear interpolation,
because the precise acceleration inside those gaps is unknown. Same-compound tyre
replacement is detected at the actual service installation transition, before the pit-stop
counter increments, so fresh tyres do not inherit the old tyres' accumulated turns.

This fixes net winding, not the fundamentally unrecorded timing of an impulse inside a
snapshot interval. Integer counts outside the exact Float32 range are explicitly marked
invalid and fall back to the older inference.

## 4. Versioning

`SIMULATION_VERSION` advances from **11 to 12** because tyre transients and temperatures
can alter lap results. Earlier records retain separate physics categories. Snapshot
`PROTOCOL_VERSION` advances from **13 to 14**, with `CAR_STRIDE` increasing from 293 to
298. The existing policy of explicitly rejecting unsupported old snapshot formats is
retained; old stride data is never silently interpreted using the new layout.

## 5. Verification

No calibration band, existing test deadline or renderer workload is relaxed for this
change. The following measurements distinguish the original comparison tree, the first
motocross/showroom integration, and the final optimized source including the GP update.

### Original-band vehicle comparison

The unmodified `scripts/vehicle-calibration.ts --strict
--only=apx01,tc1,rh3,sc7,dx8,gt6r` completed with exit 0 on both the original `7e535707`
baseline and the first contact/thermal candidate. All 24 metrics passed their original
bands at both 240 Hz and 120 Hz: 48 band checks per tree. These are regression bands,
not measured real-car validation. The integrated upstream commits change the separate
motorcycle models; they do not change these six cars' contact or powertrain algorithms.

The table reports the 240 Hz baseline -> candidate measurements at the script's
original displayed precision:

| Vehicle | 0-100 km/h, s | Top speed, km/h | 100-0 km/h, m | Lateral at 80 km/h, g |
| --- | ---: | ---: | ---: | ---: |
| APX-01 | 2.56 -> 2.56 | 320.55 -> 320.55 | 19.19 -> 19.28 | 1.94 -> 1.94 |
| TC-1 | 4.95 -> 4.95 | 232.25 -> 232.25 | 28.10 -> 28.23 | 1.33 -> 1.33 |
| RH-3 | 5.22 -> 5.22 | 259.63 -> 259.61 | 33.25 -> 33.29 | 1.10 -> 1.10 |
| SC-7 | 3.23 -> 3.24 | 331.40 -> 331.37 | 28.96 -> 29.08 | 1.16 -> 1.16 |
| DX-8 | 5.38 -> 5.40 | 210.56 -> 210.54 | 39.28 -> 39.45 | 0.93 -> 0.93 |
| GT-6R | 3.53 -> 3.53 | 290.65 -> 290.60 | 24.47 -> 24.58 | 1.33 -> 1.33 |

The largest candidate 240/120 Hz drift printed by the script is 0.2%, for APX-01
acceleration; the other five cars print 0.1% or less. All top-speed, braking-distance
and lateral-grip drift reports round to 0.0%. Strict mode enforces the metric bands;
it reports drift separately rather than enforcing a drift threshold.

### Integrated force and thermal verification

Before the final trial optimization and GP integration, five unchanged/incremental suites
completed on the integrated contact/thermal source with exit 0:
58 tests covering longitudinal contact (13), the existing tyre model (15), existing
thermal behavior (8), coupled wheel/rotor heat (18), and brake/regeneration coupling (4).
The new contact coverage includes 1,500 signed drive/brake steps with independent torque,
friction-ellipse and work checks, plus 800 steps accounting for wheel kinetic energy,
contact energy, braking, hub-boundary work and numerical losses.

The original `scripts/dynamics-benchmark.ts` also completed with exit 0 and all 11
conditions passing on the integrated car solver. It was invoked from a temporary output
directory so it did not overwrite the historic dynamics report. On its analytic fixtures,
100/200/300 km/h stopping distances were 19.225534/55.471253/97.046980 m. Skidpad radial
RMS errors at 15/25/35 m/s were 0.047799/0.320300/1.108622 m. Recovered slalom yaw was
6.739074e-7 rad/s. Low, high and sausage kerb conditions passed. These analytic fixtures
exercise the actual vehicle solver but do not validate the real circuit contact BVH.

### Focused motion, integration and build checks

The pre-optimization integration passed **233 unique tests in 18 files**, with exit 0 for each
focused invocation. This comprises the 58 force/thermal tests above, 51 wheel-winding,
wheel-pose and snapshot-interpolation tests, and 124 recording, replay-seek, alignment,
physics-identity, startup and retained motocross integration tests. The winding tests
cover both recorders, long sessions, forward/reverse gaps, early wheel lock, a wheelspin
burst, exact replay seeks and same-compound service transitions. Service cases include
snapshots that skip directly from phase 0 or a previous release into installation.

ESLint, content validation, TypeScript checking and the Vite production build all completed
with exit 0 on that first integration checkout. The build transformed 723 modules. Its existing
large-chunk advisory remains; this update does not claim to reduce the asset bundle size.
The build, focused integration gate and browser runs used the repository's source-stability
guard; none rewrote application inputs during execution.

### Verification after the GP integration

After the force-only optimization and integration onto `85ceda37`, the combined v12 source passed
**250 tests in 20 files**, with exit 0. These include all focused force, thermal, winding,
pose, interpolation, recording, replay-seek, alignment and identity tests, plus the retained
motocross landing/rider/pickup/environment tests, startup tests, and incoming GP front-contact
and menu-sky tests. Vitest reported 237.04 seconds for this invocation.

The same serial source-stability-guarded command also passed ESLint, content validation,
TypeScript checking and the production build. Vite transformed **726 modules** and completed
in 1 minute 39 seconds. The existing large-chunk advisory remains. This is a focused clean
gate on the final combined source, not a claim that the entire repository test suite passed.

### Sustained production physics

The original `npm run test:physics` chain completed with exit 0 before the final force-only
probe optimization and GP integration. Its four-wheel force/thermal equations are retained. Its scripts and
acceptance thresholds were unchanged; generated JSON was directed to a temporary output
directory so historical reports were preserved.

* **Circuit/weather validation:** clear, changeable and rain scenarios each completed
  320 simulated seconds with four cars. Every scenario passed its existing checks;
  the changeable-weather cars completed their intermediate-tire changes.
* **Dynamics:** all 11 original conditions passed again in the same serial chain.
* **Race control:** all six conditions passed, including local double yellow, an unaffected
  distant driver, green after passing, no impacts or incorrect penalty, and finite motion.
* **Wet pit stops:** both ten-car cases passed. Starting on wet tires completed the scenario
  in 177.633333 simulated seconds; starting on deliberately wrong medium slicks took
  236.991667 seconds. Every car completed one service, acquired new wet tires and physically
  exited, with zero impacts and full health, within the original 420-second limit.
* **Continuous driving journey:** all 14 checks passed, including the complete player-input
  sequence, classification of all six cars, launch wheelspin, high-speed gears and wake,
  locking and recovery, kerbs/grass/suspension, retained dirt and cleaning, thermal/wear/ERS
  response, a weather-driven compound change, physical front damage and aerodynamic loss,
  telemetry timing, replay history and exact CSV values. It produced 37,235 telemetry rows
  across 228 channels and 9,308 replay frames; all four backward seeks passed. The player
  was classified one lap down with seven laps; opponents completed eight, with none retired.

The journey uses the actual vehicle/world solvers and an in-memory replay-page adapter.
It does not substitute for audiovisual acceptance or browser IndexedDB verification.

### Exact verification of the final trial optimization

After the sustained chain, the force-only probe optimization passed all 59 force/thermal
tests, including a new 1,134-case exact-force/non-mutation regression. The original version
failed that new regression because it still wrote the unused state during a probe.

An unchanged deterministic harness also captured the production `solveTire` state before
and after the optimization for **11,520 solves**: 768 interleaved steps across Formula,
Touring and Family constructions, each on all five compounds. All 48 Tire fields, including
nested construction properties, were encoded with exact Float64 bytes and type tags.
Every per-step state hash and all 15 initial/final complete states matched, with zero
mismatches and no non-finite inputs or states. This covers positive/negative drive,
friction/regen braking, wheel locks, reverse speed, combined slip, punctures, low-speed fade,
airborne reservoir release, wet surfaces, temperatures, pressure, wear and cumulative turns.

The shared all-state SHA-256 is
`c2b5cb6c52f6343edd5fd1474ee9b21fcb163df329e45ada646ff900172dfddd`;
the shared deterministic-input SHA-256 is
`1ac0c703d1af1811fe4631edcb3201c5a285b46d84a1fd443edb9a50f6d491b2`.
Among the five recorded production modules, only `tire.ts` and `tyre-force.ts` changed
between those captures; the thermal, brake and winding modules were identical. The
deterministic harness was also identical. The subsequent GP merge does not change this
four-wheel solver.

### Browser execution and its limit

The following three component and two application cases ran on the first integrated source,
before the final force-only optimization and GP/menu-sky merge.

Three browser component cases completed with exit 0: the actual physics/CSV worker
two-origin test (36.1 s), wheel geometry and recorded winding at all three detail levels
(34.6 s), and the WebGL motion-vector/cockpit test (7.6 s). The observed renderer was
ANGLE SwiftShader; the backend's framebuffer/identity check passed. These are software
graphics results, not physical-GPU frame-rate measurements.

The two complete application cases both completed with exit 1 at the original 60-second
`#menu` visibility check. Their snapshots still showed the loading screen, so neither
reached gameplay, camera/pause acceptance or browser telemetry/replay acceptance. The first
case also spent time closing its context (5.1 minutes total); the second took 1.6 minutes.
Both failure traces were inspected. The first application's construction assertions were
moved after circuit entry to match the retained upstream showroom-first startup; no
construction threshold, graphics control, test deadline or driving workload was removed.

A temporary runner configuration changed only local server/output locations because port
4173 was occupied. It retained the original browser backend, 1440-by-900 viewport, one
worker, no retries, deadlines, assertions and workload. The initial port-conflict attempt
is not counted as a browser test result.

After the final GP merge, optimization, build and CPU/jack checks, the first application
case was run again on the final v12 source with those same settings and deadlines. It
completed with exit 1 at the same 60,000 ms `#menu` visibility assertion; Playwright
reported 101,939 ms total case duration. The actual SwiftShader adapter/framebuffer check
passed. The retained trace contained no console or page-error events, and all 91 recorded
HTTP responses were 200. Its last screencast showed "LOADING CARS" at 0%; the later failure
DOM snapshot showed "Loading circuit" at 0% with the menu still hidden. The trace image
and failure context were inspected, and the source guard found no rewritten inputs.

This remains an unresolved application-startup failure. The trace does not establish its
cause. Gameplay, engineering/cockpit and pause/resume assertions were never reached.
Browser CSV/export/replay assertions belong to the second application case and were
outside this final single-case run; the earlier attempt also did not reach them.

### Broader-suite timing failures

The pre-integration `npm test` run was stopped after reporting two timeout failures. It
did not complete and is not a clean full-suite result. The exact failing cases were then
run individually, with the original tests/configuration and deadlines, on `7e535707` and
the integrated candidate before the force-only optimization:

| Unchanged case | Limit | Baseline | Integrated candidate |
| --- | ---: | ---: | ---: |
| `phase27h6`: actual skinned cloth, helmets, gloves, tires and machinery over the complete service | 120 s | Timeout, 194.202 s | Timeout, 324.153 s |
| `pit-role-performance`: physical jack lowered before release, unchanged exchange instant and minimum service | 30 s | Pass, 22.702 s | Timeout, 50.541 s |

The geometry attempts also reported Vitest worker RPC timeouts; neither is successful
geometry verification. Its unchanged geometry path does not step the modified tire solver.
The physical-jack case does step the production simulation and its candidate timeout is
not classified as baseline-reproduced. Neither case reported a geometry, exchange, jack
position or departure assertion failure. These wall times were collected with other jobs
active and do not establish a controlled performance comparison.

### Final CPU-cost receipt

The unchanged command was:

```sh
node --experimental-transform-types scripts/physics-cost.ts --repeat 1 --seconds 30
```

Each fresh process simulated a 20-car field for 30 seconds: 3,600 outer 120 Hz ticks and
144,000 vehicle substeps at 240 Hz. Process CPU covers the complete loop, including AI,
wakes, vehicles, collisions, pit/race control and track evolution. The renderer is absent.
The first four observations ran serially in baseline/candidate/candidate/baseline order
before the final force-only optimization; the two optimized observations followed the
final combined-source gate. All six processes completed with exit 0 and no retirements.

| Observation | Process CPU, ms per outer tick | Wall time, ms per outer tick |
| --- | ---: | ---: |
| Baseline A, `7e535707` | 10.8387 | 10.0744 |
| Original candidate A | 19.2535 | 20.1649 |
| Original candidate B | 18.0895 | 22.5262 |
| Baseline B, `7e535707` | 17.7643 | 21.1458 |
| Final optimized v12 A | 15.6939 | 13.8040 |
| Final optimized v12 B | 14.9043 | 12.9545 |

The final optimized CPU mean was 15.2991 ms/tick, versus the earlier candidate mean of
18.6715 and baseline mean of 14.3015. Both final observations were below both original
candidate observations, but the large baseline variation prevents a precise speedup or
regression percentage claim. No owned heavy jobs overlapped the final probes; unrelated
work was still observed on the shared host. With one repeat per process, each script
"median" is a single observation.

The final vehicle-only wall measurements were 274.8361 and 268.6231 microseconds per car
per 240 Hz substep. The observed full-loop wall costs remain above the 8.333 ms budget
for a real-time 120 Hz tick in this 20-car stress workload. Hardware frame rate and normal
gameplay performance require separate measurement.

All four candidate runs, before and after optimization, reported exactly
1,244.731694578493 m mean distance. This is one unchanged workload outcome; the all-field
11,520-state comparison above provides the stronger equivalence evidence.

Finally, the exact unchanged physical-jack case passed on the optimized v12 source in
**27.771 seconds**, within its original **30-second** limit. Vitest reported one passed
and eight skipped, with 34.68 seconds total duration. The Aurel/Vellamar assertions for
wheel exchange, jack lowering before release, minimum service and departure all completed.
The earlier 50.541-second candidate timeout remains a historical pre-optimization result.
The benchmark, jack test, `tire.ts` and `tyre-force.ts` hashes were unchanged across this
final three-process sequence. The broader geometry timeout above remains unresolved;
this isolated jack pass does not turn the interrupted full suite into a clean run.

## 6. Remaining model limits

The engine still uses massless car hubs, a calibrated steady combined-slip law, a lumped
thermal network and its existing lateral relaxation approximation. It does not gain an
unsprung-mass wheel-hop mode, a per-tread-element rubber model, measured tyre-construction
data, CFD or hardware-validated force feedback from this update. Physical device feel
and real-car accuracy require independent measurements beyond deterministic software
regressions. GP and motocross use their existing separate tyre-force models.
