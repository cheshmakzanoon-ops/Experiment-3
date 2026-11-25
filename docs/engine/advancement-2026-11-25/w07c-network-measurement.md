# Wave 7 — network encoder measurement

Assignment 39/60. **Completed one canonical, exclusively reserved measurement run.** All ten cases passed actual-source equivalence checks. The shared compute reservation was released immediately after successful execution. Twelve-recipient snapshots improved consistently in this run; two recipients regressed and four recipients showed no reliable gain. All cases, paired samples and allocation tradeoffs are preserved.

## Released evidence

- `scripts/engine-advancement/measure-network.mjs`: reproducible actual-source encoder workloads, allocation observations, packet/ownership preflight, and shared paired-harness integration.
- `evidence/network-measurement-preflight.json`: compact source manifests, hashes, full allocation observations, and untimed paired evidence; 131,154 bytes of JSON.
- `evidence/network-measurement.json`: the complete canonical measurement, including every warmup/measured pair, source/runtime identity, packet hashes, ownership checks and allocation observations; 282,456 bytes of JSON. Neither report stores raw packet megabytes.
- This report: absolute and paired results, source identity, measured scope, allocation tradeoffs, limitations and the proposed follow-up.

The existing W02F, W04C, W04F, W05B and W06A reports informed the workload. No production source, model, character, environment, asset, dependency, tuning or Git state was changed by this assignment.

## Verified source identity and checks

The original baseline is the actual detached tree `/dev/shm/aeebac160835-engine-baseline`, pinned to `350119e8ec0606e8c5de5b3ab80df41104025679`. Both the successful preflight and canonical measurement used candidate `/tmp/aeebac160835-engine/Experiment-3` at **`6a1c76fae3736e4d814ab6d0a354f6837320731c`**. Both reports identify this exact candidate. The result does not describe an unmeasured later tree or a future batching-threshold change.

Each side has a complete **66-file manifest** built by `prepareModule`, including exact source bytes, dependency lock, TypeScript configuration and an additional server source identity for the selected broadcast policy. The actual native TypeScript encoder and writer modules are imported from each separate tree. The baseline encoder is not reimplemented. Source stability, expected baseline, matching dependency lock and workload/helper hashes are enforced by the shared harness.

The untimed preflight passed **768 complete packet comparisons, 317,952 compared bytes and matching actual decoder results** across ten cases and 32 seeded fixture variants per case. Snapshot checks additionally verify every recipient header, rotated owning-car FULL position and car ID/flag. Ownership probes verify distinct complete output buffers, unchanged captured inputs, retained packets surviving subsequent calls, source mutation isolation, and prepared FULL/compact mutation isolation on the candidate batch path.

Each of the ten cases then passed two shared-harness smoke pairs in **AB then BA** order with matching seeds and independently generated fixtures. These compare another 1,536 complete final-ring packets outside the workload callback. Retained reference packets remain unchanged and all packet buffers are independently owned. In the preparation report, all workload elapsed durations and median fields are **null**; `exclusiveCompute` and timing validity are **false**. Setup/import/observation bookkeeping durations emitted by the helper are not encoder performance results.

The benchmark script passed scoped ESLint and Prettier checks before the reserved run. A separate guard check confirmed that an existing evidence file is refused before any workload starts. No full compiler/build/browser run or lifecycle hook was invoked.

## Canonical timing results

The reserved run completed on 2026-11-25, with evidence timestamp `2026-11-25T08:59:52.205Z`, using Node **v24.22.3**, Linux x64 and the reported **AMD EPYC 9V74 80-Core Processor**. It used the cooperative timing lock plus explicit coordinator confirmation that the other active agents were restricted to reading/editing. This controls participating local workers, not unrelated host scheduling or runtime variation.

Every case used **8,192 operations per side/sample**, **three warmup pairs** and **nine measured pairs**, with matched seeds and alternating AB/BA order. There was **one canonical execution**, no calibration run, no rerun, no outlier removal and no omitted case. All 120 warmup/measured pairs passed equivalence; every source-stability check passed. The full report repeats the actual packet/decode/ownership/allocation preflight before paired work.

The two timing columns are independent medians of the nine per-operation samples. **Paired change** is the median of `100 × (current / baseline − 1)` within each matched measured pair; negative means less time, positive means more time. It is not the ratio of the independent median columns. **Faster pairs** counts how often the candidate took less time in the nine matched pairs.

| Case | Baseline median, µs/operation | Current median, µs/operation | Paired median change | Faster pairs | Interpretation |
| --- | ---: | ---: | ---: | ---: | --- |
| Snapshot, 0 recipients | 0.0019 | 0.0021 | +6.59% | 2/9 | No encoding occurs; loop/branch control only |
| Snapshot, 1 recipient | 5.103 | 5.196 | −3.27% | 5/9 | Unchanged ordinary encoder; mixed control result |
| Snapshot, 2 recipients | 12.298 | 14.716 | **+29.15%** | 2/9 | Measured regression with added allocation capacity |
| Snapshot, 4 recipients | 23.878 | 23.812 | +2.63% | 4/9 | No reliable gain; added allocation capacity |
| Snapshot, 12 recipients | 80.436 | 50.836 | **−31.17%** | **9/9** | Consistent improvement in this workload |
| Input, 0 commands | 0.646 | 0.577 | −4.90% | 7/9 | Small-work control; modest paired difference |
| Input, 1 command | 1.038 | 0.575 | −42.16% | 8/9 | Lower typical cost with one slower pair |
| Input, 4 commands | 1.396 | 0.863 | −38.14% | 9/9 | Consistent improvement in this workload |
| Input, 12 commands | 3.036 | 2.327 | −23.37% | 6/9 | Lower paired median, mixed individual pairs |
| Input, 16 commands | 4.159 | 4.839 | −17.31% | 8/9 | Mixed aggregation; no firm maximum-batch speed conclusion |

For twelve-recipient snapshots, the **median within-pair speedup is 1.453×**, with all nine pair ratios above one and an observed range of **1.214×–1.976×**. The scalar car serialization count drops from 144 to 12, while total backing capacity falls only from 13,908 to 13,764 bytes and buffer count rises from 24 to 27. This supports the scoped serialization benefit, not a broad allocation or game-frame claim.

Two recipients have a median within-pair speedup of **0.774×**, and seven of nine pairs are slower. Four recipients have a median ratio of **0.974×**, with four faster and five slower pairs and a wide **0.722×–1.513×** range. Their reduced car serialization does not offset preparation cost reliably in this run. The zero-recipient path does no encoding, so its very small loop/branch durations do not support a networking comparison. The single-recipient encoder is unchanged, and its mixed results likewise establish no improvement.

Input timing dispersion is material. In particular, the sixteen-command case has eight faster paired samples and a paired median ratio of **1.209×**, yet its independent medians move from **4.159 to 4.839 µs**. Its paired ratio range is **0.752×–1.886×**, and batch durations span **23.336–82.087 ms** at baseline versus **19.401–57.151 ms** currently. Both statistics are preserved; this report does not turn the favorable paired statistic into an unqualified maximum-batch speed claim. The twelve-command case also has mixed pairs, ranging from **0.446× to 1.772×**. This run does not identify the cause of timing variation or measure garbage collection.

### Follow-up decision

The measured two-recipient regression and four-recipient lack of a reliable gain, together with their increased allocated capacity, support **retaining the ordinary encoder for those measured small groups**. A follow-up should measure the crossover, including intermediate group sizes, before choosing a general threshold; this run does not determine the optimal threshold for unmeasured recipient counts. The coordinator will assign the threshold implementation/review after preserving this original script and evidence. This assignment makes no production or workload change in response to its measurements.

## Actual encoder workloads

| Workload           | Cases                                 | Work inside each operation                                                                                                                                                                                                                                                                                              |
| ------------------ | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot broadcast | 12 cars; 0, 1, 2, 4 and 12 recipients | Baseline calls actual `encodeSnapshot` per recipient with the owning FULL flag set/restored. Current uses the same ordinary path at one recipient; at multiple recipients it calls actual `prepareSnapshotCars` once inside every broadcast and then every `encodePreparedSnapshot`. Zero recipients skip all encoding. |
| Input encoding     | 0, 1, 4, 12 and 16 commands           | Actual complete `encodeInput`, including validation, scalar serialization, writer allocation, any growth and the final independently owned `finish()` copy.                                                                                                                                                             |

The snapshot fixture ring contains 32 varied boundaries, twelve cars, rotated ownership, arbitrary valid car ID order, normalized yaw rotations, varied positions, velocities and controls, and recipient-specific ACK/slack/missing/echo/hold headers with quantization/clamping boundaries. Inputs use valid contiguous sequence/tick runs, ordinary two-tick commands and one-to-eight-tick durations, all discrete control flag combinations, a small resend window, the configured twelve-command redundancy window and the maximum sixteen-command packet.

Fixture/header construction, world capture, queue bookkeeping, transport, physics and rendering are excluded. The measured callback includes all allocations and copies inside the actual production encoders, plus the same bounded output-reference ring writes on both sides. Preparation is never hoisted out of a multi-recipient broadcast. Complete hashing, decode checks, allocation instrumentation, report I/O and retained-output validation run outside timing. The ring retains the final output for each of the 32 repeated fixtures, rather than every historical packet.

## Observed snapshot allocation tradeoff

The values below are actual untimed observations per broadcast, including each writer backing buffer and each final independently owned packet. All packets contain 503 bytes. The ordinary writer reserves 656 bytes. At multiple recipients, the current preparation allocates a 612-byte writer buffer, its 612-byte FULL finish output and a separate 468-byte compact buffer, followed by an exact 503-byte writer and 503-byte owned output for each recipient.

| Recipients | Car serializations, baseline → current | Backing buffers, baseline → current | Total allocated backing capacity, baseline → current | Current minus baseline |
| ---------: | -------------------------------------: | ----------------------------------: | ---------------------------------------------------: | ---------------------: |
|          0 |                                  0 → 0 |                               0 → 0 |                                          0 → 0 bytes |                0 bytes |
|          1 |                                12 → 12 |                               2 → 2 |                                  1,159 → 1,159 bytes |                0 bytes |
|          2 |                                24 → 12 |                               4 → 7 |                                  2,318 → 3,704 bytes |       **+1,386 bytes** |
|          4 |                                48 → 12 |                              8 → 11 |                                  4,636 → 5,716 bytes |       **+1,080 bytes** |
|         12 |                               144 → 12 |                             24 → 27 |                                13,908 → 13,764 bytes |             −144 bytes |

No snapshot writer grows in these cases. Sharing removes repeated car serialization, but adds three temporary backing buffers and can allocate more total backing bytes at small recipient counts. The twelve-recipient capacity reduction is only 144 bytes, despite the large serialization reduction. These observations must accompany any eventual speed result; they do not establish reduced overall heap use or garbage collection.

Car serialization counts are cross-checked from observed actual writer `f32` calls: four per serialized car and one per recipient header. Primitive method calls and bulk copy/view counts are recorded separately in the JSON.

## Observed input allocation change

| Commands | Final packet bytes | Backing buffers, baseline → current | Total allocated backing capacity, baseline → current | Growth events, baseline → current |
| -------: | -----------------: | ----------------------------------: | ---------------------------------------------------: | --------------------------------: |
|        0 |                 10 |                               2 → 2 |                                        26 → 20 bytes |                             0 → 0 |
|        1 |                 27 |                               3 → 2 |                                        99 → 54 bytes |                             1 → 0 |
|        4 |                 54 |                               3 → 2 |                                      198 → 108 bytes |                             1 → 0 |
|       12 |                126 |                               3 → 2 |                                      462 → 252 bytes |                             1 → 0 |
|       16 |                162 |                               3 → 2 |                                      594 → 324 bytes |                             1 → 0 |

The baseline totals include both its initial and grown writer buffers plus the returned output. The candidate uses an exact writer buffer and the same required independent final output copy. The unchanged empty-packet path is retained as a small-work control even though its reserve shrinks.

## Allocation method and limits

A separate synchronous probe wraps the real writer prototype's `reserve`, `finish` and scalar methods while invoking every original implementation. It observes backing-buffer identities and actual capacities before/after growth, writer instances and DataViews, returned slice storage, primitive writes and growth-copy bytes. Temporary `Uint8Array.subarray`, `slice` and `set` observations record view/copy counts. All methods are restored in `finally` before paired workloads run.

Prepared FULL and compact storage are explicitly observed from the production preparation return value. FULL is the preparation writer's already-recorded finish output and is deduplicated; it is not counted twice. No global `ArrayBuffer` constructor proxy is used. This captures typed-array-owned storage and species-created slices through their actual buffer identities.

Capacity totals are cumulative allocated backing bytes per operation. They are not peak live memory, allocator overhead, all JavaScript heap allocation, garbage collection, RSS, transport overhead or bytes physically transmitted. Counts of known writer/DataView/typed-array/subarray/prepared objects are scoped to the reviewed encoder paths. Zero-recipient timing, when later enabled, will measure only the shared fixture-loop/branch overhead and cannot imply a networking gain.

## Reproduction

A smoke command uses a new output path; existing outputs are never overwritten:

```sh
node --no-warnings --experimental-transform-types scripts/engine-advancement/measure-network.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --expected-current 6a1c76fae3736e4d814ab6d0a354f6837320731c \
  --output /tmp/network-measurement-preflight-reproduction.json
```

The following is the exact canonical timed invocation, preserved as provenance. The output now exists and the script will refuse to overwrite it. A future reproduction requires a fresh output path, the same pinned source or an explicitly identified new candidate, and a separate exclusive-compute reservation:

```sh
node --no-warnings --experimental-transform-types scripts/engine-advancement/measure-network.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --expected-current 6a1c76fae3736e4d814ab6d0a354f6837320731c \
  --measure --exclusive \
  --lock /tmp/aeebac160835-engine-wave7.lock \
  --output /tmp/aeebac160835-engine/Experiment-3/docs/engine/advancement-2026-11-25/evidence/network-measurement.json
```

The default measurement configuration is **8,192 operations per side/sample, three warmup pairs and nine measured pairs across all ten cases**. Seeds match within each pair and order alternates AB/BA. Every warmup/sample, order, seed, duration, unit denominator, complete output-ring checksum and equality result remains in the JSON; there is no outlier removal, case filtering or hidden resampling. An explicit `--iterations` override must be a multiple of 32 within the bounded accepted range and is recorded by the harness.

The canonical run completed successfully and its cooperative timing lock was released before the next worker began measurement. No additional measurement is needed for this report. All zero/single-recipient controls, slower/no-gain cases and allocation costs remain visible. Results are local synchronous encoder observations; they do not establish FPS, whole-game speed, browser/device performance, network latency, peak heap use or garbage-collection savings.
