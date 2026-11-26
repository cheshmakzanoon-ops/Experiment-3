# Agent 02 — traction, braking, steering and rider-weight audit

Date: 2026-11-25. Baseline: `f3b39eb8e1b02fc0677086819fc384b6ceacefc2`.

Scope: read-only production audit of the ridden MX-250/MX-450 force path. No production, model, character, geometry, material, or environment files changed. Probes below changed only ephemeral simulation inputs. This report is the sole authored file.

## P1 — Handlebar steering still turns a front-unloaded bike through its rear tyre

**Confirmed with a direct solver reproduction.** In `src/simulation/offroad/mx-ground-physics.ts`, curvature comes directly from `tan(steer) / wheelbase` at line 169. The lean-coupled branch at lines 229–243 allocates the resulting demanded lateral force by current load share. If the front is free, the rear receives the entire handlebar demand. Lines 283–288 convert that force into heading change without requiring front contact. The production caller always supplies `lean` at `dirt-bike-vehicle.ts:579`, so this is the live player-MX branch.

Inputs: 16 m/s, zero lateral speed/yaw/heading/lean, correctly rolling rotors, mass 184 kg, front/rear arms 0.75/0.73 m, radii 0.355/0.345 m, inertias 0.6/0.62 kg m², front/rear load 0/1800 N, mu 0.8/0.8, no drive/brake/drag/slope, `dt = 1/120`.

| Steer | Front Fy | Rear Fy | Heading change | Returned yaw rate |
| --- | ---: | ---: | ---: | ---: |
| 0 | 0 N | 0 N | 0 rad | 0 rad/s |
| +0.04 | 0 N | +1273.760492 N | +0.003605526756 rad | 0 rad/s |
| -0.04 | 0 N | -1273.760492 N | -0.003605526756 rad | 0 rad/s |

The same upright, rear-supported state therefore develops opposite lateral path forces solely from turning an unsupported front wheel. Genuine incoming yaw, lateral momentum, and a separate rear-camber response should remain possible; this reproduction isolates the unsupported **bar-derived** force.

**Bounded change:** in the MX solver, multiply the bar-derived curvature demand by a smooth front-contact authority before distributing it. A compact `smoothstep(0, smallFractionOfStaticFrontLoad, max(0, frontLoad))` preserves the current two-contact calibration and gives exact zero at no front support. Use existing mass and wheelbase/arm geometry for the reference load. Do not zero incoming yaw or sideslip, alter rear longitudinal traction, or touch the road/GP solver. Consider available front lateral reserve as a subsequent refinement, but first fix absent support without a broad steering rewrite.

**Tests:**

- Add the direct zero-front-load positive/negative steer cases with `lean: 0`; neither may create a bar-derived force or heading change.
- Sweep front load through zero and the authority band; require continuity and bounded `mu*N` at each axle, with exact preservation above the band.
- Keep a nonzero initial lateral/yaw state and verify the loaded rear still dissipates it.
- Extend the existing real wheelie fixture (`tests/motocross-contact-traction.test.ts:141–182`) with a short steer comparison while the front remains unloaded. That fixture currently verifies brakes, not steering.
- Preserve ordinary corner entry/reversal in `tests/motocross-contact-traction.test.ts:322–353` and low-speed balance tests.

## P2 — Player-MX planar motion has no downhill cross-slope gravity

**Confirmed missing behavior**, separate from the first fix. `MxGroundParameters` supplies only longitudinal slope (`mx-ground-physics.ts:45–47`), and lateral acceleration at line 281 contains slip force and frame rotation only. The adapter explicitly bypasses its legacy lateral-tilt slide block for `mxGround` (`dirt-bike-vehicle.ts:726–742`). Cross-slope information is used for suspension velocity/hard-stop impulses (`1292–1346`) and scalar berm grip (`1158–1164`), but it supplies no continuous downhill tangential gravity to the player solver.

Reproduction used the existing Valley Ridge `s=35` fixture with `track.sample` wrapped in memory to return an exact plane `height = base + grade * lateralOffset`, normal `normalize(-grade*nx, 1, -grade*nz)`. An upright raw MX-450 was placed at rest and stepped for one second at 240 Hz with no input and `dynamics.p.mu = 0.01` to remove static-friction ambiguity. For grade 0, +0.3, and -0.3, the results were identical: speed 0, slide 0, displacement (0, 0), front/rear loads 892.437210/916.887535 N, riding true and airborne false. A 30% cross-slope with approximately 0.01 friction cannot physically support zero downhill acceleration.

**Bounded follow-up:** pass a local cross-slope gravity acceleration into the MX planar solver and integrate it alongside the contact forces, with a contact/surface projection consistent with the existing along-slope convention. A proper static-friction equilibrium is needed on a sufficiently grippy bank; avoid adding an unconditional sideways creep. This is less isolated than P1 and should have its own implementation/validation step. No terrain data or geometry needs to change.

**Tests:** mirrored cross-slopes with low mu must slide downhill with opposite signs; level ground remains identical; high-grip stationary support does not creep; a supported banked turn and a real berm lap remain stable. Extend `tests/motocross-contact-traction.test.ts:50–84`, which currently tests cross-slope damping of an already sideways-moving landing rather than gravity initiating motion.

## Brake and heat behavior checked: retain these invariants

No new brake/heat defect was confirmed in this audit. Direct probes of `stepMotocrossGround` verified:

- **Locked, loaded tyres:** both rotors initially zero, 16 m/s chassis, 900 N per tyre, mu 0.8, 800 N m brake torque per rotor, `dt=1/120` yielded speed 15.934782609 m/s; both rotors remained zero; both rotor heat ports were exactly 0 W; each contact dissipated 11500.434783 W into slip. Thus a locked tyre slows the machine and heats its contact, without continuous locked-rotor heating.
- **Free front braking:** with both loads zero and an initially rolling front rotor, 300 N m front brake torque left chassis speed exactly 16 m/s and front Fx/slip power exactly zero. Front rotor energy loss was 107.46772300469465 J; the brake heat port integrated to 107.46772300469488 J. Preserve this finite-energy equality.

Relevant implementation: `mx-ground-physics.ts:254–279` and `motorcycle-thermal.ts:139–152`. The former applies ABS/TC to actuator torque and the latter limits brake work to the actual positive angular travel before lock. Do not replace this with chassis speed times brake force.

## Rider-weight and coverage assessment

The finite rider stroke has an analytic damped response (`rider-weight.ts:17–35`); ground weight transfer is a supported pitch moment (`dirt-bike-vehicle.ts:1374–1381`), while flight uses finite displacement/rate exchange (`1383–1408`). Existing tests cover resting load transfer, front-grip response before fork settlement, finite air correction without trajectory/wheel-speed changes, release, timestep convergence, AI takeover, recovery reset, and input-journal replay. No concrete rider-weight defect was found within this pass.

Executed directly, without npm lifecycle hooks:

```sh
node_modules/.bin/vitest run tests/motocross-ground-physics.test.ts tests/motocross-contact-traction.test.ts tests/motocross-rider-weight.test.ts tests/motocross-cornering-reserve.test.ts
```

Result: **4 files / 47 tests passed**, 7.74 seconds. Existing tests do not cover the unsupported-front steering case or a stationary low-friction cross-slope. No installs, commits, pushes, or production edits were performed.
