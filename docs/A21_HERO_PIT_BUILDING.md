# A21 — Aurel Race Operations frontage, revision 01

## Scope and neighboring agents

A21 is the permanent architectural frontage and upper operations gallery of the existing twelve-bay pit row. It is not a replacement working garage, a pit equipment kit, or a new collision/pit-lane system. Four independently placed and detailed sections cover bays 01–03, 04–06, 07–09 and 10–12. The first and last sections have exterior stair/service-core massing; the middle sections have operations/hospitality galleries and balcony edges. Facade piers, deep reveals, manufactured canopy sections, roof edges, rear ribbon windows, foundation feet, rainwater fittings and original Aurel identity are included.

The current A22 bay 05 and A24 command station remain loaded and byte-identical. Garage openings, furnishings, machinery, their source assets, car/driver/cockpit assets and all simulation/pit-service logic are untouched. A21 contains no characters, wheel guns, jacks, spare wheels, tyre blankets, trolleys, or A26 overhead service equipment. These remain owned by their respective asset tasks. The existing outer fence/access layout is not redesigned in this revision.

The upper gallery slab starts above the retained garage roof machinery. Existing geometry supplies the backing for the lower facade; the exterior layer has deliberate depth offsets rather than coplanar faces. The new gallery glazing uses opaque tinted reflectance, not refraction/transmission or a claim of complete occupied interiors. End cores are exterior architectural shells, not navigable stair gameplay.

## Source and export

- `scripts/author-pit-building-frontage.py`: original Blender authoring script.
- `src/rendering/pit-building-layout.ts`: shared placement contract derived from production `Track.at()` samples; no duplicated circuit spline in Python.
- `scripts/aurel-hero-pit-building-frontage.blend`: editable components and assembled runtime preview.
- `public/models/aurel-hero-pit-building-frontage.glb`: self-contained, chunk-local runtime export.
- `src/rendering/pit-building-frontage.manifest.json`: source/layout hashes, exact GLB hash, geometry counts, bounds, sockets and solid-occluder descriptions.
- `src/rendering/pit-building-frontage.ts`: bounded loader, integrity checks, placement, resource ownership and independent LODs.

Runtime chunks are A/B/C/D at track stations 79/106/133/160 m and lateral 35 m. Each individual bay's relative translation, elevation and yaw are derived from the original `70 + index * 9` datum. Consequently bay 05 still matches A22 at station 106 m exactly. The runtime refuses a changed bay-relative track layout instead of silently stretching old architecture over new openings.

The Blender file stores an assembled near-origin preview **after** export. The GLB keeps the four chunks origin-local so runtime placement is applied exactly once. The authoring script evaluates modifiers once and builds deterministic material batches from explicit arrays; source components remain individually editable. Rebuilding produces a candidate, not permission to overwrite other agents' assets.

Revision 01 contains 101,516 / 13,436 / 5,064 triangles when all four sections use the same LOD, nine shared materials, three original embedded 256-square surface maps, and a 4,981,240-byte GLB. Only one LOD per section is rendered. The retained initial limits remain 140k / 55k / 10k triangles and 12 MiB; they were not raised to accommodate the first export.

## Placement and interaction contract

Forty-three named empty nodes are retained: twelve bay origins, twelve sign anchors, twelve overhead-service anchors, four roof-service anchors, two rear-loading anchors, and one A22 hero interface. They are placement metadata only: no vehicle or engineer is teleported to them. A21 does not claim to finish A23, A26, A27, A28, A29 or A30 merely because it exposes an anchor for a future asset.

All near-tier vertices are checked against the current pit driving ribbon. Foundation feet extend into the retained bay datum. Thick gallery slabs, rear walls and end cores contribute 26 bounded broadcast-occlusion boxes. Empty garage volumes, glazing, railings and thin fins are not converted into false solid occluders. This is visual occlusion metadata, not physics collision or regulatory safety certification.

Normal construction adds A21 before static batching, weather installation and transform sealing. The root is excluded from destructive batching so chunk LODs and sockets survive. Main-camera projection is solved before LOD selection. Each chunk uses distance to its own bounds, lens-aware thresholds and hysteresis; the entire 100-metre row is not forced into near detail by a camera close to one end. Mirrors and shadows reuse the selected representation. No extra scene lights, probe captures or rendering passes are introduced.

Concrete, cladding, metal and enamel materials explicitly opt into the existing replay-safe outdoor-weather presentation. This is an authored material response to existing state, not simulated roof water. Diffuser emission follows day/sunset/night; no separate light is created for each strip. The existing sun/environment/fog and scene disposal paths remain authoritative.

## Validation and reproduction

```sh
blender --background --factory-startup --python scripts/author-pit-building-frontage.py
npm test -- tests/pit-building-frontage.test.ts tests/hero-garage.test.ts tests/pit-wall-station.test.ts tests/race-view-continuity.test.ts
npm run check
npm run test:e2e -- e2e/45-a21-pit-building-frontage.spec.ts e2e/43-hero-garage.spec.ts e2e/44-pit-wall-station.spec.ts
```

Sixteen A21 unit cases cover provenance, retained source, truncation, corruption, finite indexed geometry and UVs/normals, metre-space bay/socket alignment, chunk hierarchy, all twelve open passages at three detail levels, slab/end-core occlusion, foundation depth, untouched A22/A24 hashes, independent LODs, view hysteresis, stable resource reuse, disposal and bounded/cancelled transport. CPU tests deliberately substitute tiny decoded textures; browser surveys decode the actual embedded image payloads.

The browser suite separately covers normal menu/practice startup and four full-circuit survey conditions: daylight, sunset, dry night and rainy night. Each survey includes full frontage, hero garage, operations gallery, both ends, rear elevation and elevated replay-style views. It checks A22/A24 coexistence, unchanged frame/water arrays, bounded added draw submissions, stable geometry/texture counts and WebGL errors. The production screenshot helper reads the actual final framebuffer and rejects empty, transparent or uniform captures before encoding evidence. Canvas screenshots alone are not treated as proof of visible geometry.

These surveys are real-engine fixed-camera tests, not a human-driven lap or representative-hardware FPS certification. Normal startup is tested separately through the production network loader. The read-only asset workflow rebuilds source/export, checks the committed integrity receipt, and retains diagnostics; it does not automatically push generated output.

### Export identity

The selected hosted export is SHA-256 `e9f4710bd48b8e6d3d1aa4a09e5341ec0a568d56e0e08169333da77033723f6f`. The local export `9e972f3fb4f74566d865cb14c9a4d7b76f6e28d28cf69fd216a0b557d0d6553b` differs in 201 bytes. Inspection found identical GLB JSON, index topology, textures, bounds, sockets and counts; changed floating-point accessors have maximum position difference 4.77e-7 m, normal-component difference about 1.001e-4 and UV difference 9.54e-7. The failed cross-host byte comparison was retained in run 36590458254, not called a pass. Universal cross-host byte reproducibility and pixel equivalence are not claimed. The selected hosted bytes undergo full tests and exact runtime integrity checks; future regenerated exports remain review candidates.

## Concurrent publication

Only A21-owned files and narrow integration hunks in `circuit.ts`, `renderer.ts`, the render-order fixture, this backlog and provenance index are part of A21. New work is reconciled against the actual current `main`; shared files must not be restored from the original source snapshot. Publication uses the latest parent and a non-force ref update. A rejected fast-forward requires refreshing and reconciling, not forcing. Other agents' workflows and assets are preserved. Any temporary A21-only candidate-retention workflow is removed when the validated model is integrated.

## Remaining acceptance

`finalArtApproved` remains false. The model is a first integrated architectural revision, not AAA parity. Richer surface aging, full-lap camera scrutiny, final joint/edge art review and physical-hardware profiling remain. Dedicated neighboring equipment and characters are separate tasks. The reported cockpit-camera defect is unchanged and remains a separate repair. Source publication or CI success does not by itself establish that a separately hosted AppDeploy/ChatGPT site has been redeployed.

## Provenance

All A21 mesh construction, markings and surface pixels are original. No downloaded model, photographic texture, commercial-game geometry, team livery, stock scan or external font file is included. Blender's built-in text is converted to mesh. The existing supplied-player asset provenance is unchanged.

Technical references: [Blender glTF custom properties and export](https://docs.staging.blender.org/manual/en/latest/addons/scene_gltf2.html), the repository's existing A22/A24 loaders, `BroadcastSightlines`, `StaticTransformGroup`, `WeatherPresentation` and `captureRenderedCanvas`.
