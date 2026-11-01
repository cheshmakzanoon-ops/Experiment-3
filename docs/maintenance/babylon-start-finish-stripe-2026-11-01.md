# Original start/finish stripe · migration and qualification

Work belongs only to `babylon-js`; main remains frozen. The isolated adapter passed `e5609e7`. This checkpoint adds live startup after
the shared gantry/lamp/banner presentation batch; combined runtime qualification
is pending. The original owners remain independent.

## Original data and bounded scope

The unchanged original construction is `src/rendering/circuit.ts:993–1007`:
a 128×32 canvas with sixteen columns and two rows, using 8×16 rectangles in
`#e8e5da` and `#242b29`. The original plane spans twice the station-zero track
width and 1.2 metres longitudinally. Its placement is the original station-zero
position plus 15 mm, with the original Euler rotation.

The adapter reuses the original `canvasTexture()` and `batchScene()` CPU helpers.
It retains actual post-batch Float32 positions/normals, indices and UVs, not just
an approximately equivalent unbatched world transform. The native world is
identity after the original bake. Explicit CCW orientation and front-side
culling preserve the original face. Material values remain white, roughness
0.8 and metallic 0, with opaque alpha and unchanged depth test/write behavior.
No polygon offset is invented.

The original stripe has its own material. It is **not** the grid-paint material
and has no circuit-finish, vehicle-grounding or weather tag. The adapter adds
none of those effects, no back-face plugin and no new lights or simulation writes.
The original source's cast/receive-shadow flags do not establish Babylon shadow
parity; that remains unqualified.

Original canvas pixels are row-reversed once for explicit RawTexture upload with
invertY=false and required hardware-sRGB allocation. Original mipmaps,
trilinear/linear filtering, clamp wrapping and anisotropy request 8 are preserved,
with the device cap respected. Unsupported storage must fail rather than silently
substitute a shader-gamma approximation.

## Ownership and CPU contracts

`start-finish-stripe.ts` owns one texture, one material and one plane under the
existing GPU preparation and completed-presentation protocol. Staged allocation,
independent cleanup, stale/cancelled work, partial failure and falsy cleanup
errors are covered. Diagnostics require actual active bindings. It must never
dispose the road or the other gantry components.

Twenty-one dedicated CPU contracts compare an independent unchanged-production-
source oracle, original drawing commands and actual original batching output.
The initial affected selection passed 57 tests, with full types, owned-file lint
and production build. An initial build ended with exit 137 while other typechecks
were active; its evidence is retained and the unchanged build subsequently passed.
Final combined fixture/source typecheck passed. CPU canvas and fence mocks do not
qualify real GPU sampling, driver behavior or frame timing.

## Isolated GPU qualification contract

The isolated fixture uses the same original canvas for the original reference
and native upload, with actual source-batched geometry. Three cases cover native
UBO, standalone uniforms, and context loss/fresh restart under the unchanged
120-second case deadline. A fourth required matrix shard is additive: all 25
previous journeys and their aggregate gate remain required.

The fixture requires exact native upload/readback bytes, actual sRGB storage,
sampler/mipmap witnesses, fixed overhead/minified/oblique views, complete coverage
comparisons and an exact reference repeat. The underside control requires actual
completed draws with CCW/front-side culling and zero covered pixels; an empty
canvas without a draw cannot pass. Factor limits remain declared before execution,
not tuned to a candidate image.

Bounded road co-presence uses original road geometry near the stripe and nine
predeclared interior patches. The road-only view must be opaque and differ from
the checker so a hidden stripe cannot pass vacuously; road-plus-stripe must match
the isolated original reference at those points. The original 15-mm placement and
normal depth rules stay unchanged. Independent disposal must leave road geometry
and ownership intact.

Actual car-crossing occlusion is **not tested** by this bounded fixture; no proxy
car is used to claim original-model acceptance. Cross-mode eligibility, final PBR,
lighting/shadows and physical-GPU performance remain separate gates. The initial GPU run failed the depth oracle described below. Its correction and
the later live-startup checkpoint are recorded separately.

## Combined branch preparation

On top of the paused-handoff implementation, the full active native/GPU contract
selection passed **1,233 tests across 95 files**. Full TypeScript, the project's
full lint command and production build passed; the existing chunk-size warning
remains. Formatting and YAML parsing passed. Offline discovery confirms all
**28 cases in nine spec files**, including every previous case and the three new
stripe cases. This is test discovery, not GPU execution. Independent final review
confirmed the four stripe files match the reviewed candidate and the new shard
is additive, required and read-only.

## First real GPU result: `a68a1ba` — failed depth oracle

[Run 41332598102](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41332598102)
failed all three stripe cases at the first road-co-presence patch, not in the
isolated sampling/culling stage. Artifact 13094207129, SHA-256
`fa2b0a07a6f1fab1cb71776338e7213c5af833d05076b27c96e02cf324a5c305`,
retains the failed receipts and images. At the unchanged first patch (-7, -0.3),
the composite differs from the isolated stripe by 70 RGBA codes while remaining
opaque. The error value `glError: -1` means that assertion occurred before the GL
query; it is not an observed GL error.

All 27 preceding factor rows have zero reported error/coverage difference/GL
error. Twenty-four attached factor-image pairs independently decode to exact
RGBA equality. Original geometry/material/15-mm placement contracts and hardware-
sRGB bytes/samplers passed before this boundary. One cycle completed; the later
co-presence cycle aborted, so its loss/restart and remaining cleanup checks are
not claimed as passed.

The fixture incorrectly assumed the stripe stayed visible at every fixed patch.
Independent interpolation of the original source road triangles gives road Y
0.02166193049 m at the first patch, above the original flat stripe Y 0.015 m by
6.662 mm. The captured road-plus-stripe image shows corresponding partial
occlusion. This supports an invalid all-visible expectation; it does not justify
raising the stripe, changing the road/camera, dropping patches or widening limits.

The correction must compare against an independent original **Three road plus
stripe** composite at the same fixed patches, with original repeats, road-only
and stripe-only witnesses, and source-triangle visible/occluded classification.
Both visible and occluded samples must be exercised. Until that GPU oracle passes,
the adapter remains isolated and unqualified for live activation.

## Corrected independent depth oracle

The reference correction retains all nine fixed 3×3 patches (81 pixels), the
rendered camera matrices, original plane/road geometry, 15-mm placement and
existing maximum 2-code / mean 0.25 factor limits. Source-only Three triangle
rays predict **54 visible and 27 occluded pixels**, with a minimum separation
of 2.874 mm; missing hits or separation at/below 10 micrometres fail rather than
silently defaulting to visible. Pixel centres and bottom-origin readback are
explicit. Near/far metadata is synchronized with the already shared rendered
projection for the CPU ray calculation; the rendered matrices are not changed.

An independent Three road allocation comes from the original ribbon producer,
not Babylon buffers. Its fixture-local magenta output isolates geometry/depth,
not original road PBR shading. The actual Three composite and road-only image
must repeat exactly after completed draws and confirm every source classification.
Visible native samples must match the original stripe-only reference; occluded
native samples must match the actual native road-only witness. Both classes,
opacity, distinct witnesses and all 81 samples are required. Full composite
alpha coverage is also checked, with at most eight boundary differences and no
partial alpha. Full composite RGB/PBR equality is deliberately not claimed.

Temporary reference resources use idempotent disposal, with primary errors
preserved. No production adapter, geometry, material, camera placement, clipping
matrix, polygon offset or shader tolerance is adjusted. Earlier sampling,
culling, cancellation, disposal and context-loss/restart gates remain required.
The corrected oracle requires its own new GPU execution; CPU agreement alone is
not a passing renderer result.

The original `a68a1ba` GPU run finished with 25 retained cases passing and all
three stripe cases failing; the aggregate correctly failed. Retained artifact
13095105076 has SHA-256
`81904b2aa62c567b323715a3db643ff24e5ad142f5796394e976f9bf2dfa3015`.
The existing early-pause receipt kept tick 697 fixed through readiness and
advanced to 706 after resume. The corrected two-file fixture/spec passed fresh
TypeScript, focused lint/format, three-case discovery and IIFE bundling; 24
applicable CPU/workflow contracts passed after applying the patch. This does
not replace the required new real-GPU result.

## Corrected isolated qualification: `e5609e7`

[Run 41334739498](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41334739498)
passed all **28 cases**, every required shard and aggregate check 124936790334.
All three stripe cases passed, including actual context loss and a fresh restart.
Across four executions, each reports 16 zero-error factor rows and all 81 fixed
co-presence samples: 54 visible, 27 occluded, zero conditional color error, zero
coverage mismatch and exact original composite/road-only repeats. Factor-stage
GL errors are zero; intentional context loss remains a separate test event.

The runtime source-ray minimum triangle separation is 0.0027179287875 m. The
separate offline source calculation was 0.0028737623316 m; these are not described
as identical measurements or used to claim a camera change. Both exceed the
predeclared ambiguity rejection threshold and produce the same classification.
All 60 common PNG attachments between the old failing and corrected runs are
byte-for-byte identical, including the isolated factors and unchanged native
road composite. The old failed receipt did not store projected pixel indices,
so those indices cannot be directly compared retrospectively.

Original 128×32 hardware-sRGB allocation, uploaded bytes, samplers, front-face
culling, cancellation and independent cleanup checks passed. Mesh disposal and
resource-baseline restoration are distinct from hardware texture deletion;
the latter is deliberately not queried after context loss. Restart uses a fresh
context. Actual original/native composite images were inspected and show the
same partial-occlusion silhouette. No production geometry was raised or altered.

Verified artifacts:
- Stripe 13094986457:
  `067bb9ac83df16649e49f600d55ae0950e58c81ea62a4bb27fcca6dc1a7c5822`.
- Retained 13095087863:
  `1710b0a9400b82d51921f4e4aa49e8470172cd46721f311736ac202ffe993768`.
- Lamps 13094728912:
  `b8ce726f50df87b4335dcb8463fde4655b32984abd493a04ef2e5489c7208038`.
- Banner 13095311975:
  `1a6951fa00b1633832a57fa3d01e20c1321625ea61b83a971a69e36690ddc8a5`.

This is **SwiftShader software-WebGL isolated qualification**. The retained live
scene's early-pause tick 702 stayed frozen through readiness and resumed to 706,
but that scene did not yet import the stripe. Live startup, packaged/native
rendering of the stripe, car-crossing occlusion, final PBR and physical-hardware
performance require their own evidence. Fixture-only source changes did not run
a new native workflow or repair the prior Linux startup repeat failure.

## Live startup after the shared environment batch

`StripePreparation` now runs only after the existing gantry/lamp/banner batch has
completed. It retains its own preparation ownership and requires two fresh ready
GPU completions; it cannot reuse the batch's receipts. The original absolute
startup deadline and native 30-second paused gate are unchanged. The final paused
redraw remains, and optional car loading waits for stripe readiness as well.

Actual resource validation requires one bound part/material/texture, two
triangles, 128×32 storage and hardware-sRGB. Both readiness whitelists, native
receipts and browser pause/loss/restart assertions include these fields. Scene
replacement and teardown dispose the stripe independently and clear stale state.
No original geometry, canvas, material or physics is changed by this integration.

The combined source passed **1,285 CPU tests in 97 files** and independent review;
its source-level handoff case observes surface1–2, props3–4, stripe5–6 and final
paused presentation7. These controlled receipts do not establish actual frame
counts or startup time. Exact-source live GPU/native checks remain required.
Car-crossing, final PBR/shadows and physical-device performance stay unqualified.
See [combined startup ownership](babylon-environment-batch-2026-11-01.md).

## Live result: `f0ca199`

The combined live checkpoint passed all 28 GPU cases and Windows/macOS packaged
checks, including four compatibility journeys each. Actual stripe receipts and
screenshots confirm the original 128×32 checker alongside the banner and car.
Linux reached all-assets-ready but its last presentation fence missed the
unchanged first-pause deadline. See [exact combined results and artifacts](babylon-environment-batch-2026-11-01.md).
This is not all-platform release or final-PBR/hardware qualification.
