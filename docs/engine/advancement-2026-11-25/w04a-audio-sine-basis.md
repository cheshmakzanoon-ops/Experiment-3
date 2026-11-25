# W04A — bounded exact waveform sine basis

Assignment 19/60. Implements `audit-devices.md` section B after W03A coefficient
reuse (`b594cfc`). Changes only the cold waveform calculation in
`src/audio/engine-loudness.ts`; focused coverage is in
`tests/engine-loudness-sine-basis.test.ts`.

## Change and cost

The first 40-coefficient input creates one module-owned
`Float64Array(2048 * 40)`. Rows retain the original sample index, columns retain
the original harmonic index, and column zero stays unused. Initialization calls
`Math.sin(k * theta)` in the original sample/harmonic order with
`theta = (i / 2048) * Math.PI * 2`. Float64 preserves those JavaScript number
values without an extra rounding step.

Every supported waveform still performs the same 2,048 peak samples, harmonic
multiplications and ordered additions. The power accumulation, peak fallback and
returned fields are unchanged. There is no recurrence, frequency approximation,
coefficient pruning or profile-result cache.

The allocation is lazy and fixed at **655,360 bytes (640 KiB) of numeric payload**.
This includes the unused 16,384-byte zero column; typed-array/object headers are
additional implementation overhead. Repeated spectra and new profile objects
reuse the same array. The existing per-profile waveform `WeakMap` is unchanged;
no strong profile map or retained input history is introduced.

Input handling is deliberate:

| Input / state                             | Behavior                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------- |
| Module import or inactive gains           | No sine basis allocation or waveform work                                     |
| Fewer than 40 coefficients, basis absent  | Original scan; a short one-off call does not initialize the full basis        |
| Exactly 40 coefficients                   | Initialize once if needed, then use the basis                                 |
| Fewer than 40 coefficients, basis present | Reuse the appropriate existing columns                                        |
| More than 40 coefficients                 | Original complete scan, before and after initialization; never grow the basis |

Full-length silent and nonfinite spectra follow the same full-length branch.
There are no value-dependent shortcuts. Empty buffers, ignored DC coefficients,
signed zero and nonfinite output semantics remain compatible.

## Compatibility evidence

The regression oracle is the actual `normalisedWavePower()` function extracted
from `/dev/shm/aeebac160835-engine-baseline/src/audio/engine-loudness.ts`, pinned
baseline `350119e8`. Only `export function normalisedWavePower` is renamed to
`function baselineWavePower` for test isolation. The test does not depend on the
temporary baseline checkout being present at runtime.

Source provenance (SHA-256):

- Complete saved baseline module:
  `01c9b225d95e3122fe3dff2278d40e8b279ef455bf5941c362d870adba5e3f00`.
- Extracted original exported function:
  `cf18bbe59de5ea5c706e60c4812d0efe8bdf07e2ddf5b64f776713f3eb8244a8`.

Numeric assertions use `Object.is` through Vitest's `toBe`, including NaN and
the sign of zero. Coverage includes:

- All **72 authored profile/band** peak and power pairs across 24 profiles.
- **192 seeded spectra, each checked before and after mutation** of the same
  input buffer. Lengths are 0, 1, 2, 3, 7, 8, 16, 31, 39, 40, 41, 42, 63, 80,
  127 and 256. Coefficients span signs and a broad magnitude range; inputs remain
  unchanged by normalization.
- **66 edge spectra**, checked forward and again in reverse after initialization:
  empty, all-zero, negative zero, nonfinite ignored DC, NaN/infinite harmonics,
  minimum Float32 subnormals, maximum finite Float32 and alternating-sign values.
- Lengths **41, 64 and 257** checked both before and after basis creation with
  the complete original number of sine calls.
- No allocation or sine calls on module import or inactive gains, using a profile
  that throws if any property is read. Cold lengths 0, 1, 2, 8 and 39 allocate no
  basis and retain their original scan work.
- Every one of the first **79,872 sine arguments** matches the original theta
  expression and harmonic order exactly. The payload remains one 640 KiB array
  after all 72 authored spectra and 48 fresh custom profile objects.
- The original loudness and W03A coefficient suites also pass, preserving
  authored levels, frequency bounds, filters, weak-cache behavior and zero-gain
  laziness alongside this change.

## Structural work reduction

These are deterministic operation counts, not duration or browser measurements.
The comparison below isolates this change from the earlier coefficient work.

| Workload                                             | W03A, before basis |   W04A |
| ---------------------------------------------------- | -----------------: | -----: |
| First 40-coefficient waveform, sine calls            |             79,872 | 79,872 |
| Later 40-coefficient waveform, sine calls            |             79,872 |      0 |
| Three waveforms for first family, sine calls         |            239,616 | 79,872 |
| Three waveforms for a later fresh family, sine calls |            239,616 |      0 |
| All 72 authored waveforms, sine calls                |          5,750,784 | 79,872 |
| First three-band `loudnessScale`, sine calls         |            239,617 | 79,873 |
| Warm three-band `loudnessScale`, sine calls          |                  1 |      1 |
| Warm three-band `loudnessScale`, cosine calls        |                235 |    235 |

The first waveform pays array initialization and then its normal multiply/add
scan; it does not save sine calls by itself. Its next two family bands and later
fresh families reuse the completed basis. Already cached profile updates perform
no waveform scans in either version, so this change does not claim steady-state
filter savings. W03A counts follow its preserved scan/filter structure; W04A
counts and exact sine input ordering are asserted in the focused tests.

The persistent 640 KiB payload trades memory for reduced first-use transcendental
work. Wave 7 owns isolated cold-family and steady-state timing; no timing or
startup-wide benefit is claimed from concurrent validation. Browser coverage
remains with the root's established workflow.

## Validation

```sh
node node_modules/vitest/vitest.mjs run tests/engine-loudness-sine-basis.test.ts tests/engine-loudness-coefficients.test.ts tests/engine-loudness.test.ts --maxWorkers=1 --minWorkers=1
node node_modules/eslint/bin/eslint.js src/audio/engine-loudness.ts tests/engine-loudness-sine-basis.test.ts
```

Result: **3 files / 29 tests passed** (7 new, 8 coefficient and 14 original tests).
Scoped ESLint passed. No npm hooks, full build or local browser run was invoked.
Authored audio profiles, tuning, models, assets and environment settings are
unchanged. Publication is owned by the root.
