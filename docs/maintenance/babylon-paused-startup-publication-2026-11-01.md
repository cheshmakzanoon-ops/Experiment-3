# Paused startup publication · bounded candidate

This change belongs only to `babylon-js`; main remains frozen. It addresses the
last-frame boundary observed on `f0ca199`, not missing geometry or a driver fix.
See [the complete failed native result](babylon-environment-batch-2026-11-01.md).

## Why the final request is being examined

Linux's required surface, shared-prop and stripe receipts completed before the
first-pause deadline, but the following requested frame remained pending. The
completion continuation publishes resource fields, enables the optional-car
button and updates DOM text, then previously requested another scene draw.
Source review found no scene mutation in that continuation.

In this specific initial/rebuilt paused scene, transforms and grounding are
assigned absolutely from the frozen snapshot. Camera position/target are assigned
directly, with no chase smoothing; controls are unattached and inertia is unused.
Static materials have no time-driven updates. Optional imported car animation is
not part of this shortcut. These facts do not imply that every paused Babylon
scene is static, nor do CPU/source checks replace real image comparison.

## Required proof and fallback

A startup-generation tracker observes actual GPU completion receipts. The optional
publication path requires the latest ready receipt to belong to the current
scene and match submitted/last-completed sequence, with a healthy idle/settled
GPU. Current owners must all be complete. The component, tick and exact copied
snapshot bytes must match; a bounded canonical CPU visual-state description must
also match exactly. Cached world matrices are read without recomputation.

Any unknown/unsupported visual state, nonready/old-scene receipt, pending fence,
real presentation demand, preparation, resize, restart, loss/failure or state
change retains the original redraw. Active driving and optional-car completion
are unchanged. The helper never clears demand, consumes a fence, changes counters
or invents readiness. It does not call scene readiness or GL outside the owned
render lane. Every owner's two real completions and both existing startup/native
deadlines remain required.

Only when that proof succeeds does startup publish sceneReady from the completed
image without requesting another scene draw. The ordinary render loop still
publishes settled state from its real counters. Cached visual/decision evidence
is opt-in for the browser qualification; default native diagnostics and their
whitelists do not gain this payload or repeated capture work.

## Qualification boundary

CPU negatives must reject stale receipts, mutated frames/camera/world state,
unknown signatures, false/empty failures and real pending demand. A genuine new
request must still submit and complete a frame. Submission evidence is stamped
only after a real draw and confirmed new GPU submission; a skipped draw cannot
reuse stale diagnostic context.

The browser test must prove the actual reuse branch was selected, not merely
allow a successful fallback. It compares unmasked composited-canvas RGBA and
non-null canonical state around genuine viewport changes and completed redraws;
full-page comparison is separate diagnostic evidence. Canvas screenshots include
any overlapping DOM and are labeled accordingly. No stale preserveDrawingBuffer
readback, pixel mask or extra budget is used to manufacture equality.

Exact-source GPU/native execution is still required. This candidate is not yet a
Linux-reliability or visual-equivalence result, and physical-device performance
remains unqualified.

## Frozen local verification

The clean final-source selection passed **1,342 tests across 99 files**, including
129 focused checks and the original graphics-recovery source contract unchanged.
Red-before evidence reproduces the old extra submission; negative tests cover
nonidle/empty failure states, changed frozen world matrices, stale/no-draw capture
attribution and already-signaled fences. Earlier mixed-revision/source-contract
failure evidence is retained separately and is not relabeled as this final pass.
Independent review found no blocker for runtime qualification. These CPU results
do not prove the shortcut is selected or visually safe on a real renderer.

Final frozen-source checks also passed full TypeScript, full project ESLint,
production Vite build and discovery of all 28 cases in nine workflow spec files.
The ordinary chunk-size warning remains. No local browser/native execution is
claimed; real-renderer branch selection, unchanged pixels and native deadline
acceptance remain pending until the published checkpoint runs.
