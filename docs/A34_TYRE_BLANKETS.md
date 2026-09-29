# A34 — Aurel thermal blankets and controllers, revision 01

## Implemented scope

Nine original Blender-authored library variants: front/rear fitted covers, front/rear opened covers, neatly/loosely folded blankets, four-channel main controller, two-channel portable controller and coiled lead. The kit retains padded wrap and side panels, reinforced lift handles, seam binding, closure flap and pull tab, original sizing patches, electrical tails, strain relief, connectors, controller sockets, status panels, feet, corner protectors and carry hardware.

The normal production asset-loading path mounts nine instances in A22 bay **05**: four fitted covers, both folded forms, both controllers and one coil. Four additional routed leads connect the controller outputs to the blankets. All placements are garage-local. A22's wheel sockets are floor contacts: centres are raised 0.36 m, and the blanket axle rotates from asset +X to garage +Z/-Z. Cables take a rear/perimeter route, outside the reserved central car aisle; their sampled sweep is clamped above the garage floor.

The fitted cover size is based on the existing **APX spare-wheel** radius (0.335 m), front width (0.310 m) and rear width (0.380 m). This is **not** a verified fit to the separately supplied RB19 wheel meshes. Covers enclose the wheel faces; no replacement tyre/rim is included. The centre panels include allowance for the APX outboard locking hub, checked against actual surface ray intersections at every LOD rather than only checking nominal tyre dimensions. The concurrently integrated A33 set supplies the underlying wheels. A34 aligns only its four garage-storage instances to the upright cover centres, using A33's existing batches and front/rear morph selection. A33 retains its own LOD and resources; a LOD change reapplies the fit, while unchanged frames upload no extra matrices. A33's standalone horizontal storage and pit-service choreography are unchanged, and no A33 source or binary is replaced. Future blanket handling remains separate. Open forms are retained for future interaction/inspection rather than displayed as empty wheels in the working garage. There is no new heating simulation, wheel handling, pit-stop behavior, crew animation or collision geometry. Controller markings read `STANDBY`/`--`, not invented temperature telemetry.

## Source and handoff

- `scripts/author-tyre-blankets.py`: original Blender 5.2.2 LTS authoring source.
- `scripts/aurel-tyre-blankets-and-controllers.blend`: editable components plus an inspection gallery, excluded from runtime export.
- `public/models/aurel-tyre-blankets-and-controllers.glb`: self-contained nine-variant library.
- `src/rendering/tyre-blankets.manifest.json`: exact bytes/hash, source hash, variant bounds, socket positions and triangle counts.
- `src/rendering/tyre-blankets.ts`: bounded loading, integrity checks, placement, routing, batching, LOD and ownership.
- `tests/tyre-blankets.test.ts` and `e2e/a34-tyre-blankets.spec.ts`: dedicated validation.

The export has ten material roles and one original 128-square packed weave normal map. No outside meshes, photographic textures, logos or font files are included. Built-in lettering is converted to geometry. Source-only gallery objects, lights and cameras are not exported.

A small deterministic glTF writer serializes the **evaluated Blender meshes**, preserving per-corner normals, UV seams, material primitives, hierarchy and sockets. It cyclically canonicalizes triangles without reversing their winding, orders vertices deterministically, and quantizes positions/normals to 1e-6 and UVs to 1e-4 before packing. This avoids the small UV/vertex packing differences observed with otherwise identical export processes. The selected runtime bytes are SHA-256 pinned. Blender save metadata is not claimed byte-identical. Regeneration must match the committed GLB; candidates are not silently adopted.

## Rendering and performance

Three authored detail levels exist for each variant. The fixed garage arrangement is merged **by material within each LOD**, not submitted once per stitch, connector or instance. Nine placement/socket hierarchies and the complete hidden source library remain owned beneath the A34 root. The renderer's global static batcher excludes this root. The static batching is not an implementation of animated blanket removal: future moving objects must use their retained variant geometry rather than move an already baked batch.

Only one render LOD is visible. Lens-aware detail and hysteresis follow the main camera; mirrors reuse it. No new light sources, reflection passes, animated display atlases or per-frame geometry allocations are introduced. Standby emission changes modestly with existing day/night lighting. Normal renderer cleanup includes hidden, unused variants and shared textures; cancelled pre-attachment loads dispose their own graph.

The initial illustrative 28k/12k/3k arrangement targets were not all met. The retained complete arrangement has approximately **41.3k / 18.0k / 3.9k triangles**, including routed leads; test ceilings are 45k/20k/4.5k. Export/library totals are not the same as visible scene totals. Actual numbers and bytes are authoritative in the manifest and runtime diagnostics. Material batching is capped at ten meshes per visible LOD; the real-circuit browser survey checks the added submissions rather than claiming a hardware frame rate.

## Reproduction and acceptance

```sh
blender -b --factory-startup --python-exit-code 1 --python scripts/author-tyre-blankets.py
npm ci
npm test -- tests/tyre-blankets.test.ts tests/hero-garage.test.ts tests/pit-wall-station.test.ts tests/race-view-continuity.test.ts
npm run check
npm run test:e2e -- e2e/a34-tyre-blankets.spec.ts e2e/43-hero-garage.spec.ts e2e/44-pit-wall-station.spec.ts
```

Adding `-- --render` to the authoring command produces a Blender contact sheet under `test-results/a34-authoring`. That contact sheet is **not gameplay evidence**. Browser tests exercise normal menu/practice/pause loading plus actual `CircuitScene` garage-wide, fitted-cover and controller views in day, sunset and rainy night. An additional moving inspection camera checks stability. They compare frame and wet-track arrays, check WebGL errors and allocation stability, and switch through distant/near LODs. CPU geometry tests stub image decoding; the browser tests decode the real embedded image.

The committed `A34_GAMEPLAY_CONTACT_SHEET.jpg` retains actual day/sunset/rainy-night
survey frames. Full-resolution images and measured reports are also attached to the
candidate workflow. The inspection updates both garage and equipment LODs and uses
the normal shadow-anchor calculation around the survey subject; it adds no studio
lights or exposure boost. Khronos validation reports zero errors. Its retained
warnings concern runtime-generated tangent space; the pinned Three.js renderer is
visually tested, but cross-engine normal-map equivalence is not certified. Unused
UV-channel and empty-socket notices are retained as handoff metadata, not hidden.

`finalArtApproved` remains **false**. Remaining acceptance includes full-lap human camera review, representative physical-GPU profiling, finer cloth/material art refinement, A33/crew interaction integration and the separate existing cockpit-camera repair. A fixed/moving engineering camera is not a driven lap. Publication on GitHub does not mean an external playable website was redeployed.

## Parallel-agent boundaries

A34 owns only its named source, export, manifest, loader, tests, workflow and document. Shared changes are narrow hooks in `circuit.ts`/`renderer.ts` plus additive backlog/provenance notes. Existing car, cockpit, driver, A22 and A24 binary assets are not replaced. Candidate validation records its base commit; publication must preserve newer main commits and use a non-force update. The candidate workflow retains Git objects without moving any branch. Its temporary workflow is removed when the validated feature is published.
