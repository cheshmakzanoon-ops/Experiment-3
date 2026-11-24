# Network audit — Agent 04, wave 1

Read-only inspection of `src/net` at the provided baseline. No production/test edits, git writes, broad type check, or model/environment/character edits. Focused Node TypeScript repros exercised the existing implementation.

## 1. Bound routine client and prediction telemetry (high confidence, normal-path memory growth)

**Files:** `src/net/prediction.ts` (`stats`, `reconcile`, `render`); `src/net/client.ts` (`stats`, `receive`, `sendInputs`, `adjustLead`, `render`); reporting integration in `src/net/slice.ts`.

Every rendered local pose appends `visualStep`; every rendered client frame appends interpolation delay. Snapshot/reconciliation paths append position/heading/category errors, corrections, RTT, snapshot byte sizes, and lead. These arrays never evict data. This occurs under entirely healthy links, and calling public `view()` also records a visual sample. At 60 Hz, each frame-rate array adds 216,000 entries/hour/client; the slice retains every replaced client too. `distribution()` copies and sorts whole arrays at report time, amplifying peak memory and completion latency.

**Verified:** 100,000 ordinary `LocalCarPredictor.render()` calls retained 99,999 `visualStep` entries. No special options or malformed packets are required.

**Implementation scope:** Introduce a bounded metrics collector (streaming counters/mean/max plus bounded histogram or explicitly documented reservoir), or make full raw measurement retention an explicit finite benchmark-only option. Preserve lifetime event counts and meaningful distributions; simply dropping old values silently changes report semantics. Keep short deterministic measurement mode compatible where exact percentiles are required.

**Acceptance:** Many simulated hours of frame/snapshot observations have constant retained storage; lifetime sample counts remain correct; means/max stay exact; percentile approximation or rolling semantics are explicit. Existing short online-slice thresholds and prediction tests remain meaningful. Repeated public `view()` calls must not manufacture extra rendered-frame statistics unless that behavior is explicitly intended.

## 2. Bound command history when downlink feedback stops (high confidence, valid outage path)

**Files:** `src/net/input.ts` (`ClientCommandLog.issue`, `prune`); `src/net/client.ts` (`sample`, `onSnapshot`).

Commands are pruned only on accepted new snapshots, and only when old commands are acknowledged. During a one-way downlink outage, the transport can remain open and the server can keep receiving commands, so server-side idle disconnect does not resolve this. The client continues issuing commands at 60 Hz while its only feedback is `view().stalled`. Its history grows for the outage duration even though resend only needs the newest 12 commands and prediction stops at its 60-tick horizon. Stale acknowledgements can prevent reclamation even after time advances.

**Verified:** Issuing 100,000 two-tick commands without ACKs, then `prune(200000)`, retained all 100,000 while `resend(12, 200000)` returned zero. Also exercised actual `RaceClient` timer scheduling with a valid grid/two decoded snapshots followed by a silent downlink: after 60 seconds it remained in `race`, reported stalled, and kept thousands of commands and per-frame samples.

**Implementation scope:** Define a bounded retained replay/resend window independent of ACK arrival, and enforce it from the issuance path. Account for the predictor's lag/base/horizon and newest redundant command suffix. Expired commands cannot become useful solely because their ACK is absent. Avoid keeping stale commands for a snapshot that is itself beyond the allowed recovery horizon.

**Acceptance:** A long downlink-only outage keeps history bounded while uplink commands continue. Recovered snapshots safely reconcile/reseed and resend still contains the latest valid contiguous suffix. Healthy-link replay, delayed ACKs, recent packet loss, and response-lag lookup remain correct. Include a timer-driven client regression, not only a manually pruned log.

## 3. Own retained interpolation and prediction values (confirmed behavior; public integration boundary)

**Files:** `src/net/interpolation.ts` (`RemoteCarTrack.push`, `latest`); `src/net/prediction.ts` (`start`, `authoritative`, `predictedAt`); assess client snapshot getters as a follow-up ownership boundary.

`RemoteCarTrack.push` stores the caller's object. `latest()` returns that object. The production client also exposes the same decoded state through public `latest`/`carState`, so a consumer reusing or changing a HUD object can rewrite remote history. There is no current in-repository production writer of those exposed objects; this is an integration ownership defect rather than proven spontaneous wire-path corruption. The same issue is independently observable in the predictor: `history` and `shown` share the same pose object, and `predictedAt()` returns it directly. A caller changing a supposedly queried pose corrupts future error telemetry. `authoritative` returns the retained wrapper/state itself.

**Verified:** A two-sample remote track produced midpoint x=0.3; changing the original first state's x to 100 changed the identical query to x=50.3. Mutating `predictedAt(12).x` to 1000 made the next reconciliation record a fabricated 998.8 m error for a perfectly linear 12 m/s trajectory.

**Implementation scope:** Copy primitive state/pose values on retention and return detached snapshots or immutable objects at public read boundaries. Avoid copying every hot sample unnecessarily: one retained copy plus immutable/detached outward values is enough. Document ownership explicitly.

**Acceptance:** Reusing one input object for successive pushes cannot change prior interpolation; mutating `latest`, `authoritative`, or `predictedAt` results cannot alter retained history, later samples, or error metrics. Existing interpolation, extrapolation, quantized-state, and prediction accuracy remain unchanged. Validate runtime isolation, since TypeScript `readonly` alone does not isolate aliases.

## Checked and deprioritized leads

- **ServerClock non-finite poisoning is real but currently secondary.** After one `observe(6, NaN)` and 98 valid observations, offset recovers after window eviction but `jitterTicks` stays NaN permanently. However ordinary snapshot ticks are `u32`, `ByteReader.f32/f64` reject non-finite payload floats, and normal EventLoop scheduling is finite/monotonic. Reachability needs an invalid externally configured `clockOffsetMs`, direct public API misuse, or externally changed loop clock. A small separate boundary-hardening scope could validate finite samples/derived offsets and positive integer window size transactionally; test recovery and preservation of prior good state. Do not call this a current hostile snapshot vulnerability.
- **32-car snapshots exceed the datagram limit, but the active lobby prevents it.** One FULL plus 31 compact cars encodes to 1,283 bytes and is rejected against the 1,200-byte limit. Actual `Lobby.create` restricts field size to `playersPerLobby=12`, whose packet is 503 bytes. This is a future protocol-capacity inconsistency, not an active race failure; do not prioritize ahead of the confirmed memory paths.
- **Remote track history is bounded for real decoded packets.** Valid ticks are unique integers and the track retains a 240-tick window (plus at most an old bracketing pair). Fractional/NaN direct pushes could defeat that guarantee, but wire packets cannot carry them.

## Verification performed

Read call paths and existing focused tests; ran small Node `--experimental-transform-types` scripts for telemetry retention, remote and predictor aliasing, unacknowledged command pruning, an actual timer-driven silent-downlink client, packet-size boundaries, and clock recovery. No broad test suite or type check was run, as requested.
