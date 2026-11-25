# W08F / worker 48 — independent physics adversarial audit

## Disposition

Accept the four narrow physics optimizations on their supported engine domains **with the constructor-domain correction below**. I found one concrete, previously untested preservation defect: scalar index stores allowed certain fractional row counts to return incomplete contact meshes although the actual baseline constructor rejected them. The correction is three added lines in `src/simulation/contact.ts`; no numerical operation inside a valid mesh build changes. The final focused gate passes **62 tests across 6 files**. No performance measurement was rerun.

The road-frame reuse remains supportable as a local reduction in repeated pure work, with no demonstrated natural-vehicle throughput gain. W07B's original **+9.964549759% rl2 paired wall-time signal remains unresolved evidence**. W07E did not robustly reproduce it; it did not establish why it occurred or prove it was noise.

## Scope and exact source provenance

- Task baseline: `1c609bfa7006ee2c51a32a97f1fedd61c6c1bfcb`.
- Audited published checkout before the correction: `6314ba3ec7d54a0ba1e79a59b8db8f03117e4520`.
- W07 measurement candidate: `f4d41b0c00fa7b69f35ba1b1f48b67541e3749b6`.
- At audit start, all four current physics files exactly matched the W07 candidate SHA-256s. I verified all **22 target-file source-manifest entries** across W07A, W07B and the three W07E source graphs against actual `git show` bytes and Git blob identities. All **six checked-in measurement harness files** matched their recorded measured hashes.
- I reviewed the complete baseline diff for `bvh.ts`, `contact.ts`, `road-contact.ts`, and `vehicle.ts`; the only differences were scalar BVH bounds, scalar normal/index stores, normal-length reuse, and a four-element AWD slip maximum.
- A read-only baseline diff for `vehicles.ts`, `vehicle-catalogue/`, `vehicle-dynamics.ts`, `circuits.ts`, `gp-course-edges.ts`, `track.ts`, `core/math.ts`, and `tire-footprint.ts` was empty.

The added constructor guard is newer than the measured candidate. W07 timing numbers continue to describe their pinned source, not a newly measured post-guard constructor.

## Confirmed defect and minimal correction

`TrackContactMesh` allocated typed arrays from `rows` but did not require an integer count. Typed-array lengths truncate fractions. The old six-entry `indices.set(...)` raised `RangeError` when its source exceeded the truncated destination. The scalar version silently ignored out-of-range indexed assignments. Certain fractions happen to leave vertex and index array lengths divisible by three, so the BVH's shape/index guards accepted the incomplete result.

The targeted proof imports the **actual original committed `contact.ts`**, with all non-target dependencies shared from the current checkout, and compares it against the actual current constructor. It does not reimplement the old geometry loop or alter authored inputs.

| Explicit `rows` | Actual baseline | Pre-fix candidate | Post-fix candidate |
| --- | --- | --- | --- |
| 0.4 | `RangeError: offset is out of bounds` | Returned 21 vertices / 11 triangles | Explicit row-domain `RangeError` |
| 1.4 | Same baseline `RangeError` | Returned 36 vertices / 39 triangles | Explicit row-domain `RangeError` |
| 7.4 | Same baseline `RangeError` | Returned 126 vertices / 207 triangles | Explicit row-domain `RangeError` |
| 1 and 2 | Returned valid meshes | All three buffers exactly equal | All three buffers exactly equal |
| 0 and -0 | `Error: BVH requires nonempty triangle geometry` | Same rejection | Explicit row-domain `RangeError` |
| NaN | Nonempty-BVH rejection | Same rejection | Explicit row-domain `RangeError` |
| Infinity and -1 | Typed-array-length `RangeError` | Same rejection | Explicit row-domain `RangeError` |

Each incorrectly returned fractional mesh contained six trailing zero-initialized vertices. For rows 1 and 2 the proof also checked exact equality of all BVH nodes, before and after the correction.

The constructor now checks:

```ts
if (!Number.isInteger(rows) || rows < 1)
  throw new RangeError('Contact mesh rows must be a positive integer');
```

This deliberately makes malformed-input rejection explicit and early, including a clearer error class/message for zero and NaN. It does **not** claim exact error-message preservation for those unsupported inputs. Zero was not a supported baseline mesh. Normal production callers supply the default 8192 or `Math.max(8192, Math.ceil(track.length / 0.9))`; no caller or authored row configuration changed.

New `tests/engine-physics-adversarial.test.ts` has 9 row-domain cases and 4 vector-alias cases. Its pre-fix result was 9 failed / 4 passed: three failures represent the silent-acceptance defect; the remaining six assert the intentionally clearer invalid-domain error. This is one demonstrated defect, not nine independent bugs.

## Numerical, topology, and ownership invariants checked

### BVH scalar extrema

The constructor still rejects NaN/Infinity vertices and invalid lengths/indices before building. Each component's extrema fold retains the same starting infinity, vertex order, `Math.min`/`Math.max` operation, and IEEE signed-zero behavior. There is no arithmetic reassociation. Cached scalar bounds are written back before the unchanged longest-axis decision, partition routine, recursive preorder, and leaf ordering execute.

Finite extreme vertices can still overflow centroid sums or axis extents. That is pre-existing behavior, not a newly introduced non-finite-vertex acceptance. The unchanged comparator/partition code receives exactly the same centroids and node bounds. The existing scalar-bound suite covers signed-zero root and internal nodes, subnormals, overflowed centroids, coincident/point/collinear triangles, ownership, normals, closest rays, cached vertical rays, and tire support; it passed again.

The optimization does assume the supplied typed-array geometry is stable during synchronous construction. Current buffers are privately allocated before building. Side-effecting replacement `Math.min`/`Math.max`, externally mutated shared buffers, or custom accessor objects are outside the engine's static-geometry ownership contract. No new query alias rule or traversal order was introduced.

### Contact buffers

For positive integer rows, every normal and index destination is within the allocated size. All height, kerb, band, gradient, bank, normal arithmetic and normalization expressions are unchanged. The same three Float64 values and the same six Uint32 values go to the same offsets, including original triangle winding and terminal row. Neither values nor operations were reordered. The new row guard closes the formerly implicit bounds assumption; it does not change the authored geometry law.

Existing full-buffer byte comparisons passed at row counts 1, 2, 31, 128, 257 and the actual 8192 default. The W07B eight-mesh proof also captures all geometry bytes, tree nodes/order, and sampled query results from the actual original constructor; I audited that harness and its retained records without repeating its exhaustive measurement.

### Road frame

For an ordinary `Vec3`, `length()` is the pure `Math.hypot(x, y, z)` function. The unchanged finite/angle checks run before length/state mutation; the admitted length is at least 1e-8, so the removed `normalize()` call's 1e-12 fallback is unreachable. Both versions multiply the copied components by the same `1 / length` value. They retain signed zero and the existing cancellation/overflow behavior, including `Number.MAX_VALUE, -Number.MAX_VALUE, -0` passing `Vec3.finite()` but producing infinite hypot and a scale-by-zero degenerate tangent.

The finite guard still uses `Number.isFinite(x + y + z)`, not separate finite-component checks. I did not silently repair or reinterpret that pre-existing contract. Invalid orientation state, near-threshold normal/tangent behavior, and false-return degenerate tangents remain covered by existing tests and the actual-source W07B special cases.

The four new alias cases pass exactly when the input normal is the frame's own normal, axle, forward or lateral vector, versus an independent copy with the same components. Normal copying occurs before the later axle/tangent mutations. Production calls use the ordinary `SurfaceSample.normal` `Vec3`; I found no derived or overridden Vec3 implementation. Custom overridden `length()` methods or stateful getters are not asserted equivalent.

### Four tire entries

`Vehicle` allocates four tires from `[0, 1, 2, 3]`; `replaceTires` replaces exactly those four entries. All wheel/contact/frame/drive arrays and the solver's loops use that same invariant. The motorcycle adapter preserves four exposed entries, including paired wheel-state aliases; it does not resize the tire array. No production mutation of the simulation tire-array length was found.

The AWD branch still evaluates absolute slip in index order 0, 1, 2, 3 and supplies all four results to `Math.max`. It preserves NaN, infinities and signed-zero handling; supported-load logic, grip clamping, inertia arithmetic and single-axle selection are unchanged. The existing math suite covers each corner and sign, invalid slips, saturation, unsupported wheels and either single driven axle. Sparse/resized externally modified arrays and custom array species/iterators are outside the fixed-four engine state invariant.

Current catalogue coupling is enabled only for rear-drive sk125 and dk100. The optimized AWD path is dormant in normal catalogue stepping. No tuning was changed to activate it and no current-game saving is assigned to the dormant microbenchmark.

## Independent benchmark-method audit

### W07A

The timed interval contains the complete BVH constructor, including validation, centroids, partitioning, node allocation and extrema work. Mesh construction, parsing/bundling, explicit GC, memory sampling, hashing, correctness checks and queries are outside it. Both constructors use the same real current geometry and ownership callback. One setup tree stays resident because that callback captures its mesh; the report discloses that retention.

The verifier independently folds leaf geometry, unions child bounds, checks exact bounds with `Object.is`, and verifies permutation, ranges, preorder and node reachability. Complete binary node/order snapshots are compared for every constructed tree. Sampled queries include retained output fields on misses as well as hit values and work counts. These checks establish baseline equality on the fixtures and samples, not an independent exhaustive ray-intersection proof.

The recorded paired constructor reductions are 53.9009% at 1024-row Poggio Alto and 33.1075% at 8192-row Aurel. Order dependence and single-runtime limits are material; neither result is a query-speed, cold-start, FPS, or whole-game claim.

### W07B

Actual original target files are loaded by commit; non-target dependencies are shared candidate sources. Baseline Vehicle directly imports the original frame. Both contact constructors use the same candidate BVH, so this constructor comparison isolates scalar buffer stores from the separate BVH change. Instrumentation, setup, explicit GC and serialization are outside timing; endogenous GC stays included.

The original substep experiment shares old/current implementations and both vehicle workloads in one child, with two 600-step warmup pairs per variant before ten 1200-step measured pairs. It is valid retained evidence but susceptible to shared dispatch/JIT feedback and warmup/host variation. These are possible measurement effects, not established causes. Its frame and clutch timed checksums are not exhaustive state captures; the separate exact proof checks frame outcomes/state and paired trajectories. The report's limited claims are appropriate.

### W07E and road-frame retention

Each of 127 fresh children has one source implementation and one workload. Actual baseline/current source graphs and the candidate-with-original-frame attribution graph are pinned. Twelve rounds cover all six three-variant orders twice. Each natural vehicle sample includes 38,400 warmup and 28,800 measured substeps in the same process; vehicle/track setup, explicit GC, serialization and comparisons are outside timing. The analytic runway bypasses contact-mesh/BVH construction and excludes race/AI/weather/render orchestration from timed vehicle work.

I recalculated the key summaries from retained raw rows:

| Evidence | Paired wall median | Paired CPU median | Candidate faster |
| --- | ---: | ---: | ---: |
| W07B rl2 | +9.964549759% | Not recorded | 3/10 |
| W07E rl2 baseline to candidate | -0.668078928% | -0.007002731% | 6/12 |
| W07E rl2 original-frame control to candidate | +0.602384383% | -0.404772091% | 4/12 |
| W07E sk125 baseline to candidate | -2.792943361% | -0.890817841% | 8/12 |
| W07E actual-flat rl2 frame inputs | -5.484395949% | See raw record | 11/12 |
| W07E diverse frame inputs | -10.414715731% | See raw record | 12/12 |

Natural rl2's W07E wall range is -15.908556% to +11.496287%; the unfavorable flat-frame pair +16.976447% is retained. Marginal duration medians and medians of paired ratios are different statistics. The published table correctly keeps them separate.

Retaining the narrow frame reuse is reasonable because the dedicated frame workloads improve, ordinary numerical equivalence has direct proof, and the longer isolated natural workload does not robustly reproduce the earlier magnitude. It is not justified by calling W07B an outlier or noise; its +9.96% observation remains in the evidence. There is no demonstrated whole-game or natural-vehicle throughput gain.

### Output-capture exclusions

W07E compares all packed-frame bytes at every tick. `writeFrame(frame, 0, 0)` supplies the same normal zero timing/dropped arguments in both variants; it does not redact mismatching bytes afterward. Enumerable exposed dynamic car/race/AI state preserves Float64 numeric encoding, typed-array bytes and graph links. Authored/static definitions and geometry are intentionally excluded; JavaScript `#private` state and contact-BVH/internal collision scratch are not a complete gameplay-state oracle. Surface/weather arrays and sparse terrain checkpoints are captured every 120 ticks and at the end, not every tick.

The three production worlds run ten simulated seconds each and the retained comparison records total **617,181,316 exact bytes**. I inspected the capture and streaming comparison code and retained results; I did not rerun those traces or claim coverage of hidden state, every possible trajectory, browser/GPU work, or physical hardware performance.

## Exact validation commands and retained evidence

Compute was granted explicitly after worker47 released it, then released immediately after the final gate. All commands below ran from `/tmp/engine-c71f32882729/repo`. The targeted proof used esbuild to load the actual TypeScript sources. No package hooks, full suite, whole-project typecheck, benchmark timing, or Git writes were invoked.

1. Actual baseline/current constructor proof before the correction — exit 0, three concrete fractional acceptance divergences; integer buffers/nodes exact:

   `node --max-old-space-size=512 /tmp/engine-c71f32882729/w08f-fractional-rows.mjs w08f-fractional-rows-before.json`

2. New regression before the correction — exit 1, 9 failed / 4 passed, 1.48 s Vitest duration:

   `NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/engine-physics-adversarial.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0 > /tmp/engine-c71f32882729/w08f-physics-before.log 2>&1`

3. Actual baseline/current constructor proof after the correction — exit 0; fractional cases rejected, integer buffers/nodes exact:

   `node --max-old-space-size=512 /tmp/engine-c71f32882729/w08f-fractional-rows.mjs w08f-fractional-rows-after.json > /tmp/engine-c71f32882729/w08f-fractional-rows-after.log`

4. Focused final gate — exit 0, 62/62 tests in 6 files, 5.57 s Vitest duration:

   `NODE_OPTIONS=--max-old-space-size=512 node node_modules/vitest/vitest.mjs run tests/engine-physics-adversarial.test.ts tests/engine-bvh-scalar-bounds.test.ts tests/engine-contact-construction.test.ts tests/engine-contact-math-allocation.test.ts tests/contact.test.ts tests/road-contact.test.ts --pool=threads --maxWorkers=1 --minWorkers=1 --allowOnly=false --retry=0 > /tmp/engine-c71f32882729/w08f-physics-final.log 2>&1`

Final counts: adversarial 13; scalar BVH 9; contact construction 8; contact math 6; contact 12; road contact 14. All 62 pass. These final files/counts were sent to worker49 for the consolidated source-freeze gate.

Scratch evidence: `w08f-fractional-rows.mjs`, `w08f-fractional-rows.entry.mjs`, before/after JSON, after proof log, before/final Vitest logs. JSON retains the exact source fingerprint manifest. The proof script can be reused on any current checkout without changing the fixed baseline.

Hashes:

- Before proof JSON: `ab0ff4e04faaeb99d3710212c34831b42b8cc31fbbab457f88e548fff7280ef0`.
- After proof JSON: `184f8cd392f36caf3d858a5a781cc34bb661d9bad21797fa43fbf2ef63fce7b8`.
- Corrected `contact.ts`: `c63bd32811c56dba4b79c79f61df0411f9fd2c3121425342f97af858b3252961`.
- New adversarial test: `1165c098e36d912a189e6ff2b7cca81fd30172c9cfb8a6a8ed2e54c6e2fd100a`.
- Retained W07A raw: `09f126d4db4a0ab40cb756cac823677619e44801f21c0ceb57527d6a05dcfcd1`.
- Retained W07B raw: `280fc20ccbe955e8c7a35db82713a61dde64e0f2b89aeef58c26d41767dccc51`.
- Retained W07E raw: `0a18dd6889752f09d3c52e5260000a32e9e7bfbee46555cbf596e5263715b8ea`.

## Changed files and protected scope

Worker48 changed only `src/simulation/contact.ts` and created `tests/engine-physics-adversarial.test.ts`. The three other owned physics files were accepted unchanged. No tuning, authored models, characters, environments, geometry definitions, bands, materials, textures, vehicle catalogue, circuits or resolution settings changed. Pending network/session/input/audio/CSV work was untouched. Root owns all staging, commits, publication and ledger changes; this worker performed no Git mutation.
