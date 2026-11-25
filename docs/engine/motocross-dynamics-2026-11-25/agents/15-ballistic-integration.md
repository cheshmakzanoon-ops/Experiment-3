# Assignment 15 — exact unsupported motocross heave

## Implemented behavior

`src/simulation/offroad/dirt-bike-vehicle.ts` now advances unsupported motocross height with the interval-mean gravity velocity:

```text
y(next) = y + (vy - gravity * dt / 2) * dt
vy(next) = vy - gravity * dt
```

This branch requires the existing `motocrossCourse` gate and zero force from both suspension ends. It includes the short unloaded takeoff debounce and the riderless-flight branch. Supported spring/damper integration still uses its calibrated semi-implicit step. No impulse, force, aerodynamic term, vehicle specification, geometry or environment changed. Supermoto retains its previous heave integration.

The former end-velocity displacement lost `gravity * dt² / 2` of height per unsupported step. Before the fix, the new production regression suite failed all eleven motocross cases and passed its two legacy-supermoto cases. A shared real takeoff followed by 0.8 seconds of free flight differed by **0.0163444167 m** between 120 and 240 Hz. The revised implementation meets analytic height/velocity and specific vertical-energy assertions at 120, 240 and 480 Hz, including mixed subdivisions of the same flight. Specific energy, `vy²/2 + gravity*y`, isolates vertical integration from horizontal drag and fuel mass changes.

## Production regression coverage

New `tests/motocross-ballistic-timing.test.ts` contains thirteen tests. MX250 and MX450 approach the surveyed RIDGE TABLE using the ordinary production jump rig, then enter actual free flight. Neither vertical velocity nor chassis height, suspension force or an impulse is fabricated. Tests cover player and AI ownership, ordinary rider/throttle inputs, rider separation through the public fall transition, uniform and mixed flight subdivisions, and the unchanged ridden/riderless supermoto path. All thirteen pass.

With coordinator authorization, the explicit obsolete gravity oracle in `tests/motocross-wheel-pickup.test.ts` now expects the analytic displacement. No pickup, landing or prediction tolerance was widened.

## Coordinated reset fixes

While this assignment exclusively owned the adapter, Assignments 13 and 14 reproduced and supplied independent regressions for stale reset publication. Their authorized fixes are included here:

- Motocross `settle()` now synchronizes all four generic tyre compression, length, angular-speed and load channels. It resets contact-force/slip telemetry without advancing wheel phase, turns, wear or temperature. Non-riding tyre loads follow the existing ordinary-publication rule and remain zero.
- Natural `remount → riding` samples the final pushed location and calls `settle()` at the normal body-publication point, instead of reusing the old flight state. This clears the stale pending verdict/forecast and precrash wheel spin. Existing landing/crash history, clock and observed stance remain intact; posture tangents reset as intended.

Assignment 13's fourteen dynamic-suspension tests and Assignment 14's thirteen contact-reset tests pass in the final combined run. Their reports provide the independent before-fix evidence.

## Verification and reproducible commands

Run from the repository:

```sh
npx vitest run tests/motocross-ballistic-timing.test.ts tests/motocross-rider-weight.test.ts tests/motocross-landing-prediction.test.ts tests/motocross-wheel-pickup.test.ts tests/motocross-dynamic-suspension.test.ts tests/motocross-contact-reset.test.ts
npx eslint src/simulation/offroad/dirt-bike-vehicle.ts tests/motocross-ballistic-timing.test.ts tests/motocross-wheel-pickup.test.ts
git diff --check -- src/simulation/offroad/dirt-bike-vehicle.ts tests/motocross-ballistic-timing.test.ts tests/motocross-wheel-pickup.test.ts
```

The final combined test run is **74 passed, 3 failed, 77 total** across six files. Ballistic timing (13), rider weight (14), dynamic suspension (14) and reset lifecycle (13) pass completely. Lint and whitespace checks pass. The complete run log is `/workspace/scratch/e91efca799c8/validation/ballistic-a15/vitest.log`.

Production offroad calibration passes **20 jump runs with zero band failures**. Standing-start results are MX450 **4.53 s**, MX250 **4.50 s**, and SM450 **4.43 s**. Its JSON receipt is `/workspace/scratch/e91efca799c8/validation/ballistic-a15/docs/offroad-calibration.json`. To reproduce without replacing the repository's shared calibration receipt, run the following command with working directory `/workspace/scratch/e91efca799c8/validation/ballistic-a15` (its `docs` directory already exists):

```sh
node --experimental-transform-types /workspace/scratch/e91efca799c8/motobound-engine/scripts/offroad-calibration.ts
```

## Remaining failures handed to Wave 4

These are observed failures after the exact arc changes contact timing; they are not reported as passing or excused by relaxed thresholds.

1. **Initial-overlap forecast:** the MX250, raw assist, full-forward body, 120 Hz case in `motocross-landing-prediction.test.ts` reports **0.0316666667 s** remaining immediately before touchdown against a **0.025 s** limit. At forecast recomputation, the extended front tyre is already about **0.01245 m inside terrain** while the last suspension solve still reports zero force. `predictTyreLanding()` treats an initial overlap as a rebound and waits for a new positive-to-negative crossing. The descending case instead falls back to the legacy 40 ms centre forecast. The resulting target can also refer to the centre slope rather than the first tyre. Reproduce with `npx vitest run tests/motocross-landing-prediction.test.ts`.
2. **Endpoint bottoming observability:** the real SKY TRIPLE +6 m/s overshoot, switched to 30 Hz after one second of flight, first loads the front at **0.112824 m** compression and ends that step about **0.537983 m** into the wheel's free-position gap. The recorded incoming normal speed is **12.5281 m/s** and pitch error **−0.993075 rad**, but `bottomSpeed` is **0** because the bottoming recorder only examines the incoming compression. The following pitch verdict crashes the bike before another suspension solve can observe the full-travel crossing. Its unchanged test requires bottoming speed above **7 m/s**. Reproduce with the same landing-prediction command.
3. **Pickup timestep convergence:** the real landing/pickup exit-speed difference is **0.030288174129218248 m/s**, exceeding the unchanged **0.03 m/s** limit. The other ten wheel-pickup tests pass, including the updated analytic gravity assertions. Reproduce with `npx vitest run tests/motocross-wheel-pickup.test.ts`.

The coordinator requested a bounded handoff to dedicated Wave 4 work for these remaining contact/prediction issues. No git mutation was performed, and this assignment makes no browser or real-bike-calibration claim.
