# Worker 39 / Wave 7: network snapshot and control measurements

The committed snapshot batching change reduced twelve-recipient capture and rank operations from **144 to 12 per batch**, with identical normal packet bytes. Its measured normal dispatch improvement was modest: median batch time changed from **66.925 µs to 60.080 µs**, and the median of the ten paired speed ratios was **1.109×**. There was no demonstrated one-recipient throughput benefit, and the zero-recipient path acquired fixed dispatch overhead.

The committed scalar control quantizer preserved every checked field and wire byte across **283,305 inputs**, while reducing measured median normalization-plus-output-consumption time from **971.10 ns to 138.47 ns per call**. The paired median speed ratio was **7.146×**. The eight removed byte-path temporaries are a source-level creation-path inventory; this run does not measure heap allocations, bytes saved, GC time, FPS, or whole-engine throughput.

## Reproduction and evidence

Run from the repository root with existing dependencies installed:

```sh
node scripts/bench/engine-followup-network.mjs \
  --baseline 1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb \
  --current f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6 \
  --output /tmp/w07c-network-reproduction.json
```

The runner uses read-only `git show`/`git rev-parse` operations, bundles the two committed dependency graphs through esbuild, and runs one child with `--expose-gc --max-old-space-size=768`. It does not use native TypeScript transforms, install dependencies, invoke npm hooks, or modify production source. Its optional `--repo`, `--work-dir`, `--pairs`, `--warmups`, `--snapshot-iterations`, and `--control-iterations` arguments make the workload explicit. Defaults reproduce the reported workload.

- [Runner](../../../../scripts/bench/engine-followup-network.mjs)
- [Workload and correctness checks](../../../../scripts/bench/engine-followup-network-workload.mjs)
- [Raw samples, environment, source identities, and assertions](w07c-network.json)
- [Full committed dependency manifest](w07c-network.sources.json)

The raw `samples` arrays retain all ten measured pairs, their order, elapsed milliseconds, and output-consumption checksums. No measured samples were discarded. A small preliminary execution validated the harness; its timings are excluded from this report and the published measurement data.

## Environment and source provenance

The measured child ran **2026-11-25 03:05:05.720–03:06:26.404 UTC**. Environment: Node **v24.22.3**, V8 **13.6.233.17-node.63**, Linux **6.18.57**, x64, AMD EPYC 9V74 80-Core Processor, nine visible/available logical CPUs. esbuild **0.25.12** targeted Node 22 syntax; the execution runtime was Node 24. TypeScript **5.9.3** was used only to inspect source declarations and assert the unchanged codec/capture bodies. The old-generation heap bound was 768 MiB; V8 reported a total heap size limit of **1,006,632,960 bytes**. The optional cgroup limit files were unavailable.

This work held the team's exclusive compute lease during the measured run. The host remains shared infrastructure; this is not a claim of isolated physical hardware or fixed CPU frequency.

| Source file | Baseline Git blob | Current Git blob |
| --- | --- | --- |
| `src/net/server.ts` | `83a04e11c1b2578b8938b41f77436ad0db4731c9` | `40b98e5bca01402d54ba4b55e386e4f62aebb40e` |
| `src/net/input.ts` | `031d159cf65ec861a564601d8696a0c209533d23` | `b5dcfa89afb9263eca30c68f3dd1673f5dc434d2` |
| `src/net/authority.ts` | `4775000a66deaac72d167ae7a88536ddf03cb28c` | `1612dbb8eff4cf5ff4298e798040389d85629f29` |
| `src/net/bytes.ts` | `e9d7aaa5d17711ae3b62ec331459719610d44013` | Same |
| `src/net/codec.ts` | `f3ba732b18fbe3bc4c7282a769b862b7a5a7213a` | Same |
| `src/net/snapshot.ts` | `5404c60b47e1c2670ee4f1de3245dcb759839b3b` | Same |

The runner loaded **280 committed modules** across both trees. The ordered manifest SHA-256 is `ac42f3969a6ca93555ac73c388b6de5a89712844c830454d350f6b899976a976`. Each manifest row records role, path, Git blob, and content SHA-256. The main JSON also records runner, workload, and bundle SHA-256 values.

Although `authority.ts` has other changes between the commits, AST extraction confirms its `capture`, `acceleration`, `clearContacts`, and `tick` getter source declarations are identical. `writeControls` and `readControls` are also identical. The complete `bytes.ts`, `codec.ts`, and `snapshot.ts` contents are identical. These assertions run before measurement and fail if the comparison assumptions no longer hold.

## Snapshot fixture: what is real and what is synthetic

Each fixture constructs a real committed `RaceServer`, uses a minimal inert event loop, and supplies an `AuthoritativeWorld` object with the actual committed prototype. It avoids constructing a physics world or joining a live session. The data represent a twelve-car boundary: varied positions, quaternion orientations, velocities, angular velocities, acceleration history, lap counts, reversed race order, controls, gears, RPM, progress, pit/retirement/finish/contact/AI/DRS/ghost flags, acknowledgements, slack, and echo times. The field values are deterministic test data, not a captured live race.

The timed path executes the real `RaceServer.snapshot()`, current `sendData()`, `AuthoritativeWorld.capture()`, `acceleration()`, `clearContacts()`, the actual tick getter, the real `race.order.indexOf` rank lookup, actual `ServerInputQueue.takeSlack()`, and the actual snapshot encoder, writer, and independent output-buffer creation. No capture or ranking work is replaced by a no-op. Fixture/corpus construction, module loading, correctness checks, and instrumented operation counters are outside timing.

Each synthetic transport consumes packet length and three packet bytes into a checksum and updates counts synchronously. It does not retain timed packets, decode them, invoke network callbacks, or send real traffic. The same sink runs for both variants. Only two twelve-car timing fixtures are retained at a time.

Normal timing starts after one initial snapshot has consumed fixture contacts, events, missing-input windows, and slack. The field stays fixed; physics stepping is excluded. Correctness checks separately exercise initial contacts/events, another changed field boundary, retained packets, and callback reentry. This separation avoids crediting fixture construction or instrumentation to either implementation.

## Snapshot bytes, flags, ownership, and counts

The first batch's observed call counts were:

| Recipients | Cars | Baseline captures | Current captures | Baseline rank lookups | Current rank lookups | Acceleration calls, each variant |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 12 | 0 | 0 | 0 | 0 | 0 |
| 1 | 12 | 12 | 12 | 12 | 12 | 1 |
| 4 | 12 | 48 | 12 | 48 | 12 | 4 |
| 12 | 12 | 144 | 12 | 144 | 12 | 12 |

Both variants clear contact latches once per batch. Each normal datagram is **503 bytes**, and each first-boundary reliable event packet is **94 bytes**. The harness compares complete packet byte arrays and channels for two batches in each recipient case. All matched. The second batch changes tick, race time, and car positions and confirms that consumed contacts do not recur.

For every recipient, decoding with the current production codec yields exactly one `FULL` car: that recipient's own car. The twelve-recipient case owns **24 distinct snapshot backing buffers across two batches**. Retained packets stay unchanged when capture scratch is reused. Mutating one retained packet does not change another packet or another batch. The other recipient counts pass the same checks; zero recipients generate no packets.

A separate current-only callback test checks the intentionally changed reentrant behavior against the first normal baseline packet. The first transport callback changes tick and state, records new input/events/contacts, corrupts its own packet, and asks for a nested snapshot. The follow-up callback again asks for a snapshot and introduces a deferred contact/event/missing-input window. The first dispatch is bounded to **two batches**, totaling **24 capture and rank calls**, while the healthy recipient sees ticks **120 then 126** in batch order. Its original packet is byte-identical to the baseline packet despite the first callback's state and buffer mutation. The later contact, event, and missing count remain available for the next scheduled snapshot.

Operation counts establish the removed repeated work. They do not imply a twelvefold dispatch speedup: each recipient still requires a complete encode and independent packet, and the current path also performs ownership and failure-containment work.

## Snapshot timing results

Each variant received three full-iteration warmup runs, followed by ten measured pairs. Pair order alternated baseline/current and current/baseline. Explicit GC occurred before each measured member, outside timing; any ordinary GC during a timed loop remained included. Every pair's output checksum agreed.

| Recipients | Batches per sample | Baseline ns/batch, median [min–max] | Current ns/batch, median [min–max] | Paired speed ratio, median [min–max] |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 400,000 | 25.84 [24.53–42.16] | 84.93 [83.26–88.36] | 0.307× [0.280–0.498] |
| 1 | 80,000 | 5,644.74 [5,208.53–6,539.28] | 5,710.87 [5,144.42–6,350.04] | 0.983× [0.851–1.116] |
| 4 | 40,000 | 21,990.49 [20,888.55–26,569.13] | 21,102.00 [19,585.67–24,175.09] | 1.059× [0.904–1.298] |
| 12 | 20,000 | 66,925.04 [59,793.07–71,526.77] | 60,079.87 [55,994.28–70,215.81] | 1.109× [0.894–1.151] |

The paired ratio is the median of `baseline_ms / current_ms` for each pair, not the ratio of the two independent timing medians. A ratio above one favors the current implementation. Min/max values are the observed sample range, not confidence intervals.

The twelve-recipient paired latency reduction has a median of **9.79%**; nine of ten pairs favor current, with one pair showing an **11.85% increase**. Four recipients have a **5.57%** paired median reduction and seven of ten favorable pairs. At one recipient, the capture count is unchanged and the paired median is **1.70% slower**, with overlapping ranges and only four favorable pairs. The zero-recipient path does no capture or encoding; its median increases by approximately **59 ns**, exposing the fixed batch/ownership bookkeeping. This report retains these regressions and variability rather than applying the large-field result to every case.

Across the ten measured samples per variant, the suite times 4,000,000 zero-recipient dispatches, 800,000 one-recipient dispatches, 400,000 four-recipient dispatches, and 200,000 twelve-recipient dispatches. The latter three produce 800,000, 1,600,000, and 2,400,000 timed datagrams respectively, in addition to warmups and initial latch-consumption snapshots.

## Control quantization equivalence and source allocation inventory

The timing corpus contains **16,384** deterministic mixed controls from unsigned-32-bit LCG seed `0x65f03a19`. Analog inputs include finite values outside the normal clamp range; ERS and flag values vary periodically. The timed workload reuses this corpus, consumes every returned field, and does not retain the result objects. Corpus construction is excluded from timing.

The finite corpus is checked before timing. Exhaustive wire-code/rounding and malformed-runtime probes run after timing so their type feedback does not distort the normal numeric workload. The final correctness pass covers:

- 16,384 seeded mixed-control values.
- 266,726 values spanning every steering, pedal, and rider-lean wire code, plus the exact rounding boundaries and values immediately to either side.
- 195 non-finite, coercible/malformed, truthy-flag, and absent-optional-field cases.
- Twelve additional BigInt/Symbol inputs that correctly throw `TypeError` in both quantizers and the current writer.

For each of the **283,305 successfully encoded cases**, the baseline result and current result match the current `writeControls`/`readControls` values field by field using `Object.is`, including zero signs. Re-encoding the current result preserves every byte, and baseline/current writers produce identical bytes. Returned field order and independent result ownership also match the contract. The concatenated **2,266,440 wire bytes** have SHA-256:

```text
3177aeb3d9b6e3846e3c2a7ef071d879dc9e39dfd94d2dee76381f383240bad4
```

For the ordinary baseline `quantizeControls()` path with an eight-byte writer capacity, the source-level temporary creation inventory is:

| Creation | Count |
| --- | ---: |
| `ByteWriter` wrapper | 1 |
| Writer `Uint8Array(8)` view and backing `ArrayBuffer` | 2 |
| Writer `DataView` | 1 |
| `finish().slice()` result view and its backing `ArrayBuffer` | 2 |
| `ByteReader` wrapper | 1 |
| Reader `DataView` | 1 |
| **Temporary byte-path objects** | **8** |

Eight-byte capacity exactly accommodates the wire value, so this path does not grow the writer. Both implementations create a returned controls object at source level. Current performs scalar normalization directly and creates **zero temporary byte-storage objects** on that path. This inventory describes source/spec-level object creation; JIT escape analysis and backing-store implementation can change actual runtime allocation. No heap-allocation instrumentation or inferred bytes-saved estimate is presented.

## Control timing results

Each sample performs **524,288 calls** (32 passes over the corpus), with three warmups per variant and ten alternating measured pairs. This is **5,242,880 measured calls per variant** plus 1,572,864 warmup calls. Each call includes identical arithmetic consumption of every returned field. All pairs produce the same checksum, **1,860,965.1201752236**.

| Measure | Median | Observed min–max |
| --- | ---: | ---: |
| Baseline ns/call including output consumption | 971.10 | 931.75–1,281.83 |
| Current ns/call including output consumption | 138.47 | 131.08–155.20 |
| Paired speed ratio | 7.146× | 6.184–8.831× |
| Paired latency reduction | 86.00% | 83.83–88.68% |

All ten control pairs favor current. These values measure the scalar normalization call plus its common checksum sink on the recorded Node/V8 environment. They do not establish an equivalent improvement in client frame time, server tick time, or networking throughput.

## Validation and limits

The finalized scripts passed `node --check`, a complete short harness execution, the full recorded run, and focused ESLint:

```sh
node node_modules/eslint/bin/eslint.js \
  scripts/bench/engine-followup-network.mjs \
  scripts/bench/engine-followup-network-workload.mjs
```

The relevant established contracts are documented by [snapshot lifetime](../../../../tests/engine-server-snapshot-lifetime.test.ts), [control quantization](../../../../tests/engine-control-quantization.test.ts), and [network composition](../../../../tests/engine-network-composition.test.ts). This measurement worker read those tests and rechecked the stated byte/ownership/quantization properties in the harness; it did not rerun broad tests, native browser gates, or physics validation.

This is a one-process, one-host microbenchmark. There is no real socket transport, network impairment, packet delivery latency, rendering, browser runtime, physics stepping, or live race workload. Normal timing does not exercise reentrant callbacks or transport faults. The current server includes safety/ownership work alongside batching, so the timing difference cannot be assigned exclusively to saved capture/rank operations. Raw ranges show real variability and support only the scope and environment stated here. No production code, authored models, environments, characters, assets, or vehicle tuning were changed for this evidence.
