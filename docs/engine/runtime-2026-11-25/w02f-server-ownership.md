# W02F — server deadline and transport ownership

## Change

The [W01B audit](w01b-network-audit.md) demonstrated that a silent accepted
connection retained its join callback and both installed transport handlers
after server teardown. `src/net/server.ts` now retains each join deadline and
handler identity. Successful join/rejoin cancels the join deadline before
welcome or old-owner cleanup. Close, loss, disconnect, replacement and
teardown cancel remaining join work and detach only matching handlers.

Grid countdown and results linger deadlines have owned handles, clear their
ownership before firing, and are canceled during teardown. Teardown releases
every peer's handlers and all server timers before the phase observer and
transport close hooks. Identity checks also preserve a newer transport owner
installed before cleanup or reentrantly by an observer/earlier peer close.
Active close failures remain recorded; terminal cleanup still continues after
observer/close failures and rethrows the first original error.

## Evidence

New `tests/engine-server-owned-deadlines.test.ts`: **14 passed**. It checks
immediate live `heap[].fn` references, successful join, loss/leave/rejection/
timeout, send and close errors, countdown/results cancellation, throwing
teardown observers, stale rejoin callbacks, and transport replacement before
and during cleanup. The silent PERFECT_LINK witness has **zero live callbacks**
after same-instant graceful close delivery, while **two canceled heap slots**
remain pending. Server callback revocation itself is checked before delivery
and before external cleanup hooks; no deadline-expiry drain establishes it.

Existing focused acceptance: **24 passed** across `net-lifecycle.test.ts`
(5), `engine-server-snapshot-lifetime.test.ts` (10), and
`engine-network-adversarial.test.ts` (9). These retain normal authoritative
phase/result delivery and reentrant active-peer failure isolation.

Both runs used:

```sh
NODE_OPTIONS=--max-old-space-size=512 node_modules/.bin/vitest run tests/engine-server-owned-deadlines.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
NODE_OPTIONS=--max-old-space-size=512 node_modules/.bin/vitest run tests/net-lifecycle.test.ts tests/engine-server-snapshot-lifetime.test.ts tests/engine-network-adversarial.test.ts --pool=threads --maxWorkers=1 --minWorkers=1
```

Scoped ESLint and Prettier checks passed for both TypeScript files. No test
failure, OOM or IPC failure occurred in these targeted runs.

## Limits

This is callback-retention and ownership evidence, not a heap-size, GC,
physical-network or FPS measurement. `EventLoop` and its `pending` contract
are unchanged: canceled heap slots remain with `fn === null`. No full
compiler, build, dependency install, broad test run or git write was performed
by this worker. Only the server, new focused test and this report were edited;
protected authored content and other workers' files were untouched.
