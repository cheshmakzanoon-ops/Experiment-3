# Assignment 08 — fixed-tick motocross posture response

## Implemented

- Added `src/simulation/offroad/mx-rider-posture.ts` with a three-axis automatic posture controller. Standing, dab, and automatic fore/aft body demand retain velocity and use the analytic critically damped solution. A target reversal changes acceleration while preserving the incoming position and velocity.
- Added continuous standing demand around the former 7 m/s speed, 0.42 rad lean, and 0.5 climb switches. Existing course/jump anticipation remains caller-owned. Airborne demand still requests standing immediately, with a continuous response.
- Added continuous dab demand around its configured speed/lean and existing steering thresholds. Established lean selects the foot; near upright, steering selects it continuously. Airborne demand retracts the foot.
- Kept the manual `RiderWeight` controller unchanged. Omitting automatic body demand freezes its launch posture and clears its automatic rate; ground contact resumes from that held pose. This explicit flight ownership boundary is separate from normal target reversals.
- Added nine focused tests in `tests/motocross-posture-dynamics.test.ts`.

## Response calibration

The frequencies are game response constants, not measured biomechanics. Their step-response scale is close to the previous constant-rate movements:

| Channel | Frequency | Time to 95% of a held command |
| --- | ---: | ---: |
| Standing | 17 rad/s | 0.279 s |
| Dab | 28 rad/s | 0.169 s |
| Automatic body | 18 rad/s | 0.264 s |

The analytic response has a nonnegative impulse response, so a bounded target history started at rest remains bounded. Mechanical-range clamps protect numerical endpoints. Nonpositive/nonfinite time holds both position and velocity. An extremely long finite interval settles directly to its target to avoid multiplying an overflowed polynomial by an underflowed exponential.

## Coordinator integration

The adapter is centrally owned and was not edited by this assignment.

1. Give the motocross adapter an owned `MxRiderPosture` instance. Restrict use to the intended knobby MX venue path so supermoto/road behavior remains deliberate.
2. Preserve the current `rough` anticipation and `climb` calculations; pass them to `motocrossStandingTarget(speed, lean, rough, climb, airborne)`.
3. Use `motocrossDabTarget(speed, lean, steer, air.dabSpeed, air.dabLean, airborne)` for the foot target.
4. Preserve current automatic body demand and Sport whoop-brace calculation. Call `step(dt, standingTarget, dabTarget, bodyTarget)` on ground, or omit `bodyTarget` in flight.
5. Publish `standing`, `dab`, and `automaticBody` through the existing adapter fields, then retain the existing manual `riderWeight.step()` and `riderWeight.pose(automaticBody)` combination.
6. On placement/reset, call `reset()` or `reset(currentStanding, currentDab, currentAutomaticBody)` according to the chosen boundary contract. This clears all stale rates. A rider state transition can instead request neutral values smoothly if its recovery pose uses the existing posture channels; no stale manual stroke should survive.

Standing changes suspension damping and drag in the current adapter. Integrated jump, handling and replay tests are therefore required before acceptance even though no geometry or vehicle specification is changed.

## Executed validation

`npx vitest run tests/motocross-posture-dynamics.test.ts`: **9 tests passed**. Covered response scale, incoming velocity on reversal, equivalent timed commands at 60/120/240/480 Hz, automatic flight hold and landing resumption, bounded rapid reversals, invalid inputs, pause/reset, and continuous old-threshold sweeps.

`npx eslint src/simulation/offroad/mx-rider-posture.ts tests/motocross-posture-dynamics.test.ts`: **passed**.

These are controller-level results. They do not claim completed adapter integration or full-game acceptance. No models, meshes, environments, materials, vehicle specifications, or git history were modified by this assignment.
