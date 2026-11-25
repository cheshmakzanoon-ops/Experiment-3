# W06A — native transfer ownership in the network engine

Assignment 31/60, wave 6. The new browser case runs actual `RaceServer`,
`RaceClient`, authoritative physics, codecs, command logs, and presentation
clocks through actual transferable `MessageChannel` messages. The transport's
latency and loss schedule remains controlled. **Native browser execution is
pending the coordinator's exact-source CI run.** Local Node message ports are
reported separately below; they are not a browser or physical-network result.

## Additional defect found and repaired

`RaceClient.sendInputs()` measured `packet.length` after `Transport.send()`.
A transport that transfers the packet's ArrayBuffer detaches the sender's view
synchronously. The input packet reaches the receiver intact, but the client
then records zero transmitted bytes. This affects diagnostics rather than the
wire layout or input application.

A new test using Node's actual `worker_threads.MessageChannel` reproduced the
defect on the pre-repair production sender: a 36-byte two-command packet and a
10-byte empty packet were delivered successfully, both sender views detached,
and the client recorded `[0, 0]` instead of `[36, 10]`. The two exception cases
already passed. The before log is
`/tmp/aeebac160835-engine/validation/w06a-transfer-before.log`.

With the coordinator's authorization, the sender now captures `byteLength`
before calling the transport and records that captured value only after the
send returns successfully. The number and order of sends, encoded bytes,
sequence/ACK behavior, command counters, and failure semantics are unchanged.
Tests cover a throw both before transfer and after successful transfer: the
original exception still escapes and failed-send counters remain unchanged.

Production change: `src/net/client.ts`. Regression:
`tests/engine-transfer-transport-accounting.test.ts`.

## Browser case and native boundary

Files:

- `e2e/engine-native-network-advancement.spec.ts`
- `e2e/fixtures/engine-native-network-advancement.ts`

One isolated case starts a real three-client race and advances the production
discrete-event clock for five simulated seconds. Each client/server pair has a
real browser MessageChannel. All reliable and unreliable encoded packets are
posted with their backing ArrayBuffer in the transfer list. The fixture checks
immediate sender detachment before the next recipient is sent, then compares
every received byte against a copy captured before transfer.

Native receipt enqueues engine delivery at its declared logical time. The
first client's downlink changes from 50 to 200 ms at 1,200 ms and returns to
50 ms at 4,000 ms. The second client's ninth through eleventh input packets
are discarded after native receipt. These are explicit fixture conditions,
not measurements of browser message delay or physical packet loss.

Assertions establish:

- Every native packet transfers exactly once; its sender view remains detached
  and the receiver owns a distinct buffer.
- Multi-recipient snapshots remain valid after earlier recipients' sender
  buffers have detached. Every three-car datagram is 152 bytes with exactly one
  FULL car, matching the eventual recipient's real grid assignment.
- Every peer receives the same snapshot boundaries. The initial join order is
  deliberately not assumed across independent native MessagePorts.
- Six retained receiver buffers—one input and one snapshot per peer—remain
  byte-identical after later transfers and snapshot batches.
- Recorded input-byte samples and lifetime sums equal actual pre-transfer
  lengths for every peer, including packets later dropped by the fixture.
- Redundancy recovers command sequences whose first observed packet was lost;
  real server ACKs advance beyond those sequences without rejected commands.
- The raw remote-presentation target steps backward under the sustained
  latency increase. Rendered time remains within 0.75–1.25 times elapsed ticks,
  and raw command scheduling continues to use the authoritative clock.
- Teardown closes all six ports and leaves no native transfers or discrete
  events pending. No native message, client protocol, or server transport error
  is tolerated.

The browser test attaches `native-network-advancement.json` before assertions,
so a CI failure retains the actual counters and recipient traces.

## Completed local checks

The focused regression command, called directly without npm lifecycle hooks:

```sh
node node_modules/vitest/vitest.mjs run \
  tests/engine-transfer-transport-accounting.test.ts \
  tests/engine-network-clock-drift.test.ts \
  tests/engine-input-encoder-capacity.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0
```

**19 tests passed across three files**: three transfer-accounting cases, eleven
presentation-clock cases, and five input-capacity cases. The existing clock
suite also retained its 1,228-packet ordinary-transport comparison.

The fixture itself ran successfully with Node's native MessageChannel and the
same exported workload. This is a local logic and native-Node-transfer check:

| Observation                                            |                       Local Node result |
| ------------------------------------------------------ | --------------------------------------: |
| Simulated interval                                     |                                5,000 ms |
| Authoritative physics tick                             |                                     595 |
| Snapshot packets                                       | 297, over 99 three-recipient boundaries |
| All protocol packets transferred                       |                                     768 |
| Fully compared bytes                                   |                                  94,945 |
| Detached senders / distinct receiver buffers           |                               768 / 768 |
| Controlled dropped inputs                              |                                       3 |
| Initially lost and subsequently recovered sequences    |                                   16–21 |
| Final ACK on each client                               |                                     285 |
| Affected client's raw target rewinds                   |                                       1 |
| Its bounded presentation correction frames             |                                      90 |
| Closed ports / pending transfers / pending loop events |                               6 / 0 / 0 |

All three clients remained in the race with zero invalid messages. Six retained
receive buffers remained unchanged. Each client rendered 286 observed remote
frames; all passed the bounded playback check. Input byte totals agreed exactly.
The local report is
`/tmp/aeebac160835-engine/validation/w06a-node-messagechannel-final.json`.

The browser fixture bundled successfully with esbuild's browser/IIFE target
(1,192,327 emitted bytes). Playwright `--list` discovered exactly one case.
Those checks do not launch Chromium or establish browser acceptance.
Scoped TypeScript semantic/syntactic diagnostics for the four owned source,
test and browser files were zero. Scoped ESLint and Prettier checks passed.

## Scope and limits

The native case uses one browser JavaScript realm and MessagePorts; it does not
claim worker isolation, WebRTC, socket transport, separate host clocks, physical
network performance, browser frame rate, or physical hardware validation. Its
clock origins differ per client, while its event schedule is explicit and
deterministic. Broader reentry, connection-replacement and exact-baseline
composition evidence remains in W05B.

No authored models, characters, environments, vehicle data, audio recipes,
track definitions, handling constants, dependencies or workflows were edited.
No local browser bypass, Git mutation, full build/typecheck, timing benchmark or
child agent was used. The coordinator owns publication and native CI results.
