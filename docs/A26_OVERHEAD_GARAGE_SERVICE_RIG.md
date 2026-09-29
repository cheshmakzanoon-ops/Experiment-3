# A26 — Overhead garage service rig, revision 01

## Scope and ownership

A dedicated Blender-authored overhead service kit augments the existing A22 garage at bay 05.
It contains eight enclosed linear luminaires, two routed cable trays, rib clamps and suspended
cross-bridges, segregated utility headers, three guarded reels, parked air/fluid/power drops,
an air regulator/manifold, quick-connect fittings and eight named service sockets. The 340
editable components remain separate in the Blender source. The shipped mesh is batched by
material into three detail levels, not submitted as one object per fastener.

The retained A22 source, GLB and manifest are unchanged. Opaque service guards and enlarged
light/tray housings cover the corresponding simple A22 forms without deleting geometry from
its material batches. A26 does not replace the car, cockpit, driver, A31 tools, A33 wheel storage
or A34 blankets. Physics, service timing, the track and the garage location are unchanged.
The only shared runtime edit is the A26 loading/ownership hook in `hero-garage.ts`.

## Retained deliverables

- `scripts/author-overhead-garage-service-rig.py`: original procedural authoring source.
- `scripts/aurel-overhead-garage-service-rig.blend`: editable component/curve collection,
  separate export collection and a non-exported wireframe A22 passage guide.
- `public/models/aurel-overhead-garage-service-rig.glb`: self-contained runtime export.
- `src/rendering/overhead-garage-service-rig.manifest.json`: exact integrity/geometry receipt.
- `src/rendering/overhead-garage-service-rig.ts`: strict loader, geometry validation and ownership.

Game-local X is garage depth, Y is up and Z is width; the entrance faces -X. All dimensions are
metres. Root and LOD transforms are identity. Eight materials separate coated frame, brushed
alloy, painted housing, rubber, blue air hose, teal fluid hose, amber electrical/safety parts and
diffusers. All meshes retain UVs. This revision deliberately uses material parameters and
original mesh lettering instead of image textures: texture budget is zero, with no external
files, fonts, downloaded art or commercial-game content. Markings identify services only;
no live pressure or telemetry is fabricated.

## Integration and budgets

The GLB is 4,275,788 bytes. LOD triangle counts are 37,932 / 19,632 / 3,264; geometry is submitted
in at most eight material batches per level before shadow passes. The mid LOD exceeds the
initial 14k planning target; it is retained at 19,632 triangles to preserve the hose/rail silhouettes,
not described as meeting that original target. Further simplification can follow measured need.
Each A26 level attaches under the corresponding A22 level, so the existing lens-aware
hysteresis and mirror representation remain authoritative. Diffuser emission follows A22's
0.5 / 1.1 / 2.2 day/sunset/night levels. No lights, shadow lights or rendering passes are added.

The runtime validates byte size, SHA-256, GLB headers/chunks, self-containment, required roots,
LOD triangles, UVs, positive/finite transforms, local bounds and socket positions. It tests
triangle intersections against A22's entire protected central passage, not just sample rays.
The loader has a bounded transfer, deadline and cancellation path. Failure is explicit.
Detaching A26 before garage disposal prevents duplicate disposal of transferred LOD resources.

## Reproduction and validation

```sh
blender --background --factory-startup --python scripts/author-overhead-garage-service-rig.py
npm test -- tests/overhead-garage-service-rig.test.ts tests/hero-garage.test.ts
npm run check
npm run test:e2e -- e2e/a26-overhead-garage-service-rig.spec.ts e2e/43-hero-garage.spec.ts
```

The authoring script requires Blender 5.2.2 LTS. Running it starts a fresh scene and rebuilds
from the script; manual changes in the editable `.blend` should be preserved separately or
ported into the authoring source before regeneration. The `.blend` itself remains directly
editable. Save metadata need not be byte-identical across hosts. Runtime GLB bytes are checked
exactly for the retained asset. Cross-host byte-identical regeneration is not claimed.

Unit validation covers provenance, corruption, hierarchy, transforms, every triangle's passage
clearance, finite UV/normal data, socket transforms, inherited LOD transitions, absence of lights,
lighting modes, cancellation, transfer limits and idempotent disposal. Browser validation uses
normal production startup/practice entry and actual `RacingRenderer` / `CircuitScene` surveys
with moving inspection cameras in dry day, sunset, wet day and rainy night. Frame/water
immutability, incremental submissions, stable repeated-render allocations and WebGL errors are
checked. Screenshots and JSON receipts are retained as test artifacts, not simulated approval.

## Acceptance boundaries

`finalArtApproved` remains false. These are scripted scene inspections, not a completed driven
lap or representative physical-GPU performance certification. The pre-existing cockpit-camera
repair, full pit-entry/service/exit review and final visual approval remain separate. Hose/reel
interaction is parked static scenery; sockets and component pivots support later work but do
not imply a working fluid system or mechanic animation. A GitHub publication is not a claim
that a separate AppDeploy site has been redeployed.

## A35 clearance and source pivots

The A35 integration landed during A26 production. Its two left-side trolley envelopes
overlap the initial low power-station housing. The complete power station is now raised
0.65 m, its supply still meets the ceiling header, and its bottom clears the audited
1.72 m trolley envelope. Six stand-offs connect reel cabinets to the retained garage wall.
A regression checks every A26 triangle against all three A35 parked-equipment envelopes;
it fails on the initial model and passes the corrected one. Independently editable source
component origins are centred after runtime copies are built, preserving export identity.

## Reproduction boundary

The initial pre-clearance exports showed host-dependent differences: corresponding positions
differed by at most 0.000000238419 m, normals by 0.000100583 and UVs by 0.000000476838;
272 middle-LOD amber triangles used different indexing/diagonals. That investigation is
not a claim that all future host differences have the same bounds. This final revision is
validated using its own exact GLB and manifest. The read-only authoring workflow first
verifies shipped integrity, then regenerates and checks structure, budgets and actual
triangle-clearance/loader tests. It reports byte equality without guaranteeing it.

## Hosted integration receipt

GitHub Actions run `36637889921` generated the retained export from the source-pinned
clearance-corrected script, passed the complete lint/typecheck/build gate with 1371 tests in
142 files, and passed all nine A26/A22 browser cases without retries, skips or flaky results.
The machine receipt is `docs/A26_OVERHEAD_GARAGE_SERVICE_RIG_VALIDATION.json`. Screenshots,
logs and exact assets are retained by the run. SwiftShader is software, not hardware approval.
