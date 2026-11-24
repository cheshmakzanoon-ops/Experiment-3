# Agent 08 — Festival fatal worker failure handling

Date: 2026-11-24. Checkout: `/engine-work-4e0075ccccb3/repo`.

## Outcome

Festival simulation/transport failures now carry explicit terminal classification into the session receiver. A terminal failure closes the session lifetime, settles pending readiness and command requests, disposes the session resources and both workers, and tells an already-running host to exit. Startup errors still reject `FestivalSession.start()` without a second host exit. Recoverable command errors retain their existing behavior.

Read the supplied audit at its actual path, `reports/01-runtime-audit.md`; the task's `report01-runtime-audit.md` filename does not exist.

## Production changes

- `src/workers/open-world-protocol.ts`: added optional `fatal?: boolean` to the existing `error` message. Missing classification retains the recoverable meaning of legacy error messages; the `command-result` wire shape is unchanged.
- `src/workers/open-world.worker.ts`: interval failures and the outer message-processing failure boundary now pause the worker and emit `fatal: true`. The command invocation has its own recoverable catch: correlated rejections still use `command-result`, while uncorrelated errors explicitly emit `fatal: false`. Snapshot writes, status generation and transport after a successful command remain outside that catch, so they cannot masquerade as command validation errors. Failed delivery of a command rejection also reaches the fatal transport path.
- `src/session/free-roam.ts`: dispatches explicit fatal messages through the existing terminal failure/lifetime path. Added a terminal simulation-worker `onmessageerror` handler and detached it during disposal. Native `onerror` remains terminal.

The host/session remains the termination owner. The worker immediately pauses on terminal error, then the session terminates it. This preserves existing low-level frame-pool recovery behavior when a standalone worker harness deliberately resumes after an injected failure, without enabling recovery in a disposed production session.

## Regression coverage

Added `tests/festival-fatal-worker.test.ts` with 16 cases. It executes the real worker and simulation, uses actual transferable buffer detachment, and delivers serialized messages to the real `FestivalSession` receiver and controls. Rendering, asset loading, UI and browser worker transport are doubled.

Coverage includes:

- Interval step, frame-write, status and transport failures.
- Command frame/status/transport/receipt failures, including a failed rejection receipt.
- Initialization construction, first-frame and status failures through actual session startup.
- Exactly-once rejection of multiple command waits, timer clearing, session/worker disposal, audio stop and running-host exit.
- Ignoring queued errors, native callbacks, command receipts, frames and status after disposal.
- Native worker errors and message-decoding errors.
- Actual unknown-event/vehicle command failures, successful work after them, and legacy error-message compatibility.

The new harness reuses loaded worker/simulation modules and initializes a fresh simulation through the worker's existing `init` command for every case. This avoids loading a separate authored world data graph for every test while preserving actual worker execution.

## Verification

Passed: **5 files, 61 tests**, in 26.67 seconds:

```text
flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run tests/festival-fatal-worker.test.ts tests/festival-session-lifecycle.test.ts tests/open-world-worker-clock.test.ts tests/open-world-worker-frame-pool.test.ts tests/open-world-worker.test.ts --reporter=verbose
```

Targeted ESLint passed for all four changed source/test files:

```text
node node_modules/eslint/bin/eslint.js src/workers/open-world.worker.ts src/workers/open-world-protocol.ts src/session/free-roam.ts tests/festival-fatal-worker.test.ts
```

Two earlier combined/new-file attempts lost the Vitest subprocess with `ERR_IPC_CHANNEL_CLOSED` before completion. There were no reported assertion failures; isolated real-worker and real-session integration cases passed. Serializing test execution alone did not resolve the repeated module-reload issue. After removing per-case `resetModules()` and retaining the real authored-data module cache, the full focused run above completed successfully. These were runner failures, not passing test runs.

No npm lifecycle hooks, full TypeScript build, full test suite or native-browser run was used. No Git operations were performed. No rendering scene, geometry, model, character, environment or tuning file was changed.
