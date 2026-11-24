# Agent 36 — actual worker transfer integration

Wave 6, agent 36 of the requested 60. Added **two native-browser regression cases** over the actual circuit and Festival worker entry points. The fixtures, local compiler/lint gates and Node worker-thread rehearsal are complete. **Chromium execution is still a required remote gate; no browser pass is claimed here.**

## Scope and files

- `e2e/engine-native-workers.spec.ts`: two browser cases with attached JSON evidence.
- `e2e/fixtures/engine-native-workers.ts`: native Worker ownership, FIFO control receipts and scenario drivers.
- `e2e/fixtures/engine-worker-clock.ts`: a test-only monotonic clock/interval adapter and post-transfer observer.
- `e2e/fixtures/engine-native-circuit.worker.ts`: imports the adapter and the unchanged actual `physics.worker.ts`.
- `e2e/fixtures/engine-native-festival.worker.ts`: imports the adapter and the unchanged actual `open-world.worker.ts`.
- `.github/workflows/engine-runtime-validation.yml`: adds the exact spec and fixture paths, preserving existing native audio, lifecycle and replay entries.

No production source, protocol, physics parameter, vehicle tuning, asset, 3D model, character, scene definition or environment was changed by this agent. Simulation objects build their normal contact geometry from existing data; the tests do not substitute reduced geometry or a copied simulation implementation.

## Native scheduling and ownership method

Each test creates an isolated real browser Worker from an esbuild bundle of its actual production entry. The adapter is evaluated first. It changes only the worker monotonic clock and interval trigger, allowing 62 seconds of simulated consumer delay without waiting 62 wall-clock seconds. Every 100 ms advance still calls the original fixed-step worker callback and its original 120 Hz simulation.

Production commands use native `Worker.postMessage`, the real production `onmessage` handler and native transfer lists. A separate fixture-control listener consumes only its own clearly marked control messages. A control receipt is posted after the preceding production work. Main-thread assertions therefore wait for ordered receipts instead of sleeping or estimating how many frames should have arrived.

The observer calls native worker `postMessage` first, then reads each transferred buffer's byte length. The main-thread fixture also checks buffer detachment immediately after native returns. No transfer is replaced by a clone or a fabricated acknowledgement. Worker handles, Blob URLs, pending control receipts and timeout handles are closed in `finally`.

The clock adapter is excluded from the page bundle through a type-only import; a final browser-bundle check verifies this explicitly.

## Circuit scenario

The actual one-car practice worker advances for 62 virtual seconds while all frame, recording and surface deliveries remain held by the consumer. The contract is five ordinary frame buffers, 60 telemetry pages, 60 replay pages and 120 outstanding surface packets. Both recording streams must report one capture-gap warning after their reserve is exhausted.

One native frame return, one telemetry-page return and one replay-page return allow exactly one additional delivery from each stream. Further simulation with those new deliveries held stops again at that restored capacity. Pause must still deliver its required final snapshot and its matching pause receipt, at tick 7,680 after 64 virtual seconds. Returning one old surface ACK then delivers only the newest coalesced surface, explicitly marked as having a capture gap and matching the paused frame's time.

A new init on the same actual worker preserves the old surface ownership tickets. The short new session is rewound to tick 60. While all 120 surface credits remain outstanding, no completion or replacement frame may escape. Returning one exact old-epoch ACK releases the ordered production sequence:

`flashback → surface → frame`

The completion tick, surface time and Float32 frame time must agree. Repeating that ACK releases no additional capacity. A different outstanding old ticket releases one further current-epoch surface. The rewind target is deliberately short, so this integration case does not spend time replaying the original 62-second session.

## Festival scenario

The actual Festival worker begins with one road car and traffic disabled. Four ordinary frames exhaust its reserve. Starting the existing Valley Sprint event grows the field to four cars and creates a new correctly sized reserve. Native returns of the old solo-size buffers must not grow that reserve; a return with the current field size restores exactly one delivery.

Cancel and continue commands then shrink the field back to one car. Old four-car buffers must be ignored, the new solo reserve must again stop at four held ordinary frames, and a correct current-size return must restore one delivery. Required pause still delivers a final frame and status while ordinary capacity is exhausted. Subsequent controlled advances while paused produce no new frame. Command-result ordering and the single cancellation result are checked.

## Local evidence: Node rehearsal, not Chromium

A temporary, portable Node helper ran the same scenario functions and bundled actual worker entries through sequential `worker_threads`. The adapter supplies browser-like event dispatch around real Node thread messages; the transfer lists themselves are actual native transfers. This rehearsal checks fixture ordering and counts before publishing browser tests. It does **not** replace the browser gate.

Both scenarios passed their rehearsal assertions on Node v24.22.3 with a 512 MiB child old-space limit. The shared test lock covered compilation and execution. Observed runtimes were about 3.03 seconds for circuit and 1.07 seconds for Festival; these include setup and deliberately controlled clocks and are not performance benchmarks.

| Observation | Node rehearsal | Required browser assertion |
|---|---:|---|
| Circuit initially held ordinary frames / telemetry pages / replay pages / surfaces | 5 / 60 / 60 / 120 | Exact counts |
| After one return to each buffer stream | 6 / 61 / 61 / 120 | Exact counts, then stable under further delay |
| Recording capture-gap messages | 2 | One telemetry and one replay warning |
| Rewind after old-epoch ACK | flashback, surface, frame | Exact order and matching tick/time |
| Duplicate old ACK | No additional surface | Count unchanged |
| Festival frames per solo / event / solo reserve | 4 / 4 / 4 | Exact counts and byte sizes |
| Worker-to-consumer buffer transfers | 521 | Every observed sender detached |
| Consumer-to-worker buffer returns | 10 | Every observed sender detached |
| Production error messages | 0 | Empty error arrays |
| Pending control receipts after cleanup | 0 | Closed owner, no pending requests |

The circuit contributed 506 outgoing buffer transfers; Festival contributed 15. Surface transfers contain three separate buffers per packet. A fixture-only initial-time assumption was corrected during rehearsal: practice starts at the existing seeded `race.greenAt`, so tick zero need not mean presentation time zero. The final test requires a finite initial timestamp and exact consistency across later pause/surface/rewind boundaries. No production behavior or existing assertion was changed.

Evidence files in the coordinator reports directory:

- `36-worker-node-smoke.mjs`: portable rehearsal helper; accepts repository path and JSON output path.
- `36-worker-node-smoke.json`: complete scenario reports, runtime version and bundle sizes.
- `36-worker-node-smoke.log`: successful assertion summary.
- `36-native-worker-sources.json`: actual source fingerprints and handoff HEAD.
- `36-browser-fixture-bundle.json`: page IIFE bundle identity and clock-adapter exclusion check.

## Local checks and remote gate

Passed strict scoped TypeScript compilation and ESLint for all five new TypeScript files. The final formatting check includes those files and the workflow. Both actual worker bundles built without warnings (circuit 1,076,061 bytes; Festival 1,198,659 bytes). The browser page IIFE is separately bundled with the exact global name used by the spec. Scoped whitespace checks passed. No npm lifecycle hook or local browser launch was used.

Commands use the existing lock and a 512 MiB heap:

```sh
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --types node e2e/engine-native-workers.spec.ts e2e/fixtures/engine-native-workers.ts e2e/fixtures/engine-native-circuit.worker.ts e2e/fixtures/engine-native-festival.worker.ts e2e/fixtures/engine-worker-clock.ts
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/eslint/bin/eslint.js e2e/engine-native-workers.spec.ts e2e/fixtures/engine-native-workers.ts e2e/fixtures/engine-native-circuit.worker.ts e2e/fixtures/engine-native-festival.worker.ts e2e/fixtures/engine-worker-clock.ts
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node /engine-work-4e0075ccccb3/reports/36-worker-node-smoke.mjs /engine-work-4e0075ccccb3/repo /engine-work-4e0075ccccb3/reports/36-worker-node-smoke.json
```

The coordinator must publish the fixtures and verify both tests in the focused Chromium/Mesa workflow, preserving failed evidence if any assertion differs. At this handoff the workflow contains the existing 11 tests plus these two new cases.

## Limits

The controlled clock does not test real CPU-budget exhaustion, operating-system scheduling, renderer throughput, browser heap pressure or real user-input timing. Required pause/init/rewind/field-change snapshots may intentionally allocate beyond the ordinary idle reserve; these tests do not claim a global hard cap on every queued control snapshot. The Festival size checks do not establish sender authentication or same-sized cross-generation buffer identity.

The circuit fixture covers the ordinary Formula practice path and water/rubber/marble surface arrays, not motocross terrain deformation. The Festival case uses the existing road-car/event path with traffic disabled. Models, visual rendering, physical controllers and audio hardware are outside this test. No full-project compiler run or browser result is claimed by this agent.

All six repository files remain unstaged. No commit or push was performed.
