# Engine task ledger — 60 agents / 10 waves

Each identifier denotes a distinct spawned agent. The coordinator is not counted.
Agents own disjoint files within a concurrent batch; only the coordinator commits.

## Wave 1 — timing, input, and worker delivery

| Agent | Assignment | Result |
|---|---|---|
| 01 | Circuit worker fixed-step clock and bounded catch-up | Fixed; 49 focused tests passed, including 19 new scheduling cases |
| 02 | Input pump lifecycle and binding/action behavior | Fixed stale/reentrant callbacks and legacy clutch migration; 54 focused tests passed |
| 03 | Live-frame interpolation and replay-clock continuity | Fixed invalid replay timing/acknowledgements; 56 focused tests passed |
| 04 | Festival integration of the common simulation clock | Fixed bounded scheduling, pause/reinit and exact 10 Hz status; 26 focused tests passed |
| 05 | Recording transfer-buffer ownership and pooling | Fixed duplicate recycling, flush retry and cross-stream failure ordering; 53 tests passed |
| 06 | Input controller focus/device cancellation | Fixed terminal disposal, hidden-tab inputs, widget and pointer ownership; 105 tests plus final 16-case suite passed |

## Wave 2 — runtime resource ownership

| Agent | Assignment | Result |
|---|---|---|
| 07 | Asynchronous environment loader cache and GPU cleanup (no content changes) | Fixed failed conversion cleanup and cache ownership; 14 tests passed |
| 08 | Texture-loader retry, concurrent cache and disposal ownership | Fixed exhausted-role cache eviction; 7 tests passed |
| 09 | GPU timing queries and frame-fence lifecycle | Fixed invalid samples, lost-context ownership and cleanup errors; 77 tests passed |
| 10 | Gain-map decoding resource ownership and borrowed render-state restoration | Fixed failed-target leaks and face/mip restoration; 12 tests passed |
| 11 | Festival session asynchronous startup/disposal and worker request cleanup | Fixed cancellation, readiness/command deadlines and late callbacks; 27 tests passed |
| 12 | Graphics preparation/settings transition cancellation | Fixed stale progress callbacks; 71 focused tests passed |

## Wave 3 — simulation throughput and bounded work

| Agent | Assignment | Result |
|---|---|---|
| 13 | BVH nearest-hit traversal performance and deterministic reference checks | Deferred final contact details; 40 tests passed; near-first proposal rejected by edge-case regression |
| 14 | Collision broad-phase filtering and contact invariants | Added conservative live y/z filtering, cached swept bounds, deferred swept contact details; final 36 focused tests passed |
| 15 | Terrain residency queue, cache bounds and prefetch scheduling (no height/geometry changes) | Fixed invalid budgets, stale/LRU work and bounded recent-area prefetch; 20 new and 2 existing tests passed |
| 16 | Flashback resimulation CPU slicing without dropping recorded ticks | Added 8 ms between-tick yielding and preserved deterministic continuation; 14 tests passed |
| 17 | Snapshot encoding/validation hot path and allocation behavior | Linear rank scatter and cached registry lookup preserve exact snapshot bytes; 14 new and 5 existing targeted tests passed |
| 18 | Festival late-loader ownership after renderer disposal (no scene changes) | Fixed late resource installation and deduplicated concurrent photo loads; 45 renderer/session tests passed |

## Wave 4 — cancellation, worker transport, and protocol boundaries

| Agent | Assignment | Result |
|---|---|---|
| 19 | Host cancellation of pending Festival startup | Integrated lazy-session owner, stale callback guards and cancellation handoff; 55 focused tests passed |
| 20 | Binary buffer growth, bounds and integer decoding | Fixed zero-capacity growth, invalid read lengths and unsafe varints; 48 tests passed |
| 21 | Circuit snapshot transfer-pool ownership and backpressure | Shared ownership-aware pool and circuit adoption; 40 tests passed |
| 22 | Festival snapshot transfer-pool integration and stale return handling | Adopted shared pool with field-size reset and traffic pairing; 14 tests passed |
| 23 | Terrain-streamer request transport, worker failure and cancellation bookkeeping | Fixed rollback, terminal errors and teardown; 20 tests passed; root integrated fatal session propagation |
| 24 | Network control decoding and channel/shape validation | Added reliable-channel and nested server-control validation; 130 focused tests passed |

## Wave 5 — recording and persistence

| Agent | Assignment | Result |
|---|---|---|
| 25 | Replay IndexedDB connection, disposal and late open ownership | Fixed terminal disposal, late opens and transaction abort cleanup; 18 tests passed |
| 26 | SaveStore connection retry, blocked opens and transaction recovery | Fixed retry/ownership, transaction completion and atomic scheduling failures; 35 tests passed |
| 27 | Telemetry export cancellation, backpressure and asynchronous ownership | Fixed malformed reply handling and contained auxiliary worker errors; 29 tests passed |
| 28 | Diagnostic recording ring capacity and bulk append work | Validated replay capacity and bounded telemetry bulk copies; 191 focused tests passed |
| 29 | Session replay paging, truncation and asynchronous failure audit | Fixed reopened surface hashes, future-only surfaces and overlapping page-ID write ownership; 101 tests passed |
| 30 | Desktop save mirror transaction completion and revision ordering | Fixed snapshot revision adoption, monotonic counters and atomic transaction failure handling; 75 tests passed |

## Wave 6 — rendering infrastructure

| Agent | Assignment | Result |
|---|---|---|
| 31 | Texture-budget ownership, CPU-read canvas backing and resampling | Fixed shared-source refresh propagation; corrected obsolete canvas-context fixture; 34 tests passed |
| 32 | Shadow-proxy batching invariants and baseline draw-count investigation | Kept production batching unchanged; corrected stale limits and verified articulated geometry/ownership; 12 tests passed |
| 33 | Snapshot interpolation and reusable presentation buffers | Audit passed without production changes; six new ownership/offset/reentrant cases, 67 focused tests passed |
| 34 | Native PMREM audit and reflection resource disposal | Kept native PMREM helper; fixed idempotent/failure-isolated reflection and mirror disposal; 68 tests passed |
| 35 | Draw-ledger audit and timestamp-query ownership | Fixed optional timestamp-query failure/ownership handling; DrawLedger unchanged; 73 tests passed |
| 36 | Circuit renderer asynchronous lifetime integration | Fixed disposed preparation/fence ownership and failure-isolated teardown; 19 new cases, 101 startup tests and seven real-venue teardown tests passed |

## Wave 7 — audio, devices and session integration

| Agent | Assignment | Result |
|---|---|---|
| 37 | Racing audio startup, disposal and context ownership | Fixed partial startup, pending-close replacement ownership and cleanup failure isolation; 87 tests passed |
| 38 | Audio activation listener and resume failure ownership | Fixed stale/disposed/closed attempts and synchronous resume failures; 17 tests passed |
| 39 | Music loading, cancellation and voice graph lifetime | Running |
| 40 | Gamepad haptic actuator identity and output cancellation | Running |
| 41 | UI sound graph and local review-capture cleanup | Queued |
| 42 | Host replay play/pause integration at timeline boundaries | Queued |

## Remaining waves

Assignments and evidence will be appended before each batch is launched.
