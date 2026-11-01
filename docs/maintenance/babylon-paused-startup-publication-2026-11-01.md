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

## First runtime result: `b0dc8a3`

[GPU run 41344313764](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41344313764)
finished with **27 passed and one failed**. The strengthened early-pause case
correctly rejected `requested-redraw` where it required `reused-completed-image`.
The cached visual state was null despite complete owners, tick 630 frozen and
eight completed frames. No GPU fault/loss was recorded. Resize/pixel-repeat
verification was not reached. The failed aggregate is not a visual-equivalence
or optimization-activation pass; all 280 isolated asset PNGs remain unchanged.

Retained artifact 13098942096, SHA-256
`bd893dff2a253471be420822ef03af0ade7877307e9cd549b014922e523d3280`,
preserves the failure. Source and actual-adapter reproduction identified a valid
GLTF `__root__` Mesh with null geometry, zero vertices/indices and undefined
subMeshes. The capture attempted `.subMeshes.length`, threw and correctly fell
back to unknown. This was a missing supported non-rendering container case,
not permission to treat unknown drawable geometry as ready.

The narrow correction canonicalizes absent draw metadata only for that proven
geometryless/zero-count shape. It preserves identity, parent, local/cached world
matrices and frozen state without mutating the graph. Geometry-bearing omissions,
null/malformed rows and contradictory counts still reject. Bounded opt-in
rejection codes aid diagnosis; default native diagnostics and all acceptance
predicates remain unchanged. Fresh GPU execution must still prove the actual
optimized branch and unchanged pixels.

[Native run 41344313838](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41344313838)
passed Windows/macOS and all four compatibility journeys, with 38/38 and 23/23
draws respectively, both 443 preparations. Linux passed its first pause receipt
7/7 and second 17/17, but these counts do not prove shortcut selection. First-gate
polling history was evicted. Lifecycle completed at 31.420 s and the model was
presented at 76.877 s; the subsequent 15-second wheel-motion wait timed out at 91.931 s,
followed 0.692 s later by GPU exit 512/context loss. Draws were 19/20 with pending
sequence 20 aged 15.675 s. Full Linux qualification therefore remains failed.

Native artifacts: Linux 13098991158, macOS 13099575044, Windows 13099470391.
Fingerprint:
`1a56ccc3803d5f3f9e8db3e5706400332a29f247628349d89d13a6376a16d718`.
The post-model GPU failure is separate from the unknown startup-state proof;
no causal driver or repair claim is inferred from the timeout alone.

## Geometryless-root correction verification

The reviewed six-file correction passed **1,371 tests across 99 files**, including
162 focused checks, full TypeScript and project ESLint, production Vite build,
and discovery of the unchanged 28 browser cases. The real pinned GLTF graph
reproduces the original rejection and now yields a supported canonical state.
Malformed/contradictory geometry metadata and changed root transforms remain
negative cases. The original rejected graph is not mutated. These are local CPU
checks, not a GPU reuse/pixel or Linux-native pass. The next exact-source runs
remain mandatory; all existing deadlines and assertions are unchanged.

## Corrected runtime result: `ccb5fbe`

[GPU run 41347997017](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41347997017)
passed all **28 cases**, with no flaky/skipped cases. The actual decision was
`reused-completed-image`; canonical state was non-null (26,455 characters), with
no rejection code. Tick 699 stayed frozen while completed frames advanced
7 → 8 → 9 across genuine viewport changes. Canonical state, camera and resources
matched before/after. Unmasked 1440×900 composited-canvas RGBA had zero changed
pixels/channels and zero maximum delta. Both image-byte hashes were
`d756fcd85793a51df019473328d432addb3d0794785452d182809f9ca2cfdd06`.
Resume advanced to tick 716. All 280 isolated asset PNGs remained byte-identical
to `f0ca199`. This is SwiftShader qualification, not representative hardware.

Retained artifact 13100651099 SHA-256:
`66a90425644121fa3537de24b7819745e05223d9792800846fb5119fa422110a`.

[Native run 41347996995](https://github.com/cheshmakzanoon-ops/Experiment-3/actions/runs/41347996995)
passed Windows (36/36 draws) and macOS (27/27), with 443 preparations and all four
compatibility journeys each. Linux passed its initial pause at 6/6, lifecycle
and keyboard, then failed the second pause after Restart before model import:
289 polls over 30.005 seconds. Its last pre-timeout sample had 11 submitted/10
completed frames, rebuilt surface incomplete, 250 preparations completed and
pending GPU age 5.746 seconds. The preceding frame had remained pending for
21.110 seconds. GPU exit 512 followed the timeout by 9.903 seconds; the later
loss receipt's 15.702-second pending age is not the timeout age. No concrete
synchronous ownership defect or driver cause follows from these observations.
Full Linux qualification, model motion and compatibility journeys did not pass.

Native evidence artifacts: Linux 13100526480, macOS 13100905269,
Windows 13100144440. Shared fingerprint:
`c73f0487f758f1af24471680c6024bd5800b56c061c2814f900530b4219a140a`.
