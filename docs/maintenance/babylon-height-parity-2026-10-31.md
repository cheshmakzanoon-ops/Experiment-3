# Scalar-height material parity candidate

## Confirmed source gap

The hash-pinned Formula GLB exports two scalar-height images through `normalTexture`: carbon image 49 (8-bit grayscale, 1024×1024) and tyre image 51 (16-bit RGB with equal channels, 1024×512). The retained Three renderer's `restoreSuppliedHeightMap()` interprets them as scalar bump maps at base scales 0.00015 and 0.0004. Raw Babylon import instead decodes RGB as tangent-space normals. This is a semantic difference, not by itself a completed visual-quality diagnosis.

Eight carbon materials (74,81,82,83,86,91,92,93) and two tyre materials (94,99) use those sources. Babylon renames imported textures, so a name-only copy of the legacy repair would miss them. The candidate verifies the original GLB hash and exact source material/image/texture slots through the existing isolated source-pointer reader.

## Source-bound adapter and activation

`src/engine/babylon/existing-player-height.ts` was inactive in the measured `1be6c70` production path. This increment enables it once through the real model loader's off-scene initializer, under the existing exclusive GPU preparation lane and before material compilation. Fresh active-path WebGL/native qualification is pending. The material-local plugin preserves original images, texture fields, UV transforms, source geometry and ownership. It replaces only the pinned tangent-normal evaluation with Three r180's forward height differences and normalized screen-space derivative perturbation, including double-sided orientation. It does not convert height into a new normal texture, reduce normal strength, introduce later lookdev relief gains, replace paint/livery, or alter physics/quality defaults.

The exact shader hook, GLSL-only path and internal linear-allocation state are version-sensitive. Known linear allocation requires `_useSRGBBuffer === false`; absent/unknown/sRGB states fail before installation. `gammaSpace` metadata alone is not GPU sampling semantics and is not rewritten. Installation must occur before material preparation while the caller exclusively owns an idle scene/GPU; that caller must retain ownership across asynchronous source verification and later toggles/disposal.

The public plugin API has no detach operation. Disposal makes the plugin inert and releases its borrowed texture reference; the owning material/container destroys remaining plugin state. It never disposes original textures. This is not a general transaction/rollback API for arbitrary caller mutation.

The derivative algebra is adapted from Three r180 (MIT); the existing dependency's complete copyright/license notice is bundled at [`public/legal/THREE-LICENSE.txt`](../../public/legal/THREE-LICENSE.txt). This notice does not certify rights to the supplied car's team/sponsor marks. [Existing asset-rights boundary](../SUPPLIED_PLAYER.md).

## Verification boundaries

Five focused NullEngine tests cover source integrity, exact slots, swapped same-image textures, missing/unknown/sRGB allocation, preparation-state rejection, and original resource/UV preservation through disabled/enabled/disposed states. NullEngine cannot establish rendered normal orientation, texture-pixel parity or GPU performance.

Two new real-WebGL probes are prepared for Actions:

- Compare controlled view-space normal output with Three r180's actual bump implementation across UV transforms, nonuniform scale and front/back faces, including a genuine tangent-normal control. Explicitly amplified test-only scales make derivatives measurable in RGB8; these are not authored gameplay settings.
- Capture the original full-detail model in raw/repaired/raw states, including carbon/tyre close views, frozen pose and untouched true-normal controls. Keep source/resource identity and require exact restoration. Retain bounded shader/sampler diagnostics and original failure causes.

Both retain the existing 120000 ms total preparation budget. No local browser execution or visual improvement is claimed. Actual compilation, double-sided/scaling agreement and image review must pass before considering production activation. Later Three lookdev calibration, fictional sponsor artwork, coatings, environment/material parity and commercial rights review remain distinct work.

## First real-WebGL outcome and cache correction

On `cf76725`, Babylon integration run 41232073412 passed 7/8 cases. The original full-car raw/repaired/raw case passed across overview/carbon/tyre views: resources, pose and genuine-normal material controls were retained, every raw restoration was exact, and GL errors were zero. The first five controlled scalar cases matched Three r180 exactly, including amplified derivative, nonuniform-UV and backface cases. This is software-renderer evidence, not physical hardware qualification.

The separate true-normal control rendered no comparable pixels and returned GL1282. Captured driver warnings explicitly reported an undersized uniform buffer; its cached shader incorrectly contained the scalar sampler. Babylon's last-added plugin automatic marker had allowed scalar-plus-output and output-only materials to share a shader key despite distinct layouts. The fix gives the scalar plugin a persistent explicit `EXISTING_PLAYER_SCALAR_HEIGHT_V1` define, preserved even when disabled/disposed because its compiled layout persists. A real define-serialization regression fails on the old code and passes with the correction, including plugin order/composition.

The revised probe retains every original pixel/error requirement, records both contexts' GL errors independently, requires the normal control to contain no scalar sampler/code, and renders a final exact raw frame after adapter disposal while the original resources remain alive. The corrected rerun is recorded below; those results precede production activation.

## Cancellation safety before activation

Adapter construction now requires the caller's ownership/invalidation signal. Source verification receives that signal, and continuation checks it before reading bound resources and again immediately before synchronous plugin installation. A late digest result after a lost, disposed or expired GPU lease must not mutate materials. The original-model diagnostic acquires its existing exclusive GPU preparation lane for initialization; the production loader uses lease invalidation only and rechecks ordinary user cancellation after that lane drains.

GPU invalidation can end the preparation await before asynchronous hashing settles. The signal guard prevents the late continuation from installing anything; it does not cancel WebCrypto itself or dispose borrowed resources. Ordinary owner cancellation and fatal GPU invalidation are different: future production integration must let owned work settle and then apply owner/scene checks, rather than promise retry after any preparation failure. Plugin constructor failure is not transactional; discard the uninstalled container if an installation fails partway through.

## Corrected GPU result

On `1be6c704cdfb1816ebf5601fa8e41fedca5c7a95`, [Babylon run 41236092059](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41236092059) passed **8/8**. Artifact 13055921203 has SHA-256 `a294260ec3c7b97e097b1f1ae672919a701a6b5276aa13adee2fc4924ff70acc`.

All six controlled comparisons match Three exactly in RGB8 (maximum/mean channel error zero), with zero GL errors in both contexts. The genuine-normal control covers 14,998 pixels, remains unchanged and contains no scalar sampler or shader code. The live-material disposal row restores exact raw pixels with two completed frames, unchanged resources/pose/normal controls and zero GL errors. The full-model probe records 20 completed frames, no loss, and retains 172 primitives, 101 materials and 82 textures.

Actual overview images confirm that scalar interpretation removes the severe mottling on tyres and carbon parts. The close-view cameras are not sufficient for detailed appearance qualification: carbon is only modestly closer than the overview, and the tyre view is substantially occluded by body/wing geometry. This is SwiftShader evidence, not physical-GPU qualification, completed look development or a commercial asset-rights review.

The integration reads the actual live enabled-plugin count through `enabledCount` (zero after disabling or material-owned disposal). Main verifies ten during initialization, then publishes the count only after completed presentation and final ownership checks. Restart, new load, loss, stop and failure clear the diagnostic. Actual-route browser/native checks require ten; browser checks additionally require absence before loading and after restart. Their fresh execution remains pending until this increment is published.
