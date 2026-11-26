# Agent 26 — independent gross-drive budget review

Date: 2026-11-25. Wave 5, assignment 26. Checkout:
`/home/agent/motobound-579b454ae846`.

## Scope and release

**Review complete; no production ownership held.** This report is the only
repository file written by this agent. Agent 25 owns the proposed implementation
and regression tests after the ground solver owner releases its file. This
agent reviewed source and ran three small, direct Node diagnostics. It did not
edit physics, controls, parameters, models, assets, animation data, terrain,
courses, specifications, existing tests, or serialized fields. It did not run
Vitest, a full lap, installation, package hooks, a TypeScript build, or git.

The two causal findings are independent:

1. Reconstructing a gross command with `requested * (1 - intervention)` loses
   reductions when requested drive is at most 1 N because that telemetry has an
   intentional deadband.
2. At low speed, the existing wheel-slip controller cuts an already limited
   command before the soil brush can generate the force that the core permits.
   A stationary wheel settles at about 60.3% of available rear grip even when
   the core allowed 92%.

These findings support the proposed explicit gross-command field and an
explicit already-limited solver input. They do not, by themselves, establish
the final ridden-lap outcome or validate a source implementation that this
agent did not make.

## Exact drive budget and publication point

In `src/simulation/bike.ts`, `Bike.step()` constructs the nonnegative gross
engine force in its local `drive` variable. The input is either the adapter's
`BikeInput.drive` or the existing constant-power research command.

The first traction calculation limits this force to the rear friction-circle
remainder, multiplied by `tractionMargin` (default 0.92). Wheelie control can
reduce the same variable again to retain front support. The first
`intervention` assignment follows those operations.

The core then constructs rear brake demand separately and computes:

```text
rearForce = drive - brakeR
rearApplied = clamp(rearForce, -rearCapacity, rearCapacity)
```

ABS and geometric braking limits change applied contact forces. The optional
`currentDriveTraction` branch can subsequently reduce `drive` itself again,
using the current front-braking force. It updates intervention when it does.
There are no later mutations of the local `drive` variable.

The approved `assistedDriveForce` field should therefore be assigned from
`drive` **after the optional `currentDriveTraction` block**, immediately before
the existing rear-slip and applied-force publication. Its units are newtons.
It represents the gross engine command from the latest core step, before
subtracting service or engine braking. It is neither delivered tire force nor
the net rear force. In Raw mode the field must retain the untrimmed engine
command even when that command exceeds the available rear contact force.

### Later drive reduction is observable

A direct `Bike` probe used the unchanged `BIKE` defaults, `NOVICE` with only
combined braking disabled, speed 10 m/s, a 3000 N gross engine request, full
front brake, no rear brake, and `dt = 1e-6`. The local parameter copy selected
the existing optional current-drive branch; no production parameter changed.

| Current-drive branch | Final gross command inferred above the telemetry deadband | Intervention | Front applied brake force |
| --- | ---: | ---: | ---: |
| Disabled | 1612.243153374 N | 0.4625856155 | 1642.010596945 N |
| Enabled | 1565.735073553 N | 0.4780883088 | 1642.010596945 N |

Both cores remained riding. Assigning the new field at the first intervention
line would miss this 46.508080 N reduction. This branch is currently off in
the MX caller, but a shared core output should still publish its final value.

An earlier probe retained combined braking. Its automatically added rear
brake reduced net rear force enough that this optional branch did not bind;
that observation was not evidence against the branch. The unlinked probe
above isolates the intended condition without changing the existing law.

## Deadband evidence

Both intervention assignments use:

```ts
requested > 1 ? clamp(1 - drive / requested, 0, 1) : 0
```

Direct probes supplied a 0.5 N engine request at 1 m/s, with no brakes and a
`1e-6` second step. Rear contact capacity was set in the test object to either
zero or 0.25 N; no model or specification file was changed.

| Mode | Incoming rear capacity | Reported intervention | Reconstructed request | Actual core net force |
| --- | ---: | ---: | ---: | ---: |
| Sport | 0 N | 0 | 0.5 N | 0 N |
| Sport | 0.25 N | 0 | 0.5 N | 0.23 N |
| Raw | 0 N | 0 | 0.5 N | 0 N |
| Raw | 0.25 N | 0 | 0.5 N | 0.25 N |

Because these Sport probes have no brake demand, their applied net force
equals the gross limited command: respectively 0 and 0.23 N. The requested
0.5 N cannot be reconstructed from intervention. In Raw, the true gross engine
command remains 0.5 N despite the smaller contact force; this is a separate
reason not to substitute `driveForce` for a gross actuator command.

For the real player MX path, the adapter supplies current spring loads to
`d.frontLoad` and `d.rearLoad` before calling `d.step()`. The ensuing ground
solver receives those same loads and current per-axle grip. A Sport rear
wheel with zero support therefore has a zero core traction budget, including
for a command below 1 N. The exact gross field closes the otherwise possible
tiny unsupported-wheel torque leak at that boundary.

## Low-speed brush and secondary TC derivation

Consider pure longitudinal slip, positive rear load and friction, and the
unconstrained settled soil brush. Write `P = N * mu` for peak rear force and
`u = omega * radius - speed` for wheel-rim slip speed. At zero chassis speed,
the existing brush and its telemetry reduce to:

```text
Fx / P = tanh(u / 0.9)
s = u / 3
secondary multiplier = clamp((0.36 - s) / 0.23, 0, 1)
```

To realize the core's permitted `0.92 * P` force, this brush requires:

```text
u = 0.9 * atanh(0.92) = 1.430124223657 m/s
s = u / 3 = 0.476708074552
```

The secondary controller is already fully closed at `s = 0.36`. Its onset
at `s = 0.13` is also below the brush slip required for this command. The
same friction law therefore cannot realize the core budget while this second
multiplier acts on it.

At stationary wheel equilibrium, drive torque and tire reaction torque are
equal. With an already limited `0.92 * P * radius` input, the equation is:

```text
tanh(3 * s / 0.9) = 0.92 * (0.36 - s) / 0.23
```

The root in the controller's active interval is:

```text
s = 0.209286175817
Fx / P = 0.602855296732
secondary multiplier = 0.655277496448
```

Thus a hill resistance between about 60.3% and 92% of rear grip can be
unstartable solely because of the duplicated command reduction. This is a
force-law mismatch; changing a hill-specific speed or stall threshold would
not repair it. The finite-step impulse cap can reduce instantaneous shear
further, so the derivation is a settled brush result, not a claim that every
first microstep immediately reaches that force.

### Direct solver confirmation and work check

The unchanged solver was integrated for 1440 steps of `1/720` second from rest.
The isolated fixture used mass 184 kg, front/rear loads 400/1400 N, both
friction coefficients 0.8, radii 0.355/0.345 m, wheel inertias 0.6/0.62 kg m²,
zero steering and lateral velocity, zero brakes/drag, uphill resistance 900 N,
and an already limited drive torque of
`0.92 * 1400 * 0.8 * 0.345 = 355.488 N m`.

The comparison changed only the isolated solver's secondary TC flag. The
second column retains the same already limited input; it does not represent
disabling all production Sport aids or sending an unbounded raw engine
request.

| After 2 seconds | Existing secondary TC | Same pre-limited command without secondary TC |
| --- | ---: | ---: |
| Chassis speed | 0 m/s | 1.324990738 m/s |
| Rear angular speed | 1.819879789713 rad/s | 7.933707713419 rad/s |
| Rear contact force | 675.197932340 N | 1026.898157274 N |
| Rear force / peak | 0.602855296732 | 0.916873354709 |
| Rear slip telemetry | 0.209286175817 | 0.470712807719 |
| Integrated engine work | 847.532574380 J | 4237.402619084 J |
| Integrated gravity work | 0 J | -1175.269069653 J |
| Final chassis + rotor kinetic energy | 1.026708359 J | 185.150371912 J |
| Maximum per-microstep unaccounted positive energy | 0 J | 0 J |

The secondary-TC rotor equilibrium is exactly the
`1.819879789713399 rad/s` in the previously saved player hill-stall trace.
This match follows the force law, independently of the particular rear peak
force: both torque and contact force scale with that peak.

For each single microstep the diagnostic reconstructed applied engine torque
from rear angular impulse and tire reaction:

```text
T = Irear * (omega1 - omega0) / h + meanRearFx * radius
Wengine = T * (omega0 + omega1) * h / 2
Wgravity = -mass * slope * (speed0 + speed1) * h / 2
unaccounted = KE1 - KE0 - Wengine - Wgravity
```

Both runs had a nonpositive `unaccounted` result throughout; the maximum was
zero. There is no yaw, braking, or lateral work in this fixture. This checks
that the regained acceleration is paid by additional commanded engine work,
with the existing soil dissipation and gravity, rather than an extra chassis
impulse. It is not a general energy proof for every leaned, banked, or
multi-contact trajectory.

## Early returns, resets, and serialization

The minimal safe lifetime for `assistedDriveForce` is:

1. Initialize it to zero beside the other core outputs, with a separate
   comment identifying it as gross command rather than applied contact force.
2. Reset it at valid step entry, before the `state !== 'riding'` recovery
   return. A remount completing inside `recover()` then cannot publish an old
   riding command as the current step's output.
3. Assign the final local `drive` after `currentDriveTraction` as described
   above.
4. Clear it in the existing `fall()` force/intervention zeroing chain.

After the proposed assignment point, every early exit observed in `step()`
goes through `fall()`: pitch instability, exhausted grip grace, immediate
front overload, rear highside/lowside, and excessive lean. `fall()` also
handles externally requested crashes. Its already-nonriding no-op return
does not actuate a wheel; the next valid core step resets the command before
recovery.

The MX adapter consumes this field immediately after `d.step()` and only if
`mxGround && d.state === 'riding'`. Its placement and separate airborne
integrators do not need to use this output. A value from the latest core step
may remain visible while a separate airborne path bypasses the core; the
field should be documented with that lifetime rather than falsely presented
as a universal current contact force. No additional airborne, placement,
recovery, or renderer consumer is needed for the proposed actuation fix.

`writeBikeBlock()` writes an explicit set of protocol fields and currently
serializes `intervention`, not arbitrary `Bike` object properties. Adding this
transient command therefore need not change the replay or snapshot layout.
No source search found generic enumeration/copying of the dynamics object
that would automatically serialize the proposed field.

## Constraints and remaining checks for Agent 25

- The optional `driveTorqueLimited` input is a caller assertion. Only the MX
  adapter, when passing the final gross core command, should set it. Omitted
  or false must retain the standalone solver's existing TC behavior.
- Sport's core traction and wheelie limits must remain active. The flag should
  suppress only the duplicate slip multiplier; it must not bypass contact
  friction circles, wheel inertia, equal-and-opposite reaction, ABS, or the
  finite-work limits. Raw must keep the same engine torque it had before.
- Test zero rear support and a request below 1 N through the actual player
  boundary. The exact gross field is necessary even though the previous
  telemetry reconstruction error is numerically small.
- Preserve simultaneous engine/rear-brake work. A positive gross command can
  coexist with `driveForce === 0` and a negative net rear contact force.
- Test large inherited wheel spin with a loaded rear. A pre-limited command
  below rear capacity ordinarily lets tire reaction drain excessive wheel
  energy, but a field/flag assertion alone is not a general proof for every
  combination of yaw, side slip, steering, and changing support.
- Test loaded cornering and force-circle utilization through the actual
  player adapter. The core allocates cornering reserve using its existing
  geometry, while the ground model's camber force shares follow actual loads;
  the proposed boundary correction preserves those laws and does not claim
  to eliminate every difference between them.
- Check actual launch on a physically feasible hill, refinement at supported
  worker rates, and the unchanged two-lap integration gate. The isolated
  derivation and diagnostic cannot substitute for those integrated results.
- Core field tests should include the final `currentDriveTraction` reduction,
  a later fall, nonriding recovery, and recovery-to-riding. Avoid weakening an
  existing assertion to accommodate the proposed behavior.

## Observed source provenance and reproduction

The main deadband/soil diagnostic read SHA-256 values before and after its
execution; each matched. These identify the reviewed baseline, not a freeze
of the shared checkout while other agents work.

| File | SHA-256 |
| --- | --- |
| `src/simulation/bike.ts` | `bed29baf8e62d044c27188882a724588a07d24ee513191079869bedd0485c1ba` |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `ef32cf97204a1894285a670ab8e7ae614fddc824ed17da3cbd21ab78a8ddb458` |
| `src/simulation/offroad/mx-ground-physics.ts` | `6c2ab06f3f1116d593ddfea26194ad6146f4f01da119a13d0c9be2f7ba470a81` |

Diagnostics used the existing Node runtime directly:

```sh
node --experimental-transform-types --input-type=module <<'NODE'
// Import Bike/BIKE/NOVICE/EXPERT and stepMotocrossGround from the local source.
// Execute the parameterized core and 1440-step soil fixtures specified above.
// Compute wheel-impulse torque and finite-work residual every microstep.
NODE
```

The executed here-documents were transient, read-only diagnostics and are not
presented as committed regression tests. Their concrete results are recorded
above and sent to Agent 25 and root. The implementation and automated
regression ownership remain with Agent 25.
