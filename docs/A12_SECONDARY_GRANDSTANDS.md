# A12 — six authored Aurel secondary grandstands, revision 1

## Scope and retained game

A12 replaces the procedural building and seat geometry at the existing Aurel
stands at 450, 780, 1220, 1670, 2210 and 2600 metres. Each retains its original
48 m site, side, level deck, terrain query, eight rows, 552 seat transforms,
seat colours, protected aisles, spectator cohorts and spatial crowd chunks.
The scene uses ten instanced batches per stand, shared role buffers and three
preallocated detail levels. There is no per-frame geometry generation.

`SecondaryGrandstands` is a separate renderer component. It does not broaden
`StartFinishVenue.accepts()`: the two hero stands and their live race board are
unchanged. Vellamar does not allocate or install the A12 family. The supplied
RB19/R06 player, cockpit, driver, original cockpit calibration, track surfaces,
collision boundaries, physics, race rules, saves and replay format are unchanged.
A71 remains installed. A72–A75 are separate, unfinished district refinements.

## Authored construction and handoff

The retained `scripts/author-secondary-grandstands.py` produces thirty original
prototype meshes: deck, roof, rails, structural frame, aisle, end return, formed
seat, post, footing and fascia/gutter, each at near/middle/far detail. Its native
file contains an assembled 48 m stand and aisle sockets. The near seat includes
a pedestal and mounting shoe bridging the retained 0.30 m seat-to-terrace gap.
Post tops meet the native assembly's 6.07 m / 7.36 m rafter attachment datums;
footings reach the real sloping ground. Site transforms remain positive-scale;
left-side architecture uses independently reflected vertex/normal/index buffers.

- Author: `scripts/author-secondary-grandstands.py`
- Editable source: `scripts/aurel-secondary-grandstands.blend`
- Exchange asset: `public/models/aurel-secondary-grandstands.glb`
- Runtime accessors: `src/rendering/secondary-grandstands.geometry.json`
- Provenance: `src/rendering/secondary-grandstands.manifest.json`

The committed objects are the independently reopened macOS authoring outputs of
run **37371441417**, from source `3b31a2cf64a02de9e37ca03c093e192309e8810a`.
`A12_AUTHORING_RECEIPT.json` retains exact Git-object and SHA-256 identities.
The GLB and runtime accessor bytes also match the corrected Linux exports.
A subsequent local Blender 5.2.2 reopening of that exact hosted native file
produced byte-identical GLB and runtime payloads. No borrowed model or external
texture is used. Native material slots map to the retained venue-finish shaders.

```sh
blender -b -t 2 --factory-startup --python-exit-code 1 \
  --python scripts/author-secondary-grandstands.py -- \
  --output-root /tmp/a12-reopened \
  --source scripts/aurel-secondary-grandstands.blend
cmp public/models/aurel-secondary-grandstands.glb /tmp/a12-reopened/public/models/aurel-secondary-grandstands.glb
cmp src/rendering/secondary-grandstands.geometry.json /tmp/a12-reopened/src/rendering/secondary-grandstands.geometry.json
```

Authoring rejects output inside the application checkout. Normal installation,
tests, production builds and game startup never run Blender or patch source.
The release verifier checks the retained A12 exchange path, byte length and
SHA-256 before touching release APIs, including same-size corruption controls.

## Runtime ownership and detail

The decoder validates complete mesh names, accessor types/dimensions, bounded
counts and encoded lengths, finite positions/UVs, unit normals, topology and
index bounds. Geometry arrays are owned by each renderer instance. Repeated
roles share buffers only within that instance. Detail changes select prebuilt
index ranges; camera moves cannot allocate or regenerate a mesh.

Main, narrow-lens, cube-reflection and orthographic shadow views use actual
optical and viewport scale, with independent per-camera hysteresis. Callbacks
restore the normal range after each pass and compose with the existing
conservative static shadow-bounds culler. The silhouette never disappears at a
far tier. Disposal detaches callbacks and frees each owned buffer/material once.

The original thin pitched canopy occlusion envelope and roof-edge signage are
retained. The volume beneath the stand is not reclassified as a solid wall, and
camera routes are not moved to hide an integration problem. Existing triangle,
full-scene, cockpit-compositor and release gates are not relaxed.

## Validation and evidence boundaries

Native regressions compare all six production placements against the retained
fallback: exact seat and crowd buffers, aisle clearance, stand transforms,
terrain contacts and sampled broadcast sightlines. Additional cases cover
corrupt assets, exact GLB-accessor correspondence, mirrored winding, independent
scenes, invalid placements, camera/pass detail and idempotent cleanup.

`e2e/secondary-grandstands.spec.ts` uses the complete production renderer at day,
sunset and wet night. It retains views of every stand, close aisle views on both
sides, optical near/middle/far/telephoto cycles, quality changes, resource counts,
an authored-building removal control, and ordinary cockpit/chase captures from
one physical AI-driven traversal. Every site must retain at least four spaced
cockpit samples. Live frames and track water are checked for rendering mutation.
The observer handles wrapped pre-start grid positions, steps physics at the
unchanged 120 Hz, observes every fifteen ticks, and yields its event loop without
changing simulation time. These samples are not continuous human-input video.

Local unit and build results are recorded in the integration commit. Local Mesa
provided WebGL2, but the full-game browser attempt failed at ordinary localhost
navigation with `ERR_BLOCKED_BY_ADMINISTRATOR`; it is not a browser pass. The
independent hosted A12 workflow preserves screenshots, adapter identity, actual
budgets and failures. Its result and the full exact-commit CI/release must be read
independently: authoring success does not imply full-game acceptance.

Final-art approval, continuous human-driven race review and representative
consumer-hardware performance remain open. No AAA parity, physical Windows/wheel
approval or Steam readiness is certified by this increment.
