# Wave 8D — Independent lane and thermal review

Assignment 46/60 · 25 November 2026

## Verdict and reviewed source

**No blocking production regression was found.** The lane change preserves its existing candidate geometry while replacing bounded FIFO eviction bookkeeping. The thermal change omits redundant signature refreshes only for the actual frozen default parameter object. Their measured operation reductions are supported by exact comparisons against the original module source and by a bounded composition run through the real Simulation.

The reviewed session baseline is [`dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`][baseline]. The accepted source is [`92e2dc2ed2f4959011bb84816e90506cefed774d`][accepted]. I also fetched both production files at [`e2d1fec2ff3b38a2cf962e9974cfe0622259823b`][integrated] and confirmed that each is byte-identical to the accepted source.

This assignment changes only this report. No local runtime was available; no newly executed test, benchmark or browser result is claimed. The hosted results below were independently retrieved from their existing run and job.

## Lane eviction invariants

The production Track installs a capacity of 2,048 for paved ribbons. Its existing motocross/supercross construction uses the unbounded path, and other terrain kinds may have no lane index. The new ring is selected only for positive integral capacities. Infinity, NaN, nonpositive values and fractional capacities retain the prior Map policy, including its unusual boundary behavior. It grows with actual residents rather than eagerly allocating the declared capacity.

For a bounded index, the ring and resident Map have a straightforward shared invariant:

1. Before capacity is reached, each new cell appends its key in insertion order.
2. At capacity, the cursor identifies the oldest resident key. A miss deletes that key, replaces that same ring slot, advances the cursor and inserts the new cell.
3. A hit returns the existing cached cell without changing Map order, cursor or ring contents.
4. A missing cell is completely built before either container changes. A failed build therefore preserves the previous residents and next eviction target.

The implementation has no other production mutation path for these private containers. Walking the ring from its cursor reproduces the Map's insertion order. Evicted slots are overwritten, so the ring retains a bounded set of resident-key references rather than an accumulating history.

I compared the source after the eviction block: the height fallback, witness selection, candidate filter, distance bounds, epsilon and original candidate ordering are byte-identical to the baseline. The builder retains equality in its bounding test, and the caller's nearest-segment scan retains its strict-less-than tie rule. The patch consequently does not select a different winner for an otherwise equal candidate list. Signed coordinate cell keys and coarse-cell alignment also retain the original code.

The existing cache contract is unchanged when callers supply a different coarse list on a cache hit: that hit keeps its earlier cell; revisiting after eviction rebuilds from the new list. This is tested deliberately, rather than presenting the cache as a live view of mutable authored geometry. No authored geometry or road-contact calculation was edited.

The 16 accepted FIFO regression cases cover capacities 1, 2 and 2,048; repeated fills and wraps; oldest-key hits; revised coarse lists after eviction; overpass and banked-road boundaries; eight unusual capacities; lazy large-capacity growth; and failed builds. Their iterator-policy reference reuses the candidate builder, so it alone is not an independent geometry oracle. The original-source probe supplies that separate comparison.

Sources: [lane source][lane], [Track caller][track], [FIFO tests][lane-tests], [lane probe][lane-probe].

## Lane measurement and its limits

The actual-baseline probe bundles the original `track-lane-index.ts` fetched through `git show`, while keeping the same current Track and geometry dependencies in both variants. It checks candidate arrays, witnesses, fallback identity, full nearest results, resident order and ring bounds. Instrumentation wraps the real Map instance's `keys` and `delete` methods; inspections use Map entries, avoiding inflation of the measured key-iterator count. There is no timing measurement.

The accepted output records:

| Observed workload | Baseline | Candidate |
| --- | ---: | ---: |
| Aurel primary misses, two cycles through 4,096 distinct cells | 8,192 | 8,192 |
| Explicit oldest-resident hits | 3 | 3 |
| Successful primary-trace evictions | 6,144 | 6,144 |
| Fresh `Map.keys()` iterators for those evictions | 6,144 | 0 |
| Maximum resident cells | 2,048 | 2,048 |
| Additional FIFO key references | No ring | At most 2,048 |

Across the primary trace and both boundary traces, **9,045 nearest comparisons and 117,585 scalar comparisons matched exactly**, including the lateral result and all twelve TrackPoint fields. Ordered output digests also matched.

The boundary coverage needs precise interpretation. All 425 overpass queries use indexed coarse cells and exercise both decks. Of the 425 speedbowl queries, **422 lie outside a populated coarse hash cell and use the existing full-scan fallback**; three banked-point queries exercise the lane index. Those 425 results establish whole-call compatibility, but they must not be described as 425 banked lane-cache queries. The Aurel workload supplies the substantial eviction evidence.

Removing per-eviction iterator creation trades a bounded array of key references and one cursor for fewer iterator objects. The probe does not measure retained heap bytes, allocation rates for the rest of Track, GC duration, wall-clock speed or frame rate. It does not show that the full engine is allocation-free.

Source: [retained exact probe output][probes], [lane probe][lane-probe].

## Thermal refresh invariants

The entire production thermal difference is one condition and its explanatory comment in `prepareMatrix`. The exported `SURFACE_THERMAL` remains an `Object.freeze` object whose fields are numeric values. The optimization checks identity against that specific object; a caller's mutable copy, another frozen object or other parameter object retains the old refresh path.

Every `prepare` still refreshes the matrix signature after setting timestep and held air-transfer input. Those values cannot change through the ordinary solver methods before the next preparation. The fixed default's capacities and conductances cannot change either. A subsequent cell-rainfall change therefore does not need another comparison of the same signature.

This does not remove matrix selection or recomputation when rainfall changes. The six matrix coefficients, per-cell caches, water integration, latent cooling, rain's sensible heat and arithmetic order remain unchanged. Weather preparation still refreshes ambient temperature, solar input, vapour and transfer. Signature invalidation still clears cached rainfall slots when its relevant inputs change.

For caller-owned parameters, the original behavior is preserved in full: changing one of the four matrix parameters after preparation becomes visible when rainfall changes and triggers refresh. The pre-existing same-rain early return remains before that refresh, so an edit followed by the same rainfall intentionally keeps the selected matrix until the next relevant boundary. It would be inaccurate to claim that the solver now detects every arbitrary parameter edit immediately. Changes to prepared air and solar values still follow their original preparation boundary.

The accepted eight-case regression suite checks varied timesteps, weather, exposed/covered cells, cached wet slots, standalone `advance` rainfall restoration, each mutable matrix parameter, and all three Track weather presets. Its fresh-object reference retains the slower signature path. The separate historical-module probe prevents the optimization from being judged solely against another instance of its own implementation.

Sources: [thermal source][thermal], [thermal regression tests][thermal-tests], [thermal probe][thermal-probe].

## Thermal operation evidence

The probe first compares outputs with no prototype instrumentation. It checks finite, exact scalar values and complete Float32 surface bytes. A separate pass creates fresh solvers and Tracks, wraps the real methods only to count calls, and restores every descriptor in `finally`.

Observed exact comparisons include **3,084 default columns / 12,336 scalars**, **20 mutable-parameter columns / 80 scalars**, and four half-second Track updates for each of clear, rain and storm. The Track comparisons cover six surface arrays, **1,032,192 post-update bytes** and **132 weather/clock scalars**, in addition to the initial-state comparison.

| Signature-refresh calls | Baseline | Candidate |
| --- | ---: | ---: |
| Direct default solver workload, twelve preparations | 1,822 | 12 |
| Mutable-parameter workload | 24 | 24 |
| Four clear Track updates | 10 | 8 |
| Four rain Track updates | 14,349 | 8 |
| Four storm Track updates | 14,349 | 8 |

For each Track preset, both variants still make **14,344 matrix-selection requests and 14,336 wet-cell advances**. The reduced count is `refreshMatrixInputs` calls; it is not a count of thermal cells eliminated or expensive matrix rebuilds eliminated. The exact-output pass and count pass are separate experiments, with the same deterministic scenarios. They support compatible outputs and fewer signature checks within those scenarios, without a timing claim.

Source: [retained probe output][probes], [thermal probe][thermal-probe].

## Composition through the real Simulation

The composition probe replaces both historical modules in the current real Simulation dependency graph. It does not mock simulation stepping, road work, weather, AI or frame generation. Each side has a separate world, Track and surface backing stores.

Three seeded Aurel practice scenarios—clear, rain and storm—run three cars for 120 ticks at 1/120 second. Each case uses 104 human-controlled player ticks, sixteen automatic-player ticks and two continuously updated AI opponents. Positive controls require real movement, loaded paved slip work, two actual surface updates and changed pavement temperatures.

The accepted result compares **363 complete frames containing 369,171 Float32 words**, **363 unrounded race-state observations**, and **27 checkpoints of all eight public surface arrays**. Every frame byte and selected surface byte matches, floating surface values must be finite, and exact transcript hashes match. Race comparison includes clocks, lap progress/timing, order, flags, penalties, safety-car state, entrants and recoveries; outputs are not rounded to obtain agreement. Default diagnostic arguments remain fixed at zero on both sides.

This is meaningful composition evidence but a short workload. Each world runs for **one simulated second**, completes no lap and retains only **11–12 lane cells**. It therefore does not stress cache eviction; that responsibility belongs to the separate 8,192-miss probe. It also does not establish whole-race equivalence, every venue/vehicle combination, cross-host floating-point identity, browser scheduling or physical hardware performance.

Source: [composition probe][simulation-probe], [accepted probe output][probes].

## Provenance, acceptance and scope boundary

I independently fetched [workflow 45637677573][run], verified its accepted head and successful conclusion, and read [job 139287423560][job]. The job records 1,135 passing unit tests across 86 files, all six original-baseline comparisons, full TypeScript/build success, and 57 passing native cases. It specifically includes the 16 FIFO tests, eight frozen-thermal tests, fifteen paved-lane tests and three surface/lane integration cases. The exact lane, thermal and composition JSON objects retained in the repository also appear in the fetched job log.

The shared probe helper pins the baseline commit, checks that every declared historical target was loaded, keeps module instances independent, records source and bundle hashes, and checks the candidate target bytes and tracked status around bundling. Accepted provenance reports Node v22.23.5, esbuild 0.25.12 and clean tracked source within its declared scope. It excludes untracked files from that cleanliness claim. All other dependencies come from the current candidate checkout; this is not a pair of complete historical and current builds.

The reviewed two production files remain unchanged at e2d1fec. The accepted 92e run nevertheless belongs to 92e as a whole; later integrated source still needs its own gate. The browser suite's Mesa llvmpipe backend is software-rendering evidence, while these three probes run in Node. Neither establishes hardware FPS, power savings, lower whole-process memory, tuning improvements or visual changes.

No further production change or redundant regression was justified by this review. Future claims should retain the explicit workload and structural-count boundaries above.

[baseline]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc
[accepted]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/92e2dc2ed2f4959011bb84816e90506cefed774d
[integrated]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/e2d1fec2ff3b38a2cf962e9974cfe0622259823b
[lane]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/simulation/track-lane-index.ts
[track]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/simulation/track.ts
[thermal]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/simulation/surface-thermal.ts
[lane-tests]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/tests/engine-lane-fifo-eviction.test.ts
[thermal-tests]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/tests/engine-frozen-thermal-signature.test.ts
[lane-probe]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/scripts/engine-runtime-probes/lane-probe.mjs
[thermal-probe]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/scripts/engine-runtime-probes/thermal-probe.mjs
[simulation-probe]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/scripts/engine-runtime-probes/simulation-probe.mjs
[probes]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/docs/engine/runtime-2026-11-25/evidence/92e2dc2/probes.json
[run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45637677573
[job]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45637677573/job/139287423560
