# Assignment 45 — wheel-pickup event coordinate and physical work

Wave 8; 25 November 2026.

## Result

The remaining MX250 timing failure was a phase mismatch in the test's
rolling-band observation. The loaded contact solver reaches the original
**0.01 m/s** band. The subsequent terrain sample re-expresses chassis speed
in a new terrain chord while preserving horizontal momentum; the front
rotor has not yet received a tyre impulse in that new coordinate frame.
The old sentinel measured that later published mismatch instead of the
resolved contact event.

The test now observes the actual force-solve endpoint before `writeBody()`
resamples terrain. Its original band, timing origin, strict lower bound
**3/240 s**, strict upper bound **0.2 s**, maximum per-call rotor increment,
unloaded-wheel invariance, positive pickup, zero crashes, and continued
riding assertions remain. The native approach and airborne controls are
unchanged. All original wet/dry force and spin comparisons, thermal-related
checks, ballistic motion assertions, AI/supermoto exclusions, and replay
checks retain their meaning and numeric limits.

**14/14 tests pass** in `tests/motocross-wheel-pickup.test.ts`: the original
11 cases plus two cadence/observer comparisons and one exception-restoration
case. Targeted strict TypeScript, ESLint, and whitespace checks pass.
Production source did not change. Root reviewed and accepted this phase-only
oracle correction.

## The actual contact coordinate

The ridden MX adapter supplies `lean` to `stepMotocrossGround()`. In that
branch, the rolling-cone steering demand is represented separately; the
longitudinal brush coordinate is the incoming along-ground scalar speed.
It is not the non-lean solver's steered projection
`speed*cos(steer) + (lateralSpeed + frontArm*yawRate)*sin(steer)`. Applying
that other branch's projection would introduce another oracle error.

During one actual interval:

1. The ground solver advances chassis and rotor momenta against the incoming
   terrain chord and actual incoming support loads.
2. `writeBody()` samples the next front/rear terrain patches and obtains a
   new road pitch. Assignment 40's transport preserves the represented
   horizontal velocity, `u = speed*cos(roadPitch)`.
3. The normal/suspension solve and body publication finish. The public tyre
   slip diagnostic then compares rim speed with the new along-ground speed.

Both phases are meaningful. The public diagnostic describes the published
endpoint; it is not the force solve's residual in its original frame.
The pickup event belongs to the completed loaded force solve. The next
interval is responsible for responding to any mismatch introduced by the
changing terrain metric.

The observer uses actual `stepInterval` durations and records state just
before the original `writeBody` call. It does not supply a contact, force,
rotor speed, terrain sample, or physical outcome. Elapsed event time is the
sum of those durations starting when the original `land()` helper returns,
preserving the old public landing timing origin. It does not relabel that
origin as the exact swept first-contact time. The helper supports inner
intervals rather than multiplying an inner index by public `DT`.

### Direct causal sample

For MX250 at 240 Hz, 0.05 s after the original landing-helper return:

| Quantity | Observed value |
| --- | ---: |
| Rotor speed | 28.166591724777 rad/s |
| Contact-frame chassis speed | 10.001546002133 m/s |
| Contact-frame rolling mismatch | **0.002405939837 m/s** |
| Incoming road pitch | −0.229657979058 rad |
| Newly sampled road pitch | −0.234504727395 rad |
| Published chassis speed | 10.013009160849 m/s |
| Coordinate re-expression of speed | +0.011463158716 m/s |
| Published rolling mismatch | **0.013869098553 m/s** |
| Mean front contact force | −20.104855908227 N |

The contact residual is already below 0.01. The same unchanged rotor then
appears outside that band in the new terrain coordinate. Across all six
cadence runs, the largest horizontal-velocity discrepancy during this
post-force publication is **3.55e−15 m/s**. Rotor rotation is unchanged
exactly. Thus the observed difference is a coordinate re-expression, not
an unaccounted pickup impulse or a rotor reset.

## High-cadence counterfactual

All rows use the original surveyed RIDGE TABLE approach. The approach
remains at 240 Hz; flight and post-landing stepping use the listed cadence.
No terrain or model was changed, and no landed state was fabricated.
Every row remains riding with zero crashes.

| Machine | Hz | First loaded force-phase band entry, s | First public band entry, s | Minimum force-phase mismatch, m/s | Minimum public mismatch, m/s |
| --- | ---: | ---: | ---: | ---: | ---: |
| MX250 | 240 | **0.045833333** | None | 0.002398556 | 0.010584120 |
| MX250 | 480 | **0.035416667** | 0.039583333 | 0.003433311 | 0.008561328 |
| MX250 | 960 | **0.034375000** | 0.035416667 | 0.004215773 | 0.006872455 |
| MX450 | 240 | **0.087500000** | 0.100000000 | 0.002736486 | 0.003565467 |
| MX450 | 480 | **0.083333333** | 0.085416667 | 0.003373851 | 0.003822828 |
| MX450 | 960 | **0.081250000** | 0.081250000 | 0.003848883 | 0.003950921 |

Successive force-phase timing differences shrink from 10.417 to 1.042 ms
for MX250 and from 4.167 to 2.083 ms for MX450. The new tests retain the
same timing band at every cadence and require the finer timing difference
to shrink. These are finite-step event observations, not a claim that the
entire coupled integrator has a particular formal convergence order.

The ground solver uses `ceil(dt*720)` internal force updates. A 240 Hz
physical interval therefore has three 1/720 s contact updates; a 480 Hz
interval has two 1/960 s updates; a 960 Hz interval has one 1/960 s update.
The 480→960 comparison changes the cadence of terrain and coupled state
publication even though its contact-update duration is unchanged. That
distinction supports the measured phase/coordinate cause rather than a
claim that the missing sentinel proves a tyre integration failure.

Report [42](42-rotor-energy.md) and its
[same-source inertia counterfactual](../evidence/42-wheel-pickup-counterfactual.json)
already showed that the old public sentinel also fails with the preceding
front-inertia law. This assignment independently establishes why the
current frozen runtime misses that sentinel. It does not undo the physical
inertia correction or alter the contact-work correction from report 32.

## Independent angular impulse and work accounts

Neutral controls are used after the real landing, so there is no service
front-brake work. The tests independently check each observed interval:

```text
I_front * (omega_contact − omega_before) = −R_front * meanFx_front * h
```

The live physical front inertia and radius are used. The largest measured
angular-impulse residual across the six runs is **2.79e−15 N·m·s**. The
assertion uses ten decimal-place agreement. An unloaded front must have
zero force, zero slip work, and unchanged rotation; every loaded interval's
force must remain within that contact's own `normalLoad*mu` budget.
The original sudden-wet-front versus sudden-wet-rear comparisons are
untouched and still pass.

Rotor kinetic work is calculated from its measured endpoint rotation,
`0.5*I*(omega_after² − omega_before²)`. Chassis work extraction is bounded
using the measured initial and contact-end speeds and the observed contact
impulse on this native straight, neutral-control path. The accumulated rotor
gain plus actual front slip-work port must lie inside that measured work
envelope. Each rotor increment is also separately required to fit the
available upper work bound, and both rotor gain and slip heat must be
nonnegative. No brush response curve is reproduced in this account.

| Machine | Hz | Rotor gain, J | Slip work, J | Chassis extraction envelope, J | Gain + slip minus envelope midpoint, J |
| --- | ---: | ---: | ---: | ---: | ---: |
| MX250 | 240 | 271.659562 | 240.219530 | 510.873590–512.862354 | +0.011120 |
| MX250 | 480 | 271.716893 | 238.685235 | 509.878453–510.903952 | +0.010926 |
| MX250 | 960 | 271.688502 | 238.371830 | 509.792501–510.309724 | +0.009220 |
| MX450 | 240 | 281.409109 | 259.453232 | 539.809882–541.884678 | +0.015061 |
| MX450 | 480 | 281.235886 | 258.278643 | 538.978506–540.018828 | +0.015861 |
| MX450 | 960 | 281.334113 | 257.772419 | 538.831097–539.351634 | +0.015167 |

The last column is an endpoint-work quadrature residual, not an assertion
of exact whole-bike energy conservation. All six totals are inside their
measured work envelopes, which narrow under refinement. Gravity, rear
powertrain work, normal suspension work, and other chassis ports are not
folded into a false closed-system claim.

After initial pickup, these downhill paths still require negative front
contact force to accelerate the rotor. The final observed rotor increment
is positive and its contact-frame shear remains positive. A finite brush
needs that small shear to generate torque. The retained 0.01 m/s test is
therefore a first-entry event, never an exact rolling-speed clamp or a
requirement for zero slip forever.

## Observer transparency and validation

Six native observed/unobserved pairs compare **1,008 public states exactly**:
two bikes at 240, 480, and 960 Hz for 0.3 s after landing. The compared data
include chassis motion, body transforms and velocities, every tyre state,
thermal state, controls, rider motion, fuel, gearbox state, suspension and
machine rates, and landing/crash state. The observer's inherited method
descriptors are restored after every run and also after a deliberately
interrupted diagnostic. No state prescription is hidden in the observer.

Validation used installed executables directly:

```sh
node node_modules/vitest/vitest.mjs run tests/motocross-wheel-pickup.test.ts --maxWorkers=1
node --max-old-space-size=512 node_modules/typescript/bin/tsc --project test-results/agent45-tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js tests/motocross-wheel-pickup.test.ts
git diff --check -- tests/motocross-wheel-pickup.test.ts
```

The temporary strict compiler configuration extends the unchanged project
configuration and includes only the owned test's dependency graph. An
initial protected-field typing error in the observer was corrected with an
explicit read-only observation cast. No compiler policy changed.

The causal samples, six cadence summaries, impulse/work metrics, validation
counts, and source identities are in
[45-wheel-pickup-contract.json](../evidence/45-wheel-pickup-contract.json).
The larger temporary trace and reproduction script remain under ignored
`test-results/`; the committed regression reproduces the native scenarios
and physical checks without requiring that diagnostic output.

## Release and limits

| Item | SHA-256 |
| --- | --- |
| Frozen full runtime fingerprint | `a153c34d852b156d5638b2175766e5f22135aa9045af2796cd2e7d9afdd5f9d0` |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `7a72b2747d4469bc652ce965afab4a8f94a7b1606073291c6d36045182b9361e` |
| `src/simulation/offroad/mx-ground-physics.ts` | `68b04234548a2b037f4769d38343c26ec712a61fd9261fd6dac44641c81ca4e3` |
| `tests/motocross-wheel-pickup.test.ts` | `fd35948fae7d3d176961f1b89546a2e51b4007fc565e68a3d9c960e44b00cd0d` |

The full runtime fingerprint was recomputed using Vite's source-file recipe
and still matches the freeze. No production physics, models, character
geometry, assets, authored environment, venue, calibration, or rendering
changed. No npm lifecycle hooks, build, browser session, child agents, git
mutation, commit, or push were used. Assignment 44 retains browser/build
ownership; assignment 46 received the final test hash for its aggregate
frozen-source sweep.

This local straight-line work envelope is not a general energy theorem for
every curved or banked trajectory. The separate yaw-damper and suspension
Jacobian limitations documented by the earlier reports remain unchanged.
Test, report, and evidence ownership are released to root. No further
edits or optional checks are pending from assignment 45.
