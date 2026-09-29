# A33 — Spare-wheel handling set, revision 01

## Implemented scope

Original Blender-authored front and rear removable wheel assemblies replace the
single generic `spare_tire` in normal pit presentation. The tyre, forged barrel,
inboard spokes, dished carbon cover and open centre-lock bore are retained at
three detail levels. There are no brake rotors, bells, uprights, calipers or ducts
in the carried assembly. Existing player, cockpit, driver, APX and people assets
are not regenerated. Physics, compound replacement, pit timing and collisions
remain unchanged.

The dimensional contract follows the repository's APX wheel manufacture: 0.335 m
visual radius and nominal tyre half-widths of 0.155/0.190 m (front/rear). The rim
flange, cover and captive nut extend beyond the nominal tyre half-width. These
are game-asset dimensions, not a claim of exact contemporary championship rules
or a 1:1 duplicate of the supplied RB19's materials and markings.

At the transfer endpoint the spare is now axle-centred, rather than another
0.21 m beyond the axle withdrawal. Two hand targets follow the measured sidewall
at their existing 0.28636 m contact arc. The existing gun, jack, crew skeleton and
serviceWheelOffset load gate are retained. This is still the existing simplified
service choreography, not a newly simulated wheel inventory or a complete
motion-captured exchange. Existing compound/wear history is not fabricated on
outgoing props; their original neutral markings do not claim live tyre-condition
telemetry. Fine tyre-condition continuity remains a separate refinement.

A22's four tyre sockets also host two front and two rear wheels resting
horizontally, with the nut upward and the inboard flange on the support plane.
They are separate moveable-equipment scenery, not geometry baked into A22 or a
second physical pit box. A34 blankets and A35 racks are not included. Attachment
metadata is retained for those families; no new collision body is enabled.

## Retained files and reproducibility

- `scripts/author-a33-spare-wheel-set.py`: deterministic Blender construction.
- `scripts/aurel-a33-spare-wheel-set.blend`: individually editable manufactured
  components, six export prototypes and linked carry/stage/storage/four-wheel
  inspection arrangements. Preview lights and camera are not shipped.
- `public/models/aurel-a33-spare-wheel-set.glb`: self-contained exchange asset,
  three LODs, sixteen end-specific sockets and handling-state metadata.
- `src/rendering/a33-spare-wheel-set.geometry.json`: bounded compact runtime
  buffers exported from the same Blender meshes; front/rear positions and normals
  have identical topology. No independent runtime mesh generator.
- `src/rendering/a33-spare-wheel-set.manifest.json`: measured byte counts,
  author/export/runtime hashes, triangle counts, budget and provenance.
- `src/rendering/a33-spare-wheel-set.ts`: strict decoding, instanced shape
  selection, contact/socket helpers, state placement and garage storage.

```sh
blender -b --factory-startup --python-exit-code 1 --python scripts/author-a33-spare-wheel-set.py
npm ci
npm test -- tests/a33-spare-wheel-set.test.ts tests/people.test.ts tests/hero-garage.test.ts
npm run check
npm run test:e2e -- e2e/a33-spare-wheel-set.spec.ts e2e/pit-presentation.spec.ts e2e/43-hero-garage.spec.ts
```

Regenerated assets are candidates, not silently approved replacements. Runtime
integrity is tied to the selected files by exact SHA-256 tests. Cross-host Blender
save metadata is not required to be byte-identical. The authoring validation
workflow checks the retained runtime receipt and exports its observed files.

## Rendering and resource budget

Each wheel contains **12,048 / 4,640 / 1,408 triangles** at LOD0/1/2. One original
PBR atlas has three material regions for rubber, forged alloy and carbon. Its two
384 x 128 RGBA maps cost 393,216 base-level bytes in total, plus mipmaps. UV gutters
limit cross-region filtering. Moulded AUREL CONTROL lettering and restrained
inspection markings are original geometry; no font files or third-party artwork
are shipped.

Instead of the initial six-material-batch proposal, Three.js's built-in instanced
morph selection chooses the exact front or rear shape (weight 0 or 1), using the
same atlas material. The built-in position/normal targets also drive shadows.
There is no negative instance scale or custom shader replacement for shape
selection. Three LOD buffers are allocated once; service uses the existing
lens-aware near/mid crew selection, and garage storage uses all three levels.

A service car contributes four spare props, not four duplicate mounted wheels.
The allocation is bounded at 96 wheel slots, and twelve simultaneously active
crews use 48. A homogeneous service view still uses one wheel draw. When both
crew LODs are present there are two wheel draws, so the whole crew budget is now
**eight active batches**, up from seven. Three allocated wheel LOD children make
nine root children; zero-count unused LODs do not submit draws. Existing budget
tests are adjusted only to reflect those explicit counts, not removed.

Pose rebuilding remains on the existing snapshot cache. Held/rewound snapshots
restore the same instance matrices and front/rear selectors; no wall-clock
animation is introduced. Atlas filtering participates in TextureBudget. Exposed
pit wheels use the existing bounded dampness presentation; stored garage wheels
have authored exposure zero. Neither is a new physical water simulation.

Attached buffers/materials are disposed by the renderer's deduplicated scene
traversal. Detached standalone sets have an idempotent disposal method. Garage
detached disposal also frees its instanced shape textures.

## Acceptance evidence and limitations

`tests/a33-spare-wheel-set.test.ts` verifies provenance, malformed buffers, all
three geometry levels, front/rear shape correspondence, centre-bore rays, material
separation, sidewall contacts, positive handed transforms, support-plane contact,
A22 socket compatibility, bounded instances and disposal. Production crew tests
retain their limb-reach, glove-cuff, helmet-separation and replay assertions.

`e2e/a33-spare-wheel-set.spec.ts` includes ordinary application startup and entry,
plus day/sunset/rainy-night real-scene surveys. Those surveys load the shipped
player and environment assets and render a sequence of actual physically
produced pit-service samples. They retain PNGs, allocation counts, draw counts,
replay/held-state evidence and WebGL errors. They use fixed engineering cameras,
not a human-driven full lap. A software renderer is not hardware FPS acceptance.

`finalArtApproved` remains false. The cockpit-camera issue, complete-lap art
review, final supplied-player visual matching, fine tyre-condition continuity,
more elaborate exchange choreography and representative GPU profiling are not
closed by this asset revision. GitHub publication does not redeploy an external
AppDeploy/ChatGPT site.

## Parallel-agent ownership

All source/export/test additions are A33-namespaced. Shared edits are restricted
to the wheel construction/placement in `pit-crew.ts`, independent A22 storage
attachment, pit-atlas registration in `renderer.ts`, two measured batch-count
assertions, and the A33 backlog row. Publication must fast-forward the latest
`main`, preserve other agents' changes and reject overlapping conflicts. Neither
`playable-cdn` nor other agents' authored binary assets belong to this change.
