# A55-A60 — Aurel Quarry and track-edge integration

## Source and scope

Continues `4da4cf34260e391806fd05ed915e0d73936f00b3` and explicit authoring
commit `d3d78e984f42b24a829096cbe99152cc5109efdb`. The prior A51-A54
vegetation remains integrated. This revision dresses one coherent Aurel Quarry
sector and its background, not an entire new track or final approval of all six
asset families. Vellamar, the supplied player/car/cockpit/driver assets, physical
track, vehicle simulation, race rules, input, saves and replay format are unchanged.

## Authored library

Eleven original families cover two limestone cliff forms, coursed retaining wall,
talus, boulder, drain collar, jointed verge edge, shrub, hedge, grass tussock and
background ridge. Every family has three geometry tiers. The native Blender 5.2.2
source retains named, editable geometry, metric scale and four packed original
maps. The GLB is self-contained (1,561,972 bytes), with 33 meshes and three materials.
No third-party commercial models or image pixels are included.

Authoring run `37232962611` reopened its saved `.blend`, re-exported it and passed
a byte-for-byte GLB comparison. The downloaded hosted GLB also matches the locally
authored GLB byte-for-byte. The committed native source and manifest are the matched
hosted outputs, not a separately saved local file with a different native hash.
`A55_A60_AUTHORING_RECEIPT.json` records the exact immutable object identities.

Normal installs, tests and builds never run Blender or rewrite application source.
Explicit reproduction, with output outside the checkout:

```sh
blender -b -t 2 --factory-startup --python-exit-code 1 \
  --python scripts/author-aurel-quarry.py -- --output-root /tmp/quarry
blender -b -t 2 --factory-startup --python-exit-code 1 \
  --python scripts/author-aurel-quarry.py -- --output-root /tmp/quarry-reopened \
  --source /tmp/quarry/scripts/aurel-quarry.blend
cmp /tmp/quarry/public/models/aurel-quarry.glb /tmp/quarry-reopened/public/models/aurel-quarry.glb
```

## Placement and rendering

The designed cut and lower benches run along Aurel's left Quarry edge, opposite
the existing terrace. Full exported geometry envelopes are sampled against the
nearest racing boundary and existing stand, district, landmark, service and
recovery footprints; rejected placements are not forced into corridors. Sparse
understory, jointed verge strips and collars dress existing ground/drain locations.
Four distant limestone shoulders continue the same material identity.

Five graded visual strips connect the outer grass apron to the retained terrain
heightfield. Only the inaccessible outside slope is dressed; no road, kerb,
runoff, contact ribbon or collision triangle is removed or changed. Tree crowns
are excluded from formations and the newly graded strip so original roots do not
float within the new slope. The wider authored vegetation remains intact.

Per-family/source geometry is grouped into bounded spatial material batches. All
three tiers are packed once; lens/camera changes select index ranges without
replacing geometry or buffers. Reflection and shadow selections do not overwrite
main-camera hysteresis. Wet-material tagging, foliage alpha coverage, shared
textures and source-image lifetime follow the existing production renderer.

## Reproduced drain defect

An independent raycast test against `CircuitScene.ribbon`'s actual runoff triangles
found a retained drain bar at station 1119 m about 12.9 mm below the rendered
runoff. Its old vertical datum followed grass, which is 32 mm lower than the runoff
finish. The failing regression was executed before the correction. Aurel's bars
now use shallow millimetre-scale relief over that finish; the original stations,
open slots, topology and simulation remain unchanged. Vellamar retains its prior
geometry. The existing exact grade test uses the new specified shallow elevations,
not a wider error tolerance; the independent raycast test checks 0.5-9 mm clearance.

## Verification and acceptance boundaries

Focused local validation passed 38 tests covering native/runtime hashes, malformed
or truncated downloads, cancellation, all-tier attributes, placement, actual skirt
triangles, deterministic layout, camera-cycle identities, cleanup and release
negative controls. Native production AI with seed 1887 and eleven opponents passed
through Quarry in clear and rain conditions, yielding seven spaced captures each
in the camera-free traversal probe. This is not human driving or a GPU performance
measurement.

The initial all-source run passed 1,770 unit tests, lint, TypeScript and build,
but its source-stability guard correctly rejected concurrent intentional editing
of the candidate. That run is **not** a stable-source pass. The final frozen-source
check and exact-commit hosted browser outcomes must be recorded independently.
The first local Chromium attempt could not create WebGL2; it is not a browser pass.

`e2e/aurel-quarry.spec.ts` uses the real production asset-loading renderer in day,
sunset and wet night. It retains matched layer-off/on comparisons (not historical
baseline images), full-lap camera samples, the normal cockpit compositor, closed
camera/lens allocation cycles and actual physics-driven Quarry traversal captures.
Unchanged rendering budgets and error assertions remain required. The dedicated
workflow keeps its cockpit report separate; it does not authorize publication in
place of the ordinary complete CI and independent wet-presentation gate.

The existing branchless release verifier now also rejects missing, same-size
corrupt or path-mismatched Quarry GLBs before contacting release APIs. Only an
exact fully tested source build may be published. Final artistic approval,
continuous human-driven Section 146 acceptance and representative consumer-hardware
performance remain open. First authored/integrated revision is not AAA parity.

## Validation continuation and release-blocking cubemap repair

The frozen candidate subsequently passed `npm run check:stable`: 1,771 tests in
201 files, ESLint, TypeScript and the production build, with no guarded source
changes. A second local browser attempt successfully initialized the existing
Mesa/llvmpipe backend but navigation to the application was denied with
`ERR_BLOCKED_BY_ADMINISTRATOR`. No local game-browser pass is claimed.

The preceding vegetation-focused workflow `37229903360` passed validation and
all three lighting jobs, including the separate daytime cockpit test. However,
full baseline workflow `37229903362` failed browser partitions 2, 3, 5 and 7 and
correctly skipped publication. In shard 7, the A61 full-grid test's retained
trace shows `Session stopped / Invalid detail lens`, not simply a slow renderer.
The stack enters `AurelVegetationKit.select` while `CubeCamera.update` renders a
local reflection. Three 0.180 intentionally creates its six cube-face perspective
cameras with FOV -90 and aspect 1; treating these as invalid user lenses aborted
preparation and left the grid-start test waiting in `loading`.

A narrowly scoped internal adapter now maps that exact signed cube-face contract
to its positive optical extent. Ordinary or malformed negative lenses still fail.
Both vegetation and Quarry use the adapter, without changing camera projections,
reflection orientation, rendering budgets or primary-camera hysteresis. Three
new regressions were executed and failed with `Invalid detail lens` before the
repair, then passed afterward. They exercise all six real Three cube cameras
through both production scenery callbacks, verify restored main-camera ranges
and unchanged geometry identities, and retain invalid-lens negative controls.
This fixes the demonstrated cause; other baseline failures and the complete
new-commit browser/release outcomes still require their own evidence.
