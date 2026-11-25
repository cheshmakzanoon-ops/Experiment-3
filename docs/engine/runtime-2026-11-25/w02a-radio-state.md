# W02A — Compact owned radio state

Assignment 7/60. Baseline: `dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`.

## Change

`src/core/radio.ts` now owns one reusable object containing the **eight**
previous values actually read: car count, safety-car phase, local flag,
cumulative penalty, warnings, pit state, completed laps and fuel. A validity
marker preserves first-observation and reset behavior. Each observation saves
the old scalars into locals and captures the new values before arbitration;
it retains no supplied array or buffer and makes no packed-frame copy.

Caption text, keys, speakers, urgencies, relevance windows, hold times,
posting order, engineer muting and car-count transition behavior are unchanged.
The production caller `GameApp.accept` can continue recycling/transferring its
snapshot buffers independently.

## Cooldown policy retained

Sent-key history still lasts until explicit `reset()`. Elapsed forward time
does not establish that an entry is safe to remove: a key sent at time 100
still suppresses the same key after update at time 200 followed by a rewind
to time 5. Arbitrary backward time and future reused keys make exact eviction
impossible without retaining equivalent history or adding a caller timeline
contract. The coordinator agreed to preserve this behavior rather than change
replay semantics. Reset, rewind, and the exact cooldown boundary have focused
regressions. **Cooldown key retention remains session-length dependent.**

## Validation

Executed on Node `v24.22.3`:

```sh
./node_modules/.bin/vitest run tests/radio.test.ts tests/engine-radio-compact-state.test.ts
```

**44 tests passed in two files** (40 new, four existing). The new suite checks
all 11 caption variants with fresh, in-place reused and actually transferred
buffers; simultaneous offers, equal-priority display order, hold/expiry;
first observations and changed car counts; overwritten/detached old snapshots;
engineer muting; explicit reset and backward-time cooldown behavior; and the
600-observation no-slice regression.

The cheap copy probe imported the exact production class before and after
editing. It intercepted `Float32Array.prototype.slice` only while observing
one reused 24-car frame 600 times (`TIME = i / 60`, `LENGTH = 3000`, player
`FUEL = 50`, five-lap race), counted returned array bytes, and restored the
prototype in `finally`.

| Measurement                 |     Before |  After |
| --------------------------- | ---------: | -----: |
| Observations                |        600 |    600 |
| Cars per frame              |         24 |     24 |
| Packed frame bytes          |     31,872 | 31,872 |
| Float32Array slice calls    |        600 |      0 |
| Bytes copied by those calls | 19,123,200 |      0 |

These are structural copy counts, not elapsed-time, heap, GC or whole-game FPS
measurements. The replacement owns eight scalar values and a validity marker;
no JavaScript object-overhead byte estimate is asserted.

`prettier --write` was restricted to the three assigned files; `--check` and
scoped `git diff --check` passed. Compiler/integration gates belong to the coordinator;
no full suite, installation, git mutation or protected-file edit was performed.

## Files

- `src/core/radio.ts`
- `tests/engine-radio-compact-state.test.ts`
- `docs/engine/runtime-2026-11-25/w02a-radio-state.md`
