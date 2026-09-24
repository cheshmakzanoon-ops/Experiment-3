# Phase 27H.3 — authored pit personnel and spectator integration

Baseline: `ee4fc48f5d91f88882551ba220799ee54c47a743`, tree
`6139040c9f9987ecadcdaad98a960cc49ca18150`. Scope is the retained
Pasted markdown(10), 27H.3 and MASTER_DIRECTIVE sections 122, 128–129,
134–135. This is an implementation checkpoint, **not final-art acceptance**.

## Retained Blender source, now used by the renderer

The baseline already contained `scripts/author-people.py`,
`scripts/aurel-people.blend`, `aurel-people.glb.gz`, the exported geometry table
and its manifest. Those bytes are preserved. The previous runtime did not use
those meshes for its pit crew or grandstand crowds; it constructed separate
primitive geometry. `people-asset.ts` now binds the normal runtime to the
retained authored mesh table. No replacement assets, external human scans,
licensed models or new dependencies were introduced.

The companion table contains the same authored metre-space mesh data exported
alongside the GLB. It allows bounded instanced skinning without per-person
network requests or duplicate GLB parsing. Startup validates finite geometry,
indices, topology, skin weights and LOD roles; regression tests bind the table
and GLB to the manifest's SHA-256 values. Buffers are owned per view/cluster.

## Pit service

Each physically stopped servicing car receives fifteen task-specific actors:
four wheel-gun operators, four removal handlers, four installation handlers,
front and rear jack operators, and a release operator. Authored suit meshes,
helmets, fitted left/right gloves, wheel guns, spare tyres and jacks replace the
old body/limb construction. Seams and panels are retained from the asset;
cloth roughness uses a filtered fabric response.

A fifteen-bone analytic rig uses fixed upper/lower limb lengths. The actual
bone matrices drive both the suit and its shadow passes. Wrist targets come
from measured glove cuffs; grip points come from the gun handle, tyre sidewall
arc, jack crossbar and release pole. Left gloves use reflected geometry and
corrected winding, not negative instance scales. Operators have separate
fore/aft stations, with bounded approach and withdrawal poses.

All poses derive from PIT_PHASE, PIT_CLOCK, jack height, wheel load and actual
wheel/suspension coordinates. The unchanged `serviceWheelOffset` is shared
with FormulaCar. The working wheel is not duplicated by the crew; a separately
carried old/new tyre exchanges ownership at the physical service transition.
Pause, replay rewind and LOD changes reconstruct the same matrices without
retaining a decorative animation clock. No physics equations or recording
layout changed. Service-pad placement uses the existing chassis/jack reference
plane; nonlevel pads still require in-game contact inspection.

The view is bounded to twelve simultaneous crews / 180 actors. High and reduced
suits share one 60 × 180 RGBA32F bone texture (172,800 bytes). There are at most
seven active draw batches (six for a single near crew), not one draw per person.
Guns, jacks, handles and release paddles share an indexed matrix-palette batch,
with a further 10,752-byte transform texture. Their original material roles and
contact transforms are retained without streaming transformed vertices. The
CPU scene count is 99 draws including the existing car and floor; the original
GPU fixture limit remains strictly below 100 and still requires browser proof. Crew distance
levels switch at 45 m and are rejected beyond 160 m. The simulation's departure
phase removes the servicing group. These are component budgets, not a hardware
frame-rate guarantee.

## Spectators

Grandstand people use three authored meshes (2,296 / 1,328 / 638 triangles per
person) followed by a two-triangle analytic far impostor. Existing seat anchors,
protected aisles and spatial clusters remain. Deterministic nearby cohorts vary
occupancy, shared clothing colours, body width/height, seated/standing posture,
caps, phones, head motion and arm participation. Front rows remain seated.
Traffic/weather reactions and small idle motions use recorded simulation time;
replay rewind does not depend on earlier draw calls.

Colour, depth and point-light distance passes share the same deformation,
accessory coverage and complementary half-open LOD ranges. Packed per-vertex
person tags avoid exhausting the tested sixteen vertex-attribute locations.
The far card shares body/skin/standing choices but does not cast camera-facing
shadows. No seat or crowd grouping is displaced into an access aisle.

Read-only renderer diagnostics identify the authored source, crew contacts,
number of actors, crowd population and LOD-selected instances. Selected counts
are not claimed to be the GPU's post-frustum visible draw count.

## Executable checks and evidence boundary

`tests/people.test.ts` covers retained hashes, owned buffers, normalized skins,
left-glove winding, packed shader attributes, 305 service pose/contact samples,
605 helmet-separation samples, actual uploaded forearm/cuff transforms, posed
cloth floor clearance, packed machinery transforms/materials, exact pause/rewind reconstruction, twelve crews and
malformed inputs. It also drives the **production Simulation** autonomously
through service phases 2–6 and checks the resulting crew without mutating a
snapshot or overriding simulation state.

The existing pit GPU fixture now checks fifteen actors, contacts and GL errors.
`e2e/25-people.spec.ts` checks ordinary application startup, authored identity,
population, normal driving entry and acknowledged pause. Existing crowd tests
retain their temporal, coverage and spatial assertions; their exact triangle
expectations reflect the new authored meshes rather than the old primitives.

Reproduce with the locked dependencies:

```sh
npm ci --no-audit --no-fund
npm run check
npm run test:physics
node --experimental-transform-types scripts/rotation-benchmark.ts
node --experimental-transform-types scripts/pit-integration.ts
node --experimental-transform-types scripts/race-classification.ts
npm run test:e2e
```

Local lint, all 962 tests in 97 files, strict TypeScript and the production build
passed on this implementation. Native numerical/scenario results and source
identity are retained in the delivery report. Independently expanded production
material hooks compiled and linked in thirteen native Mesa GLES3 programs, including
colour/depth/distance controls and the far impostor. Native component renders
were inspected; they are explicitly **not normal-application captures**.

The local normal-startup test was blocked by `ERR_BLOCKED_BY_ADMINISTRATOR`.
The pit rendering fixture could not create a managed-browser WebGL context.
Neither is a browser pass. Full current-source hosted CI, normal-game pit
approach/service/replay video, lighting/shadow inspection and representative
hardware performance remain required. The baseline's earlier driver capture
also timed out in run 35978846980; that result is not silently converted to a
pass by this work.

Marshals, grid-preparation personnel and headquarters characters outside the
pit-service/grandstand paths are not replaced in this checkpoint. No map, mode,
car, later 27H phase or Steam packaging work is included. `finalArtApproved`
remains false; the global requirement/reference matrix is not granted automatic
approval from compilation, component poses or these tests.
