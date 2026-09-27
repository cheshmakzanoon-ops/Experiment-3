# Supplied RB19 car + R06 cockpit/driver integration

The primary player (car zero) now uses the fitted assembly derived from the two
user-supplied Blender packages. AI opponents retain the original APX01 assets.
The production renderer loads the actual, embedded-texture GLB; there is no
silent procedural-car fallback when this required asset is absent or corrupt.

## Runtime and controls

The existing simulation remains authoritative. Its 3.44 m wheelbase and 1.66 m
track are unchanged. Four independent hubs follow recorded suspension travel,
steering and camber; their spin and pit-service offsets come from the same
presentation snapshots as the rest of the game. Wing visibility follows damage.

The source R06 IK has been sampled into an authored steering clip, bounded to
35 degrees in each direction. Both hands and the steering wheel use the same
sample, selected from the interpolated input rather than accumulated wall-clock
time. Pausing and seeking a replay therefore reconstruct the same pose.

The source eye socket positions the cockpit camera; a fitted RB19 camera-pod
socket positions T-cam. The camera follows chassis orientation and existing
inertial motion. Cockpit mode hides the head, skull and helmet, not the hands,
wheel or halo. Other cameras show the complete seated driver. The actual wheel
screen receives the existing live instrument canvas. The existing rear-view
render targets bind to the imported mirror surfaces. Photo-detail focus uses the
new head, display and wheel anchors. Imported paint participates in local
reflection capture, while the provided RB19 livery is preserved.

Use the game's existing camera-cycle control (C) to switch from chase to cockpit,
then pod, trackside and back to chase. No new game engine, simulation branch or
parallel demo was introduced.

## Asset provenance and budget

- Car source: `RB19_Latest_Downloadable.blend` from the uploaded RB19 package.
- Driver/cockpit source: `F1_Driver_Cockpit_REFINED_R06.blend` from the R06 handoff.
- Runtime: `public/models/supplied-player.glb.gz` (36,134,058 bytes).
- Integrity and fit: `src/rendering/supplied-player.manifest.json`.
- Build audit: `docs/SUPPLIED_PLAYER_BUILD.json`.
- Runtime geometry: 1,455,118 triangles, 94 nodes, 18 mesh objects,
  101 materials, 56 embedded images, 58 exported joints (including the export root).

The SHA-256 of the decompressed GLB is
`013a47f059bf34a0a28bd31ae8f407f07ed6e2b55755753aed9a942c895e132b`.
The compressed download is verified before decompression; the resulting GLB is
verified again, then checked for embedded-only resources and required rig nodes.
Download cancellation and failure release partially loaded resources. The
manifest hash also participates in the source fingerprint and cache URL.

## Authoring

`build-supplied-player.py` uses Blender 5.2.2 and preserves both input files.
It normalizes the source axes, fits the wheelbase, merges compatible batches,
retains source material/texture identity, removes duplicate exterior cockpit
geometry, samples the original IK, and exports one self-contained glTF assembly.
The runtime derivative reduces subdivision and hidden/internal detail. Source
reference photographs, studio objects, obsolete archives and font files are not
part of the game download. Editable combined Blender output is delivered
separately rather than adding another large binary to Git history.

```sh
blender -b --python scripts/build-supplied-player.py -- \
  --car /path/to/RB19_Latest_Downloadable.blend \
  --cockpit /path/to/F1_Driver_Cockpit_REFINED_R06.blend \
  --output /path/to/output --preview
```

After a deliberate re-export, copy the gzip and generated manifest into the
paths above together, then run the complete validation. Blender batch and
material ordering may produce a new hash; never change the manifest to accept
an unrelated asset or bypass its integrity checks.

## Validation and boundaries

`tests/supplied-player.test.ts` checks the actual binary, hashes, fit, required
nodes, embedded resources, corrupt/missing assets, cancellation and snapshot
presentation. `e2e/39-supplied-player.spec.ts` exercises the shipped GLB and its
real skeleton through neutral, both locks, pause, rewind, cockpit and T-cam.
The normal application test in `e2e/24-coupled-driver.spec.ts` now checks the
active supplied rig rather than treating the hidden legacy driver as evidence.
The legacy body/driver validators remain intact for AI and their own fixtures.

These sources are artistic reconstructions, not measured RB19 engineering CAD.
This integration does not certify 1:1 accuracy, final art, commercial rights to
team/sponsor marks, Steam readiness, or a physical-hardware FPS target. The
player keeps a high-detail representation at every distance; the imported
livery is fixed, and the older livery editor does not recolor its baked decals.
The source DRS pivot is preserved but remains closed: no new DRS physics or
control feature is claimed. Existing AI-specific clothing and LOD evidence is
not evidence for this new player model. Separate hosted browser and full-race
performance gates remain necessary. A GitHub commit does not by itself update
a separately hosted AppDeploy site.
