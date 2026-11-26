# Agent 29 — Preserve motocross brake aid intent at the rotor boundary

Date: 2026-11-25. Wave 5, assignment 29.

## Result and scope

The ridden motocross adapter previously reconstructed front and rear actuator
torque from the raw proportioned controls. It therefore discarded the shared
core's cornering and rear-lift brake reductions. The correction publishes the
core's explicit aid ceilings independently of its applied tyre forces, then
passes those ceilings to the existing finite-rotor soil solver.

The new suite passes **18/18 cases**. An earlier combined run passed
**108/108 cases in nine files**. The immutable non-MX runner passes **all five
cases byte-for-byte**, permitting only physics identity 39 to 41. These are
focused integration results during the wider concurrent development pass;
they do not establish final full-lap acceptance.

Owned changes are confined to:

- Derived brake-aid ceiling fields and their publication/reset lifetime in
  `src/simulation/bike.ts`.
- Optional ceiling parameters and actuator selection in
  `src/simulation/offroad/mx-ground-physics.ts`.
- Brake budgeting and those arguments at the ridden MX ground call in
  `src/simulation/offroad/dirt-bike-vehicle.ts`.
- New `tests/motocross-brake-budget.test.ts` and this report.

No asset, model, character, environment, venue, bike specification, grip
coefficient, crash threshold, race limit or existing assertion was changed.
No package lifecycle hook, install, full-repository typecheck, commit, push,
or child-agent spawn was used. Production ownership was released to root
and to assignment 32's disjoint cross-slope work.

## Evidence for the discarded command

A read-only public-step probe started each production bike on a test-only
analytical level patch at 20 m/s. In Sport with the front lever fully applied,
the core permitted the following front contact forces while the rotor still
received the full mapped lever torque:

| Bike | Core front-force budget | Raw mapped front request | Measured rotor torque |
| --- | ---: | ---: | ---: |
| MX250 | 852.367588 N | 1716 N | 609.180000 Nm |
| MX450 | 883.493371 N | 1794 N | 636.870000 Nm |

The observation uses rotor angular momentum, not an actuator telemetry field:

```text
brake torque = Ifront * (omega_before - omega_after) / dt - mean_Fx * radius
```

The initial rolling state has zero first-microstep contact slip. A one
microsecond public step therefore makes the actuator discrepancy directly
observable before the wheel's subsequent slip response changes the force.
At a seeded 0.03 rad handlebar angle and supported lean, the same core could
reduce the front request to roughly 150 N while the old adapter still sent
the raw torque. The new public boundary tests exercise both MX models and
require the measured rotor torque to match the active aid ceiling.

The initial 16-case suite, before production changes, recorded **10 failures
and 6 passes**. Its failures include the missing independent ceiling
semantics, missing derived fields, missing lifetime reset, and both public
rotor-boundary cases. It then passed 16/16; two explicit engine-drag adapter
fixtures extended it to the final 18 cases.

## Why the correction does not forward net tyre force

`frontBrakeForce` and `rearBrakeForce` describe forces applied by the reduced
core to the chassis. They are clipped by available contact support, the rear
value is net of opposing engine drive, and the core suppresses body braking
at walking-scale speed. Using either value as an actuator command would
incorrectly stop a free wheel from slowing, discard rear drive/brake overlap,
or prevent a spinning stationary rotor from dissipating energy.

The new `frontBrakeAssistLimit` and `rearBrakeAssistLimit` fields describe
absolute gross actuator ceilings in newtons. Infinity means that the aids
place no restriction. They are separate from passive tyre clipping and the
core's low-speed body-force gate. In particular:

- The front ceiling records the existing lift limit, explicit cornering
  reserve and subsequent anticipatory ABS bound.
- A rear aid that permits negative **net** force of magnitude `q` gives a
  gross brake ceiling `drive + q`. The rotor still receives that opposing
  drive; subtracting it from the brake command would count it twice.
- An existing optional geometric total-braking reduction also limits the
  exported pair. The catalogue MX branch retains its existing upright lift
  model; this change does not claim to replace it with a full sprung 3D model.
- Both fields start at zero, reset before the recovery early return, publish
  after all core aid branches, and clear in `fall()`.

They are derived per-step outputs, not serialized protocol additions. Other
vehicle adapters do not consume them. The shared core's original applied
force arithmetic remains in place.

## Two independent constraints, without another multiplier

The soil solver keeps its existing slip-feedback ABS request. For each
supported axle it chooses:

```text
actual brake torque = min(existing slip-ABS torque, explicit aid ceiling)
```

It does **not** multiply a pre-reduced command by the ABS factor. For
example, the direct rotor test gives the existing slip controller a 500 Nm
request and the corner/lift controller a 300 Nm ceiling. The correct result
is 300 Nm; multiplying their reductions would give 150 Nm. Conversely, when
slip ABS asks for less than the independent ceiling, the complete solver
result is exactly equal to its old result.

A chassis-force ceiling applies only while its axle has positive support.
With no contact, no chassis brake force can violate a cornering or lift
budget, while the finite rotor still stores kinetic energy. The existing
free-wheel braking and heat calculation therefore remains unchanged. Tests
require complete result equality with and without a zero ceiling for a free
front at both 0 and 20 m/s, and for a free rear with engine/service braking
and opposing drive. There is no extra low-speed threshold.

Both limits default to unlimited, including explicit positive Infinity.
Invalid negative or NaN ceilings are rejected. Raw controls remain unlimited;
ordinary standalone callers retain exactly the previous ABS behavior.

## Engine braking, finite work and support

For an assisted ridden-MX ground step, the inherited engine-brake request
enters the core's rear budget together with the service pedal. The adapter
then supplies the same gross total and engine share to the rotor solver.
Raw and legacy paths retain their previous evaluation order. Reducing the
total rotor torque reduces its engine and service components proportionally,
so the engine share does not appear as brake-disc heat.

The current catalogue MX bikes expose no engine-brake setup map and use the
zero map through supported setups. Two initial attempts to obtain a nonzero
catalogue engine request therefore correctly returned zero, even with a
setup field that the catalogue filters out. The final adapter tests identify
their test-only subclass explicitly: it supplies a finite 300 N inherited
engine-drag request without editing a bike specification. Direct core and
soil tests separately verify service/engine equivalence and heat partition.
No current shipped MX control is represented as enabling that map.

The tests independently verify rotor momentum, finite angular work, complete
kinetic-energy change and positive contact loss. In a rear overlap case,
100 Nm drive opposes a brake command capped at 150 Nm; the resulting rotor
energy change equals their signed work. With 40% engine braking, the brake
disc receives exactly the other 60% of brake work. Existing combined-force
circle, passivity and Raw recovery thermal tests also pass.

The ceilings control the requested actuator. They do not erase a physically
real contact impulse from an already locked, spinning or landing rotor,
and must not be read as an instantaneous upper bound on every measured
chassis force. Tyre shear, wheel inertia and the existing finite-work checks
remain authoritative.

## Executed verification

All Vitest commands use the installed binary directly and `--maxWorkers=1`.

```sh
node node_modules/vitest/vitest.mjs run tests/motocross-brake-budget.test.ts --maxWorkers=1
```

Final result: **18/18 passed**, 2.41 seconds.

```sh
node node_modules/vitest/vitest.mjs run tests/motocross-brake-budget.test.ts tests/motocross-contact-traction.test.ts tests/motocross-ground-physics.test.ts tests/motocross-ground-passivity.test.ts tests/motocross-thermal.test.ts tests/motorcycle-thermal-integration.test.ts tests/motocross-drive-budget.test.ts tests/motocross-drive-reserve.test.ts tests/gp-drive-traction.test.ts --maxWorkers=1
```

The combined run, before the last two new fixtures, passed **108/108** in
13.94 seconds. It includes 17 unchanged contact-traction cases, 28 drive-budget
cases, eight GP current-drive cases, full motorcycle thermal replay and Raw
MX recovery thermal checks. Assignment 30 was integrating separate contact
code during this period; this is a provisional combined gate, not a claim
that every file was frozen at the later release hashes.

```sh
node --max-old-space-size=384 --experimental-transform-types scripts/bench/mx-dynamics-preservation.ts --compare docs/engine/mx-dynamics-2026-11-25/evidence/non-mx-baseline.json
```

Result: `pass: true`, no mismatches, **five cases**, baseline physics 39 and
current physics 41. The baseline/runner were not edited.

Focused ESLint on all three affected production files and the new test passed.
The new suite and its transitive source graph passed strict targeted TypeScript
checking with a 768 MB heap. New-test formatting and `git diff --check` passed.
Root owns the final integrated full-lap, calibration, browser and release gates.

## Observed release identities

These hashes include other agents' previously integrated work in shared files;
they identify the observed checkout, not exclusive authorship or a final
release freeze.

| File | SHA-256 |
| --- | --- |
| `src/simulation/bike.ts` | `abcd7fe3b0e1432073c42890549974a03821d0829c2f3bfe6c3cf5f54da0d7b8` |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `7fa932378aa37f4e93a51900e3e40f3aafa16a2c87f1a65537f5799fa31fa272` |
| `src/simulation/offroad/mx-ground-physics.ts` | `5ba192c09576465e2b63f377372141430f9ddb574666bc7b711af2b4891dbfe3` |
| `tests/motocross-brake-budget.test.ts` | `8d81d3c09e1bb12d7261e4e6d0f2de29b5fe697d3f34bf3e9690567f09fc219e` |

Logs are in `/home/agent/motobound-agent29-*.log`. Production edits were
complete before the first passing new-suite run at host time 14:40:49;
subsequent edits were confined to tests and this report. Ownership is released.
