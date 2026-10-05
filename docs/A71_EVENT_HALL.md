# A71 — authored Aurel event-hall refinement, revision 1

## Starting point and scope

The preceding menu/graphics correction at `55898dc` passed complete workflow
`37321532757`, including all eight browser partitions and wet presentation. Its
source-matched playable release was published on 2026-10-05. That release closes
the earlier runtime blocker; it does not constitute artistic or hardware approval.

This revision replaces the existing Aurel event hall's procedural building meshes
with an original Blender-authored library. The deterministic site, 27.5 m plaza
radius, terrain-seated foundation, 42 m spherical screen, 4.4 m bearing datum and
24 structural support anchors remain. New external details include four recessed
glazed entrance bays, projecting canopy lobes, facade mullions, a transom ring,
door hardware, shallow sloped approaches and chamfered columns. Bollards are
rotated half a placement interval to leave the approach axes clear.

No new circuit, interior walking system, simulation rule, track/collision mesh,
player model, driver animation, save format or replay format is introduced.
Vellamar retains its lighthouse. A12 secondary stands and A72–A75 districts are
separate, still-open packages.

## Native handoff and provenance

`scripts/author-event-hall.py` is the readable, explicit authoring entry point.
`scripts/aurel-event-hall.blend` retains ten named prototype meshes, an assembled
near hall, four entrance sockets, metric units, UVs and five PBR material slots.
The self-contained exchange file is `public/models/aurel-event-hall.glb`.
The runtime payload is extracted from its actual position, normal, UV and index
accessors, not a separately regenerated approximation. There are no external
textures, borrowed building images or third-party commercial meshes.

Runtime materials deliberately reuse the existing coated-glazing, concrete,
metal and physical LED shader pipeline. The native file supplies material slots;
it is not a baked copy of the game's weather or procedural LED shader.

Explicit local authoring and independent native reopening produced byte-identical
GLB and runtime payloads. Hosted authoring run `37350694052` repeated that check;
the hosted GLB and accessor payload also match the local outputs byte-for-byte.
The integrated native file and manifest are the matched hosted outputs, whose
immutable identities are retained in `A71_AUTHORING_RECEIPT.json`.

```sh
blender -b -t 2 --factory-startup --python-exit-code 1 \
  --python scripts/author-event-hall.py -- --output-root /tmp/a71
blender -b -t 2 --factory-startup --python-exit-code 1 \
  --python scripts/author-event-hall.py -- --output-root /tmp/a71-reopened \
  --source /tmp/a71/scripts/aurel-event-hall.blend
cmp /tmp/a71/public/models/aurel-event-hall.glb /tmp/a71-reopened/public/models/aurel-event-hall.glb
cmp /tmp/a71/src/rendering/event-hall.geometry.json /tmp/a71-reopened/src/rendering/event-hall.geometry.json
```

Ordinary install, test, build and startup never run Blender or rewrite application
source. Authoring rejects an output root inside the source checkout.

## Rendering and resource bounds

The building still uses eight main-view draws. Including every packed shell tier
and all 24 column/20 bollard instances, allocation is 6,856 triangles, below the
unchanged 7,000-triangle contract. Active near geometry submits 5,880 triangles;
the screen alone uses 3,008 / 736 / 240 triangles at near / mid / far detail.

Three shell tiers share one set of GPU buffers. Perspective, narrow-field,
reflection and orthographic-shadow views select only an index range, accounting
for actual optical and pass resolution. Per-camera hysteresis prevents reflection
selection from changing the main camera's history. Post-pass callbacks restore
the normal range; camera changes allocate no replacement geometry or buffers.
The shell remains visible at every tier and keeps the same top/bottom datums.

The runtime decoder checks bounded lengths, types, finite values, unit normals,
indices and expected topology. The release verifier rejects missing, same-size
corrupt or path-mismatched exchange files before contacting release APIs.

## Evidence and acceptance limits

The original landmark tests remain unchanged. New tests check source/native/GLB
hashes, exact exported accessors, corrupt-input negative controls, per-scene buffer
ownership, every shell tier, perspective/cube/shadow selection, approach furniture
and Vellamar isolation. Release tests preserve their existing positive/recovery
cases and add A71 corruption and path negative controls.

Offline Mesa component renders were inspected at whole-building and entrance
scales: each submitted eight draws and 5,880 triangles with no WebGL error. They
are component renders, not full-game or hardware-performance evidence. Local HTTP
browser navigation was blocked by the environment; no local application-browser
pass is claimed.

`e2e/event-hall.spec.ts` uses the full production factory, normal cockpit compositor,
closed camera/detail cycles and spaced ordinary AI-driven approach captures in
day, sunset and wet night. It retains all existing infrastructure/cockpit rendering
budgets, source-frame/water immutability and resource/GL checks. The exact-commit
hosted results must be read independently; a unit pass or a successful authoring
workflow does not imply these browser checks passed.

Continuous human-driven full-race review, representative consumer-hardware timing,
final-art approval, and broader district/secondary-stand propagation remain open.
