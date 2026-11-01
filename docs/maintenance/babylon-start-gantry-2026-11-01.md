# Original A07 start-gantry adapter · isolated qualification

This work belongs only to `babylon-js`. `main` remains the exact restored
pre-migration snapshot. The adapter is **not yet imported by the live entry**.

## Original content retained

- Asset: `public/models/aurel-start-gantry.glb`, 1,241,484 bytes.
- SHA-256: `22479d4bdf81d9aef22c80324e98dbfeaf37645de0f73d5164b4cc3691b23454`.
- Manifest/authoring/Three construction remain unchanged. Original Aurel-only
  eligibility is further bounded to the current canonical Formula context.
- Four original LOD0 structural parts, 9,520 triangles, one native PBR material
  and three embedded 512×512 PNGs. All imported LOD resources retain one owner;
  runtime LOD selection is not ported in this slice.
- Original Three CPU matrix baking and buried-foot conformation are reused as a
  component. Babylon owns actual rendering/materials/textures. CPU-only texture
  placeholders used by the geometry oracle never enter the presented scene.
- Original position/normal/UV/index arrays and the Float32 form of the original
  world matrix match exactly. No replacement geometry or new artwork is generated.

The GLB contains structural supports, not the separately created banner or five
race lamps. Those, weather hooks, shadows, broadcast occluders and complete
PBR/environment parity remain unported. No global lights or IBL are added to the
production scene, and no car-grounding plugin is attached to this material.

## Ownership and qualification

`src/engine/babylon/start-gantry.ts` verifies the immutable payload before decode,
stages resources off-scene, uses existing GPU preparation ownership for decode
and geometry uploads, drains compilation before returning an owner and requires
two completed presentation receipts during installation. Cancellation, stale
owners, scene disposal and construction failures cannot publish stale content.
A resource ledger drains independent assets despite skipped scene observers or
throwing disposers, while preserving primary and falsy thrown errors. Actual
active diagnostics are distinct from retained reference inventories.

The CPU tests compare to unchanged original construction, not merely raw GLB
coordinates. Review reproduced eight lifecycle failures in the initial candidate;
those were fixed before publication. Focused tests cover genuine cancellation,
late decode after lease invalidation, repeated installation/disposal, partial
cleanup failures, exact data/placement and strict eligibility.

`tests/fixtures/a07-atlas-pixels.json` is an independent pre-edit pixel oracle:
Pillow 13.0.0 decoded each original embedded PNG to top-down unpremultiplied RGBA8
without ICC conversion. The images are opaque and contain only IHDR/IDAT/IEND
chunks. Compressed PNG hashes and role/image indices are checked against the
original GLB; no source texture is changed.

Three isolated GPU cases cover native-default uniforms, safe UBO-disabled mode,
and context loss followed by a fresh-context restart. Each case retains one
absolute 120-second deadline. They must establish real GLB/PNG decoding, matching
original geometry/world placement, actual linked/bound effects, six front/rear/
detail views, complete resource ownership and no stale insertion. Browser CPU
PNG decode and native GPU readback must both match the independent original
per-role pixel hashes and each other byte-for-byte, with no flip search or gamma
reinterpretation. Image comparisons are data-preservation evidence, not a claim
of final lighting/PBR parity.

**Real GPU execution and screenshot review are pending.** No live activation
follows from NullEngine, type/build checks or test discovery. Existing source
`f996583` platform results remain historical: Windows/macOS passed, Linux remains
unqualified. The retired Mesa diagnostic is not restarted by this work.

Final local checkpoint checks passed: 434 affected tests across 37 files,
complete ESLint, TypeScript/Vite production build, fixture bundling/formatting,
read-only workflow selectors and discovery of 18 GPU journeys (three new A07
cases). These are not GPU execution or live-entry acceptance. Original renderer,
simulation and public asset paths have no diff.
