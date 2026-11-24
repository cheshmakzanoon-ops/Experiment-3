# Agent 13 — BVH construction

## Implementation

Replaced recursive ID-range slice/sort/copy-back with bounded in-place median selection. Centroid/ID ordering, splits, midpoint, leaf size and hierarchy remain exact. Leaves restore parental ordering; root leaves retain input order. Ordered ranges are reused by same-axis descendants. Heapsort bounds adversarial partitions. Query algorithms, geometry, contact ownership, normals and tolerances are unchanged.

## Verification

**35/35 focused Vitest tests passed** across bvh-build-work, bvh-traversal and tire-footprint. All 16 new cases passed native assertions. Scoped ESLint and Prettier passed.

Coverage includes 90 small partition cases, three seeded large/uneven trees, overflowed centroids, signed zero, subnormals, duplicate/degenerate triangles, fallback, coincident winners and tolerated-edge hits. Exact comparisons cover 2,048 general rays, 6,144 vertical queries and 6,144 footprint queries, including normals, ownership, reused columns and candidate counts. Independent binary hashes match every node field and leaf ID for all benchmark cases through 229,376 triangles.

## Measured construction cost

Node 24.22.3; isolated 128 MiB child heaps; three independent cold samples and seven warm samples with pre-sample GC. Values are baseline → revised medians, milliseconds.

| Synthetic fixture | Cold constructor | Warm constructor | Process startup |
|---|---:|---:|---:|
| Random 8,192 | 44.36 → 24.56 | 24.56 → 6.24 | 283.56 → 225.60 |
| Random 65,537 | 282.28 → 105.77 | 257.93 → 85.87 | 482.62 → 296.73 |
| Ribbon 229,376 | 659.97 → 259.06 | 574.56 → 191.64 | 975.30 → 430.97 |
| Equal 8,192 | 22.16 → 19.03 | 11.75 → 4.25 | 208.92 → 197.46 |
| Organ-pipe 8,192 | 20.14 → 29.21 | 11.40 → 9.24 | 196.68 → 208.27 |

Ribbon cold ranges: 585–777 → 240–387 ms; warm ranges: 523–765 → 177–502 ms. Adversarial cold ranges: 18.49–22.41 → 26.37–30.44 ms: a measured regression despite lower warm median.

Random comparisons: 519,166 → 259,348; explicit temporary ID copies: 81,920 → 0; total measured ID assignments: 245,760 → 131,768. Ribbon temporary ranges: 32,767 → 0. Organ-pipe comparisons increase 89,089 → 395,718 through the bounded fallback.

Startup includes process/import/fixture/build. Full distributions, counts and hashes: 13-bvh-build-benchmark.json. These are synthetic construction measurements, not gameplay FPS. Root owns full-project compiler/build validation.
