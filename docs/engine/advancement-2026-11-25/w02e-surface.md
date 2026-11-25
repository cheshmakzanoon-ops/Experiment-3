# W02E — exact reusable surface coefficients

Baseline: `350119e8ec0606e8c5de5b3ab80df41104025679`. Implements scope 2 of `audit-physics.md`; the W02A paved-lane constructor change remains intact.

## Implementation and bounds

- `Track` evaluates the original depression expression once into a private Float64 grid. Cell order, half-second cadence, weather sampling, phase changes, traffic heat, and all authored values remain unchanged.
- `WaterStepCoefficients` holds fixed Float64 drainage/gain slots. A changed timestep invalidates all slots; every use compares the actual mutable drainage value. `advanceWater` retains its validation, tiny-drainage branch, `-expm1(-k * dt)` gain and original multiplication/division order.
- The exposed `SurfaceThermalStep` retains six Float64 coefficients plus a rainfall key per cell. Timestep, effective air transfer, surface/substrate capacities, conduction and deep conductance invalidate the bank. Actual per-cell rainfall selects/replaces each slot. Separate covered/exposed solvers handle exposure changes; covered cells need only the existing scalar zero-rain matrix. Ambient, solar, vapour and evaporation inputs still refresh normally, and `advance()` restores the prepared rainfall after any cell override.
- Signature refresh occurs in `prepare()` and on changed-rainfall matrix requests. The existing single rainfall-equality return remains first, including clear and covered cells. No rainfall Map or growing history exists.

Added array storage is fixed at **286,720 bytes (280 KiB) per Track**: depression 28,672; drainage/gain keys 57,344; thermal rainfall keys 28,672; six thermal coefficients 172,032. Array/object headers and scalar keys are additional. The covered solver allocates no per-cell thermal records.

## Exact original-source comparison

Executed Node directly with TypeScript transformation, loading the three original modules using `git show` and the working modules from disk. Only import paths and a read-only heat-array accessor were adapted for the comparison. Equations were not copied into an approximate reference implementation.

Nine scenarios covered clear, rain, storm, snow, fog, dust, wet/dry/wet transitions, snow/thaw and complete dry-out. Each used fragmented and delayed calls, roofed rows and exposure edits, mutated drainage (including zero/tiny values), and repeated traffic interactions. Across 99 surface ticks, **1,419,264 raw Float64 thermal values matched exactly**. All checked surface-array bytes, weather scalars, clocks and Float64 heat accumulators matched; 31,173,120 total bytes were compared, including 4,386,816 heat-array bytes. Separately, 189 original/cached columns covered mutable thermal parameters, varying timesteps, insulated/degenerate matrices and prepared-rain restoration; 945 water cases matched exactly.

The executed comparison script remains at `/tmp/aeebac160835-surface-coefficients-probe.mjs` for the coordinator's follow-up. Run with `node --no-warnings --experimental-transform-types`.

## Work counts and validation

Actual four-tick `Track.evolve` probes, excluding construction:

| Preset | sin, original → cached | exp, original → cached | expm1, original → cached |
| --- | ---: | ---: | ---: |
| Clear | 14,352 → 16 | 14,360 → 14,348 | 14,352 → 3,588 |
| Rain | 14,352 → 16 | 43,032 → 21,522 | 43,024 → 10,762 |
| Storm | 14,384 → 48 | 43,040 → 43,034 | 43,024 → 32,266 |

Dry-out `log1p` calls remain unchanged. After the first constant-rain tick, each further tick uses two `expm1` calls for the undepressed prepared-rain matrix, with no per-cell water-gain or thermal recomputation. Storms still rebuild matrices as their inputs change.

Direct one-worker Vitest passed the 7 new coefficient tests and 107 existing thermal/weather/snow tests. ESLint passed all owned code/test files, and `git diff --check` passed. The new tests cover exact cached/fresh columns, forcing/parameter changes, storage bounds, generic validation, prepared-rain semantics, and actual per-cell operation removal with drainage/exposure edits. Full-project TypeScript passed with `node --max-old-space-size=4096 node_modules/typescript/bin/tsc --noEmit --pretty false`; the first attempt exceeded Node's default 2 GiB heap.

Wave 7 retains full simulation/clear-weather timing, cold/warm cost and heap review. Operation counts establish removed work, not a measured throughput improvement. No dependencies, asset hooks, tuning or authored assets changed.
