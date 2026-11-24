# Agent 34 — rigid integration cost and exactness

Wave 6, agent 34 of the requested 60. The measurement is complete. No production source was changed.

## Result and decision

The atomic rigid-body implementation preserves the original successful numerical trajectory in **131,072 step comparisons**, including all **3,801,088 recorded scalar values**, while reliably recovering from failed steps. It has a measurable runtime cost: the eight integration-driver medians are **1.67–32.86% slower** than the original, adding approximately **19–303 nanoseconds per step** in this environment.

This is an explicit correctness/performance tradeoff. It must not be described as an integration-speed improvement. The experiment does not measure complete vehicle dynamics, collision work, simulation frame time, rendering, or FPS. No rollback checks, solver tolerance, arithmetic order, or authored tuning were removed to improve the number. Root has the result for any separately justified later optimization.

The new portable script is `scripts/rigid-step-benchmark.mjs`. Raw distributions, source fingerprints, input hashes and trajectory hashes are retained in `34-rigid-step-benchmark.json`.

## Workloads and scope

The script imports the actual original and candidate `RigidBody` and math modules using Node's TypeScript transform support. It obtains mass, inertia, wheel radius and wheel inertia from each checkout's unchanged vehicle catalogue and verifies that those inputs agree exactly. It does not substitute a copied solver or edit the catalogue.

| Vehicle ID | Catalogue dry mass, kg | Diagonal inertia | Initial forward speed, m/s |
| --- | ---: | --- | ---: |
| apx01 | 770 | [510, 1220, 1080] | 65 |
| tc1 | 1265 | [560, 2150, 1950] | 45 |
| gpr1 | 229 | [62, 55, 24] | 60 |
| mx450 | 179 | [60, 52, 22] | 25 |

Each profile runs at both 120 and 240 Hz. These are designed rigid-body workloads: smooth, precomputed net force/torque inputs and rotor endpoints exercise the integrator without importing the full suspension, tyre or world simulation. Wheel angular momentum supplies the rotor scale. Catalogue dry mass is deliberately used as a reproducible input; it is not a claim about every race session's changing fuel/damage mass. No extreme final-correction fixture is included in the normal timing population.

## Exact successful-state validation

For each of the eight profile/rate pairs, four independent 4,096-step trajectories vary initial pose and angular velocity and cover absent, constant and changing rotor momentum. The longer trajectories do not reset the body between steps. After every step, reusable native Float64 buffers hold all eight public vectors, the quaternion and mass: 29 scalars per state. `Buffer.equals` checks every byte, including signed zero, before a SHA-256 trace is accumulated. This is direct binary equality, not only a rounded JSON or final-state comparison.

All 32 trajectories passed: **131,072 exact comparisons**. Existing owned vectors and quaternions retain their object identities throughout. Every timed sample also agrees on its input hash, final binary state hash and exact accumulated checksum across both source versions and all repetitions.

The final-residual change is exercised by existing agent-18 regression coverage, which is not rerun or added to this comparison count. Here the original solver succeeds throughout; these ordinary workloads therefore do not rely on the newly accepted twelfth-correction stress case. This measurement assesses the combined current implementation's normal cost and does not separately attribute code-generation effects between staging and the terminal branch.

## Timing method and results

Five fresh sequential workers per checkout each measure all eight workloads. Baseline/candidate launch order alternates across repetitions, and workload order rotates inside each worker. Every workload performs **65,536 warmup steps**, invokes explicit GC outside the timer, then measures **262,144 steps**. Bodies are reset every 1,024 timed steps to repeat a bounded physical range; all inputs were precomputed before the timer.

The timer includes input application, the rare public-state reset, actual `integrate` calls and a scalar checksum. It excludes imports, input construction, binary comparisons, hashing and identity checks. The driver is the same for both versions. These are integration-driver measurements rather than a claimed isolated CPU instruction cost. The common reset includes ordinary benchmark scaffolding; the report makes no allocation-free claim for that scaffolding.

There are **10,485,760 measured integration calls per source version**, or 20,971,520 across both versions. All ten workers ran under the shared test lock with a 512 MiB old-space limit.

Milliseconds below are median (minimum–maximum) for 262,144 steps; each distribution has five samples.

| Profile | Hz | Original, ms | Candidate, ms | Median change | Added ns/step |
| --- | ---: | ---: | ---: | ---: | ---: |
| apx01 | 120 | 257.15 (245.54–312.98) | 302.23 (283.08–333.86) | +17.53% | +171.97 |
| apx01 | 240 | 246.51 (231.04–283.00) | 318.43 (286.67–356.69) | +29.18% | +274.35 |
| tc1 | 120 | 241.34 (230.31–284.30) | 320.65 (314.60–478.02) | +32.86% | +302.55 |
| tc1 | 240 | 293.30 (247.76–315.55) | 298.21 (286.60–302.21) | +1.67% | +18.72 |
| gpr1 | 120 | 259.71 (235.96–271.46) | 319.54 (308.81–399.85) | +23.04% | +228.23 |
| gpr1 | 240 | 257.44 (223.76–365.89) | 287.04 (284.47–438.10) | +11.50% | +112.91 |
| mx450 | 120 | 247.54 (230.09–314.46) | 309.64 (289.69–364.12) | +25.09% | +236.92 |
| mx450 | 240 | 250.07 (232.38–376.25) | 308.19 (279.92–346.62) | +23.24% | +221.70 |

All raw samples are retained, including the 478.02 ms TC-1/120 candidate sample and the broad GP-R1/240 and MX-450/240 ranges. Several ranges overlap. Five samples on a shared virtualized host do not establish a universal slowdown percentage or hardware confidence interval. No second timing run was selected to produce a more favorable result.

Environment: Node v24.22.3, Linux 6.18.57, x64, AMD EPYC 9V74 80-Core Processor; nine logical CPUs visible. Each child loaded only one solver implementation. Imports are separately recorded in the raw output and are excluded from the table.

## Retained storage and allocation limits

Each original body owns **14 Vec3 objects and one quaternion**. Each current body owns **19 Vec3 objects and two quaternions**: five extra candidate vectors and one candidate quaternion. The measured object identities remain unchanged through the timing and comparison loops. This is fixed per-body scratch storage, not growth with elapsed steps.

Source review confirms that the successful integration code reuses that scratch and its invoked vector/quaternion arithmetic; the explicit `new Error` calls belong to rejection branches. The script measures retained objects and their identities, not every V8 transient allocation or internal native-function allocation. It therefore makes no complete heap-allocation-rate claim. Peak worker RSS was about 90 MiB and was dominated by module/runtime/JIT state; the small baseline/candidate RSS difference is not evidence of a memory improvement.

## Failed-step and retry integration

A separate candidate-only loop checks three deliberately invalid conditions: invalid initial position, a singular midpoint Jacobian, and translation overflow after candidate work. Each of 128 cycles first accepts a normal step, applies the invalid condition, rejects it twice, restores only public state, and compares the corrected next step to a fresh body. Private scratch from the failed attempts is deliberately left intact.

All **768 rejected calls** preserve the complete rejected-entry public state and all owned object identities. All **384 corrected retries** match fresh-body state exactly. These failure probes are excluded from normal timings; their extreme inputs are not presented as ordinary gameplay states.

## Source provenance and executed checks

Baseline HEAD at measurement: `5edead7a44c8ccb5a187b22b750ce2bda7715128`.

Candidate HEAD at measurement: `676d4c8531695638537bf62af5a74ca8edbe41ef`.

Twenty-one relevant source files were fingerprinted before and after the run. Only `src/simulation/rigid.ts` differs across the two measured checkouts; the catalogue inputs also compare exactly. File hashes, rather than a moving branch pointer, establish the measured implementation if root publishes unrelated work during the run.

| Source | SHA-256 |
| --- | --- |
| Original rigid.ts | `08c32ae36662f45d25c6ef5acf15f01dc5332463973ccaa3b1959bba6e10d61b` |
| Candidate rigid.ts | `eb0caeec3e61745282a3b1fbde6950f7fa64fcfe8ea0072626fdeb95ab41324a` |
| Benchmark script | `f7e6ed21a565907060844c595f47eb5ef3f76d247561bc31de8676c5a0215d09` |

Executed command:

```sh
flock /engine-work-4e0075ccccb3/test.lock env NODE_OPTIONS=--max-old-space-size=512 \
  node --experimental-transform-types scripts/rigid-step-benchmark.mjs \
  --baseline /engine-work-4e0075ccccb3/reference \
  --candidate /engine-work-4e0075ccccb3/repo \
  --output /engine-work-4e0075ccccb3/reports/34-rigid-step-benchmark.json
```

The complete measurement exited successfully. Scoped ESLint and Node syntax checks passed; Prettier formatted the script before measurement. No full compiler, full test suite, browser, npm lifecycle hook, asset generation, commit or push was performed by this agent. No model, character, authored environment, track, vehicle calibration, or dependency changed.

Files are ready for root review and publication. Ownership is released after handoff.
