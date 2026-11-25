# Assignment 33 — complete player control scenarios

## Result and scope

Added `scripts/bench/motocross-player-dynamics.ts` and `tests/motocross-player-dynamics.test.ts`. **The new suite passes 20 tests; focused acceptance passes 9 files / 95 tests.** No production source, authored model, asset, geometry, material, environment definition, vehicle specification, or existing test was changed. No git operation or full TypeScript build was run.

The benchmark covers **105 unique runs**: 48 player flights, 48 ground control arms, two outdoor rain braking runs, and seven adverse flights repeated at 480 Hz. Every one of the 98 runs at 240 Hz repeats exactly, including every measured summary and a SHA-256 digest of physical and thermal state at every solver step. The unique runs contain **108,809 steps**, including **23,229 fully free flight steps** and **44,212 unsupported recovery steps**. There are zero numerical/invariant violations.

This is a deterministic CPU scenario acceptance. Its centreline and pitch feedback driver issues ordinary public controls; it is not human riding, an AI calibration run, or a visual-quality judgment. The bike remains on the player solver from placement through approach, flight, touchdown and recovery. The public independent-rear-brake eligibility channel confirms player ownership on every step. The harness never calls `aiControlled`, a private solver, or a contact/force override.

## Reproducible control programme

The dry matrix is MX250/MX450 × Valley Ridge/Arena Nord × Raw/Sport. The ground arms start at station 35, 12 m/s, gear 3; one second of normal speed-holding controls settles either a full forward or backward rider command. Each identical approach then receives 0.35 seconds of coasting, 55% front brake, or 55% rear pedal. Only initial placement, speed and gear are supplied; there are no later velocity or state injections.

Flights start 12 m before the surveyed RIDGE TABLE or TABLETOP, at 13.5 or 13 m/s respectively, in gear 3. A regular input driver follows the centreline and avoids braking on the face. The public landing forecast supplies a repeatable pitch feedback command through throttle/rear pedal. Six air programmes exercise:

- Feedback alone.
- Full front brake from 0.15 to 0.60 seconds of flight, stopping that rotor.
- Full rear pedal from 0.15 to 0.35 seconds, with throttle released during the tap.
- Forward body until 0.30 seconds, backward until 0.60 seconds, then release.
- An earlier landing from 85% approach speed, with 80% steering from 0.12 to 0.40 seconds, then release.
- Steering held fully through touchdown, deliberately challenging Raw alignment.

After the first surveyed touchdown, controls are neutral. Observation continues through 0.6 seconds of suspension/pickup response or, after a crash, through actual separation and remount plus another 0.3 seconds. The 0.3-second observation is named `after300ms`: several hard landings still have a natural rebound hop there, so it is not falsely labeled fully settled. Incoming landing time, position, attitude and severity remain immutable while bottoming/outcome may be refined.

## Measured dry-flight outcomes at 240 Hz

“Feedback impact” is the recorded incoming normal speed; “stop” is recorded peak full-travel shaft speed, both in m/s. Rear-tap and body-reversal runs are bottomed but ridden out in all eight configurations.

| Venue / bike / assist | Feedback air, s | Feedback impact / stop | Front-lock outcome | Held-whip outcome | Released-whip air, s |
| --- | ---: | ---: | --- | --- | ---: |
| Valley / 250 / Raw | 1.5153 | 8.0985 / 6.1646 | bottomed | crash-side | 1.0973 |
| Valley / 250 / Sport | 1.5174 | 6.9483 / 6.2227 | bottomed | bottomed | 1.0889 |
| Valley / 450 / Raw | 1.5350 | 8.5174 / 6.5294 | crash-flat | crash-side | 1.1049 |
| Valley / 450 / Sport | 1.5358 | 7.3773 / 6.7040 | bottomed | bottomed | 1.1030 |
| Arena / 250 / Raw | 1.4981 | 8.4197 / 6.6597 | crash-front | crash-side | 1.2916 |
| Arena / 250 / Sport | 1.5138 | 8.5360 / 6.2493 | bottomed | bottomed | 1.2805 |
| Arena / 450 / Raw | 1.5191 | 8.5272 / 6.7676 | crash-front | crash-side | 1.3027 |
| Arena / 450 / Sport | 1.5295 | 8.6326 / 6.3540 | bottomed | bottomed | 1.3005 |

All **41 ridden-out flight runs** finish riding with zero crashes; all seven deliberately adverse cases crash once and naturally recover. All baseline feedback runs reach both 300 mm mechanical stops and rebound below half travel. Released whips reach more than 0.2 radians of yaw, land more than 0.1 seconds earlier than their baseline, and return within 0.02 radians of alignment at touchdown. Their front wheels reach less than 0.01 m/s rolling mismatch within 0.2 seconds. Front-lock runs that ride out also recover rolling speed through finite loaded pickup, rather than at the air/contact boundary.

The adverse verdicts have explicit physical evidence. The Raw Valley 450 front-lock has **7.279456 m/s** bottoming speed, beyond the unchanged 7 m/s limit. The Raw Arena front-lock pitch errors are **−0.536167 / −0.476790 radians**, beyond the unchanged 0.46-radian nose-down limit with impacts above 8 m/s. The four held Raw whips produce **6.258–6.600 m/s** lateral touchdown speed, beyond the unchanged 5.5 m/s crossed-landing threshold.

All seven verdicts persist when the *entire approach and flight*, using the same control programme, runs at 480 Hz. Maximum incoming-normal-speed difference is **0.065821 m/s**. The Valley 450 front-lock still records **7.249344 m/s** at the stop. This is an input/resolution robustness check, not the identical-launch convergence experiment of assignments 25/28. Recovery takes **5.8875–10.1167 seconds** at 240 Hz. On the real remount edge, air time, vertical velocity, pitch rate and yaw are zero, rotor speeds match the actual road speed, and the historical landing record is retained without causing another crash.

## Force, energy, wet contact and reproducibility checks

Across fully free flight, maximum tyre/support/drive/brake force is exactly zero; tread slip power and positive mud pickup are also exactly zero. Independent gravity/drag reconstruction differs by at most **7.11×10⁻¹⁵ m** in position and **3.55×10⁻¹⁵ m/s** in speed. The takeoff observer uses published world velocity for the horizontal component; the approach's sloped road-speed scalar is not confused with horizontal launch speed.

The front rotor follows its independent coast/brake equation exactly. Rotor work is reconstructed from the finite reservoir's temperature change plus endpoint cooling and disc-to-core losses. The largest per-step energy residual is **4.09×10⁻¹⁰ J front / 2.69×10⁻¹⁰ J rear**. The rear check apportions measured kinetic-energy loss between brake and bearing resistance while drive is released, including the stopping interval. Physical reservoir aliases agree, contact work is nonnegative, all thermal/mechanical channels remain finite, and unsupported recovery produces neither tyre work nor a positive total stored-heat increment. This is not a new whole-vehicle mechanical-energy-conservation claim.

Forward versus backward body input changes settled front support by over 150 N in every ground configuration. Rear-pedal arms never apply the front brake; front braking slows the bike more and produces a deeper fork stroke. No ground arm crashes or becomes airborne.

The wet cases use a real `Track('rain')` and its existing 60-second weather evolution, without assigning contact water, moisture, materials or terrain state. Both outdoor Sport bikes sample **1.280760 mm** maximum contact water. MX250 peak front braking changes **943.8 → 732.8 N**, and MX450 **986.7 → 765.0 N**; both ride out with finite heat and reduced deceleration. Wet jump/whip combinations are not added. Existing soil/pickup and arena-weather tests remain the coverage for material transitions and the roof policy.

## Validation and limits

Commands from the repository:

```sh
node --experimental-transform-types scripts/bench/motocross-player-dynamics.ts
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism tests/motocross-player-dynamics.test.ts tests/motocross-rider-weight.test.ts tests/motocross-contact-traction.test.ts tests/motocross-wheel-pickup.test.ts tests/motocross-landing-observability.test.ts tests/motocross-dynamic-suspension.test.ts tests/motocross-thermal.test.ts tests/motocross-soil-pickup.test.ts tests/motocross-arena-weather.test.ts
node node_modules/eslint/bin/eslint.js scripts/bench/motocross-player-dynamics.ts tests/motocross-player-dynamics.test.ts
```

The focused nine-suite run passes **95/95**; focused ESLint passes. Scratch evidence is `/workspace/scratch/e91efca799c8/validation/player-scenarios-a33/acceptance.json`, `player-test.log`, and `focused-tests.log`.

Adapter tested: `d9ca921a1fe09060769622417be2d6a2698773232c9974f0f516e5b3d4fb8e58`. Bench SHA-256: `db0a432f1b1824b43095b446107a63112b9f0e8181781b2cdc940a1244f710eb`. Test SHA-256: `2759f5f1537e2b119de31ca7baced665f8dbefb43a1499b90e0c1f1aad4d81e1`.

No new regression is reproduced by these feature scenarios. They do **not** certify a complete lap or overturn integration failures elsewhere. Assignment 34 separately reported seeded full-lap `motocross-forgiving-handling.test.ts` failures (Valley grip-lowside and Arena crash-flat); baseline attribution was still being investigated when this report was written. Those planner-driven full-lap trajectories differ from this declared centreline/pitch feedback programme and remain the coordinator's independent integration gate. No production change was made to hide either boundary.
