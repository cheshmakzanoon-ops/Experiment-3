# Agent 23 — client command retention during downlink outages

Date: 2026-11-24. Implementation owns `src/net/input.ts` (client history only), `src/net/client.ts` (command construction/pruning only), and `tests/client-command-retention.test.ts`. Agent 19's metric implementation is preserved.

## Result

The client no longer needs an acknowledgement or a new snapshot to expire old command history. Successful issuance prunes a finite window measured from the monotonic issued-tick cursor. A silent downlink can therefore leave uplink commands running without accumulating the entire outage journal.

The default span is 368 ticks: the protocol's 240-tick maximum lead allowance plus its largest 16-command wire run at eight ticks each. At the nominal two-tick input cadence this retains at most 185 commands, including the original strict-end boundary. Arbitrary valid one-tick commands retain at most 369. RaceClient enlarges the span when the configured predictor needs more: `max(368, ceil(240 + maxHorizonTicks + 2*responseLagTicks + 2*TICKS_PER_SNAPSHOT))`.

The existing accepted-snapshot pruning floor keeps its response-lag margin, but no longer waits for an ACK. Recent prediction inputs, the complete latest redundant command suffix, command quantization, sequencing, duration adjustment, and wire-counter overflow rules remain unchanged. Failed command construction never advances counters or evicts history. Explicit `start()` still clears history and begins its requested tick range while retaining sequence/ACK continuity; a new rejoined client still starts its sequence at zero.

A backwards or non-finite prune floor cannot restore or accidentally discard retained entries. Normal retention follows issued ticks rather than a jittering local/server clock estimate. The implementation retains the existing strict `command.end < floor` boundary and bounded-array representation; each splice shifts no more than the configured history window, so work no longer grows with session duration. This is a configuration-sized bound, not an allocation-free command path.

## Delayed recovery policy

Snapshots within the supported retained window still find their response-lag controls and train/reconcile normally. If a delayed snapshot is older than the retained journal, the existing predictor safely seeds from authoritative state and omits learning from unavailable controls. It does not invent or indefinitely retain expired inputs. A subsequent fresh snapshot resumes the normal input-aware path. This boundary is tested explicitly; it is not a claim that arbitrary ancient snapshots retain exact input-aware replay forever.

The history span grows with an explicitly longer predictor configuration. Non-finite, non-integer, or below-minimum standalone history spans are rejected. This change bounds valid issued command history, not every client resource or externally mutated private state.

## Verification

All **116 tests across five suites passed**:

| Suite | Passed |
| --- | ---: |
| `client-command-retention.test.ts` | 21 |
| `net-command-queues.test.ts` | 56 |
| `net-transport.test.ts` | 11 |
| `net-prediction.test.ts` | 8 |
| `net-client-lifetime.test.ts` | 20 |

The new cases cover 100,000 unacknowledged two-tick commands; 100,000 mixed-duration commands; exact recent lookups and a maximum contiguous resend run; stale ACKs; backwards/non-finite floors; lower-tick restart; failed encoding and wire-counter overflow atomicity; custom lag/horizon; lead adjustments; and both expired and fresh recovery snapshots.

The timer-driven production RaceClient ran through 102,000 scheduled input samples during a silent downlink while its transport stayed open and uplink packets continued. History remained at most 185 commands. Fresh recovery with a still-stale ACK found the exact expected response-lag controls, and later input issuance remained bounded. The existing four-client online simulation under 100 ms RTT and 2% loss also passed unchanged.

Executed command:

```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run tests/client-command-retention.test.ts tests/net-command-queues.test.ts tests/net-transport.test.ts tests/net-prediction.test.ts tests/net-client-lifetime.test.ts --pool=threads --maxWorkers=1
```

Scoped ESLint passed on all three owned paths, the new test file was formatted, and `git diff --check` passed. Full-project TypeScript checking remains with the coordinator.

## Independent baseline comparison

The accompanying `23-command-reference.mjs` runs the real client separately from the frozen original `5edead7` checkout and the candidate checkout. Each 30-second scenario includes explicit input-lead changes. SHA-256 digests cover every outgoing packet, every render view, final prediction/model observations and relevant event counts. All four baseline/candidate digests match exactly.

| Scenario | Maximum retained commands, original → revised | Final retained commands, original → revised |
| --- | ---: | ---: |
| Healthy delivery | 76 → 76 | 50 → 50 |
| Stale ACKs | 1,800 → 76 | 1,800 → 50 |
| Eight-second downlink outage, then recovery | 1,800 → 185 | 1,800 → 50 |
| Jitter, loss and reordering | 1,800 → 81 | 1,800 → 59 |

Full hashes and implementation fingerprints are in `23-command-reference-comparison.json`. Each probe was run with Node 24.22.3, `--experimental-transform-types`, a 512 MiB heap and the shared test lock. These are exact behavioral comparisons and retention measurements; no frame-rate improvement is asserted.

No server policy, prediction arithmetic, models, character models, authored environments, vehicle tuning, assets, dependencies, commits, or remote refs were changed by this agent.
