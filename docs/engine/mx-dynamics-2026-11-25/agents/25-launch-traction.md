# Agent 25 — exact gross drive budget and hill-start traction

Date: 2026-11-25. Wave 5, assignment 25.
Checkout: `/home/agent/motobound-579b454ae846`.

## Release status

**Production ownership is released.** The duplicated drive-aid reduction and
the small-command reconstruction error are corrected. All **28 new cases
pass**, including 12 starts from rest on the unchanged production Valley and
Arena faces. The wider focused run initially recorded **70 passed, 1 failed**;
root subsequently resolved that existing fixture with **17/17 contact-traction
cases passing and no assertion changes**. The unchanged two-lap ridden
diagnostic still has separate failures, detailed below; this
report does not declare the complete MX integration green.

Owned changes:

- `src/simulation/bike.ts`: the exact, derived `assistedDriveForce` output,
  its final-budget assignment, and its reset lifetime.
- `src/simulation/offroad/mx-ground-physics.ts`: optional
  `driveTorqueLimited` contract and the corresponding drive-actuator condition.
- `src/simulation/offroad/dirt-bike-vehicle.ts`: the two gross-drive command
  arguments at the player MX ground call.
- New `tests/motocross-drive-budget.test.ts` and this report.

Agent 22 explicitly released the ground source before these edits. Agent 27
subsequently took the disjoint planar-displacement projection lines. The
stable measurements in this report predate Agent 27's changes.

No friction law, grip cap, bike parameter, traction threshold, controller
target, crash threshold, recovery behavior, asset, model, animation, venue,
environment, or specification data was changed. No existing test assertion
was changed. There were no git mutations, package hooks, installation, full
TypeScript build, commit, or push. One read-only `git status` was used during
initial file inventory; root confirmed read-only git use was acceptable.

## Proven mechanism

### Current support was already budgeted before the wheel solve

The player adapter supplies the current spring loads to `Bike.step()` before
its force calculation. `Bike.step()` therefore uses the same rear support
and per-contact grip that the ground solver receives. With Sport active it
limits gross engine drive to the existing rear friction-circle remainder
times the existing 0.92 margin, and also applies its existing front-support
limit. The adapter had been forwarding this limited gross command as
`force * (1 - intervention)` after Agent 16's earlier boundary correction.

The soil solver then multiplied it by another controller:

```text
secondary multiplier = clamp((0.36 - rear.slip) / 0.23, 0, 1)
```

At rest, the longitudinal brush and telemetry use different scales:

```text
Fx / (N·μ) = tanh(rimSlip / 0.9)
rear.slip  = rimSlip / 3
```

Realizing 92% of rear grip requires
`rimSlip = 0.9 * atanh(0.92) = 1.430124 m/s`, hence reported slip
`0.476708`. The secondary controller is already completely closed at 0.36.
For an already budgeted 92% command, the stationary equilibrium instead solves

```text
tanh(3 * slip / 0.9) = 0.92 * (0.36 - slip) / 0.23
```

Its solution is slip `0.2092861758`, or only **60.28552967% of rear grip**.
A hill requiring between this value and the permitted 92% can become
unstartable even though the rider's existing aid budget is sufficient.
These numbers are the steady pure-longitudinal brush prediction; transient
finite-step and combined-force limits remain additional physical bounds.

Agent 26 independently verified the derivation and ran the actual solver.
For mass 184 kg, rear support 1400 N, μ 0.8, the existing 92% budget and
900 N uphill resistance, the old controller settled at rear angular speed
**1.819879789713399 rad/s**. That is exactly the rotor speed in root's saved
player hill-stall trace. Its force was 675.197932 N. Passing the same permitted
gross command without the second reduction produced 1026.898157 N and
1.324991 m/s after two seconds. See `26-drive-budget-review.md` for the
independent probe and work residuals.

### Telemetry also lost the exact small-command budget

`intervention` deliberately reports zero when the original drive request is
at most 1 N. For a 0.5 N request and 0.25 N rear capacity, Sport permits
0.23 N while that telemetry remains zero. Reconstructing the actuator as
`request * (1 - intervention)` instead supplies 0.5 N. With zero rear support,
the actual permitted command is zero and the same reconstruction still
supplies 0.5 N.

This was corrected with an exact command output rather than a change to the
telemetry deadband. Net `driveForce` is unsuitable because it has already
subtracted rear braking and clipped negative net force; using it as engine
torque would erase legitimate engine/rear-pedal overlap and count braking
twice.

## Implementation and retained behavior

`Bike.assistedDriveForce` contains the final gross engine command in newtons.
It is initialized to zero, reset at each valid core-step entry before the
recovery early return, assigned from the final local `drive` after optional
`currentDriveTraction`, and cleared in `fall()` alongside the other force
outputs. Assigning it after the optional current-load branch matters: the
independent review found a simultaneous front-braking case whose first-pass
command was 1612.243153 N and final command 1565.735074 N.

Only the player MX ground adapter consumes the new output:

```ts
driveTorque: d.assistedDriveForce * spec.rearWheelRadius,
driveTorqueLimited: true,
```

The solver retains standalone slip TC whenever `tractionControl` is true
and `driveTorqueLimited` is absent or false. For an explicitly budgeted
command it applies that command once, preserving the core's current-load
traction and front-support limits. Raw mode still has no traction
intervention; its exact gross request is preserved. The new field is derived
per-step output and is not added to the serialized bike protocol or replay
state. Other consumers remain unchanged.

The vector brush, both combined friction circles, equal/opposite wheel
reaction, finite wheel inertia, finite contact-impulse bounds, ABS, rear
engine/friction-brake separation, and soil dissipation all remain in place.
An unloaded rear still has zero contact force; with Sport its current-load
core command is also zero, while Raw may spin the free rotor.

## Tests and independent work accounting

The new suite first ran against unchanged production source: **16 failed,
3 passed, 19 total**. Its intended failures included all three isolated
hill-start rates, full permitted actuator torque under appreciable slip,
the absent exact command, and both real Arena starts. After the narrow
implementation, all 19 passed. The final suite extends this to **28 cases**.

Coverage includes:

- A mechanically feasible isolated hill at 120, 240 and 480 Hz. Its 902.52 N
  uphill load is below the 1030.4 N existing gross force budget. The old
  secondary controller leaves speed exactly zero; the corrected contract
  produces positive acceleration without changing either number.
- Exact default/explicit-false equivalence for standalone slip TC.
- Wheel/chassis momentum and finite work with 0.6, 1.5 and 8 m/s rim slip.
- Decay of excessive initial wheelspin under a bounded engine command.
- Supported cornering inside both unchanged combined force circles.
- Nonzero and zero budgets inside the ≤1 N telemetry deadband, final
  current-load drive publication, and fall/recovery clearing.
- Actual MX250/MX450 Sport launch-slip and loaded-corner engine actuation,
  current rear unloading, Raw free-rotor torque, and simultaneous engine plus
  stronger rear pedal operation.
- Both native venue hill faces, both models and 120/240/480 Hz, with Sport
  still enabled, production placement/suspension/drivetrain/soil, full
  throttle and first gear. No support load, rotor state, slope, rider pose,
  flight state, or terrain is fabricated for those starts.

Actuator torque is measured independently through rear angular momentum:

```text
engine torque = Irear * Δω / Δt + mean rear Fx * radius + rear brake torque
```

The isolated one-microstep tests also compute engine work from finite rotor
travel and contact loss from the finite relative patch travel. They require
the kinetic-energy change to equal that engine work minus contact loss.
Thus the added traction is paid by the already permitted engine work, not
an unexplained velocity correction. The existing gross-drive/brake-overlap
suite remains green.

### Native hill starts after one second

The old Arena starts had exactly zero forward travel with both bikes after
one second. At 240 Hz, the corrected production plant records:

| Bike | Unchanged face | Forward travel | Ground speed | Sport intervention | Crashes |
| --- | --- | ---: | ---: | ---: | ---: |
| MX250 | Arena s153.85, lateral −2.5979 | 0.395172 m | 1.043455 m/s | 0.521206 | 0 |
| MX450 | Arena s153.85, lateral −2.5979 | 0.367337 m | 0.969222 m/s | 0.691929 | 0 |
| MX250 | Valley s593.7997, lateral −1.3447 | 0.398081 m | 1.027948 m/s | 0.521206 | 0 |
| MX450 | Valley s593.7997, lateral −1.3447 | 0.371817 m | 0.959293 m/s | 0.691929 | 0 |

Across all 12 model/face/rate combinations, travel is 0.363527–0.399845 m
and speed 0.954480–1.045760 m/s, with zero crashes. The substantial retained
intervention demonstrates that the rider's existing drive aids still act.
The diagnostic's before/after source fingerprints match.

### Commands and results

All Vitest commands used the local executable directly with `--maxWorkers=1`.

```sh
./node_modules/.bin/vitest run tests/motocross-drive-budget.test.ts --reporter=dot --maxWorkers=1
```

Final result: **28/28 passed**, 2.57 seconds. During extension, three direct
`Bike` fixtures initially omitted the required `rider: 0` input and produced
NaN. Supplying that required neutral input corrected the fixtures; no
production behavior or assertion was weakened.

The first combined soil run covered the initial 19 new cases plus
`motocross-drive-reserve`, `motocross-ground-physics`,
`motocross-ground-passivity`, and `motocross-cross-slope`:
**65/65 passed**, 4.87 seconds.

The final adapter/shared-core run was:

```sh
./node_modules/.bin/vitest run tests/motocross-drive-budget.test.ts tests/motocross-drive-reserve.test.ts tests/motocross-contact-traction.test.ts tests/motocross-front-steering-authority.test.ts tests/gp-drive-traction.test.ts --reporter=dot --maxWorkers=1
```

Intermediate result: **70 passed, 1 failed, 71 total**, 9.07 seconds. The existing
Raw MX450 wheelie case compares front-brake and coast speeds with tolerance
5e−9 m/s. It observed 4.3379710485987575 versus 4.33797101632979 m/s, a
3.2268967e−8 m/s difference. This agent made no assertion change, and the Raw
gross engine path is algebraically unchanged by this correction.

Root subsequently corrected the fixture and reported **all 17
contact-traction cases passing, with every original assertion retained**.
The fixture now uses an analytical level patch and a fully converged manual
rearward body stroke, removing the automatic rider-brace coupling from this
isolated front-contact comparison. It allows 50 ms for the initially
overspeed rear rotor to enter braking. The wheelie still comes from actual
rider controls and production suspension; its front/coast trajectory checks
remain exact. The original minute speed difference therefore must not be
ascribed solely to the bank. This is root's separate fixture correction, not
a drive-law change by this agent. The five-suite count above records the
actual intermediate run; Agent 25 did not rerun the whole group after root's
independently verified correction.

Focused ESLint on the three production files and new test file passed.

## Full ridden-lap diagnostic remains red

Ran the unchanged `/home/agent/mx-lap-agent21-579b454ae846.ts` with argument
`agent25-drive-budget`. The five recorded source fingerprints were stable
throughout the run. Both venues completed two laps:

| Venue | Two-lap time | Longest riding stall | Crashes |
| --- | ---: | ---: | ---: |
| Valley Ridge | 225.716667 s | 0.400000 s | 1 |
| Arena Nord | 177.166667 s | 6.941667 s | 0 |

The original high-throttle Arena hill-start defect is closed by the direct
production starts above. The longer Arena diagnostic stall occurs elsewhere,
around s478, and its captured late-stall trace has nearly level ground,
speed 0.017038 m/s, target 16.231617 m/s, throttle **0.04999175**, and zero
brake request. That is a different controller/trajectory situation from the
original s153.85 hill with full requested throttle. The saved ring contains
the evidence for root's subsequent controller investigation; it does not
establish the cause of the small throttle request.

Valley's crash is `crash-front` at s593.835554 / t174.3375, after landing
at lateral +5.929189 m. The landing record has pitch error −0.578524 rad,
normal speed 6.777267 m/s, and takeoff speed 11.604952 m/s. Root received the
full trace. No crash bound or jump target was changed to hide this failure.

The prior Agent 24 laps used an earlier shared bank-force/source snapshot.
Their numbers therefore cannot be used as a controlled before/after
attribution of every lap change to this drive fix. The isolated tests and
native starts establish the local actuator defect and correction; the final
integrated release still needs the controller, landing, and transport work.

## Provenance and handoff

Stable diagnostics:

```text
/home/agent/motobound-diagnostics-579b454ae846/agent25-hill-starts.json
/home/agent/motobound-diagnostics-579b454ae846/agent21-laps-agent25-drive-budget.json
```

| File at the stable native-start snapshot | SHA-256 |
| --- | --- |
| `src/simulation/bike.ts` | `cfd3f24c3847ff45ebf59567f7bcc057033ba8ef41c5bc1802acb3f8b4912e37` |
| `src/simulation/offroad/dirt-bike-vehicle.ts` | `74df162bfee32214260d44db856d5d6085595d98ba14165fc61f59520b89d042` |
| `src/simulation/offroad/mx-ground-physics.ts` | `50a7761f89e7c77a602b14a80eb2b98eb16909b03864d8392238d0fe404084a9` |
| `tests/motocross-drive-budget.test.ts` | `1c21f668c97d79e68e1756214bc3250e88091d5ebfb83f1f014fda843121374d` |

The two-lap runner additionally recorded unchanged AI
`af74fb9ae81eddc305f565b91c8488d518211f32da140ba811ca2aa8e8971982`,
rider weight `5027085c4bb2b192d89a0368d56ca9296b34ed5130e936db0741eed30304ad96`,
and contact impulse
`825d280cfd4c1769db8fee0abcdfa91989f4c6b73ac502e120f59f1061afa28e`.
Its older five-file fingerprint list does not include `bike.ts`; the native
probe above separately records the exact new core source. Agent 25 did not
change that core source between either diagnostic.

Agent 26's independent review is complete in `26-drive-budget-review.md`.
Source ownership is released to root and Agent 27's disjoint projection work.
