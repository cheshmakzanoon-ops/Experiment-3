# A12 cold-frame rendering budget

## Reproduced release blocker

Starting source: `5ddfae8712acb10d8dd681158a4b2e78876f7664`.
Its A12 day/sunset/wet-night survey passed in run `37388250025`, but full
validation run `37388250405` failed six sunset cases: track infrastructure,
trackside operations, vegetation, quarry, event hall and scenery shadow budget.
The shared exception was the complete cockpit draw-call ceiling, not missing
assets or physics failures. The 12-car, seed-1887, 8-second cold frame measured
3,241 calls against a retained baseline of 3,173 (+2% allows at most 3,236).
Its 12,557,602 triangles remained below the retained triangle ceiling.

The warmed A12 survey and the cold budget are different workloads. Warming a
scene before measuring it can omit the initial lighting bake. Neither the
existing baseline nor the cold-frame observer was changed to hide that work.

## Runtime repair

Each existing 48 m secondary stand has six identical rail bays and two aisles,
all using the same opaque steel material. A preallocated half-stand combines
three original rail geometries at -8/0/+8 m with its original centre aisle.
Two instances at -12/+12 m reproduce all original placements. This eliminates
one submission per visible stand/pass, without removing authored triangles or
changing material properties, the racing corridor, cockpit or supplied car.

The three detail tiers share one retained index/vertex allocation per role and
side. Each camera keeps its own hysteresis, and shadow/camera callbacks restore
the selected ranges after each pass. The combined spatial bound conservatively
selects detail; no additional distance-based disappearance is introduced.
Translations baked into float32 storage may round by less than 0.000005 m.

The existing placement, seat/crowd, clearance, foundation, source-checksum and
allocation tests remain. Eight additional regressions compare every oriented
rail/aisle triangle corner, normal and UV at all three tiers on both sides,
and verify independent scene buffers and stable storage through camera cuts.
The focused 30-case suite, changed-file lint, strict TypeScript and guarded
production build passed before browser validation.

The supplemental A12 workflow now requires both the original cold cockpit
budget and the existing full six-site survey for each lighting condition.
No time, triangle, draw-call, image-difference or source-preservation threshold
was increased by this correction.

## Acceptance boundaries

Full exact-commit CI and publication must be verified independently. Automated
renderings are not continuous human-input race review or consumer-hardware
performance certification. Final art, human review and A72-A75 district
refinements remain separate work.

## Targeted production result

The unchanged `scenery-shadow-budget.spec.ts` sunset case passed on the
independently observed Linux/Mesa backend after this correction. The same cold
frame measured **3,232 calls and 12,557,602 triangles**: nine fewer calls with
identical total triangles. The reduction was six shadow submissions, one mirror
submission and two compositor submissions. The original shadow-culling control
remained pixel-identical (zero changed bytes) and retained its 463,144-triangle
saving; this is the existing culler-control comparison, not a claim that every
pixel in every camera is identical before/after batching. No WebGL errors,
context loss, console errors or simulation-frame mutation were reported.

This focused browser result does not replace final exact-commit CI or release
publication.
