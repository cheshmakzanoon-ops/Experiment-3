# A09 original clip-transform order

Base `8ce503c31f67a06c57bf7629217fedbd185acf9c`. This adaptation is limited to
isolated original A09 first-clean-triplet LOD0 ownership. No live integration.

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
