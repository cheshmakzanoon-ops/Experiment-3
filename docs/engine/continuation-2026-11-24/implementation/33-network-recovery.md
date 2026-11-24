# Agent 33 — bounded network histories through server recovery

Wave 6, agent 33 of 60. Implementation and verification are complete; file ownership is released. No production defect was found and no production source was changed.

## Deliverable and scope

Added `tests/network-bounded-recovery.test.ts`: two integration cases using the real `RaceClient`, `RaceServer`, `AuthoritativeWorld`, codecs, prediction, interpolation, command log, metric windows, deterministic event loop and simulated transport. The unchanged `tests/net-helpers.ts` creates the real server and two driving peers. Each peer also observes the other as a remote car; this is not a spectator implementation.

The suite exercises the combined work of agents 19, 20, 23, 24 and 29. It does not change their algorithms or tuning. The only owned repository edit is the new test file. Models, character assets, authored environments, vehicle definitions, dependencies and existing tests are unchanged.

## Case 1: prolonged delivery faults and public-output mutation

Two independent two-driver sessions run for 90 virtual seconds each with the same seeded network, real physics and input trajectories. One is an ordinary current-source control. In the other, an external consumer deliberately corrupts documented detached outputs. This is a same-implementation ownership comparison, **not** a comparison with the original `5edead7` implementation; earlier agents own that historical equivalence evidence.

The schedule is identical in both sessions:

| Virtual interval | Delivery condition | Required behavior |
|---|---|---|
| 0–5 s | Perfect link and ordinary startup | Both clients reach the race. |
| 5–15 s | A proxy rewrites only the primary snapshot ACK to `-1` | The observed ACK stays fixed while commands and valid snapshots continue; the retained command history stays bounded. |
| 15–20 s | Ordinary ACK delivery restored | ACK progress catches up by more than 600 commands. |
| 20–29 s | Primary downlink loss is 100%; uplink remains intact | Snapshot tick freezes, more than 530 new commands are issued, presentation reports stalled, and the real server still owns a connected human driver. The latest transmitted command remains current. |
| 29–50 s | Existing target link: 50 ms one-way delay, jitter, loss, duplication and reordering | Snapshot delivery and reconciliation resume. |
| 50–90 s | Perfect delivery restored | Both clients are current, unstalled and acknowledged near the latest command, with no disconnect, kick or malformed-message event. |

Every input datagram is decoded independently before ordinary delivery. Its size and command count obey the existing wire limits; sequence numbers and tick ranges remain ordered. Actual snapshot payloads still come from the server. The stale-ACK proxy changes only ACK metadata and re-encodes it through the real codec.

The mutation run corrupts all five client diagnostic arrays and their detached lifetime summaries, all seven predictor diagnostic arrays/summaries, predictor authoritative outputs, retained predicted-pose outputs, remote latest-state outputs, remote sampled poses and every returned render pose. The documented mutable `client.latest` surface is deliberately not advertised or tested as an owned copy.

The two runs must match exactly in:

- SHA-256 of every outgoing unreliable input/snapshot payload, in delivery-attempt order and distinguished by peer/direction.
- SHA-256 of the Float64 fields of every returned local/remote render pose, before consumer mutation.
- Phase observations, command/sample totals, complete retained metric arrays, authoritative and remote states, server input statistics and ending world tick.

Independent assertions also establish that all rendered poses and retained diagnostics remain finite; current predictor/remote owned states agree with the delivered authoritative snapshot; the server records no kicks, takeovers, invalid messages or oversized messages; and both peers finish beyond tick 10,700 with ACKs within 16 commands of their latest sequence.

The integration crosses the 4,096-sample capacity naturally through normal scheduled rendering: each client retains exactly 4,096 interpolation-delay samples while its lifetime observation count exceeds 5,300. Predictor visual-step history also fills and wraps. All other client/predictor metric arrays remain at or below capacity. Both runs exceed 5,300 input packets and 10,700 combined render callbacks. At the 250 ms inspection points, maximum retained command count is at most 185, including the stale-ACK and blackout phases. The command duration contract supplies a separate general bound; this test does not present its periodic inspection as a heap-peak measurement.

## Case 2: process replacement and token rejoin

A real two-driver server runs for 15 virtual seconds. At 5 s the primary transport is severed and its client disposed, while the remote continues racing. By 8 s the real disconnect timeout has transferred the primary car to AI ownership.

A fresh client presents the saved token and matching account. Immediately after the server accepts the rejoin, the car remains AI-controlled and the new command log has not started. After fresh commands arrive, the same car returns to human ownership, the client receives the `rejoined` event, and its authoritative state is no longer flagged AI. The replacement has a fresh command sequence (between 400 and 430 by 15 s), bounded retention and a current ACK; it does not inherit the disposed process's sequence/history.

A retained callback from the disposed client is then explicitly delivered a legitimate new snapshot. Its state, command counter and diagnostics remain unchanged. Mutating its detached outputs cannot alter the replacement's authoritative state. The other driver's snapshot count continues beyond 290.

Both tests dispose every client, tear down the real server, advance past remaining one-shot/close deliveries and require zero pending event-loop entries. Live peer transports close. These assertions cover retained-timer and callback ownership in addition to recovery state.

## Validation

The initial complete run passed **2/2 integration cases**. Test execution took **20.36 s**, with **22.81 s** total runner duration; these times include extensive assertions and are not engine performance measurements. The prolonged twin session case took 19.06 s and token-rejoin case 1.30 s.

All heavy commands used the shared lock and a 512 MiB Node heap. Vitest used one worker. The new file was formatted before the successful run, and scoped ESLint, strict TypeScript and whitespace checks subsequently passed. No browser, network socket, npm lifecycle hook, full-project compiler or asset generator was invoked by this agent.

```sh
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/prettier/bin/prettier.cjs --write tests/network-bounded-recovery.test.ts
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/network-bounded-recovery.test.ts --maxWorkers=1
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/eslint/bin/eslint.js tests/network-bounded-recovery.test.ts
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --resolveJsonModule --skipLibCheck --lib ES2022,DOM --types node tests/network-bounded-recovery.test.ts
git diff --check -- tests/network-bounded-recovery.test.ts
```

## Limits and provenance

These are deterministic in-process transport integration tests with actual server physics and codecs. They do not establish WebRTC/UDP browser interoperability, physical network performance, all possible link conditions or actual process RSS. Bounded sample/command retention does not imply that every session record or event list in the engine has constant storage.

The 90-second control and mutation runs establish public-output isolation under the tested delivery faults; they do not independently establish numerical equivalence to old source. Agent 29's historical comparison remains separate evidence for the ResponseModel optimization.

`33-network-recovery-sources.json` records the checkout HEAD at provenance capture and SHA-256 of the tested source, fixture and test files. Source hashes govern attribution if the coordinating agent publishes unrelated files concurrently. The new test's SHA-256 is `54ab00a2c5237c434a4899dd918c46f53a968d60c24f5c99a2a817b867eebb41`.

No staging, commit or push was performed.
