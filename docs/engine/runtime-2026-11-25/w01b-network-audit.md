# W01B — remaining network engine work

Baseline: `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`. Read prior advancement network audit, change guide and review before inspecting current source. Presentation-clock discipline, shared-car serialization, input capacity, bounded client history and metric windows are already implemented; they are not new findings. No production edits.

## 1. Eliminate the full pending-input scan on every server physics tick

**Priority: P2 performance; strongest next implementation scope.** `src/net/input.ts`, `ServerInputQueue.take`, sweeps every key of `pending` to delete slots at or before the requested tick. `RaceServer.tick` calls it sequentially for each player at 120 Hz. Normal progress removes one slot, but scans the entire accepted lead window every time.

**Executed witness:** Accept 31 consecutive eight-tick commands covering ticks 0–247 at server tick zero; each first tick is at most the valid 240-tick lead. Wrap that instance's Map key iterator to count visited keys, then call `take(0)` through `take(247)`. Current implementation visits **30,876 keys** to deliver **248 slots**, including **31 first-command edges**, and ends at depth zero. This is a precise operation count, not a frame-rate or heap measurement.

**Safe implementation:** Maintain an expiry cursor or a bounded tick-indexed structure. The live sequential path should expire only the consumed tick. Preserve first-writer-wins behavior for overlapping commands, exact ACK-gap advancement, partial-late commands, skipped/backward public `take` calls, and accepting older commands after a cursor advance. Do not substitute Map insertion order for tick order: packets can arrive reordered. Keep the wire format unchanged.

**Verification:** Compare outputs, queue depths, ACKs, slack and all counters against the existing algorithm over ordinary, reordered, duplicated, partially late, large-jump and near-wire-limit streams; add one count-based regression and a paired actual queue benchmark. Avoid claiming physical networking or full-game FPS gains: RaceServer/RaceClient are currently consumed by `src/net/slice.ts` and harnesses.

## 2. Server shutdown retains live join-deadline callbacks and transport handlers

**Priority: P2 lifecycle/retention.** `RaceServer.accept` installs two closures capturing the server and schedules `loop.after(joinMs, ...)` without retaining its handle. `close`, `lost`, replacement and `teardown` never detach the owned transport callbacks. Teardown cancels only the recurring sweep/tick timers. The grid countdown and result linger deadlines likewise have no owned cancellation handle.

**Executed witness:** Create the existing `onlineFixture`, create a PERFECT_LINK pair, call `server.accept(pair.server)`, then immediately `server.teardown()` and `loop.runUntil(0)` to deliver the graceful close. The loop still has **one live callback** (the default five-second join deadline), plus a cancelled sweep heap entry; both `pair.server.onMessage` and `onClose` remain non-null. The message/close closures can keep the complete server/world reachable for as long as a platform retains a closed transport. Existing lifecycle tests drain ten seconds before checking `pending === 0`, so they do not establish immediate ownership release.

**Safe implementation:** Store and revoke each connection's join deadline at successful join, close/loss and terminal teardown; own/cancel grid/results deadlines too. Keep callback identities and detach only handlers still owned by that exact connection, before invoking external close callbacks. Preserve graceful delivery and replacement ownership. Do not change `EventLoop.pending` semantics just to make a test pass: cancelled heap entries intentionally remain, but their `fn` must be null.

**Verification:** Inspect live callback ownership immediately after teardown, not only after deadline expiry; exercise a joined connection, silent connection, countdown cancellation, results cancellation, rejoin replacement, close errors and a new handler installed during cleanup. Keep the prior network lifetime/reentrant suites passing.

## Additional narrow optimization candidate

`encodeInput`, `encodePreparedSnapshot` and ordinary `encodeSnapshot` construct a temporary writer backing allocation and `ByteWriter.finish()` always returns a copied slice. Input and prepared snapshot builders already know their exact final byte lengths. A new explicitly consuming finalization path could transfer exclusive ownership of a full backing buffer instead of allocating/copying again. Ordinary snapshots would need exact capacity derived from FULL flags. This is **a proposal requiring a byte-equivalence, retained-packet ownership and paired timing experiment**, not an established speedup; keep generic `finish()` copy semantics for reusable writers. Its scope is separate from queue expiry and server lifetime.

## Audit execution

Two cheap Node TypeScript probes used actual production queue/server/transport and the existing online fixture; no bulk suites, dependency installation, source modifications, git mutations or authored-content changes. The queue and immediate-teardown outputs are stated above. All protected rendering, animation, model and environment files remained untouched.
