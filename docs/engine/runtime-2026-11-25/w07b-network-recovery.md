# W07B — network recovery boundary review

Assignment 38/60, wave 7. Reviewed engine source and existing acceptance at
`c482ad9ce9fdef02660e4880a027d83326c840c4`. The production network implementation
is unchanged by this assignment. The only proposed executable addition is one
focused real-client regression for voluntary forfeiture.

## Finding and disposition

**The failed twelve-recipient composition case used the wrong departure action.**
The coordinator's correction is consistent with the existing protocol:

- `RaceClient.leave()` deliberately sends the encoded `leave` control.
- The server handles that control through `forfeit()`, which permanently marks
  the player's token unreclaimable before disconnecting its current owner.
- `RaceClient.dispose()` retires local callbacks and timers without sending
  `leave`. A subsequent transport close represents departure of that process.
  The server's ordinary lost-connection path retains rejoin eligibility.

The original test called `leave()` and then required the same token to reclaim
car 11. Its observed `car === -1` is consistent with rejection before the client
receives a grid. The correction should change the fixture's departure to
`dispose()` followed by `transport.close('connection lost')`; it should not
relax the server's forfeiture check.

The coordinator owns that edit in
[the composition test](../../../tests/engine-network-runtime-composition.test.ts).
This assignment does not duplicate or overwrite it.

Primary inspected source:

- [Client departure and disposal](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/c482ad9ce9fdef02660e4880a027d83326c840c4/src/net/client.ts)
- [Server control, rejoin, disconnect and forfeiture](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/c482ad9ce9fdef02660e4880a027d83326c840c4/src/net/server.ts)
- [Ordered deterministic transport](https://github.com/cheshmakzanoon-ops/Experiment-3/blob/c482ad9ce9fdef02660e4880a027d83326c840c4/src/net/transport.ts)

## Evidence actually observed

I independently fetched the decoded log for
[workflow 45635583065, job 139280008453](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45635583065/job/139280008453).
It reports 1,127 passing tests and one failure in 85 files. The failed assertion
is the replacement client's car at line 256 of the original composition test:
expected 11, received -1. The other two cases in that file passed. This was a
failed unit gate; it provides no accepted result for the later baseline,
compiler/build or native-browser stages.

The log does not record the replacement client's rejection reason at that
assertion. The forfeiture diagnosis comes from the inspected client/server
control path, not an invented log field.

No local shell or runtime was available. This assignment does not claim to have
executed the coordinator's correction or the additional test.

## Review of the assertions after reconnect

I traced the remaining composition assertions through the actual event loop,
transport, input queue, server and client implementations. No further source
contradiction was found.

### Delivery and snapshot boundaries

The fixture uses the production deterministic event loop and seeded simulated
transport with `PERFECT_LINK`. That configuration adds no latency, loss,
duplication or reordering. Reliable messages with equal delivery times retain
their schedule order. Running the loop through the current time therefore
processes the replacement's join, welcome and grid without requiring an
arbitrary wall-clock wait.

A one-millisecond grid countdown starts 120 Hz physics. The server publishes
every six ticks. Tick 6 occurs before the departure at simulated time 100 ms;
tick 18 occurs after departure and before reconnect at 160 ms; tick 24 occurs
after reconnect. The expected recipient counts 12, 11 and 12 therefore exercise
the actual shared-preparation threshold in both directions. The physical field
still has twelve cars throughout.

This timing reasoning is source review. It is not a new runtime observation.

### Queue reset and the first returning packet

Rejoin replaces the player's input queue, clears the prior connection's echo
by using a fresh connection, and holds AI control until a new command applies.
The replacement client starts without a synchronized snapshot clock, so it
cannot issue its ordinary input commands before its first returning snapshot.
Consequently that first packet's fresh queue ACK of -1, echo of zero and
no-slack sentinel of 127 are consistent with the intended sequence.

After the first snapshot, the real client synchronizes its clock, samples and
sends controls, and the server can hand the car back. The test retains an
actual acknowledged-command check, rather than treating a successful welcome
alone as recovery.

The player's ghost flag is cleared during accepted rejoin, before human
controls resume. Thus tick 18 should carry GHOST for the disconnected car,
while tick 24 should not. AI handback and ghost presentation are separate
state transitions; the assertions preserve that distinction.

### Retired callbacks and delivery owners

The saved receive and close functions belong to the actual original server
connection. Ordinary loss marks it closed, removes it from active connections,
detaches only its own transport handlers and clears its join-deadline handle.
Those saved functions then exit through the closed-connection guard.

Successful rejoin clears the replacement's join deadline before publishing
welcome. A retained old deadline callback compares against the connection's
current deadline field; after cancellation it cannot close the replacement.
The composition assertions exercise these exact callbacks after recovery.

Teardown similarly revokes every connection and deadline before external
phase/close observers run. The existing server ownership suite additionally
covers throwing observers, throwing close operations, a reentrant replacement
and transports already owned by a newer server. Those are useful independent
failure cases and were not duplicated here.

### Packet ownership

The snapshot observer transfers each whole packet's backing buffer before
delivering it through the actual simulated transport. Later equality checks
therefore verify detached senders, distinct retained packet backings and
unchanged packet contents. The real transport still performs its own delivery
copy; this is not a claim of zero-copy networking.

The field comparison normalizes only recipient-specific FULL fields. The
server prepares all recipient-owned packets before the first external send,
and ordinary encoding removes the temporary FULL flag in a finally block.
The twelve/eleven/twelve case combines that packet ownership with a real
recipient departure and return, rather than testing encoding in isolation.

## Added negative recovery contract

[engine-network-recovery-boundaries.test.ts](../../../tests/engine-network-recovery-boundaries.test.ts)
adds one case using two real clients, the real server, codecs, event loop and
simulated transport.

The driver voluntarily leaves an active race. The test requires local shutdown,
server-handler detachment, one AI/ghost takeover and an unreclaimable token.
It then invokes the actual retained receive/close callbacks and attempts a
new connection with the saved token. That connection must be rejected with
`unknown or forfeited session token`, remain without a car, and release its
transport handlers.

Meanwhile the other client must keep receiving advancing snapshots and
acknowledgments, with the departed car still AI-driven and ghosted. No invalid
message, transport failure or kick is allowed to explain the rejected rejoin.

This complements the repaired positive recovery case. Existing resilience and
bounded-history suites already cover ordinary lost-process recovery, delayed
rejoin, live-holder refusal, account binding, rejoin-window expiration and
input ownership. Adding another positive loss/rejoin test would have repeated
those contracts. The direct deliberate-exit rejection was the useful missing
negative case exposed by this failure.

## Validation and scope

Suggested integrated execution includes the new test, the repaired composition
test, server-owned-deadline tests and existing client/resilience suites. The
coordinator's focused workflow already selects the new `engine-*.test.ts` file.
Its eventual result must be recorded separately from this static review.

Only the new test and this report are authored by assignment 38. No production
source, protocol, renderer, character, model, environment, authored asset,
offroad code, existing motocross test, commit or branch reference is changed.
