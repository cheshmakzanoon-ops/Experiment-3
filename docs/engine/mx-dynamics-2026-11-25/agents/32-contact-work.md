# Agent 32 — Independent contact work and held-bank equilibrium

Date: 2026-11-25. Assignment 32, wave 6.

## Accepted change

Corrected the active cross-slope solver so a nearly rolling contact cannot remove the other axle's independently available, dissipative pickup or braking force. The repaired force pair retains feasible static bank support after its longitudinal work correction. Balanced lateral force and yaw torque now cancel exactly at machine precision before their residual can rotate gravity into artificial forward motion.

Authored production changes are confined to `crossSlopeShear` and active cross-slope force integration in `src/simulation/offroad/mx-ground-physics.ts`. New tests are in `tests/motocross-contact-work-isolation.test.ts`. No adapter, brake-ceiling API, drive budget, displacement projection, model, character asset, environment, venue, specification, existing assertion, or crash threshold was changed by this assignment.

## Causal reproduction

The previous fallback evaluated finite work at each contact, but halved **both** force vectors when either failed. A strongly dissipative locked front was therefore reduced because an almost-rolling rear crossed its own rolling equality during the shared chassis impulse.

A direct diagnostic measured a front contact dissipating approximately **13.06 J** during one internal step while the rear added only **0.00000613 J**. The common scale nevertheless cut the front's available force. The new deterministic one-step regression reproduces the same mechanism in either axle role:

| Regression quantity | Previous fallback | Corrected fallback |
| --- | ---: | ---: |
| Strongly dissipative contact force | −569.982962569 N | −2279.931850275 N |
| Difference from its original unbanked brush force | 1709.948887706 N | Within 5e−10 N |

The initial new suite passed two cases and failed three: both independent-contact comparisons and exact held-bank equilibrium. Those failures were recorded before production edits. The final suite passes all six cases.

The existing native landing test, `motocross-wheel-pickup.test.ts`, now passes its original wet/dry pickup contrast. Its production trajectory, actual suspension loads, water-film discontinuity, force budget and rotor assertions remain unchanged. The existing independently sampled creek-grip tests also pass, including the MX250 dry-rear comparison that was previously red.

## Finite-work construction

For contact force `F`, the work check uses the finite midpoint chassis/contact velocity and the actual positive rotor travel, including a rotor that stops before the end of the internal interval:

```text
Wfront = h [Fx_world u_mid + Fy_world (v_mid + frontArm yaw_mid)]
         − Fx_front frontRadius frontAngularTravel
Wrear  = h [Fx_rear u_mid + Fy_rear (v_mid − rearArm yaw_mid)]
         − Fx_rear rearRadius rearAngularTravel
```

The pre-existing per-contact positive-work tolerance remains **1e−12 J**. It was not increased.

When the base brush pair is infeasible, the solver scales only a contact whose own work is positive. Scaling a complete contact vector within `[0, 1]` preserves its direction and original combined friction-circle bound. The other contact remains fixed during that correction.

Without a forward, yaw or rotor clamp, the corrected contact's work is exactly `L*s + Q*s²` in its scale `s`. Endpoint checks establish that the affine velocities remain unclamped throughout that interval. Values at full and half scale recover the coefficients; the selected root is checked against the actual work function before acceptance. A root affected by cancellation, or an interval crossing a clamp, uses 28 bounded bisection iterations with a verified admissible lower endpoint.

Because either correction changes the shared chassis velocity, the pair is rechecked for at most four sweeps. A final conservative fallback removes only a still-infeasible contact. Two such passes suffice because a removed force vector has identically zero work. No contact can spend the other contact's friction budget.

After longitudinal correction, the static lateral preload is recomputed inside the remaining circles and checked again. This step matters: the first candidate repaired pickup but temporarily discarded bank support after correcting a tiny brake-limited rotor mismatch. It exposed an **8.30e−5 m/s lateral transient** before the outdoor gate. Restoring only the feasible preload removed that transient; the original actual-venue zero-motion assertions now pass. No gate rule, input override or speed threshold was added.

The helper has fixed bounds: four coupled correction sweeps, at most eight scalar contact corrections, 28 iterations for any scalar bracket, two conservative feasibility passes and one bounded preload admission. A conservative accounting gives **fewer than 320 work evaluations per internal step** even on the deepest fallback path. Ordinary accepted support evaluates work twice. The caller retains its existing maximum 36 internal steps for a permitted 50 ms call and six for a normal 120 Hz step.

## Exact equilibrium without a physical dead band

The new roundoff correction applies only with active lateral gravity. It canonicalizes:

- `Fy_front/m + Fy_rear/m + gravitySide`, relative to the sum of the participating magnitudes.
- `frontArm*Fy_front − rearArm*Fy_rear`, relative to the two participating torque magnitudes.

The threshold is `8*Number.EPSILON` times that local scale. There is no fixed minimum speed, force or acceleration. The new suite verifies exact stationary state and displacement across 108 supported mass/geometry/gravity/heading combinations over repeated steps. It separately requires a genuinely unmatched **1e−18 m/s²** downhill input to produce nonzero velocity and displacement.

Both absent and exact-zero cross-slope paths retain the original arithmetic. An independent direct comparison against checkpoint `8b181bc` passed **3000/3000 complete result-object comparisons**, covering both lean modes, steering, support/free-contact combinations, drive, braking, yaw and three timesteps. This is exact result equality, not a tolerance comparison. The whole-game non-MX snapshot preservation check remains a separate root-owned acceptance gate.

## Verification

The following targeted runs passed against the released ground source:

| Matched suites | Result |
| --- | ---: |
| Contact work, wheel pickup, tyre contact, Arena weather, cross-slope, ground passivity | 54/54; new work suite then had five cases |
| Ground physics, drive budget, brake budget, drive reserve, contact work | 71/71; new work suite then had six cases |
| Raw motocross thermal integration | 3/3 |
| Final contact-work suite, including 1200 deterministic finite-work cases | 6/6 |

These cover **123 distinct tests across 11 files**, executed in the stated targeted groups. The actuator command initially also supplied a nonexistent `motocross-ground-thermal.test.ts` filter, which matched no file; the actual three-case `motocross-thermal.test.ts` was then run separately and passed.

Commands use the installed Vitest entry point and `--maxWorkers=1`. Focused ESLint, whitespace validation and a strict TypeScript check of the owned source/test dependency graph with a 512 MB heap passed. An initial temporary TypeScript config outside the repository could not resolve its inherited type libraries; moving that temporary config under ignored `test-results/` resolved the configuration issue without changing project dependencies or compiler settings. No npm lifecycle hooks, install, full-repository typecheck, git mutation, or publication was used.

## Local computation cost

A paired direct solver probe compared checkpoint `8b181bc` with the released source. Each row used 10,000 warmup calls and five alternating rounds of 20,000 calls per implementation. Values below are median microseconds for one 720 Hz solve on this local concurrent CPU environment; they are not device frame-rate measurements.

| Scenario | Before, µs | After, µs |
| --- | ---: | ---: |
| Held bank | 0.561 | 0.589 |
| Rolling bank | 0.948 | 0.954 |
| Locked front / nearly rolling rear | 1.032 | 2.267 |
| Uphill lateral slide | 1.934 | 2.035 |
| Tiny spinning rotors stopped by brakes | 1.649 | 4.448 |
| No-gravity reference | 0.631 | 0.563 |

The repaired exceptional cases do more work because they preserve the independently valid contact and recompute feasible bank support. The no-gravity timing difference is measurement/JIT variation; its result arithmetic is unchanged. Allocation and whole-grid performance need their own measurement rather than extrapolation from this probe.

## Separate remaining yaw-damper limitation

Contact passivity is distinct from whole-planar energy. The expanded work ledger found that the **existing explicit yaw damper** can add a small amount of energy when a stronger tyre impulse reverses yaw during the same internal interval. Its frozen torque is `−0.18*Iz*initialYawRate`, so its actual signed work is:

```text
Wyaw = −0.18 * Iz * initialYawRate
       * (initialYawRate + finalYawRate)/2 * h
```

One reproducible state gives **+5.730927146809005e−7 J** from this damper. The total energy residual after accounting for engine, gravity, brakes and contact heat is **+5.730920662472272e−7 J**, matching that separate port to **6.49e−13 J**. The finite-work test includes this signed external port explicitly; its 2e−8 J ledger tolerance was not increased. It does **not** call the explicit damping step physically passive. The production damping rule was left unchanged and this finding was handed to root for independent review.

Minimal reproduction, passed directly to `stepMotocrossGround(state, parameters, 1/720)`:

```json
{
  "state": {
    "speed": 26.23876509256661,
    "lateralSpeed": -1.242042729863897,
    "yawRate": 0.005413161125034094,
    "heading": 1.8268338139168918,
    "frontOmega": 49.508630856871605,
    "rearOmega": 77.38383149262518
  },
  "parameters": {
    "mass": 184.4,
    "frontArm": 0.75,
    "rearArm": 0.73,
    "frontRadius": 0.355,
    "rearRadius": 0.345,
    "frontInertia": 0.7,
    "rearInertia": 0.62,
    "frontLoad": 2631.109295412898,
    "rearLoad": 4616.3549912162125,
    "frontMu": 0.3416324006393552,
    "rearMu": 1.1549557900987566,
    "steer": -0.49248949489556254,
    "lean": -0.1659093363210559,
    "driveTorque": 487.9561670823023,
    "frontBrakeTorque": 428.45598673447967,
    "rearBrakeTorque": 202.46666122693568,
    "drag": 0,
    "slope": 0,
    "lateralGravity": -2.2013619989156723,
    "tractionControl": false,
    "abs": false
  }
}
```

The resulting yaw rate is `−0.01539661869844123 rad/s`. This is also deterministic sample 686 of the new test's seed `0x32c07ac`.

## Released source identity

| File | SHA256 |
| --- | --- |
| Ground source before this assignment, checkpoint `8b181bc` | `5ba192c09576465e2b63f377372141430f9ddb574666bc7b711af2b4891dbfe3` |
| `src/simulation/offroad/mx-ground-physics.ts` | `68b04234548a2b037f4769d38343c26ec712a61fd9261fd6dac44641c81ca4e3` |
| `tests/motocross-contact-work-isolation.test.ts` | `9e528d5bf7f4756b4989ba6ea920fe8434abe87627a5201695b28128a5a4474c` |

Production, test and report ownership are released. No further edits or optional tests are pending from this assignment.
