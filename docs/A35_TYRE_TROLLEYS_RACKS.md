# A35 — Aurel tyre trolleys and garage racks, revision 01

## Integrated scope

An original Blender-authored mobile trolley and fixed-foot garage rack share a two-tier, eight-position wheel layout. The trolley has four manufactured castor assemblies, two braked swivel units, push handles, load-bearing rails, end retainers, locking pins, adjustment receivers and a stored retaining strap. The rack exchanges castors for levelling feet. Surface detail includes restrained welds, fasteners, tube caps, rubber stops and original Aurel equipment labels. These are parked logistics props, not newly simulated pit machinery.

The normal renderer loads one self-contained GLB before circuit construction, validates its exact size/hash and hierarchy, and creates three independent compositions in the existing A22 garage, bay 05: a trolley carrying one lower-tier set, an empty return trolley and a fully loaded rear rack. No player car, cockpit, driver, A22/A24 source/export, physics, tyre inventory, service timing, crew animation or track collision file is changed.

## Source and game handoff

- `scripts/author-tyre-trolleys-racks.py`: retained original Blender authoring source.
- `scripts/aurel-tyre-trolleys-racks.blend`: editable components, export templates and a separate visible studio preview.
- `public/models/aurel-tyre-trolleys-racks.glb`: runtime GLB containing all three levels and embedded material images.
- `src/rendering/tyre-trolleys-racks.manifest.json`: source/Blender/export hashes, byte counts, measured template geometry, eight wheel sockets, dimensions and acceptance boundaries.
- `src/rendering/tyre-trolleys-racks.ts`: integrity-checked acquisition, template ownership, load compositions, instancing, LODs and placement.
- `tests/tyre-trolleys-racks.test.ts`: eleven structural, state, placement, integrity and ownership cases.
- `e2e/a35-tyre-trolleys-racks.spec.ts` and `e2e/fixtures/tyre-trolleys-racks.ts`: normal startup/practice and real-circuit lighting/moving-survey evidence.
- `.github/workflows/a35-authoring.yml`: read-only regeneration and export-contract comparison.

Blender 5.2.2 LTS is the pinned authoring tool. As in the existing repository, `.blend` and `.glb` are ordinary Git binary files, **not Git LFS pointers**. No new dependency, lockfile change or secondary geometry JSON is required.

## Scale, sockets and load states

Authoring uses metres. Game coordinates are +X outward, +Y up, +Z tangent; Blender receives `(x, -z, y)` and the GLB exporter converts once to Y-up. Export templates have identity transforms; each composition has a ground-aligned root. Its conservative clearance envelope is 0.90 x 1.67 x 2.16 m (width/height/length), with 5 mm below-root tolerance for validation, not a simulated collision shape.

The original static wheel templates use the repository `tire-profile.ts` dimensions: 0.335 m outer radius, front half-width 0.15 m and rear half-width 0.20 m. They are economical original logistics wheels, not copies of the high-resolution player assembly and not a replacement for A33's handling/inventory implementation. Wheel centres are analytically tangent to the two support rails; different front/rear widths are retained, with positive axial gaps.

`A35_SOCKET_LOWER_01` through `_04` and `A35_SOCKET_UPPER_01` through `_04` remain stable. Each tier has two front and two rear positions. Runtime presets are:

| State | Occupied slot indices | Visible wheels |
|---|---|---:|
| `empty` | none | 0 |
| `partial-left` | 0, 1, 4, 5 | 4 |
| `partial-balanced` | 0, 1, 2, 3 — one complete lower-tier set | 4 |
| `full` | 0 through 7 | 8 |

An explicit unique array of indices from 0 to 7 is also supported. Invalid indices or duplicates are rejected without mutating the existing load. Preset names describe parked compositions; they are not telemetry or live stock counts. The source/export retain four castor-pivot and two handle-contact markers for future work; no crew-pushing or individual castor animation is claimed in this revision.

## Geometry, materials and resource budgets

Six PBR material roles and two original packed 256-square micro-surface images serve the entire kit. UVs, metallic/roughness slots, embedded normal maps and converted original labels are retained. Static frame parts are material-batched. Wheel meshes use `InstancedMesh`, with shared geometry/materials and independent small transform buffers per composition. One visible LOD is selected per composition; mirrors reuse the main-view choice.

| Fully loaded composition | Near triangles | Mid triangles | Far triangles |
|---|---:|---:|---:|
| Trolley, eight wheels | 31,544 | 15,824 | 3,440 |
| Rack, eight wheels | 27,456 | 13,728 | 3,176 |
| Enforced upper limit | 38,000 | 16,000 | 3,500 |

A full near trolley submits at most 14 main-view material draws (rack also 14). This is not the full cost including existing shadow/mirror passes. Browser surveys measure actual additional submissions separately. The GLB is approximately 2.82 MB; exact bytes and SHA-256 are always the manifest's values. Blender save bytes can differ between runs because save metadata is not a deterministic export contract.

LOD thresholds use the repository's lens-aware distance function and hysteresis. Small bolts/welds disappear before structural rails, retainers or the occupied-wheel silhouette. No per-prop lights, reflection passes, physics bodies, per-frame mesh generation or global template cache are added. The kit owns shared resources; individual compositions own only their instance buffers. Disposal detaches A35 before the enclosing renderer traverses its scene, preventing double disposal.

## Placement and multi-agent boundaries

Placement derives from A22's current station 106 m, lateral offset 35 m and its floor surface at local Y=0.05. Bay-local positions are `(-2.2, .05, -3.35)`, `(-4.7, .05, -3.35)` and `(5.5, .05, -2.45)`. The side trolleys are turned 90 degrees. Tests check their non-overlapping envelopes, pit driving clearance and **ray intersections against the actual decoded A22 geometry**, not just schematic boxes. Central service/carry sockets and the rear doorway stay clear. Future garage changes must rerun these checks.

All A35-specific source, export, tests and notes are isolated. The only shared runtime edit is a small set of `renderer.ts` lifecycle hooks. A35 is attached outside destructive static prop batching. No `circuit.ts`, `pit-crew.ts`, `pit-machinery.ts`, package manifest, lockfile, shared asset source or another agent's file is regenerated. A33 can later supply alternative wheel templates through an explicit reviewed interface; this revision does not take ownership of A33 or A34.

## Validation and reproduction

```sh
blender --background --factory-startup --python-exit-code 1 --python scripts/author-tyre-trolleys-racks.py
npm ci
npm test -- tests/tyre-trolleys-racks.test.ts
npm run check
npm run test:e2e -- e2e/a35-tyre-trolleys-racks.spec.ts e2e/43-hero-garage.spec.ts e2e/44-pit-wall-station.spec.ts
```

`-- --render /absolute/path/preview.png` additionally produces a Blender studio preview. It is not in-game evidence. The `.blend` opens with a separate display collection; editable components and export-only templates are retained but hidden in that display.

Unit cases check source and `.blend` hashes, export corruption/truncation, finite geometry and template identities, dimensions, rail contact and tyre gaps, both structures, every load preset, state-independent buffers, world-space sockets, LOD ceilings/hysteresis, real-garage ray clearances, cancellation and exact-once disposal. CPU tests intentionally stub image decoding; browser tests decode the actual embedded images.

Browser cases exercise normal application loading, practice entry and pause. The dedicated real-circuit fixture captures the loaded trolley, empty trolley and rear rack in day, sunset and rainy night conditions, measures added draws, warms the LOD/load buffers and checks repeated moving-survey frames for stable resource counts and WebGL errors. Simulation frame and water arrays are checked unchanged. These are actual Three.js circuit/material views, **not** a human-driven full lap or physical-hardware FPS certification.

The read-only authoring workflow first validates the committed receipt, regenerates the kit, compares structural contracts and records whether the GLB bytes reproduce exactly. Any byte difference is reported rather than silently replacing the release export or being called exact reproduction. Hosted CI results belong to their specific commit; a local focused pass does not establish the status of a later main revision.

## Remaining acceptance

`finalArtApproved` remains false. The first integrated revision still needs full pit-approach/service/exit and replay art review, representative GPU profiling with the other newly authored assets, and final cockpit-view approval. The separate reported cockpit-camera issue is not repaired by this asset. Live wheel removal/stock changes, tyre-blanket fitting, trolley pushing, castor animation and physical collisions are outside this parked-prop revision.

All A35 geometry, labels and micro maps are original. No external art, team logos, photographic textures, commercial-game models or font files are included. GitHub publication does not itself redeploy an independently hosted AppDeploy/ChatGPT website.

## Publication validation

The retained GLB and Blender source were authored and validated in run 36593534419 (1,342 unit tests and 16 A35/A33/A22/A24 browser cases). Subsequent reconciliation preserves the newer A31, A33 and A34 contributions. Final combined-garage surveys explicitly load A34 alongside A35 and use the existing sun-shadow anchor. Measured current-main results and acceptance limits are recorded in `docs/A35_VALIDATION.json`; actual circuit captures are retained in `docs/A35_GAMEPLAY_CONTACT_SHEET.jpg`. Studio renders, survey motion and normal startup are not a human-driven lap or representative-GPU FPS certification. Cross-host byte-identical regeneration is not claimed.
