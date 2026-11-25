# Assignment 36 — full ridden-lap regression diagnosis

## Result and scope

**The coordinator's endpoint velocity-basis repair resolves both unchanged full ridden-lap regressions. No additional production change is justified.** `tests/motocross-forgiving-handling.test.ts` passes **18/18**, including both original two-lap assertions. Assignment 36 did not edit the adapter, another production file, an existing test, a vehicle specification, authored terrain, model, asset, geometry, or git history. Its only repository write is this report.

The test retains the actual player solver: Simulation's normal ground route planner drives MX450 with Sport assistance, seed 61007, two laps, no opponents and 120 Hz outer steps; `aiControlled` is withheld, and steering/front brake are released in flight. Every recorded racing step retains player low-speed balance and positive grip-loss grace. This is a deterministic planner-driven integration gate, not human-rider or visual acceptance.

## Causal comparison

The scratch trace uses Node's module-load hook to remove **only** the coordinator's final `endPlanar` preservation/re-expression in `firstFlightContact()`. It does not write or replace a working-tree module. All other current physics, posture, terrain, controller and event-timing changes remain active. Removing that one repair reproduces both original A34 failures at the exact original station and adapter time:

| Course | Without final basis repair | With repair |
| --- | --- | --- |
| Valley Ridge MX | `grip-lowside`, s **837.7613822470782 m**, t **148.03333333328086 s** | Two laps, **158.825 s**, 44 landings, zero crashes |
| Arena Nord SX | `crash-flat`, s **468.66990111911434 m**, t **59.412500000020316 s** | Two laps, **140.525 s**, 51 landings, zero crashes |

Both corrected runs have a longest riding stall of **0.1916666667 s**, below the unchanged one-second gate, and nonzero flight steps. An additional untouched b527 Valley comparison also completes two laps without crashes in **156.1666666667 s**. A34 already supplies the complete original-baseline 59/59 riding/collision/lap receipt; that earlier result is not counted as current-tree acceptance here.

The first divergence in each paired trace occurs exactly at its first touchdown's final terrain resample. The entire incoming state and the outgoing heave, pitch, posture, loads, slide, heading, position and landing record are identical. Only the along-slope speed and its published horizontal counterpart differ:

| Course | First touchdown endpoint time | Corrected horizontal speed | Uncorrected horizontal speed |
| --- | ---: | ---: | ---: |
| Valley Ridge | 18.9541666667 s | 13.6423987411 m/s | 13.6426291969 m/s |
| Arena Nord | 21.8125000000 s | 4.6017443958 m/s | 4.6021975760 m/s |

The repair saves `speed * cos(roadPitch)` before the endpoint contact sample and divides that same horizontal component by the newly sampled cosine afterward. Updating a coordinate basis therefore preserves the already resolved world velocity. It adds no force, support, impulse, friction allowance, crash threshold or controller intervention. The subsequent route/controller evolution amplifies the earlier velocity error; the isolated comparison identifies this basis defect as sufficient to cause the two reported seeded failures. It does not claim that all possible planner trajectories are insensitive to other numerical changes.

## Actual failure mechanisms in the uncorrected comparison

Valley's call to `Bike.step()` falls when its accumulated grip overload reaches **0.4027724746 s** against the unchanged **0.4 s** allowance. Incoming speed is **11.4672512611 m/s**, lean **−0.6078555374 rad**, front use **1.1026302130**, front grip **0.5854019245**, and controls are full left steer, zero throttle and **0.1084406864** front brake. The earlier landing is clean; this is the core's sustained grip-loss decision, not a mislabelled touchdown.

Arena's call to `judgeLanding()` falls after the landing recorded at **59.3747838288 s** and station **468.3870740843 m**. That flight lasts **1.3831171621 s**, has takeoff speed **15.0991660358 m/s**, incoming normal speed **10.9601473905 m/s**, slope **0.4157805200 rad**, and pitch error **0.1544728714 rad**. The subsequent rear stroke reaches **8.6892124030 m/s** at full travel, beyond the unchanged 7 m/s bottoming limit. The instantaneous rear support is **139,251.9878 N** when the existing verdict is evaluated. No threshold relaxation or selective suppression of either physically evaluated crash was used.

## Verification and reproducibility

Executed from the repository:

```sh
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism tests/motocross-forgiving-handling.test.ts
```

Result: **1 file, 18 passed, zero failed**. The test file remains byte-identical to untouched b527, SHA-256 `495119af76deed9cbf3cb4f8f8c889bab2aeb1d5e15c510f64e424adafab29d1`. The tested adapter SHA-256 is `e04318b7e4c6075d42a6c65cc04664a19e5425e20e50f49a1b1ad4f37084ea17`.

Scratch evidence resides in `/workspace/scratch/e91efca799c8/validation/full-lap-a36/`: `trace.mjs`, `forgiving-current.log`, and the `current-*`, `oldbasis-*` and `baseline-*` JSON/log pairs. Each trace records all launch/touchdown edges, one-second samples, the final 720 actual vehicle substeps, and the actual `fall()` callsite/state. To repeat a comparison:

```sh
node --no-warnings --experimental-transform-types /workspace/scratch/e91efca799c8/validation/full-lap-a36/trace.mjs current valley-ridge-mx
node --no-warnings --experimental-transform-types /workspace/scratch/e91efca799c8/validation/full-lap-a36/trace.mjs oldbasis valley-ridge-mx
```

Use `arena-nord-sx` for the second course. The `baseline` option imports untouched baseline source in memory. No full typecheck, calibration-output rewrite, or duplicate broad sweep was run. A34 owns the final frozen-source contracts/player-scenario run, including its adverse-landing preservation checks. The existing full-lap assertions and coordinator's world-momentum oracle supply independent coverage, so this diagnosis adds no redundant new test.

**Ownership is explicitly returned to the coordinator. Assignment 36 has no pending source edits or running validation process.**
