# Engine architecture and maintained contracts

Assignment **55/60**, wave **10** · 25 November 2026

This guide explains the engine changes in the source through `0bc9543fa6d10a614f42d3df1fa5bf3b44e2154a`. It is a maintainer's map of behavior and ownership. Consult the [overview's acceptance section](README.md#acceptance-and-delivery-status) and [release evidence](w10e-release-evidence.md) for the source that actually passed the complete gate; authoring this guide is not a new execution result.

The common design decision is to assign each piece of asynchronous or retained work a precise owner. A saved value belongs to its committed transaction. A host callback belongs to a session generation. A timer belongs to its current interval or connection. A packet belongs to its recipient. Optimizations then remove work whose ownership or necessity can be established without changing the authoritative outputs.

## 1. Production map

Only these 18 production files are part of this task's implementation:

| Subsystem | Changed files | Maintained contract |
| --- | --- | --- |
| Save mutation | [storage/data.ts](../../../src/storage/data.ts) | Transform and persist a record in one native transaction; publish after commit |
| Desktop recovery | [storage/desktop-mirror.ts](../../../src/storage/desktop-mirror.ts) | Incremental forwarding requires a known complete native predecessor |
| Accepted records | [session/time-trial-records.ts](../../../src/session/time-trial-records.ts), [storage/leaderboard.ts](../../../src/storage/leaderboard.ts) | Accepted persistence and current presentation have separate lifetimes |
| Startup | [session/session-start-owner.ts](../../../src/session/session-start-owner.ts) | Only the admitted run may adopt a session or recover host state |
| Network expiry | [net/input.ts](../../../src/net/input.ts) | Expiration preserves ACK, level-control and edge-control semantics |
| Server/event ownership | [net/server.ts](../../../src/net/server.ts), [net/event-loop.ts](../../../src/net/event-loop.ts) | Retired connections and callbacks cannot revoke a replacement owner |
| Packet output | [net/bytes.ts](../../../src/net/bytes.ts), [net/codec.ts](../../../src/net/codec.ts) | Consuming output owns exact packet storage; defensive output remains reusable |
| Worker lifecycle | [workers/physics.worker.ts](../../../src/workers/physics.worker.ts), [workers/diagnostics.ts](../../../src/workers/diagnostics.ts) | Runnable work owns one periodic interval; delivery credit survives timeline rebasing |
| Radio | [core/radio.ts](../../../src/core/radio.ts) | Previous transition inputs are owned independently of a transferred frame |
| Controller | [input/controller.ts](../../../src/input/controller.ts) | A new admitted mapping/device can report its own fault; a suppressed mapping stays suppressed |
| Guidance audio | [audio/driving-cues.ts](../../../src/audio/driving-cues.ts), [audio/engine.ts](../../../src/audio/engine.ts) | Advice follows recorded vehicle limits; routes exist only for eligible use |
| Simulation efficiency | [simulation/track-lane-index.ts](../../../src/simulation/track-lane-index.ts), [simulation/surface-thermal.ts](../../../src/simulation/surface-thermal.ts) | Bookkeeping changes preserve the compared geometry and thermal outputs |

The [protected-source audit](w09c-protected-path-audit.md) enumerates the exact changes and parent identities. Host wiring, authored data and related engine modules may be read to understand these contracts without becoming part of the write scope.

## 2. Saves: the transaction is the publication boundary

### Atomic mutation

`SaveStore.update(key, updater)` reads the value, invokes the updater synchronously in the request success callback, and queues any changed value in the same IndexedDB `readwrite` transaction. The returned promise resolves only after transaction completion. Request success alone is insufficient because a later request or commit can still fail.

The updater's identity result has a specific meaning:

| Updater result | Effect |
| --- | --- |
| Exact stored reference | No write, revision reservation or desktop publication |
| New value, including an equal fresh object | Queue a real write |
| Thrown error | Abort and reject |
| Promise or other thenable | Abort and reject; observe its eventual rejection separately |

An updater must return a new value to save a change. Mutating the stored reference in place and returning it does not persist that mutation. Asynchronous updating is rejected because an await cannot safely extend this transaction's active request boundary. Clone, request and revision-stamp failures abort rather than publishing a partial mutation.

Desktop writes capture a private structured clone for forwarding. The caller's retained object and the updater's returned object therefore cannot later mutate the mirror's queued payload. Browser-only writes retain ordinary IndexedDB request-time cloning. The database version and file format are unchanged. A resolved SaveStore promise confirms the local IndexedDB commit; desktop forwarding, acknowledgement and file flush remain asynchronous. Record success notifications follow that local commit boundary. See the [atomic update implementation](w02d-atomic-storage.md), [storage review](w08a-storage-review.md) and [faithful persistence fixture repair](w09a-integration-recovery.md).

### Desktop revision ownership

All three changed-write APIs—`write`, `writeWithBackup` and `update`—read the persisted revision inside the transaction that writes their data. The mirror tracks three different facts:

| Field | Meaning |
| --- | --- |
| `revision` | Highest observed or reserved number; aborted reservations can leave gaps |
| `localRevision` | Last committed local state this owner knows |
| `acceptedRevision` | Complete native predecessor acknowledged to this owner |

A persisted revision that differs from `localRevision` reveals an intervening owner. The new local write can still commit, but that mirror blocks incremental forwarding and clears queued deltas. Separating committed state from reservations also detects a foreign commit whose number happens to equal an earlier aborted reservation.

The A→B→A case explains why unique numbers alone were insufficient. A can first forward revision 7. B then commits local revision 8 without forwarding. If A subsequently sent revision 9 against native predecessor 7, a native service checking only numeric predecessors could accept it while omitting B's data. The returning-owner check makes A wait for a complete reconciliation too.

A failed full seed or restore similarly blocks later deltas. Successful reconciliation establishes a complete predecessor and permits forwarding again. Safe-integer exhaustion aborts allocation before an invalid revision is stored or sent. The production native service's predecessor and completion-certificate checks remain complementary safeguards. See [desktop recovery design](w07a-save-recovery.md) and [independent storage review](w08a-storage-review.md).

This is not generic atomic multiwriter reconciliation. Reading a whole local snapshot and reserving its seed revision still span separate transactions. The ordinary application uses one shared SaveStore and one desktop window; simultaneous full reconciliation and intervening writes remain an explicit architecture boundary.

### Acceptance boundaries

Controlled tests establish request/commit order, clone ownership, aborts, foreign revisions, reservation gaps and recovery. The additional native desktop scenarios use independent same-origin pages and actual IndexedDB transactions, then flush and reopen the production Node save service's real temporary files. Their Playwright binding is a labeled test transport, not Electron IPC. The [native recovery report](w07f-native-save-recovery.md) describes the exact sequences and the [release record](w10e-release-evidence.md) records their eventual execution.

## 3. Accepted records and presentation have different lifetimes

A valid completed lap captures its options, store reference and any improved ghost's sectors/samples before application callbacks can replace the session or mutate the original data. Persistence already accepted at that point may finish after replacement. Notifications, HUD state and player installation remain guarded by records/circuit ownership.

The preferred storage port uses the atomic update API. The ghost comparison runs against the value read within that operation, so an older or slower candidate cannot overwrite a faster compatible stored ghost through a stale preparation read. A non-improving ghost returns the stored reference and exercises the no-op path.

Embedding hosts with only read/write methods receive a per-store-object, per-key queue for the entire read/transform/write operation. Failure releases the queue without hiding the operation's rejection. Tail identity checks prevent an old completion from deleting a successor's queue entry. This fallback does not coordinate independent wrappers or tabs; those need the atomic port.

Leaderboard ties are inserted after earlier equal times, and rank comes from the inserted entry's actual position. Duplicate driver/session tuples or truncated names cannot identify the wrong equal-time entry. An eleventh tied entry excluded from the top ten returns rank zero and preserves the stored board.

Two boundaries are useful for callers:

- Leaderboard and ghost updates are separate key transactions; one can succeed while the other fails.
- Foreground-screen changes alone do not revoke the parked circuit's generation. An accepted completion toast can still appear over the menu or Festival under the existing host policy.

See [records implementation](w02b-records-updates.md), [startup/records ownership review](w07e-startup-recovery.md) and [storage review](w08a-storage-review.md). Changing foreground notification policy would be a separate host decision.

## 4. Startup ownership begins before a module exists

`SessionStartOwner` installs its run before calling the loader. Duplicate or reentrant startup therefore sees an owned run even while the lazy import is pending. The supplied scope exposes an AbortSignal, a current-owner predicate and guarded host callbacks.

Cancellation revokes `this.run` before dispatching abort or disposing an adopted instance. Synchronous cleanup can then admit a successor without leaving the old scope current. The caller races completion with cancellation, so a loader or factory that never settles cannot hold the canceled caller open.

The completion operation remains observed after cancellation. A late import cannot start creation, a late created session is disposed rather than adopted, and a late rejection cannot fail the successor. Each finalizer clears only its own run's starting field.

Genuine startup failure has a separate settlement path. It removes the cancellation waiter before cleanup aborts the run, preserves the original failure, attempts host recovery even if disposal throws, and checks generation after reentrant boundaries. If recovery also throws, an AggregateError retains both failures and the original cause.

These guarantees release ownership and settle callers; they do not forcibly terminate a dynamic import or undo asynchronous effects already started by an admitted callback. Direct cancellation also retains its synchronous disposal-error behavior. See the [startup change](w02c-startup-failure.md), [native cancellation scenarios](w04b-native-startup.md) and [host integration review](w07e-startup-recovery.md).

## 5. Network work is bounded by the data actually pending

### Queue expiry

The input queue retains a lower bound for pending ticks. Dense sequential expiry can walk the small numeric range directly; sparse jumps use the existing keys when that walk would exceed current depth. Backward admission lowers the bound when needed, and expired reads cannot resurrect old controls.

The optimization leaves command receipt, deduplication, ACK gap behavior, lateness and slack accounting intact. ACK describes receipt, not proof that every command tick was applied. A partially late command may supply remaining level controls while its expired first-tick edge stays expired. This preserves shift and other edge semantics through the real server/world boundary.

The [queue probe and implementation report](w05b-queue-probe.md) compare complete observations and retained control-reference ownership. Its instrumented work bound counts both key visits and deletion attempts; a numeric path may attempt deletion at an empty position. Counting only successful deletes would miss that cost.

### Server and event ownership

Connections own their join deadline and installed receive/close callbacks. Join or rejoin retires the deadline. Teardown detaches a callback only while it is still that connection's function, protecting a replacement that reused the transport.

Cleanup revokes ownership before external notification or close can reenter. Countdown and results callbacks likewise check their retained handle identity and clear it before acting. Stale callbacks cannot close or mutate a replacement owner. Voluntary leave still forfeits rejoin rights; process disposal followed by connection loss is the recoverable boundary used by the positive reconnect case.

`EventLoop.cancel` now removes the canceled handle's lookup entry immediately. Callback nulling already existed. The heap tombstone, pending count and due/sequence ordering remain unchanged until normal draining. This is earlier lookup retirement, not heap compaction or a measured reduction in retained memory bytes.

See [server ownership](w02f-server-ownership.md), [network composition](w04d-network-composition.md), [recovery boundaries](w07b-network-recovery.md), [event retirement](w07c-event-retirement.md) and the [independent network review](w08b-network-review.md).

### Packet storage

The two ByteWriter finishing APIs intentionally differ:

| API | Ownership after return |
| --- | --- |
| `finish()` | Caller receives a defensive copy; writer contents remain reusable |
| `finishOwned()` | Caller receives exactly filled storage, or a trimmed copy if capacity remains; writer resets to empty storage |

Subsequent writer use cannot mutate a consumed packet. Empty results are separate arrays, so transferring one cannot detach the shared reset buffer. Codecs allocate exact packet capacity from the unchanged input/snapshot layout before consuming the output.

Prepared snapshots still assemble independent recipient packets. Their FULL fields remain recipient-specific; the server constructs all packets for a boundary before its first external send, so reentrant capture cannot overwrite an earlier recipient. Prepared assembly and simulated transport retain their existing copying. The [codec report](w03f-codec-buffers.md), [historical-source probe](w05e-codec-probe.md) and [network review](w08b-network-review.md) specify the exact bytes and ownership checks.

## 6. Worker scheduling follows runnable work

The circuit worker keeps its existing stepping pump and changes interval ownership around it. The reviewed old interval callback and extracted pump body are byte-identical. Physics integration, watchdog work, recording cadence and normal publication keep their prior implementation.

| Worker condition | Periodic physics interval |
| --- | --- |
| Uninitialized or initialized and paused | Parked after bootstrap reconciliation |
| Failed owner | Parked |
| Live simulation | One current interval |
| Active resimulation | One interval even while normal play is paused |
| Rewind completed but final surface credit unavailable | Parked |
| Matching final surface ACK after early resume | Completion publishes; runnable live work reacquires an interval |

Normal message handlers and owned interval callbacks reconcile scheduling in `finally`. The finishing rewind callback can therefore retire its own timer without relying on a later recycle or pause message. Repeated resume keeps the current owner. Cancellation advances a generation; an old queued callback returns before stepping or disturbing a successor.

Acquisition rebases wall time while preserving the clock's admitted fractional tick. A long pause or blocked completion does not become catch-up work, and a valid pre-pause fraction is not discarded. The existing work budget remains; one indivisible physics tick can still exceed it.

The worker's surface-credit protocol is unchanged. Completion waits at the actual bounded capacity, and a valid ACK can publish the ordered flashback notification, matching surface and frame directly. The native idle fixture observes actual registration/cancellation; controlled tests supply forced stale callbacks and the full 120-packet adversary. See [idle scheduling](w06e-worker-idle.md), [native idle witness](w07d-native-idle.md) and [worker review](w08e-worker-review.md).

### Diagnostic rebasing

Flashback rebasing preserves the latest engineering-enable choice and outstanding delivery ticket while clearing the old sample cadence and advancing the timeline epoch. The original ticket's epoch/sequence remain the only valid acknowledgement for that outstanding credit. A duplicate old ACK cannot release a successor ticket.

Fresh initialization still resets inspection to disabled. Outstanding credit blocks payload construction before another diagnostic copy is made. The [diagnostic change](w06b-flashback-diagnostics.md) and [native diagnostic case](w06d-native-diagnostics.md) cover the distinction between a new session and a new timeline within one session.

## 7. Smaller retained state and fewer repeated checks

### Radio history

The radio now owns the eight previous values actually needed by transition detection: car count, safety-car phase, local flag, cumulative penalty, warnings, pit state, completed laps and fuel. It captures current history before arbitration in the same order as before and retains no supplied frame or buffer.

Caption text, posting order, timing, cooldown and reset behavior remain in the compared contract. The historical-module probe exercises reused and transferred buffers as well as changing car counts and rewinds. The sent-key cooldown map remains session-history-dependent; expiring it merely because forward time passed could change rewind behavior. See [compact history](w02a-radio-state.md) and [audio/input review](w08c-audio-input-review.md).

### Lane cache

Positive integral cache capacities use a ring of resident keys for FIFO eviction. Hits do not refresh age. New cells finish building before the cache or ring changes, preserving residents on build failure. Other capacities retain their prior policy.

The production paved capacity remains 2,048. The ring grows with residents and overwrites evicted slots; it adds bounded key references while avoiding a fresh Map key iterator at each eviction. Candidate geometry, height fallback, witness order and tie rules remain unchanged. The separate historical-module trace verifies substantial eviction, while short full-Simulation runs verify composition. See [lane implementation](w03d-lane-fifo.md) and [physics review](w08d-physics-review.md).

### Thermal solver

Only identity with the actual frozen `SURFACE_THERMAL` object enables the reduced signature-check path. Preparation still refreshes timestep and held weather inputs. Caller-owned parameters, including another frozen object, retain the previous path.

Rainfall-dependent matrix selection, per-cell advancement and arithmetic remain. The optimization skips redundant signature comparisons; it does not skip wet cells or claim that every avoided check was a matrix rebuild. The existing same-rain early return for mutable parameters also remains, so arbitrary edits are not promised to become visible immediately. See [thermal implementation](w03e-thermal-signature.md), [thermal probe](w05d-thermal-probe.md) and [physics review](w08d-physics-review.md).

## 8. Input and audio follow their active owner

Controller fault notification is re-armed when an unsuppressed mapping/device identity is acquired. Both input paths reject the currently suppressed pair before that acquisition boundary. Ordinary reset, focus or resume therefore cannot bypass suppression of an unchanged failed mapping, while a replaced mapping can produce its own pause callback.

Driving cues resolve the recorded vehicle identity and use its authored shift RPM and maximum forward gear. Formula thresholds retain their original strict ratios. Invalid present identity or gear data does not silently select a different powertrain, and top gear cannot advise another upshift. These changes affect advice, not transmission physics or tuning.

Guidance route creation waits for enabled, unmuted live human use with an audio context, positive cue volume and an enabled cue type. Same-track reconfiguration can reuse an existing route while resetting timing. Track replacement and disposal release old route ownership synchronously; a pending context close cannot clear a newly configured route.

The required route cost still occurs at first eligible use. Construction precedes the director's validation of that particular frame, so an invalid active frame is not a guarantee of zero route construction. Previously used same-track routes can remain retained across toggles. See [controller retry](w03a-input-retry.md), [vehicle cues](w03b-vehicle-cues.md), [lazy guidance](w03c-lazy-guidance.md) and [independent audio/input review](w08c-audio-input-review.md).

## 9. Maintain the evidence boundaries when extending the engine

The existing [focused gate](../../../.github/workflows/engine-runtime-validation.yml) connects these contracts to lint, units, six original-module comparisons, full typecheck/build and native browser acceptance. Its exact commands and environment belong in the [reproduction guide](w10b-reproduction.md); its accepted result belongs in the [release record](w10e-release-evidence.md).

| Contract being changed | Evidence that matters |
| --- | --- |
| Save transaction or mirror publication | Commit/abort and private-clone assertions; actual native IndexedDB completion; complete file recovery |
| Session or record replacement | Reentrant callback ownership, late completion, retained accepted persistence and successor state |
| Network queue or packet representation | Complete queue observations, edge controls, ACK semantics, exact wire bytes and independent recipient backing |
| Worker scheduler or diagnostic timeline | Fixed-step state, fractional time, stale callback generations, bounded credits and actual native transfer/timer behavior |
| Hot-path geometry or thermal bookkeeping | Original-source comparison, finite exact outputs, operation counts, and real Simulation composition |
| Guidance/input lifecycle | Suppression boundaries, vehicle limits, route creation/release and native offline PCM where applicable |

A comparator that shares the changed implementation cannot by itself prove independent equivalence. The historical-module probes address that problem for the declared targets, while retaining current dependencies on both sides. The closed native audio archive is a different historical boundary. The [provenance review](w09d-evidence-provenance.md) explains both.

A source audit and a runtime test answer different questions. Protected blobs can remain exact while a shared engine change still affects gameplay behavior; an engine test can pass while an unrelated content gate remains red. Preserve those distinctions, the failed intermediate runs, and the workload limits in the [measurements](w09b-measurements.md), [handoff](w10c-limitations-handoff.md) and [final review](w10f-final-review.md).

Only these two documentation files were authored by assignment 55. No production, test, workflow, model, character, environment or animation source was changed, and no branch or ref was updated by this assignment.
