# Worker 37: actual TriangleBVH constructor measurement

Measured on 2026-11-25, under an exclusive compute lease after the full-game replay and native compiler gate had finished. Both cases completed; there are no partial runs or omitted measured samples. No production source, authored model, environment, geometry value, vehicle tuning, or asset was edited by this work.

## Supported result

For the two actual collision meshes below, the current scalar-bound constructor was faster than the committed baseline in every one of the 20 measured pairs. All node bounds, topology fields, ordered triangle IDs, and sampled query outputs matched exactly. The result concerns the warmed `TriangleBVH` constructor only. It establishes no frame-time, FPS, total startup, rendering, browser, or whole-game speedup.

| Actual mesh | Triangles | Nodes | Baseline median, ms [min, max] | Current median, ms [min, max] | Reduction of separate medians | Median paired reduction [min, max] |
|---|---:|---:|---:|---:|---:|---:|
| poggio-alto, 1,024 rows | 28,672 | 8,191 | 32.896 [23.977, 38.574] | 14.027 [13.838, 15.329] | 57.36% | 53.90% [42.28%, 63.57%] |
| aurel, 8,192 rows | 229,376 | 65,535 | 216.644 [175.777, 264.817] | 136.239 [132.576, 152.801] | 37.11% | 33.11% [22.99%, 48.33%] |

The baseline has a visible execution-order effect. The balanced overall medians average across both positions; they must not be promoted as universal percentage improvements. The cause of the order effect was not isolated in this run. The current implementation remained faster in both order groups and every individual measured pair.

| Mesh | Pair order | Number of pairs | Baseline median, ms | Current median, ms | Median of the paired reductions |
|---|---|---:|---:|---:|---:|
| poggio-alto | baseline → current | 5 | 24.271 | 13.995 | 42.55% |
| poggio-alto | current → baseline | 5 | 37.669 | 14.288 | 61.96% |
| aurel | baseline → current | 5 | 184.401 | 135.649 | 23.97% |
| aurel | current → baseline | 5 | 226.369 | 136.830 | 38.96% |

## Exact source identity

- Baseline commit: `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`.
- Current commit: `f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6`.
- Baseline `src/simulation/bvh.ts` blob: `c729f0c0f4e0feec90439f5c38489c1f22ee4dd5`.
- Current `src/simulation/bvh.ts` blob: `d9d3a403efc0bbcf6586e807b58de90d7ccb3f77`.
- The complete BVH source and dependencies are loaded with `git show <commit>:<path>` into separate esbuild namespaces. The old algorithm is not recreated, extracted from a test, patched onto the current prototype, or inferred from a description.
- The BVH patch saved in the raw JSON changes only the node-bound reduction from repeated array updates to scalar extrema followed by final writes. Partitioning, leaf ordering, and query code are unchanged.
- Both versions use the same `math.ts` blob `5158d9dd40981bd2e00913f5222403189157035e` and `tire-footprint.ts` blob `fc3271371d5957f28c470aeabce52583ba3564e7`. The fixture uses the current `contact.ts` blob `c587549ce58c49e7e7144b51d7b62ef8be7f8d86` and `track.ts` blob `8d4aa8f1a812f6ba8c86765774dd4b79a7915ba4`.
- A complete 63-module source manifest records each loaded path, source commit, Git blob and SHA-256. Both harness source hashes and the generated bundle hash are also recorded.

## Actual geometry and runtime

Each fixture is an actual current-commit `Track` with its authored circuit, clear preset and `flat=false`, passed to `TrackContactMesh`. The constructor receives the actual vertex, normal, index arrays and actual contact-ownership callback. Both BVH versions receive those identical arrays. At 8,192 rows, the harness calls `new TrackContactMesh(track)` without a row argument, exercising the production default. Mesh/track setup is outside every timed interval.

| Mesh | Rows | Columns | Vertices | Triangles | Geometry bytes | Leaves | Maximum tree depth | OS maximum RSS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| poggio-alto | 1,024 | 15 | 15,375 | 28,672 | 1,082,064 | 4,096 | 12 | 131.16 MiB |
| aurel | 8,192 | 15 | 122,895 | 229,376 | 8,651,472 | 32,768 | 15 | 215.82 MiB |

Runtime: Node `v24.22.3`, V8 `13.6.233.17-node.63`, Linux `6.18.57` `x64`, `AMD EPYC 9V74 80-Core Processor`; Node reported 9 available logical CPUs. esbuild `0.25.12` bundled TypeScript before execution, avoiding Node's native TypeScript transform imports. Each case used a fresh child with `--expose-gc --max-old-space-size=768`; V8 reported a total heap limit of 960 MiB. The controller used `--max-old-space-size=512`. Cgroup constraint files were unavailable and are recorded as null, rather than inferred.

The recorded measurement run spans `2026-11-25T02:59:04.426Z` to `2026-11-25T02:59:12.557Z`. The root coordinator confirmed no browser, compiler, replay or other benchmark was running during the exclusive lease. The lease was explicitly released as soon as both cases finished; narrative analysis followed after release.

## Method and timing boundary

1. Resolve the pinned commits and bundle their actual source. Construct one actual mesh for the case. Hash all three geometry arrays.
2. Independently validate the initial current tree and a new baseline tree, then compare all their binary node/order records and all sampled query outputs. These checks are outside timing.
3. Run two warmup pairs: baseline/current, then current/baseline. Warmup samples are preserved in the JSON but excluded from the summary. These are two additional builds per implementation, after the untimed setup/verification builds.
4. Run ten measured pairs with alternating order: five baseline/current and five current/baseline. No sample is trimmed. Before every constructor, run explicit GC and sample memory outside the clock. Measure only `new TriangleBVH(vertices, indices, normals, ownsContact)` with `process.hrtime.bigint`. Constructor validation, centroid generation, partitioning, node allocation and bounds computation are all included.
5. Stop the clock before memory sampling, serialization, snapshot creation, hashing or comparison. Compare the full result of every warmup and measured tree against the binary reference, then release that tree before the next explicit GC. Geometry preparation and all query work are outside the timer.
6. Rehash the geometry arrays after the run and assert equality. Finish and release the case process before beginning the next fixture.

A single untimed setup tree remains resident because the real ownership callback captures its mesh. Compact node/order snapshots are retained; a sequence of large timed trees is never retained. The default-size case completed at approximately 216 MiB maximum process RSS, well below the configured heap limit. Reported peak RSS includes untimed setup and validation, and is not a per-constructor allocation claim. Naturally occurring GC during a constructor remains inside its measured time.

## Complete measured pair timings

All values below are milliseconds; six decimal places retain the timer samples at nanosecond resolution. The JSON additionally retains the integer nanoseconds, raw warmups, sequence positions and memory observations. Pair numbers here are one-based; JSON pair indices are zero-based.

### poggio-alto / 1,024 rows

| Pair | Order | Baseline ms | Current ms | Saved ms | Paired reduction |
|---:|---|---:|---:|---:|---:|
| 1 | baseline → current | 28.613666 | 15.328996 | 13.284670 | 46.43% |
| 2 | current → baseline | 37.668643 | 14.328330 | 23.340313 | 61.96% |
| 3 | baseline → current | 23.976578 | 13.838370 | 10.138208 | 42.28% |
| 4 | current → baseline | 37.178989 | 14.360706 | 22.818283 | 61.37% |
| 5 | baseline → current | 24.271121 | 14.001260 | 10.269861 | 42.31% |
| 6 | current → baseline | 38.573800 | 14.052687 | 24.521113 | 63.57% |
| 7 | baseline → current | 25.670259 | 13.994911 | 11.675348 | 45.48% |
| 8 | current → baseline | 37.331085 | 14.288097 | 23.042988 | 61.73% |
| 9 | baseline → current | 24.155890 | 13.876536 | 10.279354 | 42.55% |
| 10 | current → baseline | 38.297379 | 14.000970 | 24.296409 | 63.44% |

### aurel / 8,192 rows

| Pair | Order | Baseline ms | Current ms | Saved ms | Paired reduction |
|---:|---|---:|---:|---:|---:|
| 1 | baseline → current | 176.712279 | 135.649192 | 41.063087 | 23.24% |
| 2 | current → baseline | 209.327405 | 134.057468 | 75.269937 | 35.96% |
| 3 | baseline → current | 175.777146 | 135.361124 | 40.416022 | 22.99% |
| 4 | current → baseline | 223.960660 | 135.535623 | 88.425037 | 39.48% |
| 5 | baseline → current | 229.088595 | 152.800851 | 76.287744 | 33.30% |
| 6 | current → baseline | 226.369027 | 151.860915 | 74.508112 | 32.91% |
| 7 | baseline → current | 194.012503 | 147.511607 | 46.500896 | 23.97% |
| 8 | current → baseline | 264.817481 | 136.829715 | 127.987766 | 48.33% |
| 9 | baseline → current | 184.401227 | 132.576039 | 51.825188 | 28.10% |
| 10 | current → baseline | 236.071825 | 144.088435 | 91.983390 | 38.96% |

## Independent equivalence evidence

The geometric verifier computes every leaf bound directly from the supplied vertices and ordered triangle IDs, then derives every internal bound from child unions. It compares every stored minimum/maximum with `Object.is`, which distinguishes positive and negative zero. It also checks all triangle IDs form a complete permutation, every node is reached once, all ranges are contiguous and split at the exact midpoint, child IDs follow the expected preorder, leaf sizes are at most eight, and the final traversal covers every node.

For Poggio Alto, this independently checks 49,146 bound components on each initial tree; for Aurel it checks 393,210 on each. Complete node records additionally include left, right, start and end. Baseline/current byte equality covers all 8,191 or 65,535 nodes and all 28,672 or 229,376 ordered triangle IDs. The initial pair plus the four warmup and twenty measured trees gives 26 checked tree instances per case. Every subsequent tree is byte-equal to the independently validated initial pair.

For each tree version, 256 deterministic triangle targets include interiors, edges and vertices across the actual ribbon. The query sequence uses downward, oblique and upward rays, zero/short/long maximum distances, repeated heights at the same x/z to exercise the vertical column cache, tire casts with two prior-support limits, and explicit outside-bounds misses. Actual normals and contact ownership remain enabled. Every query kind produces both hits and misses.

| Mesh | Query kind | Paired queries | Hits per version | Misses per version | Triangle tests per version | Tire feature tests per version |
|---|---|---:|---:|---:|---:|---:|
| poggio-alto | ray | 769 | 384 | 385 | 6,636 | 0 |
| poggio-alto | vertical | 1,025 | 448 | 577 | 2,665 | 0 |
| poggio-alto | tire | 513 | 256 | 257 | 5,327 | 19,324 |
| aurel | ray | 769 | 384 | 385 | 10,906 | 0 |
| aurel | vertical | 1,025 | 448 | 577 | 3,387 | 0 |
| aurel | tire | 513 | 256 | 257 | 9,037 | 35,179 |

There are 2,307 paired query checks and 25,377 compared numeric fields per case. The binary query comparison includes success, distance, triangle ID, contact point, normal, candidate counts and tire feature counts. It also compares retained output-vector fields on misses. This is exact equivalence to the actual baseline query implementation, not an exhaustive proof of every possible query or an independent brute-force intersection oracle.

### Output SHA-256 hashes

The node and order snapshots use explicit little-endian encoding: each node stores six float64 bounds followed by four int32 topology/range fields; triangle order stores uint32 IDs. Combined hashes concatenate the node buffer followed by the order buffer. Query snapshots store eleven float64 values per invocation. Both versions and every measured build share the listed tree hashes; baseline/current sampled queries share the listed query hashes.

| Mesh | Output | SHA-256 |
|---|---|---|
| poggio-alto | nodes | `1fb3ab14c883c3f4c2b4ab1bbe2194e6a1ac06340fe9800a08ce294a570801bd` |
| poggio-alto | order | `50fd6fc45e013f8a3a42780d108f522cdd7ae05fcc89f122bd4fe0a993775cd4` |
| poggio-alto | combined | `2b6591836d90ca5a9d8f779469ab2f6fbbd4eb971b04a56846670bd4c0da465a` |
| poggio-alto | queries | `6a0fa7a5b7735d3c4f888533b2b2812da8a2e83076fe3489129e1dc7628a9511` |
| aurel | nodes | `5101a7c7305425b76ae647f438765d52cbf20df33ea20bdb3a45d22b0bedb10a` |
| aurel | order | `e6a5093bd7e4e841dfd8e7a6e668e261cae485ddd5f8a907fdef98c87516bf16` |
| aurel | combined | `ea1f35c4554aab616c695069d187ffca0039aa2e8eed9495c282face542e0a6a` |
| aurel | queries | `b0ebf37008fa0e812ad74ca72577cc40efbb1f410181799fab54052e51203e78` |

All six input-array hashes matched before and after the complete runs. Their exact values are preserved in the JSON under each fixture’s `hashesBefore` and `hashesAfter`. The script aborts on any node, order, query or geometry mismatch; both case statuses and the top-level status are `complete`.

## Reproduce

From a checkout containing both pinned commits and its existing esbuild dependency, with other benchmarks and browser/compiler suites idle:

```bash
node --max-old-space-size=512 scripts/bench/engine-followup-bvh.mjs \
  --repo "$PWD" \
  --baseline 1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb \
  --current f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6 \
  --case poggio-alto:1024 --case aurel:8192 \
  --warmup-pairs 2 --pairs 10 --query-samples 256 --heap-mb 768 \
  --work-dir /tmp/engine-followup-bvh-repro \
  --output /tmp/engine-followup-bvh-repro/result.json
```

The controller and runner are `scripts/bench/engine-followup-bvh.mjs` and `scripts/bench/engine-followup-bvh.runner.mjs`. `--prepare-only` resolves and bundles all committed source without creating any geometry. The controller runs cases sequentially, writes each case result, and marks aggregate output failed if a child fails; it does not turn partial evidence into a completed run. It invokes no package installs, npm hooks, broad test suite, browser, game replay, or git write.

Raw evidence: `w07a-bvh-raw.json` (SHA-256 `09f126d4db4a0ab40cb756cac823677619e44801f21c0ceb57527d6a05dcfcd1`).

Harness SHA-256: `b0522ab56adc8a758ebc8609811d5145ea1ffad816dee9eddf4bc8735052f2aa`. Runner SHA-256: `86d542b71fe376e570aecdcdac0fda8eb0d1eb7e93447972a4768bf74734ff2d`. Generated bundle SHA-256: `3ae22cb24a812599ca2ea3b2092fe7ade6c0cf4f4157ef7cb5a8be2b308c8bac`.

## Limits on interpretation

- This is one host, one Node/V8 version and one complete invocation. Timing noise, JIT state, GC behavior, memory locality and system scheduling are not eliminated. The observed order dependence limits the portability of a single percentage.
- Warmed constructor timings include the whole BVH constructor but exclude actual mesh construction, module parsing, bundling, full-game startup and all downstream simulation/render work. The constructor is static setup work; this evidence supports no FPS estimate.
- The shared fixture intentionally uses the same current geometry for both trees to isolate the BVH change. This benchmark does not measure the separate contact-mesh construction optimization or independently compare baseline/current authored venue generation.
- The smaller Poggio Alto fixture is a real authored track sampled at 1,024 rows, not its production resolution. Aurel explicitly exercises the 8,192-row production default.
- Node/order equality is exhaustive for the constructed trees. Query equality is limited to the documented deterministic samples. No query-speed claim is made, because queries were verified outside the timed region.
- No genuine defect was found and no production edit was necessary. Reproduction measures the pinned commits even if the checkout later advances.
