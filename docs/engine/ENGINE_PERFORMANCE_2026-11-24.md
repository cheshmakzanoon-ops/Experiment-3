# Engine work measurements — 24 November 2026

## Result and scope

The revised engine performs less repeated work in five measured paths while returning **exactly the same outputs** in these controlled fixtures. These measurements count operations inside the actual original and revised modules. They do not estimate overall frame rate, GPU speed, or the improvement a player will see on a particular machine.

The independent comparison used original commit [`a0ae513e7982f0b4719296519752e0ae5f1983f8`](https://github.com/cheshmakzanoon-ops/Experiment-3/tree/a0ae513e7982f0b4719296519752e0ae5f1983f8) and revised commit [`9dc4811ff986e9b410bdcfb5f631db19130ce95f`](https://github.com/cheshmakzanoon-ops/Experiment-3/tree/9dc4811ff986e9b410bdcfb5f631db19130ce95f). The measured files were clean in both checkouts. The [machine-readable result](ENGINE_PERFORMANCE_2026-11-24.json) records individual source hashes, Node version, output hashes, counts and equality checks. Later commits can be checked against those source hashes before carrying the measurements forward.

| Measured path and fixture                                                           |                                        Original work | Revised work | Verified result                                                                                      |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------: | -----------: | ---------------------------------------------------------------------------------------------------- |
| BVH: 128 rays through 512 parallel layers                                           | 8,448 hit-point resolutions and 8,448 normalizations |  128 of each | Every returned hit flag, triangle, distance, point and normal agrees exactly                         |
| BVH: triangle checks in the same fixture                                            |                                               66,048 |       66,048 | Traversal and triangle-testing work are unchanged                                                    |
| Telemetry: append 6,000 rows into a 60-row ring initially at head 17                |                        6,000 destination `set` calls |            2 | Physical storage, logical snapshot, metadata and CSV bytes agree exactly                             |
| Telemetry: copied values in the same append                                         |                             1,368,000 Float32 values |       13,680 | Only the final 60 retained rows are copied                                                           |
| Endpoint collision: 64 bodies with overlapping x extents but separated along y or z |                                      2,016 SAT calls |            0 | Both solvers return no contacts and preserve all body states                                         |
| Swept collision: the same separated 64-body arrangement                             |                   4,096 bounding-radius calculations |           64 | No swept query or contact is needed in either implementation                                         |
| Rotating swept contact: a slender box rotating into a stationary obstacle           |                        12 support-point calculations |            2 | Exact same hit at fraction `0.39244887098081277`, after 6 iterations, with matching point and normal |

These are deliberately isolated fixtures. In particular, the telemetry append is much larger than the ring, and the separated-body collision fixture exposes a best-case rejection pattern. Their reductions must not be presented as an overall game-speed multiplier.

## Reproduce the comparison

Use two separate checkouts with the repository's installed dependencies. The baseline's `src/core`, `src/simulation` and `src/storage` directories must match its commit. From the revised checkout, run the script directly so no asset-generation lifecycle hook is invoked:

```sh
NODE_OPTIONS=--max-old-space-size=768 node --experimental-transform-types scripts/engine-work-benchmark.mjs --baseline /path/to/original/checkout --output /path/to/report.json
```

The [`engine-work-benchmark.mjs`](../../scripts/engine-work-benchmark.mjs) script accepts the baseline directory as an argument; it contains no machine-specific checkout path. It imports the actual TypeScript classes from each checkout through Node's TypeScript transform support. It does not substitute a rewritten reference implementation for the original engine.

Instrumentation wraps only the methods involved in a synchronous measured operation and restores their original property descriptors in a `finally` block. BVH counters attach to that query's output vectors. Telemetry counters attach to the actual ring's destination array, with initialization and export outside the counted append. Collision and swept-contact counters wrap the corresponding prototype methods; radius counts include `Math.hypot` calls with the fixture's exact three half-extents. The measured operation is otherwise unchanged.

Assertions compare outputs before the script emits a success report. BVH and collision numeric results use strict equality, including signed zero. Telemetry storage and exports compare bytes. The script also rechecks measured source hashes and commit metadata after execution, rejecting a run if those inputs changed while it was running. The recorded run used **Node v24.22.3 on Linux/x64**, with the 768 MB JavaScript heap limit shown above.

## Why the counts change

### BVH contact detail work

The general raycast retains its original node and triangle visitation order, tolerances, ownership checks and equal-distance selection behavior. It stores the winning triangle's barycentric coordinates during the search and resolves the final point and normal once after traversal. Earlier candidates no longer incur those final-vector operations when a later candidate replaces them.

This introduces two scalar scratch fields and input/output identity checks. Queries that alias their ray vectors with the hit's output vectors keep the original eager behavior. The measured reduction is specifically in contact detail construction; **there is no reduction in triangle checks** in this fixture. The [BVH regression suite](../../tests/bvh-traversal.test.ts) separately covers seeded rays, ownership, coincident triangles, tolerated edges, misses and aliased inputs.

### Telemetry batch insertion

The ring copies the retained suffix of an incoming batch into at most two contiguous destinations. A prefix that would immediately be overwritten is skipped, while the physical write position advances exactly as it did with one write per row. The existing ring allocation and CSV channel contract remain the same.

In the oversized fixture, 5,940 incoming rows are known to be overwritten before `appendBatch` returns. Skipping their copies reduces copied values by 99%. A normal small batch saves per-row call overhead without necessarily reducing the number of retained values copied. The [ring regression suite](../../tests/recorder-rings.test.ts) covers varied capacities, wrapping, repeated batches, truncation and continuation.

### Collision filtering and cached bounds

The endpoint collision pass checks live conservative y/z bounds before invoking the more expensive separating-axis test. These bounds follow earlier depenetration in the same ordered pass, and include tolerance padding so grazing contacts remain candidates. The x-axis candidate order remains the original order.

The swept pass computes each body's bounding radius once and reuses it, along with per-event interval bounds, instead of repeatedly reconstructing those quantities for every pair. This trades additional per-solver arrays and y/z-bound maintenance for fewer repeated calculations. Dense overlapping scenes still need narrow-phase work; the zero-SAT result is specific to the separated-body fixture. The [collision regression suite](../../tests/collision-query-efficiency.test.ts) covers actual contacts, response order, seeded scenes, large translations and grazing cases in addition to work counts.

### Swept contact points

The rotating sweep continues using its original separation iterations and stopping rules, but requests the support points used for the final contact only at the successful hit iteration. The fixture retains all six iterations and the exact hit fraction, normal and contact point. It removes repeated point construction during preceding separation checks; it does not claim fewer solver iterations.

## Route planner: independent work-count comparison

A separate run compared the actual original planner with the indexed-heap planner at published commit [`c4e62c642d912037e5e9262b1b89d4fbfd9677fe`](https://github.com/cheshmakzanoon-ops/Experiment-3/tree/c4e62c642d912037e5e9262b1b89d4fbfd9677fe). The [route result JSON](ENGINE_ROUTE_PERFORMANCE_2026-11-24.json) records clean measured files, source hashes, exact route hashes and the operation counts below.

| Route fixture                                     | Directed states per search | Original scan slots visited | Revised heap comparison calls | Settled states, both implementations |
| ------------------------------------------------- | -------------------------: | --------------------------: | ----------------------------: | -----------------------------------: |
| All 18 existing Solvane event routes, 44 searches |                        126 |                     704,088 |                        37,691 |                          5,544 total |
| Synthetic 24 × 24 equal-length grid               |                      2,208 |                   4,877,472 |                        23,658 |                                2,208 |
| Synthetic 48 × 48 equal-length grid               |                      9,024 |                  81,441,600 |                       115,413 |                                9,024 |

**Scan slots and heap comparisons are different operations.** Their ratio is not a speedup measurement or an instruction-count ratio. They show the removal of the full-state scan from each queue extraction and the amount of heap ordering work that replaces it. Every returned route leg, direction and station matched exactly. The existing event set required 5,544 heap insertions and 18 decrease-key updates.

The new queue adds two `Int32Array` buffers, totaling eight bytes per directed state per shortest-path search: **1,008 bytes** for the existing 126-state network. No route-result cache is retained. Equal distances still settle the lower state index; the relaxation tolerance, U-turn rules and route construction remain the same. The [route equivalence tests](../../tests/route-planner-equivalence.test.ts) cover further ties, loops, dead ends, seeded graphs and departure rules.

Run the retained [`engine-route-benchmark.mjs`](../../scripts/engine-route-benchmark.mjs) script directly:

```sh
NODE_OPTIONS=--max-old-space-size=768 node --experimental-transform-types scripts/engine-route-benchmark.mjs --baseline /path/to/original/checkout --output /path/to/route-report.json
```

The script loads both actual uninstrumented planners, then uses TypeScript AST locations to insert counters into separate in-memory bundles. It checks that the expected source structure exists and that the instrumented and uninstrumented versions return identical routes. Nothing is inserted into production source files. It holds the shared network fixture fixed and checks that the road-network, terrain-field and region-data sources have identical hashes across the two checkouts. Synthetic grids isolate graph search; they do not replace or edit authored environment data.

The recorded independent run is count-only. An optional `--timings` flag adds 12 warmup passes and nine trials with alternating baseline/candidate order, retaining raw samples as well as medians. Those timings use the uninstrumented planners, and remain local route-planner microbenchmarks. No optional timing trial was run to produce the retained JSON.

## Interpretation and limits

This independent comparison establishes concrete reductions in repeated CPU-side work with exact fixture outputs. It complements the broader regression suites and integration work documented in the [development report](ENGINE_DEVELOPMENT_2026-11-24.md). It does not replace full-game profiling or prove unchanged behavior for every possible input.

No wall-clock measurements were taken for the runs retained here: operation counts avoid attributing shared-host scheduling noise to the implementation. No browser, rendering, GPU, audio, physical-controller, sustained gameplay or power-consumption measurement is included here. No character, model, authored environment or vehicle-tuning content was changed to obtain these results.
