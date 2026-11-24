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
| 19 | Host cancellation of pending Festival startup | Running |
| 20 | Binary buffer growth, bounds and integer decoding | Running |
| 21 | Circuit snapshot transfer-pool ownership and backpressure | Running |
| 22 | Festival snapshot transfer-pool integration and stale return handling | Queued |
| 23 | Terrain-streamer request transport, worker failure and cancellation bookkeeping | Queued; caller already bounds in-flight work, so no silent queue cap |
| 24 | Network control decoding and channel/shape validation | Queued |

## Remaining waves

Assignments and evidence will be appended before each batch is launched.
