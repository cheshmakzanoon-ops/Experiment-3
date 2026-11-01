# Original Aurel banner · isolated migration candidate

Work belongs only to `babylon-js`; `main` remains the exact restored snapshot.
The banner has **no live startup import**. Gantry and lamps retain their own
qualified owners; this component does not replace or own either one.

## Original data and material semantics

The adapter uses the unchanged original `label()` canvas for
`AUREL / GRAND CIRCUIT`: 512×128, background `#171d21`, foreground `#f5eee2`,
Arial bold at 66.56px, original centered drawing and maximum text width. It does
not redraw text with a Babylon text API or install a replacement font.

Explicit counterclockwise mesh orientation preserves the original Three front
face rather than Babylon's right-handed clockwise default. Original
`PlaneGeometry(14, 1)` buffers remain four vertices and two triangles,
at local `(0, 6, -0.27)` with π Y rotation under the original station-zero gantry
transform. The Float32 original world matrix, white multiplier, roughness 1,
metallic 0 and opaque double-sided semantics are retained.

Source canvas RGBA is validated as opaque and reordered once, top-to-bottom to
bottom-to-top, before a raw upload with `invertY=false`. This is the explicit
coordinate equivalent of the original CanvasTexture's `flipY=true`, not a flip
search. Original mipmaps, trilinear/linear filtering, clamp wrapping and
anisotropy request 8 are retained; actual anisotropy is limited by device caps.

Hardware-sRGB storage is required. A default DynamicTexture/shader-gamma fallback
would not establish the same filtered sampling as the original Three sRGB canvas
texture. The adapter rejects unsupported capability/allocation rather than
changing global engine gamma settings or silently substituting a different path.

`start-banner-material.ts` replaces back-face `surfaceAlbedo` at native PBR's
post-texture albedo hook with the original linearized `0x2b3236`. It does not
multiply the back by mirrored artwork. Native `twoSidedLighting` is enabled as
well as disabling culling, preserving sided normal handling. The fixed backing
uses verified constants, no custom uniform/sampler or global shader-store patch.

## Ownership and CPU evidence

`start-banner.ts` owns one plane, one PBR material/plugin and one texture, with
staged GPU preparation and completed presentation receipts. The original canvas
is exposed read-only by convention for the same-canvas reference fixture; cleanup
releases the owner's reference without resizing or changing the borrowed canvas.
Cancellation, stale owners, partial allocation and independent disposal are
covered. Active counts require actual mesh material/albedo bindings, not merely
resource membership in the scene.

The corrected 22 banner contracts and 47 affected contracts passed with type/lint
checks. A red-before native prebind regression exposed the default winding
mismatch and passes after the explicit CCW mapping, without changing any buffers,
canvas rows or reference camera. CPU canvas/native-allocation mocks verify logic
and original drawing commands; they do **not** certify actual font pixels,
hardware storage, filtering, front/back rendering or GPU parity.

## GPU acceptance boundary

The fixture uses the **same original browser canvas** for Three reference and
Babylon upload in each run. Cross-platform font hashes are deliberately not used.
Exact uploaded/readback texture-byte equality is separate from isolated linear
albedo/view-space-normal factor comparisons, with predeclared maximum 2 RGB code
values and mean 0.25 over eligible coverage, plus an exact reference repeat.
These factor bounds are not a full-PBR image-equality claim.

Required evidence includes actual native sRGB allocation and mip generation,
sampler states, readable front/plain back, magnified/minified/oblique sampling,
shared-material opposite-facing meshes in alternating order, both uniform
transports, independent cleanup/co-presence and context loss/fresh restart under
one 120-second case deadline. Partial receipts must precede assertions.

No GPU execution is claimed at this checkpoint. The banner remains isolated.
Final lighting, exposure, bloom, shadows and quality-budget parity remain open;
no lights or replacement artwork are added to hide those omissions. The known
Linux post-model GPU loss still prevents an all-platform release.

## Combined local checkpoint

The exact active GPU/native contract union passed **1,169 tests in 92 files**,
including the corrected banner-facing contract and new read-only observation
contracts. Full lint, TypeScript, production build and formatting passed.
Discovery confirms 25 GPU cases: 19 retained, three lamps and three banner cases,
all required with unchanged deadlines. No banner GPU execution or live activation
is implied by these local results.
