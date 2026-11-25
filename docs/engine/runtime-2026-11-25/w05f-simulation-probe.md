# W05F: whole-Simulation composition probe

## Status and scope

**Encoded and statically inspected; hosted execution is pending.** No local Simulation run, pass result, elapsed time, CPU result, FPS result, or peak-memory measurement is claimed here.

`scripts/engine-runtime-probes/simulation-probe.mjs` constructs and advances the real `Simulation` from `src/simulation/world.ts`. It runs the same deterministic controls in two independently bundled module graphs. The baseline graph replaces exactly these two production modules with their bytes from commit `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`:

- `src/simulation/track-lane-index.ts`
- `src/simulation/surface-thermal.ts`

Every other dependency, including `world.ts`, `track.ts`, vehicle dynamics, collision solving, AI, weather, protocol, and race control, comes from the candidate checkout in **both** graphs. This isolates the composition of the lane FIFO and frozen thermal-signature changes within the actual current simulation. It does not compare the entire historical game with the entire candidate game.

The shared `support.mjs` helper obtains baseline bytes with `git show`, checks that both replacement targets were loaded, builds separate in-memory bundles, and records the baseline ref, candidate HEAD, scoped tracked status, source hashes, bundle hashes, and tool versions. A missing baseline is an error. The probe imports that helper without duplicating its implementation.

Source inspected for this assignment: candidate commit `b3b8ec09183734287b71406f8894d07c91eb48c9`, the pinned baseline modules, and prepared helper blob `8dd04ce6ebc7a714e02cc56cdd050543af98abc5`. The hosted report identifies the actual candidate HEAD used when it runs.

## Bounded workload

| Scenario | Seed | Weather | Compound | Cars | Steps per variant | Step size |
| --- | ---: | --- | --- | ---: | ---: | ---: |
| clear-human-ai | 73021 | clear | medium | 3 | 120 | 1/120 s |
| rain-human-ai | 2505 | rain | intermediate | 3 | 120 | 1/120 s |
| storm-human-ai | 9173 | storm | wet | 3 | 120 | 1/120 s |

All cases use the registered Aurel circuit, the normal Formula entrants, and the public practice constructor. Practice begins at the seeded green time, so this short replay exercises moving vehicle physics and AI immediately. Each scenario represents one simulated second in each variant; it retains only one live baseline/candidate pair at a time. Using one circuit also permits the production racing-line cache to reuse its deterministic geometry solution across weather cases.

The player receives six successive pedal/steering patterns, a brief manual-clutch input, up/down shift edges, three ERS selections, DRS requests, and overtake requests. Player autopilot is enabled for ticks 80–95: 16 AI-driven player updates and 104 human-driven player updates per variant. Two opponent AI drivers run throughout. Constructor seeds, timesteps, and commands are explicit; no random or clock API is patched.

These are workload bounds intended to keep a hosted correctness job small. They are not evidence that a particular wall-time or memory target has been met.

## Exact comparisons

### Published frames

An initial `makeFrame()` and one frame after every step are compared, giving 121 frame pairs per scenario and 363 frame pairs in total. The comparator checks every raw byte of the full Float32 frame: all header words and every car, wheel, damage/debris, race, contact, bike/off-road placeholder, and skid block. There is no tolerance, rounding, field omission, or rewriting of outputs.

`makeFrame()` uses the production default diagnostic arguments `stepMs = 0` and `dropped = 0`. Those fields are included in the comparison. They are caller-supplied diagnostic values, not measured execution time.

At the inspected protocol dimensions (`HEADER = 24`, `CAR_STRIDE = 331`), each three-car frame has 1,017 Float32 words. The encoded workload therefore compares 369,171 words / 1,476,684 frame bytes. The runtime JSON computes its counts from the actual produced frames rather than relying on those documented dimensions.

### Surface history

Checkpoints are ticks **0, 1, 29, 59, 60, 61, 89, 119, and 120**. They cover constructor state, early contact work, intervals between surface updates, and both sides of the half-second and one-second boundaries.

At every checkpoint, the probe byte-compares the complete public `water`, `rubber`, `marbles`, `frozen`, `temperature`, `substrateTemperature`, `drainage`, and `sheltered` arrays. It also exactly compares the unrounded surface clock and every public weather channel: rain, cloud, ambient temperature, wind, visibility, dust, gust, moisture, fog cover, and the cold-path flag.

At the inspected grid dimensions, 27 checkpoint pairs compare 691,200 array elements / 2,723,328 array bytes. The probe requires two actual surface-clock wraps per variant, changed pavement temperatures, and at least one tick with loaded paved tire contacts doing positive slip work. No surface cells, drainage, weather timelines, cached coefficients, or pending heat are manually edited to manufacture coverage.

### Race and classification state

Every initial and post-step frame also has an exact comparison of its underlying race state. This includes full-precision time, race time and green time; phase, lights, flag and message; finish boundary/grace; safety-car state; order; current and previous lap/sector timing; distance and gate progress; lap validity and assistance; penalties and warnings; stint starts; entrant finish/retirement/pit state; and marshal recoveries. Comparisons happen before any report formatting.

The exercise checks additionally require real vehicle positions to change, the race clock to advance, both opponent laps to be marked assisted, and each real paved lane cache to contain resident entries within its 2,048-cell bound. Reading those existing fields does not replace or instrument production behavior.

## Evidence emitted by a passing hosted run

The script throws on the first mismatch, with scenario, tick, field/array and the first differing byte/element where applicable. It prints a final JSON object with `status: "pass"` only after every case and exercise assertion succeeds. The JSON contains:

- The helper's exact source and bundle provenance.
- Scenario seeds, options, fixed timestep, workload counts, and the command-timeline SHA-256.
- Separate baseline/candidate SHA-256 transcripts for every full frame and race snapshot.
- Baseline/candidate SHA-256 for every surface checkpoint and a digest over the ordered checkpoint digests.
- Observed surface-clock wraps, loaded paved slip-work ticks, maximum vehicle speeds, lane-resident counts, and final race clocks/order.

Frame and surface arrays enter their hashes as raw bytes. The race/input transcript encoder tags types and stores numbers as Float64 little-endian bytes; signed zero and non-finite representations are not silently collapsed by JSON serialization. Hashes supplement direct comparisons and are not substitutes for them.

## Hosted invocation

Run from an installed repository checkout with the prepared `support.mjs` present:

```sh
git fetch --no-tags origin dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc
node scripts/engine-runtime-probes/simulation-probe.mjs
```

The integration workflow is responsible for fetching the pinned commit and treating probe failure as fatal. This assignment creates only the probe and this report; it does not alter runtime models, visuals, package commands, or CI configuration.

## Limits

This is a short full-system differential correctness probe for three warm-weather practice cases on one paved circuit. It does not establish a finished race, a full lap, sustained cache eviction, cold phase changes, overpass/terrain behavior, pit service, multiplayer behavior, visual equality, cross-host bitwise portability, or a performance improvement. Those boundaries remain with the focused lane, thermal, and integration suites. Private scratch banks and pending road heat are not inspected directly; their effects are observed through real stepping, subsequent surface updates, and frame publication.

Construction and controls follow the existing `tests/flashback-determinism.test.ts` and `tests/engine-surface-lane-integration.test.ts` patterns. The weather selection and thermal-update boundaries follow `tests/engine-frozen-thermal-signature.test.ts`; lane-cache ownership and bounds follow `tests/engine-paved-lane-index.test.ts`. No test oracle or solver equations are copied into the probe.
