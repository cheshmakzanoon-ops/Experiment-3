# Cooperative catalogue terrain preparation

## Cause and production path

The remaining large cold MX meadow task was not the grass mesh builder. Its first terrain sample called `terrainFor`, which constructed the catalogue's shared `VenueField` distance/height raster synchronously. A fresh Valley Ridge probe measured a **190.30 ms** first candidate batch; the preceding audit observed approximately 215 ms in the same path. Prewarming that field removed the large first batch without changing the grass.

In a full game, `CircuitScene` requests the same field during its constructor, before its construction queue starts. Splitting only meadow candidates would therefore leave the actual venue-startup block intact.

`RacingRenderer.create` now prepares this shared dependency before constructing a catalogue circuit renderer. It uses the existing `BuildQueue` and its unchanged cooperative scheduling budget. Showrooms and completed caches do no field preparation and add no scheduled frame. Ordinary synchronous scene constructors remain supported.

The standalone and live-upgrade meadow paths also prepare the same dependency before sampling candidates. Low and Medium retain zero meadow candidate, geometry and material work. The real terrain itself still exists at every quality; its common field is not a High-only resource.

## Exact output and ownership

Raster preparation advances four centreline segments at a time, in the original segment and cell order. Distances, road heights, stations, sides, lower-road corridor selection and Float32 store/tie behavior are unchanged. There is no different mesh, coarser grid, reduced density or abbreviated course scan.

Completed fields are cached by the existing weak `Track` identity. Pending preparation is separate:

- Concurrent waiters advance one shared partial raster.
- Cancelling one waiter leaves other waiters active.
- Cancelling the last waiter releases the unfinished cache entry.
- A synchronous consumer finishes the existing partial owner before returning it.
- A suspended waiter cannot replace an already published completed owner.
- Cancellation in the renderer factory happens before a WebGL context is requested.

The Valley Ridge field retains its **90 × 90** raster, origin **(-440, -430)**, and pre-change array SHA-256 `c370781547503b517e816ef8f54cc33407b2c2d7550fd9b3b435729a1132f62e`. The meadow retains **58,000 candidates, 20,973 clumps and nine draw chunks**. Every matrix/color byte matches the pre-change FNV fingerprint **2074184440**, and all nine measured culling spheres are unchanged. Existing material, wind, shadow, quality-transition and disposal behavior is preserved.

## Measured work and scheduling cost

Four alternating comparisons used fresh Valley Ridge tracks and the original meadow entry point with synchronous field construction versus the cooperative entry point. Both paths used the same raster arithmetic. Track construction was excluded, and the processes shared CPU capacity with other validation work. The figures are elapsed construction work, including possible contention and garbage collection, not isolated hardware benchmarks.

| Measurement | Synchronous field path | Cooperative field path |
| --- | ---: | ---: |
| Median total measured work | 1,596.84 ms | 1,372.91 ms |
| Range of total measured work | 1,263.43–1,713.37 ms | 1,344.80–1,492.30 ms |
| Median largest task | 312.03 ms | 18.66 ms |
| Range of largest tasks | 286.30–351.97 ms | 15.83–197.68 ms |

The 197.68 ms cooperative outlier occurred during a later **256-candidate grass batch**, not field construction. It is retained in the results. The largest observed four-segment field batch in those comparisons was 12.42 ms. Splitting the field removes the intrinsic whole-raster task; it does not guarantee that every JavaScript task will remain under 8 ms, and these timings do not establish a throughput or FPS improvement.

The real factory uses the normal construction scheduler, grouping several small batches between yields. A separate Node probe with an explicitly simulated **16 ms timer scheduler** measured its tradeoff:

| Trial | Raster work | Scheduler waits | Total elapsed | Largest raster batch | Yields |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 267.49 ms | 554.43 ms | 848.77 ms | 13.41 ms | 31 |
| 2 | 184.13 ms | 371.46 ms | 558.96 ms | 2.47 ms | 23 |
| 3 | 213.63 ms | 425.94 ms | 642.60 ms | 2.03 ms | 26 |

Those waits deliberately allow other work between construction slices; they can increase cold-load elapsed time. They are not measured browser animation-frame latency. Actual browser startup responsiveness and timing remain CI/hardware observations. Cached preparation does not repeat these batches or waits.

## Validation

**76 tests passed across seven files**:

- Seven field-contract checks cover the frozen real raster, synchronous equivalence, lower-road crossing heights, cancellation, concurrent waiters, synchronous takeover, cache reuse and valid batch sizing.
- Ten meadow lifecycle checks include cancellation/disposal during cold field preparation before any grass is sampled, byte-identical fresh/upgrade results and atomic rollback.
- Three meadow placement/geometry checks retain course clearance, blade geometry and quality visibility.
- Fourteen vegetation-transition and seven renderer-resource checks retain live-quality and complete teardown behavior.
- Five tests execute the actual renderer factory and constructor up to its native canvas context request, checking field readiness/order, partial and initial cancellation, showroom exclusion and warm-cache reuse.
- The existing thirty startup tests still pass, including all camera/pit warmup and lighting-preparation requirements.

Whole-repository TypeScript, scoped ESLint, formatting and whitespace checks passed. The factory-order tests stop at the native context boundary; they do not replace scene work or claim a full GPU startup pass. No timeout, completion fence, visual acceptance threshold or publication gate was relaxed.

This change adds no new render target, GPU pass, instance, texture or resident field array. It does not convert every synchronous terrain consumer into an asynchronous API, change other large venue-construction tasks, or eliminate later runtime/garbage-collection stalls.
