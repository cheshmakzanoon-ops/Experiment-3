# Scalar-height material parity candidate

## Confirmed source gap

The hash-pinned Formula GLB exports two scalar-height images through `normalTexture`: carbon image 49 (8-bit grayscale, 1024×1024) and tyre image 51 (16-bit RGB with equal channels, 1024×512). The retained Three renderer's `restoreSuppliedHeightMap()` interprets them as scalar bump maps at base scales 0.00015 and 0.0004. Raw Babylon import instead decodes RGB as tangent-space normals. This is a semantic difference, not by itself a completed visual-quality diagnosis.

Eight carbon materials (74,81,82,83,86,91,92,93) and two tyre materials (94,99) use those sources. Babylon renames imported textures, so a name-only copy of the legacy repair would miss them. The candidate verifies the original GLB hash and exact source material/image/texture slots through the existing isolated source-pointer reader.

## Inactive adapter

`src/engine/babylon/existing-player-height.ts` is not imported or enabled by the production model loader. Its disabled material-local plugin preserves original images, texture fields, UV transforms, source geometry and ownership. It replaces only the pinned tangent-normal evaluation with Three r180's forward height differences and normalized screen-space derivative perturbation, including double-sided orientation. It does not convert height into a new normal texture, reduce normal strength, introduce later lookdev relief gains, replace paint/livery, or alter physics/quality defaults.

The exact shader hook, GLSL-only path and internal linear-allocation state are version-sensitive. Known linear allocation requires `_useSRGBBuffer === false`; absent/unknown/sRGB states fail before installation. `gammaSpace` metadata alone is not GPU sampling semantics and is not rewritten. Installation must occur before material preparation while the caller exclusively owns an idle scene/GPU; that caller must retain ownership across asynchronous source verification and later toggles/disposal.

The public plugin API has no detach operation. Disposal makes the plugin inert and releases its borrowed texture reference; the owning material/container destroys remaining plugin state. It never disposes original textures. This is not a general transaction/rollback API for arbitrary caller mutation.

The derivative algebra is adapted from Three r180 (MIT); the existing dependency's complete copyright/license notice is bundled at [`public/legal/THREE-LICENSE.txt`](../../public/legal/THREE-LICENSE.txt). This notice does not certify rights to the supplied car's team/sponsor marks. [Existing asset-rights boundary](../SUPPLIED_PLAYER.md).

## Verification boundaries

Five focused NullEngine tests cover source integrity, exact slots, swapped same-image textures, missing/unknown/sRGB allocation, preparation-state rejection, and original resource/UV preservation through disabled/enabled/disposed states. NullEngine cannot establish rendered normal orientation, texture-pixel parity or GPU performance.

Two new real-WebGL probes are prepared for Actions:

- Compare controlled view-space normal output with Three r180's actual bump implementation across UV transforms, nonuniform scale and front/back faces, including a genuine tangent-normal control. Explicitly amplified test-only scales make derivatives measurable in RGB8; these are not authored gameplay settings.
- Capture the original full-detail model in raw/repaired/raw states, including carbon/tyre close views, frozen pose and untouched true-normal controls. Keep source/resource identity and require exact restoration. Retain bounded shader/sampler diagnostics and original failure causes.

Both retain the existing 120000 ms total preparation budget. No local browser execution or visual improvement is claimed. Actual compilation, double-sided/scaling agreement and image review must pass before considering production activation. Later Three lookdev calibration, fictional sponsor artwork, coatings, environment/material parity and commercial rights review remain distinct work.
