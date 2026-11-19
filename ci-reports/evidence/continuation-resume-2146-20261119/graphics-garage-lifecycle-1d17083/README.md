# Aurel garage geometry lifecycle review

## Conclusion

No concrete clone, recreation, premature disposal, or attribute-sharing defect was found for the exact `LOD1_GARAGE_TeamEnamel` owner in immutable source `07bf358316f4a51e1566a052628ca57a68ca2610`, tree `efa81a0e2ef87d079d355a457c67be24b0a8f263`, published as `1d17083c7364b0d960d3f4a548139ac95077daa2`. This bounded review does not justify changing garage geometry, LOD selection, native caches, or the rendering acceptance gate.

## Native observation and authored source

The sealed hosted audit records sequence 23145 as an exact direct index upload for Aurel garage bay 5 / AUREL_GARAGE / GARAGE_LOD1 / LOD1_GARAGE_TeamEnamel. It submits 26,568 bytes, attribute version 0, on context 1 generation 1, buffer 52332 and VAO 52336. This is the first observed bufferData start for that tracked buffer, with no retained prior-view relation. Its 12,268.9 ms returned CPU span is not an isolated transfer cost; queued prior work may contribute. Every retained upload record reports an inventory cap, so absent candidate/history data cannot establish uniqueness or content identity.

The pinned 6,285,924-byte GLB matches its manifest SHA256. Its JSON identifies exactly one node (23), one mesh (22), and one primitive for the LOD1 surface. Index accessor 87 is unsigned 16-bit, scalar, count 13,284, bufferView 89, byte length 26,568. It has one mesh-primitive consumer and that mesh has one node consumer within this document. LOD0 and LOD2 have their own accessor IDs and counts (13,500 and 324). This structural match locates the authored owner; it is not a claim about runtime payload equality or all native transfers.

## Ownership through startup

The circuit creation path calls loadHeroGarage once for this renderer. It validates the bounded asset, parses it once using the installed GLTFLoader, then passes gltf.scene directly to HeroGarage. No garage root or TeamEnamel geometry clone is introduced by that path. Workshop, overhead service rig, and wheel storage attach their own child resources; they do not replace the TeamEnamel geometry.

The garage constructor retains all three authored tiers and initially makes only LOD0 visible. Circuit construction adds that same root only to authored bay index 4. Spatial batching explicitly preserves the garage root, and batchScene returns before cloning any descendant of a preserved root. Static transform sealing changes matrix traversal, not geometry ownership.

HeroGarage.setDetail switches tier visibility. Its update also changes lighting and separately owned wheel/equipment presentation; it does not replace TeamEnamel geometry, indices, arrays, or native upload versions. The initial far-shadow bake and warm-shadow stage precede the first draw's camera-derived garage update. The first chase draw selects its active garage tier before the local cube capture. A previously hidden LOD1 index therefore reaching its first actual consumer during capture is consistent with the source order. This is an explanation for a cold owner, not evidence of an avoidable duplicate or a demonstrated startup optimization.

FarShadow renders the same scene and temporarily borrows visibility/caster state. The renderer's merged shadow proxy registration is for vehicle frames; the garage is not passed to that pool. Reflection capture also uses the same scene and restores visibility, target, and material state. None of these paths recreates this garage index.

## Installed native cache and teardown

Installed Three 0.180.0 GLTFLoader caches dependencies by type/index, primitive geometry by its primitive key, and assigns the retained accessor directly with geometry.setIndex. WebGLAttributes owns a WeakMap keyed by BufferAttribute (or InterleavedBuffer data). An existing unchanged version does not call bufferData again merely because the program, VAO, cube face, or camera changed. WebGLBindingStates maintains per-geometry/program/wireframe VAOs but calls that same attribute cache for indices. WebGLGeometries uploads ordinary attributes earlier and defers index upload to binding setup. Thus interleaved first-use index allocations during actual drawing are expected behavior of this installed consumer.

HeroGarage.dispose is guarded and used for detached failed/cancelled ownership. Once attached, RacingRenderer.dispose performs a single set-deduplicated geometry/material traversal after stopping the renderer. The audit found no successful-startup disposal call on the retained garage. Existing tests cover asset integrity, preservation through batching, LOD visibility, detached exactly-once disposal, and cancellation. They were inspected, not rerun; they are not native timing or full renderer teardown proof.

## Scope and next decision

This review read immutable source and the authored GLB JSON; it did not instantiate a renderer, execute a race or test suite, change source/refs, or request another workflow. The hosted CI package remains unchanged in the sibling review-package directory. All 16 original cases remain 15 passed and 1 High readiness failure, with no authored-scene photo acceptance. The fresh application diagnostic reports returned six-face capture calls and warmupFrames=1, but GPU frames submitted=2/completed=0 and a pending pit-service wait. That queue state is being reviewed separately by the parent agent.

Any next geometry change needs a separately demonstrated lifecycle or native submission inconsistency. The current slow first observed index call and aggregate buffer timings alone do not supply one. No performance, byte-duplicate, GPU completion, or visual-equivalence claim is made here.

The exact source/native bytes are compressed under source/ and native/. provenance.json records their hashes, references.json records source anchors, and asset-structure.json records the pinned GLB structure. The script is retained for reproducibility; it only writes a new review directory and deliberately refuses to overwrite an existing one.
