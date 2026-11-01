# Original surface texel data boundary

## Scope

This is a renderer-neutral data extraction, **not a Babylon asphalt material port**.
`src/engine/assets/surface-texel-data.ts` owns the unchanged deterministic
`AsphaltAggregate`, `surfacePixels`, `asphaltMesoPixels`, `surfaceNormalPixels`,
`asphaltTexelMeans`, `SurfaceKind`, and `ASPHALT_TEXELS` / `ASPHALT_DETAIL` /
`ASPHALT_TONE` constants. Its only dependency is `core/math.ts`.

The original Three import paths retain the same function, class and constant
identities. The material factory, shader formatting/composition, texture upload,
colour-space annotations, normal-map orientation, mipmaps, anisotropy and scan
store ownership remain with their existing rendering owners. No shader body,
physics, tier policy, texture resolution, artwork or deadline changes.

## Independent pre-edit capture

Before editing any source, capture verified all 11 contributing files against
`cee488b3e399c67fcf5c4d94fc9defa02b355272` using `git show`, then called the actual
original functions and material factories through Vite SSR on Node **22.23.4** /
Three **r180**. A recording canvas retained the real factory's ImageData upload;
this was not a GPU upload or render. The extraction began only after the separate
harness-only diagnostic was published as `fa841299a01ceaec3f8980e76e7933f436b6c11b`;
all captured rendering sources remained unchanged at that point.

Immutable fixture: `tests/fixtures/asphalt-source-cee488b.json.gz` (**3,299,161 bytes**).
SHA-256: `7f77c6a276a62ab192f571a36746704215260f44d94c31aac2d450e456bd0fc8`.
The fixture contains provenance, exact values/bytes, hashes and complete composed
shader strings. It has no candidate-driven generator or golden-update mode.
The immutable fixture embeds the capture receipt and original-source identities.
Supplementary capture and validation logs are retained separately.
Capture-script SHA-256:
`c1e553a8efed78a20626bae68adf7f181fb191893ac2dc71b82f9ad47e744f2e`.

Original source SHA-256 values (also embedded in the immutable fixture):

| Source | SHA-256 |
| --- | --- |
| `src/rendering/surface-detail.ts` | `38894b399d54dda27efb89c719a623cc1a9351f6b8d4fa84ee35e57321882431` |
| `src/rendering/asphalt-aggregate.ts` | `e3ca120bceba595b2df6e0cbd5490cf5e953ceef2fd1b800c4617176c8926f60` |
| `src/rendering/circuit-finish.ts` | `dc5cc19096bdc9cff74060035cc97a5078ef9bfff13cca2a8505bad2f6d0043c` |
| `src/rendering/studio/road-detail.ts` | `718a1bcf7549fe289a78566bf516c0194e2af494f3e829d7c86ebf347f43fa1f` |
| `src/core/math.ts` | `e46e109d81774003aae58c52f77cd9ae2831a856ba6c9ba8878909c2c4383bd2` |
| `src/rendering/geometry.ts` | `c120aa6b3b8ad80f6a600d77fc3717c4638f89c3ab4bc36fea520345ebfacd26` |
| `src/rendering/materials.ts` | `ba0ce3209220fb07aba7fcc92b3f01e5c727801c9e132a2147926d8f58c17eef` |
| `src/rendering/studio/shader-hooks.ts` | `8ae51033f242d1100a6008975d6f5be3f55fd37e8f3be6399f5f731cc8da0488` |
| `src/rendering/ground/scanned-ground.ts` | `67ec24e443fbb5dae25b9994fa6755f40f7f8d0ebf55d4dde3c7a2a1307831dc` |
| `src/rendering/ground/scan-store.ts` | `f80bfed39901a79db30154632a288ca9e7045cb8b3b05af1f3ca5c38dc233358` |
| `src/rendering/periodic-coverage.ts` | `2f7b90ef97cabf43cf156027b41866951bd380eb9fb8af68b4ccc4c8133157f0` |

## Contracts

- Twelve original data cases cover all four surface kinds. Asphalt includes
  sizes 8, 17, 64, 128, 512 and 1024, with default, negative, zero and meso-seed
  inputs. Every byte of the 512² asphalt albedo, height, packed roughness, Sobel
  normal and Float32 meso field is retained and compared, as are the smaller
  captured cases. The 1024 case and other kinds' 512² cases retain exact hashes
  of every array, not sampled pixels or statistical tolerances.
- Four independent normal cases preserve asymmetric/wrapped, flat,
  zero-strength and strong-relief output. Tests preserve validation, immutable
  inputs and fresh caller-owned output buffers.
- Constants retain values, export identity and original shallow freezing.
  Default shader-formatted linear means remain `0.09685 / 0.09461 / 0.09022`,
  roughness `0.80508`, meso frequency `0.22222`, and slope gain `0.26548`.
  Complete factory shader comparisons protect the original formatting and
  expression order, not just these selected constants.
- Eight real factory cases cover dry/water-film asphalt, an explicit finish,
  grass/gravel/concrete and both ordinary/GP scan hooks. Texture upload hashes,
  material and sampler parameters, hook/cache keys, scan uniform names and
  complete vertex/fragment strings equal the independent original snapshots.
  The observer passed **9/9 before extraction**, then again after extraction.
- A transitive TypeScript import/re-export check requires exactly the neutral
  module plus `core/math.ts`, with no rendering/renderer-package dependency.
  Compatibility paths point to the same declarations rather than copies.
- An additional source-token comparison against the pinned original proved all
  11 moved declarations / retained factory and shader-hook functions unchanged
  apart from comments/formatting. Its receipt remains with the capture evidence.

## Validation boundary

Local Node 22.23.4 checks passed **30/30** new tests, **232/232** contracts from
the exact Babylon workflow selector (28 files), and **113/113** affected
original-surface/scan regressions (9 files, including the new tests). Full
TypeScript, full ESLint, scoped Prettier and whitespace checks passed. All 11
existing browser journeys remain discoverable; discovery is not execution.
The first type-check exposed a test-only access to an undeclared Three `defines`
field; the observer now uses an explicit runtime property guard, and the failure
log is retained. Neither production code nor oracle expectations were weakened.
Both new test files use the existing `tests/babylon-*.test.ts` selector and the
complete required unit suite; no tests or gates are excluded. Final guarded
build/selector logs and the frozen input manifest remain with the external
validation evidence, rather than rewriting this immutable capture report.

No Babylon GPU textures, material plugin or live asphalt activation is introduced.
Current road/paint geometry and paint finish are unchanged; Babylon asphalt,
road-state layers, scanned ground, grounding and light pools remain unported.
Future controlled GPU tests must compare material factors separately from
lighting/PBR differences. Local Chromium remains unavailable under the existing
restriction; CPU/material-hook checks are not new WebGL/native or visual-parity
acceptance. Full-mode migration and native Linux GPU reliability remain open.
