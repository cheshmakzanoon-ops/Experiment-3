# Wave 8: adversarial engine review and resulting corrections

Six independent assignments reviewed networking, worker/session transitions, storage, input/audio, resource ownership and physics. The wave adds 66 regression cases across six engine test files. It keeps favorable and unfavorable evidence and distinguishes supported application callbacks from artificial scenarios that do not establish a production defect. The consolidated final gate is a separate wave; focused totals below overlap and must not be added as a unique aggregate.

## Networking: revoke publication and timer ownership at callback boundaries

Four demonstrated defects were corrected in `src/net/server.ts`:

- A transport callback during grid announcement could tear down the server, after which the old call still scheduled a countdown.
- Teardown during the final snapshot/events flush could be followed by new record/results publication.
- Teardown during a results send could still install a linger timer.
- Failure of the first chunked-results send cleared `player.connection`; a later chunk then dereferenced null and prevented healthy peers from receiving their results.

Grid and results transitions now check phase/world ownership after external sends. Each result recipient retains its captured connection and stops receiving further chunks when that ownership ends. Normal packet order is preserved. Nine new cases use actual clients, server, event loop, codec and transport composition; ordinary final records are verified by replay. The large-classification fixture seeds lap-time lists to exercise real chunking and makes no claim to simulate hours of physical racing.

Six cases failed before correction. A 73-case, seven-file gate passed, followed by the final nine-case adversarial file after adding two stale-deadline checks: 75 distinct passing cases across those runs. A hand-authored legacy tag-0/tag-4 journal also retained old persistent-shift behavior and exact record verification. [Detailed review](reviews/w08a-network.md); [before](validation/w08a-network-before.log), [gate](validation/w08a-network-gate.log), [final file](validation/w08a-network-final.log).

## Worker/session transitions: stop a frame after the gamepad exits Festival

The real Festival HUD polls a gamepad and can synchronously click EXIT FESTIVAL. That callback disposes the session before `hud.update()` returns. The old frame then accessed cleared status in cockpit view or touched a disposed navigation owner in chase view.

A disposal check immediately after HUD update now returns before those accesses, input synchronization or later audio work. The affected frame method matched the task baseline before correction, so this was an existing defect found during review. No main-loop, rumble or authored environment change was required.

The supported reproduction failed in two cases before correction. The focused worker/session gate passed 116 tests across eight files, and the final six-case adversarial file passed. Additional cases verify engineering-credit handoff and old receipts across failed initialization. Artificial constructor-abort experiments were excluded from delivered defect counts and assertions because no supported synchronous cancellation callback was established in those constructors. [Detailed review](reviews/w08b-worker-session.md); [supported pre-fix evidence](validation/w08b-gamepad-prefixed.log).

## CSV export: materialize completed groups without retaining all CSV strings

Wave 7 established that the existing 500-row formatting loop retained every completed string until final Blob construction. The measured correction changes only storage of completed groups: each becomes a native Blob before being retained. The final output still owns its full payload; this is not constant-memory streaming.

| Measured default-size result | Baseline | Corrected implementation |
| --- | ---: | ---: |
| Node median export time, five fresh-process pairs | 2,210.919 ms | 1,801.424 ms |
| Median Node process high-water RSS through export, before verification | 628.602 MiB | 370.602 MiB |
| Native worker median completion, three pairs | 1,676.0 ms | 1,561.0 ms |
| Retained string code units at final Blob assembly | 115,038,761 | 2,859 |

Every candidate latency sample was faster than its paired baseline. All eighteen full default-size exports matched every byte of the same 115,038,761-byte CSV. The 49,248,000-byte typed snapshot, CSV header/channel order, `String(number)`, newlines, MIME, validation and transfer/cancellation contracts are preserved. Higher candidate RSS samples remain in the raw report. Node process measurements are not browser peak-memory measurements, and maximum capacity was not allocated or timed.

The retention regression failed before the change while twenty other cases passed. The corrected focused gate passed 87 tests across four files; native transfer/cancellation/replacement/recovery cases passed 2/2. No additional recorder, replay or ghost defect was established by this review. [Storage review](reviews/w08c-storage-memory.md); [complete measurement and limits](measurements/w08c-csv-memory.md); [raw evidence](measurements/w08c-csv-memory-raw.json). Historical Wave 7 CSV evidence remains unchanged and accurately describes its earlier pinned commits.

## Input/audio: finish observing input before callbacks, and reject stale activation

`ControllerActions.poll()` now observes the complete button snapshot and selects its single allowed action before calling the application. Previously, a reentrant or throwing action callback, including replacement-device acquisition, could leave later held buttons unobserved and manufacture a delayed command. Index priority, mappings, allowlists and shift acknowledgement are unchanged.

Audio preview now requires a live context to be running before it schedules tones. A rejected, synchronously refused or timed-out resume previously left the context suspended but still armed preview tones, which could play after an unrelated later unlock gesture. Offline contexts intentionally continue to schedule before rendering. Refused activation does not consume preview cooldown.

Six of seven new cases failed before the two corrections; the offline control passed. The final focused gate passed 118 tests across eight files. Actual AudioUnlock gesture listeners and late-settlement ownership are exercised. Existing haptics failure/recovery coverage revealed no additional defect, so rumble and controller mappings were left unchanged. [Detailed review](reviews/w08d-input-audio.md); [before](validation/w08d-pre-fix.log) and [after](validation/w08d-focused.log).

## Resource release: remove ownership before callbacks and finish independent cleanup

Both texture budgets now remove an unregistered wrapper from their ownership indexes before dispatching disposal callbacks, preserve its old source while dispatch runs, and restore the original source in `finally`. A callback that closes the budget can no longer revisit that wrapper. Root unregister continues through independent wrappers after an error and rethrows the first value, including `undefined`.

The generic `disposeSceneTexture` helper also attempts to close exclusively owned decoded bitmap storage after a texture callback fails, while keeping shared cache images borrowed. The renderer attempts the existing planting owner after budget unregister fails and preserves the first error.

Seven cases failed on both the pre-fix implementation and an actual task-baseline source overlay. The corrected gate passed 67 tests across eight files, including twenty-two real vegetation-quality transitions and ten new adversarial cases. Full TypeScript and focused lint passed. The existing four native resource cases also passed on the new source, preserving pixel results and six borrowed-renderer cycles.

These guarantees are deliberately bounded. Three's sequential listener dispatch can still be interrupted before its own GPU-release listener. Protected planting/BikeShells implementations and vendor internals were not edited. The renderer guarantees a planting release attempt; it does not claim to drain every internal resource after a callback inside that protected owner fails. Registration/apply/quality paths are unchanged, including the documented `N + groups` to `2N` initial disposal-event tradeoff and already-shared GPU storage. [Detailed review](reviews/w08e-resources.md); [fresh native metrics](validation/w08e-native-metrics.json).

## Physics: reject fractional collision rows before scalar writes

Independent numeric review identified a boundary regression in the scalar collision-buffer writer. For row counts 0.4, 1.4 and 7.4, the original typed-array `set()` path threw an out-of-bounds RangeError; scalar writes could instead silently ignore overflow and return incomplete meshes with trailing zero vertices.

`TrackContactMesh` now rejects any non-positive or non-integer row count before construction. Supported positive integer inputs preserve exact buffers and BVH nodes. Zero, negative zero and other malformed values were already rejected by the original construction path; the new guard makes their rejection earlier and clearer, with an explicit RangeError. No authored sampling configuration or geometry definition changed.

The actual baseline/current proof is retained before and after the guard. Thirteen new tests cover nine constructor-domain cases and four vector-alias cases. The final focused physics gate passed 62 tests across six files. The reviewer also recomputed the unfavorable W07B and approximately neutral W07E vehicle statistics, verified source/harness identities, and accepted the narrow road-frame optimization without a natural-vehicle throughput claim. No additional timing run was performed. [Detailed review](reviews/w08f-physics.md); [before](validation/w08f-fractional-rows-before.json), [after](validation/w08f-fractional-rows-after.json), and [focused gate](validation/w08f-physics-final.log).

## Scope and next validation

Every production edit in this wave is an engine algorithm, callback boundary, input validation or resource-ownership change. Authored models, characters, environments, visual definitions, assets and vehicle tuning remain unchanged. New tests use the existing focused CI glob. Wave 9 consolidates the unique affected test inventory and checks lint, compiler, production build, native contracts and full-game replay on the final source.
