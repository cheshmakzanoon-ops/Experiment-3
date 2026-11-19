# Offroad presentation resource ownership

`RacingRenderer.dispose()` now calls the complete `OffroadScene.dispose()` owner before its generic scene traversal. Closing a venue detaches its group first, marks it disposed, clears queued terrain keyframes and the roost ground-height callback, then closes the terrain, gate, stadium, dressing, landmarks, loose soil, spectators, meadow and roost. The complete operation is idempotent.

Every offroad construction callback checks the scene's lifetime before allocating. A construction queue that resumes after teardown therefore cannot recreate meshes or quality subscriptions even if its caller has not cancelled the queue. An exception while installing or replaying data into a queued owner closes all owners already acquired by the scene and is rethrown. A queue-registration failure also releases the immediately constructed roost. The meadow retains its existing cancellation and detached-build transaction.

## GPU resources and texture images

The small `offroad/owned-resources.ts` helper releases exclusive geometries, materials, custom shadow materials, instance buffers and direct material texture handles with identity-based deduplication. It includes explicitly retained palette entries, unused geometries and fallback texture handles. Terrain, gate and stadium owners capture procedural fallback maps before scanned-material hooks hide them. Closing an instance now releases its buffers independently of its shared geometry; this covers the stadium crowds/chairs and the roost clods/contact shadows.

Shader uniforms are deliberately outside this traversal. Scanned-ground uniforms reference the resident shared library. Scanned material properties hold separate cloned texture handles, which the venue releases without disposing their source textures or closing their shared source images. Procedural texture clones now unregister from `ProceduralTextures.handed` on disposal, so that registry no longer retains closed venues or re-uploads their retired handles during a later bake. The shared procedural master pixels remain available for the next venue.

## Verification

The implementation checkpoint passed **44 tests across five files**:

| Suite                       | Tests |
| --------------------------- | ----: |
| Renderer resource lifecycle |     7 |
| Material library            |    15 |
| Motocross environment       |     9 |
| Meadow lifecycle            |     8 |
| Roost contact               |     5 |

Five new tests cover resumed construction after disposal, rollback after a terrain-keyframe installation error, registration failure, cloned versus shared texture ownership, and removal of retired procedural handles. The two existing complete MX/SX renderer teardown cases now count disposal events for every attached venue resource and retain references to closed meshes while switching Low, Medium, High and Ultra. No disposed mesh may change count or visibility through a stale quality listener. Existing checks still require resident scanned images to survive and orphan palette maps and both main-shadow targets to be released once.

These are CPU-side lifecycle and production-owner tests. They do not claim a GPU timing or physical-hardware result. They cover registered scene owners and failures at their queue installation boundaries; they are not a guarantee of recovery from an allocation failure inside every nested constructor.

## Independent review follow-up

The generic tail of `RacingRenderer.dispose()` still iterates texture-valued material properties and calls `ImageBitmap.close()` on each texture's image. `installScannedMaps()` in `ground/scanned-ground.ts` clones a resident source texture with `Texture.clone()`, which preserves source-image identity. An active scanned clone outside the now-detached offroad owner can therefore reach the generic image-close path while the same source pixels remain owned by `scannedGround`. The offroad helper avoids this by releasing handles without closing images. The broader generic image-ownership rule requires a separate review so it can also account for imported asset owners, shared libraries and their existing disposal contracts.
