# A31 — Aurel wheel gun, revision 01

## Scope

One original Blender-authored close-up pneumatic tool, loaded through the normal production startup path. It replaces the old visible wheel-gun prototype at the four gun-operator positions for each active pit crew. Two instances rest on the existing A22 worktops. The player car, cockpit, driver, garages, other asset-family binaries, physical service timing and track/collision rules are not rewritten.

The retained source contains a formed motor casing, impact housing, narrow support-hand neck, shaped rubber grip, separate pivoted trigger, direction paddles, removable hollow six-flat socket, retention collar, fasteners, casing seams, original Aurel markings, and a swivel/quick-release air connector. The full hose route and compressed-air station belong to A26/A38 and are not invented as a rigid dangling hose on this asset.

## Files and authoring

- `scripts/author-wheel-gun.py` builds editable components in Blender 5.2.2 LTS and exports evaluated meshes through a canonical glTF 2.0 writer.
- `scripts/aurel-wheel-gun.blend` retains editable source components, UVs, packed material maps and non-exported existing-glove contact references.
- `public/models/aurel-wheel-gun.glb` is the complete runtime model, including all three detail levels and embedded PNG maps.
- `src/rendering/wheel-gun.manifest.json` records exact source/export hashes, dimensions, counts, pivots, six contact/socket transforms and optional interaction-volume metadata.
- `src/rendering/wheel-gun.ts` owns strict bounded acquisition, validation and instanced presentation.
- `src/rendering/wheel-gun-contact.ts` measures the supplied player and authored-rival centre-lock geometry in its real carrier frame.
- `scripts/verify-wheel-gun.py`, `tests/wheel-gun.test.ts` and `e2e/a31-wheel-gun.spec.ts` provide the validation gates.

```sh
blender --background --factory-startup --python scripts/author-wheel-gun.py
python scripts/verify-wheel-gun.py
npm ci
npm run check
APEX_BROWSER_BACKEND=mesa LIBGL_ALWAYS_SOFTWARE=true GALLIUM_DRIVER=llvmpipe \
  xvfb-run -a npm run test:e2e -- e2e/a31-wheel-gun.spec.ts
```

Append `-- --export-only` to re-export source mesh/UV edits from the retained blend; socket and atlas parameters are retained in the authoring script. Append `-- --output-root /absolute/candidate` to regenerate into a separate validation destination. Append `-- --render-dir /absolute/evidence` for Blender inspection renders. Reference glove meshes are never exported or bundled as new crew art. The source/export binaries are ordinary Git binary files under the repository's existing `.gitattributes`, not Git LFS pointers.

## Scale, pivots and contact

The authored frame is metre-scale, +Y up, with +Z along the socket drive axis. The root is the wheel-nut engagement datum rather than the visual bounding-box centre. The complete gun is approximately 0.327 m long, 0.104 m wide and 0.231 m high including its connector. Trigger, body and socket have independent pivots. Six metadata transforms define primary hand, support hand, trigger finger, wheel nut, hose connection and stow attachment.

The existing glove grip/cuff convention is preserved. Operator hand locations are derived from the tool's retained contact coordinates; steering/camber now participate in crew-pose cache invalidation. The gun follows actual presented suspension/steering/camber data. Player front/rear hub depths are measured independently from the supplied centre-lock material; authored rivals are measured from their central metal geometry after static batching. The larger rival lock uses a bounded radial socket adaptation while the body and hand grip keep their original scale. No negative-scale mirrored tools or rescaled cars are used.

Trigger depression follows the existing loosening/tightening portions of the recorded service clock. Socket rotation is available as an independent presentation parameter, but the production integration deliberately does not invent an RPM or rotate through a stationary, unsimulated nut. Pause and rewind do not depend on elapsed wall-clock time. Collision boxes are future interaction metadata only, not new physics obstacles.

## Rendering contract

Three authored LODs contain 17,428 / 3,330 / 732 triangles. One shared metal/roughness PBR material uses three original 256 x 256 embedded maps. Geometry is separated only into BODY/TRIGGER/SOCKET per LOD, with fixed-capacity instancing: at most 48 service tools and nine service draw batches across all detail levels. One gun renders one level, never all three. The nearest-level threshold is lens-aware, with hysteresis; camera-only transitions still update tools when the crew pose is cached. Two stored tools reuse the same geometry and material resources.

The loader rejects bad headers, byte counts, integrity, external-resource references, missing named parts/sockets and invalid LOD topology before accepting the model. Partial, cancelled and oversized requests are errors rather than silent fallback art. Normal startup awaits the real GLB before crew warmup; direct legacy constructor fixtures remain available for unrelated existing tests and do not claim to be A31.

No new lights, shadow maps, reflection passes, postprocessing or simulation channels are introduced. Existing scene illumination, weather, shadows and mirrors remain in charge. Runtime allocation and submission witnesses must be reviewed together with the actual scene screenshots, not inferred solely from polygon counts.

## Validation and acceptance boundary

The asset tests cover source provenance, actual GLB decoding, a ray through the physical hollow socket, independent actuation pivots, oriented contact transforms, bounded instance counts, positive scales, camera-only LOD changes, legacy-tool replacement, crew reachability, unchanged input frames, pause, rewind, steering changes, cancellation, corruption and one-time detached-resource disposal.

Browser surveys use the normal RacingRenderer factory and simulation-produced pit-service snapshots, with fixed engineering close-up cameras on both sides and actual imported wheel-carrier witnesses. Day, sunset and rainy-night frames, stowed worktop tools, pose continuity and repeated-render allocations are captured. The position gate is 2 mm, angular gate 0.5 degrees and radial clearance gate 0.9 mm. These tests are distinct from a manually driven lap or representative-hardware GPU certification.

`finalArtApproved` remains false. The retained crew gloves remain coarse and need their own A42 refinement; articulated fingers are not introduced here. Fine hand/casing surface contact still needs final art review in every service phase. Full moving hose routing, detailed pneumatic operation, human-driven full-lap inspection, representative-hardware profiling and the separately tracked cockpit-camera repair remain open. A source push alone is not an external website redeployment.

## Provenance

All gun geometry, labels and surface pixels are original. Existing repository glove geometry is used solely as a non-exported fit reference. No third-party wheel-gun mesh, commercial-game model, branded team logo, external font file, stock photograph or procedural placeholder is shipped as A31. Tiny attribute quantization eliminates non-visible Blender bevel UV interpolation drift; the exact generated GLB identity is always recorded, never assumed.

## Hosted validation receipt

Candidate run `36598980773` passed full lint, TypeScript, the production build, all 1,350 unit tests and 16 browser cases covering A31/A22/A24/A33, with no retries or skips. It reproduced GLB SHA-256 `55be98828d4d84152a2b82edf797315b2fb1ea2c3a16f09ef6a9fd457b9a1b93` exactly and reopened the retained Blender source to verify every packed PBR pixel.

Publication run `36601691104` rechecks the saved source, full project checks and the same 16 browser cases against the publication checkout. Its A31 surveys additionally capture both sides of both front-wheel tools; the wide service cameras can be occluded by adjacent crew and are retained as contextual views, not treated as proof of unobstructed hand contact. No crew is hidden for the additional captures. The renderer is hosted Mesa/llvmpipe software rendering, not physical-hardware FPS certification. Final hand-contact art approval remains open.

The production source/GLB are ordinary Git binaries. Temporary candidate transfer files and write-enabled A31 helper workflows are removed after validation. The retained authoring workflow is read-only.
