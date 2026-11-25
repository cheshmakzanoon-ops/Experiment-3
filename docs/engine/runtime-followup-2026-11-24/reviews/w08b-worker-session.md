# Worker 44 / Wave 8B — adversarial worker and Festival session review

## Outcome and scope

Found and corrected one reachable, pre-existing Festival frame-lifetime defect. `FestivalHud.update()` calls its real gamepad poller, which synchronously clicks the focused menu button. When that button is EXIT FESTIVAL, the host cancels `SessionStartOwner` and disposes `FestivalSession` before the HUD update returns. The old `FestivalSession.frame()` then continued using its cached renderer and its now-null status/HUD.

- In cockpit view with a navigation pane, exit threw `TypeError: Cannot read properties of null (reading 'road')` after the session had already closed.
- In chase view, it still called `navigation.detach()` on the disposed renderer and continued toward audio update.

The narrow correction is a three-line comment/`if (this.disposed) return;` immediately after `this.hud.update(...)` in `src/session/free-roam.ts`. No constructor, renderer, UI, layout, model, environment, material, texture, geometry or tuning definition was changed. No worker protocol or simulation behavior was changed.

The pre-fix `FestivalSession.frame` method is byte-for-byte identical to task baseline `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`; the new failure is **not attributed to the earlier terminal-state/backpressure changes**. `/tmp/engine-c71f32882729/w08b-baseline-method.json` records the method comparison after removing only the three added lines from current source.

Files changed by this worker:

1. `src/session/free-roam.ts` — three-line post-HUD disposal guard.
2. `tests/engine-worker-session-adversarial.test.ts` — six independent boundary cases.

No git mutation, staging, commit, push, publication, dependency installation, npm generation hook, broad suite or build was performed. Root owns publication and shared ledger updates. COMPUTE was explicitly released to root after validation.

## Independent regression and acceptance coverage

The new suite executes the complete production FestivalSession class extracted with the established TypeScript AST technique. It uses the actual `FestivalHud` constructor, update method, gamepad polling and registered click listener; actual `SessionStartOwner`, `SessionLifetime` and `LiveFrameClock`; and real simulation status/frame data. The DOM adapter supplies button targeting/click dispatch and element state, while canvas painting and the renderer/worker boundaries are doubled. No ownership branch or lifetime method is reimplemented in the fixture.

The two exit cases cover cockpit and chase. They verify the real menu click, owner cancellation, session disposal and one termination of each worker, no subsequent navigation/audio calls, and no draw or click on another frame delivered to the departed session. A continuing-session control proves that the same HUD frame still updates navigation and audio normally when no exit button is pressed.

The other three cases independently exercise the reviewed transport contracts:

1. EngineeringChannel: synchronous acknowledgement, reset/re-enable and successor publication inside the predecessor's send callback, followed by a thrown predecessor callback. Its successor retains the sole credit; an old ACK cannot free it. This is explicitly **same-thread callback-seam stress**, not a claim that native Worker.postMessage delivers a synchronous response.
2. Actual circuit worker: a held engineering receipt survives a replacement init that fails after real frame construction; its ACK while terminal does not publish or revive the worker; fresh init gets a newer receipt; the old duplicate cannot release it.
3. Actual Festival worker: 62 held statuses, failed replacement init after real frame construction, then fresh inits fill the existing 64-credit bound. One old ACK permits exactly one new initialization/status, and repeating that old receipt cannot bypass the bound. Queued resume after failed init cannot publish anything.

Worker tests import both real worker module graphs and run their real simulation/frame methods. They use Node's real `structuredClone` transfer detachment, a manually advanced clock and captured worker interval callbacks. They do not instantiate native DedicatedWorkers or claim native scheduler behavior.

The supplied source and task-baseline diffs were reviewed for physics/open-world worker terminal behavior, engineering credit, Festival status credit, command validation, lifetime settlement and host ownership. The assigned existing suites were rerun with the new cases. No further supported defect was found in command validation before mutation, ordinary execution failure classification, old receipt conservation, or SessionLifetime's success/failure/abort cleanup ordering.

## Pre-fix evidence

The supported gamepad regression command, before the source correction:

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/engine-worker-session-adversarial.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0 --reporter=dot
```

Result: **2 failed / 4 passed**, one file, **5.89 seconds**. The two failures are the cockpit null-status read and the chase post-disposal navigation call. Raw evidence: `/tmp/engine-c71f32882729/w08b-gamepad-baseline.log` (identical copy of the originally captured `w08b-gamepad-prefixed.log`).

Exploratory results are retained honestly but are **not counted as production defects or fixes**:

- An initial seven-case probe had three transport passes and four failures from mocked constructors that arbitrarily aborted during construction. Reading the actual renderer/traffic/rider/HUD constructors found no supported synchronous cancellation callback at those construction sites. Those assertions were removed instead of adding speculative resource-adoption complexity. Scratch source: `w08b-unsupported-constructor-probe.ts`; output: `w08b-adversarial-prefixed.log` (4 failed / 3 passed, 5.37 seconds). These are unsupported synthetic scenarios, not native or game reachability evidence.
- The first gamepad fixture execution omitted `RACE_BASE`/`R` from its extracted-class binding arguments. That fixture error caused three failures before reaching the gamepad boundary (3 failed / 3 passed, 5.67 seconds, `w08b-gamepad-prefix.log`). Adding the actual imported constants corrected the fixture. It is not a source defect.

## Final validation

All commands ran from `/tmp/engine-c71f32882729/repo` under the exclusive COMPUTE lease. No retries or focused-only cases were enabled.

Focused gate:

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/engine-worker-session-adversarial.test.ts tests/engine-circuit-worker-terminal.test.ts tests/engine-diagnostics-backpressure.test.ts tests/engine-festival-status-backpressure.test.ts tests/engine-festival-command-errors.test.ts tests/engine-festival-composition.test.ts tests/engine-session-settlement.test.ts tests/festival-session-lifecycle.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0 --reporter=dot
```

Result: **116/116 tests passed in 8/8 files**, **25.31 seconds**, exit 0. Raw output: `/tmp/engine-c71f32882729/w08b-final-tests.log`.

The new suite was rerun after fixture-only type/comment cleanup (required unused `traffic` callback supplied and a redundant test click placeholder removed), with the exact single-file command above: **6/6 passed**, **5.74 seconds**, exit 0. Raw output: `/tmp/engine-c71f32882729/w08b-final-adversarial.log`.

Scoped static gates:

```sh
node node_modules/eslint/bin/eslint.js src/session/free-roam.ts tests/engine-worker-session-adversarial.test.ts
NODE_OPTIONS=--max-old-space-size=512 node node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,DOM,DOM.Iterable --strict --allowImportingTsExtensions --resolveJsonModule --isolatedModules --skipLibCheck --types vite/client,node src/build-flags.d.ts tests/engine-worker-session-adversarial.test.ts
node node_modules/prettier/bin/prettier.cjs --check tests/engine-worker-session-adversarial.test.ts
git diff --check -- src/session/free-roam.ts tests/engine-worker-session-adversarial.test.ts
```

All passed, exit 0. ESLint and isolated strict TypeScript have empty success logs at `w08b-lint.log` and `w08b-types.log`. The TypeScript check covers the new test/import graph; it is not a claim of a whole-project compiler gate. The new test was formatted with `node node_modules/prettier/bin/prettier.cjs --write tests/engine-worker-session-adversarial.test.ts` before the focused gate.

## Main-loop review and remaining limits

No `src/main.ts` correction is proposed. Its frame method schedules the next RAF before invoking the Festival session, and the following `tickDemoClock()` already returns when `this.festival` is absent. `exitFestival()` cancels the owner, disables input, stops audio and restores menu state. FestivalSession.frame does not drive rumble; the rumble update is in the separate circuit snapshot receive path. This is source inspection, not a new full-application/native-gamepad run.

The fix prevents a valid user exit from escalating into the application's global error handler or touching already-disposed renderer state. It does not alter visual definitions or rendering output before the exit, and the continuing-session control retains navigation/audio behavior.

No browser/native WebGL/gamepad hardware run, end-to-end FPS measurement, heap/GC measurement, deployment or full build was performed here. Existing native source/evidence remains untouched under `docs/engine/runtime-followup-2026-11-24`. Native browser coverage and the root's subsequent aggregate gates remain the appropriate place to validate full application integration and the final combined tree.
