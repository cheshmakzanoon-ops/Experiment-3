# A01–A07 track infrastructure — integrated revision 1

## Scope and preserved systems

This revision integrates seven original, editable asset families into the normal
Aurel production renderer. It follows the existing track and the recent authored
start/finish architecture rather than replacing the circuit or its race systems.
Vellamar keeps its existing infrastructure pending an independently reviewed
placement pass. A first integrated revision is not final-art acceptance.

| Asset | Integrated construction | Retained behavior |
|---|---|---|
| A01 | Profiled concrete, joints, cast variation, controlled contact wear | Original boundary coordinates and physical wall |
| A02 | Closed corrugated sheets, U-channel posts, overlaps, terminals and reflectors | Existing solid barrier corridor |
| A03 | Anchors, collars, outward posts, tensions and closed marshal access panels | Existing filtered analytical wire and transparent-shadow policy |
| A04 | Teal/off-white moulded blocks, recessed grips, straps, connectors and generic reused tyre stacks | No new impact-absorption simulation; no race-wheel replacement |
| A05 | Five closed boundary gates, six service gates, grounded approach routes and authored hinge/socket metadata | Closed collision envelope; no interactive recovery operation |
| A06 | Eight open and four sheltered marshal assemblies, footings, platform, rails, canopy and fittings | Twelve original stations, A45 people, local signals, LED panels and extinguishers |
| A07 | Portal columns, roof structure, rear catwalk, ladder, wiring/housings and maintenance access | Five original race lamps, banner, countdown, lights-out, pause and replay |

All 1,596 original boundary spans have exactly one solid owner. Concrete yields
to designated steel, impact and gate spans; it is not hidden beneath duplicated
replacement walls. Three detail levels preserve each family's silhouette. Static
boundary modules are material-batched in short spatial chunks so grade/bank
conformance and local culling are retained. Source geometry is never mutated.
The seven families use shared, packed original PBR maps (256 or 512 square), with
one additional untextured dielectric reflector material for A02. No per-module
texture or material variant is allocated. The combined GLB transfer is below
8 MiB; exact hashes, sizes and triangle counts are in the authoring receipt.

The pit approach, pit openings, apron, service choreography, supplied RB19/R06,
A61 rivals, current A41/A42 crew, A11/A13/A14 stands, A18 dynamic screen, HUD,
physics worker, race rules, replay protocol, saved data and quality presets are
not replaced or recalibrated. Gates share one owned scene root; the same root
holds boundary gates and service access. Trees are excluded from the new approach
corridors without changing the original service pads or road geometry.

## Start-light ownership

The existing `CircuitScene.update(frame)` remains authoritative. It reads
`H.LIGHTS` from the real simulation/replay snapshot and updates the original five
lamp materials. No animation clock, timer, random countdown, new RAF loop or
independent race state is introduced. Structural sockets and clear apertures are
authored around those original lamp positions. Broadcast occlusion registers only
solid supports, not an opaque bounding box across the empty portal.

The current simulator has **no aborted-start race state**. This asset revision
does not pretend to add one or silently change race rules. A future aborted-start
feature requires an explicit race-control/protocol change and its own tests.
Present coverage includes all currently supported stages, lights-out, repeated
held frames, arbitrary recorded rewind and a new-session reset.

## Authoring and provenance

The previously unpublished A01–A07 original construction was recovered from the
user's `Experiment-3-A01-recovery.zip` (version 23). Only those seven independent
families were reused. The archive's older renderer, landscape, grandstands,
additional A08+ assets and historical validation claims were not substituted for
current `main`. Original source/export hashes are preserved in
`TRACK_INFRASTRUCTURE_PROVENANCE.json`.

Every selected asset was re-exported with the checksum-pinned **Blender 5.2.2
LTS** and reopened from its saved native file to verify packed images and editable
components. A04's boolean-generated material slots are explicitly normalized:
Blender 5.2 could otherwise export handling-recess faces as an unassigned second
primitive. Geometry, normal, UV, topology and draw assertions remain strict.

Rebuild in an external directory, never over another open artist's source file:

```sh
python scripts/rebuild-track-infrastructure.py \
  --blender /path/to/blender-5.2.2-linux-x64/blender \
  --output-root /tmp/aurel-track-infrastructure
```

The wrapper checks the Blender version, exports only the seven named scripts,
reopens each native source in a separate process, verifies author/payload hashes,
and writes `authoring-receipt.json`. Each retained `scripts/aurel-*.blend` contains
editable components; each `public/models/aurel-*.glb` contains its self-contained
maps, LOD hierarchy and sockets. Hash-gated loaders reject corrupt, truncated or
external-resource payloads before rendering. `finalArtApproved` remains false.

## Runtime ownership and diagnostics

The production asynchronous factory loads and validates the kits before circuit
construction. Cancellation and disposal release source meshes, cloned templates,
conformed geometry, maps and owned scene roots. Shared geometry/material ownership
is tested. LOD selection runs inside the existing render loop and allocates no
per-frame geometry or independent animation resources. Night/wet material tags,
reflection layers and existing lighting remain in use.

Immutable asset and placement identity is reported in `environmentAssets`.
Changing LOD counts are reported separately in `infrastructureDetail`. This
preserves strict menu-to-driving asset-identity checks instead of weakening them
to accommodate legitimate camera-dependent counters.

## Validation and independent acceptance

The clean pre-change source passed 1,591 unit cases in 180 files, lint, TypeScript
and production build locally. That is baseline evidence, not automatic evidence
for the candidate. The new unit suites test source/export hashes, finite indexed
geometry, zero-area triangles, normalized normals, padded UVs, LOD bounds,
mirrored/banked conformance, exact span partitioning, gate-route clearance,
resource disposal, failed transport and real simulated start-state restoration.

`e2e/56-track-infrastructure.spec.ts` constructs the complete production renderer
with twelve actual cars. Day, sunset and wet-night surveys retain the same
snapshots and cameras for baseline/candidate inspection. Geometry negative
controls hide only the inspected kit and require changes to rendered pixels;
whole-scene brightness alone cannot certify an invisible asset. Lamp-face samples
check real simulated red stages and lights-out. Ordinary cockpit composition,
held pixels, allocation stability, local marshal grips, distant LODs and shader
errors are recorded. Fixed inspection views supplement, not replace, ordinary
menu, driving, populated-pit, cockpit and full-race journeys.

Local Chromium can create a software WebGL context, but navigation to the normal
application is rejected with `ERR_BLOCKED_BY_ADMINISTRATOR`. That is a failed local
browser gate, not a visual pass. Production-browser evidence is therefore produced
by the repository's existing GitHub Mesa backend. Current executed outcomes must
be read from the exact-commit workflow/evidence, not inferred from this scope file.

Full-lap human visual approval, representative Windows/controller performance,
final natural-motion/art review, Vellamar propagation, interactive recovery and
aborted-start race control remain separate open work. Software-rendered timings,
triangle counts and passing unit tests do not establish hardware FPS, commercial
photorealism, complete master-directive acceptance or Steam readiness.

## Cross-host export identity

The first hosted export stopped on byte inequality against local Blender output.
All construction-manifest fields (source, triangle counts, draws, materials, bounds,
sockets and LODs) are required to remain exact. Local and hosted byte identities
are separately retained in the provenance record. Hosted files are new candidates: 
all loader, geometry and production-browser checks rerun against their own exact
retained hashes. Byte-identical export across CPU hosts is not claimed.
