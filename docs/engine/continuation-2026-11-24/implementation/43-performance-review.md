# Agent 43 — independent performance and provenance review

## Conclusion

All **296 numerical summary values** recomputed from the retained samples match their archived values exactly. The source fingerprints identify the implementations currently under review: the optimized BVH and response learner, and agent 41's scalar-staged atomic rigid integrator. The measured improvements support these specific conclusions:

| Engine work | Supported result | Measurement scope |
| --- | --- | --- |
| Swept OBB quaternion interpolation | Six-iteration fixture: `acos` calls 6 → 1; `sin` calls 18 → 13 | Operation counts, with unchanged contact result and advancement count |
| Real paved-track collision construction | Median first contact-mesh construction time 47.91–64.60% lower across three tracks | Complete collision-mesh constructor, three fresh-process samples per source/track |
| Synthetic BVH construction | Four cold fixture medians improve; organ-pipe cold construction is 45.02% slower | Five synthetic geometries; cold and warm measurements separated |
| Response learner | Final combined training/query median 90.23% lower; query-only median 93.64% lower | 250,000 helper operations per sample, five workers per source |
| Scalar staging versus preceding atomic integrator | All eight median driver times 16.32–22.88% lower | Catalogue mass/inertia profiles with designed force/torque inputs, five workers per source |
| Scalar staging versus original integrator | Mixed median changes, −20.22% to +12.57% | Separate contemporaneous experiment; all eight sample ranges overlap |

These measurements establish specific construction and helper improvements. They do not measure browser FPS, complete vehicle/world update cost, user-interface startup, GPU time or gameplay quality. Percentages from different components or experiments cannot be added into an overall engine speedup.

This review inspected the recorded reports, benchmark drivers, relevant assertions and source identities, then recalculated every stored median/range/change summary using all retained samples. It did not rerun expensive benchmarks or alter production code, tuning, geometry or assets. A narrowly scoped metadata repair to the archived predictor comparison script is described below.

The machine-readable [43-performance-summary.json](43-performance-summary.json) contains the derived distributions, input-file digests, reviewed source digests, evidence counts and provenance caveats. Its positive `medianTimeReductionPercent` means less elapsed time. The original-solver table below instead uses signed elapsed-time change, explicitly labeled.

## 1. Collision construction and sweep work

### Real tracks: first complete contact-mesh construction

The [agent 28 raw evidence](28-track-contact-build-benchmark.json) measures `new TrackContactMesh(track, rows)` after imports and `Track` construction. Its timer includes collision mesh generation and BVH construction. Hashing and contact-query verification occur afterward. Each source has three fresh workers per track; source order alternates. A fresh process does not imply an emptied operating-system file cache.

Times are milliseconds, expressed as median (minimum–maximum). Reductions use unrounded medians.

| Track | Original | Optimized | Median time reduction |
| --- | ---: | ---: | ---: |
| Aurel | 798.40 (770.52–809.29) | 282.60 (272.73–310.09) | 64.60% |
| Vellamar | 711.24 (681.16–735.50) | 280.45 (266.77–332.62) | 60.57% |
| Loirette Endurance | 1318.52 (1165.27–1436.36) | 686.84 (522.49–706.45) | 47.91% |

All three cold sample ranges are disjoint. Aurel and Vellamar each build 229,376 collision triangles; Loirette builds 423,920. These are the existing track definitions and generated collision geometry.

The separate warm experiment reuses those arrays. Only the final cold worker for each source/track performs one untimed BVH rebuild and three timed rebuilds, with GC before each. The three warm measurements therefore share a process; they are not three independent process replications.

| Track | Original warm BVH | Optimized warm BVH | Median time reduction |
| --- | ---: | ---: | ---: |
| Aurel | 795.19 (720.10–969.07) | 246.19 (200.08–391.36) | 69.04% |
| Vellamar | 728.12 (632.52–810.75) | 231.71 (211.01–239.24) | 68.18% |
| Loirette Endurance | 1052.51 (1035.97–1057.59) | 450.27 (400.19–517.19) | 57.22% |

The import measurements vary independently: Vellamar's median import increases **557.63 → 652.16 ms**, while Aurel's decreases 902.15 → 596.21 ms. Attribution of import differences to the BVH change is unsupported. The recorded `contactReadySinceProcessTimeOriginMs` stops at first contact-constructor completion; the full `processWallMs` additionally contains proof work and optional warm rebuilds. Neither is a browser or user-interface loading measurement.

Peak worker RSS falls from 280.53 → 217.91 MiB on Aurel, 276.72 → 220.85 MiB on Vellamar and 331.31 → 240.75 MiB on Loirette. These are maxima across the three worker high-water marks, including imports, geometry, proof and optional rebuilds. They do not isolate constructor allocations, retained heap or bytes saved per build.

### Synthetic BVH: preserve the unfavorable cold result

The [agent 13 evidence](13-bvh-build-benchmark.json) has three fresh-process first builds and seven warm builds per source/fixture. The warm worker performs three untimed builds first, and GC before each recorded build. Warm source order is baseline then candidate; unlike the cold samples, those two warm workers are not alternated.

| Fixture | Cold median, original → optimized | Cold time reduction | Warm median, original → optimized | Warm time reduction |
| --- | ---: | ---: | ---: | ---: |
| Random 8,192 | 44.36 → 24.56 | 44.63% | 24.56 → 6.24 | 74.58% |
| Random 65,537 | 282.28 → 105.77 | 62.53% | 257.93 → 85.87 | 66.71% |
| Ribbon 229,376 | 659.97 → 259.06 | 60.75% | 574.56 → 191.64 | 66.64% |
| Equal-centroid 8,192 | 22.16 → 19.03 | 14.10% | 11.75 → 4.25 | 63.81% |
| Organ-pipe 8,192 | 20.14 → 29.21 | **−45.02%** | 11.40 → 9.24 | 18.96% |

The organ-pipe cold regression has disjoint ranges: **18.49–22.41 → 26.37–30.44 ms**. Its comparison count increases 89,089 → 395,718 and invokes the bounded heap fallback twice. Warm improvement does not erase that cold regression. Ribbon warm samples also vary substantially: 522.62–765.08 → 177.28–502.47 ms. Every sample remains included.

The operation instrumentation is separate from the timers. Random-8,192 comparisons fall 519,166 → 259,348, temporary ID copies 81,920 → 0, and instrumented builder ID assignments 245,760 → 131,768. Ribbon temporary ranges fall 32,767 → 0. Those counters describe the instrumented builder work; they are not a complete heap-allocation profile. Synthetic `startupWallMs` includes process launch, import, fixture preparation and construction.

### Swept OBB

The [agent 11 report](11-sweep-cache.md) and `tests/swept-obb-interpolation-work.test.ts` support the operation-count result directly. Both the frozen reference and candidate report six advancement iterations and the same hit, fraction `0.39244887098081277`, normal and point; `hypot` calls remain 108. The test explicitly asserts the 6 → 1 `acos` and 18 → 13 `sin` counts. There is no timing distribution from this assignment, so a sweep-time percentage would be unsupported.

## 2. Response learner

Both complete runs are retained, rather than selecting only the faster run. Times below are milliseconds per 250,000 operations, with five fresh sequential workers per source and alternating source order.

| Experiment and workload | Original | Optimized | Median time reduction |
| --- | ---: | ---: | ---: |
| First: observe + gain/yaw query | 191.90 (180.43–243.23) | 18.08 (17.26–95.57) | 90.58% |
| First: gain/yaw query only | 168.22 (167.65–185.16) | 13.91 (10.85–24.44) | 91.73% |
| Final: observe + gain/yaw query | 184.34 (169.75–215.40) | 18.01 (17.75–31.35) | 90.23% |
| Final: gain/yaw query only | 178.01 (161.30–265.73) | 11.33 (11.03–11.66) | 93.64% |

Sources: [first complete run](29-response-benchmark.json), [final complete run](29-response-benchmark-final.json). The initial single baseline-only result, 223.05 ms combined and 190.54 ms query-only, remains in [29-initial-baseline.json](29-initial-baseline.json); it is not mixed into either complete sample set.

Each worker does 100,000 warm-up operations. Every `exercise` creates and pretrains a model for 8,192 observations before its timer, including the query-only exercise. Timed work includes input indexing, optional observation, gain/yaw computation and checksum accumulation; it excludes module transpilation/import, input preparation and that pretraining. Combined timing always precedes query-only timing within a worker. The 95.57 ms first-run candidate combined outlier and 265.73 ms final-run baseline query outlier were retained.

Separate instrumentation records `Array.from` calls **10,000 → 0** and typed-array `subarray` calls **20,000 → 0** over 10,000 observe/solve operations. Source inspection counts eight removed temporary creation expressions in a nonsingular observe/solve pair; the returned gain tuple still allocates. Native-factory counts and source expression counts do not measure all V8 heap allocations or GC time. The result is a large relative improvement in a small numerical helper, without an established proportional reduction in complete-client CPU.

## 3. Rigid integration: current improvement and historical cost

All three rigid experiments use the same unchanged [benchmark driver](../../../../scripts/rigid-step-benchmark.mjs): APX-01, TC-1, GP-R1 and MX-450 catalogue mass/inertia profiles at 120 and 240 Hz. Each workload warms up for 65,536 steps and times 262,144 steps. Five fresh workers per source alternate source order and rotate workload order.

The measured loop includes input application, public-state reset every 1,024 steps, `RigidBody.integrate` and checksum accumulation. It excludes imports, plan generation, exact comparisons, hashes and object-identity checks. There are **10,485,760 timed steps per source per experiment**. These are designed integrator inputs, not complete tyre, suspension, world or rendering workloads.

### Current scalar staging versus preceding atomic implementation

The [direct agent 41 comparison](41-atomic-vs-scalars.json) supports lower median driver time for every workload. All times are milliseconds per 262,144 steps.

| Profile / Hz | Preceding atomic | Scalar-staged atomic | Median time reduction |
| --- | ---: | ---: | ---: |
| APX-01 / 120 | 288.78 (280.08–300.22) | 241.65 (225.74–245.11) | 16.32% |
| APX-01 / 240 | 285.82 (283.93–429.66) | 229.99 (213.06–254.46) | 19.53% |
| TC-1 / 120 | 301.30 (276.66–423.81) | 232.36 (208.37–252.01) | 22.88% |
| TC-1 / 240 | 289.36 (268.19–299.39) | 227.77 (212.83–243.85) | 21.28% |
| GP-R1 / 120 | 298.17 (273.62–362.73) | 234.48 (230.57–269.35) | 21.36% |
| GP-R1 / 240 | 280.81 (277.24–306.73) | 227.93 (219.70–232.99) | 18.83% |
| MX-450 / 120 | 277.81 (275.18–327.03) | 229.24 (217.90–369.86) | 17.48% |
| MX-450 / 240 | 286.43 (278.36–310.44) | 223.72 (222.98–239.13) | 21.90% |

Seven ranges are disjoint. MX-450/120 overlaps because of the retained 369.86 ms candidate sample. The high 429.66 ms and 423.81 ms preceding-atomic samples also remain included. Five samples on one shared virtualized host are not a universal hardware confidence interval.

### Current scalar staging versus original solver

The [separate original comparison](41-original-vs-scalars.json) must be used directly. Its candidate timings differ from the prior experiment, so borrowing one experiment's baseline and another's candidate would create an invalid comparison.

| Profile / Hz | Original median | Scalar-staged median | Signed elapsed-time change |
| --- | ---: | ---: | ---: |
| APX-01 / 120 | 250.02 | 275.68 | +10.26% |
| APX-01 / 240 | 254.28 | 262.13 | +3.09% |
| TC-1 / 120 | 262.21 | 247.33 | −5.68% |
| TC-1 / 240 | 253.81 | 285.70 | +12.57% |
| GP-R1 / 120 | 257.47 | 230.54 | −10.46% |
| GP-R1 / 240 | 266.73 | 268.58 | +0.70% |
| MX-450 / 120 | 295.22 | 235.54 | −20.22% |
| MX-450 / 240 | 267.93 | 232.54 | −13.21% |

All eight original-versus-scalar ranges overlap; the summary JSON preserves every minimum and maximum. Four medians are faster and four slower. **The evidence does not establish that all atomicity cost is gone.**

[Agent 34's earlier experiment](34-rigid-step-benchmark.json) measured the pre-scalar atomic source against the original solver and found 1.67–32.86% higher medians across eight workloads. It remains valid historical evidence of that implementation's cost, including its 478.02 ms TC-1/120 sample. It does not describe the current scalar source.

Owned-object records agree with source inspection: original bodies retain 14 vectors and one quaternion; preceding atomic bodies 19 vectors and two quaternions; scalar-staged bodies 14 vectors and two quaternions. Stable identities and five fewer retained vectors establish a fixed object-count reduction, without a measured transient-allocation rate or byte saving.

## 4. Exactness counts and their limits

| Evidence | Verified scope of the recorded comparison |
| --- | --- |
| Agent 11 | Tests contain 512 seeded 3D sweep paths plus branch, aliasing, time-zero and 80-iteration exhaustion fixtures; comparisons include signed zero and retained miss outputs |
| Agent 13 | All five recorded hierarchy hashes match; test loops cover 2,048 direct rays, 6,144 vertical queries and 6,144 footprint queries across normal/ownership combinations |
| Agent 28 | 444 spatial positions per track × seven query forms × 18 workers = **55,944 top-level calls**; all recorded geometry, hierarchy and query proof objects agree across each track's workers |
| Agent 29 response learner | Each complete experiment records **131,072 observations and 786,432 gain/yaw query triples**, plus internal training-state equality and matching timed checksums |
| Agent 29 full predictor | **4,096 reconciliations, 97,536 pose reads, 12,288 renders and 4,096 authoritative reads** across 32 streams; source hashes match the retained original and current prediction files |
| Agents 34 and 41 | Each comparison records **131,072 complete states × 29 scalars = 3,801,088 scalar comparisons**, plus **768 rejected calls and 384 corrected retries** |

Agent 28's 55,944 calls repeat the spatial/query fixtures across source versions and process repetitions; they are not 55,944 distinct spatial scenarios. The 786,432 response queries each compare a returned pair plus yaw value, rather than counting three separately named queries.

The entire `exact`, `profiles` and `recovery` records match across the historical rigid experiment and both agent 41 experiments. Thus the same 131,072 trajectory positions agree across original, atomic and scalar implementations. Repeating those experiments does not triple unique trajectory coverage. Rejection/recovery fixtures are excluded from normal timings. The normal timing workload is not the separate pathological twelve-correction solver fixture.

The focused test totals in the original assignment reports overlap with other assignments and repeated runs; they should not be added into a distinct-test total. This review recomputed evidence and inspected assertions without rerunning those engine suites. Equality on the checked inputs does not prove all possible future inputs behave identically.

## 5. Source provenance and reproducibility repair

The original continuation reference is commit `5edead7a44c8ccb5a187b22b750ce2bda7715128`. This review checked recorded hashes against the retained files and, where the records identify committed sources, directly against Git blobs.

| Evidence | Baseline identity | Candidate identity and review result |
| --- | --- | --- |
| Agent 13 synthetic BVH | The retained minimal baseline's BVH and math files equal the original reference byte for byte | Historical JSON contains paths but no source hashes/commit IDs; this is corroboration of retained files, not a retroactive recorded fingerprint |
| Agent 28 real tracks | Original commit above; all 24 recorded source hashes match its Git blobs | All 24 candidate hashes match `19df29783d1b8b8b06eb71e9e7e5df6c0dbc0237` and the current measured paths; only BVH differs between versions |
| Agent 29 response learner | Saved pre-change prediction file equals `360d3de1d910b77e9bdca933f47df8d5bc99a69a` | Extracted section hashes match both timing records and current source; full predictor evidence separately uses the original continuation baseline |
| Agent 34 rigid cost | Original commit above; all 21 fingerprints verified | All 21 candidate fingerprints match `676d4c8531695638537bf62af5a74ca8edbe41ef` and the retained pre-scalar reference |
| Agent 41 rigid optimization | Direct baseline is a frozen local Git reference; its rigid content equals the preceding atomic implementation | Both experiments fingerprint the current scalar source; all 21 measured paths match the intended source versions, with rigid as the sole difference |

The decisive rigid source SHA-256 values are:

- Original: `08c32ae36662f45d25c6ef5acf15f01dc5332463973ccaa3b1959bba6e10d61b`.
- Preceding atomic: `eb0caeec3e61745282a3b1fbde6950f7fa64fcfe8ea0072626fdeb95ab41324a`.
- Current scalar: `62c60ad13231d08437088a12df59dcc233f645f0176e57070f155ae15c99f7b7`.

Agent 41's candidate `head` field is `676d4c8…`, the checkout parent at measurement. That commit's rigid file is the **preceding atomic** hash, whereas the measured working file has the **scalar** hash. The parent label must not be presented as a commit containing the scalar implementation. Likewise, the frozen baseline's local reference commit is not a published project commit. The unchanged rigid benchmark fingerprint is `f7e6ed21a565907060844c595f47eb5ef3f76d247561bc31de8676c5a0215d09`. Both rigid and track drivers verify measured source hashes again after sampling.

The benchmark paths are portable: the synthetic BVH driver takes a baseline positional argument and infers its candidate from the script's repository; the track and rigid drivers accept checkout flags; the response driver accepts source-file paths. Environment-specific reproduction examples in the old reports are examples, not mandatory hardcoded lookup paths.

One actual metadata defect was found in [24-prediction-ownership-comparison.mjs](24-prediction-ownership-comparison.mjs): it accepted arbitrary checkout paths while always labeling the baseline `5edead7…`. At the coordinator's request, this review replaced that constant with `git -C <supplied checkout> rev-parse --verify HEAD` for baseline and candidate. The output keeps file-content hashes as the authority for unpublished working changes. All historical benchmark JSON is unchanged; the existing agent 29 baseline label was accurate and is independently supported by its file hash.

Syntax checking and scoped ESLint validate the metadata edit. A lightweight execution of the actual lookup block confirms the original reference resolves to `5edead7…`, the current checkout resolves to its actual parent, and an alternate frozen baseline produces its own different commit. The predictor trajectories were not rerun for this metadata-only change.

## Handoff

The review found no arithmetic error in the retained numerical summaries. Its material reporting constraints are the organ-pipe cold regression, Vellamar import variation, noisy repeated samples, source hashes taking precedence over parent-HEAD labels, historical versus current rigid cost, and repeated exactness counts. The only implementation edit is the future-run metadata repair above. The coordinator owns integration, publication and any whole-project gates; this agent did not stage, commit or push files.
