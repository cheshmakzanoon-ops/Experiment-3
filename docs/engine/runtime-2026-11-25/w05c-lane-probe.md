# W05C — actual Git baseline lane-cache probe

Assignment 27/60, wave 5. The deliverable is the reproducible
`scripts/engine-runtime-probes/lane-probe.mjs` and this report. No production
module is changed by this assignment.

## Status and scope

**Hosted CI execution is pending.** This environment has no working local
checkout/runtime, so the probe, formatter, linter, and repository tests have
not been run here. The counts below are assertions encoded in the probe,
not newly observed execution results. The earlier W03D report records a
different executed test run; its pass result is not evidence that this new
probe has passed.

The comparison replaces only
`src/simulation/track-lane-index.ts` with its actual source from Git commit
`dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc`. The shared `support.mjs`
helper obtains that source with `git show`, builds the two variants in memory
with esbuild, and reports source SHA-256 provenance. There is no copied
candidate builder, reconstructed reference class, or mutation that makes the
candidate pretend to be the baseline. The probe requires distinct baseline
and candidate lane-source hashes.

Both variants use the same current-tree `Track.nearest`, track geometry,
circuit definitions, and other dependencies. This isolates the lane-cache
change; it is not a comparison against the entire historical game. Each
variant constructs its own real Track and receives a fresh, empty index from
its respective compiled module. The test-only assignment to `track.laneIndex`
sets the cache starting state and, for the boundary traces, its capacity.

Sources inspected at candidate commit
`b3b8ec09183734287b71406f8894d07c91eb48c9`:

| Source | Git blob SHA |
| --- | --- |
| Original baseline lane index | `dd6ff4c5a0a8dc8de9c51a45fccd8a2f1910055b` |
| Candidate lane index | `3a8d7add3aa19cd77deed35fb033699f6d0eee63` |
| Current Track | `5bd9acb7d6d2076ec9005373d2dbe35e4f7d486e` |
| W03D lane FIFO tests | `d67ffd015ba708e2396154a92016b386f81555e3` |
| W03D report | `22a5172a5d4f9063b87acb38bd4fd5efc13b4365` |

The machine report includes the sources actually used at execution, so these
review-time Git blob IDs do not substitute for the run's provenance.

## Reproduce

Use the repository's existing dependencies and supported Node version. Fetch
the pinned baseline object before running if the checkout is shallow:

~~~sh
git fetch --no-tags origin dda5b3e410477a9c89474cdbdcd1d9c87c24b8bc
NODE_OPTIONS=--max-old-space-size=512 node scripts/engine-runtime-probes/lane-probe.mjs
~~~

Run from the repository root after integrating the shared `support.mjs`.
The script emits one JSON report only after every assertion succeeds.
A source-loading error, output mismatch, changed FIFO policy, or count/bound
failure throws and exits unsuccessfully. The report includes source
provenance, per-trace counts, and matching SHA-256 digests of the exact numeric
output bytes. It contains no timing measurement.

## Primary production-capacity trace

The production trace reuses W03D's deterministic input recipe: take 4,096
distinct four-metre cell centres from the actual Aurel coarse-hash insertion
order, then traverse them twice with a 2,048-cell cache. Every primary query
must miss in both variants. Heights rotate through omitted, `0.5`, `9.5`,
`100`, `NaN`, `Infinity`, and `-Infinity`.

For every paired nearest query, the probe compares the lateral return value
and every one of the twelve TrackPoint fields with strict scalar equality.
It also compares the candidate arrays in their original order, the cached
segment/witness records, and whether each result is the exact original coarse
array used for height fallback. Each direct candidate read occurs after
`Track.nearest` has populated that cell and must retain the same cached
record object.

Three additional nearest queries hit the oldest resident cell just before
the next insertion at a full-cache boundary. The probe checks that both
Map orders, the candidate FIFO array, the cursor, and both record identities
remain unchanged; the following primary miss must still evict that oldest
key. Full cache-record and FIFO-order checks run at fill, wrap, cycle, and
final boundaries. Ring length and cache capacity are checked after every
paired query.

The assertions expected from hosted execution are:

| Primary-trace measure | Actual Git baseline | Candidate |
| --- | ---: | ---: |
| Primary nearest calls per variant | 8,192 | 8,192 |
| Explicit oldest-cell nearest hits | 3 | 3 |
| Primary cache misses | 8,192 | 8,192 |
| Successful evictions | 6,144 | 6,144 |
| Fresh `Map.keys()` iterators | 6,144 | 0 |
| Final resident cells | 2,048 | 2,048 |
| Maximum additional FIFO key references | No FIFO array | 2,048 |

The primary trace therefore encodes 106,496 exact scalar comparisons, plus
39 comparisons for the three explicit hits. The extra nearest hits and
candidate-array reads add no eviction. Keeping their counts separate
preserves the original 8,192-primary-query / 6,144-eviction comparison.

The probe instruments only each index's own `cells.keys` and `cells.delete`
methods, after construction and before any measured query. Successful
deletions establish the eviction count independently of iterator creation.
Inspection uses Map entries, never `Map.keys()`, so verification does not
inflate that count. Wrappers are removed in `finally`. No global Map
prototype is modified.

## Signed coordinates, height candidates, and banking

Two further traces use actual overpass and Speedbowl tracks with capacity 2
to force frequent eviction while exercising:

- Coordinates immediately below, at, and above negative four-metre and
  negative 32-metre boundaries, and around zero.
- Omitted heights, finite heights around the route-layer gap, upper/lower
  deck heights, high outliers, and nonfinite heights.
- Three lateral offsets on an actual banked Speedbowl point, using its own
  bank and elevation to form each height query.
- Both decks at the overpass crossing; the returned elevations must differ
  by more than the route-layer gap.

Each venue has 425 paired nearest queries. Queries without a coarse hash cell
are counted separately and still compare the actual full nearest scan.
Negative-coordinate queries that do exercise the lane index are explicitly
counted, and the overpass trace requires at least one. Candidate contents,
witnesses, fallback identity, FIFO order, capacity, successful evictions, and
iterator counts receive the same checks as the main trace.

Across all three traces, the encoded totals are **9,045 paired nearest
queries and 117,585 exact scalar comparisons**. These totals are assertions,
not a claim of local execution. Output digests use query order and Float64LE
bytes for lateral followed by the TrackPoint field order recorded in JSON.

## Memory tradeoff and interpretation

The candidate adds one lazily grown array containing at most 2,048
resident-key references at the paved-track capacity, plus its cursor and
array reference. The probe checks the observed ring length and verifies that
rotating it from the cursor exactly reproduces the resident Map order.
Evicted slots are overwritten; the array does not retain an accumulating
history of removed keys or duplicate candidate geometry.

This is a bound on retained key references, not a heap-byte measurement.
The probe's own tracks, counters, snapshots, and digest buffers are
verification overhead. Array backing-store overhead and string storage are
not measured. The script is specifically for positive integral capacities;
W03D's existing tests remain responsible for the retained unusual-capacity
behavior.

A successful hosted run would establish exact output preservation for these
traces and eliminate 6,144 fresh key iterators while preserving 6,144
evictions. It would not establish lower wall-clock time, less GC time, higher
FPS, or whole-game performance. No such gain is claimed here.

## Pending validation

The coordinator must run the probe after integrating `support.mjs` and
fetching the baseline commit, retain its JSON/provenance as hosted evidence,
and apply the repository's scoped formatting/lint checks. This assignment
creates only the two reviewable probe/report files. It performs no
production edit, commit, ref update, or publication.
