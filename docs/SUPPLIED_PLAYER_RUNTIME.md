# Supplied-player runtime tiers and validation gate

## Preserved source

The game remains Three.js with the existing simulation and supplied RB19/R06
assembly. Suspension datum, camera sockets, source livery/materials and
snapshot-driven steering, pause and replay animation are retained. No legacy
fallback, physical-device FPS, final art, commercial rights or Steam acceptance
is claimed by this integration.

The decompressed source GLB remains SHA-256
`013a47f059bf34a0a28bd31ae8f407f07ed6e2b55755753aed9a942c895e132b`.
`npm run generate:player-lods` uses the exact hash-pinned source and existing
`meshoptimizer@0.25.0` dependency. Its index-only derivative is generated before
development, unit tests and build, not committed as another model binary.

| Representation | Triangles | Selection |
| --- | ---: | --- |
| Original | 1,455,118 | High-quality followed car and exact close inspection |
| Efficient close | 855,654 | Low/medium-quality followed car |
| Medium distance | 814,806 | Existing camera-distance LOD 1 |
| Distant | 797,386 | Existing camera-distance LOD 2 |

## Geometry and PLD2 ownership

Each of the 172 material primitives is processed separately. Borders and
skin-weight/joint seams are locked. Layered decals and their painted, composite
and tire support surfaces retain the exact original triangles, as do display,
mirrors and small details. Source vertices, normals, UVs, morph attributes,
materials, bones and animations are not rewritten. The existing simplification
tolerances are estimates, not measured surface accuracy or visual approval.

PLD2 additionally reorders opaque triangles for vertex locality and inverts the
encoder's vertex remap so all source attributes keep their original indices.
Transparent order is unchanged. All 516 primitive/tier oriented-triangle
multisets and simplification errors match the PLD1 baseline. The compact
`PLAYER_INDEX_CACHE_AUDIT.json` pins the aggregate baseline fingerprint; a test
independently reconstructs it from the actual generated package.

Identical complete index ranges may be shared only within the same primitive.
The parser rejects cross-primitive aliases, overlaps, incorrect counts, forward
references and out-of-range indices. Geometry wrappers share immutable vertex
attributes, reuse identical tier index ranges, and allocate nothing on a tier
switch. Original distance hysteresis is retained. Teardown restores original
geometry and releases each derivative owner once before ordinary scene disposal.

The package is 4,213,368 bytes compressed, 13,037,000 bytes decoded: 307,194 more
compressed bytes than PLD1. It is an additional download, not a claim of reduced
load time or original texture memory. Source/derivative digests, byte bounds,
primitive coverage and cancellation are checked before use. Both explicit gzip
and transparently HTTP-decompressed responses are supported. Missing/corrupt
required data stops loading rather than showing a different car.

A deliberate source/derivative change requires `--update-manifest`, geometry
and image review, and the corresponding manifest/source commit. Normal builds
reject a different derived digest. The deterministic FIFO-16 model changes
near-tier opaque misses from 992,010 to 622,914 (37.2%) without removing a
triangle. This diagnostic is not measured hardware performance.

## Runtime corrections and material budgets

Camera-switch validation measures active supplied wheels, not hidden legacy
wheels, and retains distance/long-lens assertions. Cockpit checks use the actual
eye socket with the chassis offset applied once, the 58-joint rig, screen and
mirrors. Screen raycasts do not traverse the hidden legacy player model.

Fog retains all eight Gauss nodes, weights and optical tail bound. Two vector
batches combine lateral/height exponentials; independent scalar GPU controls
check low/high/long rays and fog-disabled output. Full-scene samples and image
or resource assertions are retained, with no increased timeout.

Named `Decal |` surface sheets use one double-sided submission, not separate
front/back passes; visor/transparent volumes are excluded. Opaque sorting is
front-to-back within explicit artist orders, with the unchanged analytic sky
last. Transparent ordering remains unchanged. Exactly zero sampled decal
coverage skips physical shading only on normally blended, non-depth-writing
sheets; every positive filtered edge remains. The independent GPU oracle can
disable this optimization without changing maps, alpha or geometry.

Texture controls include actual immutable glTF maps. Low/medium budgets resample
from original images; 1024 restores the original ImageBitmap. Each shared image
owns at most one reduced canvas. Source objects isolate unregistered clones;
original orientation, UV transforms, color space, pixels and source identity
are restored on teardown. Dynamic wheel displays, simulation data, reflections
and unmarked textures are excluded. No KTX2 or smaller source download is claimed.

The evaluated extra player depth pass was slower in the same hosted benchmark
and has been removed. Production uses the original single scene submission.
See `RENDER_BUDGET_CONTINUATION.md` for measurements and experiment boundaries.

## Complete browser and publication gates

`npm run test:e2e:shard -- 1/8` enumerates the locked Playwright suite, assigns
each case exactly once with serial groups intact, then rechecks the actual CLI
selection for omissions or duplicates. Each runner keeps one worker, zero
retries and unchanged time limits. The retained `browser-shard-plan.json` and
screenshots/traces include failures. Scheduling estimates are not hardware
measurements; `--plan-only` does not assert that any test ran.

Populated event reviews prepare the real paused grid before enabling AI,
camera and recording; slow UI setup must not release opponents before the
player. No physics timing, service duration, car position, event qualifier,
retry or timeout was changed to obtain passing captures.

The CDN publisher accepts only a successful main-branch Build and validation
run from this repository, consumes its gated `apex-formula-release`, checks
source identity and both player hashes, and rejects superseded source. It does
not rebuild on an unvalidated push. Publication appends to the existing compiled
CDN branch without force-pushing source/deployment history; a repeated identical
release is a no-op.

## Acceptance boundaries

Actual-binary GPU tests cover source fit, steering, camera anchors, both locks,
pause/rewind, LOD pixels, material/rig identity, exact restored full-detail pixels
and stable warmed resources. Separate full-scene fog, application, telemetry,
replay and complete-race recordings remain mandatory. Component screenshots,
a source push or older green counts cannot certify the new full build.

The final commit's CI result is authoritative for hosted acceptance. Physical
target-hardware profiling, manual full-race driving and final visual polish are
independent gates. Software-GPU timing is not the user's frame rate. Geometry
counts do not certify 60 FPS, fewer draw calls, compressed textures, DRS,
editable baked decals or commercial rights to team/sponsor markings.
