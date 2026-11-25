# W03A — exact loudness coefficient reuse

Assignment 13/60. Implements audit-devices.md scope A in
`src/audio/engine-loudness.ts`; regression coverage is in
`tests/engine-loudness-coefficients.test.ts`.

## Change

- Prepare the original low-pass coefficient pair once per active
  `loudnessScale()` call and share it across bands.
- Evaluate the original frequency cosine pair once per harmonic and reuse it
  for K1, K2 and the low-pass; each biquad expression and accumulation order stays intact.
- Preserve public signatures, qDb defaults/variants, cutoff clamps, the inclusive
  20 kHz boundary, tiny-power neutral scale and normaliser clamp behavior.
- Prepare coefficients lazily after a positive gain; inactive gains neither
  inspect the profile nor initialise the waveform cache.
- Preserve per-object waveform caching and arbitrary profile spectra.
  `normalisedWavePower()` remains byte-identical to the saved baseline.

## Exactness evidence

The test contains a frozen source copy from audit baseline `350119e8`.
Imports/exports are adapted only to isolate the snapshot; emitted JavaScript
tokens match the saved source after those adaptations and formatting.
Assertions use Object.is equality, including NaN and signed zero.

- 4,096 deterministic seeded normalisers cycle all 24 authored profiles.
- 1,344 profile/rpm/load/interior-cutoff combinations include electric idle behavior.
- Public K-weight/low-pass checks cover qDb variants, clamp edges, subnormals,
  infinities, NaN and 512 additional seeded frequency/cutoff/resonance combinations.
- Every family/band checks harmonic termination immediately below, at and above
  20 kHz, including the 39th- and second-harmonic transitions.
- 27 custom spectra cover distinct objects sharing family labels, spectral extremes
  and existing cache behavior after a profile mutation.
- Empty/silent, negative, NaN, tiny, huge and infinite gains/targets retain baseline results.

A separate Node v24.22.3 comparison imported the actual saved
`/tmp/aeebac160835-audio-audit/baseline-loudness.ts` and edited production module:
20,752 loudnessScale + 7,200 bandPower + 11 kWeightPower + 792 lowpassPower calls;
**28,755 exact comparisons, zero mismatches, maximum finite difference 0**.

## Structural work reduction

Warm three-band update at [100, 200, 400] Hz, 39 harmonics per band:

| Operation | Baseline | Production |
| --- | ---: | ---: |
| Math.sin calls (asserted) | 117 | 1 |
| Math.cos calls (asserted) | 819 | 235 |
| Low-pass coefficient arrays (source count) | 234 | 2 |

The two coefficient arrays have one small holder object. These are operation
counts, not browser timing or audible-quality measurements; wave 7 owns timing.

## Validation

`node node_modules/vitest/vitest.mjs run tests/engine-loudness-coefficients.test.ts tests/engine-loudness.test.ts --maxWorkers=1 --minWorkers=1`

Result: **2 files / 22 tests passed** (8 new + 14 existing).
Scoped ESLint and strict TypeScript no-emit compilation passed.
Browser validation remains with the root's existing GitHub workflow.
No sine basis, authored audio tuning, dependencies, assets or unrelated source changes.
