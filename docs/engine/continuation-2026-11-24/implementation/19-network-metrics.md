# Agent 19 — bounded networking diagnostic samples

Date: 2026-11-24. Wave 4. Scope: client/predictor diagnostic retention and reporting.

## Outcome and owned files

Replaced the five RaceClient and seven LocalCarPredictor unbounded metric arrays with fixed-capacity rings. Normal prediction, smoothing, command issuance, wire serialization, ACK handling and retained state ownership are unchanged.

Changed:

- `src/net/metric-samples.ts` (new shared collector)
- `src/net/client.ts` (statistics recording/access and view documentation only)
- `src/net/prediction.ts` (statistics recording/access only)
- `src/net/slice.ts` (explicit report metadata)
- `scripts/online-slice.ts` (one metadata field passed into console output)
- `tests/network-metric-retention.test.ts` (17 new cases)

No models, characters, authored environments, tuning, dependencies, commits or refs were modified. Command-history pruning and prediction-state ownership remain separate assignments.

## Storage and reporting contract

Each metric retains its newest **4,096 observations** in chronological order. At 60 Hz this is about 68 seconds; different event rates imply different durations, so the API explicitly describes a sample window. Recording updates one Float64 slot and a fixed set of scalar counters; it does not shift, copy or allocate an observation object. Explicit stats reads return detached `number[]` snapshots, preserving existing readers, slicing, sorting, distributions, JSON and structured-clone behavior. Held snapshots stay unchanged after future writes and cannot corrupt retained samples.

The raw retained sample storage is fixed at 160 KiB for five client metrics plus 224 KiB for seven predictor metrics: **384 KiB per RaceClient including its predictor**. Scalar fields, fixed collector objects and snapshots allocated by readers are additional. This is an internal metric-storage bound, not a whole-client or whole-game memory claim.

Existing event counters remain lifetime totals. `sampleCapacity` identifies the retained-window limit. `sampleTotals` supplies detached lifetime summaries per metric: total observations, finite sample count, sum, mean and maximum. Eviction cannot erase an early spike or reduce a lifetime count. The sums use ordinary chronological IEEE-754 accumulation; there is no sampling or histogram approximation. The last bits of a lifetime mean can differ from the old report utility's sort-first sum. Non-finite diagnostic values remain visible in the recent array but are excluded from the explicitly labelled finite lifetime summaries.

`SliceReport.clientMetricWindow` identifies the affected distributions (packet sizes, input lead, prediction metrics, interpolation delay and RTT) as merged recent windows **per metric per client instance**, including replaced clients. Their `samples`, `mean`, `max` and quantiles describe those windows. Lifetime event counts, link bandwidth totals, server timing and harness remote-position errors keep their existing periods. The console subset also prints this metadata; consumers are not silently shown a recent quantile as a full-race quantile.

`RaceClient.view()` already evaluates predictor rendering/smoothing, so repeated public views already added visual-step observations. This behavior is preserved and now documented. The new tests establish its bounded storage and distinguish those observations from scheduled rendered-frame counters.

## Executed verification

All **96 tests passed across four suites**:

| Suite | Passed |
|---|---:|
| network-metric-retention | 17 |
| net-prediction | 8 |
| net-client-lifetime | 20 |
| net-runtime-metrics | 51 |

The new cases cover empty windows; exact/near capacity and multiple wraps; a million observations with stable backing buffers and lifetime extrema; non-finite values and signed zero; detached arrays and summaries; short-run exact distributions; copied key ownership; 100,000 predictor renders; all prediction error categories after eviction; external mutation isolation; actual timer-driven clients; and 100,000 public view calls.

The scheduled client run spans 1,700 seconds, executes **102,000 rendered-frame observations**, receives **34,001 snapshots**, and keeps all five client metric windows at 4,096 while counters continue. Valid ACKs deliberately keep the unrelated command history healthy. The collector's million-observation probe retains its original two Float64 buffers and exactly 65,536 backing bytes. These are storage/behavior checks, not process-RSS or gameplay-FPS measurements.

The first new-suite attempt found two fixture assumptions: some scheduled frames precede local-predictor readiness, and the repeated-view fixture needed a snapshot after input commands began. The fixtures were corrected to count actual render callbacks and explicitly establish predictor readiness. Production logic did not change in response. A 50-ms RTT fixture also omits an initial echo that would represent 49 ms. The complete passing run above followed those corrections.

Scoped ESLint passed for all six changed files. Prettier formatted the modified TypeScript and `git diff --check` passed. No full-project compiler/build or npm lifecycle hooks were run.

```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run tests/network-metric-retention.test.ts tests/net-prediction.test.ts tests/net-client-lifetime.test.ts tests/net-runtime-metrics.test.ts --pool=threads --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/eslint src/net/metric-samples.ts src/net/client.ts src/net/prediction.ts src/net/slice.ts scripts/online-slice.ts tests/network-metric-retention.test.ts
```

## Exact baseline comparison

A separate native Node v24.22.3 probe imported the unmodified source reference at `5edead7a44c8ccb5a187b22b750ce2bda7715128` and the candidate in separate processes. It hashes every pose in a 1,200-reconciliation predictor trace (3,600 render calls), the existing raw metrics/counters, all wire packets and render views of a 60-second scheduled client trace, and that client's original metric fields/counters. Each trace stays below capacity, testing exact compatibility before intentional eviction.

Both produced:

- Predictor trace SHA-256: `1d8ec9bdb548abb409951c8a59a972b6e2a3d6cdb7207ffe5fbe7e839f288d1c`
- Combined predictor/client trace SHA-256: `5e21e4ed7b8ce7c9a87d7986a32a95b42a8fb146afff6b960c7db76842d4c9f1`
- Predictor visual samples: 3,599; client rendered samples: 3,600; client snapshots: 1,201.

The reproducible probe is retained beside this report as `19-metric-reference.mjs`. Run it with the reference or candidate repository path as its sole argument using `node --no-warnings --experimental-transform-types`. It creates no player files and changes no source.
