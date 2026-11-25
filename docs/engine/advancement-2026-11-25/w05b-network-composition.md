# Wave 5 — live network composition validation

Assignment 26/60; validates the combined remote presentation clock, shared snapshot car serialization, and exact input encoder capacity changes from assignments 8, 12, and 21.

## Outcome

No production defect was found, and no production source patch was made. Two new seeded integration cases pass in `tests/engine-network-advancement-composition.test.ts`. The existing `tests/engine-network-composition.test.ts` is unchanged, as requested by the coordinator so its completed checkpoint gate could run independently.

The identical new workload also passes a complete outgoing-datagram and local-prediction comparison against the actual supplied baseline tree at `/dev/shm/aeebac160835-engine-baseline`, pinned by the coordinator to `350119e8ec0606e8c5de5b3ab80df41104025679`. Across both seeds, **2,292 datagrams and 278,730 packet bytes match**, including the packet offered to the deliberately failing transport. Remote presentation changes as intended; raw command timing and prediction remain equal.

## Meaningful integration coverage

The test reuses `onlineFixture` for the real lobby, authoritative race, and event loop. It constructs real `RaceClient` instances on `NetworkSimulator` links with seeds **17** and **48177**. Each nine-second scenario runs three physics-driven cars and seven client connection generations. Client clock origins are +123456, −100000, and 0 ms.

The workload combines these transitions in one continuing race:

1. Three recipients receive owned FULL/compact snapshots while the clients issue, encode, resend, and predict quantized controls. One link develops seeded loss, duplication, reordering, and jitter.
2. Another downlink changes from 50 to 200 ms, then to a jittered 20 ms link, then back to 50 ms. A different uplink has 350 ms of total input loss followed by slower, jittered recovery. This produces real negative slack, missing-input feedback, redundant command copies, and presentation correction.
3. During the first recipient's snapshot send at authoritative tick **708**, its callback retires the second driver's old transport owner and joins a fresh real client with that driver's token. That one encoded join is delivered synchronously through the transport receive callback so replacement happens inside the active dispatch. The callback requests a nested snapshot.
4. The third recipient mutates its owned outgoing snapshot and throws before transmission. The server contains the failure. The old second recipient receives no captured packet from this boundary; its replacement first receives a fresh header with `ackSeq = -1`, `echo = 0`, `slack = 127`, and `missing = 0`, then successfully receives acknowledgements for its new input sequence. The healthy first peer receives exactly the original and nested snapshot at that tick. Its second reentry request coalesces.
5. Further normal transport closes and token rejoins move the recipient counts through **3 → 2 → 1 → 0 → 1 → 2 → 3**. Six snapshot boundaries in each seed have no recipients and emit no snapshots. The final three clients are racing, and teardown leaves no pending event-loop entries.

Every outgoing snapshot has exactly one FULL car, belonging to its eventual client owner. Every nonzero echo belongs to an input packet from that same connection generation; every nonnegative acknowledgement refers to a sequence that generation actually sent. Every retained uncorrupted datagram remains unchanged after later encodes, nested captures, replacement, and the sibling send failure; all outgoing datagrams have distinct backing buffers.

The live clients exercise every resend packet length from **1 through 12 commands**. Observed minimum slack is **−19 ticks** for seed 17 and **−21 ticks** for seed 48177. Snapshot missing counts range from zero through six. All three drivers accumulate deduplicated command copies in the real server queues. Empty input packets and protocol maxima beyond the client's ordinary redundancy window remain covered by the dedicated encoder tests.

Every continuous client generation's remote render tick advances within **0.75–1.25 times elapsed local ticks**. The delayed original driver has one backward step in its raw arrival-minus-delay target in both seeds, while its displayed remote tick stays within the forward playback bound. Its correction spans 99 and 100 frames respectively. All seven generations finish their observed lifetime at zero presentation error relative to the raw target. Input callbacks always retain `targetTick() = arrivalTick(now) + lead`.

## Independent actual-baseline comparison

The reusable `scripts/engine-advancement/network-composition-proof.mjs` runner extracts the exported scenario portion of the new test and changes only its import locations. It runs that same workload against the real baseline and current modules in separate sequential Node processes. It does not reconstruct the old snapshot encoder, input encoder, client clock, or server behavior. There are no timing samples and no Git commands. The eight named network/harness source files are hashed before and after each run to detect changes during the probe; this is a targeted source record, not a complete dependency-graph manifest. The baseline commit pin is supplied by the coordinator, and the runner explicitly records that it does not independently verify Git identity.

For each seed, the comparison includes all complete unreliable datagrams, their direction, connection generation, channel, send time, and deliberate-failure marker. It also compares recipient-boundary observations, decoded input runs, recipient-specific headers, client sequence/tick/ACK cursors, raw targets, RTT/lead/delay histories, local prediction statistics and final predicted pose, semantic client events, server input statistics, rejoin/failure results, and final world tick. Reliable session-token bytes are excluded because tokens are random; reliable messages still travel through the scenario, and their resulting event/state semantics are compared.

| Observation per seed | Seed 17 | Seed 48177 |
| --- | ---: | ---: |
| Matched input packets | 678 | 678 |
| Matched snapshot send attempts | 468 | 468 |
| Matched complete datagrams | 1,146 | 1,146 |
| Matched packet bytes | 139,410 | 139,320 |
| Successfully sent snapshots | 467 | 467 |
| Authoritative world tick | 1,062 | 1,062 |
| Missing input ticks, both implementations | 49 | 58 |
| Duplicate command copies ignored, both implementations | 5,006 | 5,032 |
| Zero-recipient snapshot boundaries | 6 | 6 |
| Original delayed driver's raw-target rewinds, both implementations | 1 | 1 |
| Original delayed driver's current presentation correction frames | 99 | 100 |

The baseline presentation violates the bounded-forward-playback check in both runs; every current client generation satisfies it. Baseline and current packet ownership checks both pass. The expected transport failure is the only server transport error, and neither run produces an invalid client/server message or a kick.

SHA-256 of each matched serialized packet trace, including packet bytes and routing/timing metadata:

| Seed | Matched packet-trace SHA-256 |
| --- | --- |
| 17 | `f42f3e55f29c9e14b533399913e44436a7e1b593e533a828980859f9726f0ed5` |
| 48177 | `0aabd4f865fd97499a49a41f72dab7bdd2c023d78330b6ee3c3b465d48bd60d6` |

Reproduction from the candidate repository, with explicit source roots and a new output filename:

```sh
node scripts/engine-advancement/network-composition-proof.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current . \
  --output /tmp/w05b-network-composition.json
```

The retained summary is `docs/engine/advancement-2026-11-25/evidence/w05b-network-composition.json`. It contains exact counts and comparison hashes, source hashes, the test workload hash, and the runner hash. The runner refuses to overwrite an existing output. Complete packet/decoded observations are compared in temporary files and memory, then removed; the large raw datagram traces are not repository artifacts. The parameterized runner was executed successfully to produce this retained summary.

## Focused verification

Executed directly with one Vitest worker, without package lifecycle hooks:

```sh
node node_modules/vitest/vitest.mjs run tests/engine-network-advancement-composition.test.ts tests/engine-network-clock-drift.test.ts tests/engine-snapshot-batch-encoding.test.ts tests/engine-input-encoder-capacity.test.ts --maxWorkers=1 --minWorkers=1
node node_modules/eslint/bin/eslint.js tests/engine-network-advancement-composition.test.ts scripts/engine-advancement/network-composition-proof.mjs
```

**Four files and 32 tests passed**: two new composition cases, eleven clock-drift cases, fourteen snapshot-batching cases, and five exact-input-capacity cases. Scoped ESLint passed. The existing clock comparison in that group also retained its 1,228-packet ordinary two-client parity check. Initial standalone execution of the new cases required correcting a fixture assertion that assumed clients had already received their grid when a snapshot was sent; snapshots may legitimately be sent before grid delivery. No source behavior was changed for that correction.

## Scope and remaining limits

This is deterministic simulated-transport integration evidence with real production client, server, encoding, and physics paths. The injected synchronous join/close callbacks and send failure exercise the `Transport` ownership contract; they are not native browser/WebRTC or socket behavior. Native transport/browser evidence remains with wave 6. Throughput, allocation pressure, and elapsed-time comparisons remain with wave 7. The nine-second runs and two seeds do not establish long-session or all-network-condition coverage.

No protocol, limits, rates, tuning, authored content, assets, models, environments, characters, dependencies, production files, or existing tests were edited. No npm hook, full typecheck/build, browser bypass, Git operation, or child agent was used. The coordinator owns consolidated gates and publication.

Released files: `tests/engine-network-advancement-composition.test.ts`, `scripts/engine-advancement/network-composition-proof.mjs`, `docs/engine/advancement-2026-11-25/evidence/w05b-network-composition.json`, and this report.
