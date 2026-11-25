# Ghost first-passage timing — wave 3, worker B

Assignment 14 of the 60-assignment engine advancement. Implements finding 1 in
`audit-storage.md`.

## Outcome

`GhostPlayer.timeAt()` and consequently `delta()` now select the first recorded
forward crossing when a valid ghost contains stops or reversals. The real
`LapTracker` + `GhostRecorder` regression produces a valid 3,000 m lap with
3,021 samples and ten decreasing-distance pairs after a 10 m reversal. At
1,495 m the result is **49.833334 s**, matching the slow first-crossing oracle;
the audited original query returned **50.499999 s**.

Only these three files are owned by this assignment:

- `src/core/ghost-lap.ts` — query index and compatibility path.
- `tests/engine-ghost-first-passage.test.ts` — 14 focused regression cases.
- `docs/engine/advancement-2026-11-25/w03b-ghost-first-passage.md` — this report.

## Algorithm and compatibility

The constructor checks whether sample distance is strictly increasing. Ordinary
strictly increasing laps retain the original binary search and interpolation
arithmetic exactly, with no retained distance index. This includes the existing
right-hand segment choice at interior knots, endpoint clamping, and the `1e-6`
denominator floor for very small distance intervals.

A stop or reversal causes construction of a prefix-maximum distance array.
Lower-bound search identifies the original segment ending at the first crossing.
Interpolation still uses that segment's two adjacent original samples and the
existing arithmetic. At repeated stations the search chooses the first ending
segment. Queries before the first station return the first time; queries above
the maximum recorded station return the final time. The last station itself uses
its first crossing, including when that station appears more than once.

Keeping adjacent endpoints is necessary after regained progress. For example,
the tested recording reaches 10 m at 5 s, pauses and reverses, then travels from
8 m at 10 s to 14 m at 11 s. Its 12 m crossing is 10.666667 s. Joining only the
record-high samples would incorrectly interpolate an 8 s crossing.

Construction is **O(n)**: one scan for an ordinary lap, at most two scans for an
indexed lap. Each query is **O(log n)** and performs no allocation. The index is
one `Float32` per accepted sample: the existing **18,002-sample** cap bounds it to
**72,008 payload bytes** per indexed player, excluding the fixed typed-array
object overhead. Strictly increasing players retain no index payload.

Recording, lap metadata, persisted version/key/format, sample order and sample
bytes are unchanged. Pose lookup still uses the original time-ordered samples
and existing interpolation, so visible stops and reversals remain in playback.

## Callsite and input review

Both production constructors are in `TimeTrialRecords`. `prepare()` validates a
loaded ghost with `validateGhost()` before constructing a player; `observe()`
constructs one only from the recorder's validated completed-lap result.
`validateGhost()` already requires the shared sample bounds, finite sample
fields, and strictly increasing sample times. It deliberately does not require
increasing distance, which is why valid reversals must be handled by playback.

The constructor retains that existing validated-input contract. The cached
index assumes the lap's samples remain unchanged during playback; no production
callsite mutates them. This precondition is documented on `GhostPlayer`.

`TimeTrialRecords.observe()` feeds `delta()` directly to time-trial HUD state.
`ghostAt()` uses `poseAt()` independently. Nonfinite recorded times/distances
continue to be rejected by validation. Existing query conventions are retained:
`timeAt(NaN)` and `timeAt(-Infinity)` return the first time, positive infinity
returns the final time, and nonfinite elapsed-time arithmetic in `delta()` is
unchanged. `poseAt()` still rejects nonfinite time queries. These calls do not
mutate or poison the index.

## Verification

Direct command, bypassing npm hooks:

```sh
node node_modules/vitest/vitest.mjs run tests/engine-ghost-first-passage.test.ts tests/ghost-lap.test.ts tests/engine-ghost-bounds.test.ts --maxWorkers=1 --no-file-parallelism
```

**3 test files passed; 71 tests passed; 0 failed.** Breakdown: 14 new
first-passage tests, 53 existing recording/validation-bound tests, and 4 existing
production-simulation ghost tests. The run completed in 10.02 s.

The new suite compares 498 queries across the real recorded lap with a slow
ascending-segment oracle, including dense queries around the reversal. Additional
cases cover two reversals, stationary samples, repeated starts/finishes, the
segment after recovered progress, exact knots, strictly increasing tiny
intervals, unchanged pose outputs and persisted bytes, maximum accepted sample
count, and nonfinite recorded/query inputs.

Scoped ESLint on the two TypeScript files passed. `git diff --check` for the
owned source/test paths passed. No broad suite rerun or build was performed;
the coordinator owns full-build validation. No native-browser validation was
attempted under the existing local-browser restriction.

No models, characters, environments, assets, authored content or tuning changed.
No npm hooks, git mutations or publication actions were performed. Source
ownership is released to the coordinator after this report.
