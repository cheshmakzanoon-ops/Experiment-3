# Agent 38 — combined worker rewind, input and transport ownership

Wave 7, agent 38 of the requested 60. **Complete; no production defect found and no production changes made.**

## Deliverable and result

Added `tests/worker-rewind-ownership.test.ts`: **three passing integration cases** over the actual circuit and Festival worker entries, simulations, fixed-step clock, shift queue, frame pool, recording sampler, surface channel and input log.

The final run passed all three cases in **6.672 seconds of test work / 9.02 seconds total**. Scoped strict TypeScript, ESLint and formatting checks passed. The test and helper-free fixture remain unstaged for the coordinator. The final log is `38-final.log`; source identities are in `38-rewind-input-surface-sources.json`.

This complements the individual helper tests and agent 36's separate native-browser work. It does not substitute a handwritten worker loop, resimulation algorithm or recording publisher. Each actual worker module loads once and is reinitialized through its actual protocol. A controlled timer and clock keep the schedule reproducible, while both outgoing buffers and explicit returns use Node's real `structuredClone` transfer mechanism. Sent ArrayBuffers must become detached.

## 1. Saturated circuit, two accepted rewinds and a resumed branch

The circuit case uses the unchanged Valley Ridge motocross track and MX-450 configuration. It first drives **7,200 real physics ticks / 60 virtual seconds**, holding every outgoing ordinary frame, recording page and surface ACK. It verifies the actual reserves at that point:

| Channel | Held publications |
|---|---:|
| Ordinary render frames | 5 |
| Telemetry pages | 60 |
| Replay pose pages | 60 |
| Surface packets | 120 |

It then applies bursts of distinct shift pulses followed by neutral samples and checks the resulting state against a **direct Simulation driver**, which has no worker clock, input queue, recording sampler or transport. The direct driver applies the observed controls at their actual physics ticks and performs one ordinary simulation step per tick. Separate explicit shift/tick assertions establish the intended FIFO schedule, so equivalence is not the sole input-order oracle.

While all reserves remain held, the case requests a rewind to tick 7,224. Pulses queued before the request and supplied during resimulation must not leak into the restored timeline. The restored state matches both the full Float32 snapshot bytes and native Float64 vehicle/body/tire scalar bytes from the independent driver. The still-held old recording page remains byte-identical.

The completed resimulation remains blocked until a real outstanding surface ACK arrives. Returning an ordinary frame does not authorize a surface packet. An incorrect epoch, an unknown sequence and a duplicate ACK cannot create credit. A repeated rewind request is rejected with the existing `Invalid flashback request` response without replacing the accepted target; this is an expected protocol-error assertion, not a claim that the application should send duplicate requests.

One valid old credit produces exactly **flashback → surface → frame**. The rebase has a newer epoch, a full terrain reset, and water/rubber/marble/terrain values matching the directly driven simulation. An old recording buffer returned before any new recorder publication cannot inject old rows into the new recorder.

After explicit resume, four batches apply exactly `[+1, -1, +1, 0, 0, 0]` at consecutive physics ticks. Both the observed inputs and the actual `InputLog` entries confirm the application ticks. Every resumed batch matches the direct driver's binary state. A subsequent pause flushes exactly three new replay rows at target+8, +16 and +24; old held recording bytes remain unchanged.

Finally, a **second accepted rewind** to tick 7,240 must reproduce the newly recorded branch rather than the discarded original future. Its independent driver combines the retained original prefix and the new applied-input suffix. The second exact state comparison passes, and completion again waits for a distinct outstanding surface credit and retains the same three-message order.

## 2. New-session replacement of a blocked rewind

A separate saturated session reaches a resimulated endpoint but cannot publish completion because all surface credits are still owned by the receiver. The test then sends another queued shift and initializes a fresh session through the real worker protocol.

The new session's explicit pulses are applied once; neither the departed queue nor its pending rewind completion survives. A late old-epoch ACK frees only its actual outstanding credit. The resulting packet belongs to the fresh session's newer epoch and current time; no old flashback completion is emitted. The new state and terrain match a fresh direct Simulation driver.

This case observes the actual **60-tick surface cadence**. An initial fixture version tried to assert the first new surface after only six ticks; it therefore inspected the retained old packet. Advancing to the production cadence corrected that fixture assumption. No production code was changed to accommodate it.

## 3. Festival transition ownership with exhausted ordinary frames

Festival does not expose the circuit flashback protocol. Its distinct integration case therefore exercises the relevant driver/event ownership transitions:

- Hold all four ordinary frame buffers while simulation continues, and compare the real worker state with a directly driven `OpenWorldSimulation`.
- Queue opposing shifts, then start the actual Valley Sprint event. The accepted event transition discards old driving intent and delivers its required four-car field snapshot.
- Queue a new shift, then submit a rejected vehicle command. The rejection preserves that accepted pulse, which applies exactly once at the next physics tick.
- Queue another pulse, pause, cancel the event, replace the driver vehicle while paused, and supply a paused pulse. Resume applies no discarded pulse.
- Compare the complete presentation frame and native body/vehicle/tire scalar bytes after the event step and resumed free-roam step. The expected command rejection is a request-specific result; there is no fatal worker error.

All sent transferable buffers are detached in the sender. Required transition/pause snapshots remain supported when ordinary pools are exhausted.

## Scope and limits

The comparisons cover the complete serialized presentation frame with CPU/drop diagnostics deliberately supplied as zero, plus native Float64 scalar state from every car, rigid-body public vector/quaternion, input object and tyre. Schema equality and raw-byte equality include signed zero. They do not claim that every private cache or nested implementation object was serialized. The second rewind and resumed trajectory provide additional behavioral evidence beyond a single state snapshot.

The direct drivers use the **current source**, not a historical engine implementation. This is integration and ownership validation, not a new historical numerical-performance result. Existing ordinary-dynamics comparisons remain separate evidence.

The capacities above apply to ordinary frame reserves and each recording transport instance. Required control snapshots may allocate beyond the idle frame reserve. Already transferred pages remain receiver-owned across timeline changes. The tests do not claim a global hard limit over every paused control message or every old recorder's receiver-held pages. Size/credit-based buffer returns are also not sender or session authentication; this test checks a late recording return before the fresh recorder has any outgoing credit.

The timer/worker transport harness runs in Node with controlled scheduling, not a real browser worker, physical controller or network. Agent 36 and the coordinator own native-browser gates. No frame-rate, wall-clock latency, GPU or hardware performance claim follows from these cases.

No model, character, authored environment, track definition, vehicle tuning, dependency or production source was modified.

## Executed checks

All heavy checks used the shared lock, a 512 MiB heap and one Vitest worker. No npm lifecycle hooks or asset generation were invoked.

```sh
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 \
  node node_modules/vitest/vitest.mjs run tests/worker-rewind-ownership.test.ts --maxWorkers=1
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 \
  node node_modules/eslint/bin/eslint.js tests/worker-rewind-ownership.test.ts
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 \
  node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck \
  --target ES2022 --module ESNext --moduleResolution Bundler \
  --allowImportingTsExtensions --resolveJsonModule --types node \
  tests/worker-rewind-ownership.test.ts
```

Prettier formatted the final file; the final pass reported it unchanged. ESLint's initial observer-helper alias warning was corrected without a suppression, followed by the final lint, compiler and three-case test run. `38-types.log` is empty because the compiler exited successfully without diagnostics.

Handoff source HEAD: `676d4c8531695638537bf62af5a74ca8edbe41ef`. Test SHA-256: `83f549edf9ee027d57a0371245efaab7313b0a08656fc2a6040e45b52046047b`. Full relevant file fingerprints are retained in the JSON report; a moving branch pointer does not substitute for those file identities. No staging, commit or push was performed. **File ownership is released.**
