# Decoded texture ownership across renderer changes

## Defect and change

Three's `Texture.clone()` creates a separate texture handle but retains the same
`Source` and decoded pixels. `ScanStore` deliberately keeps its photographed
ground sets after a renderer is detached. `installScannedMaps` uses clones of those
sets for per-material UV scaling. Previously, generic `RacingRenderer.dispose()`
disposed each scene texture and closed any `ImageBitmap` it referenced. A shared
bitmap could therefore become a zero-sized, unusable source for the next renderer.

`texture-source-ownership.ts` separates these lifetimes:

- Decoder-cache insertion and successful `ScanStore.adopt` explicitly mark the
  source and its image as shared. This also covers direct adoption and the expanded
  normal texture, not only textures created by the ordinary loader.
- `disposeSceneTexture` always releases the scene texture's GPU handle. It closes
  a bitmap only if neither its source nor its image has shared ownership.
- Exclusive bitmaps are closed once even if several texture handles or separate
  `Source` wrappers refer to the same image.
- Ownership and close records use weak sets. They do not retain a discarded cache,
  texture source, or bitmap. Replacing a layer or detaching a renderer does not
  revoke protection from outstanding clones of its old source.

This preserves the existing page-lifetime cache design. It does not introduce
another texture copy, render target, shader pass, decoder, or per-frame operation.
Image cleanup in exclusive imported-asset owners remains unchanged. The offroad
owner's existing handle-only disposal remains valid.

## Validation

The new `texture-source-ownership.test.ts` exercises the actual
`RacingRenderer.dispose` method with real scenes, materials, textures and disposal
events. Unrelated GPU pass owners are inert for this CPU test. Its checks cover:

1. Three sequential material/renderer lifecycles using the real scanned-map
   installer, with each scene clone disposed exactly once and cache pixels intact.
2. A separate `Source` wrapper aliasing retained pixels.
3. Multiple exclusive texture handles closing their shared bitmap exactly once.
4. Source retention before a decoded loader result is adopted by a ground store.
5. Cache layer replacement and renderer detachment with old clones still alive.
6. Rejected adoption leaving the failed owner's source eligible for cleanup.
7. Operation without a browser bitmap API and without closing arbitrary duck types.

The browser fixture and `texture-source-ownership.spec.ts` use real
`createImageBitmap`, the production scan adoption/map swap/disposal path, and three
independent Three WebGL renderers. The acceptance assertions require identical
rendered pixels after every re-upload, visible colour variation, live contexts,
unchanged bitmap dimensions, no leaked material registrations, and no GL or
browser errors. Separate controls require an exclusive bitmap to close and a
manually closed bitmap to reject reuse. PNGs and JSON are attached to the test
report. GPU execution must be recorded by the CI runner; a successful bundle is
not evidence that these browser assertions passed.

## Limits

The current WebP fallback loader uses `HTMLImageElement`; compressed texture data
also does not have `ImageBitmap.close`. The defect concerns bitmap-backed shared
sources, including sources supplied directly to the cache or through a compatible
decoder. The native browser fixture intentionally uses synthetic bitmaps to
exercise that lifetime independently of current artwork formats.

The store currently has no explicit cache-eviction API. Shared decoded pixels
remain available while their owners retain references and are otherwise eligible
for garbage collection. This change does not add reference counting or an unsafe
scene-level operation to close cached pixels. Any future explicit eviction policy
must account for all outstanding source consumers before closing a bitmap.

The focused browser fixture checks GPU upload correctness, not full-game venue
loading, frame rates, physical GPU performance, or native console behavior.
