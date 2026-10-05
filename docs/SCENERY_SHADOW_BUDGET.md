# Complete-frame shadow budget continuation

## Retained failure and attribution

The r02 production source `0bf8a6d8c38e904020eb906ee1ebdb099c8bc71b`
failed the unchanged sunset cockpit triangle limit. The Quarry report in run
`37239477200` recorded 13,007,208 triangles and 3,212 calls. The pinned sunset
baseline is 12,549,162 triangles / 3,173 calls, with a 2% maximum increase.
These are submitted-work measurements, not frame-rate or final-art approval.

Test-first commit `005f6ddd5c33219c07f9c937c113ca10afc1e193` did not change
production rendering. Its dedicated run `37243297079` reproduced exactly those
counts while retaining a per-object census of every shadow submission. The
sunset evidence artifact is `11318376413`. The ordinary complete CI remains a
separate gate; dedicated tests never authorize publication by themselves.

The census attributes 411,264 near-map triangles to the 952 near-detail seats
of the stand at station 55 m. An independent CPU regression with the same
12-car, seed-1887, eight-second simulation reproduces Three's aggregate-sphere
intersection, then checks all 952 instance-transformed geometry boxes: none
intersects that near shadow frustum. The long batch sphere is a false positive.
The same defect is reproduced in daylight. Both production-callback regressions
were executed and failed before the repair (full range instead of zero).

## Repair

`StaticInstanceShadowBounds` is installed only on the known rigid, authored
start/finish batches. It supplements Three's sphere test with their retained
local-space bounding box transformed into the actual fourth-argument light
camera's clip space. A millimetre margin conservatively retains boundary geometry.
Only a provably off-frustum submission receives a temporary zero index range
and zero instance count; both prior values are restored immediately afterward
and before any colour draw.
All instances, vertices, indices, LODs, materials, cast-shadow flags and placements
are unchanged. No new geometry or GPU buffers are allocated.

The guard keeps the ordinary full submission when geometry/instance identities
or upload versions change, when a custom depth vertex program or displacement
is present, or when the projection is malformed. It restores exact finite caller
ranges, handles interrupted shadow draws, and removes its hooks on disposal.
Vellamar and the supplied player/car/cockpit/driver assets are unchanged.

This is not a claim that Quarry itself contained hundreds of thousands of excess
triangles. The new environment exposed a whole-scene budget regression; the
retained submission census identified safely removable work in existing stands.
No reference budget or lighting workload was changed to accommodate the assets.

## Verification

The focused six-file suite passed 36 cases after repair: the two reproduced
production regressions, fifteen culling/negative-control/lifetime cases, and the
existing start/finish, shadow-camera, cubemap and pass-detail contracts.

The browser diagnostic still measures the **first complete production cockpit
frame**, including any sunset whole-circuit lighting rebake. It then executes
separate frozen-scene controls with the optimization disabled/enabled and compares
the actual near shadow texture byte-for-byte. Those extra controls are not
substituted for the original budget frame. It also checks retained geometry,
instance-buffer and restored-range identities and keeps the per-object census,
full-frame screenshot and original error assertions.

Full frozen-source validation, exact-commit hosted day/sunset/wet-night results,
Quarry/vegetation/cockpit surveys, ordinary complete CI and release publication
must be read from their corresponding runs. Local Mesa initialized successfully,
but local browser navigation was denied by administrator policy; that attempt
is not a browser pass and no restriction was bypassed. Continuous human driving,
consumer-hardware performance and final artistic approval remain separate work.

## Empty-call and observer continuation

The first pixel-comparison observer in `1edfcce` called Three's shadow renderer
outside its owning frame lifecycle. Run `37244296071` retained the resulting
null render-state error; it is not a production browser pass. `1b147a9` corrected
that observer to render the identical frozen scene normally and count only the
shadow subpass. No simulation step or presentation update separates controls.

Run `37244687461`'s day artifact `11318219049` then measured 10,374,772 triangles
in the original complete cockpit frame, with zero browser/GL errors. Its actual
1024-square near-shadow texture was byte-identical with culling disabled/enabled,
and the shadow workload dropped by 463,144 triangles. However, both controls
recorded 480 calls, failing the additional strict call-reduction assertion:
Three submits zero-index instanced draws rather than skipping the driver call.

The continuation also temporarily sets the rejected batch's instance draw count
to zero, exercising Three's explicit zero-instance early return. All original
counts and ranges are restored, including finite/subset caller counts and an
interrupted draw. The strict call-reduction assertion and all original rendering
limits stay unchanged. Pixel equivalence and the revised exact-commit outcomes
remain required; the exploratory failed controls are retained, not relabelled.

## Wet-night no-change control

Final production source `f40e48a` passed local and hosted source validation.
The local check retained all 1,800 cases in 207 files, lint, TypeScript, build
and unchanged guarded inputs. Its dedicated shadow workflow `37245124681`
passed daylight and sunset. Day artifact `11319016779` records 10,374,772
complete triangles / 2,353 calls; sunset artifact `11318684395` records
12,544,064 / 3,207, below the unchanged sunset ceiling. Both actual near-shadow
textures were byte-identical, with 463,144 fewer triangles and five fewer calls.

The wet-night artifact `11319385683` correctly rejected the NEW observer's
universal savings assertion: its saved work was zero. However, its original
complete-frame counts (12,917,479 triangles / 3,487 calls) are EXACTLY those
of the retained pre-repair `0bf8a6d` wet-night Quarry report. Pixels and draw-state
identities were unchanged and no browser/GL errors occurred. The night budget
was already satisfied; this is not a new production rendering failure.

An independent CPU check of the unchanged rainy simulation puts the player at
[-354.50787353515625, 0.34505146741867065, -203.3347625732422]. Three's initial
sphere test already excludes every detail tier of stand 55 in that near light
frustum, unlike the daylight/sunset case. There is no false-positive submission
for the additional check to remove. The test must not demand deletion of real
visible work just to manufacture a saving.

Wet night is now an explicit negative control: exact zero savings and identical
uncropped/cropped calls AND triangles are required. Daylight/sunset retain their
strict >200,000 savings and call-reduction assertions. Every lighting still
requires zero changed shadow bytes, geometry/draw-state identity, no errors and
the original first-frame budget; no scenario, camera, simulation, asset, renderer
or budget changed. The added CPU regression preserves the rainy source frame
and verifies the ordinary sphere exclusion. The failed universal assertion is
retained as evidence, not relabelled as a pass.
