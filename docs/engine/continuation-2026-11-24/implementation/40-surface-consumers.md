# Agent 40 — host surface-consumer ownership

Wave 7, agent 40 of the requested 60. The independent integration review is complete. **No production defect was found and no production file was changed.**

## Result

Added `tests/surface-consumer-ownership.test.ts` with **10 passing integration cases**. The tests connect the complete production host receiver to a real `SurfaceChannel`, actual `SessionReplay` surface capture and notification, actual `GameApp.fail`, and a real `WorkerReadiness` / `SessionLifetime`. The actual `TerrainView.record` method is selected from source to exercise keyframe retention without constructing a venue or loading assets.

Existing agent-10 tests already cover the basic four-consumer replacement matrix, ordinary credit bounds, failed sends, and send-time ACK/republication followed by an older exception. Those cases were reviewed rather than duplicated. This new suite checks the additional consumer, storage and lifetime integration, plus replacement during capture rather than during send.

## Distinct coverage

| Cases | Integration contract |
|---|---|
| 2 | In driving and replay modes, actual structured-clone transfer detaches sender arrays; ACK releases transport credit while receiver-owned live and terrain buffers remain attached. Three successive publications retain independent buffers. Actual replay encoding remains unchanged when a retained receiver array is subsequently modified. Replay mode records terrain history without invoking live presentation. |
| 1 | An actual replay validation failure invokes the production nonthrowing recording notification. A controlled UI callback requests terminal host recovery. The actual host failure method closes the real startup lifetime with the original Error, terminates the worker, and prevents subsequent renderer/terrain consumption and ACK. Later queued packets are ignored. |
| 1 | A recording notification departs to a successor generation. The old callback cannot ACK through the successor worker, update its renderer, append into its replay, or deliver a later recording notice. The successor continues successfully on its independent channel. |
| 3 | Render, terrain and capture-gap notification callbacks request actual host failure and return normally. Ownership is rechecked after each callback; no ACK is granted, the exact Error remains the startup lifetime reason, and queued later work does nothing. |
| 1 | A failed ACK transport preserves the original Error after all consumers have completed. It neither erases the retained replay/terrain data nor falsely grants capacity to the producer. |
| 2 | A capture callback replaces the surface epoch and either returns or throws. The obsolete packet is never sent, its arrays remain attached, and the successor's pending full rebase survives with its own epoch/sequence and without an inherited capture-gap warning. |

The quantized replay fixture uses independently specified boundary values: water `[1, 2]`, rubber `[1, 0]`, marbles `[0, 1]`, and frozen cover `[8, 0]`. Its expected encoded words are `[1000, 65535, 0, 65535, 2000, 0, 65535, 0]`. Assertions inspect the resulting private keyframe read-only; the capture/encoding implementation itself is the production method.

Terrain history intentionally retains the receiver-owned delta by reference. The tests do **not** claim that terrain history is immune to arbitrary mutation of that same receiver object. They prove that later transferred packets and sender detachment do not corrupt its ownership, and that the replay's separately encoded surface data stays independent.

## Source selection and boundaries

TypeScript AST selection obtains the complete `GameApp.start` worker callback, its actual cancellation predicate and replay notification, plus the complete `GameApp.fail` method. Selection requires exactly one matching receiver/predicate/notification and fails if that structure is ambiguous. No surface branch, ACK condition or lifecycle predicate is copied into a handwritten test implementation.

The selected `TerrainView.record` method uses a controlled `showLive` boundary, so this suite tests terrain keyframe ownership and live/replay dispatch, not mesh uploads or native rendering. Other renderer/UI services are explicit callbacks. Terminal transitions in those callbacks are intentional fault injection; the report does not claim that the normal recording warning automatically closes a game session.

Transfer uses Node's actual `structuredClone(..., { transfer })` and checks detached buffers, with synchronous fixture delivery to stress ownership boundaries. This is not a native browser or actual Worker scheduling test. Agent 36's separate browser gate owns that evidence. The replay page store is a disposable in-memory boundary and is never asked to read or write a frame page in these surface-only cases. No user save data or IndexedDB profile is opened.

## Verification

The initial run passed all 10 cases. The strict fixture check then exposed an empty-array `never[]` inference in the test's terrain holder; an explicit `Terrain['history']` annotation corrected the test type without changing runtime behavior or assertions.

Final delivered suite: **10/10 passed**, 24 ms test execution and 1.28 s total. This is the same set of 10 cases, not 20 unique tests. Scoped ESLint, strict TypeScript compilation of the test and its imported dependencies, Prettier checking, and explicit newline/trailing-whitespace checks passed. `40-surface-types.log` is empty on the successful compiler run; `40-surface-final.log` retains the final result.

All heavy commands used the shared lock, a 512 MiB Node heap and one Vitest worker. No npm lifecycle scripts, full-project build, browser launch, optional broad-suite rerun, commit or push was performed.

Commands (run from the repository):

- `flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/surface-consumer-ownership.test.ts --maxWorkers=1`
- `flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --esModuleInterop --types node tests/surface-consumer-ownership.test.ts`
- `flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/eslint/bin/eslint.js tests/surface-consumer-ownership.test.ts`
- `flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/prettier/bin/prettier.cjs --check tests/surface-consumer-ownership.test.ts`

## Handoff and provenance

Repository edit: only the new `tests/surface-consumer-ownership.test.ts`. It remains unstaged. No production, model, character, environment, geometry, material, track, tuning, asset or dependency file was changed by this agent.

`40-surface-consumer-sources.json` records SHA-256 fingerprints for ten exercised/source-selected files. Checkout HEAD at handoff was `517340e6822332dc0f37ce40788a73e1414d85f7`; the actual working-tree fingerprints establish the tested source independently of concurrent coordinator publication.

Final test SHA-256: `2108f0c1d7c50be4c1f4f4bcaaef3fa2754ad2f6cfab1bc6a35109d63919e42b`.

The current production ownership behavior passed this independent review. File ownership is released to the coordinator; complete-project validation remains its integration gate.
