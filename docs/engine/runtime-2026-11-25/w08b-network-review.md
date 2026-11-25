# Wave 8B — Independent network production review

Assignment 44/60. Review date: 2026-11-25.

## Verdict and scope

**No blocking defect found in the reviewed changes.** The accepted network implementation has direct hosted execution evidence at `92e2dc2ed2f4959011bb84816e90506cefed774d`. The additional EventLoop cancellation change is consistent with its existing scheduling contract on source review; its execution evidence must come from the subsequent gate.

This review compared `src/net/input.ts`, `server.ts`, `bytes.ts`, and `codec.ts` against the session baseline, `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`. It also inspected the actual client, simulated transport, authoritative controls, snapshot layout, relevant tests, probe implementation and accepted job log. No production or test file was changed by this assignment.

During review, the EventLoop candidate was integrated at `e2d1fec2ff3b38a2cf962e9974cfe0622259823b`. I independently fetched that source: all four reviewed network files remain identical to the accepted checkpoint, and its EventLoop is identical to candidate blob `429f76ea53c118ce46bd077086629399b52f7be4`. This report does not extend the earlier successful run to the later commit.

Sources: [baseline commit][baseline], [accepted commit][accepted], [integrated commit][integrated], [accepted hosted run][run].

## Input expiry, acknowledgements and edge controls

The queue change adds a lower bound, `expireFrom`, for pending ticks. Every new slot lowers the bound when necessary. A successful expiry removes all pending ticks up to and including the requested tick, then records the next possible tick or Infinity if empty. It reads the returned slot before deletion. This preserves the existing returned controls reference and first-writer ownership for overlapping commands. A backward read cannot resurrect an expired slot, while admitting a genuinely older pending slot rewinds the bound so a later read can remove it.

The numeric walk is bounded by current pending depth: it is selected only when `tick - expireFrom < pending.size`, making the inclusive number of delete calls at most that size. Otherwise the code visits the map's existing keys. A sparse jump across the unsigned wire range therefore does not walk that entire range. The unsigned tick checks remain unchanged. The post-expiry bound cannot conceal a surviving earlier tick because every tick at or below the read was removed.

Receipt, deduplication, sequence-window rejection, slack collection, late statistics, and ACK gap advancement retain their original code. A received command may be acknowledged even if all of its ticks have already expired; ACK is not proof of application. The existing bounded gap rule still advances past a missing sequence when its received successor has started.

A partially late command keeps level controls for its remaining ticks, but none of those slots is marked as its original first tick. The server passes that first flag through to `AuthoritativeWorld.setControls`, which clears shift from held levels and emits a shift edge only on the first tick. This prevents late admission from manufacturing an expired shift, pit or overtake edge. The production composition case deliberately delays sequence 0, admits its remainder, and observes only sequence 1's shift. Its accepted run also checks negative slack, duplicates and ACK progress.

The baseline probe compares eight traces, including sparse jumps, backward reads and admissions, unsigned endpoints, reordered late commands, and three seeded streams. All report compatibility and instrumentation parity. In the 248-slot dense trace, pending-key visits fall from **30,876 to zero**, with **248 delete calls in both variants**. The sparse-jump trace changes seven visits to four with four deletes in both. These are measured queue operations. The dense workload uses 31 commands at the public queue API; it does not claim that a wire packet can exceed the 16-command limit. In seeded sparse traces, the new numeric path sometimes issues more delete calls against empty positions; its bounded combined expiry work is the relevant measure.

Sources: [queue implementation][input], [authoritative controls][authority], [queue probe][queue-probe], [composition test][composition], [accepted job][job].

## Connection deadlines, cleanup and reentrancy

Each server connection now retains its installed message and close callbacks and its join deadline handle. Successful join and rejoin cancel the owned deadline before sending welcome. Close, loss, disconnect and replacement release their callback ownership; stale callbacks still encounter the existing closed-connection guard.

Cleanup detaches a callback only if it is still that connection's function. This preserves a replacement server or connection that has reused the transport. After detachment, external callbacks may install another owner; the subsequent close checks that both handler slots remain empty before closing. This ordering matters during teardown phase observers and during an earlier peer's close callback.

Countdown and results deadlines have the same handle-identity check as join deadlines. Their callbacks clear local ownership before beginning the phase action. Teardown marks the session terminal, revokes the connection/player links and clears queued snapshot batches before invoking external cleanup. It cancels recurring and one-shot work and releases all connection callbacks before notifying the phase observer. Cleanup attempts continue after a throw and preserve the first failure. The 14 accepted server-deadline cases cover successful join, four departure/rejection routes, transport failures, countdown/results cancellation, replacement ownership and reentrant teardown.

The existing rejoin behavior remains deliberate: process or connection loss can permit recovery, while voluntary `leave()` forfeits the token. The repaired composition test uses `dispose()` plus transport connection loss. It does not weaken the production forfeiture check. Replacement creates a fresh queue, resets command ownership, and holds AI control until a new command arrives. The accepted test retains old real receive/close callbacks and the canceled join callback, invokes them after replacement, and verifies that the replacement survives.

Sources: [server implementation][server], [server ownership tests][server-tests], [client implementation][client], [composition test][composition].

## Packet ownership, FULL flags and copying

The public defensive `ByteWriter.finish()` remains unchanged: it returns a copy and leaves the writer reusable without resetting its contents. The separate `finishOwned()` consumes the writer. An exactly filled nonempty buffer moves to the caller; spare capacity is trimmed through a copy. The writer resets to shared empty storage, and later writes allocate independently. Empty results are fresh arrays, so transferring one cannot detach the shared reset buffer.

Input encoding already calculated exact capacity at the baseline; this session removes its final defensive copy. Ordinary snapshot encoding now calculates capacity from the actual compact/FULL layout: one tag, a 22-byte header, 39 bytes per compact car, and 12 additional bytes per FULL car. Prepared encoding also consumes its exactly sized output. No wire layout or decoder behavior changes are part of this patch.

Prepared car tables remain internal to a captured boundary. Their creation overrides FULL for the full representation and clears it from the compact representation without mutating the captured car objects. Each recipient packet copies the shared portions into its own writer. The actual server constructs every recipient packet before its first external send; a reentrant capture cannot overwrite an earlier recipient's bytes. The ordinary path temporarily sets the owning car's FULL flag and clears it in `finally`. The composition test exercises the server's existing 12-recipient prepared path, 11-recipient ordinary path, and return to 12. It verifies exactly one FULL car per recipient, identical compact field state, and ghost/rejoin transitions.

The historical-source codec probe passed **51 input cases, 396 ordinary snapshot cases, 96 prepared boundaries and 1,584 recipients**. Its prepared outputs are compared against the actual baseline ordinary encoder, providing an independent encoding path. Its ownership checks cover exact backing length, retained packets, source mutation, peer independence, whole-buffer transfer and writer reuse.

The measured copy/backing counts require precise wording:

| Workload | Baseline | Accepted candidate |
| --- | ---: | ---: |
| Two-command input: counted copied bytes | 36 | 0 |
| Two ordinary 12-car recipient packets: backing bytes | 2,318 | 1,006 |
| Same ordinary boundary: counted copied bytes | 1,006 | 0 |
| Twelve prepared 12-car recipient packets: backing bytes | 13,764 | 7,116 |
| Same prepared boundary: finishing slice bytes | 6,648 | 0 |
| Same prepared boundary: assembly set bytes | 6,228 | 6,228 |
| Same prepared boundary: total counted copied bytes | 12,876 | 6,228 |

This is **not an end-to-end zero-copy network**. The existing simulated transport copies submitted packets and separately copies duplicate deliveries. Prepared assembly still copies. The probe excludes scalar DataView writes, zero-byte buffers, module initialization, JavaScript objects, transport copies and engine heap/GC. Its timing samples are descriptive, with no performance acceptance threshold; they do not establish general frame-rate, latency or total-memory improvements.

The current client and transport are byte-identical to the session baseline. Capturing an input packet's length before a transferring transport detaches it is an existing client contract, not an improvement introduced here. It remains important integration coverage for the new consuming encoder.

Sources: [writer][bytes], [codec][codec], [wire layout][snapshot], [server][server], [client][client], [transport][transport], [ownership tests][codec-tests], [codec probe][codec-probe], [accepted job][job].

## EventLoop cancellation candidate

The sole production change to the accepted EventLoop is deleting the canceled handle from `queued` after nulling its callback. Callback nulling already released captured payload references at the accepted checkpoint. The new gain is earlier retirement of the **lookup entry**, not new callback-payload release or heap compaction.

The heap tombstone remains in place, preserving `pending`, due ordering, same-time sequence ordering, partial drains and clock behavior. Repeated cancellation becomes a harmless missed lookup. `pop()` already removes the running event from the index before invoking its callback, so canceling oneself or throwing during that callback does not leave an indexed running handle. Recurrence stopping retains its existing stopped flag and owned next handle; the change does not introduce external callbacks between lookup and deletion.

I inspected all seven proposed cases in `tests/engine-event-retirement.test.ts`: 4,096 canceled future handles; three independent sorted-list trace comparisons; stopped recurrence churn; a canceled successor followed by a throwing callback; and 128 real server connection-loss cycles. The tests explicitly retain heap tombstones and distinguish map-entry retention from callback ownership. Their asserted counts are **test expectations at review time**, not measurements from the accepted 92e run, which predates this patch.

The integrated candidate still requires the new hosted gate. It should include the existing event-loop ownership and transport lifetime suites, as the parent has arranged. No claim of zero retained scheduled slots, measured memory bytes, faster CPU execution or hardware performance follows from this source-only review.

Sources: [integrated EventLoop][event-loop], [new cancellation tests][event-tests].

## Observed validation and remaining boundary

I independently fetched workflow **45637677573**, confirmed its head is **92e2dc2ed2f4959011bb84816e90506cefed774d**, and read job **139287423560**. It completed successfully with **1,135 tests in 86 files**, **six baseline probes**, full TypeScript checking and production build, and **57 native browser cases**. The log includes all three runtime network composition cases, 14 server ownership cases, 11 codec ownership cases and seven queue-expiry cases. The native network transfer case also passed.

The probes load only their declared historical modules from dda5 into the candidate dependency graph. They are not whole historical builds. Their records identify baseline/candidate source and bundle hashes, Node v22.23.5, esbuild 0.25.12, and a clean tracked state within the declared scope. The helper checks that declared targets loaded and remained unchanged during bundling. It does not independently freeze every transitive dependency.

Browser evidence used Mesa llvmpipe software rendering. The successful run predates the new EventLoop integration, and no local executable workspace was available to this reviewer. The report therefore accepts the observed checkpoint, records a favorable source review of cancellation retirement, and leaves that later runtime gate explicitly pending.

[baseline]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc
[accepted]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/92e2dc2ed2f4959011bb84816e90506cefed774d
[integrated]: https://github.com/cheshmakzanoon-ops/Experiment-3/commit/e2d1fec2ff3b38a2cf962e9974cfe0622259823b
[run]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45637677573
[job]: https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45637677573/job/139287423560
[input]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/net/input.ts
[authority]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/net/authority.ts
[server]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/net/server.ts
[bytes]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/net/bytes.ts
[codec]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/net/codec.ts
[snapshot]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/net/snapshot.ts
[client]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/net/client.ts
[transport]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/src/net/transport.ts
[queue-probe]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/scripts/engine-runtime-probes/queue-probe.mjs
[codec-probe]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/scripts/engine-runtime-probes/codec-probe.mjs
[composition]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/tests/engine-network-runtime-composition.test.ts
[server-tests]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/tests/engine-server-owned-deadlines.test.ts
[codec-tests]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/92e2dc2ed2f4959011bb84816e90506cefed774d/tests/engine-codec-buffer-ownership.test.ts
[event-loop]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/src/net/event-loop.ts
[event-tests]: https://github.com/cheshmakzanoon-ops/Experiment-3/blob/e2d1fec2ff3b38a2cf962e9974cfe0622259823b/tests/engine-event-retirement.test.ts
