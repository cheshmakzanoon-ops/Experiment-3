# Assignment 22 — analytic airborne quadratic drag

## Implemented behavior

`src/simulation/offroad/air-drag.ts` integrates the existing forward force `dv/dt = −k v²`, with `k = drag / mass`. Endpoint speed is `v₀ / (1 + k v₀ dt)`. Travel is `log1p(k v₀ dt) / k`; the implementation evaluates its equivalent `v₀ dt × log1p(q) / q` form, where `q = k v₀ dt`, to retain the zero-drag limit even for subnormal coefficients. A zero product returns the unforced distance directly. Invalid negative or nonfinite inputs are rejected. No force coefficient changes.

The adapter's new private `advanceFlight()` shares this translation between ridden flight and riderless coast. Its analytic branch is scoped to motocross-class motorcycles on motocross/supercross courses. Other classes and courses retain the prior Euler endpoint stepping. The first-tyre predictor consumes the same pure helper, eliminating its previous disagreement with the actual horizontal integrator.

Heading and independent lateral drift still belong to the existing adapter paths. Whip, wheel-spin and rider torque remain unchanged. The exact unsupported gravity arc from assignment 15 and the cadence/contact-observation changes from assignment 19 are preserved. Mass is held at its current value during each integration step; real fuel consumption remains active between steps.

At the coordinator's request, the adapter also exposes the read-only `riderBodyRate` getter using `riderWeight.poseRate(automaticBody, mxPosture.bodyRate)`. This supplies the next snapshot task with the tangent of the same blended rider coordinate and changes no dynamics.

The only changes to existing tests are the obsolete Euler forward-speed/distance oracle in `motocross-wheel-pickup.test.ts` and, with explicit coordinator authorization, the obsolete Euler `incomingPlanar` formula in `motocross-landing-prediction.test.ts`. All acceptance thresholds and other assertions remain unchanged.

## Regression evidence

The new `tests/motocross-air-drag.test.ts` has **20 passing tests**. It checks reciprocal-speed and logarithmic-distance identities, partition invariance, energy loss, passive finite results across zero/large drag steps, the continuous zero-drag limit, invalid-input rejection, actual production MX250/MX450 departures, player/opponent/riderless paths, heading/lateral/gravity preservation during ordinary rider inputs, predictor path consistency, and legacy supermoto behavior.

All real flight fixtures first ride the surveyed RIDGE TABLE using ordinary inputs. No airborne pose, suspension load, launch impulse or terrain state is fabricated. Riderless fixtures use the public fall transition after the genuine takeoff.

For the same real departure, 0.75 seconds of neutral flight at 120, 240 and 480 Hz and unequal subdivisions gave these maximum differences from the 120 Hz result. Player, opponent and riderless runs gave the same horizontal differences:

| Machine | Maximum speed difference | Maximum world-position difference |
| --- | ---: | ---: |
| MX250 | 5.7726978753e−10 m/s | 2.1727063715e−10 m |
| MX450 | 5.4491522405e−10 m/s | 2.0565580732e−10 m |

The remaining tiny difference is consistent with the existing 0.0002 kg/s idle fuel consumption being sampled at different step boundaries. Constant-coefficient helper cases agree through the test's 11-decimal endpoint/distance checks.

The predictor test observes its real paired terrain query points while a real whip is active. Taking their wheelbase-weighted centre removes extrapolated axle geometry. Actual subsequent flight agrees with those predicted centre points over 0.6 seconds to **8.9827316295e−9 m for MX250** and **8.4769174132e−9 m for MX450**. The predictor freezes mass at the sample; actual fuel burn continues.

## Remaining pickup convergence failure and bounded diagnosis

The existing strict pickup convergence test was already failing before this assignment: **0.030288102704206565 m/s**, against an unchanged **0.03 m/s** limit. With analytic drag it remains failing at **0.03048976090975586 m/s**. No tolerance was weakened and no contact or pitch dynamics were changed to conceal it.

Separate real-flight/contact-step runs locate the dominant residual at touchdown:

| Flight step / following ground step | Touchdown time | Touchdown speed | Speed after 0.3 s on ground |
| --- | ---: | ---: | ---: |
| 240 / 240 Hz | 1.0791666667 s | 10.1979034949 m/s | 10.8036543499 m/s |
| 480 / 480 Hz | 1.0750000000 s | 10.1691223573 m/s | 10.7731645890 m/s |
| 240 / 480 Hz | 1.0791666667 s | 10.1979034949 m/s | 10.8047654993 m/s |
| 480 / 240 Hz | 1.0750000000 s | 10.1691223573 m/s | 10.7719876342 m/s |

**94.4%** of the full 240/480 Hz speed difference already exists at touchdown. Keeping the identical 240 Hz flight and halving only the later ground step changes exit speed by **+0.0011111493 m/s**. The primary discrepancy therefore precedes ordinary grounded wheel pickup.

At the common free-flight time of 1.0708333333 seconds, forward speed differs by only **3.7319481e−9 m/s**, lap position by **1.9160780e−9 m**, and height by about **9e−15 m**. Pitch differs by **0.0006137477 rad**; the unsupported angular integrator is still timestep dependent.

The larger issue in this particular boundary is the contact solve's mixed timestamp. `writeBody()` samples terrain at the already-advanced horizontal position; `vertical()` tests that terrain against incoming height and pitch before advancing them. At the common endpoint **t = 1.075 s**:

| Quantity | 240 Hz | 480 Hz |
| --- | ---: | ---: |
| Height/pitch timestamp supplied to contact test | 1.0708333333 s | 1.0729166667 s |
| Incoming CG height | 4.4456403989 m | 4.4348971710 m |
| Rear compression seen by contact test | −0.0048653061 m | +0.0057329023 m |
| Rear compression at published endpoint pose | +0.0153539511 m | +0.0157225434 m |
| Contact verdict | Still airborne | Rear support |

The two terrain heights differ by only **1.2438583e−10 m**. Their incoming-compression difference decomposes into **+0.0107432278 m from the heave timestamp**, **−0.0001450196 m from pitch geometry**, and the negligible terrain difference. The coarse step therefore publishes a tyre already inside the ground but defers support to the next tick. Its later touchdown samples a different slope (**−0.0709627753 versus −0.0643243038 rad**) and projects flight velocity into a different ground direction.

This diagnoses a contact-phase limitation rather than residual horizontal drag error. The existing pitch integration and sampled control edges also vary with timestep; the trace does not claim they are absent or that one proposed contact correction will resolve every landing. These paths are left for the next adapter owner.

## Validation and reproduction

Final focused result: **78/79 tests pass**, with only the unchanged pickup convergence failure above.

| Suite | Result |
| --- | --- |
| Air drag | 20/20 |
| Wheel pickup | 10/11 |
| Landing prediction | 12/12 |
| Landing observability | 9/9 |
| Ballistic timing | 13/13 |
| Rider weight | 14/14 |

Production offroad calibration passes **20 jump runs, zero band failures**. Standing starts remain MX450 **4.53 s**, MX250 **4.50 s**, SM450 **4.43 s**. Focused ESLint and whitespace checks pass. Full TypeScript checking remains coordinator-owned.

Receipts are under `/workspace/scratch/e91efca799c8/validation/air-drag-a22`: `baseline-vitest.log`, `requested-vitest.log`, `air-drag-metrics.json`, `pickup-trace.json`, `offroad-calibration.log`, and `docs/offroad-calibration.json`. The shared tracked calibration receipt was never overwritten.

Run from that task-local directory, with its `docs` directory present:

```sh
node /workspace/scratch/e91efca799c8/motobound-engine/node_modules/vitest/vitest.mjs run --root /workspace/scratch/e91efca799c8/motobound-engine tests/motocross-air-drag.test.ts tests/motocross-wheel-pickup.test.ts tests/motocross-landing-prediction.test.ts tests/motocross-landing-observability.test.ts tests/motocross-ballistic-timing.test.ts tests/motocross-rider-weight.test.ts
node --experimental-transform-types /workspace/scratch/e91efca799c8/motobound-engine/scripts/offroad-calibration.ts
```

Changed files are the adapter, new pure helper, new test, two formula-only oracle updates, and this report. No authored model, asset, material, environment, geometry or vehicle specification was changed. No git mutation or publication was performed. Adapter ownership is returned to the coordinator after this report.
