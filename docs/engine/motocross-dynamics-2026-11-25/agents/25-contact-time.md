# Assignment 25 — coherent first-contact time

## Implemented boundary

The ridden player MX250/MX450 path now resolves its first supported contact inside the current flight interval. `step()` retains the incoming planar pose, yaw and rider-stroke state. A bounded, deterministic terrain bracket uses the existing analytic gravity and quadratic-drag translation, together with the existing sampled free-pitch rule. Thirty-two bisections locate the first positive-to-negative tyre-gap crossing. An existing overlap is accepted only when the original non-tensile spring/damper law actually supports it; the separating overlap on a real takeoff remains free.

The adapter advances the free state to that event, samples both contact patches at the same timestamp, and calls the existing suspension solver **once for the remaining time**. Incoming impact speed, pitch, slope, distance, lap position and landing time now describe the event before support acts. The outgoing pose and terrain samples are then published at the outer tick's endpoint. The incoming force/compression channels remain separate from displayed endpoint travel. A bracket without a contact event cannot fall back to the former mixed-time force test and invent early support during ascent.

Rotor reaction is apportioned across the two spans without a second rotor update, pickup impulse or hard-stop impulse. The landing forecast remains observation only. The remaining planar translation retains the existing ground-speed projection; yaw changes basis without changing its resolved world velocity. This work does not claim total mechanical-energy consistency for the pre-existing reduced spring geometry discussed in report 18.

An actual touchdown also clears the stale takeoff debounce counter on this event path. Otherwise its old value of three could mark the newly landed bike airborne again after a single unloaded sample, creating an extra landing and premature rotor coasting. The existing three-sample takeoff requirement is unchanged.

Grounded spring forces, compliant pitch geometry, airborne angular integration, vehicle specifications, crash thresholds and all acceptance tolerances are unchanged. AI, riderless, supermoto and other-course transitions retain their established paths. The event search covers a crossing bracketed by this interval's endpoints; this is not a general collision sweep through arbitrarily thin terrain features.

## Physical and comparison evidence

**“Before” here means the working tree immediately before Assignment 25, not the untouched original task base.** The production RIDGE TABLE fixture shares one real 240 Hz departure, then changes only flight/ground step size and ordinary controls.

| Measure | Before | After |
| --- | ---: | ---: |
| 240 Hz reported touchdown time | 1.0791666667 s | 1.0713866658 s |
| 480 Hz reported touchdown time | 1.0750000000 s | 1.0712668880 s |
| 240 Hz touchdown speed | 10.1979034949 m/s | 10.1427001642 m/s |
| 480 Hz touchdown speed | 10.1691223573 m/s | 10.1428663281 m/s |
| Exit-speed difference after 0.3 s from each observed touchdown | 0.0304897609 m/s | **0.0009743872 m/s** |
| Exit-speed difference at common elapsed time 1.375 s | 0.0212062438 m/s | **0.0036787893 m/s** |

The original touchdown-relative comparison gives the coarse run another 4.1667 ms of travel. That contributes 0.0092835171 m/s to its reported difference; it is a distinct comparison effect, not the whole defect. The existing strict 0.03 m/s acceptance remains unchanged and now passes. The new suite checks that threshold at both comparison endpoints.

An independent terrain sample of the pre-contact free arc, interpolating the measured endpoint pitch, places the coarse first rear crossing at **1.0713864599 s**. The old touchdown therefore lagged it by **7.7802 ms**, publishing an unsupported closing penetration of **15.3540 mm**. The corresponding fine crossing is 1.0712668111 s with 3.7332 ms delay. The new coarse event differs from the independent linear-pitch observer by about **0.206 microseconds**; the production event evaluates its existing angular rule at the trial time rather than linearly interpolating pitch. The new endpoint tests observe no unsupported closing penetration. Remaining coarse/fine angular and input-sampling differences are explicitly retained.

## Authorized oracle corrections

The coordinator explicitly authorized five event-time corrections across the existing landing suites. No threshold was widened.

1. The two MX incoming-impact cases now derive free time from `landing.time − outerTickStart`, use exact gravity/drag at that time, evaluate the unchanged free angular rule there, and independently sample event-local terrain normals. They retain their original precision and severity requirements.
2. The predictor overlap test observes the real resolved closing boundary immediately before support. Corrected physics no longer publishes an unsupported closing overlap for the next outer tick. Predictor calls must still leave the complete observed physical state unchanged.
3. Both SKY TRIPLE +6 m/s overshoot tests retain the same launch and 30 Hz contact step. Ordinary 240 Hz flight now continues until the measured positive front gap can close within one ordinary tick, then takes the 30 Hz step. This gives the contact remainder enough physical time to reach full travel. The former fixed step phase only reaches **0.138555 m** after the corrected event and cannot truthfully report a 0.3 m stop.

The phased overshoot begins with **16.8268 mm** front gap and **12.3801 m/s** closing rate. Its event occurs **1.36592 ms** into the 30 Hz interval; the actual endpoint compression is **0.383132 m**, the initial closing damper supplies **3922.74 N**, and recorded stop speed is **12.242453 m/s**. The existing greater-than-7 m/s requirement and subsequent `crash-front` verdict pass. The heave oracle independently checks exact free travel followed by one supported remainder. At a true zero-gap event, positive damper force and independently measured near-zero gap establish contact; an arbitrary positive floating-point compression sign is not required.

## Remaining supported-step issue — handed to Assignment 28

The unchanged test `motocross-dynamic-suspension.test.ts` → **MX450 on arena-nord-sx at 120 Hz publishes the current pose through full travel and rebound** still fails its no-crash requirement. It also failed in the working tree before A25. This is not labeled an original-task pre-existing failure: the coordinator's untouched task-base check rode the fixture without a crash while recording zero bottom speed, before the later stop-observation work exposed this boundary.

The A25 pre-change adapter records **7.086378 m/s**; the new event path records **7.062512 m/s**, exceeding the unchanged 7 m/s stop threshold. An actual common 120 Hz departure and flight through 1.3 seconds, followed by finer landing/settlement steps, gives:

| Contact/settlement frequency | Recorded peak stop speed | Incoming normal speed | Outcome |
| --- | ---: | ---: | --- |
| 120 Hz | 7.062512 m/s | 8.621508 m/s | crash-flat |
| 240 Hz | 6.709060 m/s | 8.621228 m/s | bottomed |
| 480 Hz | 6.714573 m/s | 8.621087 m/s | bottomed |
| 960 Hz | 6.654894 m/s | 8.621017 m/s | bottomed |
| 1920 Hz | 6.649983 m/s | 8.620981 m/s | bottomed |
| 3840 Hz | 6.648376 m/s | 8.620964 m/s | bottomed |

The high-resolution reduced-model result lies below 7 m/s. This is a coarse supported-integration accuracy risk, so neither its no-crash assertion nor its severity threshold was changed. Assignment 28 receives the exact real-trajectory probe and will preserve this first-contact correction while investigating the supported remainder.

## Validation and receipts

New `tests/motocross-contact-time-coherence.test.ts` contains **13 passing tests**. A task-local copy pointed at the unmodified pre-A25 adapter fails all 13. They cover actual MX250/MX450 departures at 120/240/480 Hz, absence of unsupported closing penetration, event-local incoming pose/velocity/normal speed, exact free-plus-supported heave, one support solve, retained rotor momentum, and both equal-time and touchdown-relative pickup convergence.

The final focused run is **123 passed / 1 failed / 124 total** across eleven suites. Wheel pickup (11), landing prediction (12), landing observability (9), rider weight (14), contact time (13), air drag (20), ballistic timing (13), and Assignment 26's hard-stop integration/contact impulse/coupled-stop group (18) all pass. Dynamic suspension passes 13/14, with exactly the unchanged SX120 failure named above. Input-journal replay reconstruction passes within the pickup and rider-weight suites. Focused ESLint and whitespace checks pass. No full typecheck was run under the coordinator's memory restriction.

Production offroad calibration passes **20 jump runs with zero band failures**. Standing starts remain MX450 **4.53 s**, MX250 **4.50 s**, SM450 **4.43 s**.

All diagnostic output is in `/workspace/scratch/e91efca799c8/validation/contact-time-a25`: `requested-before.log`, `requested-vitest.log`, `contact-time-baseline-vitest.log`, `pickup-before.log`, `pickup-after.log`, `contact-time-before.log`, `contact-time-after.log`, `sensitivity.ts/.json`, `crossing-severity.ts/.json`, `eslint.log`, `offroad-calibration.log`, and `docs/offroad-calibration.json`. The tracked shared calibration receipt was never overwritten.

Run from that task-local directory, whose `docs` directory already exists:

```sh
node /workspace/scratch/e91efca799c8/motobound-engine/node_modules/vitest/vitest.mjs run --root /workspace/scratch/e91efca799c8/motobound-engine tests/motocross-contact-time-coherence.test.ts tests/motocross-wheel-pickup.test.ts tests/motocross-landing-prediction.test.ts tests/motocross-landing-observability.test.ts tests/motocross-dynamic-suspension.test.ts tests/motocross-rider-weight.test.ts tests/motocross-hard-stop-integration.test.ts tests/motocross-coupled-stops.test.ts tests/motocross-contact-impulse.test.ts tests/motocross-air-drag.test.ts tests/motocross-ballistic-timing.test.ts
node --experimental-transform-types /workspace/scratch/e91efca799c8/motobound-engine/scripts/offroad-calibration.ts
```

Changed files: adapter, new contact-time test, the two explicitly authorized existing landing test files, and this report. No authored models, assets, environment, specifications, git operations or publication were changed. Adapter ownership is returned to the coordinator and Assignment 28 after the recorded final checks.
