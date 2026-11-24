# Agent 28 — actual-track contact construction benchmark

## Result

The optimized BVH constructor improves the first complete collision-mesh build on all three measured, unchanged tracks. Median full contact construction falls **64.60% on Aurel, 60.57% on Vellamar and 47.91% on Loirette Endurance**. Every generated vertex, normal and triangle index, every BVH node field and ordered triangle ID, and every recorded contact-query result and candidate count matches the baseline exactly.

This extends agent 13's synthetic-construction evidence to the actual `Track` → `TrackContactMesh` implementation. No production, track-definition, environment, vehicle, character, model, asset or tuning file was edited by this agent. The deliverable is a portable benchmark script and its measurement records.

## Compared sources and environment

- Baseline checkout commit: `5edead7a44c8ccb5a187b22b750ce2bda7715128`.
- Candidate checkout commit at measurement start: `19df29783d1b8b8b06eb71e9e7e5df6c0dbc0237`.
- Recorded at: `2026-11-24T18:25:35.070Z`.
- Node `v24.22.3`; Linux `6.18.57`, x64; AMD EPYC 9V74 80-Core Processor; 9 logical CPUs exposed; 10,451,427,328 bytes of host memory reported.
- The benchmark checks SHA-256 fingerprints of 24 geometry-related source files before and after measurement. **Only `src/simulation/bvh.ts` differs** between the compared checkouts. The other 23 files, including the real circuit catalogue, contact generation, Track and tire-footprint implementations, are unchanged. Neither checkout had changes to these measured source files when measurement started.
- Baseline BVH source SHA-256: `e91ff31584fc13f34046693363e52c94855350a214e7603ff1503fe4c0e9ed41`.
- Candidate BVH source SHA-256: `a34dfd0196d5cba88127cea9603728a149ab612aa06016edc0a541514ef96e4d`.
- Benchmark script SHA-256: `5c768c369855234b5d7f311e6630d4bc92b18973cd744814839ff8502dac2724`.

## Actual geometry and sampling

Each worker imports the real source graph, constructs a clear-weather, non-flat `Track` with its actual circuit definition, then constructs `TrackContactMesh` directly. The mesh uses the same row rule as `Track.cast`: 8,192 rows normally; catalogue tracks use `max(8192, ceil(track.length / 0.9))`. Thus the long circuit exercises its production adaptive resolution instead of being reduced to the small-track fixture size.

| Circuit | Measured length, m | Track points | Contact rows | Vertices | Triangles | BVH nodes |
|---|---:|---:|---:|---:|---:|---:|
| Aurel | 2,972.7274 | 1,537 | 8,192 | 122,895 | 229,376 | 65,535 |
| Vellamar | 3,997.2689 | 1,537 | 8,192 | 122,895 | 229,376 | 65,535 |
| Loirette Endurance | 13,626.0000 | 3,073 | 15,140 | 227,115 | 423,920 | 131,071 |

Loirette is the real catalogue endurance circuit with its existing public-road sections, chicanes, pit layout and elevation profile. Its geometry is generated in memory from unchanged definitions; the benchmark creates no graphical assets.

## Timing method

There are **18 fresh sequential workers**: three cold repetitions × two source versions × three tracks. Only one source graph resides in a worker. Checkout order alternates within each track's repetitions to reduce simple ordering bias. Workers use a 512 MiB V8 old-space limit. The complete benchmark ran under the shared `/engine-work-4e0075ccccb3/test.lock` so it did not overlap other cooperating heavy verification jobs.

The cold contact timer surrounds the first uninstrumented `new TrackContactMesh(track, rows)`. It includes vertex/normal/index generation, BVH construction and the small remaining contact-constructor setup. Module imports and the `Track` constructor have separate timers. Hashes and queries run after the measured contact constructor.

The final cold worker of each source version additionally releases the first mesh/tree and retains its vertex, normal and index arrays. It performs one untimed BVH rebuild and then three measured BVH-only rebuilds, with explicit GC before each rebuild. Hashing occurs after each timer and verifies that every rebuilt hierarchy remains identical to the cold result. The BVH-only measurement omits the ownership callback because construction never invokes it; all contact-query verification uses the original complete mesh and its real ownership callback.

### Full cold contact construction

Milliseconds; each triple is the complete three-sample distribution in measurement order.

| Circuit | Baseline samples | Candidate samples | Baseline median | Candidate median | Median reduction |
|---|---|---|---:|---:|---:|
| Aurel | 770.52, 798.40, 809.29 | 310.09, 272.73, 282.60 | 798.40 | 282.60 | 64.60% |
| Vellamar | 735.50, 711.24, 681.16 | 332.62, 266.77, 280.45 | 711.24 | 280.45 | 60.57% |
| Loirette Endurance | 1436.36, 1318.52, 1165.27 | 686.84, 522.49, 706.45 | 1318.52 | 686.84 | 47.91% |

The measured baseline and candidate cold ranges do not overlap on any of these tracks. No actual-track cold construction regression was observed in this sample.

### Warm BVH-only construction on the real arrays

Milliseconds; three measured samples after one untimed rebuild.

| Circuit | Baseline samples | Candidate samples | Baseline median | Candidate median | Median reduction |
|---|---|---|---:|---:|---:|
| Aurel | 720.10, 795.19, 969.07 | 200.08, 391.36, 246.19 | 795.19 | 246.19 | 69.04% |
| Vellamar | 810.75, 632.52, 728.12 | 231.71, 211.01, 239.24 | 728.12 | 231.71 | 68.18% |
| Loirette Endurance | 1052.51, 1057.59, 1035.97 | 400.19, 450.27, 517.19 | 1052.51 | 450.27 | 57.22% |

These are separate measurements, not a decomposition obtained by subtracting timings. They exclude explicit pre-sample GC and post-sample verification. Ordinary GC that happens during a constructor remains inside its timer.

### Imports, track initialization and process readiness

All values are medians in milliseconds, baseline → candidate. Import time includes the existing catalogue's module initialization and is measured independently of contact creation. “Contact ready” is the child's `performance.now()` immediately after cold contact creation, measured from the child performance time origin; it excludes later proof and warm samples.

| Circuit | Module import | Track constructor | Contact ready from child time origin |
|---|---:|---:|---:|
| Aurel | 902.15 → 596.21 | 39.24 → 40.77 | 1797.19 → 1008.08 |
| Vellamar | 557.63 → 652.16 | 49.88 → 48.44 | 1414.19 → 1069.90 |
| Loirette Endurance | 563.47 → 559.67 | 111.27 → 111.16 | 2114.15 → 1462.00 |

Import variation changes direction across tracks, and Vellamar's import median increased in this run. That variation is reported independently and is not attributed to the BVH construction change. The JSON contains all import, Track and process-readiness samples and ranges. It also contains full worker lifetimes, explicitly labelled as including proof and, on the final repetition, warm rebuilding; these are not startup-only timings.

## Exact preservation evidence

All six cold workers for each track produced identical:

- Vertex, normal and triangle-index byte hashes, including signed zero.
- Binary hashes of every node bound, child link, start and end field.
- Binary hashes of every ordered triangle ID, preserving leaf order and therefore existing tie traversal order.
- Tagged binary hashes of all recorded contact outputs and per-query candidate counts. The encoding preserves numeric signed zero, infinities, NaN and the presence/absence of optional fields, unlike plain JSON output comparisons.

Each track has 37 stations: 32 evenly spaced stations plus lap-seam and pit-specific positions. Every station uses 12 lateral positions covering the road centre, paint approach, both road boundaries, both kerbs, shoulders, the pit offset and positions beyond the contact ribbon. Each position runs seven query forms: vertical contact, identical cached vertical probe, height-only contact, direct oblique BVH ray, oblique contact wrapper, car-size finite tire footprint and narrow bike-size oblique footprint. This is **444 cases per query form, 3,108 top-level query calls per track and 9,324 per three-track checkout sample**. Across all 18 workers, **55,944 calls** were checked.

The proof includes direct-ray winning triangle IDs, distances, contact points, normals, all surface-sample fields, ray candidate counts, footprint candidate counts and footprint feature-test counts. Hashes compare each recorded sequence, so equal totals alone cannot hide a per-query difference.

Representative summed candidate counts below are identical in every baseline/candidate repetition. Each column covers 444 calls of that form; ray candidates used internally by tire queries are also included in each tire output hash.

| Circuit | Vertical ray candidates | Oblique BVH candidates | Car footprint candidates | Bike footprint candidates |
|---|---:|---:|---:|---:|
| Aurel | 2,332 | 9,996 | 13,412 | 12,551 |
| Vellamar | 2,289 | 9,121 | 11,676 | 11,648 |
| Loirette Endurance | 1,421 | 7,468 | 9,561 | 8,813 |

Every identical cached vertical probe reports zero new candidates on both source versions. Hits and intentional misses both appear in every query form. Full hashes, counts, hit/miss counts, minima and maxima are retained in `28-track-contact-build-benchmark.json`.

## Memory, limits and reproducibility

Observed maximum worker RSS, including module imports, geometry, proof and any warm rebuilds:

| Circuit | Baseline peak, MiB | Candidate peak, MiB |
|---|---:|---:|
| Aurel | 280.53 | 217.91 |
| Vellamar | 276.72 | 220.85 |
| Loirette Endurance | 331.31 | 240.75 |

These are process high-water marks, not exact allocation counts or retained heap attributed to one constructor. The host is shared, sample counts are intentionally bounded and OS filesystem caches are not flushed: “cold” means a fresh Node process and its first contact build. Warm BVH results characterize repeated construction of already generated arrays under explicit pre-build GC. They do not measure a real game's frame loop.

This benchmark establishes exact behavior and a construction improvement on these three actual paved tracks. It does not establish gains on every authored circuit, off-road terrain deformation, rendering, gameplay FPS or end-to-end browser loading. Agent 13's separately documented synthetic organ-pipe cold regression remains a valid limitation; this real-track evidence does not erase it.

Portable command, with caller-selected checkout and output paths:

```sh
node scripts/track-contact-build-benchmark.mjs \
  --baseline /path/to/baseline \
  --candidate /path/to/candidate \
  --output /path/to/track-contact-build-benchmark.json
```

The candidate defaults to the checkout containing the script; the baseline is required. Both checkouts must provide the real source tree. The script uses Node's native TypeScript transformation in child processes and requires a Node version supporting `--experimental-transform-types`. It creates no test fixtures or production edits on disk; an optional JSON report is its only written output.

Validation completed: the full measurement command exited successfully with `exactEquality: true`; scoped ESLint passed; Prettier formatted the new script. No npm lifecycle hooks, full-project compiler or graphical build were run by this agent.

Deliverables:

- `scripts/track-contact-build-benchmark.mjs`
- `/engine-work-4e0075ccccb3/reports/28-track-contact-build-benchmark.json`
- `/engine-work-4e0075ccccb3/reports/28-track-benchmark.md`
