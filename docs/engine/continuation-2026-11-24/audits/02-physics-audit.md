# Agent 02 — physics algorithms and spatial-query audit

Date: 2026-11-24. Repository: `/engine-work-4e0075ccccb3/repo`.
Audit baseline supplied by coordinator: `5edead7a44c8ccb5a187b22b750ce2bda7715128`.

## Findings and scope

Three concrete opportunities remain after the previous engine programme. Two reduce repeated computation or temporary allocation while preserving existing query results. The third makes exceptional rigid-body steps recoverable without altering the successful integration formula or its tolerances.

| Priority | Opportunity | Measured evidence | Intended boundary |
|---|---|---|---|
| P1 | Prepare quaternion interpolation once per swept pair | Existing rotating-corner fixture performs 6 `acos` and 18 `sin` calls across 6 advancement iterations | Same hit, fraction, normal, point, iteration count and exhaustion status |
| P1 | Remove recursive BVH range copies and redundant full sorting | 8,192 synthetic triangles cause 1,023 temporary slices, 81,920 copied triangle IDs and 519,166 comparisons | Identical hierarchy, leaf permutation and query visitation order |
| P2 | Make rigid-body integration failure atomic; check the final Newton correction | A finite-state midpoint failure leaves translation advanced; an already converged final correction can still throw | Same successful dynamics; rejected steps preserve public body state |

Read-only review covered `src/core/math.ts`, `src/simulation/{bvh,obb,collision,rigid,contact,tire-footprint}.ts`, relevant existing tests and the previous programme's physics/performance/development reports. Only this audit report was written. No production or test source, git ref, tuning, 3D model, character, environment content, geometry or material was edited. Synthetic query data existed only in short-lived Node processes.

## 1. Prepare invariant quaternion interpolation work once per swept pair

**Code evidence.** `src/simulation/obb.ts:38–69` recomputes the endpoint quaternion dot product, shortest-arc sign, `acos(cosine)` and `sin(angle)` on every `ChassisBox.interpolate` call. `SweptBoxContact.intersect` calls interpolation twice per conservative-advancement iteration at lines 246–249, up to 80 iterations. The start/end inputs remain unchanged during that query. `collision.ts` can repeat many such pair queries while resolving events.

**Observed probe.** Reused the small analytic rotating-corner arrangement from `tests/collision-query-efficiency.test.ts`: A has half-extents `[0.1,0.1,2]`, rotates from yaw 0 to `PI/2`; B is stationary at `[1.3,0,1.3]` with half-extents `[0.15,0.15,0.15]`. The unchanged production query returned:

```json
{"hit":true,"iterations":6,"fraction":0.39244887098081277,"exhausted":false,"calls":{"acos":6,"sin":18,"hypot":108}}
```

**Implementation opportunity.** Add two reusable prepared interpolation records owned by `SweptBoxContact`. Prepare the original dot/sign/cosine/angle/sine scalars once on entry, then evaluate exactly the existing weighted quaternion expressions for each fraction. Retain division by the cached sine: replacing division with multiplication by its reciprocal can change rounding. Keep the public alias-safe `ChassisBox.interpolate` API and its bounds contract. Rebuild prepared records on every `intersect`, because subsequent collision events change endpoints.

**Measurable acceptance.** For the fixture above, reduce `acos` calls from 6 to 1 and `sin` calls from 18 to 13; for both rotating bodies use at most two arc preparations per query. Require exact equality, including signed zero, for hit flag, fraction, normal, point, iterations and `exhausted` against a frozen old implementation over seeded translation/rotation paths. The hot loop should allocate no objects after the query instance is constructed. These are operation-count targets, not an asserted FPS improvement.

**Failure/regression examples.** Antipodal quaternion endpoints must not introduce a full turn. Identical and almost identical endpoint rotations must preserve the existing linear/arc branch. Reusing a query with different paths must invalidate prepared scalars. Existing time-zero approaching/resting/separating cases and large-coordinate interpolation remain required. Focused existing gates: `collision-continuous.test.ts`, `collision-query-efficiency.test.ts`, and the interpolation/reuse cases in `engine-physics-invariants.test.ts`.

## 2. Eliminate recursive BVH range-copy allocation while preserving tree order

**Code evidence.** `src/simulation/bvh.ts:130–158` scans bounds, selects an axis and then performs `order.slice(start,end)`, sorts that whole temporary range, and copies it back for every internal node. Ancestors and descendants repeatedly sort overlapping IDs. This is separate from the prior programme's deferred ray-hit details. `contact.ts:33,60` has 15 columns and 8,192 default rows, yielding 229,376 triangles; `track.ts:179–182,204–207` creates this hierarchy lazily on the first paved contact query.

**Observed probe.** Constructed 8,192 independent analytic horizontal triangles using xorshift seed 18731, with triangle origins uniformly distributed over x/z in `[0,1000)` and y in `[0,20)`. Instrumented only `Array.prototype.slice` and sort comparator invocations during the production constructor, restoring them afterward:

```json
{"triangles":8192,"nodes":2047,"slices":1023,"copied":81920,"sorts":1023,"comparisons":519166}
```

This fixture's single instrumented construction took approximately 41 ms on the local Node runtime; that is diagnostic context, not a benchmark claim. For the default 229,376-triangle ribbon, the current balanced split structure implies 32,767 internal temporary slices and 3,440,640 triangle-ID entries copied into slices, plus the same number copied back. That larger count is derived from the code and balanced tree shape, not a measured full-track run.

**Implementation opportunity.** First remove temporary ranges with a deterministic in-place range operation. A more substantial second step is bounded deterministic median selection instead of fully sorting every internal range. Preserve the total centroid comparator including triangle-ID ties. A median-select implementation must restore each terminal leaf's order according to the comparator its parent used; otherwise it changes equal-distance winners. Preserve untouched input order when the root is already a leaf. Use a bounded worst-case fallback for adversarial centroid arrangements.

**Measurable acceptance.** Require zero per-internal-node array slices/copy-back loops. For median selection, target at least a 50% reduction from the fixture's 519,166 comparisons, measured independently of wall-clock noise. Require exact `nodes` bounds/child indices/ranges and exact `orderedTriangle(i)` output against the old builder for random triangles, equal centroids, sorted/reversed input and counts around the leaf boundary. Run identical rays, vertical columns and footprint queries against both trees, preserving all hit outputs and triangle-test counts. Compare allocation/constructor timings separately from gameplay performance.

**Failure/regression examples.** The prior programme explicitly rejected near-first traversal because tolerance bands can place a hit before its leaf entry distance. The fixture in `bvh-traversal.test.ts` named “preserves a tolerated edge hit outside its leaf entry distance” returns triangle 15 at distance `9.9999995`; preserving only nearest distance or globally sorting triangle IDs is insufficient. Coincident faces across leaves, ownership-rejected foreground faces and degenerate/equal-centroid partitions must retain their exact original behavior. Do not change geometry, leaf size, split-axis rule, ray tolerances or traversal as part of this work.

## 3. Make rigid-body integration failures atomic and evaluate the last correction

**Code evidence.** `src/simulation/rigid.ts:45–60` validates forces, angular state, inertia, mass, timestep and rotor endpoints, but omits initial position/velocity. Lines 61–63 mutate acceleration, velocity and position before the midpoint Jacobian and convergence checks can throw at lines 107–113. Orientation and angular state are also mutated before the final finite-state checks at lines 130–136. The Newton loop tests residuals before each correction; after correction 12 it exits and throws without testing that corrected candidate.

**Observed failure probe.** With `dt=1/240`, mass 790, inertia `[1,10,100]`, omega `[1000,700,300]`, initial velocity `[3,4,5]`, zero position and force `[790,0,0]`, production `integrate` throws `Rigid-body midpoint solve did not converge`, yet leaves:

```json
{"position":[0.012517361111111111,0.016666666666666666,0.020833333333333332],"velocity":[3.004166666666667,4,5]}
```

These deliberately stressful inertia/spin values establish failure semantics; they are not evidence that normal vehicle tuning reaches this state. A separate `velocity.x=NaN` probe reaches the late `Non-finite rigid body` exception after contaminating `position.x`.

**Final-correction evidence.** In-memory instrumentation inserted only an additional residual evaluation immediately before the existing nonconvergence throw. With default inertia `[510,1220,1080]`, `dt=1/240` and omega `[s,0.7*s,0.3*s]`, where `s=986939.7654675277`, the final corrected residual was `1.30385160446167e-8`, already below the existing tolerance `0.0000019738795309350553`, but the production method still throws. Again, this is an extreme numerical regression fixture, not a gameplay claim. The production file was not changed.

**Implementation opportunity.** Validate initial position and velocity before any public mutation. Stage the candidate linear/angular state and derived acceleration in reusable scratch, validate the completed candidate, then commit it. Preserve the existing arithmetic order and Cayley/midpoint pairing. Evaluate the existing residual once after the final correction before classifying the result as nonconvergent. Retain explicit failures when the state remains invalid; do not add arbitrary clamps, alter timestep policy, increase tolerances or change ordinary physics tuning.

**Measurable acceptance.** Every rejected call leaves public position, velocity, orientation, omega, acceleration and angular acceleration exactly unchanged. Cover invalid inputs, non-finite candidates, singular solve and bounded nonconvergence. A failed call followed by corrected input must match a fresh body. The converged-final-correction fixture succeeds at the unchanged tolerance. Ordinary successful calls must match the original implementation exactly across seeded finite normal-range inputs, with no per-step allocations. Existing `wheel-momentum.test.ts` momentum/energy checks retain their `1e-6` world-momentum and `1e-9` relative-energy tolerances, including rotor endpoint changes.

## Verification limits and next steps

All probes were small direct Node v24.22.3 processes using `--no-warnings --experimental-transform-types --input-type=module`. No unit suite, build, asset generator, browser workload or full TypeScript check was run for this read-only audit. The previous programme's coverage was inspected rather than redundantly rerun. Implementation should use focused tests and frozen-reference comparisons; broad compiler/build gates remain the coordinator's responsibility.
