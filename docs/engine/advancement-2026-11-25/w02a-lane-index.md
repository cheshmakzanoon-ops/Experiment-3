# W02A — bounded paved lane candidates

Implements scope 1 of `audit-physics.md`. No authored circuit, geometry,
material, environment, vehicle, character or physics tuning changed.

## Change and exactness

`Track` now creates the existing `TrackLaneIndex(points, 2048)` for every
paved circuit, extending the former GP-only selection. Motocross/supercross
retain their existing index configuration; rallycross/rally-stage retain
their original null index. No index algorithm or `nearest()` arithmetic
changed. Four-metre cells still align with the 32 m coarse hash; filtering
retains original candidate order, equality and the same conservative witness.
Unproved vertical layers still return the original bucket, including banked
road handling, and queries outside the hash still scan all segments.

The cache is per Track and lazily populated, capped at 2,048 cells with the
existing oldest-insertion eviction. Keys depend only on static sampled points
and coarse membership. There is no supported geometry mutation API in Track;
weather, traffic and surface evolution do not change these inputs. No cache
of query results or weather was added.

## Focused verification

New `tests/engine-paved-lane-index.test.ts`: 15 tests. The reference toggles
only the instance's index to null and executes the actual original
`Track.nearest()` path. It checks exact lateral and all TrackPoint fields on
Aurel, Vellamar, Speedbowl, Dockyard, Dockyard Reverse and Poggio Alto;
positive/negative 4 m and 32 m boundaries; lap seams; large offsets outside
the coarse hash; absent/nonfinite heights; layered overpass and no-eligible-
layer cases; high banking; equal-distance candidate ordering; real-instance
2,048-cell eviction and exact rebuild on revisit; and unchanged off-road
constructor selection.

Executed directly, without npm hooks:

```sh
node node_modules/vitest/vitest.mjs run tests/engine-paved-lane-index.test.ts tests/motocross-lane-index.test.ts tests/road-contact-ownership.test.ts --maxWorkers=1
```

Result: **26/26 tests passed**, three files, 6.94 s total. Existing checks cover
MX/SX queries, GP layer pruning and actual stacked-road tire ownership.
Also ran the four relevant existing overpass/catalogue layer and bank tests:

```sh
node node_modules/vitest/vitest.mjs run tests/route-overpass.test.ts tests/circuit-catalogue.test.ts --maxWorkers=1 --testNamePattern='two roads really|resolves the station|stacks crossing roads|banks the oval'
```

Result: **4/4 selected tests passed** (14 intentionally filtered out), 3.34 s.
The new test file passes the direct Prettier formatting check.

## Structural probe

Re-ran the audit's unchanged every-third-point / six-offset / three-height
query workload through the selected production index. Lateral and every
TrackPoint field were compared with `Object.is`: **36,936 exact matches**.

| Circuit | Queries | Original candidates | Indexed candidates | Fewer candidates | Cell builds | Cache hits | Resident segment slots |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Aurel | 9,234 | 500,571 | 248,337 | 50.3893% | 2,534 | 6,700 | 29,887 |
| Vellamar | 9,234 | 411,774 | 205,512 | 50.0911% | 2,534 | 6,700 | 25,324 |
| Speedbowl | 9,234 | 354,996 | 209,617 | 40.9523% | 2,565 | 6,669 | 22,420 |
| Figure-eight overpass | 9,234 | 677,358 | 331,520 | 51.0569% | 2,412 | 6,822 | 37,832 |

Every instance peaked and ended at 2,048 cells. Full-bucket layer fallbacks
were 3,078 / 3,078 / 4,239 / 3,099 respectively. Cell builds and hits count
the indexed nearest query, excluding the extra warm candidate-count read.
Resident segment slots count retained numeric array elements, not runtime
heap bytes; Map, key and array overhead was not measured. The cap bounds
resident records and their candidate arrays by the fixed circuit buckets.

This is an operation/count check, not a timing or whole-game speed claim.
Cold/warm timing, worker CPU/heap measurement and full 12-entrant packed-frame
plus Float64-state equivalence remain for the coordinated measurement wave.
