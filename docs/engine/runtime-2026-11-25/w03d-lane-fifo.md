# W03D — bounded lane-cache key FIFO

Assignment 16/60, wave 3. Read `SESSION.md`, W01E physics audit and the
relevant prior advancement lane/cache evidence. Changes are limited to
`src/simulation/track-lane-index.ts`, the new
`tests/engine-lane-fifo-eviction.test.ts`, and this report.

## Change and compatibility

Positive integral capacities now keep resident keys in a circular FIFO.
The array starts empty, grows only on cache insertion until the existing
capacity, and then replaces the oldest occupied slot. Hits change neither
the Map insertion order nor the FIFO cursor. Eviction uses that key directly
instead of restarting a Map iterator. Building still happens before eviction,
so a failed build leaves the resident entries and cursor intact.

The original iterator branch remains for Infinity, NaN, zero, negative and
fractional capacities. No validation or new error is introduced. Tests retain
the existing one-entry behavior for zero/negative capacities, ceiling-sized
retention for positive fractions, and unbounded Infinity/NaN behavior. A
`2 ** 40` capacity constructs successfully and holds just three key references
after three distinct cells; it causes no eager capacity-sized allocation.

Candidate construction, witness selection, height fallback and all geometry
arithmetic are unchanged. No Track, tuning, content, rendering or off-road
source was edited.

## Exact verification and structural counts

The new 16-test file compares the actual index and `Track.nearest` against
the retained original iterator branch. Its test-only reference constructs an
unbounded index, then sets the original eviction threshold; both sides execute
the actual candidate builder and nearest implementation without copied
geometry. Tests cover capacities 1/2/2,048, repeated full cycles, same-cell
hits, eviction/revisit with a changed candidate order, signed 4 m/32 m cell
boundaries, banked Speedbowl and stacked overpass queries, candidate contents,
witnesses, original-array fallback identity, edge capacities, lazy large
capacity, and recovery after a candidate-build exception.

The production-capacity case performs two passes over 4,096 distinct actual
Aurel hash cells: **8,192 paired nearest queries / 106,496 exact scalar
comparisons** (lateral plus all twelve TrackPoint fields), with matching
candidate records and fallback behavior. Each primary query is a miss;
additional candidate reads are hits. There are **6,144 evictions**: the
reference calls `Map.keys()` 6,144 times and the ring path calls it **zero**
times. Map order and FIFO order match at fill, wrap and cycle boundaries.
Both retain exactly **2,048 cells**. These are structural counts, not timing
or whole-game performance measurements.

Executed directly, with the required memory/worker limits:

```sh
NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run \
  tests/engine-lane-fifo-eviction.test.ts \
  tests/engine-paved-lane-index.test.ts \
  tests/road-contact-ownership.test.ts \
  --pool=threads --maxWorkers=1 --minWorkers=1
```

Result: **40/40 tests passed in three files**, 8.68 s total. This includes
the existing actual coarse-query and road-contact ownership checks.

## Memory tradeoff and limits

The additional storage is one lazily grown array with at most `capacity`
resident-key references, one cursor, and the array reference. At the paved
cap this is **at most 2,048 additional key references**; evicted keys are
overwritten, so no history accumulates. The array reuses the key values
already inserted into the Map, without duplicating candidate arrays or
geometry. Infinity/edge-capacity instances allocate no FIFO array. This is
a retention bound, not measured heap bytes; array/object overhead and engine
backing-store allocation are not measured.

Scoped ESLint passed for the production file and new test. Prettier passed
for those files and this report; `git diff --check` passed for the assigned
paths. No full compiler/build, broad test run, installation, Git write or
timing experiment was performed. Independent full-query and Simulation
timing remains for the coordinated measurement work.
