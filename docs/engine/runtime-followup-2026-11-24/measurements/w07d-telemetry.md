# Worker 40 / Wave 7 — telemetry snapshot and CSV measurements

The committed contiguous-span snapshot path preserves every tested byte while reducing a full default recorder from 54,000 source views and 54,000 typed-array `set` calls to one or two of each. Default-capacity full-ring Node medians were 28.034→19.175 ms unwrapped, 29.432→20.770 ms wrapped, and 28.645→19.245 ms after truncation/resume. These results include allocation and copy costs and retain all outliers. The CSV algorithm is unchanged: its existing 500-row chunks still accumulate until `Blob` construction. A native default-capacity export produced an exact 115,038,761-byte CSV in 2,281.6 ms while the recorder continued accepting rows.

Evidence: [Node raw paired timings, counters and memory samples](./w07d-telemetry-raw.json), [native browser evidence](./w07d-telemetry-browser.json). No production source or authored content was modified for this measurement.

## Committed source and environment

- Baseline: `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`.
- Current engine: `f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6`.
- Node run: `2026-11-25T03:14:20.883Z` through `2026-11-25T03:14:55.079Z`.
- Node `v24.22.3`, V8 `13.6.233.17-node.63`, esbuild `0.25.12`; Linux x64, reported CPU model `AMD EPYC 9V74 80-Core Processor`, 9 visible logical CPUs.
- Each Node fixture ran in a fresh, sequential process with `--max-old-space-size=768 --expose-gc`. The heap flag bounds V8 old space, not external ArrayBuffer/Blob bytes or whole-process RSS. No other task held the shared compute lease during measurements.
- Native browser: Chromium `140.0.7339.186`, one fresh headless page and one actual worker, using the already installed browser. No rendered game or authored assets were loaded.

| Source | Baseline git blob | Current git blob |
| --- | --- | --- |
| `src/storage/recorders.ts` | `23548b23fd0a6faa93dc8e0ca812f348db5e7524` | `96d4accd8beb03b2722ebd081413b75109f8168b` |
| `src/storage/telemetry-schema.ts` | `436ceef36e345d39981b9ba920abea441929e647` | Same |
| `src/storage/telemetry-export.ts` | `10eabd256d03fac11681c93db88deff06a51b26e` | Same |
| `src/workers/telemetry.worker.ts` | `2c4774dce2a9e7e961352ed8ce56cc1b97acf8f6` | Same |
| `src/simulation/protocol.ts` | `1d795cb5ce9e128432650b28a8a74c7b3b010df9` | Same |

The esbuild resolver reads each import from its pinned git tree, preserving the actual class and method bodies. Full dependency source blobs and SHA-256 values are in the raw evidence. There is no reimplemented snapshot method or native TypeScript transform. The browser adapter replaces only Vite's inline-worker constructor import with a native `Worker` built from the unchanged committed worker source, following the earlier native recording fixture.

## Snapshot workloads, exactness, and timing method

Sixteen fixtures cover an empty 60-row ring plus five states at capacities 600, 6,000 and 54,000: 60% full unwrapped; full unwrapped; full wrapped after appending 4/3 capacity; wrapped after truncating 1/4 capacity; and that truncated ring after resuming for 1/2 capacity. Production `appendBatch` fills 60-row batches; production `truncate` creates the rewind states. No recorder private storage is injected.

The timing fixture deliberately sets the race and session clocks equal to exactly representable multiples of 1/64 second. This isolates `snapshot()` from the separate, intended change in race/session-clock truncation semantics. It does not claim baseline and current `truncate()` are equivalent for race sessions. Existing [telemetry time/ring tests](../../../../tests/engine-telemetry-time-ring.test.ts) and [recording composition tests](../../../../tests/engine-recording-composition.test.ts) cover that behavior separately.

Every fixture directly compares the baseline and current snapshot buffers byte for byte, then checks both against an independently maintained chronological row model. All **16 comparisons passed with zero differing bytes**, covering 240,412,320 bytes across the fixture pairs. Inputs include signed zero and a non-dyadic Float32 value so equality is not limited to simple integer rows. After timings, each implementation retains a snapshot while production recording appends capacity+17 rows, overwriting every physical ring slot. All **32 independence checks passed**, and the new live chronology also matched the independent model.

Each fixture records three warmup pairs and ten measured pairs. Order alternates baseline/current, then current/baseline. Explicit GC occurs before each timed sample, outside the timer. A sample runs enough consecutive actual snapshots to target about 32 MiB of output, bounded to 2–128 snapshots; all default-capacity states use two. Timings include `new Float32Array`, production copy operations, and any runtime reclamation within the sample. Results are normalized per snapshot. Buffers are consumed through a numeric sink and discarded. Correctness, source-view/set instrumentation, GC, fixture creation and continued-recording checks are outside the timed region.

### All measured nonempty snapshot results

Milliseconds per snapshot; each cell shows median and full minimum–maximum range across the ten measured samples. The last column is the median of the ten paired baseline/current ratios, which can differ from dividing the two independent medians.

| Ring capacity | State | Retained rows | Baseline ms | Current ms | Median paired ratio |
| ---: | --- | ---: | ---: | ---: | ---: |
| 600 | unwrapped-partial | 360 | 0.141 (0.101–0.204) | 0.133 (0.093–0.174) | 1.176× |
| 600 | unwrapped-full | 600 | 0.176 (0.171–0.214) | 0.160 (0.153–0.182) | 1.092× |
| 600 | wrapped-full | 600 | 0.191 (0.175–0.333) | 0.168 (0.159–0.180) | 1.122× |
| 600 | truncated-wrap | 450 | 0.265 (0.139–1.029) | 0.184 (0.122–0.332) | 1.381× |
| 600 | truncated-resumed | 600 | 0.186 (0.175–0.224) | 0.180 (0.164–0.243) | 1.021× |
| 6,000 | unwrapped-partial | 3,600 | 1.331 (1.160–7.790) | 1.458 (0.982–2.581) | 0.960× |
| 6,000 | unwrapped-full | 6,000 | 2.717 (2.223–11.431) | 1.985 (1.520–8.416) | 1.512× |
| 6,000 | wrapped-full | 6,000 | 2.597 (2.218–7.218) | 2.049 (1.816–7.083) | 1.182× |
| 6,000 | truncated-wrap | 4,500 | 1.625 (1.523–4.463) | 1.238 (1.188–2.468) | 1.316× |
| 6,000 | truncated-resumed | 6,000 | 2.317 (2.137–2.644) | 1.726 (1.626–1.920) | 1.391× |
| 54,000 | unwrapped-partial | 32,400 | 8.439 (7.444–9.295) | 3.592 (3.356–3.825) | 2.354× |
| 54,000 | unwrapped-full | 54,000 | 28.034 (26.388–30.754) | 19.175 (17.710–79.476) | 1.466× |
| 54,000 | wrapped-full | 54,000 | 29.432 (27.115–31.396) | 20.770 (19.901–23.457) | 1.408× |
| 54,000 | truncated-wrap | 40,500 | 22.359 (18.799–25.216) | 20.881 (16.485–61.195) | 1.096× |
| 54,000 | truncated-resumed | 54,000 | 28.645 (26.269–31.747) | 19.245 (17.339–70.525) | 1.445× |

The empty ring measured approximately 0.000219 ms baseline and 0.000215 ms current and performs no source views/copies. Those sub-microsecond figures are overhead evidence, not a useful performance claim.

The large default unwrapped full-ring current outlier was **79.476 ms**, truncated current outlier **61.195 ms**, and resumed current outlier **70.525 ms**. They remain in the raw data and ranges. The 6,000-capacity partial case had a higher current median than baseline. These results support fewer operations and useful default-size median reductions on this runtime; they do not establish universal latency, browser snapshot speedup, tail-latency improvement, or FPS.

### Actual untimed copy/view counts at default capacity

These counters wrap native `Float32Array.subarray` and `set` plus the recorder's `offset` for one actual snapshot after measurement; they are restored immediately. The same total number of Float32 values is copied in both versions.

| State | Rows | Baseline views / sets | Current views / sets | Offset calls | Output bytes, both versions |
| --- | ---: | ---: | ---: | ---: | ---: |
| unwrapped-partial | 32,400 | 32,400 / 32,400 | 1 / 1 | 64,800 → 1 | 29,548,800 |
| unwrapped-full | 54,000 | 54,000 / 54,000 | 1 / 1 | 108,000 → 1 | 49,248,000 |
| wrapped-full | 54,000 | 54,000 / 54,000 | 2 / 2 | 108,000 → 1 | 49,248,000 |
| truncated-wrap | 40,500 | 40,500 / 40,500 | 2 / 2 | 81,000 → 1 | 36,936,000 |
| truncated-resumed | 54,000 | 54,000 / 54,000 | 2 / 2 | 108,000 → 1 | 49,248,000 |

The reduction counts temporary source-view objects and method invocations. It does **not** reduce the full snapshot's typed payload or the live ring capacity, and no view-object heap-byte estimate is claimed.

## Existing CSV cost and retained content

`telemetryCsv` has the same source blob at both commits. It validates every value, converts each field to a string, joins each row, joins groups of at most 500 rows, retains those completed strings in `chunks`, then constructs one `Blob`. There is no proposed single-join optimization: production already chunks its row formatting.

The finite numerical trace is the same formula used by the earlier 600-row native fixture, starting at chronological row 243. The 600-row result reproduces its exact **1,268,138 bytes** and SHA-256 `120e22a8e14c8efe4f2ff77b7e952f33abb8c8f33e209c09b0fcb3493bbe5298` ([prior native evidence](../validation/w06e-evidence.json)). The default CSV SHA-256 in Node is `cfc38f4dd65c878d824866c817e65511b1287161c525e3c8cafaed9bf7ad0d9b`.

The Node CSV results use three 600-row warmups and three full-size measured exports per size, with GC outside the timers. Snapshot construction is excluded. Every output byte from the first full export at each size is compared with an independent expected text generator, retaining only one expected 500-row chunk at a time. Exact verification and a separate instrumented Blob-construction run are outside the timing samples.

| Retained rows | Snapshot bytes | Exact CSV bytes | Node encode ms, median (range) | Blob parts including header |
| ---: | ---: | ---: | ---: | ---: |
| 600 | 547,200 | 1,268,138 | 17.863 (17.681–19.126) | 3 |
| 6,000 | 5,472,000 | 12,765,467 | 307.220 (196.661–311.925) | 13 |
| 54,000 | 49,248,000 | 115,038,761 | 1688.757 (1619.387–2680.595) | 109 |

At 54,000 rows, the untimed constructor observer counted **109 retained string parts totaling 115,038,761 code units**, with a largest part of **1,067,915 code units**. The fixture is ASCII, so the total equals UTF-8 output bytes. Code units are a retained-content count, not a JavaScript heap-byte estimate: engines can use one-byte strings, two-byte strings, ropes and temporary flattening representations. The completed chunks remain retained until Blob construction, so 500-row formatting does not make the full export's retained content constant-size.

### Exact typed input capacities

| Configuration | Rows × Float32 channels | One ring | Live ring plus independent full snapshot |
| --- | --- | ---: | ---: |
| Default 900 s | 54,000 × 228 | 49,248,000 bytes (49.248 MB; 46.967 MiB) | 98,496,000 bytes |
| Configured maximum 3,600 s | 216,000 × 228 | 196,992,000 bytes (196.992 MB; 187.867 MiB) | 393,984,000 bytes |

The maximum row count is derived from the constructor limits. **The 216,000-row case was not allocated or timed.** These figures count typed payload only. They do not bound CSV strings, Blob backing storage, transient buffers, collector overhead, process RSS, or browser worker memory. CSV size depends on actual values; this fixture's expansion ratio is not a general maximum-capacity estimate.

### Node memory samples, separately from browser memory

At default capacity, the isolated CSV process reached a measured process-lifetime high-water RSS of **654,980 KiB (639.629 MiB)**. This includes input construction, warmups, three exports, streamed comparison and the untimed observer; it is not an isolated export's exact peak live set.

Immediately before native Blob construction in the untimed observed export, `heapUsed` was **214,688,960 bytes** and RSS **605,786,112 bytes**. Immediately after construction, `heapUsed` was **151,767,392 bytes** and RSS **669,671,424 bytes**; collection can run inside construction, so a decrease in one metric does not mean no temporary allocation occurred. With the ring, input snapshot and output Blob still reachable after forced GC, sampled `heapUsed` fell to **7,928,976 bytes**, `arrayBuffers` was **214,949,478 bytes**, and RSS was **525,746,176 bytes**. After releasing the output Blob and GC, `arrayBuffers` returned to **99,910,717 bytes**, exactly one output Blob's **115,038,761 bytes** lower in this Node runtime. The recorder ring and input snapshot remained reachable and their byte lengths were checked at the end.

`rss`, `heapUsed`, `external` and `arrayBuffers` are overlapping/different accounting categories and must not be added. RSS remained high after release because process allocation and reclamation behavior differs from reachable payload counts. These discrete samples and process high-water mark do not identify the exact instant or object graph of maximum live memory. They are **Node/V8 observations only** and must not be labeled browser worker memory measurements.

## One native default-capacity worker export

The browser run uses the default `TelemetryRecorder`, the actual committed `TelemetryExport`, and the actual committed telemetry worker. It appends 54,243 deterministic rows, producing a wrapped 54,000-row suffix, then snapshots it. Every Float32 word is checked before transferring the snapshot through the production export API.

| Native observation | Result |
| --- | ---: |
| Snapshot payload | 49,248,000 bytes |
| Single cold snapshot latency | 90.1 ms |
| Snapshot differing Float32 words | 0 |
| Synchronous export call, including worker construction/post | 5.6 ms |
| Sender snapshot detached | Yes |
| Additional rows appended while export was pending | 120 |
| Continuing append duration | 1.1 ms |
| Continued chronological ring differing values | 0 |
| Worker job completion, including startup, CSV/Blob, reply and release | 2,281.6 ms |
| Exact output CSV | 115,038,761 bytes |
| Streamed comparison differing bytes | 0 |
| Ring/output verification after export completion | 2,191.7 ms |
| Worker terminations | 1 |
| Page errors | 0 |

The verification regenerates at most one expected 500-row string chunk plus its encoded bytes at a time and reads `Blob.stream()`; it does not create `Blob.text()`, a second full expected CSV, or a second full recorder snapshot. Output verification occurs after the export timer stops. The sole worker terminates through the production exporter. Cancellation/replacement/error recovery was already covered by the earlier native fixture; this run adds size and latency evidence rather than re-running those smaller lifecycle cases.

This is **one cold browser run**, with no baseline/current browser latency comparison. The cold 90.1 ms snapshot must not be compared directly to warmed Node medians as a speedup result. Browser peak memory was **not measured**. A successful default-capacity run does not establish safe maximum-capacity export memory or latency.

## Reproduction and validation

Four measurement-only scripts are added:

- [engine-followup-telemetry.mjs](../../../../scripts/bench/engine-followup-telemetry.mjs): pinned-source bundling and sequential orchestration.
- [engine-followup-telemetry.runner.mjs](../../../../scripts/bench/engine-followup-telemetry.runner.mjs): actual snapshot comparisons, timing, counters and Node CSV observations.
- [engine-followup-telemetry.fixture.mjs](../../../../scripts/bench/engine-followup-telemetry.fixture.mjs): deterministic finite rows and bounded exact stream comparison.
- [engine-followup-telemetry.browser.mjs](../../../../scripts/bench/engine-followup-telemetry.browser.mjs): native transfer/export/default-capacity evidence.

Run from the repository with existing dependencies, alone under an exclusive compute/browser lease:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/engine-c71f32882729/browsers \
node --max-old-space-size=768 scripts/bench/engine-followup-telemetry.mjs \
  --repo /tmp/engine-c71f32882729/repo \
  --output /tmp/telemetry-measurement.json \
  --work-dir /tmp/telemetry-measurement-work \
  --mode all
```

`--mode node` skips the browser; `--mode browser` runs only the one bounded native case. This recorded run executed those two modes sequentially into the two linked evidence files. Default numeric settings are 600/6,000/54,000 capacities, three warmups, ten paired snapshot samples and three CSV samples. Existing browser installation location may differ on another machine. The harness caps requested capacities at 54,000; it does not attempt maximum-size allocation.

Validation completed: smoke run; all 16 snapshot fixtures, 32 continuing-recording independence checks and three exact Node CSV fixtures; one exact default-capacity native worker export; focused ESLint for all four final scripts. Prettier formatting after measurement changed only presentation. No npm lifecycle hooks, broad tests, installs, commits or staging were run by this worker. Production source, authored models/environments/characters/assets and vehicle tuning were not edited. Both exclusive compute and browser leases were released.

Compiled bundle SHA-256 values recorded with the evidence:

- Node: `9c3cfd54e7a1f5f99244a3e17181743a6477cc7acd3f21ce804ffe7183067ce3`.
- Native worker: `02674196ecd991b24d6ce9e3d3b24ffc6a04a1682b081d580542a1c8ae486f00`.
- Browser fixture: `8be1ea8d435a157d8cc081058370b851356760d754c721bd0762908082b3fed7`.

## Exact timed harness retention

The [timed bundle archive](./w07d-telemetry-timed-bundles.tar.gz) preserves only the exact three executable bundles used for these measurements, with no dependency directories or other scratch files. All three bundle SHA-256 values were rechecked against the values recorded during the runs. The [harness manifest](./w07d-telemetry-manifest.json) separately records final formatted script hashes, raw evidence hashes and archive metadata. Final source scripts received Prettier formatting after measurement; they are not mislabeled as the exact timed byte sequence. No long benchmark was repeated for formatting.

The normal orchestrator reproduction command creates fresh fixture configurations automatically; raw settings and sample iteration counts are retained in the measurement JSON.
