# Original A07 start-gantry adapter · isolated qualification

This work belongs only to `babylon-js`. `main` remains the exact restored
pre-migration snapshot. The isolated adapter passed on `b27d585`; the live startup integration below
has passed exact-source GPU and Windows/macOS checks; Linux remains failed.

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

**At the initial checkpoint, complete GPU qualification was pending.** The later
`b27d585` result below closes that isolated gate. No activation follows solely
from NullEngine, type/build checks or test discovery. Existing source
`f996583` platform results remain historical: Windows/macOS passed, Linux remains
unqualified. The retired Mesa diagnostic is not restarted by this work.

Final local checkpoint checks passed: 434 affected tests across 37 files,
complete ESLint, TypeScript/Vite production build, fixture bundling/formatting,
read-only workflow selectors and discovery of 18 GPU journeys (three new A07
cases). These are not GPU execution or live-entry acceptance. Original renderer,
simulation and public asset paths have no diff.


## First GPU result and fixture colour-space correction

Exact `2a19b5a9fac0337fcbafdfb744f83f1326200380` passed all fifteen retained
GPU journeys, but all three new A07 cases failed the texture-metadata predicate
in [run 41298826385](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41298826385).
They reached this predicate after exact original CPU/GPU pixel checks, geometry,
material and linked-program checks; each retained three first-cycle views. Later
repeat/disposal/context-loss assertions were not reached, so remain unqualified.
The failed report omitted the partial receipt, preventing direct inspection of
the actual flag that failed. Artifact `13080902463` SHA-256:
`be80beef4dc8182799621484daef5e047d0ce859afc5e7099908ff40c6673275`.

Pinned Babylon's `BaseTexture.gammaSpace` returns the semantic gamma tag AND
NOT hardware-sRGB storage. The old test incorrectly required it to be true for
base colour even when hardware already performs decoding. A fixture-only
correction records semantic tag, hardware storage, effective getter and actual
compiled defines; it requires exactly one hardware/shader base-colour decode,
with no gamma on normal/metal data. Native `#ifdef` macro presence is respected
even for a zero-valued definition. All exact pixel/data/lifecycle/deadline gates
remain unchanged, and partial receipts are retained before assertions.

Real pinned-getter regressions demonstrated the invalid expectation (four tests
failed before correction). The corrected helper and existing loader/atlas tests
pass 37 focused contracts. The archived result alone does not prove this was the
sole runtime defect; a fresh receipt-bearing GPU run is required. No production
asset, material, loader or live-entry change is made for this correction.

[Native run 41298826397](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41298826397)
passed on Windows and Apple Silicon with the full four existing-content journeys.
Linux retained the known pre-import presentation stall/GPU exit 512. A07 is not
live in that source, so these are not A07 native-rendering passes.


## Receipt-bearing GPU result: generic flags are not data-map transfer functions

Exact `da7ea87a53a2e2f6c269657715516b3c21c351bd` again passed all fifteen
retained GPU journeys and failed the three A07 cases in
[run 41301759966](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41301759966).
The new partial receipts establish the precise failure:
`A07 normal data texture semanticGammaSpace must be false; got true`.
Artifact `13082038170` is 33,576,799 bytes, SHA-256
`1194b98c9b1483e1d34f4c5edf1f5ca7319e564a7e55863c45c16c29a95cf24a`.

All three cases retain exact original CPU/GPU pixels for all three atlases.
Base colour uses hardware sRGB (`_useSRGBBuffer=true`), generic cached gamma
flag true, effective getter false and no `GAMMAALBEDO`. Both normal and metallic/
roughness textures have hardware sRGB false, but their generic cached gamma
flags and getters are true. Four bound, linked programs have `BUMP` and
`METALLICWORKFLOW`, with no `REFLECTIVITY_GAMMA`.

The pinned glTF loader marks these data maps `nonColorData`, disabling hardware
sRGB storage. The PBR bump path reads raw XYZ, and the metallic workflow explicitly
disables reflectivity gamma conversion. The generic texture gamma property is
not a transfer-function requirement for those slots. Requiring it to be false
was another invalid fixture assumption, not evidence of altered original pixels.
The corrected fixture validates hardware-linear data storage plus actual compiled
PBR sampling macros and native samplers, and rejects alternate data-map paths.
The cached flag is named `diagnosticGenericGammaSpace`, not a claimed slot transfer function.
All exact pixel, geometry, ownership and deadline checks remain. No production
texture property is rewritten to satisfy the test.
Repeat/disposal/context-loss qualification is still blocked behind this assertion;
the A07 owner remains absent from the live entry.

[Native run 41301759887](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41301759887)
passed Windows and Apple Silicon existing-content journeys. Linux failed after
model presentation with a pending draw and GPU-process loss. These builds share
production fingerprint `50d27194329d479c03e2a407d0df53717727904e43bea3c5fb77052fc4f66972`
with the preceding checkpoint. A07 is not live, and these native results neither
qualify A07 rendering nor establish a new cause for the Linux failure.

Offline replay of all three archived complete texture/program receipts passes the
corrected sampling predicate. The front and ladder-detail captures show the
original structure intact; all three transports share the same captured image
files. This is inspection of the failed run, not fresh lifecycle qualification.

Correction checkpoint: all 428 contracts in the GPU workflow's local CPU selection
passed (41 files), including 40 focused loader/atlas/gamma contracts. Full lint
and TypeScript checks passed. Fresh GPU execution is still required before any
live-entry activation; replay and NullEngine tests are not substitutes.


## Isolated qualification passed on b27d585

[GPU run 41304298334](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41304298334)
passed all **18/18** journeys and **428/428** CPU contracts for exact
`b27d5852dd12666e2e16138c382da400e1d3faa5`. Artifact `13082823809`
is 15,145,296 bytes, SHA-256
`e971fe03570a10704990b0fbf9d7ba46b295b969f95a27f2ac988c05a98151a1`.

All three A07 cases now reach repeated installation, complete disposal and
baseline restoration. Native UBO and forced-standalone each complete two cycles;
the context-loss case completes two cycles, loses its real context and completes
two more cycles on a fresh context. Every cycle records nine completed frames,
exact original position/normal/UV/index/world arrays, exact independent PNG/GPU
hashes, four linked and bound original-part effects, and zero GL errors.
Resource disposal notifications occur once each, and scene resources return to
the original baseline (including the retained shared BRDF texture).

Front, rear and ladder-detail images have been inspected. This establishes
original structural/data preservation and the bounded lifecycle, not final
lighting, shadow, banner, lamp or environment parity. In-game startup is a
separate integration gate, not implied by this isolated pass.

[Native run 41304298346](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41304298346)
passed Windows and Apple Silicon full existing-content journeys. Linux failed
after model presentation with a pending draw and GPU-process exit 512. The
production fingerprint remains unchanged from the previous isolated checkpoint;
A07 is not live in `b27d585`. No all-platform release qualifies.


## Live startup integration

`GantryPreparation` stages the qualified original A07 structure only after the
existing circuit surface preparation completes, under the same absolute startup
deadline and GPU owner. Compilation keeps normal draws suppressed; installation
allows its required ready-frame receipts. Public scene-ready/presentation-settled
state and optional car loading wait for gantry completion. A paused startup
requests the presentation needed to expose readiness, without changing input or
simulation authority.

Canonical Aurel Formula receives four LOD0 parts, one original PBR material and
three source textures. Other contexts remain ineligible with no fetch. The six
`gantry*` status fields are derived from actual bound resources and the original
asset digest; browser and packaged-app checks now require those fields. Restart,
context loss and errors clear them. Explicit owner cleanup still runs if scene
cleanup throws; pending/stale ownership cannot publish into the replacement.

Local candidate lifecycle/native-receipt/gamma contracts passed 41/41; full lint,
TypeScript and production build passed. The npm wrapper's ancillary registry
request was blocked by the local network policy; the existing installed toolchain
completed the same offline generator/typecheck/Vite stages without any download
or security change. Exact live-source results are recorded below. Original
asset, Three construction, simulation and physics data are unchanged. Banner,
lamp behavior, weather, shadows, occluders and runtime LOD switching remain open.

After applying to the current migration checkpoint, the final combined selection
passed 460/460 contracts across 43 files; complete lint, TypeScript and the
production build passed, and all 18 GPU cases were discovered without executing
a local browser. These results precede exact live-source CI qualification.


## Live GPU qualification on 9c3b04b

[Run 41306459287](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41306459287)
passed **18/18 real-WebGL journeys** and **440/440 CI contracts** for exact
`9c3b04bdf21a2cdc115edc39521d22436e52994c`. The local 460 count additionally
includes 20 native-smoke receipt contracts. Artifact `13084041150` is
15,161,807 bytes, SHA-256
`ac8c519fb19783c41b2eff8532adbe921f29a912088d8280670034f5dc4602d2`.

The live surface receipt contains gantry ready, four parts, one material, three
textures, 9,520 triangles and the original asset hash, with 27 completed frames
and scene readiness true. The in-game preview shows the original structure over
the road. Context loss and browser restoration leave readiness false, loading
disabled and all surface/gantry receipts cleared until explicit rebuild; the
existing recovery/restart journeys pass with the new gantry readiness gate.
The original authored car import and all retained renderer comparisons pass.
This remains SwiftShader evidence, not physical GPU or final visual parity.


## Live installed-app result

[Native run 41306459321](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41306459321)
for the same `9c3b04b` source is terminal:

- Windows x64 passed the full installed-app and four compatibility journeys,
  with 36/36 completed Babylon draws and no context loss.
- Apple Silicon macOS passed the same journeys, with 25/25 completed draws and
  no context loss.
- Linux x64 passed the actual gantry readiness receipts (4/1/3 resources, 9,520
  triangles, original hash) and presented the original car, then failed a
  15-second wait followed by GPU-process exit 512. At loss, 413/413 preparations
  had completed and draw 21 remained pending after 20 completed draws. This is a
  failed platform result; similarity to earlier post-model failures does not
  establish causality or prove the live change is irrelevant.

All three reports identify production fingerprint
`08ee14c13229e8f9fbe7a217f3f3260b5706407621eb178c29cfb37e43b34f1a`.
Windows/macOS packaged screenshots show the original Formula car and gantry over
the original road, without obvious missing or duplicated structure. The gantry
is partially obscured by the diagnostic UI; isolated images provide detail.
No all-platform release, physical-hardware certification, full PBR/environment
parity or complete Babylon conversion follows from this milestone.
