# Wave 7: measured engine costs and preserved behavior

Six workers measured the changes against task baseline `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`. Their primary candidate is engine checkpoint `f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6`; the later native-validation checkpoint changes tests and evidence, not the production implementations measured here. Each report pins its source blobs, runtime, workload, warmups, raw samples and exclusions. Performance runs held exclusive compute ownership.

## Useful measured changes

| Engine operation | Baseline | Candidate | Interpretation |
| --- | ---: | ---: | --- |
| Default Aurel BVH construction, 229,376 triangles | 216.644 ms median | 136.239 ms median | Median paired reduction 33.11%; constructor timing only |
| Snapshot capture/ranking, 12 cars and 12 recipients | 144 calls per batch | 12 calls per batch | Complete normal packet bytes and recipient buffer independence preserved |
| Complete 12-recipient snapshot batch | 66.925 microseconds median | 60.080 microseconds median | Median paired latency reduction 9.79%; one pair was slower |
| Control quantization and common checksum | 971.10 ns per call median | 138.47 ns per call median | Median paired speed ratio 7.146x; actual wire values preserved |
| Default unwrapped telemetry snapshot, 54,000 rows | 28.034 ms median | 19.175 ms median | Same 49,248,000-byte payload; unfavorable tail samples retained |
| Default wrapped telemetry snapshot | 29.432 ms median | 20.770 ms median | 54,000 views/copies become two spans |
| Generated texture registration, 1,024 wrappers | 5.178 ms median | 2.169 ms median | Node registration work with a simplified canvas boundary |
| Imported texture registration, 1,024 wrappers | 7.723 ms median | 1.874 ms median | Same boundary; original implementation already shared image storage |

Independent medians and medians of paired ratios are different statistics. Neither is substituted for the other. These are workload-specific measurements on Node 24.22.3 / V8 13.6 in the execution environment. They do not establish whole-game FPS, physical GPU performance, universal latency, or every-device gains.

## Physics: keep exact behavior and investigate unfavorable results

The scalar BVH constructor preserved every tested node bound, order entry and query output. Two real-track sizes covered 20 measured pairs, all faster in this run, with an observed order effect documented rather than hidden. See [BVH measurements](measurements/w07a-bvh-measurement.md) and [raw evidence](measurements/w07a-bvh-raw.json).

Generic collision construction removes 237,583 literal-array/set operations at the default 8,192-row size while preserving all tested mesh bytes. Its elapsed constructor measurements were mixed and do not independently demonstrate a stable speedup. Accepted road-contact frames require four `Math.hypot` calls instead of five. The AWD clutch method avoids an intermediate mapped array, but that branch is dormant in the current authored catalogue, so it contributes no demonstrated present-game saving. See [contact construction and math evidence](measurements/w07b-contact.md).

The initial contact experiment showed a 9.96% median paired slowdown for natural `rl2` substeps. A separate worker then compared full committed source graphs in 127 sequential fresh processes, including a candidate graph with the original road frame as an attribution control. Twelve balanced rounds used 38,400 warmup and 28,800 measured substeps per vehicle process. The independent `rl2` comparison was approximately neutral: -0.67% paired wall time and -0.01% paired CPU time, with six of twelve candidate samples faster. Replacing only the road frame with its original implementation did not demonstrate a reliable natural-workload advantage.

The coordinator retains the narrow normal-length reuse. The isolated frame cases support reduced repeated work, and exact outputs pass; neither experiment supports a broad natural-vehicle throughput claim. The earlier slowdown remains recorded, and its cause is not asserted to be proven. See [independent investigation](measurements/w07e-simulation.md) and [all raw processes and samples](measurements/w07e-simulation.json).

Three actual production Simulation worlds also ran for 1,200 ticks each: formula practice, wet-road motorcycles and motocross. Their captured packed frames and exposed dynamic state compared exactly across 617,181,316 bytes, with weather/surface/terrain checkpoints included. Each scenario covers ten simulated seconds. Private JavaScript fields and static authored definitions are explicitly outside dynamic-state serialization; this is bounded deterministic evidence, not an exhaustive proof of all game behavior.

## Network: share capture, retain independent packets

The network harness executes actual committed server, capture, ranking, queue and codec methods over deterministic twelve-car boundary data. Transport and scheduling are inert, and physics construction/stepping is excluded. It verifies complete normal packets, recipient-specific FULL flags, independent buffers, retained packet stability and the two-batch reentrancy bound.

Capture/ranking changes from 144 to 12 operations for twelve recipients. One-recipient timing shows no demonstrated improvement; zero-recipient dispatch adds approximately 59 ns of fixed bookkeeping. These limits remain in [the network report](measurements/w07c-network.md). Direct control quantization matches 283,305 checked values and encoded bytes. Its eight removed temporary byte-path objects are a source-level inventory, not measured heap bytes or GC time.

## Telemetry: two-span copying and a real default-size export

Sixteen snapshot fixtures and 32 continuing-recording independence checks passed. Default full snapshots retain exactly the same payload but reduce 54,000 `subarray` views and 54,000 `set` calls to one unwrapped span or two wrapped spans. Current-path outliers up to 79.476 ms remain in the report. A smaller partial fixture had a higher current median, so the result is not presented as universal or as a tail-latency improvement.

The CSV algorithm at the measured commits is identical. It already formats 500-row groups but retains completed strings until the final Blob. The default fixture produces 115,038,761 exact CSV bytes. A native Chromium worker transferred the 49,248,000-byte snapshot, continued recording another 120 rows correctly, completed export in 2,281.6 ms, and terminated once. This is one cold browser run; its 90.1 ms cold snapshot is separate from warmed Node comparisons.

The configured maximum 216,000-row recorder was not allocated or timed. Browser peak memory remains unmeasured. Node memory observations distinguish process RSS, live typed payloads and retained string content; these categories are not added together. Exact timed bundles and the later formatting-only script revision are separately identified in the manifest. See [telemetry evidence](measurements/w07d-telemetry.md).

## Texture batching: less repeated CPU work, preserved shared storage

Generated registration now repaints each compatible source group once per traversal and updates each wrapper linearly. Imported registration avoids repeatedly updating earlier wrappers; the baseline already drew each imported image once and already shared GPU storage. The controlled timing boundary uses a simplified canvas implementation and does not measure rasterization or GPU time.

Initial registration can emit more disposal events: a one-group 1,024-wrapper case changes from 1,025 to 2,048 events. This is documented alongside the much larger reduction in repeated wrapper updates. Existing native resource evidence is reused only after matching source hashes; it verifies pixel results and resource ownership, not a direct baseline/current native timing comparison. See [texture evidence](measurements/w07f-texture.md).

## Reproducibility and validation checkpoint

All six tasks provide executable measurement scripts under `scripts/bench/engine-followup-*` and raw evidence in this directory's `measurements/` folder. No authored models, characters, environments, assets or tuning were edited to create a favorable workload.

Separately, published checkpoint `0f7fecfda61ea7e669f04eebd138c52543144421` passed 383 focused engine tests across 32 files, 37 browser/replay cases, TypeScript and the production build with source-stability guards. The browser backend was Mesa llvmpipe, and retries/timeouts/quality settings were unchanged. [Exact CI job](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45537564336/job/138947807393); [recorded metadata](validation/checkpoint5-ci.json).
