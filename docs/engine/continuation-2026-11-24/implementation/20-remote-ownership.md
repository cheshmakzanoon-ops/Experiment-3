# Agent 20 — remote interpolation state ownership

Date: 2026-11-24. Wave 4. Engine network integration boundary only.

## Outcome

`RemoteCarTrack` now owns the scalar values it retains. Reusing or mutating a producer's `CarNetState` no longer rewrites earlier interpolation or extrapolation. `latest()` returns a detached complete state, so a HUD or other consumer cannot mutate retained history through that accessor.

This repairs a confirmed public integration boundary. The repository's current ordinary network consumer did not write these exposed objects; the change is not presented as evidence of spontaneous wire-path corruption or a gameplay frame-rate improvement.

## Scope and implementation

Only these repository paths were edited:

- `src/net/interpolation.ts`
- `tests/remote-state-ownership.test.ts`

One explicit scalar copy is made after a duplicate tick is rejected and before either parallel history array is mutated. All 26 `CarNetState` fields are copied exactly, including accessor-backed structural implementations. Unrelated caller metadata is not retained. If a field read throws, the insertion leaves the previous history intact. Duplicate pushes do not read or copy the supplied object.

Each `latest()` read returns a new scalar copy, or `undefined` for an empty history. Existing `sample()` results were already detached and retain that behavior. No copy was added to the sample hot path. The cost is one owned object for each accepted snapshot and one object per `latest()` call.

The 240-tick pruning rule, retention of a sparse bracketing pair, acceptance of subsequently pruned stale insertions, duplicate semantics, insertion order, extrapolation caps and newest selection are unchanged. Sampling and quaternion interpolation source are byte-for-byte identical to the original baseline. `ServerClock`, `JitterBuffer`, physics, models, characters, environments, authored content, and tuning were not edited.

## Verification

**30/30 tests passed across two suites.**

| Suite | Passed |
|---|---:|
| `remote-state-ownership.test.ts` | 22 |
| `net-prediction.test.ts` | 8 |

New cases cover both retained endpoints; interpolation, extrapolation and held samples; reused input objects; every scalar field on `latest()`; exact negative zero, NaN and infinity copying without adding validation; inherited accessors read exactly once; exclusion of unrelated metadata; duplicate rejection without property reads; late accessor failure on empty/populated history; out-of-order insertion; the strict pruning boundary and sparse pair; and custom extrapolation limits.

The existing prediction suite includes the actual four-client, ten-second online slice with 100 ms RTT and 2% loss. Its existing prediction, interpolation and delivery thresholds passed.

Commands:

```sh
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/vitest run tests/remote-state-ownership.test.ts tests/net-prediction.test.ts --pool=threads --maxWorkers=1
NODE_OPTIONS=--max-old-space-size=512 flock /engine-work-4e0075ccccb3/test.lock node_modules/.bin/eslint src/net/interpolation.ts tests/remote-state-ownership.test.ts
git diff --check -- src/net/interpolation.ts tests/remote-state-ownership.test.ts
```

Scoped ESLint, Prettier and whitespace checks passed. No full-project compiler, build, browser, asset generator, commits, pushes or ref writes were run by this agent.

## Independent baseline comparison

A direct Node comparison imported the original module from the read-only `5edead7a44c8ccb5a187b22b750ce2bda7715128` reference and the candidate as separate modules. A deterministic xorshift fixture exercised 32 tracks, 4,096 pushes, 32,768 exact sample comparisons and 4,096 complete latest-state comparisons, with out-of-order delivery, duplicate ticks, pruning and different extrapolation caps. Candidate producer values, latest-state copies and sampled poses were deliberately overwritten after use; the original reference received independent unchanged values.

All acceptance flags, newest ticks, complete scalar states and sampled results matched exactly using strict deep equality. The complete sampling/quaternion-interpolation source region also matched byte-for-byte.

- Runtime: Node v24.22.3.
- Combined trace SHA-256: `bb61d3ff3da9bc9a8a04d0befc529486fe1b2301a3181b30c8685edd2555bdd1`.
- Baseline interpolation source SHA-256: `39792721aad62e7bc6065691df46652a4aadfbef7f06415680a018b51d140c8c`.
- Candidate interpolation source SHA-256: `9395a43121736503fab7911ef56adeabfa5a126f33904fe5264c724047012bfd`.

The comparison script and machine-readable evidence are retained beside this report as `20-remote-ownership-comparison.mjs` and `20-remote-ownership-comparison.json`. The comparison measures correctness under deterministic integration use; it is not a latency or GPU benchmark.

Portable replay command (run from the candidate repository):

```sh
node --no-warnings --experimental-transform-types docs/engine/continuation-2026-11-24/implementation/20-remote-ownership-comparison.mjs /path/to/baseline /path/to/candidate /path/to/output.json
```
