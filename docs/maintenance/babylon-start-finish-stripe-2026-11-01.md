# Original start/finish stripe · isolated candidate

Work belongs only to `babylon-js`; main remains frozen. This component has no
live startup import. The existing road, gantry, lamps and banner keep their owners.

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

## GPU qualification required before activation

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
lighting/shadows and physical-GPU performance remain separate gates. No GPU run
or live activation is claimed for this candidate yet.

## Combined branch preparation

On top of the paused-handoff implementation, the full active native/GPU contract
selection passed **1,233 tests across 95 files**. Full TypeScript, the project's
full lint command and production build passed; the existing chunk-size warning
remains. Formatting and YAML parsing passed. Offline discovery confirms all
**28 cases in nine spec files**, including every previous case and the three new
stripe cases. This is test discovery, not GPU execution. Independent final review
confirmed the four stripe files match the reviewed candidate and the new shard
is additive, required and read-only.
