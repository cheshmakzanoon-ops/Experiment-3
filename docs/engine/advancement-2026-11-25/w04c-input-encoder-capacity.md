# Wave 4 — exact input encoder capacity

Assignment 21/60; implements network audit finding 2.

## Change and wire layout

`encodeInput` now reserves the exact packet size before writing. Its only source changes are the `CONTROLS_WIRE_BYTES` import and the capacity calculation in `src/net/codec.ts`.

| Existing wire component | Bytes |
| --- | ---: |
| Message tag | 1 |
| Sent timestamp | 4 |
| Snapshot acknowledgement tick | 4 |
| Command count | 1 |
| First sequence and first tick, present only for a nonempty run | 8 |
| Each command's duration | 1 |
| Each command's controls, from `CONTROLS_WIRE_BYTES` | 8 |

Thus the writer reserves **10 bytes for an empty packet**, or **18 + 9 × command count** for a nonempty packet. The calculation uses `1 + CONTROLS_WIRE_BYTES` for each command. The previous reserve was `16 + 8 × command count`.

The existing `writeInputPacket`, `writeControls`, limits, quantization, contiguity checks, unsigned coercion, decoder validation and `ByteWriter.finish` remain unchanged. Each result still owns a distinct output backing buffer. The shared snapshot batching implementation from assignment 12 is untouched.

## Actual baseline byte comparison

The disposable probe imports the real codec and writer modules from both the candidate tree and the supplied baseline tree, `/dev/shm/aeebac160835-engine-baseline`, corresponding to `350119e8ec0606e8c5de5b3ab80df41104025679`. It does not reconstruct or rewrite the baseline encoder. It reuses only the new test's packet fixture construction.

**544 complete packet comparisons passed**, covering every command count 0–16 and 32 variants per count; **48,704 bytes compared**. The fixtures cover every one-to-eight-tick duration, all five boolean control flags, all shift and ERS choices, rear brake, clamping and rounding boundaries, high counters, the last decodable sequence/tick boundaries, and the writer's existing unsigned coercion of values above 32 bits. Decoder results also match for every fixture.

SHA-256 of the concatenated matched packets, in count/variant order:

```text
3e693230425cacde8082d2cb4cfda8675a900fc7c02d48b9ced888ed784ac063
```

Four additional encode-rejection comparisons preserve the command-count limit, sequence gaps, tick gaps and an explicit sequence rollover from `0xffffffff` to zero. Four additional complete-byte/decode comparisons preserve rejection of zero/oversized durations and sequence/tick overflow. For both real encoders, retained packets survive later encodes and source mutation; mutating one returned packet leaves another unchanged.

Local reproduction:

```sh
node --no-warnings --experimental-transform-types /tmp/aeebac160835-engine/w04c-input-encoder-capacity-proof.mjs
```

## Actual writer allocation and growth observations

Instrumentation wraps the existing writer's `reserve` and `finish` methods while invoking their original implementations. It records backing-buffer and DataView identities before and after writes, plus actual `Uint8Array.subarray` and `slice` calls. This observes growth and the returned allocation separately from any elapsed-time benchmark.

The current initial and final capacities both equal the packet length in every row. Every nonempty baseline packet has **one growth**; every current packet has **zero growths and zero growth-copy bytes**.

| Commands | Baseline initial bytes | Baseline final bytes | Packet bytes / current capacity | Baseline bytes copied during growth |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 16 | 16 | 10 | 0 |
| 1 | 24 | 48 | 27 | 24 |
| 2 | 32 | 64 | 36 | 31 |
| 3 | 40 | 80 | 45 | 40 |
| 4 | 48 | 96 | 54 | 48 |
| 5 | 56 | 112 | 63 | 56 |
| 6 | 64 | 128 | 72 | 64 |
| 7 | 72 | 144 | 81 | 72 |
| 8 | 80 | 160 | 90 | 80 |
| 9 | 88 | 176 | 99 | 87 |
| 10 | 96 | 192 | 108 | 96 |
| 11 | 104 | 208 | 117 | 103 |
| 12 | 112 | 224 | 126 | 112 |
| 13 | 120 | 240 | 135 | 120 |
| 14 | 128 | 256 | 144 | 128 |
| 15 | 136 | 272 | 153 | 136 |
| 16 | 144 | 288 | 162 | 144 |

Per nonempty encode, the observed allocation/copy counts are:

| Operation or object | Baseline | Current |
| --- | ---: | ---: |
| Distinct backing buffers, including the returned packet | 3 | 2 |
| Writer DataViews | 2 | 1 |
| Temporary growth-copy subarray views | 1 | 0 |
| Growth copies | 1 | 0 |
| Final `slice` copies into an independent returned packet | 1 | 1 |

Empty packets retain two backing buffers, one DataView and one final copy in both versions, while their initial capacity decreases from 16 to 10 bytes. The final copy always copies the complete packet length. These are observed buffer sizes and operation counts; they do not measure allocator overhead, garbage collection, heap/RSS, frame rate or full-race throughput.

## Focused verification

The new portable `tests/engine-input-encoder-capacity.test.ts` has five cases: full-byte and decoder parity across 544 fixtures; actual writer growth/backing/DataView observations for all allowed counts; retained output ownership; count/contiguity rejection; and duration/overflow validation with unsigned coercion. Its reference uses the previous allocation policy with the unchanged production wire writer. The separate probe above establishes parity against the actual baseline modules.

Direct commands, without package lifecycle hooks:

```sh
./node_modules/.bin/vitest run tests/engine-input-encoder-capacity.test.ts tests/net-codec.test.ts --maxWorkers=1
./node_modules/.bin/eslint src/net/codec.ts tests/engine-input-encoder-capacity.test.ts
```

Result: **2 files, 15 tests passed**; scoped ESLint passed. The new five cases took 151 ms in that focused test run; this is a test-run observation, not an encoder benchmark.

Elapsed-time and throughput measurement remain with wave 7. Root owns the consolidated typecheck/build gates. No packet format, gameplay tuning, authored content, assets, dependencies or other production source files changed in this assignment.

Released files: `src/net/codec.ts` (`encodeInput` capacity/import only), `tests/engine-input-encoder-capacity.test.ts`, and this document.
