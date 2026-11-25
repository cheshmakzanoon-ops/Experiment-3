# Worker 45 / Wave 8 — completed CSV chunk ownership

The measured change materializes each completed 500-row CSV group as a native `Blob` before retaining it. The header, row order, numerical spelling, line endings, finite/shape validation, final MIME and export worker protocol remain unchanged. The default deterministic export is still exactly **115,038,761 bytes**.

Five fresh-process Node pairs measured median process high-water RSS through export of **628.602 → 370.602 MiB**, a **258 MiB / 41.0%** reduction. These samples precede output verification and include fixture construction and warmups; they are not exact export peak live memory. Median uninstrumented Node export time was **2,210.919 → 1,801.424 ms**. Three native browser pairs measured **1,676.0 → 1,561.0 ms** median completion. Every candidate sample was faster than its paired baseline. **Browser peak memory was not measured.**

The narrow change is retained because it demonstrates reduced Node memory, exact output and no observed material latency regression in both measured runtimes. The output payload still scales with the full CSV; this is not constant-memory streaming.

## Evidence and exact source

- [All raw timings, source hashes, constructor samples and exact comparisons](./w08c-csv-memory-raw.json).
- [Baseline regression proof](./w08c-unit-baseline.json), [current focused unit results](./w08c-unit-current.json), and [native CSV lifecycle results with attachments](./w08c-native-tests.json).
- [Exact executable bundle archive](./w08c-csv-memory-timed-bundles.tar.gz) and [hash manifest](./w08c-csv-memory-manifest.json).

Baseline production is `f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6`. Its CSV source is also byte-identical to task baseline `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`. The current side loads actual working-tree files. The harness checks that **only `src/storage/telemetry-schema.ts` differs among imported production sources** before starting measurements; it does not substitute a rewritten CSV implementation.

| CSV source | Git blob | SHA-256 |
| --- | --- | --- |
| Baseline | `436ceef36e345d39981b9ba920abea441929e647` | `3eaeeeaf3d870ced27977df037b848dc2ddee1f2bdd77cf6c80cc3fdc625223a` |
| Measured current | `3d3636a3d8e69c5dd9498300c519642e33598034` | `ed5e98ae1cc8728ed8b5ad8209ab594351cc613c7b5708c35b0b9d86da342894` |

The runtime edit is two lines plus a comment: `chunks` accepts `BlobPart`, and completed joined rows are passed into a native `Blob` immediately. The existing final `new Blob(chunks, { type: 'text/csv;charset=utf-8' })` assembles the result. Every existing validation condition and formatting operation stays in place. There are no schema, channel, order, version, tuning or authored-content changes.

Measurements ran from `2026-11-25T03:45:39.749Z` to `2026-11-25T03:47:08.984Z` under an exclusive compute/browser lease: Node `v24.22.3`, V8 `13.6.233.17-node.63`, esbuild `0.25.12`, Linux x64, reported CPU `AMD EPYC 9V74 80-Core Processor`, nine visible logical CPUs. Each Node child used `--max-old-space-size=768 --expose-gc`. That flag limits V8 old space, not total RSS or Blob backing storage. Native browser was Chromium `140.0.7339.186`; it loaded the real exporter/worker without a rendered game. The existing Vite inline-worker constructor import alone receives a native `Worker` adapter.

## Exact input and output

The unchanged worker40 fixture appends 54,243 finite deterministic rows through the real default `TelemetryRecorder`, retaining chronological rows 243 through 54,242. The live ring and independently owned snapshot each contain **49,248,000 bytes** across 54,000 rows and 228 channels. Snapshot construction and fixture verification are outside the export timer.

Each of the **12 Node exports** (ten timed, two separately observed) and **six native browser exports** matched every output byte against the bounded independent expected generator. Expected text is regenerated one 500-row group at a time; the harness does not build another complete expected CSV or call `Blob.text()` on the default export. All comparisons had **zero differing bytes**.

| Witness | Result |
| --- | --- |
| Full CSV size | 115,038,761 bytes |
| Full CSV SHA-256, every Node run | `cfc38f4dd65c878d824866c817e65511b1287161c525e3c8cafaed9bf7ad0d9b` |
| Header size | 2,859 bytes |
| Header SHA-256 | `56f0431938763d312f0d153ca7861c8a917fc60e7c35f3513f3ab429e0e575d5` |
| Snapshot SHA-256 | `d3ed142a53b6c773c19483eb0582fb309822b7e8613844571ce330412044ac03` |
| MIME | `text/csv;charset=utf-8` |

Both ring and snapshot digests remain unchanged after every Node export and comparison. Every native snapshot detaches at the sender; the recorder accepts 120 more rows while its worker exports. Every native continuing-ring comparison has zero differing values, each job terminates its one worker, and there are no page errors.

## Node latency and process RSS

Each table cell is one full production export in its own fresh process. There are three 600-row warmups, then explicit GC outside the timed region. Baseline/current order alternates. The export timer includes row formatting and native Blob construction. Constructor observation and exact-output verification are excluded from these latency measurements. No samples are discarded.

`maxRSS` below is the process-lifetime high-water mark read **immediately after export, before verification**. It includes startup, fixture allocation, warmups and this single full export. Each process starts fresh, so it cannot include earlier full-size exports. It does not identify the live object graph or precise instant of the maximum.

| Pair | Order | Baseline ms | Current ms | Baseline maxRSS MiB | Current maxRSS MiB |
| ---: | --- | ---: | ---: | ---: | ---: |
| 0 | Baseline, current | 2,652.048 | 1,784.438 | 627.922 | 370.602 |
| 1 | Current, baseline | 2,527.482 | 1,694.839 | 628.602 | 369.055 |
| 2 | Baseline, current | 2,187.686 | 1,844.773 | 629.320 | 468.027 |
| 3 | Current, baseline | 2,095.364 | 1,801.424 | 628.004 | 368.082 |
| 4 | Baseline, current | 2,210.919 | 1,886.763 | 629.535 | 471.395 |
| **Median** | | **2,210.919** | **1,801.424** | **628.602** | **370.602** |

The independent latency medians differ by 18.5%; the median of paired current/baseline ratios is **0.843253**. These are different statistics and are reported separately. Current RSS varied substantially, including **468.027 and 471.395 MiB** observations; both remain in the evidence. Even these higher current samples were below every baseline sample in this run. No universal latency, tail-latency or FPS improvement is claimed.

Worker40's earlier 639.629 MiB result was a different process-lifetime workload including multiple exports and verification. It remains intact and is not treated as the baseline for this paired comparison.

## Separate Node constructor-memory observations

One additional fresh process per version wraps the native Blob constructor, recording only scalar metadata and memory samples before/after native construction. It does not retain `parts`, CSV strings or Blob objects, and does not force GC during export. These observed runs are excluded from the latency table.

| Parts entering final Blob assembly | Baseline | Current |
| --- | ---: | ---: |
| Total parts | 109 | 109 |
| String parts | 109 | 1 |
| Retained string code units | 115,038,761 | 2,859 |
| Data Blob parts | 0 | 108 |
| Data bytes already owned by Blobs | 0 | 115,035,902 |

This ASCII fixture's code-unit count equals encoded byte count, but code units are **not JavaScript heap bytes**. String representation, intermediate joins, allocator behavior and collection timing vary. The change makes completed group strings eligible for collection sooner; it does not force immediate collection.

| Node memory observation, bytes | Baseline | Current |
| --- | ---: | ---: |
| `heapUsed` immediately before final assembly | 198,424,608 | 32,048,448 |
| `heapUsed` immediately after final assembly | 141,098,896 | 32,089,120 |
| Largest sampled `heapUsed` during export | 198,424,608 | 79,855,664 |
| Largest sampled RSS during export | 650,674,176 | 387,424,256 |
| Largest sampled `external` during export | 122,792,782 | 107,882,585 |
| Largest sampled `arrayBuffers` during export | 235,199,234 | 219,201,222 |
| `arrayBuffers` after GC with ring, input and result retained | 214,949,478 | 214,949,478 |
| `arrayBuffers` after output release and GC | 99,910,717 | 99,910,717 |

`rss`, `heapUsed`, `external` and `arrayBuffers` are different, overlapping categories; they must not be added. The constructor samples are discrete observations, **not exact peak live memory**. Current has more sampling points because it constructs the individual data Blobs. Collection can run inside a native constructor, explaining why baseline heap usage falls during final construction despite a higher process RSS.

The equal post-GC `arrayBuffers` values show that the retained input/output payload is unchanged in this runtime. Releasing the output lowers that category by exactly **115,038,761 bytes** in both versions. RSS need not return by the same amount. The current observed process later reaches a higher lifetime RSS during verification; raw evidence preserves it separately from the export phase. No Node memory observation is labeled browser memory.

## Native browser latency and ownership

Each run uses a fresh context/page and a new actual telemetry worker in one sequential Chromium instance. Completion includes worker startup, production formatting, Blob construction, reply delivery and worker release. Snapshot and output verification are timed separately. These are three cold-worker pairs, not a sustained application benchmark.

| Pair | Order | Baseline completion ms | Current completion ms |
| ---: | --- | ---: | ---: |
| 0 | Baseline, current | 1,676.0 | 1,534.8 |
| 1 | Current, baseline | 1,976.4 | 1,656.7 |
| 2 | Baseline, current | 1,670.4 | 1,561.0 |
| **Median** | | **1,676.0** | **1,561.0** |

The independent medians differ by 6.9%; median paired current/baseline ratio is **0.915752**. The evidence resolves the concrete risk that composing many native Blobs might materially regress this runtime's export/transfer latency. It does not establish browser peak memory, all browsers, maximum-capacity safety or real-game frame-time effects.

The two existing native CSV lifecycle cases also pass unchanged. A 600-row, 547,200-byte snapshot detaches while recording continues; its exact 1,268,138-byte CSV retains SHA-256 `120e22a8e14c8efe4f2ff77b7e952f33abb8c8f33e209c09b0fcb3493bbe5298`. Cancellation, replacement, invalid shape and recovery retain the correct promise owner; five workers each terminate once and canceled success never returns.

## Regression tests and independent lifecycle review

The new 21-case suite covers empty/header-only output; 1, 499, 500, 501, 999, 1,000 and 1,001 rows; exact number spelling including signed zero, subnormal and maximum finite Float32 values; nonzero input offsets; malformed shape before Blob construction; NaN/positive infinity/negative infinity across group boundaries; and a subsequent valid export after a late validation failure. Completed output survives input mutation, detachment and structured cloning. A scalar final-assembly observation guards against retaining the full output as strings; it does not assert private loop calls or exact part counts.

Before the production edit, **20/21 passed** and the ownership regression alone failed: a 1,001-row export retained **4,157,741** string code units at final assembly versus the **2,859** header bound. After the edit, **87/87 tests passed across four files**, including existing export worker ownership and recording tests. The expected baseline failure is retained in its own JSON rather than hidden.

Independent review covered the new recorder/replay/ghost changes, WAVE-05/06 integration evidence and worker40's source/measurement manifest:

| Owner | Reviewed boundary | Finding |
| --- | --- | --- |
| Telemetry ring | Wrapped snapshots, Float32 session-time rewind, resumed tick ownership | Snapshot is independent of the live ring; CSV change uses that existing ownership. No additional demonstrated defect. |
| SessionReplay / IndexedReplayStore | Pending read witnesses, reopened pages, queued writes, Float32 pose versus double surface cutoff, disposal | Current implementation separates page identities and clock domains as exercised by existing integration/native cases. No additional demonstrated defect. |
| GhostRecorder | Invalid/ineligible lap release, duration/sample cap, crossing publication | Stored output copies samples before resetting the recorder; bounded/ineligible recording behavior remains unchanged. No additional demonstrated defect. |
| TelemetryExport / worker | Transfer, replacement/cancel, late results/errors, finite/shape rejection | Controller/protocol source remains byte-identical; current focused and native lifecycle cases pass. |

No additional storage, replay or ghost production file was edited. Scoped ESLint and whitespace checks pass. Full-project TypeScript/build validation belongs to the combined checkpoint, not this worker's focused gate.

## Reproduction

Run with installed dependencies and an exclusive compute/browser lease:

```sh
PLAYWRIGHT_BROWSERS_PATH=/tmp/engine-c71f32882729/browsers \
node --max-old-space-size=768 scripts/bench/engine-followup-csv-memory.mjs \
  --repo /tmp/engine-c71f32882729/repo \
  --mode all \
  --output /tmp/csv-memory.json \
  --work-dir /tmp/csv-memory-work
```

`--mode node` or `--mode browser` selects one category. Defaults are five Node pairs, three browser pairs, three 600-row Node warmups and 54,000 rows. The harness rejects capacities above 54,000; **216,000 rows were never allocated or timed**. The browser installation path can differ elsewhere. Both versions' exact executable bundles and the unchanged shared fixtures are identified in the manifest; formatting was completed before measurement, and no benchmark source was changed afterward.

Focused unit command:

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run \
  tests/engine-telemetry-chunk-storage.test.ts \
  tests/telemetry-export.test.ts tests/telemetry-export-lifetime.test.ts \
  tests/recording.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0
```

The native gate runs `e2e/engine-native-recording.spec.ts` with `--grep 'native CSV'`, one worker and zero retries using the self-routed native fixture. No asset-generation hooks, installs, commits, staging or publication were performed by this worker. COMPUTE and BROWSER leases were released after the scheduled run; no optional repeated measurements were performed.
