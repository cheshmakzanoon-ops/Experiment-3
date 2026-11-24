# Physics and terrain invariant review — 24 November 2026

## Finding

Agent 55 found no additional production defect in the inspected engine call
paths. The review retained the existing physics/query/cache changes and added
eight focused regression cases in
[`engine-physics-invariants.test.ts`](../../tests/engine-physics-invariants.test.ts).
All eight passed. No production source, vehicle tuning, model, character,
authored geometry, environment or asset was changed by this assignment.

The source inspection compared original commit
`a0ae513e7982f0b4719296519752e0ae5f1983f8` with the engine changes published through
`c4e62c642d912037e5e9262b1b89d4fbfd9677fe`. Concurrent wave 9 work concerned storage
and worker-buffer ownership; the seven inspected simulation files retained the
following Git blob IDs at completion:

| Source | Inspected blob |
|---|---|
| `src/simulation/bvh.ts` | `242e8f715572dbab4a01432f80ee720be6e51b5c` |
| `src/simulation/obb.ts` | `a540b1758ad163003916e2c4f272bb686535fc8d` |
| `src/simulation/collision.ts` | `404341932dd7c09b07bf3920c87d24cd4afc2d71` |
| `src/simulation/open-world/terrain-tiles.ts` | `ecd0621d5474a0a894364b6ddee60aa7d01d5c4f` |
| `src/simulation/open-world/route-path.ts` | `6cd11b85ecfcb7bad14ae5867cd2b9426e789c82` |
| `src/simulation/world.ts` | `adadc6ad1f633e7a45dc4fed3d7d52b65b7cea79` |
| `src/simulation/vehicles.ts` | `bf076ab2899bc250ba3f537c9a6f172544948a44` |

## Review findings

The general BVH query retains its original traversal and winner rules. Its
deferred detail path is disabled for ray inputs that alias either output vector;
successful queries update barycentric scratch before resolving the final hit.
The actual road ownership predicate uses the supplied contact coordinates and
does not recursively enter the BVH. Alternating general and cached vertical
queries must continue to reevaluate ownership and preserve miss-output behavior.

The endpoint collision pass keeps the original frozen x ordering and uses live
y/z bounds, refreshing both boxes after each response. This allows an earlier
depenetration to create a later contact. The added bounds are recomputed by
update, copy and interpolation, including the in-place interpolation used by the
continuous solver. Swept radii are refreshed for the active field, and centre
intervals are refreshed for each event; changing field size or identity must not
reuse an abandoned capture or another entrant's cached bounds.

Deferred support-point construction is restricted to the continuous query's
contact threshold. Ordinary `BoxContact.separation` callers retain eager point
calculation. A miss or resting contact must not leave stale geometry that a
later approaching contact can consume.

Terrain residency changes affect scheduling and storage, while `TerrainCarver`
and `gridHeight` remain unchanged. A failed generation must leave valid resident
samples usable; a later synchronous request can retry, and clear must invalidate
the sample fast path. Prefetch removes its attempted queue item before generation,
so this review checks recovery through a later query rather than promising an
automatic retry of a thrown prefetch operation.

The route queue preserves exact distance/state-index ordering and the existing
relaxation threshold, while the snapshot rank scatter preserves first-occurrence
ranks and the frozen vehicle-index mapping. Their existing dedicated equivalence
suites already cover the relevant search/rank cases, so this assignment did not
add another expensive world or routing workload.

## New executable coverage

| Cases | Boundary checked | Evidence |
|---|---|---|
| 2 | Output aliases either endpoint of chassis interpolation | 512 seeded interpolations and copies match fresh outputs exactly; all 4,096 transformed corners lie inside the added y/z bounds, including translations up to `1e12` |
| 1 | Reused collision solver across field transitions | Eight episodes with sizes `6, 2, 0, 8, 1, 4, 0, 5`, reversed entrant orders and different extents match fresh solver contact traces, body states and diagnostics |
| 1 | Abandoned capture and repeated endpoint solves | Replacing captured objects retires the old sweep; subsequent solves retain zero stale sweep queries and match a fresh solver |
| 1 | Deferred separation and zero-motion contact reuse | A deferred miss preserves the unread point, an ordinary separation refreshes it, and a later approaching time-zero sweep returns the same contact as a fresh query |
| 1 | General/vertical query interleaving with changing ownership | 320 ownership transitions produce matching complete hits or misses across both paths, including reused vertical columns and per-vertex normals |
| 2 | Synchronous and prefetch terrain build failures | Existing heights/normals survive failure; query retry restores residency; clear observes a changed synthetic height field without stale samples |

The collision fixtures use real rigid bodies, impulses and query code with a
barrier-free track stand-in. Terrain failure fixtures use a small analytic plane
so height and normal expectations are independent of cache internals. These are
synthetic verification fixtures, not changes to any authored game environment.

## Commands and results

```sh
NODE_OPTIONS=--max-old-space-size=640 node node_modules/vitest/vitest.mjs run tests/engine-physics-invariants.test.ts
NODE_OPTIONS=--max-old-space-size=512 node node_modules/eslint/bin/eslint.js tests/engine-physics-invariants.test.ts
```

The direct Vitest run passed **8/8 tests** in one file, with about 375 ms spent
inside the tests. Scoped ESLint and formatting checks passed. No npm lifecycle
hook, full TypeScript compiler, production build, browser or asset generator was
invoked. The coordinator includes the new test file in final compiler validation.

These cases supplement the separate
[same-tick baseline comparison](ENGINE_DETERMINISM_2026-11-24.md) and
[operation-count evidence](ENGINE_PERFORMANCE_2026-11-24.md). The new reuse tests
compare warm and fresh instances of the revised implementation; they do not
replace those independent original-engine comparisons. This review does not
prove every numerical input, every contact configuration, arbitrary recursive
callbacks, complete races or cross-platform floating-point equivalence, and
does not establish an FPS or native-device performance improvement.
