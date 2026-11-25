# W04B — Native startup cancellation and recovery acceptance

Assignment 20/60. Read `SESSION.md`, the preceding advancement ownership guide,
the W02C report, the current `SessionStartOwner`, and its new unit regressions.
Added only these acceptance files and this report:

- `e2e/engine-native-startup-cancellation.spec.ts`
- `e2e/fixtures/engine-native-startup-cancellation.ts`

The fixture imports the production owner directly. Its browser bundle contains
only that production module and the new fixture. Native `Promise`,
`AbortController`, abort events, microtasks, timer task boundaries, and DOM output
elements remain unmodified. It follows the existing isolated-context, routed-page
native harness and does not load scenes or rendering assets.

## Three acceptance cases

| Case | Exact contract asserted |
| --- | --- |
| Pending cancellation | For both a deferred module load and deferred creation, startup is pending before cancellation and remains asynchronous at `cancel()` return. By the next real browser task, the caller has resolved exactly once while its underlying deferred operation is **still pending**. The order is `cancel`, `cancel-returned`, `start-resolved`, `next-task`. A successor remains loading; a later old load/create rejection calls neither old readiness nor recovery, changes no successor ownership, and cannot change the resolved result. The successor subsequently becomes ready once and is disposed once. |
| Late creation cleanup | Cancellation settles before the deferred creation resolves. Its late instance is disposed exactly once even though disposal throws. Both synchronous and queued stale guarded DOM writes remain inert. Old readiness/recovery counts stay zero; the successor scope remains current and un-aborted, its loading state stays true, and its DOM status remains `successor:preparing`. It then becomes the live session, updates status to `successor:ready`, and is disposed once despite repeated cancellation. |
| Reentrant failure recovery | A `ready()` failure triggers native abort and throwing disposal. One scenario starts the successor synchronously in the old abort listener; the other starts it in recovery, which then also throws. The abort listener observes ownership already revoked. Exact callback order, one old disposal, and zero obsolete outer failures are asserted. Recovery is skipped after abort reentry and called once for recovery reentry. The successor remains loading through the old finalizer, retains a current/un-aborted scope, reaches readiness once, and is disposed once. A modeled host outer failure handler would cancel the successor if an obsolete rejection escaped, so this is an observable ownership assertion. |

Each case observes both browser `unhandledrejection` and `rejectionhandled`
without suppressing their default behavior, as well as Playwright `pageerror`.
The listeners remain installed for the entire document. Two additional native
task turns occur after scenario cleanup before reading the rejection log; every
log must be empty. All three cases attach JSON containing the returned state,
callback ordering, rejection events, and page errors before assertions run.

The task-boundary check is the definition of prompt cancellation here. It is not
a timing benchmark, and the underlying load/create promise is not forcibly
terminated. The deliberately deferred work is resolved/rejected under fixture
control only after the relevant pending-state assertion has been captured.

## Validation and remaining gate

**Native browser execution is pending the root hosted gate.** The known local OS
socket `EPERM` restriction was respected: no browser launch, retry, or bypass was
attempted. These authored cases are not reported as native passes.

Narrow esbuild checks passed with zero warnings for the browser fixture
(`bundle: true`, `write: false`, `platform: browser`, `format: iife`,
`target: es2022`) and for the specification (`platform: node`, `format: esm`,
external packages). The fixture dependency graph contains exactly
`src/session/session-start-owner.ts` and the new fixture. Scoped ESLint passed
for both TypeScript files using a 256 MiB Node heap limit. No full compiler,
production build, unit collection, dependency install, or git write was run.

The hosted acceptance selection is:

```sh
./node_modules/.bin/playwright test e2e/engine-native-startup-cancellation.spec.ts --workers=1
```

This adds browser evidence for the owner's promise/abort/cleanup contract; the
existing W02C units retain the wider error-value and owned-failure matrix.
There are no production changes or new production defect claims. No protected
renderer, model, animation, asset, simulation, or existing fixture was modified.
