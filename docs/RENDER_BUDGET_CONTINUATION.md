# Supplied-player render budget continuation

Base source: `52e4b2215bdbb12449ff8279c3889d95ee2cf21c`.

## Delivered source changes

- Preserve the original RB19/R06 assembly and its highest-detail tier; reduce
  index-only lower tiers while retaining protected layered/livery surfaces.
- Budget the imported immutable maps through the existing texture controls,
  with shared ownership, bounded resampling and exact source restoration.
- Use one double-sided pass for named decal sheets and front-to-back opaque
  depth rejection; leave transparent sorting and explicit artist orders intact.
- Prepare every populated event workload from the normal held grid, without
  changing race physics, service timings or evidence qualification.
- Add independent real-binary pixel/resource regression coverage. Retain all
  existing complete-browser cases, assertions, limits and gated publication.

The temporary locked-toolchain transfer workflow is removed. No source branch,
parallel demo, physics fallback or additional original-model binary is created.

## Validation scope

Focused local verification passed 41 tests covering existing supplied-model
integrity/LOD contracts, presentation controls and eight new budget regressions.
The complete local check passed 1,234 unit tests across 124 files, ESLint,
TypeScript and the production build. Hosted browser validation is being executed
for this candidate; this document does not assert that pending checks passed. Local browser navigation is blocked by the execution
environment's administrator, so the hosted checks are the application/browser
authority. Do not substitute Node tests for WebGL or complete-race evidence.

Read `SUPPLIED_PLAYER_RUNTIME.md` for the original failing-run measurements,
implementation boundaries and specific rendered-image gates. A source push does
not prove a live deployment: the publisher must consume the exact successful
release artifact and confirm its source identifier. Physical target-hardware
profiling, manual driving and final visual acceptance remain separate gates.

## Hosted continuation and sky overdraw correction

Run `36402694133` passed the actual supplied-player LOD image checks, the new
imported-texture/material GPU image comparison, both wet-following workloads,
the pit-service sequence and the sunset/night full-lap group. Close-racing and
the clear-day cockpit full-lap gate still failed, so this is not all-green
acceptance. The latter captured only eight rendered frames; its diagnostic
reported about 9.57 seconds for its last software-GPU frame, not hardware FPS.

The analytic sky now renders after all opaque objects while retaining its
original far-depth vertex shader, depth test, non-writing depth policy and
radiance. Opaque cockpit/road/building depth can reject hidden sky fragments;
transparent surfaces still render afterward. The existing supplied-player GPU
fixture additionally compares sky-first and sky-last images with identical
geometry, maps and lighting. No view resolution, scene content, test threshold,
physics clock, review qualifier or timeout was changed. Its timing now includes
the synchronous pixel readback rather than assuming `gl.finish()` alone blocks
Chromium until rasterization completes. Revalidation of this correction is a
separate gate; previous green groups are evidence only for their own commit.
