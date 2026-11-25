# Implementation: engine contracts and ownership

[Report index](README.md) · [Validation](VALIDATION.md) · [Commit history](COMMIT-HISTORY.md)

This document describes the production engine at checkpoint 7, [`6a6bf02eb2d89eeb6aeff32769ef3deb4a49f17c`](https://github.com/cheshmakzanoon-ops/Experiment-3/commit/6a6bf02eb2d89eeb6aeff32769ef3deb4a49f17c). Later fixture/workflow checkpoints retain that production source. Evidence links distinguish behavior tests, native API checks and timed measurements.

## Input and authoritative journals

### Preserve accepted intent through the host

A shift is a discrete action. Storing only the latest `state.shift` allowed two key pulses, or a keyboard pulse followed by a gamepad pulse, to overwrite each other before the host delivered them.

[InputController](../../../src/input/controller.ts) now owns a FIFO reserve using the existing [ShiftInputQueue](../../../src/workers/input-queue.ts). The visible staged pulse and reserve together are bounded by `MAX_PENDING_SHIFTS = 32`. The host acknowledges delivery by setting `state.shift = 0`; only then does the controller expose the next edge. Reading or updating controls does not consume an unacknowledged edge. At capacity, newest overflow is dropped while already accepted order is preserved. Reset, disable and ownership-loss paths clear the reserve, so inputs from the departed driving session cannot replay on resume.

The existing worker queue consumes one edge immediately before a simulation step. Keyboard repeats and widget-owned input stay outside the shift queue. Held gamepad paddles are edge-detected, and acquiring/replacing a device observes held buttons as a baseline. This is bounded ordered delivery, not a promise to retain an arbitrarily long stalled-input burst. [Controller regression](../../../tests/engine-controller-shift-order.test.ts); [native keyboard/worker fixture](../../../e2e/engine-native-input.spec.ts).

[ControllerActions.poll](../../../src/input/button-actions.ts) also finishes observing the complete button sample before invoking its selected UI callback. A callback may reenter polling, throw, or synchronously replace the controller. Completing observation first prevents later held buttons in the old sample from becoming phantom commands afterward. Index priority, mappings, allowlists and the one-selected-action policy remain unchanged. [Adversarial cases](../../../tests/engine-input-audio-adversarial.test.ts).

### Separate live shift edges from held controls

[AuthoritativeWorld and NetDriver](../../../src/net/authority.ts) keep live level controls with `shift: 0` and store a distinct next-update shift edge. The edge is accepted only on a command's first application when the driver follows human controls, consumed once, and cleared on AI takeover. Holding a command during packet loss therefore holds throttle/brake/steering levels without repeatedly changing gear. Distinct identical commands can still produce distinct shifts; duplicated delivery does not.

Journal control snapshots have independent object ownership, so later driver mutation cannot rewrite recorded history. A rejected [client sample](../../../src/net/client.ts) clears shift along with other discrete edges while preserving appropriate last level controls.

Compatibility is explicit. Journal **tag 5** encodes the new shift edge; tags 0 and 4 continue to replay their historical persistent-shift meaning. The per-car/per-tick journal bound rises from six entries to seven. Older readers reject tag 5 as unknown; this is not an unchanged-protocol claim. Hand-authored legacy journals and new live traces both undergo exact replay/record verification. [Shift tests](../../../tests/engine-network-shift.test.ts); [legacy review](reviews/w08a-network.md#other-audited-boundaries).

Direct [control quantization](../../../src/net/input.ts) replaces the temporary byte writer/reader round trip with the same scalar clamp, rounding and coercion rules. Field order, optional-field behavior, zero signs and actual encoder/decoder values remain the oracle. The measurement checks 283,305 encoded values, with additional throwing BigInt/Symbol cases; it does not infer allocation bytes from the eight removed source-level temporaries. [Quantization tests](../../../tests/engine-control-quantization.test.ts); [measurement](measurements/w07c-network.md).

## Bounded producers and consumers

Different consumers need different overload behavior:

| Producer | Bound and receipt | Behavior while full | Release/recovery rule |
| --- | --- | --- | --- |
| Engineering diagnostics | One packet, with epoch/sequence acknowledgement | Suppress sample construction; physics continues | Only the matching live owner's receipt retires the packet; repeated enable/reset cannot mint credit |
| Festival status | 64 outstanding sequence-owned statuses | Pause stepping and rebase the clock; reject command/init mutations before execution if capacity is unavailable | Valid ACK releases capacity; resume without catch-up or duplicate transition publication |
| Controller shifts | 32 staged/reserved edges | Drop newest overflow | Host acknowledgement exposes the next accepted edge; session reset clears all |
| Ghost capture | Existing valid duration interval and derived sample cap | Discard an invalid/ineligible lap and retain no unusable samples | New lap or explicit reset can begin eligible recording again |
| Transport error diagnostics | Newest 64 original thrown values plus lifetime count | Retire oldest diagnostic entry | Ownership cleanup still proceeds; total failure count remains available |

### Optional diagnostics versus loss-sensitive status

The [engineering channel](../../../src/workers/diagnostics.ts) avoids creating a sample that cannot be sent. Credit remains occupied across reset/re-enable calls, including failed worker initialization; an old or duplicate receipt cannot release a successor's packet. The host acknowledges consumption only for its owning worker. Native evidence holds one immutable packet while **360 physics ticks continue**. Validation also now uses the unchanged material table, allowing actual motocross surface ID 6 rather than the old circuit-only range. [Diagnostics tests](../../../tests/engine-diagnostics-backpressure.test.ts); [native channels](../../../e2e/engine-native-channels.spec.ts).

Festival's existing achievement observer depends on sampled status transitions, so simply coalescing/dropping queued statuses would change behavior. The [protocol](../../../src/workers/open-world-protocol.ts) and [worker](../../../src/workers/open-world.worker.ts) instead bound accepted outstanding statuses at 64. During a prolonged host stall, simulation stops accumulating additional time. Credit return permits bounded continuation with a rebased clock. Repeated overloaded pauses neutralize input without manufacturing required frames or duplicate statuses.

Normal 10 Hz status cadence and accepted publication order remain intact. A ten-second normal fixture produces 1,200 ticks and 101 statuses including initialization. This does not guarantee capturing every physical event between 10 Hz samples. [Status tests](../../../tests/engine-festival-status-backpressure.test.ts); [host/worker composition](../../../tests/engine-festival-composition.test.ts).

### Ghosts stop retaining unusable laps

[GhostRecorder and validateGhost](../../../src/core/ghost-lap.ts) share the existing accepted lap interval, strictly greater than ten and less than 600 seconds, and a minimum of twenty samples. The maximum derives from the 30 Hz interval including Float32 tolerance and the crossing sample; storage cannot grow indefinitely during a stopped or automated lap.

Malformed poses, nonfinite metadata, invalid/reversed lap clocks, pit/automation ownership, invalid laps and recordings that start too late all make the current lap ineligible and release its samples. A candidate at the crossing is validated before publication; successful output owns an independent typed copy. Version 1 and its eleven-field record layout remain, while acceptance is intentionally stricter. [Bounded capture tests](../../../tests/engine-ghost-bounds.test.ts); [recording integration](../../../tests/engine-recording-composition.test.ts).

## Failure and session ownership

### Terminal errors require fresh initialization

The host already treated a circuit worker error as ending that session. Previously the worker could remain merely paused; queued resume or command traffic could restart partially mutated state. Both [circuit](../../../src/workers/physics.worker.ts) and [Festival](../../../src/workers/open-world.worker.ts) workers now enforce terminal ownership internally. Pending rewind work is cleared, and subsequent ordinary traffic cannot step or publish from the failed simulation.

A successful fresh initialization restores a paused owner. Matching receipts may retire already-delivered engineering/surface/status ownership while failed; this is cleanup, not permission to revive the old world. The expanded frame-transport fixture additionally checks five distinct fresh full-size frames and duplicate-return behavior. The existing frame format does not authenticate arbitrary same-sized buffers across sessions. [Terminal-worker tests](../../../tests/engine-circuit-worker-terminal.test.ts); [frame transport](../../../tests/circuit-frame-transport.test.ts).

Festival distinguishes an expected invalid command from an unexpected execution failure. [FestivalCommandValidationError](../../../src/simulation/open-world/session.ts) marks three existing pre-mutation validation branches. Those can reject a command while retaining a sound world. An unexpected error after execution starts is terminal because the worker cannot assume mutation was atomic. No world/event/vehicle definitions change. [Command error cases](../../../tests/engine-festival-command-errors.test.ts).

### Settlement and cleanup survive callback failure

[SessionLifetime.wait](../../../src/session/session-lifetime.ts) always settles even if its cancellation cleanup throws. Original rejection or abort reasons take precedence; cleanup failure rejects a wait that would otherwise succeed. This prevents a detached asynchronous operation from leaving its outer promise pending indefinitely.

[GameApp](../../../src/main.ts) detaches the worker/startup owner before callbacks run, then independently attempts cleanup for recording/review/startup, input, rumble, audio and error reporting. Secondary cleanup failures do not replace the originating application error. Pausing/suspending stops haptics immediately rather than waiting for another worker snapshot. [Host cleanup](../../../tests/engine-host-failure-cleanup.test.ts); [settlement tests](../../../tests/engine-session-settlement.test.ts).

[FestivalSession](../../../src/session/free-roam.ts) applies the existing terrain-readiness guard to default startup as well as destination startup. Failure disposal and pending-command rejection happen before reporting; host exit is still attempted if the toast throws. The frame also returns immediately if the real HUD/gamepad callback synchronously exits Festival, avoiding subsequent access to cleared navigation/audio owners. [Composition](../../../tests/engine-festival-composition.test.ts); [reachable gamepad exit proof](reviews/w08b-worker-session.md).

## Network snapshots and transport ownership

[RaceServer](../../../src/net/server.ts) collects eligible recipients and captures each car once per boundary. It then encodes **complete, independent recipient packets before any external transport callback**. Only that recipient's car carries the FULL flag; temporary scratch flags are restored after each encode. A peer that mutates its retained buffer cannot affect another peer or later snapshot.

The dispatch retires this boundary's contact/event/input-slack latches before sending. A synchronous callback can request one follow-up boundary; further requests defer to the next scheduled snapshot without consuming its pending data. Two batches bound the current dispatch, and accepted packet/event order is retained.

At twelve cars, capture/ranking changes from 48→12 calls for four recipients and 144→12 for twelve. Each recipient still needs encoding and its own buffer. This explains why reduced capture counts are much larger than the measured complete-dispatch improvement. [Snapshot lifetime tests](../../../tests/engine-server-snapshot-lifetime.test.ts); [counts/bytes/timing](measurements/w07c-network.md).

Transport send/close faults are contained at the transport boundary. Peer ownership is revoked before close callbacks, and replacement/AI takeover is completed even if close throws or reenters. Encoding, authoritative-state and physics faults still propagate to their supervisor. The newest 64 original send/close failures are retained alongside a total count.

Further ownership checks stop grid countdown creation, record/results publication and linger timers after an external callback tears down the server. A chunked-results recipient retains its captured connection; losing it stops that recipient's chunks without dereferencing null or abandoning healthy peers. [Network adversarial review](reviews/w08a-network.md).

At the race's exclusive end tick, a final snapshot failure could stamp a takeover for a tick that was never simulated. [createRecord](../../../src/net/records.ts) trims only that unconsumed current-tick suffix from the archive while preserving the live journal and all earlier actions. Future-dated or unordered corruption still fails strict verification. Linked-client tests cover loss, duplication, reordering, blackout and AI handback, plus final failures at ticks 54 and 60. [Composition and full replay](../../../tests/engine-network-composition.test.ts).

## Recording, rewind and CSV export

### Use the clock domain that was stored

[TelemetryRecorder](../../../src/storage/recorders.ts) now truncates with session time, matching the worker's rewind receipt, rather than column-zero race time. Its cutoff is rounded into the Float32 domain of stored rows. Removing the discarded tail also resets last-tick deduplication to the newest retained tick so reused tick numbers on the resumed branch are recorded.

[SessionReplay](../../../src/storage/replay-pages.ts) compares pose/page cutoffs in that same stored Float32 domain, while weather/surface cutoffs remain double precision. The actual reproduced boundary was double time `6.180847637805483` versus stored pose `6.180847644805908`. Treating all timestamps as interchangeable would drop the selected pose or incorrectly reject its page. [Ring/time tests](../../../tests/engine-telemetry-time-ring.test.ts); [recording composition](../../../tests/engine-recording-composition.test.ts).

### Copy chronological spans, preserve independent ownership

A ring snapshot still allocates a complete independent Float32 result. Chronological order requires one contiguous source span when unwrapped or two when wrapped, replacing one source view and copy per row. The live recorder may continue and overwrite every ring slot without changing a retained snapshot.

The default full payload remains 54,000 rows × 228 channels × four bytes = **49,248,000 bytes**. This optimization reduces repeated views/calls, not payload size. Sixteen fixtures and 32 subsequent-overwrite checks compare exact chronology and bytes. [Snapshot measurement](measurements/w07d-telemetry.md).

### Materialize completed CSV groups earlier

[telemetryCsv](../../../src/storage/telemetry-schema.ts) already formatted rows in groups of 500. It previously retained every completed group as a string until final Blob assembly. It now converts each completed group to a native Blob immediately, allowing the string to become collectible sooner. Header/channel order, numerical spelling, newline, MIME, finite/shape checks and final output ownership remain unchanged.

For the measured default fixture, final assembly retains a 2,859-code-unit header instead of 115,038,761 code units of CSV strings, plus 108 data Blob parts. Those code units are not a heap-byte estimate. The output still owns **115,038,761 bytes**, and retained typed/Blob payload after collection is unchanged. This is not constant-memory streaming.

Five fresh-process Node pairs record high-water RSS through export of 628.602→370.602 MiB; three native worker pairs record 1,676→1,561 ms completion. Eighteen full exports match every byte. Node high-water RSS includes startup/fixture/warmups and precedes verification; browser peak memory and the configured 216,000-row maximum were not measured. [Full evidence](measurements/w08c-csv-memory.md); [regression](../../../tests/engine-telemetry-chunk-storage.test.ts).

The host cancels session-owned export on failure or Festival handoff, and checks completion ownership even if the worker promise already resolved. Actual transferable snapshots detach at the sender while recording continues; canceled/replaced successes cannot trigger stale downloads. [Host export tests](../../../tests/engine-export-host-ownership.test.ts); [native IndexedDB/export](../../../e2e/engine-native-recording.spec.ts).

## Physics construction and exactness

| Change | Preserved numerical/structural rule | Evidence |
| --- | --- | --- |
| [TriangleBVH.build](../../../src/simulation/bvh.ts) | Same component extrema fold, vertex order, `Math.min`/`Math.max` signed-zero behavior, split policy, triangle ordering and queries; write final scalar bounds once per node | [Full node/order and sampled query comparison](measurements/w07a-bvh-measurement.md) |
| [TrackContactMesh](../../../src/simulation/contact.ts) | Same normal/index values, offsets, winding, authored bands/height/kerb/bank equations and positive-integer resolution | [Eight mesh comparisons](measurements/w07b-contact.md); [row-domain proof](reviews/w08f-physics.md) |
| [RoadContactFrame.set](../../../src/simulation/road-contact.ts) | Reuse the already accepted ordinary Vec3 length; identical multiplication and subsequent tangent operations | [Special numeric/alias review](reviews/w08f-physics.md#road-frame) |
| [Vehicle.coupleClutch](../../../src/simulation/vehicle.ts) | Same four tire slips in the same order, absolute values and `Math.max`; no grip/torque/gearing/setup change | [Fixed-four domain and dormant branch](reviews/w08f-physics.md#four-tire-entries) |

The scalar contact writer exposed a malformed-input difference: fractions 0.4, 1.4 and 7.4 could silently return incomplete meshes where typed-array `set()` previously threw. The final constructor requires a positive integer row count before allocation. Valid mesh output remains exact; zero/NaN receive an earlier explicit RangeError, so old exception classes/messages are not claimed identical for unsupported inputs.

BVH measurement includes construction only, excluding mesh setup and queries. Contact-buffer timing is mixed despite fewer array operations. Road-frame isolated loops show reduced repeated work, while natural `rl2` timing remains inconclusive after the original +9.96455% signal and the separate 127-process investigation. The AWD optimization is dormant in current catalogue stepping. None supports a whole-game FPS claim.

Three ten-second production Simulation traces additionally compare 617,181,316 bytes exactly, with private-state/static-definition and checkpoint-frequency exclusions retained. [Independent simulation evidence](measurements/w07e-simulation.md); [adversarial physics tests](../../../tests/engine-physics-adversarial.test.ts).

## Texture, GPU and audio ownership

### Batch registration without changing image definitions

[Generated](../../../src/rendering/texture-budget.ts) and [imported](../../../src/rendering/imported-texture-budget.ts) budgets acquire compatible wrappers by source/group before repaint/update work. Resolution/readback groups remain separate. Generated registration repaints a shared group once and invalidates each wrapper linearly; later generated registrations still refresh the appropriate painted source. Imported images already shared a single copy/draw in the baseline—the improvement removes repeated wrapper updates.

For 1,024 wrappers in one group, generated draws fall 1,024→1 and wrapper increments 524,800→1,024. Imported draws remain 1→1. Both already share source/GPU storage. Initial dispose events rise from `N + groups` to `2N` because all wrappers are acquired before initial resize. The controlled Node canvas substitute measures elapsed registration time for CPU-side work; it does not measure rasterization or GPU time. [Measurement and tradeoff](measurements/w07f-texture.md).

### Retire ownership before invoking disposal listeners

Unregister first removes a wrapper from budget indexes, then disposes while its old source is visible, and restores its original source in `finally`. A listener that closes the whole budget cannot revisit the wrapper currently being removed. Whole-root/budget cleanup continues through independent resources and rethrows the first value, including `undefined`.

The [scene texture helper](../../../src/rendering/assets/texture-source-ownership.ts) also attempts exclusive decoded-bitmap release after a texture listener fails. Shared/cache images remain borrowed. [RacingRenderer.releasePlanting](../../../src/rendering/renderer.ts) attempts the existing planting owner after budget unregister fails, preserving the first error. [Adversarial ownership review](reviews/w08e-resources.md).

Both renderers retain and dispose their existing OutputPass. [FestivalRenderer](../../../src/rendering/open-world/festival-renderer.ts) additionally releases owned sky geometry/material and near-sun shadow targets while retaining its borrowed WebGLRenderer. Its lighting, camera, terrain/material definitions and pipeline configuration remain unchanged.

Fresh native evidence retains zero CPU/GPU pixel differences for three tested groups and six stable Festival cycles. Active texture/geometry/program counts 5/6/7 return to retained 1/2/4, including the probe and identified Three VSM internals; the borrowed renderer still draws afterward. Three listener ordering and protected nested owners retain documented fault limitations. [Native metrics](validation/w08e-native-metrics.json).

### Revoke preview work at the lifecycle boundary

[RacingAudio](../../../src/audio/engine.ts) mute/stop cancels pending and scheduled previews. Host blur and hidden-tab suspension cover paused and menu screens as well as driving; disposal removes the bound blur listener.

After an unsuccessful live-context activation, preview scheduling now requires the context actually to be running. A rejected, refused or timed-out resume cannot arm tones for a later unrelated unlock, and refusal does not consume preview cooldown. Offline contexts intentionally remain schedulable before rendering. Tone content, envelopes, buses and cooldown duration are unchanged. [Input/audio review](reviews/w08d-input-audio.md); [preview cancellation tests](../../../tests/engine-audio-preview-cancellation.test.ts).

Native 48 kHz stereo tests show zero later-window peak after cancellation and identical replacement PCM across 96,000 channel samples. These establish DSP/request ownership on Chromium APIs, not physical speaker latency, controller vibration or device behavior. [Native preview evidence](validation/w06a-metrics.json).
