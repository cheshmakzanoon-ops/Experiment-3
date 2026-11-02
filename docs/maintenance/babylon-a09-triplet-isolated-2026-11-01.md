# Isolated A09 first braking triplet

Originally developed against `57d5a475`, then combined and checked on exact
`6f6812b5`. This checkpoint includes an isolated GPU fixture and additive sixth
required shard, but no live import or scene activation. CPU/build results are
not GPU/native qualification.

## Original source identity and selected scope

The unchanged `public/models/aurel-track-boards.glb` is 676,084 bytes with SHA256
`5a2886f0454fafafc85de772e272eb26ace69722e714ecde2d3da6a983ee1555`.
The original A09 manifest and strict GLB document/hash checks remain authoritative.
Only the first clean braking-board triplet is selected: labels 150/100/50 at
Aurel stations 420/470/520, lateral −18, fixed LOD0. The original producer contributes
six meshes and 4950 triangles, one structural atlas material with three embedded
maps, and three original print materials/textures. This is not the complete
18 braking boards plus two sector boards, nor a replacement LOD policy.

Unchanged `TrackBoardsKit.build` supplies template node-world baking, original
track placement, weighted-foot conformation and recomputed normals. The selected
buffers already contain world placement; their source matrixWorld is preserved
without another parent transform. The original board root is excluded from the
original parent batching, so no new batching or geometry approximation is added.

The actual native GLTF container supplies the authored atlas material and its
base/normal/metallic-roughness maps. Atlas anisotropy is explicitly set to the
original Three default 1 rather than Babylon's default 4; print anisotropy stays
at the original 8. The independent CPU oracle pins the original defaults and
raw glTF clamp/trilinear sampler, not candidate-derived expected values. The temporary Three atlas placeholders are
used only for CPU geometry construction, never transferred or presented. Native
source nodes/geometry are independently retired while retaining their original
atlas ownership. Original stroke-font Canvas2D print production remains unchanged:
256×256, original colors, roughness 0.72, FrontSide and polygon offset −1/−1.
Opaque source rows are reversed for the existing hardware-sRGB raw-texture path;
no recoloring, alpha substitution, system font, shader approximation or global
material/gamma changes are introduced.

## Lifecycle and evidence boundary

The owner requires canonical dry clear/nonflat Aurel Formula context. Native
decode, texture and geometry allocation stay under the existing exclusive GPU
lease; every actual material is prepared, then off-scene installation subscribes
to two fresh actual ready completions under the original absolute deadline.
There is no live shared-cohort insertion in this checkpoint.

An explicit exact-allocation ledger independently drains meshes, geometries,
materials, textures and container observers. Mesh disposal first detaches geometry
without disposing it; the ledger separately disposes owned geometry and never
adopts an externally substituted geometry/material/texture. Existing shared BRDF
identity is not owned. Active diagnostics require actual scene registration,
visibility and original material/geometry binding; retained counts describe the
owned resources, not foreign replacements. Cancellation drains the active compiler,
late decode ownership is reclaimed, and falsy primary failures remain primary.

The narrow synchronous scene-instance constructor interception restores exact
prior method descriptors. It covers pinned registration-delegate failures and
the known pre-PBR Material.Created boundary, not arbitrary OOM/vendor-constructor
phases. No prototype/vendor/global production patch or fabricated disposal marker
is used. A foreign-scene decoder container is rejected before adoption.

CPU tests independently decode raw GLB accessors/node transforms, verify original
kit geometry/foot placement and raw material roles, and compare original stroke
drawing commands. Canvas pixel-transfer tests use explicitly synthetic RGBA to
prove exact row transport: they do not establish real rasterization, color,
normal-map, hardware sRGB or GPU parity. CPU allocation seams are not GPU evidence.

Wet weather hooks, shadows, worn/sector variants, full PBR appearance, live LOD
selection, production startup timing and native Electron qualification remain
excluded. Actual isolated GPU reference work is a separate later checkpoint.

## Combined fixture and local verification

The isolated browser reference uses the unchanged original TrackBoardsKit and
hash-pinned GLB, with original selected print canvases. Fixed front/back/grazing
views cover all three boards. Original and native uninstrumented PBR draws first
establish actual texture allocation/binding and sampler state; factor shaders
may optimize unused maps away, so they are not used to infer those allocations.
Full PBR screenshots are evidence, not an exact lighting-parity assertion.
Albedo/view-normal comparisons retain their fixed two-code/0.25-mean limits,
coverage checks, original repeats, CCW/depth/polygon-offset witnesses and original
120-second shared case budget. UBO, standalone and context-loss/fresh-restart
cases retain partial evidence before assertion failures. No local GPU ran.

The exact combined checkpoint passed 937 workflow-selected tests across 61 files,
full types, canonical ESLint, production build and discovery of 35 cases across
11 specs. The owner separately passed 58 focused checks. Existing five GPU shards
and deadlines remain intact; the sixth adds only this isolated triplet. Actual
GPU results remain required before any live integration or visual-parity claim.

## First actual GPU result: `1c1109de` (2026-11-02 UTC)

[Run 41364555932](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41364555932)
finished with all 32 existing cases passing and all three new A09 cases failing.
Each stopped at cycle zero, board 150, rear linear-albedo comparison: maximum
channel error 3 exceeded the unchanged limit 2. Mean error was 0.0006131 across
33,164 interior pixels; coverage errors and GL errors were zero, and the original
reference repeat was exact. Front albedo and front view-normal passed at maximum 1.
Later boards, grazing views, normal-disposal qualification and actual loss/restart
checks were not reached and remain unqualified; failure cleanup is not a substitute
for those acceptance checks.

All six original geometry/world bindings (4,950 triangles), six raw texture byte
comparisons, original/native PBR sampling witnesses and cancellation gates passed
before the failure. Full PNG inspection found 30 changed pixels, 24 interior;
nine over-limit red differences were confined to PNG x446/y165–173, an internal
rear-support strip (original red49, native46). The two matrices supplied to the
reference/native cameras are element-identical. Different transform arithmetic,
internal coverage/interpolation and generated mip contents/selection remain
hypotheses, not established causes or grounds to alter cameras/limits.

A09 artifact 13107276507 SHA-256:
`acadfe4e1a5abc2449b116935255e80231eabbbdb2b4a183ee9bf38adc73c21e`.
All 380 prior isolated PNGs remained unchanged, and both existing strict unmasked
reset/resize proofs still passed. A09 is not live and no visual parity is claimed.

CPU source-ray classification identifies original triangles 433 and 1245 on the
failed strip, with ideal isotropic LOD approximately 4.232. Nearest/back-face gaps
range from 9.183 mm to 0.395 mm, without an exact ray-depth tie. This is double-
precision CPU evidence, not the actual GPU triangle winner, derivatives or LOD.

## Bounded evidence extension, not a rendering fix

The next fixture-only change records actual submitted attached GLSL (not driver-
translated output), ordinary matrix uniform reads, and separately labeled CPU
mirrors/UBO-unread state stamped at the actual draw. It reads existing mip levels
without regenerating or changing them; hashes cover the existing chain and only
bounded level4/5 bytes are retained. Framebuffer/read/pack/PBO state is restored.
Pre-existing rendering errors and diagnostic read failures remain distinguishable.
The original exact views, geometry, source reference, limits, failure and budgets
stay unchanged. Fresh execution is required to obtain this evidence; the extension
does not establish a cause or fix the known failing comparison.

[Native run 41364555962](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41364555962)
passed Windows/macOS full Babylon and all compatibility journeys (46/46 and39/39
draws). Linux passed initial6/6 and reused-reset12/12, then model movement, but
GPU loss prevented final model readiness before any compatibility journey.
All platforms retained component2/scene1 reuse and311 preparations. A09 is not
imported into live startup, so these results do not qualify or implicate it.
Verified artifacts: Linux13106389201, Windows13107272055, macOS13107550056.
Fingerprint: `1417da1bc1d659a54e6379f4e1b3cb0dc5e5ca4cd5eeda38a3e01ad47ad05d89`.

The frozen one-fixture diagnostic extension passed full TypeScript, focused lint,
IIFE bundling and discovery of all 35 cases, with independent source review.
No production owner or material changed. The original failing max2 comparison
remains before diagnostic-completeness assertions; diagnostic collection cannot
turn its failure into a pass. No local GPU execution occurred.

## Captured diagnostic evidence: `41de2bb9`

[GPU run 41366976040](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41366976040)
reproduced the same three A09 failures at board150/rear albedo. All 36 partial
A09 PNGs were byte-identical to the initial run. Rendering/observation errors
were zero. All ten native/original mip hashes matched exactly, including the
captured level4/5 bytes. Submitted shaders and standalone bound matrices were
captured successfully; UBO-unread state and draw-stamped CPU mirrors remain
separately labeled. Verified A09 artifact 13108090954 SHA-256:
`78cb57e30157259933a60358275853fec82d9dc4c65e282d40b56a1c0523e88f`.

A concrete shader declaration difference exists: original Three explicitly
selects highp sampler2D, while native albedoSampler is unqualified with no sampler
default statement. The [GLSL ES3 specification](https://registry.khronos.org/OpenGL/specs/es/3.0/GLSL_ES_Specification_3.00.pdf)
sections4.5.4 and8 state the sampler default and texture-result precision rules.
This supports a testable precision hypothesis, not proof of the pixel-error cause.
CPU interpolation/filtering using the actual matrices, source vertices and mip
bytes did not reproduce the observed red49-versus46 difference; it is not driver
emulation and does not justify changing projection arithmetic.

## Single-variable precision experiment

The next fixture-only experiment renders baseline A, explicit highp native albedo
sampling B, then restored A. It changes neither original reference nor camera,
geometry, texture/mip data, filtering parameters, limits or deadlines. A material-
local shader hook and otherwise-unused diagnostic define separate the effect-cache
keys without mutating global shader stores/caches or the production owner.
Actual submitted shaders must differ only by that define and sampler qualifier;
B must have a different effect/program. Restored A must recover the original
program and exact full image. Matrix values, print program and mip evidence must
remain unchanged. Callback descriptors and flags are independently restored.
The original baseline max2 assertion stays authoritative; a diagnostic B result
cannot qualify baseline rendering or replace the original failure. Causality and
any production repair remain pending actual execution.

The frozen A/B/A fixture passed full types, focused lint, IIFE bundling and
35-case discovery, with independent review. Only that fixture changes executable
test code; no production owner/material, original reference, camera or acceptance
limit is changed. Actual experimental results remain pending GPU execution.
