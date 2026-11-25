# W04D — network runtime composition

## Added coverage

Added only `tests/engine-network-runtime-composition.test.ts` and this report.
There are three narrowly scoped integration cases using the existing
`onlineFixture`: actual `RaceServer`, `RaceClient`, input command logs,
server input queues, authoritative world, binary codecs, `NetworkSimulator`
endpoints, and `EventLoop`.

The coverage review included `engine-network-composition`,
`engine-network-advancement-composition`, `engine-network-integration`,
`engine-server-owned-deadlines`, `engine-input-queue-expiry`,
`engine-codec-buffer-ownership`, and transport lifetime suites. Existing
coverage already exercises reentrant snapshot publication, faulty transport
sends, noisy links, command edges, and isolated deadline/buffer ownership.
The new cases join the revised runtime contracts at these specific boundaries:

| Case | Gap addressed | Required invariant |
| --- | --- | --- |
| Reordered live input command | The optimized expiry cursor was compared with a frozen queue in isolation; generic noisy traffic did not guarantee an older partial command arriving while its successors remained queued. | Delay all copies of the actual client's first command until its first tick has passed, deliver its remainder through the real endpoint, and retain later commands. The remainder's exact quantized levels apply, its expired shift does not, and the successor's shift applies once. Negative slack, duplicate accounting, ACK progress, recipient FULL ownership, packet transfer accounting, and record replay remain consistent. |
| Twelve, eleven, twelve recipients | Shared snapshot preparation and consuming buffers had direct codec tests; live replacement composition used fewer than the shared-preparation threshold. | Twelve real clients receive independent transferable packets. A process disconnect reduces recipients to eleven and token rejoin restores twelve, exercising both production encoding policies with one unchanged twelve-car field. Common car state agrees at each boundary, FULL belongs only to the recipient, GHOST tracks disconnect/rejoin, replacement ACK/echo state starts fresh, and saved old callbacks cannot alter the replacement. |
| Completed race plus silent join | Immediate deadline revocation mainly used hand-built peers, while older live race cleanup drained timers to their due times. | After two real clients receive the final result, add an actual silent endpoint and tear down. Sweep, results linger, silent join, and installed server handlers are released before the phase observer. Same-instant graceful close preserves delivered results; canceled future heap slots retain no callback. Saved callbacks cannot advance the world or republish work. |

The first case raises the client's legal lead to forty ticks after its first
snapshot. This makes the partial-late delivery deliberate: successor slots
exist before the held command's expired edge, so the test checks cursor rewind
without relying on a random impairment to happen to produce it. Its adapter
filters only sequence zero from redundant packets; all sequences, durations,
controls, and subsequent samples originate in the actual client. Server queue
methods and physics are not stubbed.

The packet adapters use native `structuredClone` transfer, detaching the
sender's entire `ArrayBuffer`, then forward the received bytes through the
real in-memory endpoint. Assertions retain and compare bytes after subsequent
encodes and check the original buffers remain detached. The actual client
receives separately decoded snapshots and reliable final results.

The ownership test intentionally distinguishes a canceled heap slot from live
work. It checks `heap[].fn` before the teardown observer, drains only transport
close notifications at the same simulated millisecond, and leaves the canceled
sixty-second / one-hundred-twenty-second slots pending.

## Verification status

Source inspection started in the assigned local checkout and was confirmed
against the relevant files at Git commit
`04b7a6e2516020fb971d5e42a2e33973033361b4` through read-only GitHub access after
the execution environment became unavailable.

**The new tests have not been executed. No local esbuild, ESLint, Prettier,
TypeScript, build, or browser result is claimed.** Root prohibited further
Vitest under shared memory pressure, and the environment then became
unavailable before authoring/checks could finish. The candidate was delivered
as one explicitly authorized unreferenced Git tree containing only the new
test and this report. No commit, branch, or ref was changed by this worker.

Hosted acceptance should run this exact new file together with the current
network queue, codec ownership, server deadline, and existing composition
gates. The expected scope is three new tests; acceptance remains pending until
that run supplies a result.

## Findings and limits

No production defect was verified and no production edit was made. No
physics/handling, rendering, animation, protected model, or existing test
file was modified.

These cases use synthetic EventLoop scheduling and in-memory transport.
Native buffer detachment is real, but it does not establish browser transport
behavior, socket interoperability, physical-network latency, FPS, measured
heap size, or GC improvement. The assertions concern command application,
protocol/record consistency, recipient byte ownership, and immediate callback
release under the stated deterministic schedule.

## Coordinator integration correction

Hosted workflow [45635583065](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/45635583065) ran these cases at `c482ad9`. The reordered-command and teardown cases passed; the recipient-transition case incorrectly used `RaceClient.leave()`, which deliberately forfeits its token, then expected a rejoin. The server correctly rejected that attempt. The fixture now disposes the departed client and closes its transport, representing process connection loss. All recovery, byte ownership, threshold, tick, ACK and stale-callback assertions are retained. This correction requires a new hosted pass; it changes no production protocol behavior.
