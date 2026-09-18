# Cooperative asset construction and current endurance evidence

## Actual construction work

Initial scene creation is now a priority queue rather than one synchronous circuit build. Asphalt, pit ribbons, kerbs and grid markings precede the original player car, environment lighting, buildings, background terrain/vegetation and final spatial batching. Long ribbons are individual 80 m tasks, and garages and grandstands are separate jobs. The player sees progress from completed task counts, not a timer or manufactured minimum loading duration. The simulation does not run or record while preparing a new session.

The queue yields to the browser between work slices, supports cancellation before and after a yield, rejects construction faults rather than suppressing them, and prevents new tasks from extending a running plan. The renderer factory owns partial scene resources until completion. Cancellation and errors dispose that partial state; ordinary renderer disposal is idempotent and also releases the circuit's dynamic surface texture.

All shipped car/track assets are generated locally. This implements prioritized **procedural construction**, not downloading absent external assets. Per-task CPU duration, maximum observed task, completed work and yield count are available in read-only diagnostics. The nominal 8 ms scheduling budget does not preempt a single long task. GPU environment capture, a full car or final batching can exceed that budget; their observed durations must not be advertised as a certified frame-rate target.

## Measured preservation test

A real Chromium page, using real canvas generation but no WebGL context, constructed the circuit synchronously and cooperatively. It compared generated position/normal/UV/color/index buffers and instance transforms. Both paths produced the same content signature: 451 mesh objects, 353,715 geometry vertices and 5,370 instances. The cooperative path completed 352 tasks and yielded 22 times. Measured construction work was approximately 192.7 ms and the worst task was 15.3 ms on that runner. These are CPU fixture results, not rendered performance on the user's computer. `construction-metrics.json` includes the fixture and source hashes.

The complete browser session test also checks that the real renderer reports completed cooperative jobs and yields. Existing shader, mirror, cockpit, replay, mobile, telemetry and input browser workflows remain required. No acceptance threshold was reduced to accommodate construction changes.

## Long-run AI evidence for the current simulation

The simulation fingerprint is `e600dbe7cab11f3762a35c30697ee6d137fbaf9a6c43c25b1b530e1d744a2c0a`. It covers every source file in `src/simulation/` and `src/core/`, with path and content hashes in deterministic lexical order. The two current reports were rerun after the weather timeline, ABS/regeneration, anti-stall and wet-pit traffic changes. Their complete `src/` fingerprint is `1db6169ec9a928dbbbbc6a28c267fb827a5d4770f49b71f725afc9fd47cd165a`. They are not the earlier 5cc02995 construction-only reports.

| Trial | Actual result |
|---|---|
| Ten cars × 50 dry laps, seed 4417 | All ten completed 50 laps in 3,450.000 simulated seconds; no impact, off-track running or wing/floor damage. Initial fuel was 60.5 kg per car; no service was required in this fixture. |
| Ten cars × 100 dry laps, seed 73021 | All ten completed 100 laps in 7,029.683 simulated seconds. Every car completed one physical tire stop; no impact, off-track running or wing/floor damage. Initial fuel was 113 kg per car and affected actual mass throughout. |

The reports retain per-car maximum offset, impact count, minimum component health, stall durations, fuel remaining and service count. They are positive evidence for these seeds, grid, setup and weather, not a guarantee of flawless AI under every adversarial condition. Clear and changing-weather whole-field three-lap races, obstruction handling and the simultaneous ten-car service fixture remain separate regressions.

The full master directive is still subject to the complete combined scenario, target-device profiling, all specified final audits and further presentation review. Passing these fixtures does not certify AAA presentation or every remaining requirement.

Separate ten-car wet and initially-slick-in-rain service fixtures are now part of the physics CI gate. They pass their declared service/impact thresholds, but contain minor contacts and must not be described as zero-contact endurance. See `wet-pit-results.json` and [weather/braking](WEATHER_AND_BRAKING.md).

The later instrument-freshness/weather-caption follow-up modifies presentation only.
Its all-source fingerprint differs, while the simulation/core fingerprint above
remains identical. The listed all-source hash identifies the measured weather
checkpoint; it is not silently rewritten to describe a later presentation build.
