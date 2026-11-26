# Agent 16 — MX drive-command reserve at the core/ground boundary

Date: 2026-11-25. Ownership: `tests/motocross-drive-reserve.test.ts` and this report only. No production source was edited. In particular, the adapter, core, existing ground solver, geometry, materials and terrain remain owned by their respective implementation agents. No full lap run, install, package hook, full TypeScript build, commit or push was performed.

## Finding

**Confirmed: the ridden MX adapter discards an existing Sport engine-torque intervention before actuating the rear wheel.** The smallest correction is to forward the core's already reduced gross drive command into the current wheel/soil solver. A new tyre friction law or newly tuned reserve is unnecessary for this defect.

This is a demonstrated actuation boundary defect. It is **not** a demonstrated complete explanation or cure for Valley's sustained opposite lean, its eventual lowside, or either two-lap integration failure. The saved lap file does not contain engine torque, wheel angular speed or the intermediate core intervention. The direct evidence below comes from an independently controlled, one-step production probe using the saved state shape.

## Exact boundary

1. `DirtBikeVehicle.step()` computes drivetrain force with `this.drive(dt, throttle)` and supplies it as `BikeInput.drive` to `Bike.step()`.
2. `Bike.step()` applies its existing traction-circle and wheelie/front-load budgets to gross engine drive, then publishes `intervention = clamp(1 - drive / requested, 0, 1)` when the request exceeds 1 N. This occurs before subtracting rear brake force. Current-drive TC can further update the same intervention where that option is enabled.
3. The adapter's ridden `mxGround && d.state === 'riding'` branch currently passes `driveTorque: force * spec.rearWheelRadius` into `stepMotocrossGround()`, ignoring that intervention.
4. The ground solver's existing TC scales this command using only current rear slip. At initially rolling wheel speed that scale is one. Its friction circle still bounds contact force, but it cannot recover the controller's missing engine command limit.
5. The adapter overwrites `d.driveForce` with the ground solver's actual rear contact force. Consequently, a high intervention can coexist with a physically untrimmed wheel torque and a much larger actual drive force.

### The existing reserve is narrower than the road contact controller

The MX adapter does **not** populate `d.contactLoads`. Therefore the richer `roadReserve` branch involving intended lean, `roadLateralDemand` and uncapped recovery demand is inactive here. MX currently uses `mass * abs(speed² * curvature)` as the scalar cornering reserve, plus the existing minimum static front-support rule. Restoring the existing engine limit does not install the separate sprung road contact controller.

## Direct torque and force evidence

Read first: `agents/14-ridden-lap-diagnosis.md`, `/home/agent/mx-lap-debug-579b454ae846.ts`, and `/home/agent/motobound-diagnostics-579b454ae846/laps.json`.

The saved Valley lowside ring begins at t157.975 s / s343.5634 with speed 10.37533 m/s, lean −0.646945 rad, lean rate −0.983104 rad/s, bar steer −0.132745 rad, front support 133.1488 N, rear support 1684.3478 N, throttle 0.375933 and requested steer +1. The trace establishes this contrary roll/control state but does not itself record torque.

The controlled boundary probe places a production bike on Valley's flat rig at s35, sets those incoming speed/roll/support values, uses third gear and rolling wheel speeds, and runs one 1/240 s production adapter tick. This is deliberately **not** a reconstructed suspension pose or a replay of the saved lap. Rolling initial wheels isolate the command loss before slip-only TC can respond.

Rear angular momentum provides a direct measurement independent of the adapter's command expression:

```text
mean engine torque = I_rear * (omega_after - omega_before) / dt
                   + mean rear tyre force * rear radius
                   + mean rear brake torque
```

The reserve probes have no brake request or engine braking. The ground solver reports the same interval-mean tyre force that exchanged wheel momentum.

| Probe | Gross requested torque | Existing core torque budget | Observed physical engine torque |
| --- | ---: | ---: | ---: |
| MX250 Sport | 93.692940 N·m | 2.784295 N·m | 93.692940 N·m |
| MX450 Sport | 183.921285 N·m | 2.852411 N·m | 183.921285 N·m |
| MX250 raw | 93.692940 N·m | No intervention | 93.692940 N·m |
| MX450 raw | 183.921285 N·m | No intervention | 183.921285 N·m |

For MX450 the core receives **533.105173 N**, publishes intervention **0.9844911302**, and permits **8.267859 N** of gross drive. The ground solver then supplies **228.532794 N** of mean rear tyre force and rear rotor speed rises from 30.073414 to 30.779580 rad/s. Its measured engine torque is the full original **183.921285 N·m**. Raw mode produces the same engine torque and initial tyre force despite publishing zero intervention.

A separate direct call to the unchanged ground solver with the captured command/state/parameters demonstrates the proposed boundary correction without modifying production source:

| MX450 one-step ground solve | Current untrimmed request | Forwarded existing budget |
| --- | ---: | ---: |
| Input rear drive torque | 183.921285 N·m | 2.852411 N·m |
| Mean rear longitudinal force | 228.532794 N | 4.738710 N |
| Rear angular speed after tick | 30.779580 rad/s | 30.081597 rad/s |
| Mean rear combined-circle utilization | 0.809809 | 0.793853 |
| Endpoint lateral acceleration | −8.258447 m/s² | −8.255162 m/s² |

The last row is useful: this probe establishes correct torque spending, not an instant correction of the roll trajectory. Returning front support requires subsequent suspension/roll dynamics, and the wrong-side-lean boundary still merits separate evaluation.

## Exact adapter correction for root after upstream reconciliation

Inside the existing ridden MX ground call, replace:

```ts
driveTorque: force * spec.rearWheelRadius,
```

with:

```ts
// Preserve the core's gross engine intervention before slip TC further
// limits the wheel torque. The tyre solve still owns actual contact force.
driveTorque: force * (1 - d.intervention) * spec.rearWheelRadius,
```

No additional optional solver parameter or helper is required. This gate already excludes AI, supermoto and airborne paths. Raw mode publishes zero intervention and therefore retains its engine command. The solver retains its existing slip TC, coupled friction circles, wheel inertia and equal/opposite contact reaction.

**Do not substitute `d.driveForce`.** That value is already the core's nonnegative, limited **net rear tyre force** after brake subtraction. Forwarding it as engine torque would remove legitimate simultaneous engine/rear-pedal operation and count braking twice. Two regression cases explicitly protect this distinction: a stronger rear pedal makes core net drive zero while the gross engine command remains positive.

Small-command limit: `Bike.intervention` intentionally reports zero when requested drive is at most 1 N. Reconstructing the existing command from this telemetry preserves that ≤1 N deadband (≤0.345 N·m for these tyres); it is exact for the demonstrated and normal powered cases. A future dedicated actuator-command field could represent that tiny range exactly, but it is not necessary to establish or correct the large lost-reserve defect and would require separate core ownership.

Root reported concurrently published upstream main `39d9d497880e92801a7d77de6af2639b4186bfcc` during this work and requested no adapter wiring before reconciliation. Agent 13 was informed and agreed to release the adapter after its own work. The above production change therefore remains intentionally unapplied by this agent.

## Regression and validation

Added `tests/motocross-drive-reserve.test.ts` with six cases across MX250/MX450:

- Sport's engine actuator stays below the existing core torque budget before rear slip starts.
- Raw engine torque is conserved through measured rear angular and tyre impulse.
- Gross engine torque remains present when a stronger rear pedal makes core net rear drive zero.

Direct command used, bypassing package hooks:

```text
node node_modules/vitest/vitest.mjs run tests/motocross-drive-reserve.test.ts tests/motocross-front-steering-authority.test.ts
```

Result before the proposed wiring: **16 passed, 2 failed**. The two failures are the intended missing-Sport-limit regressions: 93.692940 > 2.784295 N·m and 183.921285 > 2.852411 N·m. All four raw/overlap tests pass. All 12 existing front-steering-authority cases pass, including unsupported-front invariance, a real raw wheelie, loaded-rear dissipation and the exact existing supported combined-braking fixture.

No momentum or energy equation changed. The proposed correction only reduces powered input to the same finite-inertia plant; contact friction limits and unsupported-front steering behavior remain under the existing solver and focused suite. After the one-line adapter change, rerun this same small command to close the intentionally red regression.

## Separate follow-up, not implemented

Core cornering/stoppie **brake** intent may cross a similar boundary: the adapter currently constructs rotor brake torque from pedal requests, while the MX solver applies slip ABS. This should receive a dedicated audit of gross rotor requests, coupled engine/brake operation and transient support before reusing any core force field. It was not investigated or changed here, and the drive finding should not be generalized to a brake fix without direct actuator/impulse evidence.
