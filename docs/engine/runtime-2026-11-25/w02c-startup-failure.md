# W02C — Startup failure recovery and cancellation

Assignment 9/60. Read `SESSION.md`, the W01A runtime audit, and the preceding
advancement ownership guide. Changed only
`src/session/session-start-owner.ts`, added
`tests/engine-startup-error-recovery.test.ts`, and wrote this report.

## Behavior

The audited defect is in the actual host owner: a `ready()` failure followed by
throwing session disposal previously skipped `task.failed()` and replaced the
startup failure. `GameApp.startFestival()` supplies that recovery callback to
restore its circuit presentation; `GameApp` itself remains unchanged.

The owner now continues recovery after a disposal exception. Its error contract
is explicit:

| Outcome | Returned startup result |
| --- | --- |
| Owned startup fails; recovery succeeds, including after disposal throws | Reject with the exact original startup value. |
| Owned startup fails; recovery also throws | Reject with `AggregateError([startupError, recoveryError], recoveryMessage, { cause: startupError })`. Both error identities survive; the host retains its existing terminal recovery diagnostic. |
| Cleanup or recovery synchronously admits a successor | Resolve the departed operation. Skip obsolete recovery where it has not run, and never send an old rejection to the host's outer error handler. |
| Host cancels an unresolved module load or session creation | Resolve with `undefined` promptly, independently of the underlying operation's eventual settlement. |

A per-admission generation distinguishes a replacement from the failed run even
after cleanup has revoked the old owner. Normal scope guards still use the run's
identity and abort signal. Direct `cancel()` keeps its existing revoke-before-
abort/dispose ordering and still propagates a disposal exception to its caller.

Cancellation races the caller's wait against abort while the original startup
continuation remains observed. A late import cannot call `create()`. A late
creation result is disposed exactly once; stale rejection or disposal failure
cannot fail, recover, clear the loading state of, or otherwise adopt into a
replacement. The abort waiter is detached on success and before failure cleanup,
so cleanup's own abort cannot accidentally turn a genuine failure into success.
Underlying imports/creation are not forcibly terminated by this wrapper.

## Focused validation

Final source passed:

```sh
./node_modules/.bin/vitest run --pool=threads --maxWorkers=1 --minWorkers=1 tests/engine-startup-error-recovery.test.ts tests/festival-host-startup.test.ts
```

**28 passed:** 16 new regressions and all 12 existing owner tests. New cases cover
throwing disposal/recovery, an `undefined` startup rejection, reentrant admission
during abort/disposal/recovery, never-settling loads and creates, cancellation
before the adoption job, and late success/rejection/disposal faults after the
cancelled caller has already settled.

The unchanged host diagnostic regression also passed:

```sh
./node_modules/.bin/vitest run --pool=threads --maxWorkers=1 --minWorkers=1 tests/engine-cross-mode-startup.test.ts -t "keeps failed renderer restoration terminal"
```

**1 passed, 23 intentionally filtered out.** It retains the existing recovery
message and terminal host state. A preliminary implementation that returned only
the startup error failed that existing message assertion; retaining both errors
with the recovery diagnostic fixed the contract without changing the old test.

Scoped ESLint and strict TypeScript checking passed for the owner and new test:

```sh
./node_modules/.bin/eslint src/session/session-start-owner.ts tests/engine-startup-error-recovery.test.ts
./node_modules/.bin/tsc --noEmit --target ES2022 --lib ES2022,DOM,DOM.Iterable --module ESNext --moduleResolution Bundler --strict --allowImportingTsExtensions --skipLibCheck --types node src/session/session-start-owner.ts tests/engine-startup-error-recovery.test.ts
```

One preliminary default-fork five-file test invocation ended before results with
`ERR_IPC_CHANNEL_CLOSED`; it is tooling failure, not acceptance. Before the final
error-contract refinement, separate controller ownership and resource teardown
suites passed 16 and 18 tests respectively; those are supporting intermediate
checks, not a claim of final integrated acceptance. Root owns the serial
integration run. No full suite, full-project compiler run, browser run, install,
git write, main-file change, or protected-source modification was performed.
