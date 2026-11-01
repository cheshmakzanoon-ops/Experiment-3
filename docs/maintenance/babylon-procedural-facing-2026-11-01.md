# Procedural lamp facing correction

This is a focused `babylon-js` correction; `main`, original assets, triangle
buffers, transforms, material values, simulation and cameras are unchanged.
The isolated banner work is held separately.

## Proven defect and qualification boundary

The earlier `3a3e977` lamp tests established exact geometry/data, emission,
program reuse, lifecycle and startup behavior, but did not establish which
cylinder cap was rendered. Those passes must not be read as facing/normal parity.

Pinned Babylon 9.33.1 gives a new right-handed `Mesh` clockwise orientation.
The retained original Three cylinders use counterclockwise outward triangles.
With the original positive rigid world transform and front-side material,
Babylon's native effective-orientation/prebind path therefore selected GL.CW
instead of original Three's GL.CCW. Back-face culling could expose the far
interior cap while preserving the same emission and apparently valid center
pixels.

For the original cylinder, rotation X=π/2 maps the cap axis to gantry-local Z.
The intended near cap is z=-0.34 from the front; the wrongly exposed far cap is
z=-0.26. The separation is exactly the original 0.08 cylinder thickness.

The minimal production correction explicitly selects
`Material.CounterClockWiseSideOrientation` on each owned lamp mesh. It does not
reverse indices, alter normals, move geometry, flip a reference camera, change
materials or patch global renderer state.

## Regression evidence and pending real rendering

A new CPU regression failed on the old implementation while all 18 prior lamp
contracts passed. It verifies original triangle cross-products against authored
normals, both cap locations, positive world determinant and the actual native
`_getEffectiveOrientation` / `_preBind` decision. With the correction, all 19
lamp contracts plus 13 lamp-startup contracts passed (32 total).

The strengthened GPU fixture retains the existing emission/state/lifecycle
checks and adds per-draw FRONT_FACE/culling state plus original-reference cap
normal/axial-position evidence from front and rear. The old clockwise setting
is a controlled negative case, not a compensation applied to the reference.
Exact-source GPU/native results are recorded below.

## Bounded scope

Existing asphalt/formula-surface adapters already explicitly select CCW; native
glTF imports have their own orientation handling. They are not changed.
`importLegacyMesh` has the same latent default assumption but currently has no
production callers; it requires a dedicated correction/qualification before
future use. This focused live-lamp fix does not silently widen into a general
geometry rewrite.

The banner owner independently received the same explicit orientation correction
in its isolated candidate. Its font, sampler and front/back GPU proof remains a
separate gate. Linux's known post-model GPU loss remains unresolved and no
all-platform release is claimed.

Final local checkpoint: all 495 selected contracts across 45 files passed,
including 21 native-smoke contracts. Full lint, TypeScript, production build,
formatting and the unchanged three-case lamp discovery passed. An initial full
run could not load the ignored model-LOD derivative in this fresh validation
worktree; the exact manifest-hashed local artifact was restored and the normal
offline prerequisite check passed before the complete successful rerun. No test
was excluded and no source asset changed.

The new GPU factor gate compares fixed central 5×5 cap patches from front and
rear, with at most two RGBA8 code values of difference. The old-CW negative case
must show at least 250 code values of opposite-cap axial separation. This is
central cap evidence, not complete cylinder raster or final-PBR parity.


## Exact correction qualification on 6164be1

[GPU run 41318105178](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41318105178)
passed the required **19 retained + 3 lamp = 22** journeys and aggregate gate
for `6164be1fee47b56d0b881d7c43d6636f34336732`. Both shards passed the same 474
CPU contracts (not 948 distinct tests).

- Lamp artifact `13088501915`, 354,586 bytes; SHA-256
  `4bd1a0f7b64d05cfb3274227ec115aaf89e2dd9af80a646604afc65286a1fdad`.
- Retained artifact `13088920635`, 15,118,807 bytes; SHA-256
  `dcc9806fbf2da8fd9b49a6d2fcf6fbba4f06795cb8a924041b36aedca9169884`.

All 960 per-lamp state receipts across UBO, standalone, loss and fresh restart
show actual CCW front-face state, culling enabled and BACK culling. Original
emission, immutable snapshots, zero GL errors and no runtime shader compile/link
calls remain qualified. All 80 central cap patches across 16 comparisons match
the original reference with zero sampled RGB error. The old-CW control differs
by exactly 255 codes, exposing the opposite axial cap and flipped normal.
Reference repeats are full-byte exact. Whole axial images match; whole normal
images have one-red-code differences at 495 front/143 rear pixels, so whole-image
bit-exact normal parity is **not** claimed. Images were inspected.

Cleanup, structural independence and actual context loss followed by fresh
restart still pass. The retained early-paused test completes in 14.4 seconds:
observed tick 701 remains fixed through ready/settled startup, then advances to
722 on resume. This is bounded SwiftShader evidence, not physical GPU or final
PBR certification.

[Native run 41318105159](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41318105159)
passed Windows (46/46 draws) and Apple Silicon macOS (30/30), including all four
installed compatibility journeys. Both report 435 preparations and original
lamp/gantry ready counts. Native screenshots show the dark lamp row, not the
isolated cap-factor proof. Shared production fingerprint:
`2499e95c1810e76bda6a9f7ae126aff0231da3b388299a3b795cc312c21259c9`.

**Linux has a different failed boundary on this run:** a 30-second paused-
presentation wait expired at 34.670 seconds, before model import. There was no
recorded GPU process exit, context loss, graphics fault or JS error. Failure-
collection evidence later shows 131 completed preparations, idle/settled 10/10
GPU draws and an intact paused scene with the ready message. It does not show
which composite DOM predicate remained false before timeout.

The harness's early `babylon-ready` stage only establishes simulation text, not
finished environment preparation, and the first 30-second pause wait can overlap
the application's existing 120-second startup preparation. This proves a stage-
classification mismatch, not the timeout's cause or a scheduling deadlock.
Read-only timestamped readiness observations are the next diagnostic step; no
wait budget, graphics setting or readiness condition is weakened. Earlier
post-model Linux GPU losses also remain unexplained. No all-platform release
qualifies from this checkpoint.
