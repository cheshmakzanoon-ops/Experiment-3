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
Exact-source GPU/native results remain pending for this correction.

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
