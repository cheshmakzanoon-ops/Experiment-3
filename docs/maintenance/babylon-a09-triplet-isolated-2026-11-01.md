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
