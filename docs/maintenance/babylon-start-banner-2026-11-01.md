# Original Aurel banner · staged live integration

Work belongs only to `babylon-js`; `main` remains the exact restored snapshot.
The isolated adapter passed its GPU gate on `757c162`. Live startup now stages
the banner after the lamps; its expanded runtime checks are pending. Gantry and
lamps retain separate owners; this component does not replace or own either one.

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

The initial candidate was isolated; its subsequent GPU result is recorded below.
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

## Isolated GPU qualification: `757c162`

[Run 41323821362](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41323821362)
passed all 25 GPU journeys (19 retained, three lamps, three banner), every shard
and the aggregate gate. Each shard passed 513 CPU contracts in 46 files.
Banner artifact **13090573461**, SHA-256
`c04048e882e4827fcc3e9a18099ad6e8dd8ef06fe01fd3e652a3653a052b64c7`,
contains the inspected receipts and images.

Three banner cases include four executions with a fresh-context restart, eight
install/dispose cycles, 112 factor rows and 144 linked-program receipts. Every
factor row has zero reported RGB error and zero missing/excess/interior/partial-
alpha coverage difference. All reference repeats are exact, GL errors are zero,
and actual front-face state is CCW. Both UBO and standalone transports passed.
Independently decoded pixels of all 56 attached reference/candidate factor PNG
pairs were equal over their entire 1024×384 RGBA images. Front/back, magnified,
minified, oblique and opposite-facing pair images were visually inspected.

All eight allocations record actual 512×128 SRGB8_ALPHA8 storage, exact original
row-reversed bytes, trilinear/linear filtering, clamp wrapping, anisotropy 8 and
mipmap generation. Original geometry/world/canvas checks, cancellation and
independent cleanup passed; the co-presence cycle retained all four structural
parts and five lamps. Native texture deletion after actual context loss is
intentionally unknown, not claimed as an observed deletion.

The backend was **ANGLE SwiftShader software WebGL**, explicitly recording
`physicalHardwareValidated=false`. These results qualify the isolated component,
not a physical GPU, installed-app startup, cross-OS font equality, or final PBR,
exposure, bloom and shadow parity. The separate native run on this commit failed
in the newly added observation harness before readiness; see the
[retained failure and correction](native-startup-readiness-observation-2026-11-01.md).

## Live startup integration and remaining gate

`BannerPreparation` follows surface, structural gantry and lamp preparation under
the same generation, GPU owner and absolute 120-second startup deadline. The
banner may draw during its installation receipts; completion requests the final
paused redraw. Restart/loss invalidates its status, and independent cleanup does
not take ownership of the gantry, lamps or borrowed source canvas.

Readiness requires actual bound resources: one part/material/texture, two
triangles, 512×128 dimensions and hardware-sRGB storage. Both detached readiness
whitelists and the native/browser receipts include these values. The early-pause
journey must still hold the physics tick through complete environment readiness
and advance after resume. No new start-light timer or simulation writes are added.

CPU/build checks do not qualify live startup. The exact integrated source must
pass expanded GPU and installed-app journeys; the known Linux failures and
physical-hardware, full lighting and four-discipline migration gates remain open.

Before publication, the integrated active contract selection passed **1,200 tests
in 94 files**, with the project's full lint command, TypeScript and production
build. The build retains its existing chunk-size warning. An accidental broader
`eslint .` invocation also scanned historical/scratch files outside the project's
configured lint command and failed; it is not relabeled as a passing check.
The prescribed `eslint src tests e2e scripts desktop` command passed unchanged.

After integrating the CSP-safe actual-function harness from `e10eefe`, the full
active selection was rerun: **1,203 tests in 94 files passed**, including the
expanded banner observations and repeated-poll regression. A separate affected
six-file selection passed 113 tests. These are CPU checks, not installed-app
or live GPU qualification.
