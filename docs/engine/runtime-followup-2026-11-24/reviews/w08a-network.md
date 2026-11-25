# Worker43 / wave8 — adversarial network ownership review

## Outcome and scope

Four concrete lifecycle/transport defects were reproduced at the published `0f7fecfda61ea7e669f04eebd138c52543144421` checkpoint before production edits. Six regression cases failed before the fix. All now pass. Production changes are limited to `src/net/server.ts` (20 additions, 4 deletions); the new regression file is `tests/engine-network-adversarial.test.ts` (9 cases).

Reviewed the task-baseline-to-checkpoint diff (`1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb..0f7fecfda61ea7e669f04eebd138c52543144421`), current `server.ts`, `authority.ts`, `input.ts`, `client.ts`, `records.ts`, relevant transport/event-loop/simulation code, WAVE-04/WAVE-05 reports, and existing network composition/shift/lifetime/record tests. No changes to authority, quantization, client controls, records, protocol versions, content identities, authored assets, tuning, physics configuration, or protected content were needed. No Git writes, staging, commits, or publication were performed.

## Defects, evidence, and narrow fixes

### 1. Grid announcement could schedule new work after terminal teardown

A real server transport's `send()` wrapper forwards the grid announcement through the actual `NetworkSimulator`, then synchronously invokes the public `server.teardown()`. `startGrid()` subsequently scheduled its 60,000 ms countdown despite losing the session. The pre-fix regression observed a new `loop.after(60000, ...)` while the server already had phase `teardown`.

`startGrid()` now checks both world identity and grid phase after each announcement. It stops before further publication or countdown scheduling if that ownership ended. Ordinary announcement order remains unchanged.

### 2. Final event flush could publish record/results after teardown

The public `onTick` harness hook kicks a real peer on physics tick 7, after the tick-6 scheduled snapshot. That creates the actual driver-takeover event which `endRace()` must flush. The tests then end the server synchronously from each of these supported transport seams:

- the final snapshot's `send()`;
- the final events message's `send()`;
- the transport `close()` invoked after that final snapshot send throws.

All three pre-fix cases entered `teardown`, then `endRace()` nevertheless assigned a new record/results and scheduled its linger callback. They failed the assertion that no record was published after the final flush revoked ownership. They exercise the actual event loop, clients, server, physics, codec, and transport delivery; they do not invoke private `snapshot()` or `endRace()` methods.

`endRace()` now checks the captured world's identity immediately after its results-phase observer and checks phase/world ownership after the final event flush. Finalization returns before creating a record if those callbacks ended the session.

### 3. Result publication could create a linger timer after teardown

A transport forwards the ordinary results packet, then synchronously ends the server. The pre-fix path scheduled another 60,000 ms linger callback after teardown. The already-published record and results were otherwise correct.

Each result send now checks phase/world ownership before advancing. Already-published results are retained, delivery already accepted by the transport remains in its original order, and no new timer is installed after ownership ends. The ordinary-duration regression verifies the resulting 7-tick record by full replay.

### 4. A failed chunked-results send aborted healthy recipients

The first `lapTimes` chunk's send throws. Existing transport isolation correctly disconnects that recipient and clears `player.connection`; the next chunk then called `send(null, ...)`, causing `TypeError: Cannot read properties of null (reading 'closed')`. That uncaught error stopped delivery to the healthy recipient.

The result loop now captures a recipient connection once and stops that recipient's chunks when the player no longer owns it. Healthy recipients still receive all their lap-time chunks and the final classification. The original send error remains the recorded transport failure; no secondary null dereference occurs.

For this one chunk-size case, the public `onTick` test hook seeds each stored lap-time list with 1,500 entries, following the existing `net-resilience.test.ts` large-classification fixture. It exercises real result encoding, chunking, error isolation, and client reconstruction without simulating hours of racing. It is a delivery test; it does **not** claim those injected lap times form a valid physical record or represent a measured long race.

## Other audited boundaries

- Shared-snapshot capture and per-recipient encoding still preserve exact packet bytes and FULL-bit ownership. The existing 10-case snapshot lifetime suite passed, including 0/1/4/12 recipients, retained-buffer mutation, bounded reentrant batches, subsequent contacts/events, and active peer failures.
- On teardown, pending snapshot batches are cleared and captured recipients lose their connection ownership. The new final-snapshot/event tests additionally confirm a later healthy recipient does not receive the retired batch's event and receives only snapshots dispatched before teardown.
- Two new safety cases explicitly stop the server while a previously scheduled grid deadline or results deadline still exists. Advancing through both 60,000 ms deadlines cannot restart the world, mutate saved record/results, emit another phase transition, or schedule further work. These safety cases were added after the initial pre-fix demonstration; they validate existing terminal callback guards and did not require another production fix.
- Live discrete shifts and invalid-client-sample behavior were reviewed and the existing 18-case shift suite passed. No exhaustive quantization sweep was repeated.
- A new hand-authored archived journal combines tag 0, tag 4, persistent positive/negative shifts, rear-brake changes, and AI takeover/handback. Its replay matches an independent ordinary `Simulation` driven with the old persistent control semantics, re-encodes to the original bytes, and passes record verification. This case passed before the fix as well as afterward. New tag 5 behavior and malformed tag rejection remain covered by the existing shift suite; older readers' rejection of unknown tag 5 was not changed.
- Existing final-boundary record composition cases pass with failures at tick 54 and exactly the final tick 60, including throwing closes. Current-boundary suffix trimming and rejection of future/unordered journal corruption remain unchanged.

## Reproduction and validation

All test runs held the root's exclusive COMPUTE lease. Node hooks that generate assets were not invoked. The lease was explicitly released after final focused testing and lint.

### Before production edits

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/engine-network-adversarial.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0 > /tmp/engine-c71f32882729/w08a-before.txt 2>&1
```

Result: **6 failed, 1 passed** in the then-seven-case file, exit 1, 4.88 s. Two failures reported an unexpected `[60000]` terminal schedule, three reported record publication after teardown, and one reported the null-connection TypeError. The archived journal compatibility case passed. Raw evidence: `/tmp/engine-c71f32882729/w08a-before.txt`.

### Relevant network gate after production fixes

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/engine-network-adversarial.test.ts tests/engine-network-composition.test.ts tests/engine-network-integration.test.ts tests/engine-network-shift.test.ts tests/engine-server-snapshot-lifetime.test.ts tests/net-lifecycle.test.ts tests/net-resilience.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0 > /tmp/engine-c71f32882729/w08a-after.txt 2>&1
```

Result: **73 passed across 7 files**, exit 0, 33.30 s, zero retries. Raw evidence: `/tmp/engine-c71f32882729/w08a-after.txt`.

### Final adversarial file including stale-deadline safety cases

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/engine-network-adversarial.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0 > /tmp/engine-c71f32882729/w08a-focused-after.txt 2>&1
```

Result: **9 passed**, exit 0, 5.32 s. Raw evidence: `/tmp/engine-c71f32882729/w08a-focused-after.txt`. Combined with the preceding seven-file run, this is **75 distinct passing tests across 7 files**; the seven original new cases overlap between runs.

### Formatting and static checks

```sh
node node_modules/prettier/bin/prettier.cjs --write tests/engine-network-adversarial.test.ts
NODE_OPTIONS=--max-old-space-size=512 node node_modules/eslint/bin/eslint.js src/net/server.ts tests/engine-network-adversarial.test.ts > /tmp/engine-c71f32882729/w08a-lint.txt 2>&1
git diff --check -- src/net/server.ts tests/engine-network-adversarial.test.ts
```

All exited 0. Scoped ESLint produced no output. Production edits were complete before the 73-test gate; only the two additional safety cases and test formatting were added afterward.

## Limits

This is an adversarial engine correctness review, not a timing or hardware-performance measurement. No browser/GPU claim, heap benchmark, exhaustive quantization rerun, full 895-file suite, full-project TypeScript compile, or production build was performed by this worker. Root's later integrated compiler/build and publication gates remain appropriate. The original checkpoint's code was used for the pre-fix runtime proof; a separate whole-repository replay of task baseline `1c609b` was not performed.
