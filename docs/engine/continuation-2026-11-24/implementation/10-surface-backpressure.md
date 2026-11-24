# Agent 10 — bounded circuit surface transport

Date: 2026-11-24
Implementation base: `1bb58c984b17cdfc38493547e3767474eff341b0`
Status: implemented; **87 focused regressions and scoped ESLint passed**. Whole-project TypeScript verification remains with the integration owner after the 512 MB attempt exhausted its heap.

## Scope and behavior

Owned changes:

- `src/workers/surface-channel.ts` — new bounded ownership helper.
- `src/workers/diagnostics.ts` — surface epoch, sequence, ACK and capture-gap types.
- `src/workers/physics.worker.ts` — lazy surface capture, acknowledgment handling and bounded flashback completion.
- `src/main.ts` — only the surface-message consumption branch.
- `tests/surface-channel-backpressure.test.ts` — 14 regression cases after parameter expansion.

The surface transport now has a fixed 120-packet outgoing reserve. At the existing one-surface-per-60-ticks cadence, this holds sixty simulated seconds, matching the recording transport's nominal stall reserve. The original recording test requiring at least 47 surface packets during a 24-second consumer stall still passes.

Capacity is reserved before cloning any water, rubber, marbles or frozen array. Once full, the worker retains only the earliest pending capture tick. It does not allocate pending array snapshots or export terrain deltas. Normal publication preserves the existing fields and timestamps.

The warm array portion of the reserve is at most 5,160,960 bytes; the cold four-field portion is at most 6,881,280 bytes. The cold bound and slice counts were asserted against the real worker. Terrain adds a finite amount bounded by the course grid; the worker does not retain another deferred terrain snapshot. These figures describe surface transport ownership, not total browser memory or replay storage.

## Ownership, epochs and recovery

Each packet carries an epoch and a monotonically increasing sequence. ACKs release only the exact outstanding pair. Malformed, unknown, mismatched and duplicate ACKs release no credit. Init and flashback start a new epoch without clearing the old outgoing ownership table; mandatory rebases therefore cannot allocate around a stalled consumer. A valid late old-epoch ACK retires only its old packet and can make room for current state.

When capacity returns, a pending capture sends the current authoritative simulation state, including while paused. Normal terrain recovery remains incremental: leaving `renderDelta` uncalled during a stall preserves its bounded changed-cell set, and the next actual export contains every accumulated change. Init and flashback send a full terrain rebase.

A failed capture or post forces the next capture to rebase terrain fully, because an export may already have cleared its change set. Failure before transfer releases local ownership. A detached failed publication retains its credit until its ACK. An older throwing callback cannot revoke a publication that was already acknowledged or a newer epoch's ownership.

Flashback completion waits for surface capacity. After a credit becomes available, it preserves `flashback → surface → frame` ordering, allowing the host to truncate its old recording before retaining the new full surface. Simulation does not advance while this completion is pending.

## Recording honesty and host consumption

When a pending sample's tick has been superseded, the recovery packet carries a capture-gap flag once per session. The warning travels inside the bounded packet. The host records and displays:

> Surface capture gap: delayed delivery omitted replay surface keyframes. Live surfaces have resumed from the latest state.

Coalesced intervals are not represented as continuous surface capture.

The host ACKs after replay capture, live surface rendering and terrain-history consumption. It rechecks ownership after callback-bearing consumers and after the gap-warning callback. Disposal, failure, a generation change or worker replacement stops the old handler from continuing into a replacement session or ACKing its worker. ACK posting exceptions use the existing failure path only while the original session still owns that operation. Circuit startup readiness was not modified.

## Executed validation

All execution used `/engine-work-4e0075ccccb3/test.lock`, a 512 MB Node heap, one Vitest worker and the threads pool.

| Suite | Passed |
| --- | ---: |
| surface-channel-backpressure.test.ts | 14 |
| recording.test.ts | 37 |
| worker-pause.test.ts | 5 |
| flashback-recording.test.ts | 4 |
| circuit-startup-settlement.test.ts | 27 |
| **Unique focused regressions** | **87** |

The final new-suite run, after the fixture lint correction, passed all 14 tests in 8.92 seconds (6.50 seconds test execution). The compatibility run passed all 73 tests in 11.43 seconds, including the original 24-second recording-cadence case, final-pause ordering with exhausted pose storage, pit-service transitions, replay truncation and startup settlement.

The new tests execute the actual physics-worker module and real simulation under a controlled clock and interval with real structuredClone transfer detachment. They verify the 120-packet and byte/allocation bounds beyond the reserve, continued simulation progress, exact latest/frozen fields, cumulative real motocross terrain, init ownership, late/duplicate ACKs, deferred flashback ordering and full-terrain recovery after a post failure consumed the incremental set. A complete production GameApp receiver and its production cancellation predicate are extracted from the source AST for host integration checks. The worker graph is imported once and reinitialized through its real message protocol; no repeated resetModules calls are used.

Scoped ESLint passed for all five owned source/test paths after replacing a test-only `current = this` alias with an observer callback. Prettier formatted the new test file; the new helper was already formatted.

Commands:

```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run tests/surface-channel-backpressure.test.ts --pool=threads --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run tests/recording.test.ts tests/worker-pause.test.ts tests/flashback-recording.test.ts tests/circuit-startup-settlement.test.ts --pool=threads --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/eslint src/workers/surface-channel.ts src/workers/diagnostics.ts src/workers/physics.worker.ts src/main.ts tests/surface-channel-backpressure.test.ts
```

## Verification limits and recovery provenance

Whole-project `tsc --noEmit --pretty false` with the 512 MB heap aborted with exit 134 at the V8 heap limit before reporting diagnostics. The integration owner explicitly retained the larger-heap project type gate. No TypeScript pass is claimed for this change. These tests also do not constitute a native-browser performance or GPU-rendering measurement.

Earlier test launches in the preceding executor were killed with exit 137, including an unchanged startup suite, before that executor disconnected. The source changes were preserved as GitHub blob `a041283147c8a17017ee5cc518961a3dc4ae3d42`, with an honest pending-verification report in blob `e42c63260650781c547d478a77af80ce696bfd59`. The five-file patch was reconstructed from the recorded edit calls against exact GitHub-fetched base files; every replacement matched once and its unified diff passed an in-memory round-trip check. It then applied cleanly to the restored checkout. The final fixture includes the explicit `this: Simulation` annotation identified during the interruption and the subsequently tested observer-callback lint correction.

No commits, pushes, branch updates, models, environments or authored assets were changed by this agent.
