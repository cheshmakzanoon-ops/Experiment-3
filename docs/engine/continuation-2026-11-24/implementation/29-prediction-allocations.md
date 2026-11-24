# Agent 29 — ResponseModel temporary-allocation reduction

## Assignment and scope

Agent `/root/w05_a29_prediction_allocations`, wave 5 of the continuation, optimized the numerical response learner used by `LocalCarPredictor`. Only the `ResponseModel.observe` and `ResponseModel.longGain` implementations changed in production. Network metric retention, authoritative-state ownership, integration, smoothing, input delay, clipping bounds, regularization, speed bins and forgetting factors remain unchanged. No model, character, environment, track, calibration, dependency or asset file was edited.

## Problem and implementation

Every successful `longGain` solve previously created two typed-array subviews, a copied coefficient array, a diagonal-index array, two replacement-column arrays and a replacement closure, in addition to the returned gain pair. `observe` also created a three-element input array. The solve runs when authoritative snapshots initialize a prediction.

The implementation reads nine coefficients and three targets into scalar locals. The two Cramer numerators retain the exact multiplication, subtraction and addition order of the previous column-replacement determinants. Each diagonal receives the identical `1e-2` regularization; the singular threshold and finite/clipping behavior are unchanged. The returned tuple is still a new, detached array. Training retains its nested iteration and numerical operation order, selecting already-read throttle/brake scalars instead of indexing a temporary array. Control accessor reads retain their original order.

For a nonsingular observe-and-solve pair, this removes eight explicit temporary object/array/view creation expressions. The returned pair remains. This is a source-level count; V8 can eliminate allocations itself, so it is not a claim of eight measured heap allocations saved on every runtime.

## Source provenance

The complete pre-change `prediction.ts` was captured before implementation and measured once before editing. It is byte-identical to the file subsequently published at commit `360d3de1d910b77e9bdca933f47df8d5bc99a69a`.

- Pre-change full-file SHA-256: `72bd93b11235a10dcf328883e79a2bc627aef1bd9720055bdf3dcebc5df4f8e8`.
- Pre-change ResponseModel section SHA-256: `b25ffa0dbf7a3c686475cc2968e21e0b0dec043f3952dfb554cf23cad94867fe`.
- Candidate section SHA-256: `bef58609f67fcf9cf5323760f73814d64b01a9045946bf25724561be23eef3c7`.
- Candidate complete file SHA-256 at verification: `236f0e9d109377d1831905f39a815b08cae31f0e182331a8507a1430c638f23f`.

The test suite contains a frozen pre-change numerical oracle, with its section fingerprint. The portable benchmark accepts baseline and candidate source paths and extracts/transpiles only the response learner, so unrelated historical networking changes do not influence that comparison.

## Verification

All heavyweight commands used the shared `test.lock`, a 512 MiB Node heap and direct binaries; no npm lifecycle hooks were run.

| Check | Result |
| --- | --- |
| New response-model regression suite | 17 tests passed |
| Existing state-ownership and metric-retention suites | 39 tests passed |
| Existing prediction and real codec/network integration suites | 19 tests passed |
| Combined unique unit test total for this assignment | 75 passed across five suites |
| Scoped ESLint | Passed for the changed source, new test and benchmark |
| Prettier | Changed source, test and benchmark formatted successfully |
| Whitespace check | Passed |

The 17 new cases cover all 20 speed bands, long-stream forgetting, band isolation, nearly singular inputs, gain clipping, signed zero, finite/nonfinite legacy behavior, result ownership and control-accessor read order. They establish exact equality to the frozen implementation, including internal training arrays.

The isolated native Node comparison trained 32 independent models over **131,072 observations** and checked **786,432 gain/yaw queries**. `assert.deepStrictEqual` compared all results, distinguishing signed zero; internal numerical state also matched. The binary Float64 trace SHA-256 is `830a8ede34d2dbe5312fa7d791a1782afb1596875f03ed742d7c4dd329effdf0`.

The existing full-predictor differential probe was also rerun against the original continuation baseline `5edead7a44c8ccb5a187b22b750ce2bda7715128`. All **4,096 reconciliations, 97,536 predicted-pose reads, 12,288 renders and 4,096 authoritative reads** matched exactly across 32 seeded streams, including producer and returned-object mutation. Trace SHA-256: `a554aac2ef44b44f6728e91b2e2d5ef65c974d0d91aa235438225f196b924e3f`. This verifies compatibility of the final response learner together with earlier ownership and metric changes. It does not add additional unit-test cases to the 75 count above.

No standalone full-repository TypeScript compile was run by this agent; root owns the full integration compile.

## Measured work and CPU

`countContainerCalls` instruments the two relevant native factory methods outside the timed section. In 10,000 observe/solve operations:

| Native factory | Before | After |
| --- | ---: | ---: |
| `Array.from` | 10,000 | 0 |
| `Float64Array.prototype.subarray` | 20,000 | 0 |

Array literals and closures are not counted by this instrumentation. Their removal is visible in the source diff.

The microbenchmark used Node v24.22.3, fixed seeded inputs, 100,000 warm-up operations, then 250,000 measured operations. Each sample ran in a fresh sequential child process; baseline/candidate order alternated. Each side has five samples per run, and all sample checksums are exactly equal.

| Median time for 250,000 operations | Before | After |
| --- | ---: | ---: |
| First run: training plus gain/yaw query | 191.90 ms | 18.08 ms |
| First run: gain/yaw query only | 168.22 ms | 13.91 ms |
| Final run with allocation-call evidence: training plus gain/yaw query | 184.34 ms | 18.01 ms |
| Final run with allocation-call evidence: gain/yaw query only | 178.01 ms | 11.33 ms |

Both complete five-sample runs are retained. The first run includes a candidate training/query outlier of **95.57 ms** and the final run includes a baseline query-only outlier of **265.73 ms**. No sample was discarded. The initial single baseline measurement taken before editing is also retained separately (223.05 ms combined, 190.54 ms query-only).

This is a substantial relative reduction in a small helper. The final combined median corresponds to approximately 0.74 microseconds per operation before and 0.07 microseconds after on this host. It is **not a demonstrated FPS improvement, total-client CPU improvement or heap-allocation profile**. Normal snapshot rates perform far fewer than 250,000 solves per second.

## Reproduction

From the repository root, save the reference source without changing the checkout:

```sh
git show 360d3de1d910b77e9bdca933f47df8d5bc99a69a:src/net/prediction.ts > /tmp/response-model-before.ts
NODE_OPTIONS=--max-old-space-size=512 node scripts/prediction-response-benchmark.mjs /tmp/response-model-before.ts src/net/prediction.ts /tmp/response-benchmark.json
NODE_OPTIONS=--max-old-space-size=512 node_modules/.bin/vitest run --maxWorkers=1 tests/prediction-response-allocation.test.ts tests/prediction-state-ownership.test.ts tests/network-metric-retention.test.ts tests/net-prediction.test.ts tests/engine-network-integration.test.ts
NODE_OPTIONS=--max-old-space-size=512 node --experimental-transform-types docs/engine/continuation-2026-11-24/implementation/24-prediction-ownership-comparison.mjs BASELINE_CHECKOUT CANDIDATE_CHECKOUT /tmp/full-predictor-comparison.json
```

Use a shared lock if other verification processes are running. The full-predictor probe expects the original continuation baseline checkout; the response-only benchmark uses the nearer published pre-optimization source above.

## Deliverables and ownership release

- `src/net/prediction.ts`: ResponseModel-only optimization.
- `tests/prediction-response-allocation.test.ts`: 17 numerical/ownership compatibility cases.
- `scripts/prediction-response-benchmark.mjs`: portable exact comparison, native factory-call counts and five-sample CPU microbenchmark.
- `29-response-benchmark.json`: first complete timing sample set.
- `29-response-benchmark-final.json`: final complete sample set plus factory-call evidence.
- `29-initial-baseline.json`: initial baseline measurement before the source edit.
- `29-full-predictor-comparison.json`: full prediction trace evidence.

No files were staged, committed or pushed by this agent. Production file ownership is released to root.
