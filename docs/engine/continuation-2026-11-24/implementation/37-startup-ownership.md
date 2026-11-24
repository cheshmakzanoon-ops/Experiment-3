# Agent 37 — circuit renderer startup ownership

Wave 7, agent 37 of the requested 60. Implementation and focused checks are complete. Source ownership is released for coordinator review and publication.

## Defect reproduced

The circuit startup lifetime already settled a departed caller, but that did not cancel the underlying renderer operations. Two complete production methods in main.ts retained unsafe asynchronous continuations:

- switchCircuit waited for requestAnimationFrame, then disposed the renderer and changed the track without checking whether its request still owned the application.
- buildRenderer assigned the factory's awaited result directly to the shared renderer field. An older result, including null, could overwrite a successor. Its progress callback and factory rejection also remained live after replacement.

The new integration suite executes those actual methods selected through the TypeScript AST. Before the repair, **18 of 23 cases failed and five passed**. The failures include a stale RAF destroying a successor, late result publication, old null completion erasing an active renderer, old progress reaching the current UI, uncontained late rejection, and unretired late candidates/templates. Current boot configuration and active failure identity already passed and remain protected by the suite.

Raw before/after evidence is retained in 37-before.log, 37-after.log and 37-focused.log beside this report. The failed run is an intentional reproduction, not a remaining failing gate.

## Repair

The production change is confined to the renderer-build ownership sections of src/main.ts: one request counter and the existing buildRenderer/switchCircuit methods. The current worker startup gate, input callback repair, model selections, catalogue definitions and renderer factory implementation are unchanged.

Each renderer operation now captures both the session generation and a separate renderer-build request serial. The serial also distinguishes overlapping requests within the same session generation, including menu presentation upgrades. A later switch that can reuse the existing renderer still invalidates an older deferred switch before taking its fast return.

A switch checks ownership again after its RAF and after retiring the old renderer. It releases the shared renderer reference before disposal callbacks can reenter, then checks whether the same request still owns the host before creating a new track or beginning construction. The existing selected circuit, motorcycle/template reuse rule and factory arguments are preserved.

A build retains its factory result in a local candidate. It publishes that candidate only while its generation and request still match. Old progress is ignored; a rejected old factory returns false without failing the replacement. Errors from the current factory retain their exact original values, including Error objects, undefined and zero. A non-null late candidate is disposed without overwriting the current renderer. A late cleanup failure is reported separately and does not revive the abandoned operation.

The accepted candidate receives the existing showroom, motion, colour-accessibility, livery, sky, audio and UI configuration. Audio/UI track publication uses the same track object captured for its factory request, avoiding a later mutable host track reference.

## Ownership evidence

The 23 new cases cover:

- A normal current boot with the original factory arguments and configuration.
- Generation replacement, application disposal and application failure during a pending factory.
- Two builds in the same generation completing out of order, including an old null result.
- Active versus obsolete factory failures and disposal failure of a late candidate.
- No further factory or menu-reset work after application disposal/failure.
- Old RAFs after replacement/disposal/failure and out-of-order same-generation switches.
- A newer same-circuit fast return invalidating an older switch.
- Renderer disposal callbacks replacing the session before track construction.
- Actual WorkerReadiness/SessionLifetime cancellation while the old RAF is still pending.
- Adopted and unadopted template transfers on cancellation, without releasing the successor's resources.
- Normal successful template adoption retaining resources until the accepted candidate is disposed.

The template tests execute the actual CarTemplateTransfer constructor/take/dispose methods with disposable resource doubles. They verify engine ownership without loading, generating or changing any authored mesh or character data. They establish ordinary disposal ownership; they are not a physical-GPU resource measurement.

## Verification

The combined focused run passed **143 of 143 tests in five suites**:

| Suite | Passing cases |
| --- | ---: |
| circuit-build-ownership | 23 |
| circuit-startup-settlement | 27 |
| startup | 65 |
| controller-session-ownership | 16 |
| festival-host-startup | 12 |

This count includes the new cases once; the separate 23-case green run is not added again. The combined run took 11.25 seconds. Scoped ESLint passed for both edited files. Strict scoped TypeScript compilation passed for the test and imported helpers; its output log is empty. New-test Prettier formatting and scoped whitespace checks passed.

Commands used the shared test lock, a 512 MiB Node heap and one Vitest worker. No npm lifecycle hooks or asset-generation scripts were run.

~~~sh
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/circuit-build-ownership.test.ts tests/circuit-startup-settlement.test.ts tests/startup.test.ts tests/controller-session-ownership.test.ts tests/festival-host-startup.test.ts --maxWorkers=1
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/eslint/bin/eslint.js src/main.ts tests/circuit-build-ownership.test.ts
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --types node tests/circuit-build-ownership.test.ts
~~~

## Provenance and limits

The original selected host source is main.ts from commit 676d4c8531695638537bf62af5a74ca8edbe41ef. The new test reads complete production methods at execution time; it does not reproduce their ownership guards as fixture logic. The fixture initializes ordinary host state and controls the external renderer factory, RAF delivery, UI and track-construction boundaries. It imports the real startup lifetime and uses the real template transfer methods. Native browser rendering, real asset loading and full application boot remain coordinator integration gates.

| File | SHA-256 |
| --- | --- |
| Original main.ts | f4204471fc1e64ac7f96ac2df4f4d6f32379af2da53cd095fc1dc4ce0c738d39 |
| Repaired main.ts | 615793eabeb4889aa8ae23568e5297a09139957b96cb8307be03630a9cfed259 |
| New integration suite | 3428b27a34c23f57644042c1f1ac8f8dee2eb55a96c61aad237ad24d1ea93256 |

The production diff is 60 added and 19 removed lines in main.ts. No models, character files, authored environments, geometry definitions, track data, material definitions, vehicle/audio tuning or dependencies changed. No renderer factory edits, staging, commits, pushes or full-project compiler run were performed by this agent.
