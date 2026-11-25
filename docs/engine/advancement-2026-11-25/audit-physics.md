# W01C — physics and simulation audit

Baseline: `350119e8ec0606e8c5de5b3ab80df41104025679`, checked directly in `/tmp/aeebac160835-engine/Experiment-3`. Date: 2026-11-25. Scope: read-only production review; only this report was written.

## Prioritized findings

| Priority | New engine work | Executed evidence | Files and ownership |
| --- | --- | --- | --- |
| P1 | Use the existing conservative local lane index for ordinary paved circuits | Exact nearest-query outputs on 36,936 sampled queries; 40.95–51.06% fewer candidate segment tests across four layouts | `src/simulation/track.ts` constructor; `src/simulation/track-lane-index.ts` and focused query tests |
| P1 | Prepare reusable surface-cell coefficients instead of repeating static trigonometry and water/thermal solves | Four actual rain surface updates perform 14,344 matrix evaluations, 43,032 `exp`, and 43,024 `expm1` calls; clear still performs 14,352 `sin` and 14,352 `expm1` calls | `src/simulation/track.ts` surface fields/evolution, `surface-thermal.ts`, `weather.ts`, focused numerical tests |

These are separate algorithms but both touch `track.ts`; assign their implementation sequentially or reconcile constructor/evolution ownership explicitly. No chassis, tire, vehicle, weather, road-material, geometry, or authored environment parameter needs to change. Neither finding claims a measured frame-rate improvement. No new correctness defect is claimed without a reproduction.

I reviewed `docs/engine/runtime-followup-2026-11-24/PLAN.md`, its physics review and measurement reports, and `docs/engine/continuation-2026-11-24/audits/02-physics-audit.md`. Already completed BVH build/selection/scalar bounds, contact-buffer stores, swept quaternion arc preparation, contact-frame normalization, and atomic rigid-body integration are deliberately excluded.

## 1. Generalize conservative lane candidate pruning

### Actual repeated work and callers

`Track` creates `TrackLaneIndex` for motocross/supercross and GP circuits only (`track.ts:235–239`). Ordinary paved circuits, including the default Aurel, keep `laneIndex = null`. `Track.nearest` consequently scans the entire 32 m hash bucket at `track.ts:418–465`, recomputing each segment projection, squared distance and possible layer test.

This is normal running work. `Vehicle.step` obtains four tire supports through `Track.castTire`; `TrackContactMesh.cast` classifies successful hits with `Track.sample`, which calls `nearest`. Outer mesh ownership checks also call `nearest`. `SkidContact.apply` issues four further vertical casts. Separately, `CollisionSolver.solve` projects four chassis corners for each entrant. `Simulation.step` performs two vehicle/collision substeps per 120 Hz tick. The lane index therefore benefits existing queries without changing when physics runs or which geometric surface owns a hit.

The current index already has the required conservative machinery: a witness gives an upper distance bound for a 4 m cell, segment AABB distance rejects only candidates beyond that bound, retained segment order preserves exact ties, and an unproved vertical layer falls back to the original coarse list. Four-metre cells align with the 32 m coarse grid. There is no need for approximate nearest search or a changed search radius.

### Executed read-only comparison

Direct Node v24.22.3 with `--no-warnings --experimental-transform-types --input-type=module` imported actual current sources. For each layout, I alternated the same in-memory Track between `laneIndex = null` and `new TrackLaneIndex(track.points, 2048)`. No source was replaced. The probe sampled every third centerline point at six lateral offsets and three height modes: unspecified, bank-adjusted road height plus 0.5 m, and road-center height plus 8 m. Every returned lateral and every `TrackPoint` field was compared with `Object.is`.

| Layout | Queries | Original candidate tests | Indexed candidate tests | Reduction | Layer fallbacks |
| --- | ---: | ---: | ---: | ---: | ---: |
| Aurel | 9,234 | 500,571 | 248,337 | 50.3893% | 3,078 |
| Vellamar | 9,234 | 411,774 | 205,512 | 50.0911% | 3,078 |
| Speedbowl | 9,234 | 354,996 | 209,617 | 40.9523% | 4,239 |
| Figure-eight overpass test venue | 9,234 | 677,358 | 331,520 | 51.0569% | 3,099 |

All 36,936 comparisons were exact. Every index reached the 2,048-cell limit during traversal; eviction was exercised. The elevated queries intentionally exercise conservative fallback and reduce the apparent savings. These counts cover the projection candidates, not index-build cost or overall simulation speed.

### Implementation and acceptance

Enable a bounded instance index for the remaining normal `Track` paths. Keep the existing off-road handling and current candidate filter unchanged initially. Preserve full-list behavior outside the coarse hash and every layered/banked-road fallback. Cache records depend on the static points/coarse membership; invalidate if any supported geometry-mutation API changes those inputs. Do not cache weather or query output in this index.

Extend exact comparisons to 4 m and 32 m boundaries (including negative coordinates), lap seam, equal-distance segments, overpasses with no eligible layer, large offsets, reversed layouts and evictions/revisits. Keep `tests/motocross-lane-index.test.ts` and existing GP/layer tests as regression gates. Compare complete packed frames plus Float64 vehicle/race state on unchanged production Aurel and Speedbowl workloads; the query probe is not a complete driving trace.

Measure separate cold/warm query phases and a 12-entrant production `Simulation.step` trace, with identical inputs and a frozen original constructor path. Retain candidate counts, index-build counts, cache occupancy/memory, worker CPU and wall time. A 2,048-cell cache is bounded but introduces memory and key/build work; demonstrate that the reduced scans repay those costs. Do not infer timing from the operation reductions above.

## 2. Reuse exact surface-cell coefficients

### Actual repeated work and callers

`Simulation.step` calls `Track.evolve`; its fixed surface cadence remains 0.5 s. At every surface tick, the 512 × 7 loop evaluates `0.65 + 0.35 * Math.sin(r * 0.113 + c * 0.4) ** 2` again, although row and column never change (`track.ts:681–690`). `SurfaceThermalStep.advanceWet` calls `advanceWater` for each cell. That function recomputes `-Math.expm1(-drainage * dt)` for a fixed surface timestep and an ordinarily unchanged cell drainage value (`weather.ts:750–768`).

Wet thermal work is larger. `SurfaceThermalStep.prepare` invalidates its last-rainfall matrix every surface tick (`surface-thermal.ts:156–158`). Its `advanceWet` then requests one matrix per cell. Depressions give cells different incoming rainfall, so the single-entry cache misses at almost every cell. The same constant-rain field repeats those exact matrices at the next tick. Each normal matrix evaluation contains two exponentials and two exponential integrals, in addition to scalar arithmetic (`surface-thermal.ts:162–193`). `weatherKeyframes('rain')` is an actual constant production preset; storm gusts are a necessary invalidation case, not a reason to approximate the matrix.

### Executed operation probe

For each preset, I created an unchanged production Track, wrapped `SurfaceThermalStep.prototype.prepareMatrix` to count real evaluations, wrapped four Math functions, called `track.evolve(0.5, time)` four times, and restored all wrappers. Track construction was excluded. There were 3,584 cells and four surface updates in every row.

| Preset | Matrix evaluations | `sin` | `exp` | `expm1` | `log1p` |
| --- | ---: | ---: | ---: | ---: | ---: |
| Clear | 8 | 14,352 | 14,360 | 14,352 | 14,336 |
| Rain | 14,344 | 14,352 | 43,032 | 43,024 | 0 |
| Storm | 14,344 | 14,384 | 43,040 | 43,024 | 0 |

Counts include weather and thermal preparation within `evolve`. Each four-update run has exactly 14,336 cell-depression evaluations and 14,336 water-gain evaluations. The remaining calls belong to unchanged weather/thermal work. The clear matrix count is already small; the constant-rain matrix count is the distinct reuse opportunity. This is an operation audit, not a timing benchmark.

### Implementation and exact invalidation

1. Prepare the unchanged depression expression into Float64 storage once for the grid. Preserve the original expression order and precision; a Float32 cache would change rainfall, freezing and rubber evolution.
2. Prepare each water gain using the original `-expm1(-k * dt)` expression. Retain the original update `water * (1 - gain) + (source * gain) / k`; replacing division with a reciprocal multiplication can change rounding. Cache keys must include both `dt` and the actual drainage value, because `Track.drainage` is an exposed mutable array. Preserve the tiny-drainage branch and all validation.
3. Provide bounded reusable thermal coefficient records for individual cells or rainfall slots, retaining the original six Float64 coefficients. Reuse only when matrix inputs match: timestep, effective air transfer, actual rainfall, and relevant capacities/conductances. Refresh ambient, solar, vapor and evaporation inputs normally even when the matrix is reused. Changed wind/gusts, rainfall, phase split, fog moisture, exposure, or thermal parameters must not reuse an incompatible record. Keep `advance()` tied to `prepare()`'s rainfall after intervening `advanceWet()` calls.

Six Float64 coefficients per 3,584 cells require 172,032 bytes before keys and metadata. Record this tradeoff and bound storage; do not grow a global Map for every storm rainfall value. A changing storm may still require every matrix calculation. Static depression/water-gain reuse remains useful in that case. Coefficient preparation must not change the cell update order, fixed-tick clock, rain/water/latent-heat equations, phase transitions or half-second update cadence.

Acceptance should compare every Float32 surface array byte and Float64 heat accumulator/thermal output against actual original code across clear, constant rain, changing rain, storm, snow, roofed rows, dry-out and wet transitions, traffic heat, mutated drainage, varying step inputs and batched delayed calls. Include degenerate/insulated thermal matrices and invalid input rejection using existing thermal/weather tests. No state-dependent saturation-vapor `exp` or drying `log1p` can be dropped merely because other cells share weather.

After the first unchanged constant-rain surface tick, matrix reuse should eliminate nearly all subsequent per-cell matrix preparations; static water gains and depressions should eliminate their 3,584 repeated transcendental calls per surface tick after preparation. Measure those exact counts, cache bytes, and full `Track.evolve` cost separately. Then measure unchanged production simulation runs. No full-world throughput improvement has been established here.

## Reproduction snippets

Run from the repository with `node --no-warnings --experimental-transform-types --input-type=module` and supply each block on stdin. These are the substantive probe bodies, retained here to avoid extra files.

```js
import { Track, trackPoint, ROUTE_LAYER_GAP } from './src/simulation/track.ts';
import { TrackLaneIndex } from './src/simulation/track-lane-index.ts';
import { circuitDefinition } from './src/simulation/circuits.ts';
import { FIGURE_EIGHT_OVERPASS } from './src/simulation/test-venues.ts';
for (const id of ['aurel', 'vellamar', 'speedbowl', 'figure-eight']) {
  const track = new Track('clear', false, undefined,
    id === 'figure-eight' ? FIGURE_EIGHT_OVERPASS : circuitDefinition(id));
  const index = new TrackLaneIndex(track.points, 2048), a = trackPoint(), b = trackPoint();
  let queries = 0, coarseWork = 0, candidateWork = 0, fallback = 0;
  for (let i = 0; i < track.points.length; i += 3) {
    const p = track.points[i];
    for (const lateral of [-24, -p.width, -0.00001, 0, p.width, 24])
      for (const height of [undefined, p.y + p.bank * lateral + 0.5, p.y + 8]) {
        const x = p.x + p.nx * lateral, z = p.z + p.nz * lateral;
        track.laneIndex = null;
        const base = track.nearest(x, z, a, height);
        track.laneIndex = index;
        const next = track.nearest(x, z, b, height);
        if (!Object.is(base, next) || Object.keys(a).some(k => !Object.is(a[k], b[k])))
          throw new Error(JSON.stringify({ id, i, lateral, height, a, b }));
        const coarse = track.hash.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`);
        if (coarse) {
          const local = index.candidates(x, z, coarse, height, ROUTE_LAYER_GAP);
          coarseWork += coarse.length; candidateWork += local.length;
          if (local === coarse) fallback++;
        }
        queries++;
      }
  }
  console.log({ id, queries, coarseWork, candidateWork, fallback, exact: true });
}
```

```js
import { Track } from './src/simulation/track.ts';
import { SurfaceThermalStep } from './src/simulation/surface-thermal.ts';
for (const preset of ['clear', 'rain', 'storm']) {
  const track = new Track(preset), old = SurfaceThermalStep.prototype.prepareMatrix;
  let matrixEvaluations = 0;
  SurfaceThermalStep.prototype.prepareMatrix = function(rainfall) {
    if (rainfall !== this.matrixRainfall) matrixEvaluations++;
    return old.call(this, rainfall);
  };
  const names = ['sin', 'exp', 'expm1', 'log1p'];
  const saved = Object.fromEntries(names.map(name => [name, Math[name]]));
  const counts = Object.fromEntries(names.map(name => [name, 0]));
  for (const name of names) Math[name] = (...args) => {
    counts[name]++; return saved[name](...args);
  };
  try { for (let tick = 0; tick < 4; tick++) track.evolve(0.5, (tick + 1) * 0.5); }
  finally {
    for (const name of names) Math[name] = saved[name];
    SurfaceThermalStep.prototype.prepareMatrix = old;
  }
  console.log({ preset, matrixEvaluations, counts });
}
```

## Verification limits

Only the source audit and the small direct Node probes above ran. No implementation, unit suite, build, browser run, complete driving trace, isolated timing benchmark, dependency edit, git mutation, or asset-generation hook was performed by this worker. Existing baseline test results belong to the coordinator. Protected authored content was read only and is outside both proposed implementation scopes.
