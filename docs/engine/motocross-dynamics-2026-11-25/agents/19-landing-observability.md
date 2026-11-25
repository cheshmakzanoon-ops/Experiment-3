# Assignment 19 — landing overlap, stop observation and forecast phase

## Implemented behavior

`src/simulation/offroad/dirt-bike-vehicle.ts` now distinguishes two real initial-overlap states in its first-tyre forecast. An extended tyre already inside terrain and moving farther into it reports zero remaining time and that tyre's terrain slope. A separating tyre continues to look for a later downward crossing. The classifier evaluates each tyre independently using chassis heave, pitch, forward/lateral travel and yaw sweep against its local terrain normal. It changes forecast outputs only; it cannot create load, touchdown, an impulse or a ballistic-path correction.

The same adapter now observes a player motocross suspension stop reached during a supported integration step. It evaluates raw travel at the final chassis pose and, when incoming travel was below the stop and final travel is beyond it, interpolates shaft velocity between the incoming and final states at that crossing fraction. This is a discrete estimate of speed at the observed crossing, not another force solve. The original incoming spring/damper forces, hard-stop impulse path and crash thresholds remain intact. The existing landing record receives the observation before the next tick's pitch judgement can terminate the suspension solve.

The coordinator also requested a bounded investigation of forecast cadence. The motocross forecast now checks its deadline at the beginning-of-step timestamp, accepts floating-point roundoff within 1e-12 seconds, preserves deadline overshoot when scheduling the next 50/100 ms sample, and deducts the elapsed step afterward. The non-motocross forecast retains its prior ordering. This removes a measured sample-phase error; it does not resolve the separate remaining wheel-pickup convergence failure described below.

## Before/after evidence

The production MX250 RIDGE TABLE takeoff supplies a separating rear overlap naturally: **−0.1157428625 m gap**, **−1.4910228443 m/s closing speed**. It stays airborne with zero suspension forces and a future landing forecast. At the reported failing descending boundary, the front tyre instead has **−0.0124515728 m gap**, **+2.7572035851 m/s closing speed**. Previously the predictor fell back to a 40 ms centre sample, publishing **0.0316666667 s** after elapsed-step adjustment. It now recognizes imminent first-tyre contact. Direct predictor observations verify that all physical pose, velocity, wheel-spin, suspension and landing-count state stays unchanged.

The real SKY TRIPLE +6 m/s overshoot at 30 Hz enters its first supported solve at **0.1128239813 m** front compression and finishes at **0.5379831028 m** raw endpoint compression. The previous recorder reported zero bottoming; the new crossing observation reports **12.2744746938 m/s**. Incoming normal speed remains **12.5281003084 m/s**, pitch error remains **−0.9930752541 rad**, front support remains **5316.5002107380 N**, and the traced final height, heave velocity, pitch and pitch rate remain identical. The existing next-tick verdict is still `crash-front` with one crash.

Before the cadence correction, the second nominal 100 ms sample occurred at **108.333 ms at 120 Hz**, **104.167 ms at 240 Hz**, and **100 ms at 480 Hz**. An unequal-subdivision run sampled at **109 ms** although its first available deadline pose was at **102 ms**. New regressions now verify the first available beginning-of-step pose through both the distant 100 ms cadence and final-approach 50 ms cadence, including unequal subdivisions.

## Regression and calibration results

New `tests/motocross-landing-observability.test.ts` contains nine tests. All use actual production takeoffs, terrain and ordinary rider inputs. The tests only observe the private predictor/accumulator; no private pose, load, force or contact state is supplied. Five cases failed on the starting adapter: closing overlap, endpoint bottoming, and cadence at 120 Hz, 240 Hz and unequal subdivisions. All nine now pass. No existing test or tolerance changed.

The final requested run passes **48/48 tests**:

| Suite | Result |
| --- | --- |
| Landing prediction | 12/12 |
| Landing observability | 9/9 |
| Rider weight | 14/14 |
| Contact reset | 13/13 |

ESLint and whitespace checks pass for the adapter and new test. Production offroad calibration passes **20 jump runs, zero band failures**. Standing-start results remain MX450 **4.53 s**, MX250 **4.50 s**, SM450 **4.43 s**.

The additional unchanged wheel-pickup suite passes **10/11**. Its halved-substep ground-exit difference changes from **0.030288174129218248 m/s** to **0.030288102704206565 m/s**, still above the existing **0.03 m/s** limit. The coordinator has this explicit handoff; no tyre tuning or tolerance was changed to conceal it.

## Reproduction and receipts

Working directory: `/workspace/scratch/e91efca799c8/validation/landing-observability-a19`.

```sh
node /workspace/scratch/e91efca799c8/motobound-engine/node_modules/vitest/vitest.mjs run --root /workspace/scratch/e91efca799c8/motobound-engine tests/motocross-landing-prediction.test.ts tests/motocross-landing-observability.test.ts tests/motocross-rider-weight.test.ts tests/motocross-contact-reset.test.ts
node --experimental-transform-types /workspace/scratch/e91efca799c8/motobound-engine/scripts/offroad-calibration.ts
```

The requested test receipt is `requested-vitest.log`. Baseline receipts are `landing-prediction-before.log`, `observability-before.log` and `wheel-pickup-before.log`. The combined landing/pickup receipt is `landing-after.log`. Actual takeoff/landing boundary observations are in `trace-before.log` and `trace-after.log`. Calibration is `docs/offroad-calibration.json`, with console output in `offroad-calibration.log`; the repository's shared calibration receipt was not overwritten.

Changed files are the adapter, the new test and this report. Models, assets, materials, environments and vehicle specifications were not modified. No git mutation was performed.
