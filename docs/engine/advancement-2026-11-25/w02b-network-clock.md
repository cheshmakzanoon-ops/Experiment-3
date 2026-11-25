# Bounded remote presentation clock — assignment 8/60

## Change and contract

- Added `PresentationClock` in `src/net/interpolation.ts`; `RaceClient.view()` uses it only for remote poses.
- Each read advances by elapsed local time, then corrects toward `arrivalTick(now) - jitter.delayTicks` by at most 25% of elapsed ticks. Playback is therefore 0.75–1.25× normal speed; it cannot rewind or freeze while local time advances. A fixed offset converges in at most four times its duration.
- Same-instant reads have zero correction budget. An explicit unset timestamp supports negative/nonzero clock origins; a view before synchronization cannot initialize the clock to `-Infinity`.
- A compatible grid resets presentation when it installs a new race generation, including synchronous input-provider reentry. Reconnects/new races use fresh client instances. Raw arrival estimation, jitter observations/metrics, input scheduling, lead control, prediction, packet encoding, and physics remain unchanged.
- Existing remote extrapolation/hold behavior is retained. Completed clients remain terminal; this does not add unsupported same-instance race restarts with a lower authoritative tick origin.

## Executed reproduction

Ran `node --no-warnings --experimental-transform-types ../audit-network-repro.mjs` before and after the change. This uses real client timers, seeded transport, compatible grid identity and wire codecs; the remote moves at 20 m/s. Downlink latency increases 50→200 ms at snapshot 45.

| At the 40-sample anchor expiry, 4385.333→4402 ms | Before | After |
| --- | ---: | ---: |
| Remote presentation tick change | −16.5 | +1.5 |
| Remote position change | −2.75 m | +0.25 m |
| Accepted snapshots | 120 | 120 |
| Invalid messages | 0 | 0 |
| Input packets | 184 | 184 |
| Backward presentation frames | 1 | 0 |

Both frames remain interpolated. The raw target still drops 16.5 ticks, proving command-clock semantics were preserved. The resulting 18-tick presentation error is gone by 5002 ms (within 600 ms); audit-scenario headroom stays at most 36 ticks.

## Focused verification

Direct Vitest, one worker, no npm hooks:

```bash
node node_modules/vitest/vitest.mjs run tests/engine-network-clock-drift.test.ts --maxWorkers=1 --minWorkers=1
node node_modules/vitest/vitest.mjs run tests/net-prediction.test.ts tests/net-client-lifetime.test.ts --maxWorkers=1 --minWorkers=1
```

**39/39 tests passed:** 11 new drift tests, 8 existing prediction/interpolation tests, 20 existing client lifecycle tests.

The new tests exercise the audited step at clock origins 0, +123456789 and −86400000 ms; a 200→50 ms step with late in-flight snapshots; gradual 50→200→50 ms drift; seeded ordinary jitter/loss/duplication/reordering; a downlink-only outage with slower recovery then faster delivery; repeated same-time views; reentrant grid replacement; reconnect; and a new race whose local event loop starts at 60 seconds.

Every continuous-generation remote frame advances within 0.75–1.25× elapsed ticks, and the constant-velocity remote never moves backward. All stabilized scenario tails return to the raw target within 1e-6 ticks and 12–12.1 ticks of actual arrival-clock headroom; transient headroom stays positive and below 55 ticks. Outage frames reach the existing held/stalled state and resume without permanent extra delay.

An actual two-client authoritative race also runs latency steps, downlink loss and jitter against an independent reference using the former raw rendering/input-target equations. **All 734 input packets and 494 server snapshots (1228 complete packets, channels included) match byte for byte.** Raw RTT/lead/jitter-delay metrics, local prediction statistics, server input statistics and world tick are equal; only the new presentation has correction frames (100). Reliable session tokens are outside this comparison.

The exact existing ordinary-path gate remains unchanged: 4 clients, seed 404, 10 seconds racing on `TARGET_LINK`. Measured clean prediction p95 **0.092 m** (<0.3), correction p95/max **0.1421/0.822 m** (<0.3/<3), remote error p95 **0.0002 m** (<0.05), RTT mean **100.3 ms** (95–110), downlink **35.31 kbit/s** (<45), missing input ticks **8** (<0.5% applied). Existing zero-snap, visual-step p95 <0.05 m, and mean delay 100–140 ms assertions also passed.

## Scope

Production edits are limited to `src/net/interpolation.ts` and `src/net/client.ts`; coverage is in `tests/engine-network-clock-drift.test.ts`. No dependency, authored-content, asset, vehicle/tuning, packet-format, commit or npm-hook changes. `git diff --check` passed for the owned tracked edits. Full type/build/broader gates are left to the coordinating agent. Assignment 9 supplied read-only lifecycle/threshold review; it made no edits or test runs.
