# Native proof of the runway discontinuity

## What this follow-up establishes

The original full observer retained scalar planning/control receipts, but did not retain the approach-profile arrays or all state needed to restore TrafficPlanner.evaluate. A full planner replay would have required invented orientation, velocity, callback and persistent-history state. It was not attempted.

The separately authorized follow-up instead isolates the pure runway producer. It ran the same original seeded loop once, with recording-only wrappers, and stopped at **race time 146.10753271592452 s** (18,226 outer steps). The race was still active. **No full-race acceptance was evaluated.** All seven planner calls in the previously saved transition window reproduced exactly: time, station, speed, free pace, runway, cap, chosen offset, decision, cap rule and blocker.

The capture retains **96** phase-exact native profile evaluations from race time 145.30–146.11 s, including their valid count, all profile inputs, original arrays/results and the state read by passPace. This allows an offline comparison with no world construction, physics step or race loop.

## Exact native baseline replay

Every captured valid profile entry and returned planLimit reproduced exactly when passed through the unchanged native `motorcycleApproachProfile` function. The recorded count was computed with the unchanged native `gpApproachSampleCount` helper and phase-exact captured inputs; the full native profile replay validates that count and the reconstructed grip/aero inputs.

The runway selector has no standalone exported function. The offline program extracts its unique loop and Infinity initialization verbatim from the frozen `src/simulation/bike-ai.ts`, then executes that exact fragment against each saved profile/count/speed. It reproduced **all 96 actual runways exactly**. This is a native source-fragment replay, not an invented approximation of the selection rule. The exact fragment is included as `native-runway-loop.txt` with SHA-256 `710f293c41e4405f5e36c67cf8792f2c1447cb23ad1b831502193051236edd67`.

Both guarded processes exited 0 with no source differences across all 7,459 protected inputs. Both have input-manifest SHA-256 `28843ec8e6f9c2cabd3d3bb09d6afe8a05596edc64c5cc6f41b257e9855c42bd`.

| Process | Guarded wall time | Exit | Interpretation |
|---|---:|---:|---|
| Partial profile capture | 21.090287076 s | 0 | Seven original transition calls reproduced exactly; profile data captured |
| Offline native replay | 2.416233780 s | 0 | All 96 original profile/selector results reproduced |

## Same-state speed-only comparisons

Each row below holds its **entire profile array, valid count, grip, geometry, path correction, mass and constants fixed**. Only the speed scalar read by the native runway selector changes. All three tested speeds are actual speeds recorded in this transition, rather than fabricated target values. The geometric runway is held fixed for that row when reporting the value supplied to passing.

| Frozen native profile | Speed 80.80081641717129 m/s | Speed 81.14925971746447 m/s | Speed 78.8245947459483 m/s |
|---|---:|---:|---:|
| Before switch: tick 18157, geometric runway 696 m | Infinity → 696 m | 120 → 120 m | Infinity → 696 m |
| Cap-drop profile: tick 18168, geometric runway 672 m | Infinity → 672 m | 108 → 108 m | Infinity → 672 m |
| Return profile: tick 18201, geometric runway 648 m | 96 → 96 m | 84 → 84 m | Infinity → 648 m |

Cells show native planRunway → runway supplied after the existing geometric cap. Within the first two rows, a speed-only increase of **0.34844330029318 m/s** changes the tactical horizon by more than 500 m. No geometry, grip, profile, count or path change is involved in that pair.

For the cap-drop profile specifically:

- Valid count is 42, and computed grip is exactly 1.
- Its first minimum is **80.10290532924495 m/s**, at sample 9 / 108 m.
- The selector asks whether that profile value is below `currentSpeed − 1`.
- At 81.14925971746447 m/s the threshold is just above the minimum, so runway is 108 m.
- At 80.80081641717129 m/s the same threshold is below every future profile value, so the same native loop returns Infinity, which passPace maps to the 672 m geometric runway.

The true geometry moved normally between actual calls: geometric runway changes **696 → 672 → 648 m**. The solved profile also changes with position/path and the valid count eventually changes 42 → 40. Those real changes are retained in the between-row observations but frozen within each row. The paired comparisons establish that those changes are **not necessary** to produce the observed large horizon discontinuity. Across the entire saved window, 62 of the 96 fixed profiles switch runway when evaluated at the captured speed extrema 77.9595447454349 and 81.21190681608313 m/s.

## Scope of the conclusion and minimal candidate direction

The measured speed participates in a categorical tactical decision: crossing a shallow profile minimum changes the supplied runway, which selects settle versus follow, which changes the speed command and therefore the subsequent crossing. The native proof verifies that local feedback mechanism. It does not estimate how much lap time a different definition would recover, and it does not remove the separate own-plan losses identified in the full observer.

The narrow candidate direction is **only the scalar runway producer consumed by passPace**. It should describe a braking feature of the valid solved profile rather than a threshold crossing against measured speed. A stateless first upcoming profile trough/braking-event definition is a candidate to specify in a focused native fixture. Do not change planLimit, planNext, planDistance, brakeDemand, the physics solver, gains, grip, class speeds, traffic thresholds or original assertions. The current field has no other consumer in this source.

That direction avoids the earlier rejected geometry/controller compositions and introduces no temporal cache. It may hold a conservative short runway through this mild dip, so even a successful continuity fix could leave the race pace assertion failing. No production algorithm was changed here. The next decision is whether to authorize that small native candidate, followed by the unchanged focused race gates if its native evidence succeeds.

## Files

`profile-window.json.gz` is the lossless partial capture. `offline-replay.json` contains all original-result comparisons and the speed-only matrix. `observer.json` and `offline.json` are the original guard receipts. Their `passed` fields concern the diagnostic commands only. The two source programs and native loop fragment are included, together with all hashes and exact commands.
