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

## Evaluated opaque player depth candidate (not enabled in production)

The completed run `36406024237` on `d09367e` was not green: clear-day
full-lap presentation recorded six frames, and the close-racing and wet-day
following recordings ended without qualifying their events. Source checks,
physics scenarios, wet presentation and five browser shards passed. The sky
sort correction alone did not close the race-presentation gate.

`PlayerScenePass` was evaluated as a candidate that primes opaque depth from
the actual imported player before ordinary scene shading. It uses the current geometry tier, skin/morph
state and transforms; it does not clone or move the car or change its materials,
textures, lighting, animation, camera or physical clock. Only unconditional
opaque, double-sided depth-writing surfaces qualify. Transparent decals, visor,
cutouts, displaced surfaces, transmission and alternate depth/stencil policies
stay on their ordinary path. Eligible mesh candidates are reported separately
from actual draw calls; the renderer's triangle/call totals include the extra
submission rather than hiding its cost.

The pass clears its target once, disables shadow-map updates for depth-only
submission, and restores camera/mesh layers, background, override material,
clear flags and shadow-update ownership even on failure. Three.js background
colour clears cannot discard the primed depth. Override/masked/depth-preserving
passes use the previous RenderPass unchanged. Disposal frees only the owned
depth material, not the source geometry, materials, skeleton or textures.

Six unit regressions cover conservative selection, actual-resource identity,
material changes, pass ordering, opt-out conditions and failure cleanup. The
existing actual-binary GPU fixture additionally compares ordinary and primed
front/rear/cockpit images, requires a real extra geometry submission, retains
exact restored-texture pixels and checks bounded warmed resources. Its old
image-error thresholds remain unchanged. The early wet-presentation job now
also executes this fixture; all eight complete browser shards remain required.

This experiment is not a measured device-FPS improvement. Its additional
vertex submission trades work for hidden-fragment rejection. The measured
studio result below rejects enabling it in normal rendering. No
frame-count/event threshold, simulation clock, source-model hash, resolution,
quality setting, retry count or timeout was relaxed.

## Measured rejection and zero-coverage decal continuation

The early GPU job of run `36413727893` on `147df1d` passed all four cases,
including original-vs-primed front/rear/cockpit pixels, exact restored-texture
pixels and bounded resources. Within that same runner and fixture, primed
submission was slower, not faster:

| View    | Ordinary sorted frame (ms) | Primed frame (ms) |
| ------- | -------------------------: | ----------------: |
| Front   |                     2664.9 |            3345.4 |
| Rear    |                     2768.4 |            3477.7 |
| Cockpit |                     2297.1 |            2766.9 |

These synchronized studio samples include CPU work, GPU waiting and pixel
readback; they are not full-race FPS or physical-device measurements. The
roughly 20–26% regression rejects this candidate for normal rendering. The
production `RacingRenderer` is restored byte-for-byte to its pre-depth source.
The experiment and independent tests remain as a benchmark only; bundling the
normal application does not import `PlayerScenePass` or pay for its geometry
submission, layer walk, material or registry.

Named, non-depth-writing, normally alpha-blended supplied decal sheets now
skip lighting only when their sampled coverage is exactly zero. All positive
filtered alpha values, source maps/UVs, geometry, shading and blend/depth
policies remain intact. No binary, LOD tolerance or source asset hash changes.
Stencil-writing, alpha-to-coverage, alpha-hashed, alpha-tested, transmission,
custom/additive blend and non-decal materials are excluded. Existing material
hooks are chained once; each material retains an opt-out oracle uniform.

Four unit cases cover the shader stage, unchanged alpha policies, hook/cache
identity and unsupported materials. The actual-binary GPU fixture explicitly
disables the new coverage optimization for its original/sorted oracle, then
enables it for a separate image/timing comparison at unchanged geometry and
quality. It retains the rejected depth path as a labelled comparison, but
restores the ordinary path for texture-budget and resource tests. This
coverage continuation requires its own passing hosted image/race checks; the
preceding depth job is not acceptance of a different source. No test
threshold, capture requirement, clock, timeout, retry or release gate is relaxed.
