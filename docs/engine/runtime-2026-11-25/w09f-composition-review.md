# W09F — final production composition and remaining boundaries

Assignment **54/60**, wave **9** · 25 November 2026.

## Decision and current acceptance boundary

**No blocking production-composition defect was found in the reviewed interfaces.** The changes consistently separate ownership of current presentation from ownership of accepted work, and preserve the existing wire, recording and authored-physics boundaries. This conclusion is a source review supported by the specific executed stages below. It is not a complete release acceptance.

The reviewed executable source is [0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a][source]. During this review I independently retrieved [run 45645636058 and job 139315775862][job]. Its full ESLint stage, **1,351 unit cases across 95 files**, and all six baseline comparisons passed. TypeScript then rejected the new native desktop fixture's direct `window as BindingWindow` cast at line 101 with TS2352. The browser stages were skipped. The coordinator is correcting that intentional test-binding type assertion separately; this assignment changes no test or production source.

The coordinator subsequently published [394913934d3c6c9cfbe5ba5251beb7ebe68ee249][successor]. I independently inspected the complete two-commit comparison from 0bc: the incoming commit contains CI reports, and the successor changes only the fixture's intentional assertion to `window as unknown as BindingWindow` plus documentation/evidence. No production, workflow or dependency file changes appear in that comparison. The six successful 0bc probe objects and its failed full-gate result are retained under `evidence/0bc9543/`. This note does not claim that the successor's new gate has completed.

The failure therefore remains a real acceptance blocker for that exact checkpoint, without being evidence of a production storage failure. A corrected source still needs its complete compiler/build/native gate. Earlier complete success at 92e is historical evidence, not permission to call the later source green.

## Review method

I fetched the eighteen changed production modules at the pinned source and reviewed their integration seams: session start and record completion; atomic save mutation and desktop revision forwarding; server connection lifetime, queue expiry and packet ownership; worker clocks, delivery credit and flashback; radio frame ownership, controller retry and driving audio. I also read the unchanged host call sites in `src/main.ts`, the actual network composition test, the records transaction tests, and the relevant storage/worker review reports.

Protected host, model, renderer, protocol, vehicle and environment files were read only where necessary to understand a caller. This assignment authors only this report and creates no commit, branch or ref. No local executable environment was available, and no new local test or benchmark was run.

The separate [protected-path audit][protection] is responsible for commit attribution and retained animation blobs. The separate [measurement report][measurements] supplies detailed operation counts. This review focuses on how the contracts fit together.

## Session replacement and accepted records

`SessionStartOwner` revokes its run before abort listeners or disposal can reenter. Prompt cancellation races the caller's wait without abandoning observation of the original completion. A late created session is disposed rather than adopted; a late failure cannot fail a replacement owner. The generation check after cleanup and after host recovery prevents an old recovery path from restoring shared UI after a new start was admitted.

This ownership model fits the records change because the two lifetimes are deliberately different. `TimeTrialRecords` captures the accepted category options, store reference and private ghost arrays before player-name or lap-event callbacks can replace the session. The accepted write remains eligible to complete. Its player, delta and toast updates still require the original ownership predicate. Canceling presentation therefore does not discard a legitimate completed lap.

The current host supplies a predicate based on circuit generation, disposal and terminal error. It does not equate ownership with foreground visibility. For example, active-circuit page suspension explicitly retains the worker generation so the final pause receipt can still be consumed. A retained owner's pending save may consequently finish without that being a stale-owner violation. Screen-specific notification policy would need an additional host restriction; this patch does not silently impose one.

Atomic record transforms use the value read inside `SaveStore.update`. A slower/equal ghost and an excluded eleventh equal-time leaderboard entry return the exact stored reference, so they cause neither a record write nor a desktop revision reservation. Stable insertion reports the new entry's actual position after equal predecessors rather than locating an indistinguishable tuple afterward.

The compatibility fallback serializes the full read/transform/write operation per store object and key, and releases that queue after rejection. Its limit remains explicit: wrappers or tabs that do not share that object need the atomic store API. Leaderboard and ghost are separate key transactions; one can succeed when the other fails. Accepted persistence is not an all-or-nothing lap bundle.

Sources: [startup owner][startup], [record lifecycle][records], [leaderboard][leaderboard], [unchanged host][host], [record transaction tests][record-tests]. The inspected 0bc job records all 24 cross-mode startup and 17 record transaction cases passing.

## Local commit and desktop recovery are separate acknowledgements

The save path has a clear transaction boundary. Changed updates and both write forms read the persisted desktop revision in the same readwrite transaction that stores their data. A changed atomic updater must return synchronously. Updater failure, clone failure, revision-read failure or revision exhaustion aborts that transaction; no desktop notification is issued before completion. The private mirror payload is isolated from the caller and from the updater result returned after commit.

**A resolved SaveStore promise confirms local IndexedDB commit. It does not confirm desktop IPC acknowledgement or file flush.** `DesktopMirror.written` starts or queues asynchronous forwarding, while record success messages follow the local save promise. That is a useful durability contract, but documentation must not call every “saved” toast a synchronous native-file acknowledgement.

The revised mirror keeps three meanings separate: a high-water reservation number, the last committed local revision known to this owner, and the acknowledged complete native predecessor. This distinction composes with both transaction abort and independent owners:

- An aborted reservation can leave a number gap without pretending that local data committed.
- A foreign persisted revision blocks incremental forwarding, including when its number equals an earlier aborted reservation.
- A returning A owner after B's write also detects that its native prefix is incomplete.
- Failed full reconciliation cannot be concealed by a later one-key delta.
- Local commits continue while forwarding is blocked, retaining the newer complete local source for later reconciliation.

Blocking preserves an older complete file prefix; it does not immediately make that file current. Recovery requires a later successful reconciliation, such as a new owner or reopened connection. The application normally shares one SaveStore. This work does not add a global multiwriter coordinator for full snapshot reads, revision reservation and native seeding. Those operations still span separate asynchronous transactions/calls, so simultaneous full reconciliation and intervening writes remain outside the guarantee.

Modern file-service completion checks complement the renderer's ownership check. A valid native predecessor alone cannot discover a locally omitted B write. Legacy forwarding still lacks the modern completion certificate and compares contents during reconciliation. The repaired integration fixture now exercises that actual legacy comparison instead of accidentally forwarding after an absent `load()` failed initialization.

Sources: [SaveStore][save], [DesktopMirror][mirror], [storage review][storage-review], [repaired persistence test][persistence-test]. The 0bc job records all 16 revision-ownership cases and all 14 persistence integration cases passing. Its native desktop recovery cases did not execute because compilation failed.

## Network connection, command and packet ownership

The server cleanup order and EventLoop retirement fit together without changing event timing. A connection's local links and owned deadline are revoked before external close callbacks run. Handler identity checks detach only that connection's functions. A phase observer or earlier close callback can install a successor without old cleanup removing or closing it.

Canceled deadlines now leave the lookup map immediately. Their heap slots remain until due, preserving ordering, clock progression and the existing meaning of `pending`. Callback nulling already released captured payloads before this change. The new gain is earlier lookup-entry retirement, not heap compaction or a promise that `pending` counts only live callbacks. Server teardown can correctly have no runnable callback while the event heap still contains canceled slots.

The queue's expiry cursor remains an internal work bound. It does not change receipt acknowledgement, first-writer command ownership or the edge-control flag. A partly late command can supply remaining level controls without reviving its expired first-tick shift. Large sparse tick jumps retain the key walk when walking numeric positions would exceed the resident queue depth. Rejoin replaces the input queue and waits for fresh commands; old receive, close and deadline callbacks cannot own the replacement.

Voluntary leave still forfeits rejoin rights. Process disposal plus connection loss models a recoverable departure. The positive recovery fixture and the negative voluntary-leave case now exercise those distinct contracts rather than changing production policy to satisfy a test.

The new consuming writer is compatible with the server's existing packet boundary. Every recipient's packet is fully encoded before the first external send. Ordinary FULL-flag mutation is restored in `finally`; prepared tables are internal to one captured boundary; queued batches retain independent recipient packets. A transferring transport can detach one output without detaching later writer storage or another recipient.

The defensive `finish()` API remains available. `finishOwned()` consumes exact-filled storage and resets the writer; spare capacity is trimmed. This is an explicit ownership choice, not a change to every writer call. Prepared packet assembly and the simulated transport still copy. Existing transfer accounting, prepared-recipient thresholds and client contracts must not be presented as newly invented by this session.

Sources: [server][server], [queue][input], [EventLoop][events], [writer][writer], [codec][codec], [network composition test][network-tests], [network review][network-review]. All three runtime network composition cases passed in the inspected 0bc job.

## Worker clocks, rewind and delivery credit

The scheduling change does not conflate lack of periodic work with lack of ownership. Paused, uninitialized and failed workers park the interval; unfinished resimulation remains runnable; a completed rewind waiting for surface credit parks again. Message handling and each actual interval callback reconcile ownership in `finally`. Timer-generation checks reject stale callbacks before they can run physics or disturb a successor.

Reacquiring a timer rebases wall time while retaining the admitted fractional tick. A long pause or blocked surface receipt therefore does not become catch-up simulation. The existing pause and flashback reset boundaries still determine when state is reset, and the extracted pump retains its original physics/recording body.

Delivery credit survives timeline replacement. A completed rewind cannot bypass the surface capacity simply because its frame is required. Its completion transaction waits for credit, then preserves flashback notification, surface and frame order. A valid final receipt can wake a live session that was resumed while waiting. Duplicate or stale receipts cannot free the successor's ticket.

Diagnostics likewise separate settings, cadence and delivery. Rebase preserves the latest enable choice and outstanding ticket but discards the old future sampling tick. Fresh initialization still disables inspection. ACK traffic can retire existing ownership even after a terminal worker failure; it does not revive the failed simulation. This distinction avoids both silent diagnostic disablement and unbounded copied samples.

The radio change is compatible with transferred frame reuse because it owns eight transition scalars, not the caller's frame buffer. It does not trim the historical cooldown map or change rewind caption policy. Diagnostics, radio and pooled frames therefore keep different intentional retention boundaries rather than sharing one broad “clear everything on rewind” operation.

Sources: [worker][worker], [diagnostics][diagnostics], [worker review][worker-review], [radio][radio]. The 0bc run passed seven idle-scheduling cases and the diagnostic suites, but its new native interval witness remained unexecuted at this checkpoint.

## Controller and audio lifecycle

Controller retry re-arms fault notification only after an unsuppressed device/mapping owner reaches acquisition. Both input paths check the blocked mapping first. Replacing settings can obtain its own mandatory pause callback; ordinary focus/reset/resume does not admit the unchanged failed mapping. The host still owns the choice to replace a mapping, and physical-device compatibility is not established by supplied Gamepad-shaped test objects.

Driving cue vehicle identity comes from the recorded sample and the unchanged authored catalogue. Advice respects the selected gearbox and RPM points; it does not retune the transmission or edit a vehicle/model. Lazy guidance configuration copies validated settings and retains its track without building a route until eligible live human audio use. Required route construction remains synchronous at first eligible use, before the director validates that particular frame. A retained same-track route is intentionally reused across toggles.

Disposal clears route/track ownership synchronously, including before audio initialization or an asynchronous context close. A late close completion has no later write that could clear a newly configured route. This matches the session rule that a departed asynchronous cleanup must not revoke a successor's fields.

Sources: [controller][controller], [driving cues][cues], [audio owner][audio], [audio/input review][audio-review]. No physical speaker, autoplay, AudioWorklet or controller-driver claim follows from these source and focused test boundaries.

## Simulation and release conclusion

Lane and thermal changes compose without a new state or recording schema. The ring replaces FIFO bookkeeping while preserving candidate construction, ordering and height fallback. Its bounded resident-key array is a deliberate retention cost. Thermal skips repeated signature checks only for the actual frozen default; preparation still refreshes weather/timestep inputs and caller-owned parameter objects retain their earlier path.

Sources: [lane cache][lane], [thermal solver][thermal], [retained 0bc probe reports][current-probes].

The new 0bc probe stage passed the original-module comparisons again, including the real short Simulation composition. That supports exact checked outputs, not every venue, full races, cross-host arithmetic or hardware FPS. The one-second Simulation workload does not itself stress lane eviction; the separate eviction probe does.

The useful remaining limits are concrete: local commit versus asynchronous file acknowledgement; separate leaderboard/ghost keys; shared-object fallback queues; non-atomic full multiowner reconciliation; deferred first-use route cost; retained prepared/transport copies; canceled heap tombstones; and bounded rather than universal equivalence workloads. None justified an additional speculative production edit in this review.

The release condition remains a complete successful gate on the corrected executable source. Preserve the 0bc compiler failure as history, then attach the eventual compiler/build/native result to its own commit. A later documentation-only handoff can cite that accepted source after verifying unchanged runtime, tests, workflow and dependency inputs.

[source]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a
[job]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45645636058/job/139315775862
[protection]: w09c-protected-path-audit.md
[measurements]: w09b-measurements.md
[storage-review]: w08a-storage-review.md
[network-review]: w08b-network-review.md
[audio-review]: w08c-audio-input-review.md
[worker-review]: w08e-worker-review.md
[startup]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/session/session-start-owner.ts
[records]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/session/time-trial-records.ts
[leaderboard]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/storage/leaderboard.ts
[host]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/main.ts
[record-tests]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/tests/engine-records-transaction-order.test.ts
[save]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/storage/data.ts
[mirror]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/storage/desktop-mirror.ts
[persistence-test]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/tests/engine-persistence-integration.test.ts
[server]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/net/server.ts
[input]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/net/input.ts
[events]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/net/event-loop.ts
[writer]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/net/bytes.ts
[codec]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/net/codec.ts
[network-tests]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/tests/engine-network-runtime-composition.test.ts
[worker]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/workers/physics.worker.ts
[diagnostics]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/workers/diagnostics.ts
[radio]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/core/radio.ts
[controller]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/input/controller.ts
[cues]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/audio/driving-cues.ts
[audio]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/audio/engine.ts
[successor]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/394913934d3c6c9cfbe5ba5251beb7ebe68ee249
[lane]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/simulation/track-lane-index.ts
[thermal]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a/src/simulation/surface-thermal.ts
[current-probes]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/394913934d3c6c9cfbe5ba5251beb7ebe68ee249/docs/engine/runtime-2026-11-25/evidence/0bc9543/probes.json
