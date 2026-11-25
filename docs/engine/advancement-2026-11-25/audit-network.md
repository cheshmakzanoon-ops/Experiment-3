# Network advancement audit — 2026-11-25

Baseline: `350119e8ec0606e8c5de5b3ab80df41104025679`. Read-only production audit of `src/net`; no authored content, tuning, dependencies, or production files changed. Previous shift-edge, bounded history/metrics, ownership, snapshot capture, and transport lifetime fixes are present and are not counted again below.

## Prioritized independent implementation scopes

| Priority | Scope | Concrete outcome |
| --- | --- | --- |
| P2 correctness | Discipline the remote render clock during latency drift | Prevent a valid stream from making a moving remote visibly rewind when the clock's sliding-window anchor expires. |
| P2 cost, smallest change | Correct input encoder capacity | Remove one buffer growth and copy from every nonempty ordinary input packet, preserving all packet bytes. |
| P2 cost, larger change | Serialize shared snapshot car bytes once per batch | Remove repeated car quantization across recipients while retaining distinct packet ownership and exact bytes. |

## 1. A latency increase makes the remote render clock jump backward

**Evidence:** `src/net/interpolation.ts:17–25` instantly replaces the offset with the maximum of its last 40 observations. `JitterBuffer.update` limits its own adjustment to half a tick (`:182–188`), but does not constrain this offset discontinuity. `RaceClient.view` uses their difference directly (`src/net/client.ts:520–524`). Ordinary valid, monotonically increasing snapshot ticks can therefore produce a decreasing render tick.

**Executed reproduction:** Real `RaceClient` timers, `EventLoop`, `NetworkSimulator`, control/snapshot encoding and decoding; two cars with valid matching grid identity. Deliver snapshots every 50 ms, with the remote moving at constant 20 m/s. Change only the server endpoint's one-way latency from 50 to 200 ms at snapshot 45, leaving loss/jitter/reorder/duplicate at zero. At snapshot 84 the last old low-latency anchor leaves the window:

| Consecutive rendered frames | Local time (ms) | Remote tick | Remote Z (m) |
| --- | ---: | ---: | ---: |
| Before anchor expiry | 4385.333333333334 | 488.74 | 81.45666666666668 |
| After anchor expiry | 4402 | 472.24000000000007 | 78.70666666666668 |

The car moves **backward 2.75 m in one 60 Hz frame**; render time regresses **16.5 ticks / 137.5 ms**. Both samples are classified `interpolated`. All 120 snapshots are accepted, `invalidMessages === 0`, and the client remains in `race`. This is an application of the configured link model, not an invalid clock argument or direct invocation of a private method.

**Implementation boundary:** Add a bounded clock/render-time discipline in `interpolation.ts` and its `RaceClient` integration. Keep the raw arrival-time estimator available for input scheduling and network measurements; a render-clock slew should not inadvertently make commands late. A render clock may temporarily slow or hold to rebuild interpolation headroom. It must converge after both latency increases and decreases without an unbounded accumulated lag. Simply applying `max(previous, estimate)` everywhere can retain a bad clock offset or disturb command scheduling; define elapsed-time and correction-rate behavior explicitly.

**Acceptance:** Timer-driven regression above, downward latency steps, gradual drift, ordinary jitter, a one-way outage and recovery, and a nonzero/negative client clock offset. Require monotonic rendered remote ticks, bounded convergence/headroom, no permanent excessive interpolation delay, and unchanged server/input packet contents for a fixed control sequence. Existing clean-link prediction/interpolation thresholds should remain valid. No authoritative physics or packet format changes are needed.

## 2. Every nonempty input packet grows an undersized writer

**Evidence:** `src/net/codec.ts:29–32` constructs `ByteWriter(16 + commands.length * 8)`. The actual v3 layout in `src/net/input.ts:413–430` is 10 bytes for an empty packet; otherwise **18 + 9 × command count**: message tag, timestamp/ACK/count, initial sequence/tick, and one duration byte plus eight control bytes per command. Thus every nonempty packet exceeds its initial capacity. `ByteWriter.reserve` allocates/copies during growth (`src/net/bytes.ts:14–22`), then `finish` copies again (`:82–84`). `RaceClient.sendInputs` takes this path at 30 Hz (`src/net/client.ts:427–441`).

Observed by wrapping the existing writer's reserve method in a disposable Node process:

| Commands | Initial capacity | Packet bytes | Growths | Bytes copied during growth |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 16 | 10 | 0 | 0 |
| 1 | 24 | 27 | 1 | 24 |
| 2 | 32 | 36 | 1 | 31 |
| 6 | 64 | 72 | 1 | 64 |
| 12 | 112 | 126 | 1 | 112 |
| 16 | 144 | 162 | 1 | 144 |

**Implementation boundary:** Correct the capacity calculation using `CONTROLS_WIRE_BYTES` and the actual empty/nonempty header sizes. Keep `ByteWriter.finish` ownership unchanged for this small scope. This removes the growing backing buffer, its view/DataView, the temporary source view, and the growth copy per nonempty packet at source level. Twelve continuously sending clients generate up to 360 such avoidable growths/second. This is an operation count, not a measured frame-rate or heap improvement.

**Acceptance/measurement:** Compare every byte against the baseline for command counts 0–16, mixed one-to-eight-tick durations, sequence/timestamp boundaries, rear brake, and every discrete control. Count zero growths for valid packets; retained encoded packets must remain independent. Benchmark seeded realistic resend lengths with alternating baseline/current pairs, construction outside timing, identical checksum sink and raw per-pair timings. Preserve rejection/contiguity behavior.

## 3. Shared snapshot capture still repeats shared car serialization

**Evidence:** The preceding work correctly captures each car once (`src/net/server.ts:705–710`), then calls `encodeSnapshot` separately for every recipient (`:711–731`). `writeSnapshot` walks every car (`src/net/snapshot.ts:175`), and `writeCar` repeats scalar clamping, rounding and writes (`:85–100`). A normal 12-car, 12-recipient boundary therefore performs **144 car serializations**, even though 132 entries differ only by which recipient owns the FULL extension. Recipient-specific headers and the owning car's FULL bit/12-byte extension must remain distinct.

**Executed byte-equivalence prototype:** A disposable in-memory prototype serializes each car once with FULL, derives its compact prefix/suffix, and assembles independently owned recipient packets with their unchanged headers. The car layout is 39 compact bytes or 51 FULL bytes; the extension starts at car offset 28 and the whole message header is 23 bytes. For 1/4/12-car fields, 32 varied boundaries per field, and every owning recipient, **544 complete packet comparisons matched** the existing `encodeSnapshot` output. The cases vary orientations, saturation, flags, signed values, ranks, ACK, wrapped echo and fractional hold. Concatenated output SHA-256: `76398179e24d9f113997d4810618f352bec5fae178c89033dc00a7b68a983c96`.

**Implementation boundary:** A batch-specific codec entry point can encode shared car bytes once, then write each recipient's header and copy the relevant segments into a distinct output packet. Keep generic `encodeSnapshot` as an independent reference/API. At 12 recipients this can reduce car serialization from 144 to 12; it does not remove the necessary 12 independent packet allocations/copies. Do not persist encoded car data across boundaries or move any transport callback ahead of complete batch capture/encoding. Preserve existing reentrant batching, latches, recipient ownership checks, failure isolation and packet ordering. Benchmark the one-recipient path separately; extra assembly may cost more when nothing is shared.

**Acceptance/measurement:** Extend the existing 0/1/4/12-recipient snapshot lifetime and byte-equivalence fixtures. Compare full packet arrays and channels, every possible recipient, contacts/events/missing windows, changed next boundaries, retained-packet mutation, reentry and send failures. Instrument actual `writeCar` calls and buffer allocations separately from timing. Use the established snapshot benchmark's inert checksum sink and alternating samples; report all recipient counts, including small-field regressions. The prototype establishes byte-layout feasibility only: no production integration, elapsed-time improvement, browser gain, or full-race throughput is claimed.

## Audit verification limits

Executed three cheap Node TypeScript probes (input growth, real-client latency step, and shared-byte packet equivalence), each under one second of reported process time. No broad tests/builds, benchmark timing claim, asset hooks, commits, or dependency edits. Reproduction source is retained at `/tmp/aeebac160835-engine/audit-network-repro.mjs`; run it from the repository with `node --no-warnings --experimental-transform-types ../audit-network-repro.mjs`.
