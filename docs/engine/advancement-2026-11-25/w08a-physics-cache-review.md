# W08A — independent physics and cache review

Assignment **43/60**, wave 8A, complete. **Recommendation: retain the reviewed
lane and surface implementation. No new correctness defect was found.** The
measured gains are useful but workload dependent; the cold, continuously
invalidating and deliberately evicting cases must remain part of the published
result. Further admission policies or empty-water shortcuts require a separate
proof and measurement before production changes.

This assignment adds this report, its untimed proof script and its evidence.
It collected no workload timings, ran no broad build or test job, and changed
no production code, dependencies,
models, characters, environments, geometry definitions, shaders or authored
tuning. The recommendation applies to the reviewed physics changes; other
release gates remain the coordinator's responsibility.

## Evidence and source identity

The review read the [plan](PLAN.md), [W02A lane implementation](w02a-lane-index.md),
[W02E surface implementation](w02e-surface.md),
[W05A integration review](w05a-surface-lane-integration.md), existing focused
regression tests, and the actual source diff against the original tree. The
measured evidence is [W07A](w07a-lane-measurement.md),
[W07B](w07b-surface-measurement.md) and
[W07F](w07f-simulation-measurement.md), including their disclosed adverse cases.
No timing was inferred from operation counts.

The durable untimed proof is
[`physics-cache-edge-proof.mjs`](../../../scripts/engine-advancement/physics-cache-edge-proof.mjs).
It imports both actual source trees, records a conservative static source
manifest (including type-only imports), checks clean source inputs and commit
identities before and after execution, and refuses output overwrite. It has no
workload timer and performs no bundling or production rewriting. The complete
water grid and mutable thermal sequence are explicit in the script.

```sh
node --no-warnings --experimental-transform-types \
  scripts/engine-advancement/physics-cache-edge-proof.mjs \
  --baseline /dev/shm/aeebac160835-engine-baseline \
  --current /tmp/aeebac160835-engine/Experiment-3 \
  --output /absolute/new-physics-cache-edge-proof.json
```

This small proof should still run outside another assignment's reserved timing
window. It requires independent source roots and the pinned original baseline;
the current source commit and all recorded input hashes are written into its
result.

The final [proof result](evidence/physics-cache-edge-proof.json) passed at
candidate `6cb1c881d19d190f5dbc68adeb9bf8b6c600da1b`, after the coordinator
released the network timing reservation. It records 95 source/configuration
files per side; this conservative manifest includes type-only dependencies
and contextual Track sources in addition to the directly executed solvers.
All recorded source identities remained stable. The evidence is 39,180 bytes,
SHA-256 `3358d8ae1e8bbd562a9ef3a90a600cb6c985708b21e1e90794709818fa59d37d`.
The final proof script SHA-256 is
`a33892a0c47bf1e71a2f03f06197cbefc85212bd4c7aaf6125b4238000426943`.
Scoped ESLint and Prettier checks pass.

The independent numerical probe imported the actual modules at these roots:

| Role                          | Commit                                     | Source root                             |
| ----------------------------- | ------------------------------------------ | --------------------------------------- |
| Original                      | `350119e8ec0606e8c5de5b3ab80df41104025679` | `/dev/shm/aeebac160835-engine-baseline` |
| Initial reviewed candidate    | `6a1c76fae3736e4d814ab6d0a354f6837320731c` | `/tmp/aeebac160835-engine/Experiment-3` |
| Final durable proof candidate | `6cb1c881d19d190f5dbc68adeb9bf8b6c600da1b` | `/tmp/aeebac160835-engine/Experiment-3` |

Both commit identities were checked before and after each probe. The
coordinator advanced documentation and evidence commits between probes; the
reviewed production physics hashes remained unchanged. The initial JSON
observation record is
`/tmp/aeebac160835-engine/validation/w08a-edge-review.json`; its relevant findings
and complete input sets are recorded below so this report remains useful
without that scratch file.

Recorded candidate SHA-256 identities:

| File                                 | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `src/simulation/track.ts`            | `11c4f225e953670d86a75660a128a944a38c4105ccf08e00e52b2d0ed6453bc5` |
| `src/simulation/track-lane-index.ts` | `070a1ecefbc1a0740092ccd57b462845d22d52c6064e51c767f1af4bf9df7b54` |
| `src/simulation/weather.ts`          | `71da8aa301efa348cc373f560f17cb8a18cde32c9085cdc8f8dbb613dba57088` |
| `src/simulation/surface-thermal.ts`  | `9af1582d816e0600512c550d3dbed465f08425b903691e6230d05e54b2bf5c12` |
| `package-lock.json`                  | `610c1768c440c202a4e37f62d22467d4cbbddc44a5962e82bb256dcfb8627edf` |

The original and candidate lane-index module hashes are identical. The
production lane change extends its use to paved ribbons; it does not replace
the index algorithm. The dependency lock hash also matches the original.

## Ranked findings and decision

There is **no release-blocking correctness finding in this scope**. The ranking
below orders follow-up engineering work by the strength and relevance of the
available adverse evidence, rather than treating an optimization opportunity
as a defect.

| Rank | Finding                                                                                                                      | Impact and evidence                                                                                                                                                                                                                                   | Recommendation                                                                                                                                                                                                                                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Repeated invalidation and initial cache fills can cost more than recomputation alone.                                        | W07B found paired penalties of 20.6% for changing solver dt, 16.9% for first wet ticks and 6.5% for storm surface evolution. These are meaningful subsystem costs, although Track uses fixed internal dt and W07F's combined storm workload improves. | Retain the validated implementation for this release. A separately owned investigation may compare lazy admission or fewer miss-path checks, preserving every invalidation and error boundary. Do not claim a demonstrated fix or roll back from the microbenchmark alone. |
| 2    | The bounded paved lane cache loses on deliberate all-miss streams.                                                           | W07A's 4,096-cell sequential working sets exceed the 2,048-entry cap and are 2.19–2.67 times slower, consistently in every pair. Repeated paved queries are 1.76–3.70 times faster.                                                                   | Keep the bound and conservative geometry proof. Consider admission changes only if representative Simulation traces establish substantial churn; replacing the bound with unbounded retention would conceal the cost by creating a different problem.                      |
| 3    | Clear-path overhead is plausible but its size is uncertain.                                                                  | W07B clear is slower in 8/9 pairs with a +2.9% paired median; the +11.3% ratio of independent medians is distorted by spikes. W07F clear has opposite AB/BA order-group signs.                                                                        | Describe the result accurately. Do not present either a clear-weather gain or a stable 11.3% penalty. Preserve the existing single-rain thermal fast path.                                                                                                                 |
| 4    | Empty water and a nonpositive source admit an exact numerical shortcut, but optional-bank behavior constrains its placement. | All 672 probed empty/nonpositive cases return positive zero. Fourteen invalid-cell calls currently throw and fourteen tiny-drainage calls intentionally bypass the bank.                                                                              | No production change now. An unconditional early return is a no-go because it changes observable validation/call behavior. A carefully scoped alternative needs its own measured benefit and regression coverage.                                                          |

The combined evidence favors preserving the current design while addressing
specific costs in follow-up work. W07F observed lower paired durations for rain
and storm in both execution orders, alongside exact checked state and frame
equivalence. That is more directly relevant to the whole simulation than an
isolated cache miss, but it does not negate the documented subsystem penalties.

## Lane geometry, layers and lifetime

`Track.nearest` still obtains its original 32 m coarse bucket first. Only
queries with that bucket enter the lane index; outside-hash queries retain the
original full segment scan. The 4 m lane cells align with the coarse grid,
including negative coordinates through `Math.floor`. The cached value is a
conservative candidate list, not a selected station, height, weather value or
surface result.

The geometric bound has two parts. A vertex belonging to the coarse candidates
provides an upper bound on the distance to some candidate segment from anywhere
in the 4 m cell. Segment bounding boxes provide lower bounds. Filtering keeps
every candidate whose lower bound can meet that upper bound, including equality
and a small conservative margin. `coarse.filter` preserves original order, so
the existing strict-less-than nearest comparison resolves equal-distance ties
in the same order.

For a finite query height, the index uses its smaller list only when both
endpoints of the witness segment prove that its interpolated centerline lies
within the requested layer gap, with an additional margin. That guarantees an
eligible witness under the actual nearest predicate. If the witness cannot
prove eligibility, the original coarse list is returned. This fallback is also
conservative for banked roads whose eligibility would depend on the later bank
correction, and for stacked decks. Terrain venues retain their existing
height-independent query policy.

Newly indexed paved Tracks use a 2,048-entry per-instance cap. Eviction removes
the oldest insertion; hits do not refresh insertion order, so this is **not an
LRU cache**. Entry count bounds retention, not exact heap bytes: candidate-array
lengths, strings, Map storage and object headers vary. Existing MX/SX indices
retain their prior uncapped policy; RX/rally remain outside this index. It would
be incorrect to generalize the paved cap to every venue or every engine cache.

The index follows the lifetime of its Track and its sampled ribbon. Weather,
surface evolution and terrain state restoration do not edit that ribbon.
Simulation recreation creates new Tracks and new caches. No supported runtime
geometry-editing path requiring additional invalidation was found. Ad hoc
mutation of public point/hash structures is not established as a supported
contract and would also stale the pre-existing coarse hash and related sampled
data; this review does not label that hypothetical mutation as a new defect.

## Surface numerical keys and ordering

The depression field is precomputed with the original expression and original
row/column inputs into Float64 storage. It has no weather, time, drainage or
traffic dependency. The evolve loop retains its original cell traversal,
weather endpoints, traffic heat consumption, frozen-phase operations and fixed
0.5-second internal surface steps. Fragmented caller dt changes how many of
those steps execute and the retained remainder, not the solver's internal dt.

The coefficient banks are fixed arrays, independently owned by each Track or
solver; they do not retain a history of weather configurations.

| Cached work              | Actual validity inputs                                                                               | Review result                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Water drainage gain      | Whole-bank dt and each slot's current drainage, both compared with `Object.is`                       | Changed dt clears drainage keys; changed drainage recomputes that slot using the original `-Math.expm1(-drainage * dt)`. Signed zero remains distinguishable in keys. |
| Thermal matrix signature | dt, effective air coefficient, surface capacity, substrate capacity, conduction and deep conductance | Each prepare checks actual values, including a caller-retained mutable parameter object; changes invalidate per-cell rainfall keys.                                   |
| Per-cell thermal matrix  | Current rainfall under the valid matrix signature                                                    | Stores and retrieves the same six Float64 coefficients. There is no growing rainfall-key map.                                                                         |
| Live thermal forcing     | Ambient temperature, solar flux, vapour and evaporation transfer                                     | Refreshed in prepare; these are not omitted matrix dependencies. Effective air is the matrix input, while the other wind-dependent forcing is refreshed separately.   |
| Exposure                 | Live sheltered row and separate exposed/covered prepared solvers                                     | Shelter changes select the appropriate current solver; a shared water bank remains valid because every call checks actual drainage and dt.                            |

The thermal same-rainfall return is deliberately before the more expensive
signature refresh inside `prepareMatrix`. Default clear and covered cells
therefore keep their existing scalar fast path; they do not copy six matrix
coefficients for every dry cell. `prepare` still refreshes the signature before
selecting its initial rainfall. A changed-rainfall call also refreshes it.

This distinction matters for mutable parameters: changes before a subsequent
prepare are observed, and changed-rainfall requests observe relevant edits
since prepare. Arbitrary parameter mutation between prepare and a same-rainfall
advance retains the original same-rainfall shortcut behavior. The review does
not expand that contract into immediate observation of every possible property
mutation or getter side effect.

Thermal invalid optional slot indices fall back to uncached matrix work. Water
invalid slots throw when the water bank is used. These are distinct current
API behaviors and should not be silently normalized in an optimization.

The added fixed typed-array payload is **286,720 bytes / 280 KiB per Track**:
28,672 bytes for depression, 57,344 for drainage/gain, 28,672 for thermal
rainfall keys, and 172,032 for six matrix coefficients per cell. The covered
thermal solver has zero per-cell matrix capacity. This is logical payload,
not a retained-heap or RSS measurement; headers and scalar fields are excluded.
The accounting and actual allocation checks are detailed in W07B.

## Independent numerical and error probes

A small, untimed Node probe loaded each actual module with
`node --no-warnings --experimental-transform-types --input-type=module`.
It did not reconstruct baseline equations or modify source. The comparison
used `Object.is`, distinguishing signed zero and comparing any legacy
non-finite result rather than rejecting or repairing extreme-input overflow.

| Check                            | Coverage                                                                     | Result                                                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Water value grid                 | 3,920 input tuples, current without a bank and with each of three bank slots | 15,680 exact comparisons passed.                                                                                        |
| Empty water / nonpositive source | 672 tuples drawn from the same grid                                          | Original and candidate return positive zero.                                                                            |
| Invalid base inputs              | 31 invalid tuples, each tested with and without the optional bank            | 62 paired rejection comparisons preserve `Invalid surface water step`.                                                  |
| Invalid optional cell            | Seven invalid indices at four drainage values, using a one-slot bank         | Fourteen tiny-drainage calls return positive zero; fourteen other calls throw `Invalid surface water coefficient cell`. |
| Mutable thermal sequence         | 480 wet-column calls plus prepared-rainfall restoration checks               | 2,160 surface/substrate/water/evaporation scalar comparisons passed.                                                    |

The complete water grid was the Cartesian product of:

```text
water:    [-0, 0, Number.MIN_VALUE, 1e-12, 0.1, 1, Number.MAX_VALUE]
source:   [-Number.MAX_VALUE, -1e6, -1, -Number.MIN_VALUE, -0, 0,
           Number.MIN_VALUE, 1e-6, 1, Number.MAX_VALUE]
drainage: [-0, 0, Number.MIN_VALUE, 0.999999e-12, 1e-12, 0.02, 1,
           Number.MAX_VALUE]
dt:       [-0, 0, Number.MIN_VALUE, 1e-12, 0.5, 1, Number.MAX_VALUE]
```

Each base field was separately challenged with `NaN`, both infinities,
`undefined`, `null`, string `"0"` and `true`; negative one was also checked for
water, drainage and dt. Negative source is valid. The optional slot probes
used `[-1, 0.5, NaN, Infinity, -Infinity, 1, 2]` and drainage
`[0, 0.999e-12, 1e-12, 0.02]`.

The thermal probe ran ten successive parameter/weather stages against the
actual original and candidate solvers, including signed-zero ambient/rain/wind,
rain changes, capacities 31,000/190,000, zero then restored conduction/deep/air
parameters, zero solar flux and restored defaults with rain 44 and wind (6, 1).
Each stage traversed sheltered states `[false, true, false]`, dt
`[1/120, 0.5, 60, 0.5]`, and four cells with local rain
`[-0, 0, 0.001, 0.003]`, drainage `[0, 1e-15, 0.02, 1]`, and initial surface
temperatures `[-0, 0, 24, 60]`. Sheltered rain was zero. After each prepared
group of four wet advances, an ordinary dry-column advance checked restoration
of the rainfall supplied to prepare. Parameter objects and coefficient banks
were retained across stages to exercise invalidation, not reconstructed fresh
for each comparison.

These checks complement the existing focused tests and W07B's full grid/raw
thermal audit. They do not prove that every extreme finite input produces a
finite physical result; the original can overflow at those extremes. They
show preservation of the original numeric and error outcomes for these cases.
No new regression test was added because no defect in the existing production
implementation was found.

## Why the proposed empty-water shortcut is deferred

For validated finite inputs, `water === 0 && source <= 0` gives positive zero
in the existing water equation. For tiny drainage, the finite nonpositive
source times nonnegative dt is nonpositive, possibly negative infinity after
overflow. For other drainage values, the original gain is between zero and
one, and the source contribution remains nonpositive. The final
`Math.max(0, ...)` yields positive zero, including signed-zero inputs.

That numerical fact is insufficient to move a return before the optional bank
call. These examples reproduce the compatibility boundary using the current
actual module, with no timers:

```sh
node --no-warnings --experimental-transform-types --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { advanceWater, WaterStepCoefficients } from './src/simulation/weather.ts';

const bank = new WaterStepCoefficients(1);
assert.throws(
  () => advanceWater(0, -1, 0.02, 0.5, bank, NaN),
  /Invalid surface water coefficient cell/,
);
assert.throws(
  () => advanceWater(0, -1, 1e-12, 0.5, bank, NaN),
  /Invalid surface water coefficient cell/,
);
assert.ok(Object.is(advanceWater(0, -1, 0.999e-12, 0.5, bank, NaN), 0));
assert.ok(Object.is(advanceWater(-0, -0, 0, 0.5, bank, NaN), 0));
assert.throws(
  () => advanceWater(NaN, -1, 0, 0.5, bank, NaN),
  /Invalid surface water step/,
);
JS
```

An early empty-water return would suppress the first two errors. Moving slot
validation before the tiny-drainage branch would instead introduce errors in
the next two currently accepted calls. Skipping a supplied `gain` invocation
also changes observable behavior for an instrumented or overridden method, as
well as which bank entries initialize. That call-order implication follows
from the actual branch structure; no external instrumentation contract is
assumed beyond preserving current behavior.

A shortcut restricted to calls without a bank could preserve bank behavior,
but Track currently supplies a bank, so this has no demonstrated benefit for
the measured default path. Calling the bank before returning keeps its work
and therefore needs evidence that the remaining arithmetic saving matters.
A trusted internal Track shortcut or explicit validation/admission API would
be a larger design change. None is justified by the present measurements.

Any follow-up should first specify base-input errors, optional-slot errors,
the strict `1e-12` boundary, positive-zero results, gain call order and first-use
cache initialization. Its correctness comparison should include cold/warm
banks, drainage edits, changing dt, mutable thermal parameters, shelter,
prepared rainfall restoration and actual Simulation state/packed frames.
Only then should a reserved paired measurement compare clear, rain, storm,
first-tick and continually invalidating workloads.

## Measured tradeoffs in context

The following values are taken from the existing reserved runs; this review
performed no additional timing. Negative paired time change means less elapsed
time in the candidate.

| Scope                                                   | Result                                                                             | Interpretation                                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Warm paved nearest queries, W07A                        | 1.76–3.70 times faster; all nine pairs favor candidate at each changed paved venue | Strong local reuse benefit for the bounded primed working set.                                                                   |
| Deliberately evicting paved queries, W07A               | 2.19–2.67 times slower; all nine pairs slower per venue                            | Real miss/build/eviction cost; candidate medians 1.967–2.508 microseconds per query versus original 0.737–1.145.                 |
| Surface steady rain, W07B                               | −38.4% paired; 9/9 faster                                                          | Consistent subsystem benefit for this schedule.                                                                                  |
| Surface mutable weather, W07B                           | −24.6% paired; 8/9 faster                                                          | Useful gain, but 130 of 176 endpoints occur at or after its final weather keyframe. Shelter/drainage/traffic continue to change. |
| Surface storm / first wet tick / variable dt, W07B      | +6.5% / +16.9% / +20.6% paired                                                     | Adverse costs remain material; changing solver dt is a separate direct-solver case, not Track's fixed internal step.             |
| Combined Simulation rain, W07F                          | −11.88% paired; 7/9 faster; AB −13.29%, BA −10.89%                                 | Supports a local whole-simulation improvement for the declared rainy fixture.                                                    |
| Combined Simulation storm, W07F                         | −12.14% paired; 8/9 faster; AB −13.43%, BA −10.99%                                 | Supports a local whole-simulation improvement despite isolated storm surface cost.                                               |
| Combined clear / first steps / GP and MX controls, W07F | Mixed pairs, order disagreement or sizable spikes                                  | No established general gain or firm universal penalty.                                                                           |

W07F times 480 actual physics steps and 240 frame writes per sample. Its 72
warmup/sample comparisons all passed. Including its independent audit, the run
compares 463,357 `Object.is` numeric scalars, 44,474,976 typed-array bytes and
81,168,000 packed frame bytes. Race-control event ordering also has a nonempty audit. This is
strong integration evidence for the checked state, not direct inspection of
every private field or closure. W07B separately observes consumed traffic heat
at the actual thermal-call boundary without adding production accessors.

The observed integrated gains cannot be causally assigned solely to a lane
cache or thermal cache. All raw pairs and spikes remain in the source reports;
none was removed for this recommendation. No browser frame-rate, native
hardware, retained-heap or universal performance claim follows from these
bounded local runs.

**Go:** retain the validated physics changes and publish both the benefits and
the adverse cases. **No-go:** an unmeasured shortcut, cache-cap removal,
weather/tuning change to improve hit rates, or an unconditional performance
claim. Further optimization should earn its place through a separately
specified compatibility proof and representative paired evidence.
