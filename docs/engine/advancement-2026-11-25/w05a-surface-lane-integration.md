# W05A — surface coefficients and lane ownership in Track lifetimes

Assignment 25, wave 5. Reviewed the W02A paved lane index and W02E surface
coefficient reuse together in the current implementation. Original baseline:
`350119e8ec0606e8c5de5b3ab80df41104025679`, available read-only at
`/dev/shm/aeebac160835-engine-baseline`.

**No composition defect was found. No production source was changed.** The
new file `tests/engine-surface-lane-integration.test.ts` adds three focused
regressions for reachable lifecycle behavior that the standalone index and
coefficient tests did not directly establish. This assignment changes only
that test and this report.

## Existing coverage and the remaining gap

The W02A report and `engine-paved-lane-index.test.ts` already cover exact
coarse-search equivalence, banking and overpass fallbacks, signed cell
boundaries, ties, the 2,048-cell eviction boundary, and constructor selection
for off-road venues. Repeating the broad query sweep would add little here.

The W02E report and `engine-surface-coefficients.test.ts` already cover
cached/fresh column equality, changing drainage and solver timesteps,
changing weather and parameter signatures, prepared rainfall restoration,
fixed storage, and actual Track operation removal. Its separate original
source probe establishes arithmetic equivalence against the original surface
implementation; that large probe was not repeated by this assignment.

Other relevant existing contracts are in `surface-thermal.test.ts`,
`weather-snow.test.ts`, `weather-states.test.ts`, `terrain.test.ts`,
`motocross-lane-index.test.ts`, `motocross-arena-weather.test.ts`, and
`flashback-determinism.test.ts`. In particular, the existing long flashback
test compares packed frames. A packed frame alone does not expose every
surface cell or the substrate temperature history.

The additional questions were whether warm spatial candidates still select
the evolving climate cell, whether different Track instances can contaminate
one another, whether a fresh rewind world reproduces surface history between
surface ticks, and whether terrain restore/reset remains authoritative after
the coefficient banks have warmed.

## Source findings

### Owners and invalidation

| State | Owner and relevant lifetime | Why composition remains valid |
| --- | --- | --- |
| Paved lane candidates | One `TrackLaneIndex` per Track; lazily created four-metre cells, capped at 2,048 | Inputs are the sampled ribbon and coarse bucket. Weather, water, rubber, frost, and thermal history do not enter candidate construction. Surface classification reads the selected cell after `nearest()` completes. |
| Depression factors | One private, fixed Float64 grid per Track | The expression depends only on the row and column. The grid contains neither current weather nor terrain displacement. |
| Water coefficients | One fixed bank per Track, shared by that Track's exposed and covered solvers | Every use compares the actual mutable drainage value; a changed solver timestep clears the drainage keys. Rainfall, evaporation, and existing water remain live inputs. |
| Exposed thermal matrices | One fixed bank per Track's exposed solver | The matrix signature includes timestep, effective air transfer, capacities, conduction, and deep conductance. Each cell's actual incoming rainfall keys its slot. Ambient, sunlight, vapour, and heat are still refreshed or supplied normally. |
| Covered thermal solution | A separate solver per Track, with no per-cell matrix records | `sheltered[row]` is read for each cell on every surface tick, so an exposure edit selects the appropriate solver immediately. The water bank still checks drainage for either exposure. |
| Traffic heat | Private Float64 accumulator per Track | `interact()` writes the contacted climate cell. The next fixed surface tick consumes and clears it once. Candidate reuse does not retain a prior surface sample. |

`Track.evolve(dt, time)` always prepares and integrates 0.5-second surface
steps. Changing caller `dt` changes the number of steps and retained
remainder, not the coefficient-bank timestep. Delayed calls still visit the
same weather endpoints. Variable *solver* timesteps are a separate public
`SurfaceThermalStep`/`WaterStepCoefficients` contract covered by the existing
coefficient tests.

Fog modifies the ground cloud and incoming moisture; snow modifies the
liquid/snow split and then runs the existing phase settlement. Both feed the
same live coefficient inputs. Dry-out still uses the evaporation event
calculation. None of those operations changes the static lane candidates.

### Reset, restore, and other worlds

`Simulation` creates a Track in its constructor. Worker `init` and
`Resimulation` construct a new Simulation, so their lane and coefficient
stores belong to the new world. Flashback recreates history from the input
journal; it does not copy coefficient arrays or rewind an existing Track in
place. There is no supported pavement-grid checkpoint/restore API to audit.
Passing an earlier weather time to `evolve()` is not a pavement-state restore.

Terrain has a different contract. `TerrainTile.restore()` restores sparse
rut depth and compaction; `CourseTerrain.reset()` also clears terrain wetness
and its changed-cell set. Those methods do not overwrite Track water or
temperature grids. A warm lane index only resolves station/lateral position;
`TrackTerrainSurface.sample()` still reads the current deformable terrain.

Rallycross/rally-stage retain a null lane index. MX/SX retain their existing
uncapped index configuration; the new 2,048-cell policy is specifically for
paved Tracks. Off-road height queries continue to ignore road-layer rejection
for airborne riders. Indoor venues still suppress outside precipitation and
wind before the thermal solver receives weather.

`OpenWorldTrack` is an adapter, not a Track subclass. It retains its own
single climate column and its existing terrain/network queries. It does not
instantiate either the paved candidate index or the new Track-sized banks.
Festival vehicle reset keeps that world and replaces/repositions the vehicle;
it does not require invalidating a paved Track cache.

## New regression evidence

### 1. Interleaved evolving Tracks against uncached paths

Two actual Tracks run interleaved: the existing figure-eight overpass under
rain/fog/clear/rain transitions, and the existing banked Speedbowl under
snow/thaw conditions. Their reference counterparts execute the production
coarse `nearest()` path with the instance index disabled, and execute the
production thermal solver with the optional per-cell matrix and water banks
omitted. The temporary solver wrapper is restored immediately after each
synchronous reference `evolve()` call; equations are not copied into the
test.

The short sequence contains fragmented and delayed caller timesteps,
covered-to-exposed changes, drainage changes through zero and a tiny value,
and tire interaction on the actual selected cells. Two queries at the exact
same `(x,z)` use different overpass heights, sharing one horizontal candidate
cell while selecting different climate-grid rows. Other queries reach the
road, kerb, runoff, and the outside-hash fallback.

The test compares every returned SurfaceSample field, all eight surface and
configuration grids, weather scalars, and the surface-clock remainder after
each call. It also checks that evolving one world leaves the other world's
state unchanged and that the warmed candidate records remain the same
objects across weather changes.

A thin warm film is explicitly seeded to reach evaporation dry-out in a
short run; the assertion confirms it remains positive after tire clearing
and reaches zero during evolution. A warm snow-covered cell is seeded to
reach an actual melt event, with less frozen cover and more liquid water.
These are fixture states, not changes to authored thermal or handling values.

### 2. Actual wet Simulation rewind between surface ticks

A one-car wet practice session runs to tick 145, with real positive tire work
observed after tick 120 and before the checkpoint. At this point the Track
has warmed its coefficient banks and retains a positive fraction of the
half-second surface interval. The live world continues to tick 205.

`Resimulation` creates a distinct Track and distinct lane index. Its initial
surface state matches the live world's captured initial state. Replaying in
37-tick slices reconstructs all surface grids, weather, clock, and packed
frame at tick 145. Resuming across the next surface update reproduces the
same grids and frame at tick 205, while leaving the retained live world
unchanged. The continuation makes pending traffic heat consequential without
introducing a production accessor for private state.

### 3. Warm off-road Track through terrain restore/reset

An actual rainy Valley Ridge MX Track first warms its coefficient banks.
The test creates a rut under a sampled airborne-height query and confirms
that the contact height falls while the climate-cell identity stays the
same. Further surface evolution preserves that rut geometry. Restoring a
terrain checkpoint, then independently deforming and resetting the terrain,
restores the original contact height while leaving Track climate grids
unchanged. Sampled water and temperature still come from the current grid.

## Verification executed

Direct invocation, one worker, no npm hooks:

```sh
node node_modules/vitest/vitest.mjs run tests/engine-surface-lane-integration.test.ts tests/surface-thermal.test.ts tests/terrain.test.ts --maxWorkers=1
node node_modules/eslint/bin/eslint.js tests/engine-surface-lane-integration.test.ts
node node_modules/prettier/bin/prettier.cjs --check tests/engine-surface-lane-integration.test.ts
```

**22/22 tests passed across three files:** three new integration tests,
15 existing thermal tests, and four existing terrain tests. Scoped ESLint
and the formatting check passed. The existing thermal suite also exercises
the Festival climate-column path and exact scheduling equivalence.

Direct byte comparisons against the read-only original worktree found these
files unchanged: `track-lane-index.ts`, `surface-drainage.ts`, `terrain.ts`,
`offroad/course-terrain.ts`, `test-venues.ts`, `tyre-thermal.ts`, and
`open-world/open-world-track.ts`, all under `src/simulation/`. No authored
track definitions, terrain rules, tire-heat tuning, assets, or models were
edited by this assignment. No Git command, full typecheck, build, browser
run, or benchmark was executed.

## Bounds and limits

The additional fixed surface storage remains 80 bytes per cell across the
depression grid, water keys/gains, and exposed thermal keys/six coefficients:
3,584 cells × 80 = **286,720 bytes per Track**, excluding object/array headers
and scalar keys. This follows the actual fixed array allocation shapes and
agrees with W02E; it is not a heap measurement. Paved lane records remain
capped at 2,048, with their candidate arrays bounded by the static coarse
buckets. The existing eviction tests establish the full cap/rebuild behavior;
the new tests do not repeat that sweep.

The new uncached reference deliberately shares the current depression grid,
station interpolation, and surface equations. It isolates composition of
candidate and coefficient reuse; it is not a complete current-versus-original
Simulation oracle. The rewind test compares exposed grid state and packed
frames and observes the effect of pending heat on continuation; it does not
claim a direct bitwise comparison of every private Float64 accumulator.

Whole-simulation original-baseline equivalence, cold/warm timing, heap
measurement, and the combined multi-entrant benchmark remain with their
coordinated measurement assignment. There are no performance or throughput
claims from this work. Arbitrary mutation of public ribbon point objects
would invalidate spatial caches, but no supported geometry-mutation API or
new geometry-mutation path was found in the reviewed lifecycle.
