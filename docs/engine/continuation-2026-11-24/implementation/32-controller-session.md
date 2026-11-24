# Agent 32 — controller/session publication ownership

Wave 6, agent 32 of 60. Completed. File ownership is released to the coordinator. No staging, commits or pushes were performed.

## Outcome

Independent integration testing reproduced a real Festival recovery failure: when a controller-loss or pause-button action caused the Festival worker's pause publication to throw, the session correctly closed and the application returned to its menu. However, the still-running input callback then dereferenced the now-null Festival owner and threw `TypeError: Cannot read properties of null (reading 'input')`.

The repair is restricted to the existing InputPump callback in `src/main.ts`. It captures the current Festival session before sampling input, then verifies that this exact session still owns the host and still accepts driving input after callbacks return. Only that captured session receives the sampled controls. Pausing, closing or replacing ownership during `InputController.update()` ends this publication attempt. Circuit publication logic, startup readiness, physics, timing, calibration and ordinary control values are unchanged.

The original transport failure remains visible: the regression asserts that the exact original Error object is the closed session lifetime's reason and that its existing Festival error toast is emitted exactly once. The repair removes the secondary null dereference without hiding or replacing the original failure.

No 3D model, character, environment, authored asset, geometry, vehicle tuning or sound profile changed.

## Actual integration exercised

Added `tests/controller-session-ownership.test.ts` with 16 cases. It executes the real InputController, InputPump, FestivalControls, SessionLifetime, SessionStartOwner, PauseHandshake and LiveFrameClock.

The fixture uses the TypeScript AST to select the actual complete GameApp input-pump assignment and host methods, along with the actual complete FestivalSession input, action, pause, publication, failure and disposal methods. It also executes the real FestivalControls construction assignment from the session. No publication guard or action branch is copied into a test-side implementation. This follows the repository's existing source-extraction integration pattern while avoiding automatic application boot and renderer/asset loading.

Worker delivery is an explicit boundary: published messages are structured-cloned into an observed transport, preserving the browser's detached-message semantics. The fixture injects the specific pause publication failure at that boundary. Browser gamepads, DOM presentation and resource construction are fixtures; no claim is made of physical controller, native capture-phase ordering or full browser boot testing.

Coverage:

- Circuit and Festival automatic controller replacement, same-slot replacement, callback-first disconnection, blur and hidden-document transitions.
- Previously held keyboard shift plus replacement-held throttle, brake, steering, camera, pause and paddle controls.
- Exactly one pause publication and no later driving publication until explicit resume.
- Previously published input remains unchanged after InputController resets its retained state.
- Explicit resume admits replacement analog controls while held buttons remain baselines.
- Canceled timer callbacks cannot publish into a restarted pump generation.
- Circuit replay's enabled action-only polling cannot deliver replacement drive input or silently restart playback.
- Festival terminal disposal rejects pending lifetime work, terminates its worker and leaves queued polling without a driving target.
- Both controller loss and a fresh pause-button edge can trigger the actual synchronous terminal worker-failure path without a secondary host exception.

The circuit host adds optional `drs: false` and `overtake: false` fields during its initial publication. Neutral-state expectations include these retained neutral fields explicitly; they do not weaken the driving-control assertions.

## Reproduction and validation

After correcting the fixture's optional-field expectation, the isolated pre-fix run reported **14 passed / 2 failed** out of 16 cases. The two failures were precisely the controller-loss and pause-button terminal-publication cases, both reporting the same null Festival dereference. The raw log is retained at `/engine-work-4e0075ccccb3/reports/32-before.log`.

After the production repair, the combined run passed **68/68 tests in five suites**:

| Suite | Passing cases |
|---|---:|
| controller-session-ownership | 16 |
| controller-replacement | 16 |
| input-controller-lifecycle | 16 |
| input-pump | 4 |
| festival-fatal-worker | 16 |

The focused run therefore includes the real Festival worker/simulation failure regression suite in addition to the callback integration. These cases are one combined run, not a sum of overlapping reruns. Its raw log is retained at `/engine-work-4e0075ccccb3/reports/32-after.log`.

Canonical reproduction of the five matched files:

```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run tests/controller-session-ownership.test.ts tests/controller-replacement.test.ts tests/input-controller-lifecycle.test.ts tests/input-pump.test.ts tests/festival-fatal-worker.test.ts --maxWorkers=1
```

The original combined invocation also included an unmatched `tests/festival-controls.test.ts` filename filter; Vitest resolved only the five actual suites in the table. No pass is attributed to an absent suite.

Scoped ESLint passed for both edited files. Prettier formatted the new test only; it was not run over the large existing main module. The strict scoped TypeScript check of the integration test and its directly imported dependencies passed with an empty diagnostic log. Full-project compilation and native/browser validation remain coordinator gates; this agent does not claim them.

```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/prettier --write tests/controller-session-ownership.test.ts
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/eslint src/main.ts tests/controller-session-ownership.test.ts
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --strict --skipLibCheck --allowImportingTsExtensions --esModuleInterop --types node,vite/client tests/controller-session-ownership.test.ts src/build-flags.d.ts
git diff --check -- src/main.ts tests/controller-session-ownership.test.ts
```

All heavy checks used the shared lock and a 512 MiB heap; Vitest used one worker. No npm lifecycle hook, dependency installation, model-generation operation or optional expansion was run. The final source/test formatting and whitespace checks passed.

## Handoff and source identity

Only these files belong to this assignment:

- `src/main.ts`: the narrow captured-session check in the input-pump callback.
- `tests/controller-session-ownership.test.ts`: 16 integration cases and the exact-source fixture.

Other agents' staged and working changes were preserved. Source identities at handoff (HEAD metadata may advance independently of these file contents):

| Item | Identity |
|---|---|
| Checkout HEAD | `54506ca8a700479868691a262fac385e8ffbb874` |
| HEAD main.ts SHA-256, before this callback change | `f61604b08a86d0355f027ad754efce4001c00a558f449f4b2e4bfe1ec980eb30` |
| Candidate main.ts SHA-256 | `f4204471fc1e64ac7f96ac2df4f4d6f32379af2da53cd095fc1dc4ce0c738d39` |
| New integration test SHA-256 | `0b7d03f76437ee1c400d6136be6e452e60d2e1e0a58e59971438aa097456a9f2` |

The already successful 68-case run preceded formatting-only changes to the new test. Scoped typecheck and ESLint passed after formatting. No further optional retest was needed.
