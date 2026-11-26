# Assignment 42 — physical front-rotor continuity

## Result and scope

The player MX250/MX450 front rotor now retains its actual ground inertia in
the two airborne ports that use inertia: friction-brake heat and chassis
pitch reaction. The change is local to `DirtBikeVehicle.flight()`. Ground
pickup already uses the live front tyre inertia, 0.60 kg·m² for both bikes.
Flight previously substituted the generic definition value, 0.65 for MX250
and 0.70 for MX450, without changing the rotor state or accounting for a
component coupling, energy transfer, or angular impulse.

The required focused group passes **86/86 tests** on the combined adapter
`7a72b2747d4469bc652ce965afab4a8f94a7b1606073291c6d36045182b9361e`.
The independent energy audit, all four zero-front-brake surveyed-jump trace
comparisons, all six excluded-mode comparisons, and the immutable five-case
non-MX preservation comparison also pass. An exploratory expansion was
**139/140**, with one pre-existing finite-brush rolling-band assertion
remaining unchanged and handed to assignment 45 below. That expanded run
must not be reported as all passing.

No model definitions, 3D models, character geometry, assets, authored venue
surfaces, physical calibration constants, or acceptance tolerances changed.
Assignment 40 owns the separate ground-frame, zero-support transport, and
automatic-downshift changes present in this combined adapter. No yaw-damper
change was included here.

## Caller trace and component identity

The controlling source sites are:

1. `src/simulation/bike-vehicle.ts`, `BikeVehicle.fitFrontRadius()`, sets
   both duplicated front telemetry slots' radius and inertia. Their live
   front inertia is 0.60 kg·m², including after `replaceTires()`.
2. `src/simulation/offroad/dirt-bike-vehicle.ts`,
   `DirtBikeVehicle.stepInterval()`, passes `tires[0].inertia` as
   `frontInertia` to `stepMotocrossGround()`. Its rear physical inertia is
   `air.spinInertia`.
3. `DirtBikeVehicle.flight()` advances the same `frontSpin` state. It first
   applies bearing coast, then the rider's ordinary front brake. Previously
   it multiplied the resulting work and reaction by `spec.wheelInertia`.
4. `DirtBikeVehicle.vertical()` applies `airTorque` to chassis pitch, with
   the existing body reaction, finite rider stroke, and pitch damping.
   `tires()` forwards front brake work to the existing physical thermal
   reservoir. The two front telemetry slots are aliases for that one
   motorcycle end; the energy audit counts that reservoir once.
5. Takeoff and first contact preserve `frontSpin`. There is no second
   front rotor, clutch engagement, inertia conversion, or energy state
   transfer at either boundary. The generic rear tyre ABI inertia is also
   not authoritative for the player's rear physical rotor.

| Bike | Ground front | Previous flight front | Corrected flight front | Ground and flight rear |
| --- | ---: | ---: | ---: | ---: |
| MX250 | 0.60 | 0.65 | 0.60 | 0.52 |
| MX450 | 0.60 | 0.70 | 0.60 | 0.62 |

All values are kg·m². The different front coefficients were an unaccounted
work and momentum inconsistency, not a deliberate component boundary. The
runtime does not store a rotor-energy variable that literally jumps at
takeoff; the defect appears when the same physical rotation is used to
calculate brake work and reaction with different inertias.

The correction selects:

```ts
const frontInertia = this.playerMotocross
  ? this.tires[0].inertia
  : spec.wheelInertia;
```

Only front brake work and front brake reaction use this local value. The
existing `playerMotocrossEligible()` limits it to player-controlled MX250 or
MX450 on motocross or supercross courses. AI, supermoto, MX bikes on road
courses, and other modes keep their existing branch. Rear inertia, front
angular deceleration, bearing drag, rotor limits, input mappings, and rider
aid laws remain unchanged.

## Independent proof

### Ground impulse and actual chassis response

The new `tests/motocross-rotor-phase-energy.test.ts` measures an under-speed
front tyre's change in angular momentum under an actual public ground step:

```text
I_front * (omega_after − omega_before) = −Fx_front * R_front * h
```

It then observes a public free-flight front-brake step. Rear rotor impulse
and the known automatic body action are separate ports. The test first
checks the applied front torque port and independently recovers the applied
impulse from the **observed chassis pitch rate**, accounting for the
existing free-flight damping:

```text
decay = exp[−(0.3 + 0.5*standing)*h]
J_front_observed = I_pitch*(q_after/decay − q_before)
                   + automaticBody*bodyTorque*h
                   − I_rear*(omega_rear_after − omega_rear_before)
J_front_expected = I_front*(omega_front_after − omega_front_coast)
```

The isolated fixture has no contact and zero relative rider input/rate.
Both factory I=0.60 and a deliberately prescribed analytic I=0.83 are
checked, so hardcoding 0.60 in flight would fail. The comparison tolerance
is **1e−11 N·m·s**, unchanged between the two inertia laws. The final audit's
largest accumulated chassis-response residual is **5.33e−15 N·m·s**. This
checks actual motion as well as the torque port; it does not certify global
angular-momentum conservation for every aid and damping port in the model.

### Rotor work from the physical thermal reservoir

For each original physical interval, the audit reconstructs supplied heat
from the disc's stored-energy change and its endpoint boundary flux:

```text
Q_brake = C_disc*(T_after − T_before)
          + [(airBase + airSpeed*speed)*(T_after − T_ambient)
             + discToCore*(T_after − T_core_after)]*h
```

This does not read or sum the adapter's reported brake power. Bearing loss
uses the same physical front inertia:

```text
omega_coast = omega_before * exp(−0.4*h)
L_bearing = 0.5*I_front*(omega_before² − omega_coast²)
E_end + sum(Q_brake) + sum(L_bearing) = E_start
```

The fixture starts 10 m above an in-memory plane with front omega=30 rad/s,
rear omega=0, and the ordinary front brake held. It stays airborne without
contact until the front rotor stops. Initial physical energy is 270 J.
Two bikes and three public cadences are checked. The test also covers
initial front rotation 0.2 and 65 rad/s. The strict **1e−7 J** thermal gate
and existing **1e−9 rad/s** player rotor-law gate were not relaxed.

| Bike | Public Hz | Previous excess energy, J | Corrected residual, J | Previous excess front impulse, N·m·s |
| --- | ---: | ---: | ---: | ---: |
| MX250 | 120 | +21.4859861242 | +7.59e−10 | −1.4502643350 |
| MX250 | 240 | +21.5219934393 | −4.06e−9 | −1.4514425595 |
| MX250 | 480 | +21.5397909585 | +3.46e−9 | −1.4520328931 |
| MX450 | 120 | +42.9719722470 | +8.10e−10 | −2.9005286700 |
| MX450 | 240 | +43.0439868820 | −4.80e−9 | −2.9028851190 |
| MX450 | 480 | +43.0795819168 | +3.32e−9 | −2.9040657862 |

“Previous” is a same-source counterfactual that changes only flight's
inertia selection; every other method is the final combined source. The
counterfactual reproduces the separately measured pre-fix results. It
overstates front brake work/reaction by 8⅓% for MX250 and 16⅔% for MX450
relative to the actual front rotor. The total excess is less than the
22.5/45 J obtained by simply reinterpreting initial energy because bearing
coast removes some rotation before each braking impulse.

### Both phase boundaries under real controls

The two real-course tests use an ordinary player approach to Arena TABLETOP
and a short front-brake tap in the air. They observe natural takeoff,
actual first contact, and subsequent tyre pickup, without assigning a
flight pose, rotor state, or contact load. They assert no phase-entry spin
reset, physical-I thermal work during the airborne tap, and the actual
ground pickup impulse after load becomes available. Both bikes survive.

The original new ten tests failed **10/10** before the correction and
passed **10/10** after it. The subsequent independent chassis-rate assertion
also passes on the frozen combined runtime.

Report 37 previously proved heat against the inertia used *within* the
current phase. Its benchmark oracle now deliberately uses the same live
physical front I as ground pickup. The single matching free-work oracle in
`tests/motocross-coupled-step-contract.test.ts` was updated for that same
reason. Keeping the old generic-I oracle would accept the defect shown by
the independent physical-reservoir experiment above.

## Preservation and ordinary driving

`scripts/bench/motocross-rotor-energy.ts` loads the isolated old-inertia
`flight()` in memory, temporarily installs that method, and restores its
original descriptor in `finally`. It never rewrites production source and
records the adapter hash both before and after. All other current methods
and state are identical between the paired runs.

With front brake exactly zero, front rotation equals its coasting value.
Both changed expressions are exactly zero under either inertia. Four
explicit-zero-front-brake surveyed jumps verify the resulting unrounded
physics and thermal traces are bit-identical, including approach and
post-landing settlement. A named feedback scenario alone was insufficient:
it can retain an approach brake through a short preliminary hop. The audit
therefore zeros the real front-brake input for every public call and
observes the actual physical intervals.

| Machine / venue | Observed airborne intervals | Front-brake intervals | Surveyed airtime, s | Crashes | Same-source trace |
| --- | ---: | ---: | ---: | ---: | --- |
| MX250 / Valley | 434 | 0 | 1.61155 | 0 | Exact |
| MX250 / Arena | 411 | 0 | 1.60745 | 0 | Exact |
| MX450 / Valley | 444 | 0 | 1.62882 | 0 | Exact |
| MX450 / Arena | 423 | 0 | 1.62450 | 0 | Exact |

All six excluded-mode traces are also exact: MX250 AI Valley, MX450 AI
Arena, SM450 Valley and Arena, and both MX bikes on the Aurel road-course
eligibility branch. These independent one-second flight traces use held
front brake, rear brake, throttle, and steering. The immutable whole-game
preservation comparison additionally passed **5/5**, with zero mismatches
and only its allowed physics identity transition 39→41.

The original forgiving-handling/lap suite is **18/18** and the original
jump-corridor suite **14/14**, including the narrow shoulder gates. No
constant or bound was calibrated around those gates. The passing ordinary
driver has its own controls and must not be confused with assignment 40's
separate converged MX450 Valley held-air-control stress case, which remains
an intentional crash-flat outcome documented by 40.

## Adverse commands and the one label migration

The complete player suite passes **20/20**, retaining all eight exact
adverse configuration/scenario identities, independent threshold-based
classification, 240→480 Hz numeric limits, ordinary-control survival,
recovery, replay, and deterministic hashes.

Root authorized one expected label migration: Raw MX250 Arena front-lock
from `crash-front` to `crash-flat`. This migration occurred with assignment
40's momentum correction **before** the front-inertia correction. A
same-source paired matrix verifies that both the old and corrected inertia
laws produce `crash-flat` at 240, 480, 960, and 1920 Hz. Neither the unchanged
0.46 rad nose-down threshold nor the 7 m/s shaft threshold changed.

| Hz | Corrected pitch error, rad | Previous-I pitch error, rad | Corrected shaft speed, m/s | Previous-I shaft speed, m/s |
| --- | ---: | ---: | ---: | ---: |
| 240 | −0.342470611 | −0.355327787 | 7.250026945 | 7.266080334 |
| 480 | −0.326253469 | −0.338977178 | 7.244086796 | 7.259684935 |
| 960 | −0.325012513 | −0.337729455 | 7.243281413 | 7.258345314 |
| 1920 | −0.326390786 | −0.339125738 | 7.245223230 | 7.259636862 |

The corrected cases have no observer violations. The previous-I
counterfactual correctly fails the new physical-I thermal observer. That
failure is part of the causal evidence, not an acceptance result for the
old branch.

## Validation and separate pickup handoff

| Suite | Tests | Result |
| --- | ---: | --- |
| New rotor phase energy | 10 | Pass |
| Coupled lifecycle contract | 24 | Pass |
| Player dynamics and bad-input matrix | 20 | Pass |
| Original forgiving handling and ridden laps | 18 | Pass |
| Original jump corridors | 14 | Pass |
| **Required distinct total** | **86** | **Pass** |
| Extra original riding | 27 | Pass |
| Extra cooling/wheels | 13 | Pass |
| Extra thermal | 3 | Pass |
| Extra wheel pickup | 11 | 10 pass; one existing timing oracle remains |
| **Exploratory distinct total** | **140** | **139 pass, 1 fail** |

The remaining assertion is
`tests/motocross-wheel-pickup.test.ts`, MX250's
“retains stopped front-wheel rotation through touchdown and picks it up
only under load.” Its `timeToRolling` sentinel remains zero because the
240 Hz trace never enters a fixed `|R*omega − speed| < 0.01 m/s` band during
the observed 0.3 s. This is not instantaneous pickup: the actual front
stays unloaded for four calls, then exchanges finite bounded impulses.

| Inertia law | Hz | Minimum slip-speed mismatch, m/s | First entry below 0.01 m/s | Crashes |
| --- | ---: | ---: | ---: | ---: |
| Corrected | 240 | 0.010584120 | None | 0 |
| Previous, same source | 240 | 0.010890197 | None | 0 |
| Corrected | 480 | 0.008561328 | 0.039583 s | 0 |
| Previous, same source | 480 | 0.008590494 | 0.031250 s | 0 |
| Corrected | 960 | 0.006872455 | 0.035417 s | 0 |
| Previous, same source | 960 | 0.006724921 | 0.029167 s | 0 |

All these cases remain riding. At 240 Hz the corrected run has 68 pickup
calls, maximum rotor increment 5.3743 rad/s per public call, and a final
front slip ratio of 0.001008. The previous-inertia branch also misses the
old band. The tyre needs small finite shear to accelerate on the changing
downslope; exact rolling at a prescribed time is a separate oracle issue.
This observation is not permission to loosen the bound. The assertion and
its numeric limits remain unchanged, and root assigned independent
finite-brush review to **assignment 45**.

Evidence files:

- [42-rotor-energy.json](../evidence/42-rotor-energy.json): final source
  identity, both energy/impulse ledgers, whole-jump exact comparisons,
  excluded-mode traces, and paired adverse-command cadence matrix.
- [42-wheel-pickup-counterfactual.json](../evidence/42-wheel-pickup-counterfactual.json):
  unchanged test-helper reproduction, both inertia laws, both machines,
  240/480/960 Hz, physical samples, and the precise remaining rolling-band
  failure. The reproduction changes only the airborne method in memory.

Direct targeted strict TypeScript and ESLint checks pass. All commands use
the installed binaries directly; no npm lifecycle or generated-model hooks
were invoked. Required test groups were checked with `--maxWorkers=1`.

```sh
node node_modules/vitest/vitest.mjs run \
  tests/motocross-rotor-phase-energy.test.ts \
  tests/motocross-coupled-step-contract.test.ts \
  tests/motocross-player-dynamics.test.ts \
  tests/motocross-forgiving-handling.test.ts \
  tests/motocross-jump-corridor.test.ts --maxWorkers=1

node --experimental-transform-types scripts/bench/motocross-rotor-energy.ts

node --max-old-space-size=384 --experimental-transform-types \
  scripts/bench/mx-dynamics-preservation.ts \
  --compare docs/engine/mx-dynamics-2026-11-25/evidence/non-mx-baseline.json
```

## Limits and release

This resolves the front rotor's identified phase-dependent work and brake
reaction mismatch. It does not establish passivity of the whole reduced
motorcycle model. Report 32's separate explicit yaw-damper positive-work
case, +5.730927146809005e−7 J, remains disclosed and unchanged. The existing
supported spring torque-arm/Jacobian distinction is also outside this
correction. Rotor bearing loss and chassis pitch damping are explicitly
accounted external ports in the isolated proof; no global conservation
claim is made about unrelated controller actions.

The adapter stayed at
`7a72b2747d4469bc652ce965afab4a8f94a7b1606073291c6d36045182b9361e`
through final verification. Ground solver identity is
`68b04234548a2b037f4769d38343c26ec712a61fd9261fd6dac44641c81ca4e3`.
The audit checks source stability itself. Production, new tests, observer
corrections, reproduction benchmark, report, and evidence are released to
root. No git mutation, commit, push, or child-agent spawning was performed
by assignment 42.
