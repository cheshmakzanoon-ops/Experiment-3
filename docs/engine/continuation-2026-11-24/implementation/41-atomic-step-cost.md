# Agent 41 — reduce atomic rigid-step staging cost

Wave 7, agent 41 of the requested 60. The optimization and verification are complete; file ownership is released for coordinator integration.

## Result

The integrator now stages translation and derived acceleration in scalar locals, removing five private Vec3 objects and redundant vector copies while retaining the atomic commit. The direct comparison against the preceding atomic implementation measured **16.32–22.88% lower median integration-driver time** across the eight workloads. All complete Float64 states, inputs and final checksums matched.

The improvement is relative to the earlier atomic implementation. A separate comparison against the original pre-continuation solver produced mixed timing changes, **−20.22% to +12.57%**, with overlapping and noisy ranges. This does **not** establish that atomic recovery is universally free or that complete vehicle simulation or FPS improves by the isolated percentages. Both complete experiments, including unfavorable samples, are retained.

The change is kept because it removes deterministic redundant memory traffic and fixed scratch objects, preserves the existing success/failure contracts, and improves all eight direct pre-optimization medians. No further timing run was selected to make the result look more favorable.

## Implementation and preserved contracts

Only `src/simulation/rigid.ts` changes production behavior. Four candidate vectors are replaced by locals: next position, velocity, linear acceleration and angular acceleration. The old-omega copy is also unnecessary because public angular velocity remains unmodified until the validated commit. Candidate angular velocity and quaternion still use their existing private scratch objects.

Translation retains reciprocal multiplication, acceleration-before-velocity and velocity-before-position order. Angular acceleration retains subtraction followed by multiplication by the timestep reciprocal. All scalar candidates are computed before any public commit. The public vector and quaternion objects, commit order and failure messages are unchanged.

The former Vec3.finite checks use finite **component sums**. The scalar implementation deliberately retains those same sum expressions, including their conservative overflow rejection; it does not silently substitute weaker or differently grouped component checks. Initial validation, quaternion validation, both rotor endpoints, analytic Jacobian, twelve Newton corrections, terminal residual check, tolerance, kicks and orientation integration are unchanged.

Each body now retains **14 vectors and two quaternions**, compared with **19 vectors and two quaternions** in the preceding atomic implementation. The original pre-continuation body retained 14 vectors and one quaternion. This is a fixed object-count reduction, not a measured transient heap-allocation rate or byte saving.

## Exactness and rejection recovery

The existing portable `scripts/rigid-step-benchmark.mjs` was used unchanged. Each experiment compares 32 continuous 4,096-step trajectories: four variants for APX-01, TC-1, GP-R1 and MX-450 at 120 and 240 Hz. The inputs come from unchanged catalogue masses/inertias plus deterministic force, torque and absent/constant/changing rotor plans.

For each comparison, **131,072 native Float64 states**, or **3,801,088 scalar values**, match byte for byte after every step. The source proof confirms that all trajectory and input hashes also equal agent 34's original-versus-atomic experiment. Thus the same trajectory positions agree across the original, preceding atomic and optimized implementations. The two pairwise experiments do not represent twice as many distinct trajectory positions.

Each experiment also passes the existing **768 rejected-call and 384 corrected-retry checks**, preserving all public state and owned object identities after invalid position, singular midpoint and translation-overflow failures. Only public state is restored before the successful retry, leaving dirty private scratch in place. These repeated failure fixtures are separate from normal timings and are not presented as ordinary gameplay.

Added `tests/rigid-staging-cost.test.ts` contains six cases: four candidate-sum overflow/recovery cases (position, velocity, linear acceleration and angular acceleration) and positive/negative translation-zero preservation. The overflow inputs pass initial validation; they retain the previous sum-overflow rejection and prove that repeated failure does not partially publish state. Corrected retries match a fresh body byte for byte and retain public identities.

The final combined focused run passed **57/57 cases in four suites**: 29 atomic-step, 10 final-correction, 12 wheel-momentum and six new staging cases. The original arithmetic reference inside the existing atomic suite remains unchanged.

## Direct comparison: preceding atomic implementation

Five fresh sequential workers per source version; each workload warms up for 65,536 steps and times 262,144 steps. Source order alternates and workload order rotates. The timing driver includes input application, periodic public-state reset, integration and checksum; it excludes imports, plan construction, binary comparison, hashing and identity checks. All workers used the shared test lock and a 512 MiB old-space bound.

Milliseconds below are median (minimum–maximum). These are designed integrator workloads, not full suspension/tyre/world or rendering measurements.

| Profile | Hz | Pre-optimization atomic | Optimized atomic | Median change |
|---|---:|---:|---:|---:|
| apx01 | 120 | 288.78 (280.08–300.22) | 241.65 (225.74–245.11) | -16.32% |
| apx01 | 240 | 285.82 (283.93–429.66) | 229.99 (213.06–254.46) | -19.53% |
| tc1 | 120 | 301.30 (276.66–423.81) | 232.36 (208.37–252.01) | -22.88% |
| tc1 | 240 | 289.36 (268.19–299.39) | 227.77 (212.83–243.85) | -21.28% |
| gpr1 | 120 | 298.17 (273.62–362.73) | 234.48 (230.57–269.35) | -21.36% |
| gpr1 | 240 | 280.81 (277.24–306.73) | 227.93 (219.70–232.99) | -18.83% |
| mx450 | 120 | 277.81 (275.18–327.03) | 229.24 (217.90–369.86) | -17.48% |
| mx450 | 240 | 286.43 (278.36–310.44) | 223.72 (222.98–239.13) | -21.90% |

All raw samples are in `41-atomic-vs-scalars.json`. The candidate MX-450/120 sample at 369.86 ms is retained, as are the high pre-optimization APX-01/240 and TC-1/120 samples. Seven workload ranges do not overlap; the MX-450/120 ranges overlap because of its candidate outlier. Five samples on a shared virtualized host do not establish a universal hardware confidence interval.

## Separate comparison: original solver

The second experiment used the original `5edead7a44c8ccb5a187b22b750ce2bda7715128` checkout as baseline, with the same driver and sampling method. It independently confirms original successful trajectories and gives a contemporaneous original-solver comparison rather than combining timings from different runs.

| Profile | Hz | Original median, ms | Optimized atomic median, ms | Median change |
|---|---:|---:|---:|---:|
| apx01 | 120 | 250.02 | 275.68 | +10.26% |
| apx01 | 240 | 254.28 | 262.13 | +3.09% |
| tc1 | 120 | 262.21 | 247.33 | -5.68% |
| tc1 | 240 | 253.81 | 285.70 | +12.57% |
| gpr1 | 120 | 257.47 | 230.54 | -10.46% |
| gpr1 | 240 | 266.73 | 268.58 | +0.70% |
| mx450 | 120 | 295.22 | 235.54 | -20.22% |
| mx450 | 240 | 267.93 | 232.54 | -13.21% |

Full minimum/maximum values and individual samples are in `41-original-vs-scalars.json`. The distributions overlap and the candidate itself varies between the two experiments. No original-solver speedup is claimed across all workloads; in particular, APX-01/120 and TC-1/240 medians remain slower in this run. The practical claim is reduced measured cost against the prior atomic implementation while preserving its correctness guarantees.

Environment for both experiments: Node v24.22.3, Linux 6.18.57, x64, AMD EPYC 9V74 80-Core Processor, nine visible logical CPUs. Each worker loads one implementation. No physical hardware GPU, browser runtime or complete game-frame timing was measured here.

## Frozen source and provenance

Before editing, the atomic source and its imports were copied into an independent scratch reference with local Git metadata needed by the existing benchmark. Its parent repository HEAD was `676d4c8531695638537bf62af5a74ca8edbe41ef`; the original source reference remained untouched. The local scratch reference commit is recorded in `41-frozen-atomic-reference.json` and is not a remote project commit.

| Item | SHA-256 |
|---|---|
| Original rigid.ts | `08c32ae36662f45d25c6ef5acf15f01dc5332463973ccaa3b1959bba6e10d61b` |
| Pre-optimization atomic rigid.ts | `eb0caeec3e61745282a3b1fbde6950f7fa64fcfe8ea0072626fdeb95ab41324a` |
| Optimized rigid.ts | `62c60ad13231d08437088a12df59dcc233f645f0176e57070f155ae15c99f7b7` |
| Unchanged benchmark script | `f7e6ed21a565907060844c595f47eb5ef3f76d247561bc31de8676c5a0215d09` |
| New staging test | `87a963c5b8da9600c01ca46e436bf31a8efff63b9586d82c5dc3634386bf2546` |

Both benchmark files fingerprint the same final optimized source. All 21 measured source dependencies were checked before and after; only rigid.ts differed. The cross-experiment hash equality and current file identities are also recorded in `41-source-and-comparison-proof.json`. Subsequent unrelated root commits do not change that source identity.

## Executed checks and reproduction

```sh
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 \
  node --experimental-transform-types scripts/rigid-step-benchmark.mjs \
  --baseline /engine-work-4e0075ccccb3/a41-atomic-reference \
  --candidate /engine-work-4e0075ccccb3/repo \
  --output /engine-work-4e0075ccccb3/reports/41-atomic-vs-scalars.json

flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 \
  node --experimental-transform-types scripts/rigid-step-benchmark.mjs \
  --baseline /engine-work-4e0075ccccb3/reference \
  --candidate /engine-work-4e0075ccccb3/repo \
  --output /engine-work-4e0075ccccb3/reports/41-original-vs-scalars.json
```

For another checkout, provide a baseline at `676d4c8` for the preceding atomic source, or `5edead7` for the original source, and a candidate containing this implementation. All paths are CLI arguments; the benchmark was not modified for this experiment.

Final focused command:

```sh
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 \
  node node_modules/vitest/vitest.mjs run \
  tests/rigid-staging-cost.test.ts tests/rigid-atomic-step.test.ts \
  tests/rigid-final-correction.test.ts tests/wheel-momentum.test.ts --maxWorkers=1
```

Scoped ESLint, strict TypeScript compilation of the source/test and imported helpers, Prettier checking and whitespace validation passed. The final combined test output is in `41-final-checks.log`. Full-project compilation and later whole-simulation integration remain the coordinator's gates.

No catalogue, track, tuning, model, character, environment, material, asset or dependency changed. No repository staging, commit or push was performed. Only the production integrator and the new six-case test await root staging.
