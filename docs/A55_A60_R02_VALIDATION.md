# A55–A60 r02 — validated-source continuation

Continues the integrated `0947f5ed4a91bec2af842567043e405a63badba1` candidate.
The exact baseline passed `npm run check:stable` locally: **1,774 tests in 202
files**, ESLint, strict TypeScript and production build, without rewriting inputs.
That is a build/source result, not a browser or release approval.

## Findings from retained hosted evidence

The four failed browser partitions of pre-integration source `4da4cf3` all retain
an `Invalid detail lens` exception in their trace or failure report. The affected
application-reflection, A36 workshop, race-clarity and A61 grid journeys share the
vegetation cubemap cause already repaired in `0947f5e`. It was not merely slow
loading. No timeout, physical scenario or error assertion was relaxed.

For integrated source `0947f5e`, garage integration and the dedicated cockpit
framing workflow passed. The vegetation sunset survey passed. The daylight
vegetation survey preserved source, water and resources and reported no browser
errors, but its normal cockpit frame exceeded the **unchanged** complete-frame
triangle budget: 10,984,822 triangles against the pinned day's 10,744,392 with
its existing 2% allowance. Its 2,358 calls remained within the call limit.
Neither that test nor the overall vegetation workflow passed.

The first Quarry daylight survey completed a real physics-driven sector passage,
retained 26 images, and reported 264 placements in 32 chunks with 6,165,084 packed
geometry bytes. It had zero GL/browser errors and stable Quarry mesh/buffer
identities. However, its resource assertion failed: 2,695 uploaded geometries
became 2,698 on the reverse camera traversal, with textures unchanged at 256.
The test warmed a forward-only path before measuring both directions. That is
insufficient coverage for hysteretic detail selection, not evidence of a leak-free
full sequence. The failed report remains the baseline; it is not relabelled green.

## Shadow/reflection detail repair

The pinned Three r180 shadow implementation supplies the viewing camera as the
third `onBeforeShadow` argument and the actual shadow camera as the fourth. Both
scenery owners had used the third, choosing driving-view detail for the whole
circuit's shadow map. New regressions reproduced that error through the real kit
callbacks before the fix.

Both owners now select existing detail ranges using the fourth camera and the
actual pass viewport. Perspective reflections account for their smaller pixel
height. Orthographic shadows use world span, zoom and the finer pixel axis: the
near-car map can retain near silhouettes while the broad whole-circuit map uses
far geometry. A point-shadow atlas uses each face's viewport, not the atlas's
full size. No caster is hidden, no geometry is deleted, and primary-camera
hysteresis and its original lens thresholds are unchanged. Negative dimensions
and malformed lenses still throw. Per-owner vectors avoid per-draw allocations.

Four production-callback regressions failed before the repair and passed after
it. They check tight/broad shadow cameras, small reflections, main-view restoration
and retained geometry identities for both the vegetation and Quarry owners. Four
additional pure cases cover projection/zoom, face viewport and invalid inputs.
The existing six-face cubemap regressions remain intact.

## Native asset correction and cliff refinement

The original fixed Z/Y UV projection collapsed horizontal caps and end faces.
An all-stone-triangle test failed against r01 (including 496 collapsed UV triangles
in the near retaining-wall mesh). r02 chooses the dominant projection from each
face's Newell normal, retaining vertical wall bedding and two-dimensional cap UVs.
The same strict UV test passes on the actual exported r02 GLB.

Inspection of the retained r01 in-game views also showed excessively regular,
flat-topped cliff profiles. The two cliff families now have steeper working faces,
sloping rears, broken crests and two irregular benches; material bedding is less
uniform. Their three detail tiers, placement envelopes, source geometry budgets
and deterministic construction remain explicit. This is a revised original art
candidate, not final-art acceptance.

The replacement GLB is **1,534,604 bytes**. Explicit Blender authoring workflow
`37238432539` reopened its saved native source and re-exported identical GLB bytes.
The hosted export also matches the locally authored GLB exactly. The integrated
native file and manifest are the matching hosted pair, whose identities are in
`A55_A60_R02_AUTHORING_RECEIPT.json`. Ordinary installs and builds do not invoke
Blender, rewrite source or stage patches. The temporary candidate authoring script
is removed in the atomic integration; the canonical author and workflow remain.

## Stronger camera-cycle observer

The Quarry observer now warms the exact closed forward-and-reverse sequence twice:
ten stations, two lenses, both directions (80 predetermined warmup renders).
It then measures the same sequence (40 renders). This is a fixed workload, not a
loop that allocates until a test passes. All original captures and strict memory
assertions remain. The report additionally records every warmup memory sample and
verifies the identities of every scene geometry/index/attribute array, rather than
only the Quarry owner. The full camera sequence is retained in JSON.

## Executed checks and remaining gates

The corrected candidate passed **38 focused cases in six files**, the repository's
normal `npm run lint`, and `tsc --noEmit`. The focused tests include the existing
asset hashes, placement, transportation limits, cancellation, cleanup and all-tier
contracts. The full frozen-source check and exact new-commit browser results must
be evaluated separately. Failed exploratory invocations and source-identified
baseline reports remain outside the checkout in the continuation evidence bundle.

There is no change to simulation, contact geometry, race rules, input, audio,
supplied player/cockpit/driver assets, Vellamar scenery or replay/save protocols.
No rendering budget or reference baseline was raised. Publication still requires
the complete ordinary CI and wet-presentation gate, not just a dedicated survey.
Continuous human driving, consumer-hardware performance and final-art approval
remain independent open acceptance work.
