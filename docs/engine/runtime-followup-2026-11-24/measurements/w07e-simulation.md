# Wave 7E independent simulation and road-frame investigation

Measured 2026-11-25T03:18:38.247Z to 2026-11-25T03:26:59.227Z. Baseline `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`; candidate `f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6`. The third source graph uses candidate everywhere except the original committed road-contact frame.

## Fresh-process timing

Each row summarizes 12 balanced process pairs. Vehicle samples contain 28800 measured substeps after 38400 warmup substeps in that same fresh process. Each episode resets the laboratory track/car outside timing. Frame samples contain 4000000 measured calls after 2000000 warmup calls. Negative paired change means faster.

| Workload and comparison | Before median ms | After median ms | Median paired wall change | Median paired CPU change | After faster pairs |
| --- | ---: | ---: | ---: | ---: | ---: |
| Natural rl2: baseline → candidate | 1692.030 | 1717.401 | -0.67% | -0.01% | 6/12 |
| Natural rl2: candidate-original-frame → candidate | 1674.404 | 1717.401 | 0.60% | -0.40% | 4/12 |
| Natural rl2: baseline → candidate-original-frame | 1692.030 | 1674.404 | -1.05% | 0.20% | 6/12 |
| Natural sk125: baseline → candidate | 1436.948 | 1423.812 | -2.79% | -0.89% | 8/12 |
| Natural sk125: candidate-original-frame → candidate | 1405.343 | 1423.812 | 1.76% | 0.39% | 5/12 |
| Natural sk125: baseline → candidate-original-frame | 1436.948 | 1405.343 | -0.21% | -3.58% | 6/12 |
| Frame flat-actual-rl2: baseline → candidate | 791.451 | 707.097 | -5.48% | -5.73% | 11/12 |
| Frame diverse-normal: baseline → candidate | 770.781 | 700.391 | -10.41% | -10.06% | 12/12 |

## Exact production-world output

- **formula:** 1200 production Simulation ticks (10 simulated seconds), 1201 complete packed frames and dynamic state snapshots, 11 weather/surface/terrain snapshots; 140,100,864 raw bytes compared exactly. Frame SHA-256 `89c0e71706e4cec5213c651069e8dfb0a2ef0521c5c8dbc652e1268c27911f7b`; state SHA-256 `466a18dbb2d8319ee435a3e53c0c9f19b7f561fcbcffd1417e0e2fcd96fbc318`.
- **motorcycle-wet:** 1200 production Simulation ticks (10 simulated seconds), 1201 complete packed frames and dynamic state snapshots, 11 weather/surface/terrain snapshots; 234,218,818 raw bytes compared exactly. Frame SHA-256 `ad2c5dd66a0db262fea63054524c2bfafdcb8f022ebcda424d0d25bcb13a97d3`; state SHA-256 `4ea65b9e3ea6fa46ee435408621c07a2e991abdce1a0765a5e6f1208e388b544`.
- **motocross:** 1200 production Simulation ticks (10 simulated seconds), 1201 complete packed frames and dynamic state snapshots, 11 weather/surface/terrain snapshots; 242,861,634 raw bytes compared exactly. Frame SHA-256 `f66f21bc962e31fd2e6c653a8a013c64c41a152a0b20b029fb4657c88d3f8ec8`; state SHA-256 `28f335d533661af4ee3a95da7597069984e182fff46d818589b220470cc40d99`.

## Attribution, methodology, and limits

The flat frame case uses 128 input records captured from actual rl2 RoadContactFrame.set calls on the analytic runway, preserving Float64 bits and signed zero. Its 1200-substep capture made 4800 frame calls and 0 clutch-coupling calls; the mesh remained unbuilt. Diverse-normal microbenchmarks use the earlier pitch/roll/bank/scale fixture and are not treated as the cost of flat runway frames. The authored AWD clutch saving remains dormant and is excluded from claimed natural-workload improvements.

One source implementation and one vehicle/workload run in each fresh process. Twelve rounds cover all six three-variant orders twice, and workload order alternates. No build, mesh creation, vehicle/track setup, explicit GC, serialization, hashes, or exact comparisons enter the timed episodes. Endogenous allocation/GC during integration remains included. Every raw warmup and measured wall/user/system CPU duration is retained in JSON, as are all process IDs, memory/resource usage, source graphs, Git blobs, source SHA-256s, Node executable hash, and bundle/harness hashes.

Packed frames are compared without changing, rounding, omitting, or normalizing any byte; writeFrame receives its normal zero timing/dropped defaults in both variants. Exposed dynamic car/race/AI state is serialized with exact Float64 bits. Shared authored definitions and static geometry are excluded from dynamic serialization; JavaScript #private fields are inaccessible. Weather/surface arrays and sparse off-road terrain checkpoints are additionally compared every 120 ticks and at the end. No renderer/browser/GPU or full-game FPS conclusion follows from Node CPU timings. This host runs v24.22.3 / V8 13.6.233.17-node.63; JIT behavior need not match CI Node22 or other machines.

The original W07B +9.96% rl2 signal remains retained in its separate report. This independent run does not delete or relabel it.

## Reproduce

Run alone from the repository root:

```sh
node --max-old-space-size=768 scripts/bench/engine-followup-simulation.mjs --baseline 1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb --candidate f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6 --output docs/engine/runtime-followup-2026-11-24/measurements/w07e-simulation.json
```

## Retention decision for this measured run

Retain the narrow road-frame normal-length reuse, with no demonstrated natural-vehicle throughput gain claimed. Natural rl2's paired median is −0.668% wall and −0.007% CPU (6/12 faster), so this independent long-warmup/fresh-process run does not robustly reproduce W07B's approximately +10% slowdown. It does not establish W07B's cause or prove it was noise. The original-frame attribution control is mixed (+0.602% wall but −0.405% CPU for current rl2); it does not justify a causal slowdown claim. sk125's −2.793% wall and −0.891% CPU remain a modest, variable result.

Actual unit-up rl2 frame inputs improved by a −5.484% median paired wall change (11/12 faster), separately from diverse normals at −10.415% (12/12 faster). All timed output records match exact bytes. A single unfavorable flat-input pair (+16.976%) remains in the data. Authored AWD clutch coupling remains dormant and contributes no claimed natural-workload gain.

All three full production Simulation traces passed: ten simulated seconds each for formula, wet motorcycle, and motocross, with 617,181,316 exact compared bytes across packed frames, exposed dynamic state and bounded surface/terrain checkpoints. The proof establishes correctness on these traces, not full-game throughput. Long warmup did not eliminate timing variability: natural rl2 paired wall changes still span −15.909% to +11.496%; no outlier was removed or favorable rerun selected. Node24/V813 behavior need not match CI Node22.
