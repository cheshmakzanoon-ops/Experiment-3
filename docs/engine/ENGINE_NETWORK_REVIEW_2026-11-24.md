# Network runtime integration review — 24 November 2026

## Findings and changes

The independent wave 10 review found terminal-lifetime defects in `RaceServer`.
Its public phase and tick observers could synchronously request teardown, but
the interrupted operation continued afterward:

| Observer boundary                | Observed preceding behavior                                                                         | Corrected behavior                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Grid phase                       | Constructed an authoritative world after teardown                                                   | The cancelled grid transition stops before construction                                                     |
| Race phase                       | Installed a recurring tick callback after teardown; one event remained after draining to 10 seconds | No new tick owner is installed                                                                              |
| Results phase                    | Constructed records/results and a linger deadline after an observer ended the session               | The interrupted results transition stops                                                                    |
| Final tick                       | Entered results after the tick observer had already torn down the race                              | `endRace` requires an active race                                                                           |
| Teardown observer throws         | Left connections open; subsequent teardown returned without finishing cleanup                       | Local ownership is retired, independent closes are attempted, and the first synchronous failure is rethrown |
| Acceptance after/during teardown | Installed another connection callback and join deadline on the terminal server                      | Sends the existing terminal rejection and closes without registering ownership                              |

The phase setter now reports whether its requested phase still owns the state
after notification. Grid construction, tick-loop creation and result creation
check that answer. A tick observer can no longer revive a terminated server at
the same tick as a race limit.

Teardown revokes its phase, connection associations and tick ownership before
calling observers or transport cleanup. It cancels the owned sweep and tick
callbacks, preserves the ordinary phase-observer-before-transport-close order,
attempts every independent close, and then rethrows the first failure, including
an `undefined` thrown value. A failed external transport close is not claimed to
have succeeded: the guarantee concerns local ownership and remaining cleanup.

The terminal acceptance guard preserves the reliable rejection text,
`the session has already started`, followed by the existing `session over`
closure reason. Rejection sending does not install callbacks or a join timer.
Close is still attempted if that send throws, and a later close failure cannot
replace the original thrown value. Acceptance during every other phase retains
the existing handshake and rejection behavior.

Production changes are confined to [`src/net/server.ts`](../../src/net/server.ts).
There are no protocol-format, cadence, default-rate, input-quantization,
vehicle-physics, model, character, authored-environment or asset changes.

## Composed checks

The new [`engine-network-integration.test.ts`](../../tests/engine-network-integration.test.ts)
uses the actual `RaceServer`, `RaceClient`, event loop, simulated transport and
codecs. Its lifecycle cases exercise observer-driven cancellation and cleanup
failure rather than substituting private server methods.

Two additional composed scenarios check the existing loss/recovery machinery:

- A completely lost join expires while a healthy connection remains in the
  lobby. A keep-alive already queued at the exact timeout can make one final
  bounded retry attempt before the close notification arrives; no retry growth
  or late join occurs after closure.
- Results delayed by complete downlink loss retain reliable FIFO ordering.
  After the server reaches teardown, recovery delivers the recorded results
  before graceful close. The client keeps the exact result digest, retires its
  timers and does not resume simulation or snapshot accounting.

The terminal-acceptance cases check both a later call and acceptance reentered
from the teardown observer. Real reliable-link delivery verifies that rejection
arrives before close. A separate failure case checks successful and failed
external closes after rejection sending throws.

## Verification

The initial direct Node reproductions used actual server/client code and showed
the unwanted world construction, orphan recurrence, terminal-to-results revival,
and open connections after an observer exception. A separate direct reproduction
showed callbacks and join deadlines being installed both after shutdown and from
inside its observer.

After restoration of the checkout, all **11 integration cases passed** on the
frozen final source. The four unchanged selected lifecycle/resilience cases also
passed (17 unrelated cases were deliberately filtered from that narrow run).
The latter selection covers ordinary lobby-to-results-to-teardown delivery, late
rejection, countdown reconnect, chunked event history and large classification
delivery. These 15 cases have no overlap with one another.

The source patch was recovered exactly after execution-host replacement. Most
test content was also recovered exactly; the loss-recovery tail of one case and
the final results-delivery case were reconstructed from the retained review
record and then verified in this fresh complete 11-case run. Earlier passes are
not used as a substitute for the restored-code result. The consolidated
[regression inventory](ENGINE_REGRESSION_INVENTORY_2026-11-24.md) will preserve
unique assertion identities and the final source hashes.

The preceding-server Vitest overlay attempts were host-terminated before test
results, as was a larger combined run. They are not counted as passing or failing
application assertions. The earlier completed checks used a 256 MiB Node heap and a single
Vitest thread; the restored-source runs use 768 MiB and one thread. The direct pre-change reproductions remain the failure evidence;
no assertion-failure count is inferred from a terminated run.

## Limits

These are deterministic in-process network and simulation checks. They do not
test a deployed multiplayer service, browser WebRTC/WebSocket implementation,
operating-system sockets or physical network devices. The existing simulated
transport's reliable payload queue still grows with queued sends; this review
does not add a queue quota. Cancelled event-loop heap slots retain their due-time
ordering until they are popped, although their callbacks are released.

Nonterminal observer exceptions continue to propagate to the caller; this change
does not define a new general observer exception policy. Native browser,
physical-device performance, full-suite CI and long-duration gameplay evidence
must be assessed separately. The fixes make no FPS or deployed-network
throughput claim.
