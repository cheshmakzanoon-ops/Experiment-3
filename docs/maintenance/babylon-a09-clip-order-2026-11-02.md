# A09 original clip-transform order

Historical base `8ce503c31f67a06c57bf7629217fedbd185acf9c`. This adaptation was
initially isolated to original A09 first-clean-triplet LOD0 ownership. Subsequent
isolated qualification is recorded below; [live integration](babylon-live-a09-2026-11-02.md)
now has separate pending rendering and native acceptance gates.

## Evidence and scope

The unchanged strict original-factor gate failed on the 150 rear albedo view:
maximum error 3 rather than the allowed 2. The original repeats were exact,
coverage matched, and all ten source/native albedo mip levels matched. Actual
submitted GLSL and ordinary matrix readbacks exposed different arithmetic grouping:
native combined view-projection versus original projection after view.

The sampler highp A/B/A control in `80a0c3f` changed the actual program but no pixels.
In `8ce503c`, changing only native atlas clip grouping produced maximum error
3 → 0 → 3 in all three attempts, with original matrices, mip contents and sampling
unchanged and actual original program/pixels restored. This establishes sensitivity
to clip grouping for that rear view/backend; it is not qualification of later
views, print depth relationships, loss recovery, live startup or native Electron.
All earlier failed evidence remains authoritative.

## Component-local adaptation

`A09ClipOrderPlugin` is attached only to the retained structural atlas and three
original print materials before the existing material preparation. It replaces
only the pinned ordinary projection assignment, before dependent clip/log-depth
work, with `projection * (view * worldPos)`. Original mesh world positions are
already baked and remain frozen identity-world; UVs, normals, textures, sampler
settings, colors, polygon offset, physics, camera framing and budgets are unchanged.

The supported material-plugin API registers two ordinary matrix uniforms for both
native UBO and standalone material modes. Extra-event hard binding updates them
from the current scene on every draw, independently of material-cache rebinds.
No global shader store, vendor source, camera, or persistent external hook is changed.

Only exact owned same-scene mesh/material/geometry bindings are accepted. Nonidentity
worlds, parenting, instances, skinning, morphing, multiview/rig cameras and WGSL
are outside this bounded path and fail closed. Pinned shader identity/anchors are
checked before registration and at shader composition. Disposal invalidates all
four plugins before independently draining the existing exact resource ledger;
materials retain normal ownership of plugin teardown.

## Pending acceptance

CPU/source tests cannot certify rasterization. The complete unchanged isolated
GPU fixed-view/factor, print offset/depth, resource disposal and loss/restart suite
must qualify the actual production plugin on all four materials and both transports.
No tolerance, mask, camera, quality, test budget or early-readiness change is allowed.
Full PBR appearance, wet weather, shadows, complete board sets, sectors and dynamic
LOD selection remain unqualified and excluded.

## Frozen local verification

The exact owner plus qualification fixture passed 978 workflow-selected tests
across 62 files, full TypeScript, canonical project ESLint, production Vite build,
IIFE bundling and discovery of all 35 cases. The owner separately passed 90
focused checks. These selections overlap. Source hashes remained unchanged
through the final combined run, and independent review found no source blocker.

Initial test-setup failures and three genuine partial-super-constructor cleanup
failures are retained. The latter now require falsy primary preservation and
normal native material UBO/disposal notifications exactly once after registration
throws. No local GPU or full production-plugin visual pass is claimed.

## First production-plugin attempt: `1f1be9d3`

[GPU run 41373827088](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41373827088)
failed all three A09 cases before factor/image comparison. The fixture incorrectly
looked for raw `#else`/`#endif` delimiters in the submitted shader after Babylon
preprocessing had removed them. Captured actual shaders contain the correct
production grouped assignment, marker and ordinary declarations; the linked
program and other source checks passed. This is a stage-attribution error in the
test, not evidence of a rendering pass or a production-image defect. Later
fixed views and lifecycle stages remain unqualified.

Verified A09 artifact 13110831092 SHA-256:
`a47c64a657a3bd7dd34a5938b733799cb290f7bf43395d56fe31b62ae8656643`.
Production raw-template anchor validation remains unchanged. The fixture-only
correction instead requires the unique intended submitted assignment, ordinary
uniforms/marker and no old, duplicate, component or malformed position writes.
It retains all actual matrix, binding, image, depth and lifecycle assertions.
A pure helper has regression cases based on the captured processed shape; the
old predicate reproduces two positive failures while negatives remain rejected.

The helper and `tests/a09-submitted-shader-contract.test.ts` are explicitly added
to the required GPU workflow triggers and CPU selection. Existing selectors and
fail-closed aggregate remain intact. Native workflows and `tests/babylon-*` files
are untouched: a test-only correction must not cancel the still-running exact-
source desktop audit. This does not skip any existing native or GPU acceptance.

The frozen four-file correction passed 23 focused contract/workflow tests, full
TypeScript, canonical project lint, production build, IIFE bundling, YAML/format
checks and discovery of all 35 cases. Independent review verified the exact
source and captured submitted-shader shape. Existing native-triggering files
are byte-identical; no local GPU execution or image pass is inferred.

## Isolated production qualification: `e2633582`

The corrected submitted-stage guard allowed the actual production plugin to reach
all fixed views in [run 41378684226](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41378684226).
All three A09 cases passed, including fresh-context restart after genuine loss.
Four probe reports each contain 36 factor rows: all 144 comparisons passed.
Albedo error was exactly zero; view-normal maximum error was one code, worst mean
0.00014071483134322357. Coverage mismatch was zero, original repeats were exact,
and no GL errors were reported. This covers all three labels, front/rear/grazing
views and both ownership cycles, not only the original rear150 failure.

All six meshes' original positions/normals/UVs/indices/worlds matched; six texture
byte witnesses per cycle matched original data. Actual ordinary view/projection
readbacks matched the original reference on every draw. All 32 submitted program
witnesses contained one grouped assignment and no legacy combined assignment.
Culling/depth receipts retained CCW, double-sided structure, print BACK culling,
LEQUAL, depth writes and original -1/-1 print offset.

Independent decoding checked 168 PNGs: each of 42 captures is byte-identical across
the four probe streams. Owned cleanup/restored baselines passed. Normal-context
buffer/texture deletion was verified; loss-context deletion was explicitly
unqueried, not falsely reported as a live query. Recovery here means fresh-context
reconstruction, not qualification of same-context restoration.

Verified A09 artifact 13114152589 SHA-256:
`5e0c4818301a959e3a61d85c2720fa5106c5ccc55c573145814eb138dc074d09`.
The backend is ANGLE/SwiftShader. This qualifies the isolated original-factor and
lifecycle scope—not live startup, physical hardware, native Electron, full PBR
lighting, wet weather, shadows, sector boards or dynamic LOD selection. The rest
of the workflow and future live-source runs retain their own acceptance gates.

The complete `e2633582` workflow subsequently passed all 35 cases and its required
aggregate. Retained artifact 13114832436 has SHA-256
`11196bdad1be7d8c0acff98e29905cc38da4198a0ff71e62579bccb891f7c952`.
Actual same-scene Restart reset tick 53 to zero, advanced component 2 to 3 while
retaining scene 2, and required fresh ready completions 12/13. Canonical state
and the unmasked reset image were exact. Early pause held tick 699 through genuine
resize/redraw, with completions 7/8/9, then resumed at 716 with exact paused pixels.

The earlier corrected `81af5607` run 41376978171 also passed all 35 cases and its
aggregate. All six artifacts were independently SHA-verified in each run; all
548 isolated PNGs (380 existing and 168 A09) were byte-identical between runs.
The earlier `1f1be9d3` submitted-source fixture failure remains a recorded failure.
